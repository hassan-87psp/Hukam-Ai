-- HUKM AI relay schema (SQLite). Applied automatically by the relay on start-up.
-- All rows that belong to a person carry user_id; every query in the relay is scoped by it.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  user_agent  TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS devices (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  secret_hash           TEXT NOT NULL UNIQUE,
  os                    TEXT,
  os_version            TEXT,
  hostname              TEXT,
  controller_version    TEXT,
  capabilities_reported TEXT NOT NULL DEFAULT '[]',
  capabilities_enabled  TEXT NOT NULL DEFAULT '[]',
  controller_config     TEXT,
  status                TEXT NOT NULL DEFAULT 'paired' CHECK (status IN ('paired','revoked')),
  paused                INTEGER NOT NULL DEFAULT 0,
  stats                 TEXT,
  last_seen             TEXT,
  created_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

CREATE TABLE IF NOT EXISTS pairing_codes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  device_name TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  device_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_pairing_code ON pairing_codes(code_hash);

CREATE TABLE IF NOT EXISTS commands (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id          TEXT REFERENCES devices(id) ON DELETE SET NULL,
  client_request_id  TEXT,
  source             TEXT NOT NULL,
  input_text         TEXT,
  action             TEXT NOT NULL,
  args               TEXT NOT NULL DEFAULT '{}',
  requires_approval  INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL CHECK (status IN ('pending','awaiting_approval','running','completed','failed','cancelled','timed_out')),
  timeout_ms         INTEGER NOT NULL,
  created_at         TEXT NOT NULL,
  approved_at        TEXT,
  dispatched_at      TEXT,
  delivered_at       TEXT,
  started_at         TEXT,
  finished_at        TEXT,
  duration_ms        INTEGER,
  result             TEXT,
  error_code         TEXT,
  error_message      TEXT,
  automation_run_id  TEXT,
  screenshot_id      TEXT,
  UNIQUE (user_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_commands_user_created ON commands(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commands_device_status ON commands(device_id, status);
CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status);

CREATE TABLE IF NOT EXISTS command_approvals (
  id           TEXT PRIMARY KEY,
  command_id   TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  decided_at   TEXT,
  decision     TEXT CHECK (decision IN ('approved','rejected','expired')),
  summary      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approvals_command ON command_approvals(command_id);

CREATE TABLE IF NOT EXISTS connection_events (
  id         TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  event      TEXT NOT NULL CHECK (event IN ('connected','disconnected','paired','unpaired','paused','resumed')),
  ip         TEXT,
  at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conn_device ON connection_events(device_id, at DESC);

CREATE TABLE IF NOT EXISTS automations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       TEXT REFERENCES devices(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  steps           TEXT NOT NULL DEFAULT '[]',
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_run_at     TEXT,
  last_run_status TEXT
);
CREATE INDEX IF NOT EXISTS idx_automations_user ON automations(user_id);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings   TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id        TEXT PRIMARY KEY,
  user_id   TEXT REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT,
  actor     TEXT NOT NULL CHECK (actor IN ('user','device','system')),
  event     TEXT NOT NULL,
  detail    TEXT,
  ip        TEXT,
  at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user_at ON audit_logs(user_id, at DESC);

CREATE TABLE IF NOT EXISTS screenshots (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id   TEXT REFERENCES devices(id) ON DELETE SET NULL,
  command_id  TEXT REFERENCES commands(id) ON DELETE SET NULL,
  file_name   TEXT NOT NULL,
  mime        TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_screens_user ON screenshots(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_screens_expiry ON screenshots(expires_at);
