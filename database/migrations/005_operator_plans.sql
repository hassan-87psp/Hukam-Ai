-- Owner-reviewed AI action plans. They do NOT bypass per-command approval.
CREATE TABLE IF NOT EXISTS operator_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  request TEXT NOT NULL,
  summary TEXT NOT NULL,
  steps TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_operator_plans_owner ON operator_plans(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS operator_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES operator_plans(id) ON DELETE SET NULL,
  device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  current_step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 0,
  command_ids TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_operator_runs_owner ON operator_runs(user_id,created_at DESC);
