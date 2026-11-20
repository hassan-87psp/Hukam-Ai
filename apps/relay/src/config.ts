import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Both src/ and dist/ sit at apps/relay/<x>/, so these relative paths work for dev and build.
const projectRoot = resolve(here, '../../..');

export interface RelayConfig {
  port: number;
  host: string;
  dataDir: string;
  publicDir: string;
  migrationsDir: string;
  sessionTtlDays: number;
  trustProxy: boolean;
  /** Optional fixed setup code; otherwise a random one is printed on first start. */
  setupCode: string | null;
  allowedOrigins: string[];
  queueTtlMs: number;
  approvalTtlMs: number;
  heartbeatTimeoutMs: number;
}

export function loadConfig(overrides: Partial<RelayConfig> = {}): RelayConfig {
  const env = process.env;
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    dataDir: resolve(env.DATA_DIR ?? resolve(projectRoot, 'data')),
    publicDir: resolve(env.PUBLIC_DIR ?? resolve(projectRoot, 'apps/web/dist')),
    migrationsDir: resolve(env.MIGRATIONS_DIR ?? resolve(projectRoot, 'database/migrations')),
    sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? 30),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    setupCode: env.SETUP_CODE || null,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    queueTtlMs: Number(env.QUEUE_TTL_MS ?? 5 * 60_000),
    approvalTtlMs: Number(env.APPROVAL_TTL_MS ?? 10 * 60_000),
    heartbeatTimeoutMs: Number(env.HEARTBEAT_TIMEOUT_MS ?? 75_000),
    ...overrides,
  };
}
