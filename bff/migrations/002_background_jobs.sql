CREATE TABLE IF NOT EXISTS xiakeman_background_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES xiakeman_users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  chapter_id TEXT,
  storyboard_index INTEGER,
  parent_job_id TEXT REFERENCES xiakeman_background_jobs(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'paused')),
  priority INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  idempotency_key TEXT,
  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  progress_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_json JSONB,
  media_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS xiakeman_background_jobs_user_updated_idx
  ON xiakeman_background_jobs (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS xiakeman_background_jobs_project_idx
  ON xiakeman_background_jobs (user_id, project_id, chapter_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS xiakeman_background_jobs_status_idx
  ON xiakeman_background_jobs (status, priority DESC, queued_at ASC);
CREATE UNIQUE INDEX IF NOT EXISTS xiakeman_background_jobs_idempotency_idx
  ON xiakeman_background_jobs (user_id, type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS xiakeman_background_job_events (
  job_id TEXT NOT NULL REFERENCES xiakeman_background_jobs(id) ON DELETE CASCADE,
  seq BIGSERIAL,
  level TEXT NOT NULL DEFAULT 'info'
    CHECK (level IN ('debug', 'info', 'retry', 'warning', 'error', 'success')),
  phase TEXT,
  message TEXT NOT NULL,
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, seq)
);

CREATE INDEX IF NOT EXISTS xiakeman_background_job_events_job_idx
  ON xiakeman_background_job_events (job_id, seq DESC);
