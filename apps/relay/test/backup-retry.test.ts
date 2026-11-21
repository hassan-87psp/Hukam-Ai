import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DB } from '../src/db';
import { startCloudBackup } from '../src/backup';

describe('cloud snapshot failure recovery (isolated, no network)', () => {
  let dir: string;
  let checkpoint: ReturnType<typeof vi.fn>;
  let backup: ReturnType<typeof startCloudBackup>;
  let upload: ReturnType<typeof vi.fn>;

  function fixtureBytes() {
    // Header-format fixture only; this does not test SQLite restore integrity.
    const bytes = Buffer.alloc(4096);
    Buffer.from('SQLite format 3\\0', 'ascii').copy(bytes);
    writeFileSync(join(dir, 'hukm.db'), bytes);
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
