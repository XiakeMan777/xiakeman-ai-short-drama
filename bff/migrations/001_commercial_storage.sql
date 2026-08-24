CREATE TABLE IF NOT EXISTS xiakeman_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  password_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS xiakeman_users_email_lower_idx
  ON xiakeman_users (lower(email));

CREATE TABLE IF NOT EXISTS xiakeman_auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES xiakeman_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS xiakeman_auth_sessions_user_idx
  ON xiakeman_auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS xiakeman_auth_sessions_expires_idx
  ON xiakeman_auth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS xiakeman_cloud_projects (
  user_id TEXT NOT NULL REFERENCES xiakeman_users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  exported_at TIMESTAMPTZ,
  project_json JSONB NOT NULL,
  chapter_count INTEGER NOT NULL DEFAULT 0,
  blob_count INTEGER NOT NULL DEFAULT 0,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS xiakeman_cloud_projects_user_updated_idx
  ON xiakeman_cloud_projects (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS xiakeman_cloud_project_blobs (
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  blob_key TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id, blob_key),
  FOREIGN KEY (user_id, project_id)
    REFERENCES xiakeman_cloud_projects(user_id, project_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS xiakeman_cloud_project_blobs_project_idx
  ON xiakeman_cloud_project_blobs (user_id, project_id);

CREATE TABLE IF NOT EXISTS xiakeman_app_settings (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
