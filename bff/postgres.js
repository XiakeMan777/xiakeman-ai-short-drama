const { Pool } = require('pg');

let pool;
let schemaReadyPromise;

function isPostgresConfigured() {
  return !!String(process.env.DATABASE_URL || '').trim();
}

function buildPoolConfig() {
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for Postgres storage');
  }

  const sslMode = String(process.env.POSTGRES_SSL || process.env.PGSSLMODE || '').toLowerCase();
  const config = {
    connectionString,
    max: Number(process.env.POSTGRES_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.POSTGRES_IDLE_TIMEOUT_MS || 30_000),
    connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS || 10_000),
  };

  if (sslMode === 'true' || sslMode === 'require' || sslMode === '1') {
    config.ssl = { rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED === 'true' };
  }

  return config;
}

function getPostgresPool() {
  if (!pool) {
    pool = new Pool(buildPoolConfig());
  }
  return pool;
}

async function query(text, params = []) {
  return await getPostgresPool().query(text, params);
}

async function withTransaction(callback) {
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function ensureCommercialSchema() {
  if (!isPostgresConfigured()) {
    throw new Error('DATABASE_URL is required for Postgres storage');
  }
  if (schemaReadyPromise) return schemaReadyPromise;

  schemaReadyPromise = (async () => {
    await query(`
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

      CREATE TABLE IF NOT EXISTS xiakeman_agent_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES xiakeman_users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS xiakeman_agent_keys_user_idx
        ON xiakeman_agent_keys (user_id);
      CREATE INDEX IF NOT EXISTS xiakeman_agent_keys_hash_idx
        ON xiakeman_agent_keys (key_hash);

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
        object_key TEXT NOT NULL,
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
      CREATE INDEX IF NOT EXISTS xiakeman_cloud_project_blobs_hash_idx
        ON xiakeman_cloud_project_blobs (user_id, project_id, sha256, size_bytes);
      CREATE INDEX IF NOT EXISTS xiakeman_cloud_project_blobs_object_idx
        ON xiakeman_cloud_project_blobs (object_key);
      ALTER TABLE xiakeman_cloud_project_blobs
        DROP CONSTRAINT IF EXISTS xiakeman_cloud_project_blobs_object_key_key;

      CREATE TABLE IF NOT EXISTS xiakeman_app_settings (
        key TEXT PRIMARY KEY,
        value_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

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
    `);
  })();

  return schemaReadyPromise;
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

module.exports = {
  ensureCommercialSchema,
  getPostgresPool,
  isPostgresConfigured,
  query,
  toIso,
  withTransaction,
};
