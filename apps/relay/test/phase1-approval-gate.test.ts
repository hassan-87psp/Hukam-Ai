import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startRelay, type RelayHandle } from '../src/server';

describe('Phase 1: owner approvals cannot be bypassed by controller messages', () => {
  let relay: RelayHandle;
  let dir: string;
  let cookie = '';
  let socket: WebSocket;
  const received: any[] = [];

  async function api(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { 'x-hukm-client': 'web' };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(relay.url + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, data: await response.json() };
  }

  async function until(predicate: () => boolean, timeoutMs = 2500) {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for controller event');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'hukm-approval-gate-'));
    relay = await startRelay({
      port: 0, host: '127.0.0.1', dataDir: dir,
      publicDir: join(dir, 'missing'), setupCode: 'PHASE1-CODE',
      heartbeatTimeoutMs: 60_000,
    });
    expect((await api('POST', '/api/auth/setup', {
      email: 'phase1gate@example.test', password: 'longpassword1', setupCode: 'PHASE1-CODE',
    })).status).toBe(200);
    const code = await api('POST', '/api/devices/pairing-code', { name: 'Phase1 Windows test' });
    const pair = await api('POST', '/api/pair/claim', { code: code.data.code, os: 'Windows' });
    expect(pair.status).toBe(200);
    socket = new WebSocket(relay.url.replace('http', 'ws') + '/ws/device', {
      headers: { authorization: 'Bearer ' + pair.data.deviceToken },
    });
    socket.on('message', (data) => received.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    socket.send(JSON.stringify({
      type: 'hello', controllerVersion: 'phase1-test', os: 'Windows',
      osVersion: '11', hostname: 'Test', capabilities: ['system'], config: {},
    }));
    await until(() => received.some(m => m.type === 'welcome'));
  });

  afterAll(async () => {
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    await relay?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('shows actual controller connection separately from relay and Gemini configuration', async () => {
    const r = await api('GET', '/api/runtime/status');
    expect(r.status).toBe(200);
    expect(r.data.relay.reachable).toBe(true);
    expect(r.data.controller.paired).toBe(1);
    expect(r.data.controller.connected).toBe(1);
    expect(r.data.gemini.reachable).toBe(null);
    const anonymous = await fetch(relay.url + '/api/runtime/status');
    expect(anonymous.status).toBe(401);
  });

  it('ignores forged ACK, started and success result until explicit approval', async () => {
    const created = await api('POST', '/api/commands', { action: 'system.lock', args: {} });
    expect(created.status).toBe(200);
    const id = created.data.command.id;
    expect(created.data.command.status).toBe('awaiting_approval');

    socket.send(JSON.stringify({ type: 'ack', commandId: id }));
    socket.send(JSON.stringify({ type: 'started', commandId: id }));
    socket.send(JSON.stringify({
      type: 'result', commandId: id, ok: true, result: { verified: true },
    }));
    await until(() => received.some(m => m.type === 'result_ack' && m.commandId === id));
    const unapproved = await api('GET', '/api/commands/' + id);
    expect(unapproved.data.status).toBe('awaiting_approval');
    expect(unapproved.data.approvedAt).toBe(null);
    expect(unapproved.data.dispatchedAt).toBe(null);
    expect(received.some(m => m.type === 'command' && m.command.id === id)).toBe(false);

    const approval = await api('POST', '/api/commands/' + id + '/approve');
    expect(approval.status).toBe(200);
    await until(() => received.some(m => m.type === 'command' && m.command.id === id));
    socket.send(JSON.stringify({ type: 'ack', commandId: id }));
    socket.send(JSON.stringify({ type: 'started', commandId: id }));
    socket.send(JSON.stringify({
      type: 'result', commandId: id, ok: true, result: { verified: true },
    }));
    let finished = await api('GET', '/api/commands/' + id);
    for (let i = 0; i < 80 && finished.data.status !== 'completed'; i++) {
      await new Promise(resolve => setTimeout(resolve, 25));
      finished = await api('GET', '/api/commands/' + id);
    }
    expect(finished.data.status).toBe('completed');
    expect(finished.data.approvedAt).not.toBe(null);
  });

  it('rejects an expired approval even before the sweeper tick', async () => {
    const created = await api('POST', '/api/commands', { action: 'system.lock', args: {} });
    const id = created.data.command.id;
    relay.relay.db.prepare('UPDATE command_approvals SET expires_at=? WHERE command_id=?')
      .run('2001-01-01T00:00:00.000Z', id);
    const late = await api('POST', '/api/commands/' + id + '/approve');
    expect(late.status).toBe(409);
    expect(late.data.error.code).toBe('APPROVAL_EXPIRED');
    const command = await api('GET', '/api/commands/' + id);
    expect(command.data.status).toBe('timed_out');
    expect(received.some(m => m.type === 'command' && m.command.id === id)).toBe(false);
  });
});
