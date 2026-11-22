import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WebSocket } from 'ws';
import {
  ACTIONS,
  parseCommand,
  routeIntent,
  beginDialogue,
  resolveDialogue,
  type DialogueState,
  requiresApproval,
  validateCommand,
  ackMessage,
  type ParseResult,
} from '../../../packages/command-protocol/src/index';
import {
  ALL_CAPABILITIES,
  DEFAULT_SETTINGS,
  FINAL_STATUSES,
  type ActionName,
  type Automation,
  type Capability,
  type Command,
  type CommandSource,
  type CommandStatus,
  type Device,
  type DeviceToServer,
  type ServerToClient,
  type ServerToDevice,
  type UserSettings,
} from '../../../packages/shared-types/src/index';
import type { RelayConfig } from './config';
import { all, one, run, runVolatile, type DB, type Row } from './db';
import { addMs, log, newId, nowIso, parseJson } from './util';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// ---- row mappers -------------------------------------------------------

export function toCommand(r: Row): Command {
  return {
    id: r.id,
    deviceId: r.device_id ?? null,
    source: r.source,
    inputText: r.input_text ?? null,
    action: r.action,
    args: parseJson(r.args, {}),
    requiresApproval: !!r.requires_approval,
    status: r.status,
    createdAt: r.created_at,
    approvedAt: r.approved_at ?? null,
    dispatchedAt: r.dispatched_at ?? null,
    startedAt: r.started_at ?? null,
    finishedAt: r.finished_at ?? null,
    durationMs: r.duration_ms ?? null,
    result: parseJson(r.result, null),
    error: r.error_code ? { code: r.error_code, message: r.error_message ?? '' } : null,
    automationRunId: r.automation_run_id ?? null,
    screenshotId: r.screenshot_id ?? null,
  };
}

function toAutomation(r: Row): Automation {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    steps: parseJson(r.steps, []),
    enabled: !!r.enabled,
    deviceId: r.device_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastRunAt: r.last_run_at ?? null,
    lastRunStatus: r.last_run_status ?? null,
    schedule: {
      enabled: !!r.schedule_enabled,
      time: r.schedule_time ?? null,
      timezone: r.schedule_timezone ?? 'Asia/Kuala_Lumpur',
    },
  };
}

type DailySchedule = { enabled: boolean; time: string | null; timezone: string };

function parseDailySchedule(value: unknown, current?: DailySchedule): DailySchedule {
  const fallback: DailySchedule = current ?? { enabled: false, time: null, timezone: 'Asia/Kuala_Lumpur' };
  if (value === undefined) return fallback;
  if (value === null) return { enabled: false, time: null, timezone: fallback.timezone };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, 'BAD_SCHEDULE', 'schedule must be an object');
  const v = value as Record<string, unknown>;
  const enabled = v.enabled === undefined ? fallback.enabled : v.enabled === true;
  const time = v.time === undefined ? fallback.time : v.time;
  const timezone = v.timezone === undefined ? fallback.timezone : v.timezone;
  if (time !== null && (typeof time !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)))
    throw new HttpError(400, 'BAD_SCHEDULE', 'schedule time must be HH:mm (24-hour)');
  if (enabled && time === null)
    throw new HttpError(400, 'BAD_SCHEDULE', 'time required when schedule is enabled');
  if (typeof timezone !== 'string' || timezone.length > 64)
    throw new HttpError(400, 'BAD_SCHEDULE', 'invalid timezone');
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); }
  catch { throw new HttpError(400, 'BAD_SCHEDULE', 'unknown IANA timezone'); }
  return { enabled, time: time as string | null, timezone };
}

interface DeviceConn {
  ws: WebSocket;
  deviceId: string;
  userId: string;
  lastMsg: number;
  ip: string | null;
  welcomed:boolean;
}

export class Relay {
  private devices = new Map<string, DeviceConn>();
  private clients = new Map<string, Set<WebSocket>>(); // userId → sockets
  // Ephemeral live screen sessions: never persist frames or replay after disconnect.
  // One viewer per device, one monitor, 90 seconds maximum with local Windows consent.
  private liveViews = new Map<string, {
    userId:string; viewer:WebSocket; sessionId:string; deviceId:string;
    expiresAt:number; ready:boolean; lastFrame:number;
  }>();
  private timer: NodeJS.Timeout | null = null;
  private lastMaintenance = 0;
  private lastScheduleTick = 0;
  // Private SQLite state survives Relay/Render restarts and is scoped to the owner.
  // A missing-slot answer is NOT an approval or authority to send a message.
  private screenshotDir: string;

  private readPendingDialogue(userId: string): DialogueState | null {
    const row = one(this.db, 'SELECT state_json, expires_at FROM command_dialogues WHERE user_id=?', userId);
    if (!row) return null;
    if (row.expires_at <= Date.now()) {
      this.clearPendingDialogue(userId);
      return null;
    }
    try {
      const state = JSON.parse(row.state_json) as DialogueState;
      if (!state || typeof state.topic !== 'string' || !Number.isFinite(state.expiresAt)
          || state.expiresAt <= Date.now()) throw new Error('expired or invalid state');
      return state;
    } catch {
      this.clearPendingDialogue(userId);
      return null;
    }
  }

  private writePendingDialogue(userId: string, state: DialogueState): void {
    // Conversation slot lasts 12 hours; action approval still expires separately.
    const saved = { ...state, expiresAt: Date.now() + 12 * 60 * 60_000 };
    run(this.db, `INSERT INTO command_dialogues(user_id,state_json,expires_at) VALUES(?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json,expires_at=excluded.expires_at`,
      userId, JSON.stringify(saved), saved.expiresAt);
  }

  private clearPendingDialogue(userId: string): void {
    run(this.db, 'DELETE FROM command_dialogues WHERE user_id=?', userId);
  }

  pendingCommandDialogue(userId: string): {topic: string} | null {
    const state = this.readPendingDialogue(userId);
    return state ? {topic:state.topic} : null;
  }

  discardCommandDialogue(userId: string): void {
    this.clearPendingDialogue(userId);
  }

  constructor(public db: DB, public config: RelayConfig) {
    this.screenshotDir = join(config.dataDir, 'screenshots');
    mkdirSync(this.screenshotDir, { recursive: true });
  }

  start() {
    // A process restart interrupts any in-memory automation runner. Do not
    // leave it falsely marked running and block future invocations.
    run(this.db, "UPDATE automations SET last_run_status = 'interrupted' WHERE last_run_status = 'running'");
    // A prior dispatch may have reached Windows before relay restart. Never
    // replay it or continue an orphan automation without a fresh owner action.
    const interrupted = all(this.db, "SELECT id FROM commands WHERE status IN ('pending','running','awaiting_approval') AND (dispatched_at IS NOT NULL OR status='running' OR automation_run_id IS NOT NULL)");
    for (const c of interrupted) this.finish(c.id,'cancelled',null,{code:'INTERRUPTED_UNVERIFIED',message:'Relay restarted; action may already have occurred. Inspect manually before requesting a new command.'});
    this.timer = setInterval(() => this.sweep(), 1000);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const id of [...this.liveViews.keys()]) this.endLiveView(id,'relay_stopped');
    for (const c of this.devices.values()) c.ws.close(1001, 'server shutting down');
    for (const set of this.clients.values()) for (const ws of set) ws.close(1001, 'server shutting down');
  }

  // ---- audit ----------------------------------------------------------
  audit(userId: string | null, actor: 'user' | 'device' | 'system', event: string, detail: Record<string, unknown> | null = null, deviceId: string | null = null, ip: string | null = null) {
    run(this.db, 'INSERT INTO audit_logs (id, user_id, device_id, actor, event, detail, ip, at) VALUES (?,?,?,?,?,?,?,?)',
      newId('a_'), userId, deviceId, actor, event, detail ? JSON.stringify(detail) : null, ip, nowIso());
  }

  // ---- clients --------------------------------------------------------
  addClient(userId: string, ws: WebSocket) {
    let set = this.clients.get(userId);
    if (!set) this.clients.set(userId, (set = new Set()));
    set.add(ws);
    ws.on('close', () => {
      set!.delete(ws);
      for(const [deviceId,session] of this.liveViews){
        if(session.viewer===ws)this.endLiveView(deviceId,'viewer_disconnected');
      }
    });
    ws.on('message',(data)=>{
      // Web client websocket is authenticated by /ws/client; never accept
      // device-origin frames or model-provided remote-control commands here.
      const raw=data.toString();
      if(raw.length>1200)return;
      let m:unknown;
      try{m=JSON.parse(raw);}catch{return;}
      if(!m||typeof m!=='object'||Array.isArray(m))return;
      const v=m as Record<string,unknown>;
      if(v.type==='live_screen.subscribe'){
        try{this.startLiveView(userId,ws,v.deviceId,v.monitor);}
        catch(e){this.sendClient(ws,{type:'live_screen.status',deviceId:String(v.deviceId??'').slice(0,120),sessionId:'',status:'error',reason:e instanceof Error?e.message:'Live view unavailable'});}
      }else if(v.type==='live_screen.unsubscribe'){
        for(const [deviceId,session] of this.liveViews){
          if(session.viewer===ws)this.endLiveView(deviceId,'viewer_stopped');
        }
      }
    });
    this.sendClient(ws, { type: 'hello', userId });
  }
  private sendClient(ws: WebSocket, m: ServerToClient) {
    if (ws.readyState === 1) ws.send(JSON.stringify(m));
  }
  broadcast(userId: string, m: ServerToClient) {
    const set = this.clients.get(userId);
    if (!set) return;
    const s = JSON.stringify(m);
    for (const ws of set) if (ws.readyState === 1) ws.send(s);
  }
  clientCount(userId: string) {
    return this.clients.get(userId)?.size ?? 0;
  }

  // ---- owner-approved ephemeral screen preview ------------------------
  private startLiveView(userId:string,viewer:WebSocket,rawDevice:unknown,rawMonitor:unknown) {
    if(typeof rawDevice!=='string'||!rawDevice||rawDevice.length>120||
       rawMonitor!==1)throw new HttpError(400,'LIVE_ARGUMENTS','Choose monitor 1 on a paired laptop');
    const row=this.getDeviceRow(userId,rawDevice);
    const config=parseJson<Record<string,unknown>>(row.controller_config,{});
    const enabled=parseJson<Capability[]>(row.capabilities_enabled,[]);
    const reported=parseJson<Capability[]>(row.capabilities_reported,[]);
    if(row.paused||!enabled.includes('screen')||!reported.includes('screen')||
       config.screenCapture!==true || config.liveScreenPreview!==true || !this.isOnline(rawDevice))
      throw new HttpError(409,'LIVE_UNAVAILABLE','Laptop offline, paused or screen permission disabled');
    if(this.liveViews.has(rawDevice))
      throw new HttpError(409,'LIVE_BUSY','A live screen preview is already active for this laptop');
    for(const [id,session] of this.liveViews){
      if(session.viewer===viewer)this.endLiveView(id,'viewer_switched');
    }
    const sessionId=newId('live_');
    const session={userId,viewer,sessionId,deviceId:rawDevice,
      expiresAt:Date.now()+90_000,ready:false,lastFrame:0};
    this.liveViews.set(rawDevice,session);
    if(!this.sendDevice(rawDevice,{type:'live_screen.start',sessionId,monitor:1,durationSeconds:90})){
      this.liveViews.delete(rawDevice);
      throw new HttpError(409,'LIVE_OFFLINE','Laptop disconnected before live approval');
    }
    this.audit(userId,'user','live_screen.requested',{monitor:1},rawDevice);
    this.sendClient(viewer,{type:'live_screen.status',deviceId:rawDevice,
      sessionId,status:'awaiting_local_approval'});
  }

  private endLiveView(deviceId:string,reason:string,sendStop=true){
    const s=this.liveViews.get(deviceId);
    if(!s)return;
    this.liveViews.delete(deviceId);
    if(sendStop)this.sendDevice(deviceId,{type:'live_screen.stop',sessionId:s.sessionId});
    this.sendClient(s.viewer,{type:'live_screen.status',deviceId,
      sessionId:s.sessionId,status:'ended',reason});
    this.audit(s.userId,'system','live_screen.ended',{reason},deviceId);
  }

  private onLiveDeviceMessage(conn:DeviceConn,msg:DeviceToServer) {
    const session=this.liveViews.get(conn.deviceId);
    if(!session||!('sessionId' in msg)||msg.sessionId!==session.sessionId)return;
    if(Date.now()>=session.expiresAt){this.endLiveView(conn.deviceId,'time_limit');return;}
    if(msg.type==='live_screen.denied'||msg.type==='live_screen.ended'){
      const status=msg.type==='live_screen.denied'?'denied':'ended';
      this.liveViews.delete(conn.deviceId);
      this.sendClient(session.viewer,{type:'live_screen.status',deviceId:conn.deviceId,
        sessionId:session.sessionId,status,reason:String(msg.reason??'stopped').slice(0,100)});
      return;
    }
    if(msg.type==='live_screen.ready'){
      session.ready=true;
      this.sendClient(session.viewer,{type:'live_screen.status',deviceId:conn.deviceId,
        sessionId:session.sessionId,status:'live'});
      return;
    }
    if(msg.type!=='live_screen.frame'||!session.ready)return;
    // Never write a live frame to screenshots, logs, audit, database or Gemini.
    // Reject oversized or malformed traffic; don't allow backpressure buildup.
    if(msg.mime!=='image/jpeg'||typeof msg.dataBase64!=='string'||
       msg.dataBase64.length>400_000||msg.dataBase64.length<100||
       !/^[A-Za-z0-9+/]+={0,2}$/.test(msg.dataBase64)||
       !Number.isInteger(msg.width)||!Number.isInteger(msg.height)||
       msg.width<1||msg.height<1||msg.width>1280||msg.height>1280){
      this.endLiveView(conn.deviceId,'invalid_frame');return;
    }
    if(Date.now()-session.lastFrame<650)return; // bounded <= about 1 fps
    session.lastFrame=Date.now();
    if(session.viewer.readyState!==1||session.viewer.bufferedAmount>500_000){
      this.endLiveView(conn.deviceId,'viewer_unavailable');return;
    }
    this.sendClient(session.viewer,{type:'live_screen.frame',deviceId:conn.deviceId,
      sessionId:session.sessionId,mime:'image/jpeg',
      dataBase64:msg.dataBase64,width:msg.width,height:msg.height});
  }

  // ---- settings -------------------------------------------------------
  getSettings(userId: string): UserSettings {
    const r = one(this.db, 'SELECT settings FROM user_settings WHERE user_id = ?', userId);
    const s = parseJson<Partial<UserSettings>>(r?.settings, {});
    return { ...DEFAULT_SETTINGS, ...s, approvalRequired: { ...DEFAULT_SETTINGS.approvalRequired, ...(s.approvalRequired ?? {}) } };
  }
  saveSettings(userId: string, patch: Partial<UserSettings>): UserSettings {
    const cur = this.getSettings(userId);
    const next = sanitizeSettings({ ...cur, ...patch });
    run(this.db, `INSERT INTO user_settings (user_id, settings, updated_at) VALUES (?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`, userId, JSON.stringify(next), nowIso());
    this.broadcast(userId, { type: 'settings.updated', settings: next });
    return next;
  }

  // ---- devices --------------------------------------------------------
  isOnline(deviceId: string) {
    const conn=this.devices.get(deviceId);
    return !!conn?.welcomed && conn.ws.readyState===1;
  }

  deviceDto(r: Row): Device {
    const last = one(this.db, 'SELECT action, status, created_at FROM commands WHERE device_id = ? ORDER BY created_at DESC LIMIT 1', r.id);
    return {
      id: r.id,
      name: r.name,
      os: r.os ?? null,
      osVersion: r.os_version ?? null,
      hostname: r.hostname ?? null,
      controllerVersion: r.controller_version ?? null,
      online: this.isOnline(r.id),
      paused: !!r.paused,
      status: r.status,
      lastSeen: this.isOnline(r.id) ? nowIso() : r.last_seen ?? null,
      createdAt: r.created_at,
      capabilitiesReported: parseJson(r.capabilities_reported, []),
      capabilitiesEnabled: parseJson(r.capabilities_enabled, []),
      controllerConfig: parseJson(r.controller_config, null),
      lastCommand: last ? { action: last.action, status: last.status, at: last.created_at } : null,
      stats: parseJson(r.stats, null),
    };
  }

  listDevices(userId: string): Device[] {
    return all(this.db, "SELECT * FROM devices WHERE user_id = ? AND status = 'paired' ORDER BY created_at", userId).map((r) => this.deviceDto(r));
  }

  getDeviceRow(userId: string, deviceId: string): Row {
    const r = one(this.db, "SELECT * FROM devices WHERE id = ? AND user_id = ? AND status = 'paired'", deviceId, userId);
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'device not found');
    return r;
  }

  private pushDevice(deviceId: string) {
    const r = one(this.db, 'SELECT * FROM devices WHERE id = ?', deviceId);
    if (r && r.status === 'paired') this.broadcast(r.user_id, { type: 'device.updated', device: this.deviceDto(r) });
  }

  private connEvent(deviceId: string, event: string, ip: string | null = null) {
    run(this.db, 'INSERT INTO connection_events (id, device_id, event, ip, at) VALUES (?,?,?,?,?)', newId('ce_'), deviceId, event, ip, nowIso());
  }

  connectionHistory(userId: string, deviceId: string) {
    this.getDeviceRow(userId, deviceId);
    return all(this.db, 'SELECT event, ip, at FROM connection_events WHERE device_id = ? ORDER BY at DESC LIMIT 50', deviceId);
  }

  updateDevice(userId: string, deviceId: string, patch: { name?: unknown; capabilitiesEnabled?: unknown }) {
    const r = this.getDeviceRow(userId, deviceId);
    if (patch.name !== undefined) {
      if (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.length > 60) throw new HttpError(400, 'BAD_REQUEST', 'invalid name');
      run(this.db, 'UPDATE devices SET name = ? WHERE id = ?', patch.name.trim(), deviceId);
      this.audit(userId, 'user', 'device.renamed', { from: r.name, to: patch.name.trim() }, deviceId);
    }
    if (patch.capabilitiesEnabled !== undefined) {
      if (!Array.isArray(patch.capabilitiesEnabled) || patch.capabilitiesEnabled.some((c) => !ALL_CAPABILITIES.includes(c as Capability)))
        throw new HttpError(400, 'BAD_REQUEST', 'invalid capabilities');
      const caps = [...new Set(patch.capabilitiesEnabled as Capability[])];
      run(this.db, 'UPDATE devices SET capabilities_enabled = ? WHERE id = ?', JSON.stringify(caps), deviceId);
      this.audit(userId, 'user', 'device.capabilities', { enabled: caps }, deviceId);
      const open = all(this.db, "SELECT id,action FROM commands WHERE device_id=? AND status IN ('pending','awaiting_approval','running')",deviceId);
      for(const c of open){
        const cap=ACTIONS[c.action as ActionName]?.capability;
        if(cap&&!caps.includes(cap))this.finish(c.id,'cancelled',null,{code:'CAPABILITY_REVOKED',message:'Permission revoked. Previously delivered input may still have occurred.'});
      }
      if(!caps.includes('screen'))this.endLiveView(deviceId,'screen_permission_revoked');
      this.sendDevice(deviceId, { type: 'capabilities', enabledCapabilities: caps });
    }
    this.pushDevice(deviceId);
    return this.deviceDto(one(this.db, 'SELECT * FROM devices WHERE id = ?', deviceId)!);
  }

  setPaused(userId: string, deviceId: string, paused: boolean, reason: string) {
    this.getDeviceRow(userId, deviceId);
    run(this.db, 'UPDATE devices SET paused = ? WHERE id = ?', paused ? 1 : 0, deviceId);
    this.connEvent(deviceId, paused ? 'paused' : 'resumed');
    this.audit(userId, 'user', paused ? 'device.paused' : 'device.resumed', { reason }, deviceId);
    if (paused) {
      this.endLiveView(deviceId,'emergency_pause');
      const open = all(this.db, "SELECT id FROM commands WHERE device_id = ? AND status IN ('pending','awaiting_approval','running')", deviceId);
      for (const c of open) this.finish(c.id, 'cancelled', null, { code: 'EMERGENCY_STOP', message: reason });
      this.sendDevice(deviceId, { type: 'pause' });
    } else {
      this.sendDevice(deviceId, { type: 'resume' });
    }
    this.pushDevice(deviceId);
  }

  emergencyStopAll(userId: string) {
    const devs = all(this.db, "SELECT id FROM devices WHERE user_id = ? AND status = 'paired'", userId);
    for (const d of devs) this.setPaused(userId, d.id, true, 'emergency stop');
    const open = all(this.db, "SELECT id FROM commands WHERE user_id = ? AND status IN ('pending','awaiting_approval','running')", userId);
    for (const c of open) this.finish(c.id, 'cancelled', null, { code: 'EMERGENCY_STOP', message: 'emergency stop; delivered actions may already have occurred' });
    this.clearPendingDialogue(userId);
    run(this.db,'DELETE FROM operator_dialogues WHERE user_id=?',userId);
    return devs.length;
  }

  removeDevice(userId: string, deviceId: string) {
    this.getDeviceRow(userId, deviceId);
    const open = all(this.db, "SELECT id FROM commands WHERE device_id = ? AND status IN ('pending','awaiting_approval','running')", deviceId);
    for (const c of open) this.finish(c.id, 'cancelled', null, { code: 'DEVICE_REMOVED', message: 'device was unpaired' });
    this.endLiveView(deviceId,'device_unpaired');
    run(this.db, "UPDATE devices SET status = 'revoked', paused = 1 WHERE id = ?", deviceId);
    this.connEvent(deviceId, 'unpaired');
    this.audit(userId, 'user', 'device.unpaired', null, deviceId);
    const conn = this.devices.get(deviceId);
    if (conn) {
      this.sendDevice(deviceId, { type: 'revoked' });
      conn.ws.close(4003, 'revoked');
      this.devices.delete(deviceId);
    }
    this.broadcast(userId, { type: 'device.removed', deviceId });
  }

  // ---- device socket --------------------------------------------------
  sendDevice(deviceId: string, m: ServerToDevice): boolean {
    const c = this.devices.get(deviceId);
    if (!c || c.ws.readyState !== 1) return false;
    try{
      c.ws.send(JSON.stringify(m));
      return true;
    }catch{
      try{c.ws.terminate();}catch{}
      return false;
    }
  }

  attachDevice(row: Row, ws: WebSocket, ip: string | null) {
    const existing = this.devices.get(row.id);
    if (existing){this.endLiveView(row.id,'device_reconnected');existing.ws.close(4000, 'replaced by a newer connection');}
    const conn: DeviceConn = { ws, deviceId: row.id, userId: row.user_id, lastMsg: Date.now(), ip, welcomed:false };
    this.devices.set(row.id, conn);
    run(this.db, 'UPDATE devices SET last_seen = ? WHERE id = ?', nowIso(), row.id);
    this.connEvent(row.id, 'connected', ip);
    this.audit(row.user_id, 'device', 'device.connected', null, row.id, ip);
    log('info', 'device connected', { deviceId: row.id });

    ws.on('message', (data) => {
      // Ignore traffic from a superseded socket after re-pair/reconnect.
      if (this.devices.get(row.id) !== conn) return;
      conn.lastMsg = Date.now();
      let msg: DeviceToServer;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      try {
        this.onDeviceMessage(conn, msg);
      } catch (e) {
        log('error', 'device message failed', { err: String(e) });
      }
    });
    ws.on('pong', () => {
      if (this.devices.get(row.id) === conn) conn.lastMsg = Date.now();
    });
    ws.on('close', () => {
      if (this.devices.get(row.id) === conn) {
        this.endLiveView(row.id,'device_disconnected',false);
        this.devices.delete(row.id);
        run(this.db, 'UPDATE devices SET last_seen = ? WHERE id = ?', nowIso(), row.id);
        this.connEvent(row.id, 'disconnected', ip);
        log('info', 'device disconnected', { deviceId: row.id });
        this.pushDevice(row.id);
      }
    });
  }

  private onDeviceMessage(conn: DeviceConn, msg: DeviceToServer) {
    const { deviceId, userId } = conn;
    if(!msg||typeof msg!=='object'||(!conn.welcomed&&msg.type!=='hello'))return;
    if(conn.welcomed&&msg.type==='hello')return;
    switch (msg.type) {
      case 'live_screen.ready':
      case 'live_screen.denied':
      case 'live_screen.ended':
      case 'live_screen.frame':
        if(conn.welcomed)this.onLiveDeviceMessage(conn,msg);
        break;
      case 'hello': {
        const r = one(this.db, 'SELECT * FROM devices WHERE id = ?', deviceId)!;
        const reported = (Array.isArray(msg.capabilities) ? msg.capabilities : []).filter((c) => ALL_CAPABILITIES.includes(c));
        const firstHello = !r.controller_config;
        const enabled = firstHello ? reported : parseJson<Capability[]>(r.capabilities_enabled, []);
        run(this.db, `UPDATE devices SET os = ?, os_version = ?, hostname = ?, controller_version = ?, capabilities_reported = ?,
          capabilities_enabled = ?, controller_config = ?, last_seen = ? WHERE id = ?`,
          String(msg.os ?? '').slice(0, 40), String(msg.osVersion ?? '').slice(0, 80), String(msg.hostname ?? '').slice(0, 80),
          String(msg.controllerVersion ?? '').slice(0, 20), JSON.stringify(reported), JSON.stringify(enabled),
          JSON.stringify(msg.config ?? {}), nowIso(), deviceId);
        if(!this.sendDevice(deviceId, { type: 'welcome', deviceId, paused: !!r.paused, enabledCapabilities: enabled }))return;
        conn.welcomed=true;
        this.pushDevice(deviceId);
        this.dispatchQueued(deviceId);
        break;
      }
      case 'heartbeat':
        if (msg.stats) runVolatile(this.db, 'UPDATE devices SET stats = ?, last_seen = ? WHERE id = ?', JSON.stringify(msg.stats).slice(0, 500), nowIso(), deviceId);
        break;
      case 'ack': {
        const c = one(this.db, 'SELECT status, dispatched_at, approved_at, requires_approval FROM commands WHERE id = ? AND device_id = ?', msg.commandId, deviceId);
        // A buggy or stale controller must not mark an unapproved task as
        // delivered: that would silently prevent its later dispatch.
        if (c && (c.status === 'pending' || c.status === 'running') &&
            c.dispatched_at && (!c.requires_approval || c.approved_at)) {
          run(this.db, "UPDATE commands SET delivered_at = COALESCE(delivered_at, ?) WHERE id = ? AND device_id = ?", nowIso(), msg.commandId, deviceId);
        }
        break;
      }
      case 'started': {
        const c = one(this.db, 'SELECT * FROM commands WHERE id = ? AND device_id = ?', msg.commandId, deviceId);
        if (c && c.status === 'pending' && c.dispatched_at &&
            (!c.requires_approval || c.approved_at)) {
          run(this.db, "UPDATE commands SET status = 'running', started_at = ?, delivered_at = COALESCE(delivered_at, ?) WHERE id = ?", nowIso(), nowIso(), c.id);
          this.pushCommand(c.id);
        }
        break;
      }
      case 'result': {
        const c = one(this.db, 'SELECT * FROM commands WHERE id = ? AND device_id = ?', msg.commandId, deviceId);
        // Always acknowledge so the controller can drop it from its outbox, even if we no longer accept it.
        this.sendDevice(deviceId, { type: 'result_ack', commandId: msg.commandId });
        if (!c) return;
        if (FINAL_STATUSES.includes(c.status)) {
          log('info', 'late result ignored', { commandId: c.id, status: c.status });
          return;
        }
        // The paired controller may only report a result for a command the
        // relay actually dispatched. In particular, it cannot bypass owner
        // approval by sending a fabricated result while approval is pending.
        if ((c.status !== 'pending' && c.status !== 'running') ||
            !c.dispatched_at || (c.requires_approval && !c.approved_at)) {
          log('warn', 'undispatched or unapproved controller result ignored',
            { commandId: c.id, status: c.status });
          this.audit(userId, 'system', 'command.result_rejected',
            { commandId: c.id, status: c.status }, deviceId);
          return;
        }
        let result = msg.result && typeof msg.result === 'object' ? { ...msg.result } : {};
        let screenshotId: string | null = null;
        const textOnly = c.action === 'screen.capture' && parseJson<Record<string,unknown>>(c.args,{}).textOnly===true;
        if (textOnly) {
          const monitor=parseJson<Record<string,unknown>>(c.args,{}).monitor;
          if(msg.ok && (result.ocrRead!==true || typeof result.text!=='string' ||
              result.text.length>6000 || result.monitor!==monitor || !!msg.screenshot)){
            this.finish(c.id,'failed',null,{code:'SCREEN_OCR_UNVERIFIABLE',message:'Text-only result did not match the reviewed monitor or data mode'});
            return;
          }
        }
        if (msg.ok && !textOnly && msg.screenshot?.dataBase64) {
          screenshotId = this.storeScreenshot(userId, deviceId, c.id, msg.screenshot);
          result = { ...result, screenshotId };
        }
        const json = JSON.stringify(result);
        const safeResult = json.length > 200_000 ? { truncated: true } : result;
        if (screenshotId) run(this.db, 'UPDATE commands SET screenshot_id = ? WHERE id = ?', screenshotId, c.id);
        // The relay is the final source of truth for result integrity.
        // Older Windows Controllers may send ok:true even though WhatsApp
        // returned unreadChats:null. That is *not* a successful unread check.
        // Check it here so already-installed clients cannot show green
        // "Completed" for a count that was never established.
        const countVerified = c.action !== 'whatsapp.check' ||
          (typeof result.unreadChats === 'number' && Number.isInteger(result.unreadChats) &&
           result.unreadChats >= 0 && result.unreadChats <= 999 &&
           (result.source === 'WhatsApp Desktop Unread filter' || result.source === 'window title'));
        // A successful OCR pass is NOT a complete unread scan. Older builds
        // marked 2 named rows "Completed" against a 10-chat badge. Require
        // explicit filter selection, numeric badge and exact full coverage.
        // Keep partial verified names in the result for an honest UI.
        const unreadNames = c.action === 'whatsapp.unread_senders' && Array.isArray(result.senders)
          ? result.senders : [];
        const cleanNames = unreadNames.every((s: unknown) =>
          typeof s === 'string' && !!s.trim() && s.length <= 100);
        const uniqueNames = cleanNames && new Set(unreadNames.map((s: string) => s.trim().toLocaleLowerCase())).size === unreadNames.length;
        const badge = result.totalUnreadChats;
        const badgeValid = typeof badge === 'number' && Number.isInteger(badge) && badge >= 0 && badge <= 999;
        // An explicitly read ZERO badge is independently conclusive even if
        // an older Controller doesn't report the newer coverage flag.
        const explicitZero = result.filterSelectedVerified === true &&
          result.unreadCountVerified === true && badge === 0 &&
          unreadNames.length === 0 && (result.source === 'Explicit WhatsApp Unread zero badge' || result.source === 'Explicit WhatsApp empty Unread-filter list');
        const fullUnread = cleanNames && uniqueNames && (explicitZero ||
          (result.filterSelectedVerified === true && result.unreadCountVerified === true &&
           result.allBadgeChatsMatched === true && badgeValid && unreadNames.length === badge &&
           (badge > 0 || result.scanStopped === 'explicit_empty')));
        const sendersVerified = c.action !== 'whatsapp.unread_senders' || fullUnread;
        const partialUnread = c.action === 'whatsapp.unread_senders' &&
          cleanNames && unreadNames.length > 0 && !fullUnread;
        const resultVerified = countVerified && sendersVerified;
        const success = msg.ok === true && resultVerified;
        const remaining = badgeValid ? Math.max(0, badge - unreadNames.length) : null;
        this.finish(c.id, success ? 'completed' : 'failed', safeResult, success ? null : {
          code: partialUnread ? 'PARTIAL_UNREAD_SCAN' : !resultVerified ? 'UNVERIFIABLE' : String(msg.error?.code ?? 'FAILED').slice(0, 40),
          message: !countVerified
            ? (typeof msg.error?.message==='string' && msg.error.message.trim()
              ? msg.error.message.slice(0,500)
              : 'Personal WhatsApp Desktop did not expose a verified unread count: unknown, NOT zero. Try an approved visible unread sender scan.')
            : partialUnread
              ? 'Only '+unreadNames.length+' unread chat name(s) verified'+(badgeValid?' out of '+badge:'; badge count unknown')+
                (remaining===null?'':'; '+remaining+' not verified')+'. Scan incomplete; see partial names below. Reason: '+
                String(result.scanStopped ?? 'unknown').slice(0,50)
              : !sendersVerified
                ? (typeof msg.error?.message==='string' && msg.error.message.trim()
                  ? msg.error.message.slice(0,500)
                  : 'Personal WhatsApp Desktop could not prove complete unread-chat coverage. Retry after checking version and OCR diagnostics.')
                : String(msg.error?.message ?? 'failed').slice(0, 500),
        }, typeof msg.durationMs === 'number' ? Math.round(msg.durationMs) : null);
        this.audit(userId, 'device', success ? 'command.completed' : 'command.failed', { commandId: c.id, action: c.action }, deviceId);
        break;
      }
    }
  }

  private storeScreenshot(userId: string, deviceId: string, commandId: string, s: { mime: string; dataBase64: string; width: number; height: number }) {
    const mime = s.mime === 'image/png' ? 'image/png' : 'image/jpeg';
    const buf = Buffer.from(s.dataBase64, 'base64');
    if (buf.length > 3 * 1024 * 1024) throw new Error('screenshot too large');
    const id = newId('s_');
    const file = `${id}.${mime === 'image/png' ? 'png' : 'jpg'}`;
    writeFileSync(join(this.screenshotDir, file), buf);
    const hours = this.getSettings(userId).screenshotRetentionHours;
    run(this.db, 'INSERT INTO screenshots (id, user_id, device_id, command_id, file_name, mime, width, height, bytes, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, userId, deviceId, commandId, file, mime, s.width | 0, s.height | 0, buf.length, nowIso(), addMs(hours * 3600_000));
    return id;
  }

  getScreenshot(userId: string, id: string) {
    const r = one(this.db, 'SELECT * FROM screenshots WHERE id = ? AND user_id = ?', id, userId);
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'screenshot not found or expired');
    return { path: join(this.screenshotDir, r.file_name), mime: r.mime as string };
  }
  listScreenshots(userId: string) {
    return all(this.db, 'SELECT id, device_id AS deviceId, command_id AS commandId, width, height, bytes, created_at AS createdAt, expires_at AS expiresAt FROM screenshots WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', userId);
  }
  deleteScreenshot(userId: string, id: string) {
    const r = one(this.db, 'SELECT * FROM screenshots WHERE id = ? AND user_id = ?', id, userId);
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'screenshot not found');
    try {
      unlinkSync(join(this.screenshotDir, r.file_name));
    } catch {}
    run(this.db, 'DELETE FROM screenshots WHERE id = ?', id);
    this.audit(userId, 'user', 'screenshot.deleted', { id });
  }

  // ---- commands -------------------------------------------------------
  pushCommand(id: string) {
    const r = one(this.db, 'SELECT * FROM commands WHERE id = ?', id);
    if (r) this.broadcast(r.user_id, { type: 'command.updated', command: toCommand(r) });
  }

  getCommand(userId: string, id: string): Command {
    const r = one(this.db, 'SELECT * FROM commands WHERE id = ? AND user_id = ?', id, userId);
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'command not found');
    return toCommand(r);
  }

  listCommands(userId: string, q: { limit?: number; status?: string; deviceId?: string; before?: string; automationRunId?: string }) {
    const where = ['user_id = ?'];
    const p: any[] = [userId];
    if (q.status) { where.push('status = ?'); p.push(q.status); }
    if (q.deviceId) { where.push('device_id = ?'); p.push(q.deviceId); }
    if (q.before) { where.push('created_at < ?'); p.push(q.before); }
    if (q.automationRunId) { where.push('automation_run_id = ?'); p.push(q.automationRunId); }
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    return all(this.db, `SELECT * FROM commands WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${limit}`, ...p).map(toCommand);
  }

  clearHistory(userId: string) {
    const n = run(this.db, "DELETE FROM commands WHERE user_id = ? AND status IN ('completed','failed','cancelled','timed_out')", userId).changes;
    this.audit(userId, 'user', 'history.cleared', { deleted: Number(n) });
    return Number(n);
  }

  /**
   * Create a command from free text (parsed by the deterministic engine) or a structured action.
   * Returns either a stored command or a conversational outcome (reply/clarify/unsupported).
   */
  createCommand(userId: string, input: {
    deviceId?: unknown; text?: unknown; action?: unknown; args?: unknown; source?: unknown; clientRequestId?: unknown; automationRunId?: string | null;
  }): { kind: 'command'; command: Command; duplicate: boolean } | Exclude<ParseResult, { kind: 'command' }> | { kind: 'clarify'; topic: string; normalized: string } {
    const source: CommandSource = (['text', 'voice', 'quick', 'automation', 'ui'] as const).includes(input.source as any) ? (input.source as CommandSource) : 'ui';
    const clientRequestId = typeof input.clientRequestId === 'string' && input.clientRequestId.length <= 64 ? input.clientRequestId : null;

    if (clientRequestId) {
      const dup = one(this.db, 'SELECT * FROM commands WHERE user_id = ? AND client_request_id = ?', userId, clientRequestId);
      if (dup) return { kind: 'command', command: toCommand(dup), duplicate: true };
    }

    let action: ActionName;
    let args: Record<string, unknown>;
    let text: string | null = null;
    if (typeof input.text === 'string') {
      text = input.text.trim().slice(0, 500);
      let parsed = parseCommand(text);
      let wasFollowup = false;
      const now = Date.now();
      const existing = this.readPendingDialogue(userId);
      if (existing && existing.expiresAt <= now) this.clearPendingDialogue(userId);
      // A follow-up is permitted only for interactive users, not unattended
      // automations. Every fully specified command still passes validation.
      // Explicit unrelated questions/greetings do not consume a pending
      // file/contact/folder answer; the assistant can respond and resume later.
      const aside = routeIntent(text, parsed, true) === 'chat';
      if (source !== 'automation' && existing && existing.expiresAt > now && !aside) {
        const contacts = this.getSettings(userId).whatsappContacts;
        const resolution = resolveDialogue(existing, text, contacts);
        if (resolution.handled) {
          wasFollowup = true;
          parsed = resolution.result;
          if (resolution.next) this.writePendingDialogue(userId, {
            ...resolution.next, expiresAt: now + 120_000,
          });
          else this.clearPendingDialogue(userId);
        } else {
          // A complete new request overrides the unfinished conversation.
          this.clearPendingDialogue(userId);
        }
      }
      if (parsed.kind !== 'command') {
        if (parsed.kind === 'clarify' && !wasFollowup && source !== 'automation') {
          const begun = beginDialogue(
            parsed.topic, text, this.getSettings(userId).whatsappContacts, now,
          );
          if (begun.clarification) return begun.clarification;
          if (begun.state) this.writePendingDialogue(userId, begun.state);
        }
        return parsed;
      }
      this.clearPendingDialogue(userId);
      action = parsed.action;
      args = parsed.args;
    } else if (typeof input.action === 'string') {
      if (source !== 'automation') this.clearPendingDialogue(userId);
      action = input.action as ActionName;
      args = (input.args as Record<string, unknown>) ?? {};
    } else {
      throw new HttpError(400, 'BAD_REQUEST', 'text or action is required');
    }

    const v = validateCommand(action, args);
    if (!v.ok) throw new HttpError(400, 'INVALID_COMMAND', v.error);
    args = v.args;
    const def = ACTIONS[action];
    const settings = this.getSettings(userId);

    if (action === 'whatsapp.compose') {
      // Native Personal WhatsApp Desktop searches the contact by its exact
      // displayed chat name; requiring a separately saved phone number here
      // wrongly blocked ordinary conversations ("Ali ko reply likho").
      // No browser or phone deep-link is used by the Windows Controller.
      const wanted = String(args.contact).trim().toLowerCase();
      const saved = settings.whatsappContacts.find((c) => c.name.toLowerCase() === wanted);
      args = { contact: saved?.name ?? String(args.contact).trim(), message: args.message };
    }

    // relay-only action
    if (action === 'command.cancel') {
      const target = one(this.db, "SELECT id FROM commands WHERE user_id = ? AND status IN ('pending','awaiting_approval','running') ORDER BY created_at DESC LIMIT 1", userId);
      if (target) this.cancelCommand(userId, target.id, 'cancelled by voice/text command');
      const id = newId('c_');
      const now = nowIso();
      run(this.db, `INSERT INTO commands (id, user_id, device_id, client_request_id, source, input_text, action, args, requires_approval, status, timeout_ms, created_at, finished_at, duration_ms, result, automation_run_id)
        VALUES (?,?,?,?,?,?,?,?,0,'completed',?,?,?,0,?,?)`, id, userId, null, clientRequestId, source, text, action, '{}', def.timeoutMs, now, now,
        JSON.stringify({ cancelled: target ? 1 : 0, targetId: target?.id ?? null }), input.automationRunId ?? null);
      this.pushCommand(id);
      return { kind: 'command', command: this.getCommand(userId, id), duplicate: false };
    }

    // pick device
    let deviceRow: Row | undefined;
    if (typeof input.deviceId === 'string' && input.deviceId) deviceRow = this.getDeviceRow(userId, input.deviceId);
    else {
      const devs = all(this.db, "SELECT * FROM devices WHERE user_id = ? AND status = 'paired' ORDER BY created_at", userId);
      deviceRow = devs.find((d) => this.isOnline(d.id)) ?? devs[0];
    }
    if (!deviceRow) throw new HttpError(409, 'NO_DEVICE', 'no paired device');

    const enabled = parseJson<Capability[]>(deviceRow.capabilities_enabled, []);
    const id = newId('c_');
    const now = nowIso();
    // Separate explicit consent. Legacy per-action false flags cannot grant
    // new read access; unattended automations still require individual approval.
    const trustedUnread=action==='whatsapp.unread_senders' && settings.whatsappUnreadTrusted===true &&
      source!=='automation' && !input.automationRunId;
    const needsApproval = !trustedUnread && requiresApproval(action, settings.approvalRequired);
    let status: CommandStatus = needsApproval ? 'awaiting_approval' : 'pending';
    let error: { code: string; message: string } | null = null;
    if (deviceRow.paused) {
      status = 'failed';
      error = { code: 'PAUSED', message: 'controller is paused (emergency stop)' };
    } else if (def.capability && deviceRow.controller_config && !enabled.includes(def.capability)) {
      status = 'failed';
      error = { code: 'CAPABILITY_DISABLED', message: `${def.capability} is disabled for this device` };
    }
    run(this.db, `INSERT INTO commands (id, user_id, device_id, client_request_id, source, input_text, action, args, requires_approval, status, timeout_ms, created_at, finished_at, error_code, error_message, automation_run_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, userId, deviceRow.id, clientRequestId, source, text, action, JSON.stringify(args), needsApproval ? 1 : 0,
      status, def.timeoutMs, now, error ? now : null, error?.code ?? null, error?.message ?? null, input.automationRunId ?? null);
    this.audit(userId, 'user', 'command.created', { commandId: id, action, source, status }, deviceRow.id);

    if (status === 'awaiting_approval') {
      run(this.db, 'INSERT INTO command_approvals (id, command_id, user_id, requested_at, expires_at, summary) VALUES (?,?,?,?,?,?)',
        newId('ap_'), id, userId, now, addMs(this.config.approvalTtlMs), ackMessage(action, args).en);
    }
    this.pushCommand(id);
    if (status === 'pending') this.dispatchQueued(deviceRow.id);
    return { kind: 'command', command: this.getCommand(userId, id), duplicate: false };
  }

  decide(userId: string, commandId: string, approve: boolean) {
    const c = one(this.db, 'SELECT * FROM commands WHERE id = ? AND user_id = ?', commandId, userId);
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'command not found');
    if (c.status !== 'awaiting_approval') throw new HttpError(409, 'NOT_AWAITING', `command is ${c.status}`);
    // Check the actual approval expiry at decision time, not only in the
    // once-per-second sweeper. Expired approvals never become executable.
    const approval = one(this.db, 'SELECT expires_at FROM command_approvals WHERE command_id = ? AND decided_at IS NULL', commandId);
    if (!approval || Date.parse(approval.expires_at) <= Date.now()) {
      this.finish(commandId, 'timed_out', null,
        { code: 'APPROVAL_EXPIRED', message: 'Approval expired. Please request the action again.' });
      throw new HttpError(409, 'APPROVAL_EXPIRED', 'Approval expired. Please request the action again.');
    }
    const now = nowIso();
    run(this.db, "UPDATE command_approvals SET decided_at = ?, decision = ? WHERE command_id = ? AND decided_at IS NULL", now, approve ? 'approved' : 'rejected', commandId);
    this.audit(userId, 'user', approve ? 'command.approved' : 'command.rejected', { commandId, action: c.action }, c.device_id);
    if (approve) {
      run(this.db, "UPDATE commands SET status = 'pending', approved_at = ? WHERE id = ?", now, commandId);
      this.pushCommand(commandId);
      if (c.device_id) this.dispatchQueued(c.device_id);
    } else {
      this.finish(commandId, 'cancelled', null, { code: 'REJECTED', message: 'rejected by user' });
    }
    return this.getCommand(userId, commandId);
  }

  cancelCommand(userId: string, commandId: string, reason = 'cancelled by user') {
    const c = one(this.db, 'SELECT * FROM commands WHERE id = ? AND user_id = ?', commandId, userId);
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'command not found');
    if (FINAL_STATUSES.includes(c.status)) return toCommand(c);
    this.finish(commandId, 'cancelled', null, { code: 'CANCELLED', message: reason });
    this.audit(userId, 'user', 'command.cancelled', { commandId }, c.device_id);
    return this.getCommand(userId, commandId);
  }

  listApprovals(userId: string) {
    return all(this.db, "SELECT * FROM commands WHERE user_id = ? AND status = 'awaiting_approval' ORDER BY created_at DESC", userId).map(toCommand);
  }

  private finish(id: string, status: CommandStatus, result: Record<string, unknown> | null, error: { code: string; message: string } | null, durationMs: number | null = null) {
    const c = one(this.db, 'SELECT * FROM commands WHERE id = ?', id);
    if (!c || FINAL_STATUSES.includes(c.status)) return;
    const now = nowIso();
    const dur = durationMs ?? (c.started_at ? Date.now() - Date.parse(c.started_at) : null);
    run(this.db, 'UPDATE commands SET status = ?, finished_at = ?, duration_ms = ?, result = COALESCE(?, result), error_code = ?, error_message = ? WHERE id = ?',
      status, now, dur, result ? JSON.stringify(result) : null, error?.code ?? null, error?.message ?? null, id);
    if (c.status === 'awaiting_approval' && status !== 'completed') {
      run(this.db, "UPDATE command_approvals SET decided_at = COALESCE(decided_at, ?), decision = COALESCE(decision, ?) WHERE command_id = ?", now, status === 'timed_out' ? 'expired' : 'rejected', id);
    }
    if ((status === 'cancelled' || status === 'timed_out') && c.device_id && c.dispatched_at) this.sendDevice(c.device_id, { type: 'cancel', commandId: id });
    this.pushCommand(id);
  }

  private dispatchQueued(deviceId: string) {
    if (!this.isOnline(deviceId)) return;
    const dev = one(this.db, 'SELECT paused,capabilities_enabled,capabilities_reported,controller_version FROM devices WHERE id = ? AND status=\'paired\'', deviceId);
    if (!dev || dev.paused) return;
    const enabled=parseJson<Capability[]>(dev.capabilities_enabled,[]);
    const reported=parseJson<Capability[]>(dev.capabilities_reported,[]);
    const rows = all(this.db, "SELECT * FROM commands WHERE device_id = ? AND status = 'pending' AND dispatched_at IS NULL AND delivered_at IS NULL ORDER BY created_at LIMIT 20", deviceId);
    for (const r of rows) {
      const cap=ACTIONS[r.action as ActionName]?.capability;
      if(cap&&(!enabled.includes(cap)||!reported.includes(cap))){
        this.finish(r.id,'cancelled',null,{code:'CAPABILITY_DISABLED',message:'Required device permission unavailable at dispatch'});
        continue;
      }
      if(r.requires_approval&&!r.approved_at)continue;
      const args=parseJson<Record<string,unknown>>(r.args,{});
      // Legacy controllers silently ignore these new fields. Never dispatch
      // a request with altered target semantics to an older controller.
      const version=String(dev.controller_version??'').match(/^(\d+)\.(\d+)\.(\d+)$/);
      const supported=!!version&&(Number(version[1])>1||(Number(version[1])===1&&Number(version[2])>=9));
      if(!supported&&((r.action==='screen.capture'&&(Number(args.monitor??1)>1||args.textOnly===true))||
        (r.action==='chatgpt.download_visible'&&args.assetFolder!==undefined))){
        this.finish(r.id,'cancelled',null,{code:'CONTROLLER_UPDATE_REQUIRED',message:'Update to HUKM v1.9.0 or later before using this target-specific action'});
        continue;
      }
      // Persist dispatch intent BEFORE handing input to the socket. A crash
      // between persistence and send sacrifices availability, not at-most-once safety.
      run(this.db,'UPDATE commands SET dispatched_at=? WHERE id=?',nowIso(),r.id);
      const ok = this.sendDevice(deviceId, {
        type: 'command',
        command: { id: r.id, action: r.action, args: parseJson(r.args, {}), createdAt: r.created_at, timeoutMs: r.timeout_ms },
      });
      if(!ok)this.finish(r.id,'cancelled',null,{code:'INTERRUPTED_UNVERIFIED',message:'Socket delivery uncertain; inspect Windows manually, no automatic replay.'});
    }
  }

  /** Periodic housekeeping: timeouts, queue expiry, approval expiry, heartbeats, screenshot retention. */
  sweep() {
    const now = Date.now();
    const open = all(this.db, "SELECT * FROM commands WHERE status IN ('pending','awaiting_approval','running')");
    for (const c of open) {
      if (c.status === 'awaiting_approval') {
        if (now - Date.parse(c.created_at) > this.config.approvalTtlMs) this.finish(c.id, 'timed_out', null, { code: 'APPROVAL_EXPIRED', message: 'approval was not given in time' });
        continue;
      }
      const startRef = c.dispatched_at ? Date.parse(c.dispatched_at) : null;
      if (startRef !== null) {
        if (now - startRef > c.timeout_ms) this.finish(c.id, 'timed_out', null, { code: 'TIMEOUT', message: `no result within ${Math.round(c.timeout_ms / 1000)}s` });
      } else {
        const queuedSince = Date.parse(c.approved_at ?? c.created_at);
        if (now - queuedSince > this.config.queueTtlMs) this.finish(c.id, 'timed_out', null, { code: 'DEVICE_OFFLINE', message: 'device stayed offline' });
      }
    }
    // Expire live preview independently of viewer/device activity.
    for(const [id,s] of this.liveViews){if(now>=s.expiresAt)this.endLiveView(id,'time_limit');}
    // heartbeat watchdog
    for (const [id, conn] of this.devices) {
      if (now - conn.lastMsg > this.config.heartbeatTimeoutMs) {
        log('warn', 'device heartbeat lost', { deviceId: id });
        conn.ws.terminate();
      } else if (now - conn.lastMsg > this.config.heartbeatTimeoutMs / 3 && conn.ws.readyState === 1) {
        conn.ws.ping();
      }
    }
    // Optional daily schedules; disabled by default. Single-process and
    // persisted last_scheduled_day prevent duplicate launches on reconnect.
    if (now - this.lastScheduleTick >= 15_000) {
      this.lastScheduleTick = now;
      this.runDueSchedules(new Date(now));
    }
    // screenshot retention (cheap; indexed)
    if (now - this.lastMaintenance >= 60_000) {
      this.lastMaintenance = now;
      const expired = all(this.db, 'SELECT id, file_name FROM screenshots WHERE expires_at < ?', nowIso());
      for (const s of expired) {
        try {
          unlinkSync(join(this.screenshotDir, s.file_name));
        } catch {}
        run(this.db, 'DELETE FROM screenshots WHERE id = ?', s.id);
      }
      // command history & audit retention per user
      for (const u of all(this.db, 'SELECT id FROM users')) {
        const days = this.getSettings(u.id).historyRetentionDays;
        const cutoff = new Date(now - days * 86400_000).toISOString();
        run(this.db, "DELETE FROM commands WHERE user_id = ? AND created_at < ? AND status IN ('completed','failed','cancelled','timed_out')", u.id, cutoff);
        run(this.db, 'DELETE FROM audit_logs WHERE user_id = ? AND at < ?', u.id, cutoff);
      }
      run(this.db, 'DELETE FROM sessions WHERE expires_at < ?', nowIso());
      run(this.db, 'DELETE FROM pairing_codes WHERE expires_at < ? AND used_at IS NULL', new Date(now - 86400_000).toISOString());
    }
  }

  /** Execute only schedules matching this exact local minute. Never catch up
   * missed runs after the free Render service has slept or restarted. */
  runDueSchedules(at: Date) {
    const rows = all(this.db, `SELECT id, user_id, device_id, schedule_time, schedule_timezone,
      last_scheduled_day, last_run_status FROM automations
      WHERE enabled = 1 AND schedule_enabled = 1 AND schedule_time IS NOT NULL`);
    for (const row of rows) {
      if (row.last_run_status === 'running') continue;
      try {
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: row.schedule_timezone ?? 'Asia/Kuala_Lumpur',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).formatToParts(at);
        const field = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
        const day = [field('year'), field('month'), field('day')].join('-');
        const minute = field('hour') + ':' + field('minute');
        if (minute !== row.schedule_time || row.last_scheduled_day === day) continue;
        // Claim the daily slot in SQLite before dispatch. A new tick or
        // reconnect cannot duplicate the action for the same local day.
        const claimed = run(this.db, `UPDATE automations SET last_scheduled_day = ?
          WHERE id = ? AND (last_scheduled_day IS NULL OR last_scheduled_day != ?)`,
          day, row.id, day).changes;
        if (!claimed) continue;
        this.runAutomation(row.user_id, row.id, row.device_id ?? undefined, 'system');
      } catch (e) {
        log('warn', 'scheduled automation could not start', { id: row.id, error: String(e) });
        this.audit(row.user_id, 'system', 'automation.schedule.failed', { id: row.id });
      }
    }
  }

  // ---- automations ----------------------------------------------------
  listAutomations(userId: string) {
    return all(this.db, 'SELECT * FROM automations WHERE user_id = ? ORDER BY created_at', userId).map(toAutomation);
  }
  saveAutomation(userId: string, id: string | null, body: Record<string, unknown>) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 300) : '';
    const steps = Array.isArray(body.steps) ? body.steps.filter((s): s is string => typeof s === 'string').map((s) => s.trim().slice(0, 300)).filter(Boolean) : null;
    const enabled = body.enabled === undefined ? null : !!body.enabled;
    const now = nowIso();
    if (!id) {
      if (!name || !steps?.length) throw new HttpError(400, 'BAD_REQUEST', 'name and at least one step are required');
      if (steps.length > 15) throw new HttpError(400, 'BAD_REQUEST', 'max 15 steps');
      for (const s of steps) {
        const p = parseCommand(s);
        if (p.kind !== 'command') throw new HttpError(400, 'BAD_STEP', `step not understood: "${s}"`);
        if (p.action === 'whatsapp.compose' || p.action === 'system.lock' || p.action === 'whatsapp.read_visible') throw new HttpError(400, 'BAD_STEP', `step not allowed in automations: "${s}"`);
      }
      const schedule = parseDailySchedule(body.schedule);
      id = newId('au_');
      run(this.db, 'INSERT INTO automations (id, user_id, name, description, steps, enabled, created_at, updated_at, schedule_enabled, schedule_time, schedule_timezone) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        id, userId, name, description, JSON.stringify(steps), enabled === false ? 0 : 1, now, now,
        schedule.enabled ? 1 : 0, schedule.time, schedule.timezone);
    } else {
      const cur = one(this.db, 'SELECT * FROM automations WHERE id = ? AND user_id = ?', id, userId);
      if (!cur) throw new HttpError(404, 'NOT_FOUND', 'automation not found');
      if (steps) {
        if (!steps.length || steps.length > 15) throw new HttpError(400, 'BAD_REQUEST', '1–15 steps required');
        for (const s of steps) {
          const p = parseCommand(s);
          if (p.kind !== 'command') throw new HttpError(400, 'BAD_STEP', `step not understood: "${s}"`);
          if (p.action === 'whatsapp.compose' || p.action === 'system.lock' || p.action === 'whatsapp.read_visible') throw new HttpError(400, 'BAD_STEP', `step not allowed in automations: "${s}"`);
        }
      }
      const schedule = parseDailySchedule(body.schedule, {
        enabled: !!cur.schedule_enabled,
        time: cur.schedule_time ?? null,
        timezone: cur.schedule_timezone ?? 'Asia/Kuala_Lumpur',
      });
      run(this.db, 'UPDATE automations SET name = ?, description = ?, steps = ?, enabled = ?, updated_at = ? WHERE id = ?',
        name || cur.name, body.description !== undefined ? description : cur.description, steps ? JSON.stringify(steps) : cur.steps,
        enabled === null ? cur.enabled : enabled ? 1 : 0, now, id);
      if (body.schedule !== undefined) {
        run(this.db, 'UPDATE automations SET schedule_enabled = ?, schedule_time = ?, schedule_timezone = ?, last_scheduled_day = NULL WHERE id = ?',
          schedule.enabled ? 1 : 0, schedule.time, schedule.timezone, id);
      }
    }
    this.audit(userId, 'user', 'automation.saved', { id, name });
    const a = toAutomation(one(this.db, 'SELECT * FROM automations WHERE id = ?', id)!);
    this.broadcast(userId, { type: 'automation.updated', automation: a });
    return a;
  }
  deleteAutomation(userId: string, id: string) {
    const n = run(this.db, 'DELETE FROM automations WHERE id = ? AND user_id = ?', id, userId).changes;
    if (!n) throw new HttpError(404, 'NOT_FOUND', 'automation not found');
    this.audit(userId, 'user', 'automation.deleted', { id });
  }

  /** Runs steps sequentially; each step waits for its command to finish. Stops on the first failure. */
  runAutomation(userId: string, id: string, deviceId?: string, initiator: 'user' | 'system' = 'user') {
    const r = one(this.db, 'SELECT * FROM automations WHERE id = ? AND user_id = ?', id, userId);
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'automation not found');
    if (!r.enabled) throw new HttpError(409, 'DISABLED', 'automation is disabled');
    if (r.last_run_status === 'running') throw new HttpError(409, 'ALREADY_RUNNING', 'automation is already running');
    const steps = parseJson<string[]>(r.steps, []);
    const runId = newId('run_');
    run(this.db, "UPDATE automations SET last_run_at = ?, last_run_status = 'running' WHERE id = ?", nowIso(), id);
    this.audit(userId, initiator, 'automation.run', { id, runId, scheduled: initiator === 'system' });
    const setStatus = (s: string) => {
      run(this.db, 'UPDATE automations SET last_run_status = ? WHERE id = ?', s, id);
      const a = one(this.db, 'SELECT * FROM automations WHERE id = ?', id);
      if (a) this.broadcast(userId, { type: 'automation.updated', automation: toAutomation(a) });
    };
    (async () => {
      for (const step of steps) {
        let out;
        try {
          out = this.createCommand(userId, { text: step, source: 'automation', deviceId, automationRunId: runId });
        } catch (e) {
          setStatus('failed');
          return;
        }
        if (out.kind !== 'command') { setStatus('failed'); return; }
        const cmdId = out.command.id;
        const final = await this.waitFinal(cmdId, 5 * 60_000);
        if (final !== 'completed') { setStatus(final ?? 'failed'); return; }
      }
      setStatus('completed');
    })().catch((e) => {
      log('error', 'automation failed', { err: String(e) });
      setStatus('failed');
    });
    return { runId };
  }

  private waitFinal(id: string, maxMs: number): Promise<CommandStatus | null> {
    const start = Date.now();
    return new Promise((resolve) => {
      const t = setInterval(() => {
        const r = one(this.db, 'SELECT status FROM commands WHERE id = ?', id);
        if (!r) { clearInterval(t); resolve(null); return; }
        if (FINAL_STATUSES.includes(r.status)) { clearInterval(t); resolve(r.status); return; }
        if (Date.now() - start > maxMs) { clearInterval(t); resolve('timed_out'); }
      }, 300);
    });
  }
}

export function sanitizeSettings(s: UserSettings): UserSettings {
  const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === 'number' && isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);
  const approval: Partial<Record<ActionName, boolean>> = {};
  for (const [k, v] of Object.entries(s.approvalRequired ?? {})) if (k in ACTIONS) approval[k as ActionName] = !!v;
  const contacts = (Array.isArray(s.whatsappContacts) ? s.whatsappContacts : [])
    .filter((c) => c && typeof c.name === 'string' && typeof c.phone === 'string')
    .map((c) => ({ name: c.name.trim().slice(0, 60), phone: c.phone.replace(/\D/g, '').slice(0, 15) }))
    .filter((c) => c.name && c.phone.length >= 8)
    .slice(0, 200);
  return {
    theme: s.theme === 'light' ? 'light' : 'dark',
    responseLang: (['roman', 'ur', 'en'] as const).includes(s.responseLang) ? s.responseLang : 'roman',
    recognitionLang: typeof s.recognitionLang === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(s.recognitionLang) ? s.recognitionLang : 'ur-PK',
    voiceURI: typeof s.voiceURI === 'string' ? s.voiceURI.slice(0, 200) : null,
    speechRate: clamp(s.speechRate, 0.5, 2, 1),
    speechVolume: clamp(s.speechVolume, 0, 1, 1),
    speechMuted: !!s.speechMuted,
    reducedMotion: (['system', 'on', 'off'] as const).includes(s.reducedMotion) ? s.reducedMotion : 'system',
    audioReactiveOrb: !!s.audioReactiveOrb,
    notifications: { toasts: s.notifications?.toasts !== false, browser: !!s.notifications?.browser },
    approvalRequired: approval,
    whatsappUnreadTrusted: s.whatsappUnreadTrusted===true,
    screenshotRetentionHours: clamp(s.screenshotRetentionHours, 1, 24 * 30, 24),
    historyRetentionDays: clamp(s.historyRetentionDays, 1, 3650, 90),
    whatsappContacts: contacts,
  };
}
