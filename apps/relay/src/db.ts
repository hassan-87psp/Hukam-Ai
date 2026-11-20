import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
// node:sqlite ships with Node 22.13+ (no native build step needed on Windows).
// Loaded via require so bundlers/test runners don't try to resolve it.
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
import { log, nowIso } from './util';

export type DB = DatabaseSyncT;

const writeHooks = new WeakMap<DB, () => void>();
export function setWriteHook(db: DB, hook: () => void) { writeHooks.set(db, hook); }

export function openDb(dataDir: string, migrationsDir: string): DB {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'hukm.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set((db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(migrationsDir, f), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, nowIso());
      db.exec('COMMIT');
      log('info', 'migration applied', { file: f });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

export type Row = Record<string, any>;
export const one = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
export const all = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
export const run = (db: DB, sql: string, ...p: any[]) => {
  const result = db.prepare(sql).run(...p);
  writeHooks.get(db)?.();
  return result;
};
