import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type DB } from '../src/db';
import { restoreCloudSnapshot, startCloudBackup } from '../src/backup';

describe('cloud snapshot failure recovery (isolated, no network)', () => {
  let dir: string;
  let checkpoint: ReturnType<typeof vi.fn>;
  let backup: ReturnType<typeof startCloudBackup>;
  let upload: ReturnType<typeof vi.fn>;

  function fixtureBytes() {
    // Use a real SQLite file, not handcrafted signature bytes.
    const migrations = join(dir, 'migrations');
    mkdirSync(migrations, { recursive: true });
    const db = openDb(dir, migrations);
    try {
      db.exec("CREATE TABLE IF NOT EXISTS sample (value TEXT NOT NULL)");
      db.exec("INSERT INTO sample VALUES ('test-only')");
    } finally { db.close(); }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hukm-backup-'));
    vi.stubEnv('HUKM_BACKUP_URL', 'https://backup.example.test/snapshot');
    vi.stubEnv('HUKM_BACKUP_TOKEN', 'test-only');
    checkpoint = vi.fn().mockReturnValue({ busy: 0, log: 0, checkpointed: 0 });
    const db = { prepare: vi.fn(() => ({ get: checkpoint })) } as unknown as DB;
    upload = vi.fn().mockImplementation(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', upload);
    backup = startCloudBackup(db, dir);
    fixtureBytes();
  });

  afterEach(async () => {
    try { await backup.close(); }
    finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not upload a busy checkpoint and retains dirty state for retry', async () => {
    checkpoint.mockReturnValueOnce({ busy: 1, log: 4, checkpointed: 2 });
    backup.markDirty();
    await expect(backup.flush()).rejects.toThrow('checkpoint incomplete');
    expect(upload).not.toHaveBeenCalled();
    await backup.flush();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('rejects incomplete frames even when busy is zero', async () => {
    checkpoint.mockReturnValueOnce({ busy: 0, log: 5, checkpointed: 3 });
    backup.markDirty();
    await expect(backup.flush()).rejects.toThrow('checkpoint incomplete');
    expect(upload).not.toHaveBeenCalled();
    await backup.flush();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('retries after a SQLite checkpoint exception without a new mutation', async () => {
    checkpoint.mockImplementationOnce(() => { throw new Error('database locked'); });
    backup.markDirty();
    await expect(backup.flush()).rejects.toThrow('database locked');
    expect(upload).not.toHaveBeenCalled();
    await backup.flush();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('retries after a local snapshot read error without a new mutation', async () => {
    rmSync(join(dir, 'hukm.db'));
    backup.markDirty();
    await expect(backup.flush()).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
    fixtureBytes();
    await backup.flush();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed cloud upload and skips unchanged snapshots', async () => {
    upload.mockResolvedValueOnce(new Response(null, { status: 503 }));
    backup.markDirty();
    await expect(backup.flush()).rejects.toThrow('HTTP 503');
    await backup.flush();
    await backup.flush();
    expect(upload).toHaveBeenCalledTimes(2);
  });
});

describe('real SQLite snapshot round trip (isolated, mocked transport)', () => {
  it('checkpoints real WAL writes and restores the exact sample row', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hukm-backup-roundtrip-'));
    const source = join(dir, 'source');
    const target = join(dir, 'target');
    const migrations = join(dir, 'migrations');
    mkdirSync(migrations);
    vi.stubEnv('HUKM_BACKUP_URL', 'https://backup.example.test/snapshot');
    vi.stubEnv('HUKM_BACKUP_TOKEN', 'test-only');
    let bytes: Uint8Array | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        bytes = new Uint8Array(init.body as Uint8Array);
        return new Response(null, { status: 200 });
      }
      if (!bytes) throw new Error('No test snapshot saved');
      return new Response(bytes, { status: 200 });
    }));
    const db = openDb(source, migrations);
    const backup = startCloudBackup(db, source);
    try {
      db.exec("CREATE TABLE sample (value TEXT NOT NULL)");
      db.prepare('INSERT INTO sample VALUES (?)').run('isolated-test-row');
      backup.markDirty();
      await backup.flush();
      expect(bytes?.byteLength).toBeGreaterThan(100);
      expect(await restoreCloudSnapshot(target)).toBe(true);
      const restored = openDb(target, migrations);
      try {
        expect(restored.prepare('SELECT value FROM sample').get()).toEqual({ value: 'isolated-test-row' });
        expect(restored.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      } finally { restored.close(); }
    } finally {
      try { await backup.close(); }
      finally {
        db.close();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
