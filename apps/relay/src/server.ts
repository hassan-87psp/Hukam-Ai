import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize as normPath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { PROVIDER_STATUS } from '../../../packages/command-protocol/src/index';
import { loadConfig, type RelayConfig } from './config';
import { restoreCloudSnapshot, startCloudBackup } from './backup';
import { femaleUrduAudio, reportFemaleVoiceError } from './female-tts';
import { HttpError, Relay } from './core';
import { all, one, openDb, run, setWriteHook, type Row } from './db';
import { addMs, hashPassword, log, newId, normalizePairCode, nowIso, pairingCode, randomToken, RateLimiter, sha256, verifyPassword } from './util';

export const VERSION = '1.0.0';
const COOKIE = 'hukm_session';
const MAX_BODY = 64 * 1024;

type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  ip: string | null;
  params: Record<string, string>;
  body: any;
  user: Row | null;
  session: Row | null;
};
type Handler = (c: Ctx) => Promise<unknown> | unknown;
interface Route { method: string; re: RegExp; keys: string[]; auth: boolean; h: Handler }

function json(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function parseCookies(h: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function readBody(req: IncomingMessage): Promise<any> {
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'TOO_LARGE', 'request body too large');
    chunks.push(c as Buffer);
  }
  if (!size) return {};
  const ct = req.headers['content-type'] ?? '';
  if (!ct.includes('application/json')) throw new HttpError(415, 'UNSUPPORTED_MEDIA', 'JSON body required');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'invalid JSON');
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'microphone=(self), camera=(), geolocation=()',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; media-src 'self' blob:; connect-src 'self' ws: wss:; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
};

export interface RelayHandle {
  server: Server;
  relay: Relay;
  config: RelayConfig;
  setupCode: string | null;
  url: string;
  close(): Promise<void>;
}

export async function startRelay(overrides: Partial<RelayConfig> = {}): Promise<RelayHandle> {
  const config = loadConfig(overrides);
  await restoreCloudSnapshot(config.dataDir);
  const db = openDb(config.dataDir, config.migrationsDir);
  const backup = startCloudBackup(db, config.dataDir);
  setWriteHook(db, backup.markDirty);
  // Persist startup migrations, including the one-time Roman Urdu voice settings.
  if (backup.enabled) {
    backup.markDirty();
    await backup.flush();
  }
  const relay = new Relay(db, config);
  relay.start();

  const loginLimit = new RateLimiter(10, 5 * 60_000);
  const pairLimit = new RateLimiter(10, 10 * 60_000);
  const cmdLimit = new RateLimiter(60, 60_000);
  const ttsLimit = new RateLimiter(10, 60_000);
  const apiLimit = new RateLimiter(600, 60_000);

  const hasUser = () => !!one(db, 'SELECT 1 AS x FROM users LIMIT 1');
  // Temporary test-only bootstrap. Disable on production deployments.
  const allowCodelessSetup = process.env.HUKM_ALLOW_CODELESS_SETUP === 'true';
  let setupCode: string | null = (hasUser() || allowCodelessSetup) ? null : config.setupCode ?? pairingCode();
  if (setupCode) {
    log('info', 'first-run setup code (enter it in the web app to create the owner account)', { setupCode });
    console.log(`\n  ╭───────────────────────────────────────────╮\n  │  HUKM AI first-run setup code: ${setupCode}  │\n  ╰───────────────────────────────────────────╯\n`);
  }

  const clientIp = (req: IncomingMessage) => {
    if (config.trustProxy) {
      const f = req.headers['x-forwarded-for'];
      if (typeof f === 'string') return f.split(',')[0].trim();
    }
    return req.socket.remoteAddress ?? null;
  };
  const isHttps = (req: IncomingMessage) => (config.trustProxy && req.headers['x-forwarded-proto'] === 'https') || (req.socket as any).encrypted;

  function sessionFrom(req: IncomingMessage): { user: Row; session: Row } | null {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const s = one(db, 'SELECT * FROM sessions WHERE token_hash = ?', sha256(token));
    if (!s || Date.parse(s.expires_at) < Date.now()) return null;
    const u = one(db, 'SELECT * FROM users WHERE id = ?', s.user_id);
    if (!u) return null;
    if (Date.now() - Date.parse(s.last_seen) > 60_000) run(db, 'UPDATE sessions SET last_seen = ? WHERE id = ?', nowIso(), s.id);
    return { user: u, session: s };
  }

  function issueSession(c: Ctx, userId: string) {
    const token = randomToken(32);
    const exp = addMs(config.sessionTtlDays * 86400_000);
    run(db, 'INSERT INTO sessions (id, user_id, token_hash, user_agent, ip, created_at, last_seen, expires_at) VALUES (?,?,?,?,?,?,?,?)',
      newId('se_'), userId, sha256(token), String(c.req.headers['user-agent'] ?? '').slice(0, 200), c.ip, nowIso(), nowIso(), exp);
    const secure = isHttps(c.req) ? '; Secure' : '';
    c.res.setHeader('set-cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${config.sessionTtlDays * 86400}${secure}`);
  }

  const publicUser = (u: Row) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.created_at });

  // ---- routes ----------------------------------------------------------
  const routes: Route[] = [];
  const add = (method: string, path: string, auth: boolean, h: Handler) => {
    const keys: string[] = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_m, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, auth, h });
  };

  add('GET', '/api/health', false, () => ({ ok: true, version: VERSION, time: nowIso() }));
  add('GET', '/api/system', true, () => ({ version: VERSION, providers: PROVIDER_STATUS, parser: 'deterministic' }));

  // auth
  add('GET', '/api/auth/status', false, (c) => {
    const s = sessionFrom(c.req);
    return { setupRequired: !hasUser(), user: s ? publicUser(s.user) : null };
  });
  add('POST', '/api/auth/setup', false, async (c) => {
    if (hasUser()) throw new HttpError(409, 'ALREADY_SETUP', 'owner account already exists');
    if (!loginLimit.take(`setup:${c.ip}`)) throw new HttpError(429, 'RATE_LIMITED', 'too many attempts');
    const { email, name, password, setupCode: code } = c.body ?? {};
    if (!allowCodelessSetup && (!setupCode || typeof code !== 'string' || normalizePairCode(code) !== normalizePairCode(setupCode)))
      throw new HttpError(403, 'BAD_SETUP_CODE', 'setup code is wrong — it is printed in the relay console');
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'BAD_EMAIL', 'valid email required');
    if (typeof password !== 'string' || password.length < 10) throw new HttpError(400, 'WEAK_PASSWORD', 'password must be at least 10 characters');
    const id = newId('u_');
    run(db, 'INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?,?,?,?,?)', id, email.trim(),
      (typeof name === 'string' && name.trim() ? name.trim() : email.split('@')[0]).slice(0, 60), await hashPassword(password), nowIso());
    setupCode = null;
    relay.audit(id, 'user', 'account.created', null, null, c.ip);
    issueSession(c, id);
    return { user: publicUser(one(db, 'SELECT * FROM users WHERE id = ?', id)!) };
  });
  add('POST', '/api/auth/login', false, async (c) => {
    const { email, password } = c.body ?? {};
    if (!loginLimit.take(`ip:${c.ip}`) || !loginLimit.take(`email:${String(email).toLowerCase()}`))
      throw new HttpError(429, 'RATE_LIMITED', 'too many login attempts — wait a few minutes');
    const u = typeof email === 'string' ? one(db, 'SELECT * FROM users WHERE email = ?', email.trim()) : undefined;
    const okPw = u && typeof password === 'string' ? await verifyPassword(password, u.password_hash) : false;
    if (!u || !okPw) {
      relay.audit(u?.id ?? null, 'user', 'login.failed', { email: String(email).slice(0, 80) }, null, c.ip);
      throw new HttpError(401, 'BAD_CREDENTIALS', 'email or password is wrong');
    }
    issueSession(c, u.id);
    relay.audit(u.id, 'user', 'login', null, null, c.ip);
    return { user: publicUser(u) };
  });
  add('POST', '/api/auth/logout', true, (c) => {
    run(db, 'DELETE FROM sessions WHERE id = ?', c.session!.id);
    c.res.setHeader('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    return { ok: true };
  });
  add('GET', '/api/auth/me', true, (c) => ({ user: publicUser(c.user!) }));
  add('PATCH', '/api/auth/me', true, (c) => {
    const name = c.body?.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 60) throw new HttpError(400, 'BAD_REQUEST', 'invalid name');
    run(db, 'UPDATE users SET name = ? WHERE id = ?', name.trim(), c.user!.id);
    return { user: publicUser(one(db, 'SELECT * FROM users WHERE id = ?', c.user!.id)!) };
  });
  add('GET', '/api/auth/sessions', true, (c) =>
    all(db, 'SELECT id, user_agent AS userAgent, ip, created_at AS createdAt, last_seen AS lastSeen, expires_at AS expiresAt FROM sessions WHERE user_id = ? ORDER BY last_seen DESC', c.user!.id)
      .map((s) => ({ ...s, current: s.id === c.session!.id })));
  add('DELETE', '/api/auth/sessions/:id', true, (c) => {
    run(db, 'DELETE FROM sessions WHERE id = ? AND user_id = ?', c.params.id, c.user!.id);
    relay.audit(c.user!.id, 'user', 'session.revoked', { id: c.params.id }, null, c.ip);
    return { ok: true };
  });
  add('POST', '/api/auth/logout-others', true, (c) => {
    run(db, 'DELETE FROM sessions WHERE user_id = ? AND id != ?', c.user!.id, c.session!.id);
    relay.audit(c.user!.id, 'user', 'session.revoked_all', null, null, c.ip);
    return { ok: true };
  });
  add('POST', '/api/auth/password', true, async (c) => {
    const { current, next } = c.body ?? {};
    if (!loginLimit.take(`pw:${c.user!.id}`)) throw new HttpError(429, 'RATE_LIMITED', 'too many attempts');
    if (typeof current !== 'string' || !(await verifyPassword(current, c.user!.password_hash))) throw new HttpError(403, 'BAD_CREDENTIALS', 'current password is wrong');
    if (typeof next !== 'string' || next.length < 10) throw new HttpError(400, 'WEAK_PASSWORD', 'new password must be at least 10 characters');
    run(db, 'UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(next), c.user!.id);
    run(db, 'DELETE FROM sessions WHERE user_id = ? AND id != ?', c.user!.id, c.session!.id);
    relay.audit(c.user!.id, 'user', 'password.changed', null, null, c.ip);
    return { ok: true };
  });

  // devices & pairing
  add('GET', '/api/devices', true, (c) => relay.listDevices(c.user!.id));
  add('POST', '/api/devices/pairing-code', true, (c) => {
    const code = pairingCode();
    const expiresAt = addMs(10 * 60_000);
    const name = typeof c.body?.name === 'string' ? c.body.name.trim().slice(0, 60) : null;
    run(db, 'INSERT INTO pairing_codes (id, user_id, code_hash, device_name, created_at, expires_at) VALUES (?,?,?,?,?,?)',
      newId('pc_'), c.user!.id, sha256(normalizePairCode(code)), name, nowIso(), expiresAt);
    relay.audit(c.user!.id, 'user', 'pairing.code_created', null, null, c.ip);
    return { code, expiresAt };
  });
  add('POST', '/api/pair/claim', false, (c) => {
    if (!pairLimit.take(`pair:${c.ip}`)) throw new HttpError(429, 'RATE_LIMITED', 'too many pairing attempts');
    const b = c.body ?? {};
    if (typeof b.code !== 'string') throw new HttpError(400, 'BAD_REQUEST', 'code required');
    const pc = one(db, 'SELECT * FROM pairing_codes WHERE code_hash = ?', sha256(normalizePairCode(b.code)));
    if (!pc || pc.used_at || Date.parse(pc.expires_at) < Date.now()) throw new HttpError(403, 'BAD_CODE', 'pairing code is invalid or expired');
    const secret = randomToken(32);
    const id = newId('d_');
    const name = (pc.device_name || (typeof b.hostname === 'string' && b.hostname) || 'Windows Laptop').slice(0, 60);
    run(db, 'INSERT INTO devices (id, user_id, name, secret_hash, os, os_version, hostname, controller_version, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      id, pc.user_id, name, sha256(secret), String(b.os ?? '').slice(0, 40), String(b.osVersion ?? '').slice(0, 80), String(b.hostname ?? '').slice(0, 80),
      String(b.controllerVersion ?? '').slice(0, 20), nowIso());
    run(db, 'UPDATE pairing_codes SET used_at = ?, device_id = ? WHERE id = ?', nowIso(), id, pc.id);
    run(db, 'INSERT INTO connection_events (id, device_id, event, ip, at) VALUES (?,?,?,?,?)', newId('ce_'), id, 'paired', c.ip, nowIso());
    relay.audit(pc.user_id, 'device', 'device.paired', { name }, id, c.ip);
    const dev = one(db, 'SELECT * FROM devices WHERE id = ?', id)!;
    relay.broadcast(pc.user_id, { type: 'device.updated', device: relay.deviceDto(dev) });
    return { deviceId: id, deviceToken: `${id}.${secret}`, name };
  });
  add('PATCH', '/api/devices/:id', true, (c) => relay.updateDevice(c.user!.id, c.params.id, c.body ?? {}));
  add('DELETE', '/api/devices/:id', true, (c) => (relay.removeDevice(c.user!.id, c.params.id), { ok: true }));
  add('POST', '/api/devices/:id/pause', true, (c) => (relay.setPaused(c.user!.id, c.params.id, true, 'paused by user'), { ok: true }));
  add('POST', '/api/devices/:id/resume', true, (c) => (relay.setPaused(c.user!.id, c.params.id, false, 'resumed by user'), { ok: true }));
  add('GET', '/api/devices/:id/connections', true, (c) => relay.connectionHistory(c.user!.id, c.params.id));
  add('POST', '/api/emergency-stop', true, (c) => ({ paused: relay.emergencyStopAll(c.user!.id) }));

  // commands
  add('GET', '/api/commands', true, (c) => relay.listCommands(c.user!.id, {
    limit: Number(c.url.searchParams.get('limit') ?? 50),
    status: c.url.searchParams.get('status') ?? undefined,
    deviceId: c.url.searchParams.get('deviceId') ?? undefined,
    before: c.url.searchParams.get('before') ?? undefined,
    automationRunId: c.url.searchParams.get('runId') ?? undefined,
  }));
  add('DELETE', '/api/commands', true, (c) => ({ deleted: relay.clearHistory(c.user!.id) }));
  add('GET', '/api/commands/:id', true, (c) => relay.getCommand(c.user!.id, c.params.id));
  add('POST', '/api/commands', true, (c) => {
    if (!cmdLimit.take(c.user!.id)) throw new HttpError(429, 'RATE_LIMITED', 'too many commands — slow down');
    const out = relay.createCommand(c.user!.id, c.body ?? {});
    if (out.kind === 'command') return { kind: 'command', command: out.command, duplicate: out.duplicate };
    return out;
  });
  add('POST', '/api/commands/:id/approve', true, (c) => relay.decide(c.user!.id, c.params.id, true));
  add('POST', '/api/commands/:id/reject', true, (c) => relay.decide(c.user!.id, c.params.id, false));
  add('POST', '/api/commands/:id/cancel', true, (c) => relay.cancelCommand(c.user!.id, c.params.id));
  add('GET', '/api/approvals', true, (c) => relay.listApprovals(c.user!.id));

  // automations
  add('GET', '/api/automations', true, (c) => relay.listAutomations(c.user!.id));
  add('POST', '/api/automations', true, (c) => relay.saveAutomation(c.user!.id, null, c.body ?? {}));
  add('PATCH', '/api/automations/:id', true, (c) => relay.saveAutomation(c.user!.id, c.params.id, c.body ?? {}));
  add('DELETE', '/api/automations/:id', true, (c) => (relay.deleteAutomation(c.user!.id, c.params.id), { ok: true }));
  add('POST', '/api/automations/:id/run', true, (c) => relay.runAutomation(c.user!.id, c.params.id, typeof c.body?.deviceId === 'string' ? c.body.deviceId : undefined));

  // Authenticated experimental free Urdu female voice, shared across desktop/mobile.
  // The fixed voice prevents arbitrary third-party API usage and the small limits
  // keep a stolen web session from abusing the upstream consumer service.
  add('POST', '/api/voice/tts', true, async (c) => {
    if (!ttsLimit.take('voice:' + c.user!.id)) throw new HttpError(429, 'VOICE_RATE_LIMITED', 'too many voice requests');
    const text = typeof c.body?.text === 'string' ? c.body.text.trim() : '';
    if (!text || text.length > 450 || !/[\u0600-\u06FF]/u.test(text))
      throw new HttpError(400, 'INVALID_VOICE_TEXT', 'Urdu text up to 450 characters is required');
    try {
      const audio = await femaleUrduAudio(text);
      c.res.writeHead(200, {
        'content-type': 'audio/mpeg',
        'content-length': audio.byteLength,
        'cache-control': 'no-store, private',
        'x-content-type-options': 'nosniff',
      });
      c.res.end(audio);
      return undefined;
    } catch (e) {
      reportFemaleVoiceError(e);
      throw new HttpError(503, 'VOICE_UNAVAILABLE', 'Free Pakistani female voice is temporarily unavailable');
    }
  });

  // settings, audit, screenshots
  add('GET', '/api/settings', true, (c) => relay.getSettings(c.user!.id));
  add('PUT', '/api/settings', true, (c) => {
    const s = relay.saveSettings(c.user!.id, c.body ?? {});
    relay.audit(c.user!.id, 'user', 'settings.updated', { keys: Object.keys(c.body ?? {}) }, null, c.ip);
    return s;
  });
  add('GET', '/api/audit', true, (c) =>
    all(db, 'SELECT id, actor, event, device_id AS deviceId, detail, ip, at FROM audit_logs WHERE user_id = ? ORDER BY at DESC LIMIT ?', c.user!.id,
      Math.min(Number(c.url.searchParams.get('limit') ?? 100), 500)).map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })));
  add('GET', '/api/screenshots', true, (c) => relay.listScreenshots(c.user!.id));
  add('DELETE', '/api/screenshots/:id', true, (c) => (relay.deleteScreenshot(c.user!.id, c.params.id), { ok: true }));
  add('GET', '/api/screenshots/:id', true, (c) => {
    const s = relay.getScreenshot(c.user!.id, c.params.id);
    if (!existsSync(s.path)) throw new HttpError(404, 'NOT_FOUND', 'screenshot file missing');
    c.res.writeHead(200, { 'content-type': s.mime, 'cache-control': 'private, max-age=3600' });
    createReadStream(s.path).pipe(c.res);
    return undefined;
  });

  // ---- static web app --------------------------------------------------
  function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
    if (!existsSync(config.publicDir)) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('HUKM AI relay is running. Build the web app (npm run build) to serve the UI from here.');
      return;
    }
    let p = normPath(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(config.publicDir, p);
    if (!file.startsWith(config.publicDir)) file = join(config.publicDir, 'index.html');
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(config.publicDir, 'index.html');
    const ext = extname(file);
    const immutable = file.includes(`${join(config.publicDir, 'assets')}`);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...SECURITY_HEADERS,
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  }

  // ---- request handler -------------------------------------------------
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const ip = clientIp(req);
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    try {
      if (!apiLimit.take(`api:${ip}`)) throw new HttpError(429, 'RATE_LIMITED', 'too many requests');
      const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
      if (!route) throw new HttpError(404, 'NOT_FOUND', 'no such endpoint');
      // CSRF defence: state-changing browser requests must carry our custom header (not settable cross-site without CORS).
      if (req.method !== 'GET' && route.auth && req.headers['x-hukm-client'] !== 'web') throw new HttpError(403, 'CSRF', 'missing client header');
      const m = url.pathname.match(route.re)!;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const ctx: Ctx = { req, res, url, ip, params, body: await readBody(req), user: null, session: null };
      if (route.auth) {
        const s = sessionFrom(req);
        if (!s) throw new HttpError(401, 'UNAUTHENTICATED', 'please sign in');
        ctx.user = s.user;
        ctx.session = s.session;
      }
      const out = await route.h(ctx);
      // Only acknowledge mutation after it has a durable private cloud snapshot.
      if (req.method !== 'GET' && backup.enabled) await backup.flush();
      if (out !== undefined && !res.headersSent) json(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) json(res, e.status, { error: { code: e.code, message: e.message } });
      else {
        log('error', 'request failed', { path: url.pathname, err: String((e as Error)?.stack ?? e) });
        if (!res.headersSent) json(res, 500, { error: { code: 'INTERNAL', message: 'internal error' } });
      }
    }
  });

  // ---- websockets ------------------------------------------------------
  const wssDevice = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  const wssClient = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const ip = clientIp(req);
    const reject = (code: number, msg: string) => {
      socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (url.pathname === '/ws/device') {
      const auth = String(req.headers.authorization ?? '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const [deviceId, secret] = token.split('.');
      const dev = deviceId && secret ? one(db, 'SELECT * FROM devices WHERE id = ?', deviceId) : undefined;
      if (!dev || dev.secret_hash !== sha256(secret)) return reject(401, 'Unauthorized');
      if (dev.status !== 'paired') return reject(403, 'Revoked');
      wssDevice.handleUpgrade(req, socket, head, (ws) => relay.attachDevice(dev, ws, ip));
      return;
    }
    if (url.pathname === '/ws/client') {
      const origin = req.headers.origin;
      const host = req.headers.host;
      if (origin && host && new URL(origin).host !== host && !config.allowedOrigins.includes(origin)) return reject(403, 'Forbidden');
      const s = sessionFrom(req);
      if (!s) return reject(401, 'Unauthorized');
      wssClient.handleUpgrade(req, socket, head, (ws) => relay.addClient(s.user.id, ws));
      return;
    }
    reject(404, 'Not Found');
  });

  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  const url = `http://localhost:${port}`;
  log('info', 'HUKM AI relay listening', { url, dataDir: config.dataDir, publicDir: config.publicDir });

  return {
    server, relay, config, url,
    get setupCode() { return setupCode; },
    async close() {
      relay.stop();
      wssDevice.close();
      wssClient.close();
      await new Promise<void>((r) => server.close(() => r()));
      server.closeAllConnections?.();
      await backup.close();
      db.close();
    },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startRelay().then((h) => {
    const stop = () => h.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
