-- HUKM Projects: owner-scoped durable instructions, conversations and notes.
-- No credentials or browser cookies are stored here.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  chrome_profile TEXT NOT NULL DEFAULT '',
  chatgpt_project_url TEXT NOT NULL DEFAULT '',
  asset_folder TEXT NOT NULL DEFAULT '',
  preferred_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_messages ON project_messages(user_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_notes ON project_notes(user_id, project_id, updated_at DESC);
