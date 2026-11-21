/**
 * Testing-only cloud persistence for HUKM AI SQLite on Render Free.
 * Snapshots live in a separate private bucket in Milvoy Supabase Storage.
 * Does not modify Milvoy application tables.
 */
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { DB } from './db';
import { log } from './util';

const HEADER = Buffer.from('SQLite format 3\0', 'ascii');
const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT = 25_000;

function settings(): { url: string; token: string } | null {
  const url = (process.env.HUKM_BACKUP_URL || '').trim();
  const token = (process.env.HUKM_BACKUP_TOKEN || '').trim();
  if (!url && !token) return null;
  if (!url || !token) throw new Error('Both HUKM_BACKUP_URL and HUKM_BACKUP_TOKEN are required');
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { throw new Error('Invalid HUKM_BACKUP_URL'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.hash)
    throw new Error('HUKM_BACKUP_URL must be HTTPS without embedded credentials or fragments');
  return { url, token };
}

export async function restoreCloudSnapshot(dataDir: string): Promise<boolean> {
  const auth = settings();
  if (!auth) return false;
  // Fail closed: a transient cloud error must not reset user login or pairing.
  const response = await fetch(auth.url, {
    method: 'GET',
    redirect: 'error',
    headers: { 'x-hukm-backup-token': auth.token, 'cache-control': 'no-store' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (response.status === 404) {
    log('info', 'no existing HUKM cloud backup, awaiting first account setup');
    return false;
  }
  if (!response.ok) throw new Error('Cloud restore failed: HTTP ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100 || bytes.length > MAX_BYTES || !bytes.subarray(0,16).equals(HEADER))
    throw new Error('Invalid cloud SQLite backup; refusing to start');
  mkdirSync(dataDir, { recursive: true });
  const scratch = mkdtempSync(join(dataDir, 'restore-check-'));
  const temp = join(scratch, 'snapshot.db');
  try {
    writeFileSync(temp, bytes, { mode: 0o600 });
    // Validate a separate temporary file before touching the current database.
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    const candidate = new DatabaseSync(temp, { readOnly: true });
    try {
      const checks = candidate.prepare('PRAGMA integrity_check').all();
      const schema = candidate.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
      if (checks.length !== 1 || checks[0].integrity_check !== 'ok' || !schema)
        throw new Error('Cloud SQLite snapshot integrity or schema check failed');
    } finally { candidate.close(); }
    renameSync(temp, join(dataDir, 'hukm.db'));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  log('info', 'HUKM database restored from private Milvoy storage', { bytes: bytes.length });
  return true;
}

export function startCloudBackup(db: DB, dataDir: string) {
  const auth = settings();
  let dirty = false;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Promise<void> | null = null;

  async function flush(): Promise<void> {
    if (!auth) return;
    if (timer) { clearTimeout(timer); timer = null; }
    if (pending) {
      await pending;
      if (dirty) await flush();
      return;
    }
    if (!dirty) return;
    dirty = false;
    let bytes: Buffer;
    try {
      // Never upload a main-file snapshot if SQLite could not checkpoint
      // every WAL frame. Preserve dirty state for a later retry on ANY error.
      const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
        { busy: number; log: number; checkpointed: number } | undefined;
      if (!checkpoint || checkpoint.busy !== 0 || checkpoint.log !== checkpoint.checkpointed) {
        throw new Error('SQLite snapshot checkpoint incomplete');
      }
      bytes = readFileSync(join(dataDir, 'hukm.db'));
      if (bytes.length < 100 || bytes.length > MAX_BYTES || !bytes.subarray(0,16).equals(HEADER)) {
        throw new Error('SQLite snapshot validation failed');
      }
    } catch (e) {
      dirty = true;
      throw e;
    }
    pending = (async () => {
      const response = await fetch(auth.url, {
        method: 'PUT',
        redirect: 'error',
        headers: {
          'x-hukm-backup-token': auth.token,
          'content-type': 'application/octet-stream',
          'cache-control': 'no-store',
        },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!response.ok) throw new Error('Cloud backup save failed: HTTP ' + response.status);
      log('info', 'HUKM SQLite snapshot saved to Milvoy private storage', { bytes: bytes.length });
    })();
    try { await pending; }
    catch (e) { dirty = true; throw e; }
    finally { pending = null; }
    if (dirty) await flush();
  }

  function markDirty() {
    if (!auth || closed) return;
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush().catch((e) => {
        log('error', 'HUKM backup failed; retry scheduled', { error: String(e) });
        if (!closed) {
          timer = setTimeout(() => void flush().catch((err) => log('error', 'HUKM backup retry failed', { error: String(err) })), 5000);
          timer.unref?.();
        }
      });
    }, 500);
    timer.unref?.();
  }

  async function close() {
    if (timer) { clearTimeout(timer); timer = null; }
    try { await flush(); } finally { closed = true; }
  }
  return { enabled: !!auth, flush, markDirty, close };
}
