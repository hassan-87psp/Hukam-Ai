import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize as normPath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { PROVIDER_STATUS } from '../../../packages/command-protocol/src/index';
import { loadConfig, type RelayConfig } from './config';
import { restoreCloudSnapshot, startCloudBackup } from './backup';
import { femaleUrduAudio, reportFemaleVoiceError } from './female-tts';
import { chatWithGemini, cleanGeminiInput, geminiConfigured, GeminiError } from './gemini';
import { diagnoseGemini } from './ai-diagnostics';
import { HttpError, Relay } from './core';
import { Projects } from './projects';
import { Operator } from './operator';
import { analyzeScreenshot } from './vision';
import { all, one, openDb, run, runVolatile, setWriteHook, type Row } from './db';
import { addMs, hashPassword, log, newId, normalizePairCode, nowIso, pairingCode, randomToken, RateLimiter, sha256, verifyPassword } from './util';

export const VERSION = '1.8.0';
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
  const projects = new Projects(db);
  const operator = new Operator(db, relay, projects);
  relay.start();

  const loginLimit = new RateLimiter(10, 5 * 60_000);
  const pairLimit = new RateLimiter(10, 10 * 60_000);
  const cmdLimit = new RateLimiter(60, 60_000);
  const ttsLimit = new RateLimiter(10, 60_000);
  const aiLimit = new RateLimiter(12, 60_000);
  const aiDailyLimit = new RateLimiter(120, 24 * 60 * 60_000);
  const aiDiagnosticLimit = new RateLimiter(2, 5 * 60_000);
  const aiDiagnosticDailyLimit = new RateLimiter(16, 24 * 60 * 60_000);
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
    if (Date.now() - Date.parse(s.last_seen) > 60_000) runVolatile(db, 'UPDATE sessions SET last_seen = ? WHERE id = ?', nowIso(), s.id);
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
  add('GET', '/api/system', true, () => ({ version: VERSION, providers: PROVIDER_STATUS, parser: 'deterministic+reviewed Gemini planner', projects: 'persistent', operator: 'supervised' }));
  // The relay answering HTTP does not mean the Windows laptop or Gemini is
  // connected. Give the authenticated owner separate, honest readiness data.
  add('GET', '/api/runtime/status', true, (c) => {
    const devices = relay.listDevices(c.user!.id);
    const activeRuns = operator.listRuns(c.user!.id)
      .filter(r => ['queued', 'running', 'awaiting_approval'].includes(r.status)).length;
    return {
      relay: { reachable: true, version: VERSION },
      gemini: { configured: geminiConfigured(), reachable: null },
      controller: {
        paired: devices.length,
        connected: devices.filter(d => d.online).length,
        paused: devices.filter(d => d.paused).length,
      },
      tasks: { awaitingApproval: relay.listApprovals(c.user!.id).length, activeRuns },
    };
  });
  // Keys never leave the server. The model is chat-only; it cannot execute actions.
  // History comes from owner-scoped server storage, NOT untrusted browser-supplied turns.
  add('GET', '/api/ai/status', true, () => ({ configured: geminiConfigured(), provider: 'gemini' }));
  // Explicit, owner-clicked connectivity test. Uses only fixed harmless
  // prompts, never sends chats/Projects/screenshots and never executes plans.
  // Each test invokes Google twice and may consume small Gemini quota.
  add('POST', '/api/ai/diagnostics', true, async (c) => {
    const key='ai-diagnostic:'+c.user!.id;
    if (!aiDiagnosticLimit.take(key) || !aiDiagnosticDailyLimit.take(key))
      throw new HttpError(429,'AI_DIAGNOSTIC_LIMIT',
        'Too many Gemini diagnostic requests. Try again later.');
    return diagnoseGemini();
  });
  const chatProject = (userId: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 120)
      throw new HttpError(400,'PROJECT_ID','Invalid Project selection');
    return projects.get(userId,value);
  };
  const savedChat = (userId: string, projectId: unknown) => {
    const p = chatProject(userId,projectId);
    if (p) return projects.messages(userId,p.id).map(m =>
      ({id:m.id,role:m.role,text:m.content,at:m.createdAt}));
    return all(db,`SELECT id,role,content,created_at FROM ai_chat_turns
      WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 80`,userId).reverse().map(m =>
      ({id:m.id,role:m.role as 'user'|'assistant',text:m.content as string,at:m.created_at as string}));
  };
  add('GET', '/api/ai/history', true, (c) =>
    savedChat(c.user!.id,c.url.searchParams.get('projectId')));
  add('DELETE', '/api/ai/history', true, (c) => {
    const userId=c.user!.id;
    const p=chatProject(userId,c.url.searchParams.get('projectId'));
    if(p)projects.clearMessages(userId,p.id);
    else {
      run(db,'DELETE FROM ai_chat_turns WHERE user_id=?',userId);
      relay.discardCommandDialogue(userId);
    }
    // Clearing chat must also forget its old unanswered command/question.
    operator.discardPending(userId,p?.id??null);
    return {ok:true};
  });
  add('POST', '/api/ai/chat', true, async (c) => {
    // Backward-compatible input validation: old clients may still include
    // history, but ONLY owner-scoped database history is trusted by Gemini.
    let message:string;
    try { message=cleanGeminiInput(c.body?.message,c.body?.history).message; }
    catch(e) {
      if(e instanceof GeminiError)throw new HttpError(e.status,e.code,e.message);
      throw e;
    }
    if (!aiLimit.take('gemini:' + c.user!.id) || !aiDailyLimit.take('gemini:' + c.user!.id))
      throw new HttpError(429, 'AI_RATE_LIMIT', 'AI chat limit reached. Please try again later.');
    const userId=c.user!.id;
    const project=chatProject(userId,c.body?.projectId);
    const history=savedChat(userId,project?.id ?? null).slice(-12)
      .map(m=>({role:m.role,text:m.text.slice(0,750)}));
    const notes=project?projects.notes(userId,project.id).slice(0,12):[];
    const projectContext=project?
      [project.name,project.description,project.instructions,
        ...notes.map(n=>n.title+': '+n.content.slice(0,350))].join('\n').slice(0,6500):undefined;
    try {
      const ai=await chatWithGemini(message,history,
        {projectContext,responseLang:['roman','ur','en'].includes(c.body?.responseLang) ? c.body.responseLang : 'roman'});
      if(project){
        projects.appendMessage(userId,project.id,'user',message);
        projects.appendMessage(userId,project.id,'assistant',ai.reply);
      } else {
        const at=nowIso();
        run(db,'INSERT INTO ai_chat_turns(id,user_id,role,content,created_at) VALUES(?,?,?,?,?)',
          newId('ai_'),userId,'user',message,at);
        run(db,'INSERT INTO ai_chat_turns(id,user_id,role,content,created_at) VALUES(?,?,?,?,?)',
          newId('ai_'),userId,'assistant',ai.reply,at);
        run(db,`DELETE FROM ai_chat_turns WHERE user_id=? AND id NOT IN
          (SELECT id FROM ai_chat_turns WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 80)`,
          userId,userId);
      }
      return ai;
    } catch (e) {
      if (e instanceof GeminiError) throw new HttpError(e.status, e.code, e.message);
      throw new HttpError(502, 'AI_UNAVAILABLE', 'Gemini is temporarily unavailable.');
    }
  });

  // Durable Projects + memory. Every query is scoped to authenticated owner.
  add('GET', '/api/projects', true, (c) => projects.list(c.user!.id));
  add('POST', '/api/projects', true, (c) => projects.save(c.user!.id, null, c.body ?? {}));
  add('GET', '/api/projects/:id', true, (c) => projects.get(c.user!.id, c.params.id));
  add('PATCH', '/api/projects/:id', true, (c) => projects.save(c.user!.id, c.params.id, c.body ?? {}));
  add('DELETE', '/api/projects/:id', true, (c) => projects.remove(c.user!.id, c.params.id));
  add('GET', '/api/projects/:id/notes', true, (c) => projects.notes(c.user!.id, c.params.id));
  add('POST', '/api/projects/:id/notes', true, (c) => projects.saveNote(c.user!.id, c.params.id, null, c.body ?? {}));
  add('PATCH', '/api/projects/:id/notes/:noteId', true, (c) => projects.saveNote(c.user!.id, c.params.id, c.params.noteId, c.body ?? {}));
  add('DELETE', '/api/projects/:id/notes/:noteId', true, (c) => projects.removeNote(c.user!.id, c.params.id, c.params.noteId));
  add('GET', '/api/projects/:id/tasks', true, (c) => operator.listProjectRuns(c.user!.id,c.params.id));
  add('GET', '/api/projects/:id/messages', true, (c) => projects.messages(c.user!.id, c.params.id));
  add('DELETE', '/api/projects/:id/messages', true, (c) => projects.clearMessages(c.user!.id, c.params.id));
  add('POST', '/api/projects/:id/chat', true, async (c) => {
    if (!aiLimit.take('project-chat:' + c.user!.id) || !aiDailyLimit.take('project-chat:' + c.user!.id))
      throw new HttpError(429, 'AI_RATE_LIMIT', 'AI rate limit reached');
    const project = projects.get(c.user!.id, c.params.id);
    const message = c.body?.message;
    if (typeof message !== 'string' || !message.trim() || message.length > 1800)
      throw new HttpError(400, 'BAD_MESSAGE', 'Message required (up to 1800 characters)');
    const notes = projects.notes(c.user!.id,project.id).slice(0,20);
    const context = [project.name, project.description, project.instructions,
      ...notes.map(n => n.title + ': ' + n.content.slice(0,500))].join('\n').slice(0,8000);
    const history = projects.messages(c.user!.id,project.id)
      .slice(-10).map(m => ({role:m.role,text:m.content.slice(0,750)}));
    let ai;
    try { ai = await chatWithGemini(message, history, {projectContext:context}); }
    catch(e){
      if(e instanceof GeminiError) throw new HttpError(e.status,e.code,e.message);
      throw new HttpError(502,'AI_UNAVAILABLE','Gemini unavailable');
    }
    // Save only after successful AI generation, so retry does not create duplicate turns.
    projects.appendMessage(c.user!.id,project.id,'user',message);
    projects.appendMessage(c.user!.id,project.id,'assistant',ai.reply);
    return ai;
  });

  // Owner reviewed AI plans and sequential audited tasks. No direct model execution.
  add('POST', '/api/operator/plan', true, async (c) => {
    if (!aiLimit.take('agent:' + c.user!.id) || !aiDailyLimit.take('agent:' + c.user!.id))
      throw new HttpError(429,'AI_RATE_LIMIT','AI planner limit reached');
    return operator.plan(c.user!.id, c.body?.text, c.body?.projectId);
  });
  add('GET', '/api/operator/pending', true, (c) =>
    operator.pending(c.user!.id, new URL(c.req.url??'/', 'http://localhost').searchParams.get('projectId')));
  add('GET', '/api/dialogue/pending', true, (c) => relay.pendingCommandDialogue(c.user!.id));
  add('GET', '/api/operator/plans/:id', true, (c) => operator.getPlan(c.user!.id, c.params.id));
  add('POST', '/api/operator/plans/:id/run', true, (c) => operator.start(c.user!.id,c.params.id,c.body?.deviceId));
  add('GET', '/api/operator/runs', true, (c) => operator.listRuns(c.user!.id));
  add('GET', '/api/operator/runs/:id', true, (c) => operator.getRun(c.user!.id,c.params.id));
  add('POST', '/api/operator/runs/:id/cancel', true, (c) => operator.cancel(c.user!.id,c.params.id));

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

  // Screenshot already requires controller approval. Sending it to Google
  // requires a distinct explicit authenticated POST by the owner.
  add('POST', '/api/vision/analyze', true, async (c) => {
    if(!aiLimit.take('vision:'+c.user!.id)||!aiDailyLimit.take('vision:'+c.user!.id))
      throw new HttpError(429,'VISION_RATE_LIMIT','Vision AI rate limit reached');
    if(c.body?.consent !== true)
      throw new HttpError(400,'VISION_CONSENT','Explicit screenshot-sharing consent required');
    const id=c.body?.screenshotId;
    if(typeof id!=='string'||!/^s_[A-Za-z0-9_-]{8,90}$/.test(id))
      throw new HttpError(400,'VISION_SCREENSHOT','Invalid screenshot ID');
    const shot=relay.getScreenshot(c.user!.id,id);
    const answer=await analyzeScreenshot(shot.path,c.body?.question);
    relay.audit(c.user!.id,'user','screen.vision_analyzed',{screenshotId:id,provider:'Google Gemini'},null,c.ip);
    return answer;
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
  // Logs a boolean only; never reveal API keys or provider response bodies.
  log('info', 'Gemini conversational AI configured', { enabled: geminiConfigured() });

  // Test the public free TTS transport once per startup without user content.
  // No audio is stored. Production requests still require authentication.
  setTimeout(() => {
    void femaleUrduAudio('السلام علیکم، میں حکم ہوں۔')
      .then((audio) => log('info', 'Pakistani female voice service checked', { available: true, audioBytes: audio.length }))
      .catch(reportFemaleVoiceError);
  }, 1500).unref();

  return {
    server, relay, config, url,
    get setupCode() { return setupCode; },
    async close() {
      relay.stop();
      // Device 'close' handlers write the final last_seen/disconnect audit
      // to SQLite. Wait for those handlers before closing the database.
      const forceClose = setTimeout(() => {
        for (const ws of [...wssDevice.clients, ...wssClient.clients]) ws.terminate();
      }, 2000);
      forceClose.unref?.();
      try {
        await Promise.all([
          new Promise<void>((resolve) => wssDevice.close(() => resolve())),
          new Promise<void>((resolve) => wssClient.close(() => resolve())),
        ]);
      } finally {
        clearTimeout(forceClose);
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
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
