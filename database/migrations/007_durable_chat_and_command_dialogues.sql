-- Phase 1: retain conversation context across browser and relay restarts.
-- Never store WhatsApp chat reads, screenshots, controller tokens, or secret tool outputs here.
CREATE TABLE IF NOT EXISTS ai_chat_turns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_chat_turns_owner ON ai_chat_turns(user_id, created_at);

-- Deterministic parser questions previously existed only in a Node Map.
-- There is one active non-project command dialogue per authenticated owner.
CREATE TABLE IF NOT EXISTS command_dialogues (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_command_dialogues_expiry ON command_dialogues(expires_at);
