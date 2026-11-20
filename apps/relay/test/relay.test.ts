import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startRelay, type RelayHandle } from '../src/server';

let h: RelayHandle;
let dir: string;
let cookie = '';
const SETUP = 'TEST-CODE';

async function api(method: string, path: string, body?: unknown, opts: { cookie?: string | null; noClientHeader?: boolean } = {}) {
  const headers: Record<string, string> = {};
  const ck = opts.cookie === undefined ? cookie : opts.cookie;
  if (ck) headers.cookie = ck;
  if (!opts.noClientHeader) headers['x-hukm-client'] = 'web';
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(h.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = r.headers.get('set-cookie');
  if (setCookie && opts.cookie === undefined) cookie = setCookie.split(';')[0];
  const text = await r.text();
  return { status: r.status, data: text ? JSON.parse(text) : null };
}

class FakeDevice {
  ws!: WebSocket;
  inbox: any[] = [];
  auto: ((cmd: any) => any) | null = null;
  constructor(public token: string) {}
  connect(caps = ['system', 'apps', 'folders', 'files', 'browser', 'youtube', 'screen', 'whatsapp']) {
    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(h.url.replace('http', 'ws') + '/ws/device', { headers: { authorization: `Bearer ${this.token}` } });
      this.ws.on('error', reject);
      this.ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        this.inbox.push(m);
        if (m.type === 'welcome') resolve();
        if (m.type === 'command' && this.auto) {
          this.send({ type: 'ack', commandId: m.command.id });
          this.send({ type: 'started', commandId: m.command.id });
          const out = this.auto(m.command);
          if (out) this.send({ type: 'result', commandId: m.command.id, durationMs: 12, ...out });
        }
      });
      this.ws.on('open', () =>
        this.send({ type: 'hello', controllerVersion: '1.0.0', os: 'Windows', osVersion: '11', hostname: 'TEST-PC', capabilities: caps,
          config: { allowedDirs: [], apps: ['chrome'], screenCapture: true, browser: 'default' } }));
    });
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  waitFor(pred: (m: any) => boolean, ms = 3000) {
    return new Promise<any>((resolve, reject) => {
      const start = Date.now();
      const t = setInterval(() => {
        const m = this.inbox.find(pred);
        if (m) { clearInterval(t); resolve(m); }
        else if (Date.now() - start > ms) { clearInterval(t); reject(new Error('timeout waiting for device message')); }
      }, 20);
    });
  }
  close() {
    return new Promise<void>((r) => { this.ws.once('close', () => r()); this.ws.close(); });
  }
}

async function waitStatus(id: string, statuses: string[], ms = 4000) {
  const start = Date.now();
  for (;;) {
    const r = await api('GET', `/api/commands/${id}`);
    if (statuses.includes(r.data.status)) return r.data;
    if (Date.now() - start > ms) throw new Error(`status stayed ${r.data.status}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

let deviceToken = '';
let deviceId = '';
let device: FakeDevice;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hukm-'));
  h = await startRelay({ port: 0, host: '127.0.0.1', dataDir: dir, publicDir: join(dir, 'none'), setupCode: SETUP, queueTtlMs: 1500, approvalTtlMs: 60_000, heartbeatTimeoutMs: 60_000 });
});
afterAll(async () => {
  await h.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('authentication', () => {
  it('requires setup with the console setup code', async () => {
    expect((await api('GET', '/api/auth/status')).data.setupRequired).toBe(true);
    const bad = await api('POST', '/api/auth/setup', { email: 'h@x.pk', password: 'longpassword1', setupCode: 'WRONG' });
    expect(bad.status).toBe(403);
    const ok = await api('POST', '/api/auth/setup', { email: 'h@x.pk', name: 'Hassan', password: 'longpassword1', setupCode: SETUP });
    expect(ok.status).toBe(200);
    expect(cookie).toMatch(/^hukm_session=/);
    expect((await api('POST', '/api/auth/setup', { email: 'z@x.pk', password: 'longpassword1', setupCode: SETUP })).status).toBe(409);
  });
  it('rejects unauthenticated access', async () => {
    expect((await api('GET', '/api/devices', undefined, { cookie: null })).status).toBe(401);
  });
  it('rejects wrong password and accepts the right one', async () => {
    expect((await api('POST', '/api/auth/login', { email: 'h@x.pk', password: 'nope-nope-nope' }, { cookie: null })).status).toBe(401);
    const r = await api('POST', '/api/auth/login', { email: 'h@x.pk', password: 'longpassword1' });
    expect(r.status).toBe(200);
  });
  it('requires the client header on mutations (CSRF)', async () => {
    expect((await api('POST', '/api/devices/pairing-code', {}, { noClientHeader: true })).status).toBe(403);
  });
});

describe('device pairing', () => {
  it('pairs with an expiring single-use code', async () => {
    const pc = await api('POST', '/api/devices/pairing-code', { name: 'HUKM-Laptop' });
    expect(pc.data.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const claim = await api('POST', '/api/pair/claim', { code: pc.data.code.toLowerCase(), hostname: 'TEST-PC', os: 'Windows' }, { cookie: null });
    expect(claim.status).toBe(200);
    deviceToken = claim.data.deviceToken;
    deviceId = claim.data.deviceId;
    const again = await api('POST', '/api/pair/claim', { code: pc.data.code }, { cookie: null });
    expect(again.status).toBe(403);
  });
  it('rejects a bad device token', async () => {
    const ws = new WebSocket(h.url.replace('http', 'ws') + '/ws/device', { headers: { authorization: `Bearer ${deviceId}.wrong` } });
    const code = await new Promise((r) => ws.on('unexpected-response', (_q, res) => r(res.statusCode)));
    expect(code).toBe(401);
  });
  it('shows the device online after connecting', async () => {
    device = new FakeDevice(deviceToken);
    await device.connect();
    const devs = (await api('GET', '/api/devices')).data;
    expect(devs).toHaveLength(1);
    expect(devs[0]).toMatchObject({ name: 'HUKM-Laptop', online: true, hostname: 'TEST-PC' });
    expect(devs[0].capabilitiesEnabled).toContain('folders');
  });
});

describe('commands', () => {
  it('runs "Downloads folder kholo" end to end and records history', async () => {
    device.auto = (cmd) => ({ ok: true, result: { folder: cmd.args.folder, path: 'C:\\Users\\h\\Downloads' } });
    const r = await api('POST', '/api/commands', { text: 'Downloads folder kholo', source: 'text', clientRequestId: 'req-1' });
    expect(r.data.kind).toBe('command');
    expect(r.data.command).toMatchObject({ action: 'folder.open', args: { folder: 'downloads' } });
    const done = await waitStatus(r.data.command.id, ['completed']);
    expect(done.result.path).toContain('Downloads');
    expect(done.durationMs).toBe(12);
    const hist = (await api('GET', '/api/commands')).data;
    expect(hist[0].id).toBe(r.data.command.id);
  });
  it('does not create duplicates for the same clientRequestId', async () => {
    const r = await api('POST', '/api/commands', { text: 'Downloads folder kholo', clientRequestId: 'req-1' });
    expect(r.data.duplicate).toBe(true);
    expect(device.inbox.filter((m) => m.type === 'command' && m.command.id === r.data.command.id)).toHaveLength(1);
  });
  it('returns a helpful message for unsupported text without contacting the device', async () => {
    const before = device.inbox.length;
    const r = await api('POST', '/api/commands', { text: 'aaj mausam kaisa hai' });
    expect(r.data.kind).toBe('unsupported');
    expect(device.inbox.length).toBe(before);
  });
  it('rejects invalid structured commands (unauthorized actions)', async () => {
    expect((await api('POST', '/api/commands', { action: 'shell.exec', args: { cmd: 'format c:' } })).status).toBe(400);
    expect((await api('POST', '/api/commands', { action: 'app.open', args: { app: 'cmd' } })).status).toBe(400);
    expect((await api('POST', '/api/commands', { action: 'web.open', args: { url: 'file:///C:/' } })).status).toBe(400);
  });
  it('reports device failures honestly', async () => {
    device.auto = () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'no matching file' } });
    const r = await api('POST', '/api/commands', { text: 'invoice pdf kholo' });
    const done = await waitStatus(r.data.command.id, ['failed']);
    expect(done.error).toEqual({ code: 'NOT_FOUND', message: 'no matching file' });
  });
  it('holds sensitive commands for approval, then executes after approval', async () => {
    device.auto = () => ({ ok: true, result: {}, screenshot: { mime: 'image/jpeg', dataBase64: Buffer.from('fakejpeg').toString('base64'), width: 10, height: 10 } });
    const r = await api('POST', '/api/commands', { text: 'screen dikhao' });
    expect(r.data.command.status).toBe('awaiting_approval');
    await new Promise((x) => setTimeout(x, 150));
    expect(device.inbox.some((m) => m.type === 'command' && m.command.id === r.data.command.id)).toBe(false);
    expect((await api('GET', '/api/approvals')).data).toHaveLength(1);
    await api('POST', `/api/commands/${r.data.command.id}/approve`);
    const done = await waitStatus(r.data.command.id, ['completed']);
    expect(done.screenshotId).toBeTruthy();
    const img = await fetch(`${h.url}/api/screenshots/${done.screenshotId}`, { headers: { cookie } });
    expect(img.status).toBe(200);
    expect(Buffer.from(await img.arrayBuffer()).toString()).toBe('fakejpeg');
    const noAuth = await fetch(`${h.url}/api/screenshots/${done.screenshotId}`);
    expect(noAuth.status).toBe(401);
  });
  it('rejected approvals are cancelled and never dispatched', async () => {
    const r = await api('POST', '/api/commands', { text: 'laptop lock karo' });
    await api('POST', `/api/commands/${r.data.command.id}/reject`);
    const c = (await api('GET', `/api/commands/${r.data.command.id}`)).data;
    expect(c.status).toBe('cancelled');
    expect(device.inbox.some((m) => m.type === 'command' && m.command.id === r.data.command.id)).toBe(false);
  });
  it('asks which WhatsApp without executing anything until the user chooses', async () => {
    device.auto = () => ({ ok: true, result: { opened: 'desktop' } });
    const before = device.inbox.filter((m) => m.type === 'command').length;
    const asked = await api('POST', '/api/commands', { text: 'WhatsApp kholo', source: 'voice' });
    expect(asked.data).toMatchObject({ kind: 'clarify', topic: 'whatsapp-choice' });
    expect(device.inbox.filter((m) => m.type === 'command')).toHaveLength(before);
    const vague = await api('POST', '/api/commands', { text: 'Haan', source: 'voice' });
    expect(vague.data).toMatchObject({ kind: 'clarify', topic: 'whatsapp-choice' });
    expect(device.inbox.filter((m) => m.type === 'command')).toHaveLength(before);
    const answer = await api('POST', '/api/commands', { text: 'Desktop wala', source: 'voice' });
    expect(answer.data).toMatchObject({ kind: 'command', command: { action: 'whatsapp.open', args: { mode: 'desktop' } } });
    await waitStatus(answer.data.command.id, ['completed']);
    expect(device.inbox.filter((m) => m.type === 'command')).toHaveLength(before + 1);
  });

  it('understands WhatsApp Web follow-up and independent new commands', async () => {
    device.auto = () => ({ ok: true, result: {} });
    expect((await api('POST', '/api/commands', { text: 'WhatsApp kholo' })).data.kind).toBe('clarify');
    const web = await api('POST', '/api/commands', { text: 'Web wala' });
    expect(web.data).toMatchObject({ kind: 'command', command: { action: 'web.open', args: { url: 'https://web.whatsapp.com/' } } });
    await waitStatus(web.data.command.id, ['completed']);
    expect((await api('POST', '/api/commands', { text: 'WhatsApp kholo' })).data.kind).toBe('clarify');
    const changed = await api('POST', '/api/commands', { text: 'Notepad kholo' });
    expect(changed.data.command.action).toBe('app.open');
    await waitStatus(changed.data.command.id, ['completed']);
    expect((await api('POST', '/api/commands', { text: 'Desktop wala' })).data.kind).toBe('unsupported');
  });

  it('cancels the WhatsApp choice without opening anything', async () => {
    const before = device.inbox.filter((m) => m.type === 'command').length;
    expect((await api('POST', '/api/commands', { text: 'WhatsApp kholo' })).data.kind).toBe('clarify');
    const cancelled = await api('POST', '/api/commands', { text: 'Rehne do' });
    expect(cancelled.data).toMatchObject({ kind: 'reply', topic: 'whatsapp-cancelled' });
    expect(device.inbox.filter((m) => m.type === 'command')).toHaveLength(before);
  });

  it('whatsapp compose needs a saved contact and always needs approval', async () => {
    const r1 = await api('POST', '/api/commands', { text: 'Ali ko message likho ke main 10 minute mein call karunga' });
    expect(r1.data).toMatchObject({ kind: 'clarify', topic: 'contact-unknown' });
    await api('PUT', '/api/settings', { whatsappContacts: [{ name: 'Ali', phone: '+92 300 1234567' }], approvalRequired: { 'whatsapp.compose': false } });
    const r2 = await api('POST', '/api/commands', { text: 'Ali ko message likho ke main 10 minute mein call karunga' });
    expect(r2.data.command.status).toBe('awaiting_approval');
    expect(r2.data.command.args).toMatchObject({ contact: 'Ali', phone: '923001234567' });
    await api('POST', `/api/commands/${r2.data.command.id}/reject`);
  });
  it('holds a multi-step YouTube conversation without opening random pages', async () => {
    device.auto = () => ({ ok: true, result: { mode: 'search' } });
    const ask = await api('POST', '/api/commands', { text: 'YouTube kholo', source: 'voice' });
    expect(ask.data).toMatchObject({ kind: 'clarify', topic: 'youtube-choice' });
    const next = await api('POST', '/api/commands', { text: 'Video search', source: 'voice' });
    expect(next.data).toMatchObject({ kind: 'clarify', topic: 'youtube-query' });
    const actual = await api('POST', '/api/commands', { text: 'Gold analysis', source: 'voice' });
    expect(actual.data).toMatchObject({ kind: 'command', command: {
      action: 'youtube.search', args: { query: 'Gold analysis' },
    } });
    await waitStatus(actual.data.command.id, ['completed']);
  });

  it('resolves missing file, folder, app, website and search slots', async () => {
    device.auto = () => ({ ok: true, result: { windowDetected: true } });
    for (const [asked, topic, answer, action] of [
      ['File kholo', 'which-file', 'Invoice PDF', 'file.open'],
      ['Folder kholo', 'which-folder', 'Downloads', 'folder.open'],
      ['App kholo', 'which-app', 'Chrome', 'app.open'],
      ['Website kholo', 'which-website', 'Google', 'web.open'],
      ['Search karo', 'search-what', 'Gold weekly forecast', 'web.search'],
    ] as const) {
      const prompt = await api('POST', '/api/commands', { text: asked });
      expect(prompt.data).toMatchObject({ kind: 'clarify', topic });
      const reply = await api('POST', '/api/commands', { text: answer });
      expect(reply.data).toMatchObject({ kind: 'command', command: { action } });
      await waitStatus(reply.data.command.id, ['completed']);
    }
  });

  it('never sends a WhatsApp message: asks recipient, body, then approval', async () => {
    device.auto = () => ({ ok: true, result: { sent: false } });
    const first = await api('POST', '/api/commands', { text: 'Message bhejo' });
    expect(first.data).toMatchObject({ kind: 'clarify', topic: 'message-contact' });
    const recipient = await api('POST', '/api/commands', { text: 'Ali' });
    expect(recipient.data).toMatchObject({ kind: 'clarify', topic: 'message-body' });
    const body = await api('POST', '/api/commands', { text: 'Main kal 10 baje call karunga' });
    expect(body.data).toMatchObject({ kind: 'command', command: {
      action: 'whatsapp.compose', status: 'awaiting_approval',
      args: { contact: 'Ali', message: 'Main kal 10 baje call karunga' },
    } });
    await api('POST', `/api/commands/${body.data.command.id}/reject`);
    expect((await api('GET', `/api/commands/${body.data.command.id}`)).data.status).toBe('cancelled');
    expect(device.inbox.some((m) => m.type === 'command' && m.command.id === body.data.command.id)).toBe(false);
  });

  it('new incomplete requests supersede old questions and cancellation never dispatches', async () => {
    const initial = await api('POST', '/api/commands', { text: 'Search karo' });
    expect(initial.data).toMatchObject({ kind: 'clarify', topic: 'search-what' });
    const changed = await api('POST', '/api/commands', { text: 'Message bhejo' });
    expect(changed.data).toMatchObject({ kind: 'clarify', topic: 'message-contact' });
    const before = device.inbox.filter((m) => m.type === 'command').length;
    const cancelled = await api('POST', '/api/commands', { text: 'Rehne do' });
    expect(cancelled.data).toMatchObject({ kind: 'reply', topic: 'conversation-cancelled' });
    expect(device.inbox.filter((m) => m.type === 'command')).toHaveLength(before);
  });

  it('times out commands the device never answers', async () => {
    device.auto = (cmd) => null; // swallow
    const r = await api('POST', '/api/commands', { action: 'window.active', args: {} });
    // shorten timeout directly in DB for test speed
    h.relay.db.prepare('UPDATE commands SET timeout_ms = 300 WHERE id = ?').run(r.data.command.id);
    const done = await waitStatus(r.data.command.id, ['timed_out']);
    expect(done.error.code).toBe('TIMEOUT');
    await device.waitFor((m) => m.type === 'cancel' && m.commandId === r.data.command.id);
  });
  it('ignores a late result after timeout', async () => {
    const last = (await api('GET', '/api/commands?limit=1')).data[0];
    device.send({ type: 'result', commandId: last.id, ok: true, result: { title: 'late' } });
    await device.waitFor((m) => m.type === 'result_ack' && m.commandId === last.id);
    expect((await api('GET', `/api/commands/${last.id}`)).data.status).toBe('timed_out');
  });
  it('cancels the current command by voice/text', async () => {
    device.auto = () => null;
    const r = await api('POST', '/api/commands', { text: 'Notepad kholo' });
    await waitStatus(r.data.command.id, ['running']);
    const c = await api('POST', '/api/commands', { text: 'current command cancel karo' });
    expect(c.data.command.result.cancelled).toBe(1);
    expect((await api('GET', `/api/commands/${r.data.command.id}`)).data.status).toBe('cancelled');
    await device.waitFor((m) => m.type === 'cancel' && m.commandId === r.data.command.id);
  });
});

describe('disconnection & reconnection', () => {
  it('queues while offline and delivers on reconnect', async () => {
    await device.close();
    await new Promise((r) => setTimeout(r, 100));
    expect((await api('GET', '/api/devices')).data[0].online).toBe(false);
    const r = await api('POST', '/api/commands', { text: 'Chrome kholo' });
    expect(r.data.command.status).toBe('pending');
    device = new FakeDevice(deviceToken);
    device.auto = () => ({ ok: true, result: { windowDetected: true } });
    await device.connect();
    await waitStatus(r.data.command.id, ['completed']);
  });
  it('expires queued commands if the device stays offline', async () => {
    await device.close();
    await new Promise((r) => setTimeout(r, 100));
    const r = await api('POST', '/api/commands', { text: 'Chrome kholo' });
    const done = await waitStatus(r.data.command.id, ['timed_out'], 4000);
    expect(done.error.code).toBe('DEVICE_OFFLINE');
    device = new FakeDevice(deviceToken);
    await device.connect();
  });
});

describe('permissions & emergency stop', () => {
  it('blocks disabled capabilities', async () => {
    await api('PATCH', `/api/devices/${deviceId}`, { capabilitiesEnabled: ['system', 'apps', 'folders', 'browser'] });
    await device.waitFor((m) => m.type === 'capabilities');
    const r = await api('POST', '/api/commands', { text: 'invoice pdf search karo' });
    expect(r.data.command).toMatchObject({ status: 'failed', error: { code: 'CAPABILITY_DISABLED' } });
  });
  it('emergency stop pauses the device and fails new commands', async () => {
    await api('POST', '/api/emergency-stop');
    await device.waitFor((m) => m.type === 'pause');
    const r = await api('POST', '/api/commands', { text: 'Chrome kholo' });
    expect(r.data.command).toMatchObject({ status: 'failed', error: { code: 'PAUSED' } });
    await api('POST', `/api/devices/${deviceId}/resume`);
    await device.waitFor((m) => m.type === 'resume');
  });
  it('records an audit trail', async () => {
    const events = (await api('GET', '/api/audit')).data.map((e: any) => e.event);
    expect(events).toEqual(expect.arrayContaining(['account.created', 'device.paired', 'command.approved', 'command.rejected', 'device.paused']));
  });
});

describe('automations', () => {
  it('runs saved steps in order', async () => {
    await api('PATCH', `/api/devices/${deviceId}`, { capabilitiesEnabled: ['system', 'apps', 'folders', 'files', 'browser', 'youtube'] });
    device.auto = (cmd) => ({ ok: true, result: { action: cmd.action } });
    const bad = await api('POST', '/api/automations', { name: 'x', steps: ['mausam batao'] });
    expect(bad.status).toBe(400);
    const a = await api('POST', '/api/automations', { name: 'Morning Browser Setup', steps: ['Chrome kholo', 'TradingView kholo', 'Downloads folder kholo'] });
    expect(a.status).toBe(200);
    const run = await api('POST', `/api/automations/${a.data.id}/run`, {});
    const start = Date.now();
    for (;;) {
      const list = (await api('GET', '/api/automations')).data;
      if (list[0].lastRunStatus === 'completed') break;
      if (Date.now() - start > 5000) throw new Error('automation did not complete');
      await new Promise((r) => setTimeout(r, 100));
    }
    const cmds = (await api('GET', `/api/commands?runId=${run.data.runId}`)).data;
    expect(cmds.map((c: any) => c.action).reverse()).toEqual(['app.open', 'web.open', 'folder.open']);
  });
});

describe('daily automation schedules', () => {
  it('validates time and timezone and keeps existing automations opt-in', async () => {
    const badClock = await api('POST', '/api/automations', {
      name: 'bad time', steps: ['Chrome kholo'],
      schedule: { enabled: true, time: '25:99', timezone: 'Asia/Kuala_Lumpur' },
    });
    expect(badClock.status).toBe(400);
    const badZone = await api('POST', '/api/automations', {
      name: 'bad timezone', steps: ['Chrome kholo'],
      schedule: { enabled: true, time: '09:00', timezone: 'Mars/Olympus' },
    });
    expect(badZone.status).toBe(400);
    const items = (await api('GET', '/api/automations')).data;
    expect(items.every((a: any) => a.schedule && !a.schedule.enabled)).toBe(true);
  });

  it('runs a scheduled routine once per local day, and never early', async () => {
    device.auto = () => ({ ok: true, result: {} });
    const saved = await api('POST', '/api/automations', {
      name: 'daily smoke test', steps: ['Chrome kholo'],
      schedule: { enabled: true, time: '09:00', timezone: 'Asia/Kuala_Lumpur' },
    });
    expect(saved.status).toBe(200);
    expect(saved.data.schedule).toEqual({
      enabled: true, time: '09:00', timezone: 'Asia/Kuala_Lumpur',
    });
    const id = saved.data.id;
    const count = () => (h.relay.db.prepare('SELECT COUNT(*) AS n FROM commands WHERE automation_run_id IS NOT NULL AND input_text = ?').get('Chrome kholo') as any).n as number;
    const before = count();
    h.relay.runDueSchedules(new Date('2026-11-20T00:59:00.000Z'));
    expect(count()).toBe(before);
    h.relay.runDueSchedules(new Date('2026-11-20T01:00:00.000Z'));
    const first = count();
    expect(first).toBe(before + 1);
    h.relay.runDueSchedules(new Date('2026-11-20T01:00:25.000Z'));
    expect(count()).toBe(first);
    const claimed = h.relay.db.prepare('SELECT last_scheduled_day FROM automations WHERE id = ?').get(id) as any;
    expect(claimed.last_scheduled_day).toBe('2026-11-20');
  });
});

describe('unpairing', () => {
  it('revokes the device and its token', async () => {
    await api('DELETE', `/api/devices/${deviceId}`);
    await device.waitFor((m) => m.type === 'revoked');
    expect((await api('GET', '/api/devices')).data).toHaveLength(0);
    const ws = new WebSocket(h.url.replace('http', 'ws') + '/ws/device', { headers: { authorization: `Bearer ${deviceToken}` } });
    const code = await new Promise((r) => ws.on('unexpected-response', (_q, res) => r(res.statusCode)));
    expect(code).toBe(403);
  });
});
