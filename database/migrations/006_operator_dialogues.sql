-- Owner-scoped, expiring clarification slots for multi-turn HUKM AI tasks.
-- No passwords, WhatsApp chat contents or screen captures stored here.
CREATE TABLE IF NOT EXISTS operator_dialogues (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_key TEXT NOT NULL DEFAULT 'general',
  request TEXT NOT NULL,
  question TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT 'ai-followup',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(user_id, project_key)
);
CREATE INDEX IF NOT EXISTS idx_operator_dialogues_expiry ON operator_dialogues(expires_at);
