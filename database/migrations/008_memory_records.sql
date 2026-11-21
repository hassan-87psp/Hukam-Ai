-- Explicit owner-managed long-term memory; existing notes/chat preserved.
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_id_owner ON projects(id,user_id);
CREATE TABLE memory_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  category TEXT NOT NULL CHECK(category IN ('personal','conversation','project','computer','skills','experience','contacts','routines')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 1800),
  use_in_ai INTEGER NOT NULL DEFAULT 0 CHECK(use_in_ai IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id,user_id) REFERENCES projects(id,user_id) ON DELETE CASCADE
);
CREATE INDEX idx_memory_scope ON memory_records(user_id,project_id,updated_at DESC);
