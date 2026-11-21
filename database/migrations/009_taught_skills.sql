-- Owner-reviewed names for fixed, bounded recipes. No arbitrary code or commands.
CREATE TABLE taught_skills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  alias TEXT NOT NULL CHECK(length(alias) BETWEEN 1 AND 80),
  alias_key TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id,user_id) REFERENCES projects(id,user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_taught_skill_scope_project ON taught_skills(user_id,project_id,alias_key) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX idx_taught_skill_scope_general ON taught_skills(user_id,alias_key) WHERE project_id IS NULL;
