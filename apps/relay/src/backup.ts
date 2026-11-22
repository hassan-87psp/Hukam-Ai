/**
 * Testing-only cloud persistence for HUKM AI SQLite on Render Free.
 * Snapshots live in a separate private bucket in Milvoy Supabase Storage.
 * Does not modify Milvoy application tables.
 */
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { DB } from './db';
import { log } from './util';
import { readBoundedBytes } from './cloud-transport';

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
  const bytes = await readBoundedBytes(response,MAX_BYTES);
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
      const violations = candidate.prepare('PRAGMA foreign_key_check').all();
      if (checks.length !== 1 || checks[0].integrity_check !== 'ok' || !schema || violations.length !== 0)
        throw new Error('Cloud SQLite snapshot integrity or schema check failed');
    } finally { candidate.close(); }
    const local = join(dataDir,'hukm.db');
    if(existsSync(local+'-wal') && statSync(local+'-wal').size>0)
      throw new Error('Local SQLite WAL needs recovery; cloud restore refused');
    if(existsSync(local+'-journal') && statSync(local+'-journal').size>0)
      throw new Error('Local SQLite journal needs recovery; cloud restore refused');
    if(existsSync(local)) {
      if(statSync(local).size!==bytes.length || !readFileSync(local).equals(bytes))
        throw new Error('Local and cloud SQLite snapshots differ; preserve both for owner-reviewed recovery');
      log('info','HUKM local database already matches cloud snapshot');
      return false;
    }
    // Atomic, non-replacing installation in the same filesystem.
    linkSync(temp,local);
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
  let failures=0;
  let lastUploadAt:string|null=null;
  // Bounded, single retry timer. No background tight loop or repeated log of
  // provider exceptions that may contain sensitive configuration.
  function schedule(delay:number){
    if(closed||!auth||timer)return;
    timer=setTimeout(()=>{
      timer=null;
      void flush().catch(()=>{});
    },delay);
    timer.unref?.();
  }
  function failed(){
    dirty=true;
    failures=Math.min(failures+1,8);
    log('error','HUKM private backup failed; local writes retained for retry',{failures});
    schedule(Math.min(300_000,5000*2**(failures-1)));
  }

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
      const snapshotPath=join(dataDir,'hukm.db');
      const length=statSync(snapshotPath).size;
      if(length<100||length>MAX_BYTES)throw new Error('SQLite snapshot exceeds configured size limit');
      bytes = readFileSync(snapshotPath);
      if (bytes.length < 100 || bytes.length > MAX_BYTES || !bytes.subarray(0,16).equals(HEADER)) {
        throw new Error('SQLite snapshot validation failed');
      }
    } catch (e) {
      failed();
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
      failures=0;
      lastUploadAt=new Date().toISOString();
      log('info', 'HUKM SQLite snapshot saved to Milvoy private storage', { bytes: bytes.length });
    })();
    try { await pending; }
    catch (e) { failed(); throw e; }
    finally { pending = null; }
    if (dirty) await flush();
  }

  function markDirty() {
    if (!auth || closed) return;
    dirty = true;
    // Do not postpone backup indefinitely under continuous telemetry.
    schedule(failures ? Math.min(300_000,5000*2**(failures-1)) : 500);
  }

  async function close() {
    if (timer) { clearTimeout(timer); timer = null; }
    closed=true;
    await flush();
  }
  return { enabled: !!auth, flush, markDirty, close,
    status:()=>({enabled:!!auth,dirty,pending:pending!==null,lastUploadAt,consecutiveFailures:failures}) };
}
