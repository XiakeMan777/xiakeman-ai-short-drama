const express = require('express');
const crypto = require('crypto');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  ensureCommercialSchema,
  isPostgresConfigured,
  query,
  toIso,
  withTransaction,
} = require('./postgres');

const JOB_STORE_ROOT = process.env.BACKGROUND_JOBS_DIR
  || path.join(process.env.CLOUD_STORAGE_DIR || path.join(os.tmpdir(), 'xiakeman-cloud-store'), 'background-jobs');
const DEFAULT_JOB_LIMIT = 50;
const MAX_JOB_LIMIT = 200;
const MAX_EVENT_LIMIT = 200;
const DEFAULT_WORKER_LEASE_MS = 5 * 60_000;
const MAX_WORKER_LEASE_MS = 30 * 60_000;
const DEFAULT_STALE_WORKER_MS = 4 * 60_000;
const MAX_STALE_WORKER_MS = 30 * 60_000;
const FILE_STORE_WRITE_RETRY_DELAYS_MS = [80, 160, 320, 640, 1000];

const JOB_TYPES = new Set([
  'step0-series',
  'step1-analysis',
  'step2-analysis',
  'step3-assets',
  'step4-storyboards',
  'step5-videos',
  'step6-tts',
  'step6-bgm',
  'step6-render',
  'project-sync',
  'llm-completions',
  'image-generations',
]);

const JOB_STATUSES = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'paused']);
const EVENT_LEVELS = new Set(['debug', 'info', 'retry', 'warning', 'error', 'success']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getJobStoreDriver() {
  const configured = String(process.env.BACKGROUND_JOB_STORE_DRIVER || process.env.JOB_STORE_DRIVER || '').toLowerCase();
  if (configured) return configured;
  return isPostgresConfigured() ? 'postgres' : 'file';
}

function isPostgresJobStoreEnabled() {
  const driver = getJobStoreDriver();
  return driver === 'postgres' || driver === 'pg';
}

function randomId(prefix = 'job') {
  return `${prefix}_${crypto.randomBytes(18).toString('base64url')}`;
}

function sanitizeSegment(value, label) {
  const segment = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment)) {
    throw new HttpError(400, `${label} contains unsupported characters`);
  }
  return segment;
}

function sanitizeOptionalSegment(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  return sanitizeSegment(value, label);
}

function sanitizeText(value, label, maxLength = 1000) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (text.length > maxLength) throw new HttpError(400, `${label} is too long`);
  return text || undefined;
}

function sanitizeJobType(value) {
  const type = String(value || '').trim();
  if (!JOB_TYPES.has(type)) throw new HttpError(400, 'Unsupported background job type');
  return type;
}

function sanitizeJobTypes(value) {
  if (value === undefined || value === null || value === '') return Array.from(JOB_TYPES);
  const values = Array.isArray(value) ? value : String(value).split(',');
  const types = values.map((item) => sanitizeJobType(item)).filter(Boolean);
  return Array.from(new Set(types));
}

function sanitizeJobStatus(value, fallback = 'queued') {
  if (value === undefined || value === null || value === '') return fallback;
  const status = String(value).trim();
  if (!JOB_STATUSES.has(status)) throw new HttpError(400, 'Unsupported background job status');
  return status;
}

function sanitizeEventLevel(value, fallback = 'info') {
  if (value === undefined || value === null || value === '') return fallback;
  const level = String(value).trim();
  if (!EVENT_LEVELS.has(level)) throw new HttpError(400, 'Unsupported background job event level');
  return level;
}

function sanitizeJson(value, label) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw new HttpError(400, `${label} must be an object`);
  return value;
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampDurationMs(value, fallback = DEFAULT_WORKER_LEASE_MS) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return fallback;
  return Math.min(MAX_WORKER_LEASE_MS, Math.max(30_000, Math.round(seconds * 1000)));
}

function clampStaleDurationMs(value, fallback = DEFAULT_STALE_WORKER_MS) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return fallback;
  return Math.min(MAX_STALE_WORKER_MS, Math.max(60_000, Math.round(seconds * 1000)));
}

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    chapterId: row.chapter_id || undefined,
    storyboardIndex: row.storyboard_index === null || row.storyboard_index === undefined
      ? undefined
      : Number(row.storyboard_index),
    parentJobId: row.parent_job_id || undefined,
    type: row.type,
    status: row.status,
    priority: Number(row.priority || 0),
    attempt: Number(row.attempt || 0),
    maxAttempts: Number(row.max_attempts || 3),
    idempotencyKey: row.idempotency_key || undefined,
    input: row.input_json || {},
    progress: row.progress_json || {},
    output: row.output_json || {},
    error: row.error_json || undefined,
    media: row.media_json || {},
    leaseOwner: row.lease_owner || undefined,
    leaseExpiresAt: toIso(row.lease_expires_at) || undefined,
    createdAt: toIso(row.created_at) || nowIso(),
    updatedAt: toIso(row.updated_at) || nowIso(),
    queuedAt: toIso(row.queued_at) || undefined,
    startedAt: toIso(row.started_at) || undefined,
    completedAt: toIso(row.completed_at) || undefined,
  };
}

function rowToEvent(row) {
  return {
    jobId: row.job_id,
    seq: Number(row.seq),
    level: row.level,
    phase: row.phase || undefined,
    message: row.message,
    data: row.data_json || {},
    createdAt: toIso(row.created_at) || nowIso(),
  };
}

function getUserJobsFile(userId) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  return path.join(JOB_STORE_ROOT, 'users', normalizedUserId, 'jobs.json');
}

async function readFileStore(userId) {
  const filePath = getUserJobsFile(userId);
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      events: isPlainObject(parsed.events) ? parsed.events : {},
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { version: 1, jobs: [], events: {} };
    throw error;
  }
}

async function writeFileStore(userId, store) {
  const filePath = getUserJobsFile(userId);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tempPath, JSON.stringify(store), 'utf8');
  try {
    try {
      await retryFileStoreWrite(() => fsp.rename(tempPath, filePath));
    } catch (error) {
      if (!isRetryableFileStoreWriteError(error)) throw error;
      await retryFileStoreWrite(async () => {
        await fsp.copyFile(tempPath, filePath);
        await fsp.rm(tempPath, { force: true });
      });
    }
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

const fileStoreLocks = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableFileStoreWriteError(error) {
  return error && ['EPERM', 'EBUSY', 'EACCES'].includes(error.code);
}

async function retryFileStoreWrite(operation) {
  let lastError;
  for (let attempt = 0; attempt <= FILE_STORE_WRITE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableFileStoreWriteError(error) || attempt >= FILE_STORE_WRITE_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await sleep(FILE_STORE_WRITE_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

async function withFileStoreLock(userId, task) {
  const lockKey = sanitizeSegment(userId, 'userId');
  const previous = fileStoreLocks.get(lockKey) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  fileStoreLocks.set(lockKey, tail);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (fileStoreLocks.get(lockKey) === tail) {
      fileStoreLocks.delete(lockKey);
    }
  }
}

function filterFileJobs(jobs, filters) {
  return jobs.filter((job) => {
    if (filters.projectId && job.projectId !== filters.projectId) return false;
    if (filters.chapterId && job.chapterId !== filters.chapterId) return false;
    if (filters.type && job.type !== filters.type) return false;
    if (filters.status && job.status !== filters.status) return false;
    return true;
  });
}

function filterAdminJobs(jobs, filters) {
  return jobs.filter((job) => {
    if (filters.projectId && job.projectId !== filters.projectId) return false;
    if (filters.chapterId && job.chapterId !== filters.chapterId) return false;
    if (filters.userId && job.userId !== filters.userId) return false;
    if (filters.type && job.type !== filters.type) return false;
    if (filters.status && job.status !== filters.status) return false;
    return true;
  });
}

function createJobStatusCounts(jobs) {
  const counts = {};
  for (const status of JOB_STATUSES) counts[status] = 0;
  for (const job of jobs) {
    counts[job.status] = (counts[job.status] || 0) + 1;
  }
  return counts;
}

function createJobTypeCounts(jobs) {
  const counts = {};
  for (const job of jobs) {
    counts[job.type] = (counts[job.type] || 0) + 1;
  }
  return counts;
}

function isLeaseExpired(job) {
  return job.status === 'running'
    && job.leaseExpiresAt
    && Date.parse(job.leaseExpiresAt) < Date.now();
}

function isStaleNonRecoverableJob(job) {
  return job?.type === 'llm-completions';
}

function getInterruptedNonRecoverableJobMessage(job) {
  if (job?.type === 'llm-completions') {
    return 'Background LLM worker stopped before saving the result. The upstream request may already have been charged; please retry manually.';
  }
  return 'Background worker stopped before saving the result. Please retry manually.';
}

async function createPostgresJob(userId, input) {
  await ensureCommercialSchema();
  if (input.idempotencyKey) {
    const existing = await query(`
      SELECT * FROM xiakeman_background_jobs
      WHERE user_id = $1 AND type = $2 AND idempotency_key = $3
      LIMIT 1
    `, [userId, input.type, input.idempotencyKey]);
    if (existing.rows[0]) return { job: rowToJob(existing.rows[0]), reused: true };
  }

  const id = input.id || randomId();
  const result = await query(`
    INSERT INTO xiakeman_background_jobs (
      id, user_id, project_id, chapter_id, storyboard_index, parent_job_id,
      type, status, priority, max_attempts, idempotency_key,
      input_json, progress_json, media_json
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12::jsonb, $13::jsonb, $14::jsonb
    )
    RETURNING *
  `, [
    id,
    userId,
    input.projectId,
    input.chapterId ?? null,
    input.storyboardIndex ?? null,
    input.parentJobId ?? null,
    input.type,
    input.status || 'queued',
    input.priority,
    input.maxAttempts,
    input.idempotencyKey ?? null,
    JSON.stringify(input.input || {}),
    JSON.stringify(input.progress || {}),
    JSON.stringify(input.media || {}),
  ]);

  return { job: rowToJob(result.rows[0]), reused: false };
}

async function listPostgresJobs(userId, filters) {
  await ensureCommercialSchema();
  const clauses = ['user_id = $1'];
  const params = [userId];
  for (const [key, column] of [
    ['projectId', 'project_id'],
    ['chapterId', 'chapter_id'],
    ['type', 'type'],
    ['status', 'status'],
  ]) {
    if (!filters[key]) continue;
    params.push(filters[key]);
    clauses.push(`${column} = $${params.length}`);
  }
  params.push(filters.limit);
  const result = await query(`
    SELECT * FROM xiakeman_background_jobs
    WHERE ${clauses.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT $${params.length}
  `, params);
  return result.rows.map(rowToJob);
}

async function listPostgresJobsForAdmin(filters) {
  await ensureCommercialSchema();
  const clauses = [];
  const params = [];
  for (const [key, column] of [
    ['userId', 'user_id'],
    ['projectId', 'project_id'],
    ['chapterId', 'chapter_id'],
    ['type', 'type'],
    ['status', 'status'],
  ]) {
    if (!filters[key]) continue;
    params.push(filters[key]);
    clauses.push(`${column} = $${params.length}`);
  }
  params.push(filters.limit);
  const result = await query(`
    SELECT * FROM xiakeman_background_jobs
    ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY updated_at DESC
    LIMIT $${params.length}
  `, params);
  return result.rows.map(rowToJob);
}

async function getPostgresJobSummaryForAdmin() {
  await ensureCommercialSchema();
  const [statusResult, typeResult, expiredResult, recentResult] = await Promise.all([
    query(`
      SELECT status, count(*)::int AS count
      FROM xiakeman_background_jobs
      GROUP BY status
    `),
    query(`
      SELECT type, count(*)::int AS count
      FROM xiakeman_background_jobs
      GROUP BY type
    `),
    query(`
      SELECT count(*)::int AS count
      FROM xiakeman_background_jobs
      WHERE status = 'running'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at < now()
    `),
    query(`
      SELECT *
      FROM xiakeman_background_jobs
      ORDER BY updated_at DESC
      LIMIT 12
    `),
  ]);

  const statusCounts = {};
  for (const status of JOB_STATUSES) statusCounts[status] = 0;
  for (const row of statusResult.rows) statusCounts[row.status] = Number(row.count || 0);

  const typeCounts = {};
  for (const row of typeResult.rows) typeCounts[row.type] = Number(row.count || 0);

  const total = Object.values(statusCounts).reduce((sum, value) => sum + Number(value || 0), 0);
  return {
    total,
    statusCounts,
    typeCounts,
    activeCount: (statusCounts.running || 0) + (statusCounts.queued || 0) + (statusCounts.paused || 0),
    expiredLeaseCount: Number(expiredResult.rows[0]?.count || 0),
    recentJobs: recentResult.rows.map(rowToJob),
  };
}

async function getPostgresJob(userId, jobId) {
  await ensureCommercialSchema();
  const result = await query(`
    SELECT * FROM xiakeman_background_jobs
    WHERE user_id = $1 AND id = $2
    LIMIT 1
  `, [userId, jobId]);
  return rowToJob(result.rows[0]);
}

async function updatePostgresJob(userId, jobId, updates) {
  await ensureCommercialSchema();
  const current = await getPostgresJob(userId, jobId);
  if (!current) throw new HttpError(404, 'Background job not found');

  const nextStatus = updates.status ?? current.status;
  const startedAtExpr = nextStatus === 'running' && !current.startedAt ? 'now()' : 'started_at';
  const completedAtExpr = ['succeeded', 'failed', 'cancelled'].includes(nextStatus) && !current.completedAt ? 'now()' : 'completed_at';
  const result = await query(`
    UPDATE xiakeman_background_jobs SET
      status = $3,
      progress_json = COALESCE($4::jsonb, progress_json),
      output_json = COALESCE($5::jsonb, output_json),
      error_json = CASE
        WHEN $3 = 'succeeded' AND $6::jsonb IS NULL THEN NULL
        ELSE COALESCE($6::jsonb, error_json)
      END,
      media_json = COALESCE($7::jsonb, media_json),
      attempt = $8,
      lease_owner = $9,
      lease_expires_at = $10::timestamptz,
      updated_at = now(),
      started_at = ${startedAtExpr},
      completed_at = ${completedAtExpr}
    WHERE user_id = $1 AND id = $2
    RETURNING *
  `, [
    userId,
    jobId,
    nextStatus,
    updates.progress === undefined ? null : JSON.stringify(updates.progress),
    updates.output === undefined ? null : JSON.stringify(updates.output),
    updates.error === undefined ? null : JSON.stringify(updates.error),
    updates.media === undefined ? null : JSON.stringify(updates.media),
    updates.attempt ?? current.attempt,
    updates.leaseOwner ?? current.leaseOwner ?? null,
    updates.leaseExpiresAt ?? current.leaseExpiresAt ?? null,
  ]);
  return rowToJob(result.rows[0]);
}

async function retryPostgresJob(userId, jobId, reason) {
  await ensureCommercialSchema();
  const current = await getPostgresJob(userId, jobId);
  if (!current) throw new HttpError(404, 'Background job not found');
  if (current.status === 'queued' || current.status === 'running') {
    return current;
  }

  const result = await query(`
    UPDATE xiakeman_background_jobs SET
      status = 'queued',
      attempt = 0,
      progress_json = '{}'::jsonb,
      output_json = '{}'::jsonb,
      error_json = '{}'::jsonb,
      lease_owner = NULL,
      lease_expires_at = NULL,
      queued_at = now(),
      started_at = NULL,
      completed_at = NULL,
      updated_at = now()
    WHERE user_id = $1 AND id = $2
    RETURNING *
  `, [userId, jobId]);

  const job = rowToJob(result.rows[0]);
  await appendPostgresJobEvent(userId, jobId, {
    level: 'retry',
    phase: 'manual-retry',
    message: reason || '用户已将后台任务重新加入队列',
    data: {},
  }).catch(() => undefined);
  return job;
}

async function appendPostgresJobEvent(userId, jobId, event) {
  await ensureCommercialSchema();
  const result = await withTransaction(async (client) => {
    const jobResult = await client.query(`
      SELECT id FROM xiakeman_background_jobs
      WHERE user_id = $1 AND id = $2
      LIMIT 1
    `, [userId, jobId]);
    if (!jobResult.rows[0]) throw new HttpError(404, 'Background job not found');

    const eventResult = await client.query(`
      INSERT INTO xiakeman_background_job_events (job_id, level, phase, message, data_json)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      RETURNING *
    `, [
      jobId,
      event.level,
      event.phase ?? null,
      event.message,
      JSON.stringify(event.data || {}),
    ]);

    await client.query('UPDATE xiakeman_background_jobs SET updated_at = now() WHERE id = $1', [jobId]);
    return eventResult;
  });
  return rowToEvent(result.rows[0]);
}

async function listPostgresJobEvents(userId, jobId, limit) {
  await ensureCommercialSchema();
  const result = await query(`
    SELECT event.*
    FROM xiakeman_background_job_events event
    JOIN xiakeman_background_jobs job ON job.id = event.job_id
    WHERE job.user_id = $1 AND event.job_id = $2
    ORDER BY event.seq DESC
    LIMIT $3
  `, [userId, jobId, limit]);
  return result.rows.map(rowToEvent).reverse();
}

async function claimPostgresJobForWorker(options = {}) {
  await ensureCommercialSchema();
  const workerId = sanitizeText(options.workerId, 'workerId', 200) || `worker-${process.pid}`;
  const types = sanitizeJobTypes(options.types);
  const leaseMs = clampDurationMs(options.leaseSeconds);
  const staleMs = clampStaleDurationMs(options.staleSeconds);
  const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();

  return await withTransaction(async (client) => {
    const interrupted = await client.query(`
      UPDATE xiakeman_background_jobs SET
        status = 'failed',
        error_json = jsonb_build_object('message', $2::text),
        lease_owner = NULL,
        lease_expires_at = NULL,
        completed_at = COALESCE(completed_at, now()),
        updated_at = now()
      WHERE type = 'llm-completions'
        AND type = ANY($1::text[])
        AND status = 'running'
        AND (
          (
            lease_expires_at IS NOT NULL
            AND lease_expires_at < now()
          )
          OR updated_at < (now() - ($3::int * interval '1 millisecond'))
        )
        AND attempt < max_attempts
      RETURNING id, attempt, max_attempts
    `, [
      types,
      getInterruptedNonRecoverableJobMessage({ type: 'llm-completions' }),
      staleMs,
    ]);

    for (const row of interrupted.rows) {
      await client.query(`
        INSERT INTO xiakeman_background_job_events (job_id, level, phase, message, data_json)
        VALUES (
          $1,
          'error',
          'worker-interrupted',
          $2,
          jsonb_build_object('attempt', $3::int, 'maxAttempts', $4::int, 'requiresManualRetry', true)
        )
      `, [
        row.id,
        getInterruptedNonRecoverableJobMessage({ type: 'llm-completions' }),
        Number(row.attempt || 0),
        Number(row.max_attempts || 0),
      ]);
    }

    const result = await client.query(`
      SELECT *
      FROM xiakeman_background_jobs
      WHERE type = ANY($1::text[])
        AND (
          status = 'queued'
          OR (
            status = 'running'
            AND (
              (
                lease_expires_at IS NOT NULL
                AND lease_expires_at < now()
              )
              OR updated_at < (now() - ($2::int * interval '1 millisecond'))
            )
            AND attempt < max_attempts
          )
        )
      ORDER BY
        CASE WHEN status = 'queued' THEN 0 ELSE 1 END ASC,
        priority DESC,
        queued_at ASC,
        created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `, [types, staleMs]);

    const selected = result.rows[0];
    if (!selected) return null;

    const claimed = await client.query(`
      UPDATE xiakeman_background_jobs SET
        status = 'running',
        attempt = attempt + 1,
        lease_owner = $2,
        lease_expires_at = $3::timestamptz,
        started_at = COALESCE(started_at, now()),
        updated_at = now()
      WHERE id = $1
      RETURNING *
    `, [selected.id, workerId, leaseExpiresAt]);

    await client.query(`
      INSERT INTO xiakeman_background_job_events (job_id, level, phase, message, data_json)
      VALUES ($1, 'info', 'lease', $2, $3::jsonb)
    `, [
      selected.id,
      '后台 Worker 已领取任务',
      JSON.stringify({ workerId, leaseExpiresAt }),
    ]);

    return rowToJob(claimed.rows[0]);
  });
}

async function heartbeatPostgresJobForWorker(jobId, options = {}) {
  await ensureCommercialSchema();
  const id = sanitizeSegment(jobId, 'jobId');
  const workerId = sanitizeText(options.workerId, 'workerId', 200) || `worker-${process.pid}`;
  const leaseMs = clampDurationMs(options.leaseSeconds);
  const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
  const result = await query(`
    UPDATE xiakeman_background_jobs SET
      lease_owner = $2,
      lease_expires_at = $3::timestamptz,
      updated_at = now()
    WHERE id = $1
      AND status = 'running'
      AND (lease_owner IS NULL OR lease_owner = $2 OR lease_expires_at < now())
    RETURNING *
  `, [id, workerId, leaseExpiresAt]);
  return rowToJob(result.rows[0]);
}

async function finishPostgresJobForWorker(jobId, options = {}) {
  await ensureCommercialSchema();
  const id = sanitizeSegment(jobId, 'jobId');
  const workerId = sanitizeText(options.workerId, 'workerId', 200) || `worker-${process.pid}`;
  const status = sanitizeJobStatus(options.status, 'succeeded');
  if (!['succeeded', 'failed', 'cancelled', 'paused', 'queued'].includes(status)) {
    throw new HttpError(400, 'Worker finish status is not terminal or resumable');
  }
  const completedAtExpr = ['succeeded', 'failed', 'cancelled'].includes(status) ? 'now()' : 'completed_at';
  const result = await query(`
    UPDATE xiakeman_background_jobs SET
      status = $3,
      progress_json = COALESCE($4::jsonb, progress_json),
      output_json = COALESCE($5::jsonb, output_json),
      error_json = CASE
        WHEN $3 = 'succeeded' AND $6::jsonb IS NULL THEN NULL
        ELSE COALESCE($6::jsonb, error_json)
      END,
      media_json = COALESCE($7::jsonb, media_json),
      lease_owner = NULL,
      lease_expires_at = NULL,
      updated_at = now(),
      completed_at = ${completedAtExpr}
    WHERE id = $1
      AND (lease_owner IS NULL OR lease_owner = $2 OR lease_expires_at < now())
    RETURNING *
  `, [
    id,
    workerId,
    status,
    options.progress === undefined ? null : JSON.stringify(sanitizeJson(options.progress, 'progress')),
    options.output === undefined ? null : JSON.stringify(sanitizeJson(options.output, 'output')),
    options.error === undefined ? null : JSON.stringify(sanitizeJson(options.error, 'error')),
    options.media === undefined ? null : JSON.stringify(sanitizeJson(options.media, 'media')),
  ]);
  const job = rowToJob(result.rows[0]);
  if (!job) return null;
  await appendPostgresJobEvent(job.userId, job.id, {
    level: status === 'succeeded' ? 'success' : status === 'failed' ? 'error' : 'warning',
    phase: status,
    message: options.message || `后台任务已${status}`,
    data: { workerId },
  });
  return job;
}

async function createFileJob(userId, input) {
  return await withFileStoreLock(userId, async () => {
    const store = await readFileStore(userId);
    if (input.idempotencyKey) {
      const existing = store.jobs.find((job) =>
        job.type === input.type && job.idempotencyKey === input.idempotencyKey);
      if (existing) return { job: existing, reused: true };
    }

    const now = nowIso();
    const job = {
      id: input.id || randomId(),
      userId,
      projectId: input.projectId,
      chapterId: input.chapterId,
      storyboardIndex: input.storyboardIndex,
      parentJobId: input.parentJobId,
      type: input.type,
      status: input.status || 'queued',
      priority: input.priority,
      attempt: 0,
      maxAttempts: input.maxAttempts,
      idempotencyKey: input.idempotencyKey,
      input: input.input || {},
      progress: input.progress || {},
      output: {},
      media: input.media || {},
      createdAt: now,
      updatedAt: now,
      queuedAt: now,
    };
    store.jobs.push(job);
    await writeFileStore(userId, store);
    return { job, reused: false };
  });
}

async function listFileJobs(userId, filters) {
  const store = await readFileStore(userId);
  return filterFileJobs(store.jobs, filters)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, filters.limit);
}

async function listFileStoreUserIds() {
  const usersRoot = path.join(JOB_STORE_ROOT, 'users');
  let entries = [];
  try {
    entries = await fsp.readdir(usersRoot, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }

  const userIds = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      userIds.push(sanitizeSegment(entry.name, 'userId'));
    } catch {
      continue;
    }
  }
  return userIds;
}

async function readAllFileJobStoresForAdmin() {
  const userIds = await listFileStoreUserIds();
  const jobs = [];
  for (const userId of userIds) {
    const store = await readFileStore(userId);
    jobs.push(...store.jobs.map((job) => ({ ...job, userId: job.userId || userId })));
  }
  return jobs;
}

async function listFileJobsForAdmin(filters) {
  const jobs = await readAllFileJobStoresForAdmin();
  return filterAdminJobs(jobs, filters)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, filters.limit);
}

async function getFileJobSummaryForAdmin() {
  const jobs = await readAllFileJobStoresForAdmin();
  const statusCounts = createJobStatusCounts(jobs);
  const typeCounts = createJobTypeCounts(jobs);
  return {
    total: jobs.length,
    statusCounts,
    typeCounts,
    activeCount: (statusCounts.running || 0) + (statusCounts.queued || 0) + (statusCounts.paused || 0),
    expiredLeaseCount: jobs.filter(isLeaseExpired).length,
    recentJobs: jobs
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, 12),
  };
}

async function getFileJob(userId, jobId) {
  const store = await readFileStore(userId);
  return store.jobs.find((job) => job.id === jobId) || null;
}

async function updateFileJob(userId, jobId, updates) {
  return await withFileStoreLock(userId, async () => {
    const store = await readFileStore(userId);
    const index = store.jobs.findIndex((job) => job.id === jobId);
    if (index < 0) throw new HttpError(404, 'Background job not found');
    const current = store.jobs[index];
    const nextStatus = updates.status ?? current.status;
    const now = nowIso();
    const next = {
      ...current,
      status: nextStatus,
      progress: updates.progress ?? current.progress,
      output: updates.output ?? current.output,
      error: updates.error === undefined ? current.error : updates.error,
      media: updates.media ?? current.media,
      attempt: updates.attempt ?? current.attempt,
      leaseOwner: updates.leaseOwner ?? current.leaseOwner,
      leaseExpiresAt: updates.leaseExpiresAt ?? current.leaseExpiresAt,
      startedAt: nextStatus === 'running' && !current.startedAt ? now : current.startedAt,
      completedAt: ['succeeded', 'failed', 'cancelled'].includes(nextStatus) && !current.completedAt ? now : current.completedAt,
      updatedAt: now,
    };
    store.jobs[index] = next;
    await writeFileStore(userId, store);
    return next;
  });
}

async function retryFileJob(userId, jobId, reason) {
  return await withFileStoreLock(userId, () => retryFileJobUnlocked(userId, jobId, reason));
}

async function retryFileJobUnlocked(userId, jobId, reason) {
  const store = await readFileStore(userId);
  const index = store.jobs.findIndex((job) => job.id === jobId);
  if (index < 0) throw new HttpError(404, 'Background job not found');
  const current = store.jobs[index];
  if (current.status === 'queued' || current.status === 'running') {
    return current;
  }

  const now = nowIso();
  const next = {
    ...current,
    status: 'queued',
    attempt: 0,
    progress: {},
    output: {},
    error: {},
    leaseOwner: null,
    leaseExpiresAt: null,
    queuedAt: now,
    startedAt: undefined,
    completedAt: undefined,
    updatedAt: now,
  };
  store.jobs[index] = next;
  const events = store.events[jobId] || [];
  store.events[jobId] = [...events, {
    jobId,
    seq: events.length + 1,
    level: 'retry',
    phase: 'manual-retry',
    message: reason || '用户已将后台任务重新加入队列',
    data: {},
    createdAt: now,
  }].slice(-1000);
  await writeFileStore(userId, store);
  return next;
}

async function appendFileJobEvent(userId, jobId, event) {
  return await withFileStoreLock(userId, () => appendFileJobEventUnlocked(userId, jobId, event));
}

async function appendFileJobEventUnlocked(userId, jobId, event) {
  const store = await readFileStore(userId);
  if (!store.jobs.some((job) => job.id === jobId)) throw new HttpError(404, 'Background job not found');
  const events = store.events[jobId] || [];
  const nextEvent = {
    jobId,
    seq: events.length + 1,
    level: event.level,
    phase: event.phase,
    message: event.message,
    data: event.data || {},
    createdAt: nowIso(),
  };
  store.events[jobId] = [...events, nextEvent].slice(-1000);
  const job = store.jobs.find((item) => item.id === jobId);
  if (job) job.updatedAt = nextEvent.createdAt;
  await writeFileStore(userId, store);
  return nextEvent;
}

async function listFileJobEvents(userId, jobId, limit) {
  const store = await readFileStore(userId);
  if (!store.jobs.some((job) => job.id === jobId)) throw new HttpError(404, 'Background job not found');
  return (store.events[jobId] || []).slice(-limit);
}

function getClaimableFileJobCandidates(store, options = {}, now = Date.now()) {
  const types = new Set(sanitizeJobTypes(options.types));
  const staleMs = clampStaleDurationMs(options.staleSeconds);
  return store.jobs
    .filter((job) =>
      types.has(job.type)
      && (
        job.status === 'queued'
        || (
          job.status === 'running'
          && job.leaseExpiresAt
          && (
            Date.parse(job.leaseExpiresAt) < now
            || Date.parse(job.updatedAt || job.startedAt || job.createdAt || 0) < now - staleMs
          )
          && (job.attempt ?? 0) < (job.maxAttempts ?? 3)
          && !isStaleNonRecoverableJob(job)
        )
      ))
    .sort((left, right) =>
      (left.status === 'queued' ? 0 : 1) - (right.status === 'queued' ? 0 : 1)
      || (right.priority ?? 0) - (left.priority ?? 0)
      || String(left.queuedAt || left.createdAt).localeCompare(String(right.queuedAt || right.createdAt)));
}

function failExpiredExhaustedFileJobs(store, options = {}, now = Date.now()) {
  const types = new Set(sanitizeJobTypes(options.types));
  const staleMs = clampStaleDurationMs(options.staleSeconds);
  let changed = false;
  const timestamp = new Date(now).toISOString();

  for (const job of store.jobs) {
    if (!types.has(job.type)) continue;
    if (job.status !== 'running' || !job.leaseExpiresAt) continue;
    const leaseExpired = Date.parse(job.leaseExpiresAt) < now;
    const heartbeatStale = Date.parse(job.updatedAt || job.startedAt || job.createdAt || 0) < now - staleMs;
    if (!leaseExpired && !heartbeatStale) continue;
    if ((job.attempt ?? 0) < (job.maxAttempts ?? 3)) continue;

    job.status = 'failed';
    job.error = {
      message: heartbeatStale
        ? 'Background job stopped sending heartbeats after all retry attempts. Please retry this task.'
        : 'Background job lease expired after all retry attempts. Please retry this task.',
    };
    job.leaseOwner = undefined;
    job.leaseExpiresAt = undefined;
    job.completedAt = job.completedAt || timestamp;
    job.updatedAt = timestamp;
    const events = store.events[job.id] || [];
    store.events[job.id] = [...events, {
      jobId: job.id,
      seq: events.length + 1,
      level: 'error',
      phase: heartbeatStale ? 'heartbeat-stale' : 'lease-expired',
      message: heartbeatStale
        ? 'Background job heartbeat stopped after all retry attempts'
        : 'Background job lease expired after all retry attempts',
      data: { attempt: job.attempt, maxAttempts: job.maxAttempts },
      createdAt: timestamp,
    }].slice(-1000);
    changed = true;
  }

  return changed;
}

function failInterruptedNonRecoverableFileJobs(store, options = {}, now = Date.now()) {
  const types = new Set(sanitizeJobTypes(options.types));
  const staleMs = clampStaleDurationMs(options.staleSeconds);
  let changed = false;
  const timestamp = new Date(now).toISOString();

  for (const job of store.jobs) {
    if (!types.has(job.type)) continue;
    if (!isStaleNonRecoverableJob(job)) continue;
    if (job.status !== 'running' || !job.leaseExpiresAt) continue;
    const leaseExpired = Date.parse(job.leaseExpiresAt) < now;
    const heartbeatStale = Date.parse(job.updatedAt || job.startedAt || job.createdAt || 0) < now - staleMs;
    if (!leaseExpired && !heartbeatStale) continue;
    if ((job.attempt ?? 0) >= (job.maxAttempts ?? 3)) continue;

    const message = getInterruptedNonRecoverableJobMessage(job);
    job.status = 'failed';
    job.error = { message };
    job.leaseOwner = undefined;
    job.leaseExpiresAt = undefined;
    job.completedAt = job.completedAt || timestamp;
    job.updatedAt = timestamp;
    const events = store.events[job.id] || [];
    store.events[job.id] = [...events, {
      jobId: job.id,
      seq: events.length + 1,
      level: 'error',
      phase: 'worker-interrupted',
      message,
      data: {
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
        requiresManualRetry: true,
        reason: heartbeatStale ? 'heartbeat-stale' : 'lease-expired',
      },
      createdAt: timestamp,
    }].slice(-1000);
    changed = true;
  }

  return changed;
}

async function claimNextFileJobForWorker(options = {}) {
  const requestedUserId = sanitizeOptionalSegment(options.userId, 'userId');
  if (requestedUserId) return claimFileJobForWorker(requestedUserId, options);

  const userIds = await listFileStoreUserIds();
  const now = Date.now();
  const candidates = [];
  for (const userId of userIds) {
    const store = await readFileStore(userId);
    const interruptedChanged = failInterruptedNonRecoverableFileJobs(store, options, now);
    const exhaustedChanged = failExpiredExhaustedFileJobs(store, options, now);
    if (interruptedChanged || exhaustedChanged) {
      await withFileStoreLock(userId, async () => {
        const lockedStore = await readFileStore(userId);
        const lockedInterruptedChanged = failInterruptedNonRecoverableFileJobs(lockedStore, options, now);
        const lockedExhaustedChanged = failExpiredExhaustedFileJobs(lockedStore, options, now);
        if (lockedInterruptedChanged || lockedExhaustedChanged) {
          await writeFileStore(userId, lockedStore);
        }
      });
    }
    const [candidate] = getClaimableFileJobCandidates(store, options, now);
    if (candidate) candidates.push({ userId: candidate.userId || userId, job: candidate });
  }

  candidates.sort((left, right) =>
    (left.job.status === 'queued' ? 0 : 1) - (right.job.status === 'queued' ? 0 : 1)
    || (right.job.priority ?? 0) - (left.job.priority ?? 0)
    || String(left.job.queuedAt || left.job.createdAt).localeCompare(String(right.job.queuedAt || right.job.createdAt)));

  const selected = candidates[0];
  if (!selected) return null;
  return claimFileJobForWorker(selected.userId, options);
}

async function resolveFileJobUserId(jobId, requestedUserId) {
  const userId = sanitizeOptionalSegment(requestedUserId, 'userId');
  if (userId) return userId;

  const id = sanitizeSegment(jobId, 'jobId');
  const userIds = await listFileStoreUserIds();
  for (const candidateUserId of userIds) {
    const store = await readFileStore(candidateUserId);
    if (store.jobs.some((job) => job.id === id)) return candidateUserId;
  }
  throw new HttpError(404, 'Background job not found');
}

async function claimFileJobForWorker(userId, options = {}) {
  return await withFileStoreLock(userId, () => claimFileJobForWorkerUnlocked(userId, options));
}

async function claimFileJobForWorkerUnlocked(userId, options = {}) {
  const store = await readFileStore(userId);
  const workerId = sanitizeText(options.workerId, 'workerId', 200) || `worker-${process.pid}`;
  const leaseMs = clampDurationMs(options.leaseSeconds);
  const now = Date.now();
  const leaseExpiresAt = new Date(now + leaseMs).toISOString();
  const interruptedChanged = failInterruptedNonRecoverableFileJobs(store, options, now);
  const exhaustedChanged = failExpiredExhaustedFileJobs(store, options, now);
  if (interruptedChanged || exhaustedChanged) {
    await writeFileStore(userId, store);
  }
  const candidates = getClaimableFileJobCandidates(store, options, now);

  const job = candidates[0];
  if (!job) return null;
  job.status = 'running';
  job.attempt = (job.attempt ?? 0) + 1;
  job.leaseOwner = workerId;
  job.leaseExpiresAt = leaseExpiresAt;
  job.startedAt = job.startedAt || nowIso();
  job.updatedAt = nowIso();
  const events = store.events[job.id] || [];
  store.events[job.id] = [...events, {
    jobId: job.id,
    seq: events.length + 1,
    level: 'info',
    phase: 'lease',
    message: '后台 Worker 已领取任务',
    data: { workerId, leaseExpiresAt },
    createdAt: job.updatedAt,
  }].slice(-1000);
  await writeFileStore(userId, store);
  return job;
}

async function heartbeatFileJobForWorker(userId, jobId, options = {}) {
  return await withFileStoreLock(userId, () => heartbeatFileJobForWorkerUnlocked(userId, jobId, options));
}

async function heartbeatFileJobForWorkerUnlocked(userId, jobId, options = {}) {
  const store = await readFileStore(userId);
  const id = sanitizeSegment(jobId, 'jobId');
  const workerId = sanitizeText(options.workerId, 'workerId', 200) || `worker-${process.pid}`;
  const leaseMs = clampDurationMs(options.leaseSeconds);
  const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
  const job = store.jobs.find((item) => item.id === id);
  if (!job || job.status !== 'running') return null;
  if (job.leaseOwner && job.leaseOwner !== workerId && (!job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) >= Date.now())) {
    return null;
  }
  job.leaseOwner = workerId;
  job.leaseExpiresAt = leaseExpiresAt;
  job.updatedAt = nowIso();
  await writeFileStore(userId, store);
  return job;
}

async function finishFileJobForWorker(userId, jobId, options = {}) {
  return await withFileStoreLock(userId, () => finishFileJobForWorkerUnlocked(userId, jobId, options));
}

async function finishFileJobForWorkerUnlocked(userId, jobId, options = {}) {
  const store = await readFileStore(userId);
  const id = sanitizeSegment(jobId, 'jobId');
  const workerId = sanitizeText(options.workerId, 'workerId', 200) || `worker-${process.pid}`;
  const status = sanitizeJobStatus(options.status, 'succeeded');
  const job = store.jobs.find((item) => item.id === id);
  if (!job) throw new HttpError(404, 'Background job not found');
  if (job.leaseOwner && job.leaseOwner !== workerId && (!job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) >= Date.now())) {
    throw new HttpError(409, 'Background job is leased by another worker');
  }
  const now = nowIso();
  job.status = status;
  job.progress = options.progress === undefined ? job.progress : sanitizeJson(options.progress, 'progress');
  job.output = options.output === undefined ? job.output : sanitizeJson(options.output, 'output');
  job.error = options.error === undefined
    ? (status === 'succeeded' ? undefined : job.error)
    : sanitizeJson(options.error, 'error');
  job.media = options.media === undefined ? job.media : sanitizeJson(options.media, 'media');
  if (status !== 'running') {
    job.leaseOwner = undefined;
    job.leaseExpiresAt = undefined;
  }
  if (['succeeded', 'failed', 'cancelled'].includes(status)) job.completedAt = job.completedAt || now;
  job.updatedAt = now;
  const events = store.events[job.id] || [];
  store.events[job.id] = [...events, {
    jobId: job.id,
    seq: events.length + 1,
    level: status === 'succeeded' ? 'success' : status === 'failed' ? 'error' : 'warning',
    phase: status,
    message: options.message || `后台任务已${status}`,
    data: { workerId },
    createdAt: now,
  }].slice(-1000);
  await writeFileStore(userId, store);
  return job;
}

async function createJob(userId, body) {
  const input = {
    id: sanitizeOptionalSegment(body.id, 'id'),
    projectId: sanitizeSegment(body.projectId, 'projectId'),
    chapterId: sanitizeOptionalSegment(body.chapterId, 'chapterId'),
    storyboardIndex: body.storyboardIndex === undefined ? undefined : clampInteger(body.storyboardIndex, undefined, 0, 10000),
    parentJobId: sanitizeOptionalSegment(body.parentJobId, 'parentJobId'),
    type: sanitizeJobType(body.type),
    status: sanitizeJobStatus(body.status, 'queued'),
    priority: clampInteger(body.priority, 0, -100, 100),
    maxAttempts: clampInteger(body.maxAttempts, 3, 1, 20),
    idempotencyKey: sanitizeText(body.idempotencyKey, 'idempotencyKey', 200),
    input: sanitizeJson(body.input, 'input'),
    progress: sanitizeJson(body.progress, 'progress'),
    media: sanitizeJson(body.media, 'media'),
  };
  return isPostgresJobStoreEnabled()
    ? createPostgresJob(userId, input)
    : createFileJob(userId, input);
}

async function listJobs(userId, queryParams) {
  const filters = {
    projectId: sanitizeOptionalSegment(queryParams.projectId, 'projectId'),
    chapterId: sanitizeOptionalSegment(queryParams.chapterId, 'chapterId'),
    type: queryParams.type ? sanitizeJobType(queryParams.type) : undefined,
    status: queryParams.status ? sanitizeJobStatus(queryParams.status) : undefined,
    limit: clampInteger(queryParams.limit, DEFAULT_JOB_LIMIT, 1, MAX_JOB_LIMIT),
  };
  return isPostgresJobStoreEnabled()
    ? listPostgresJobs(userId, filters)
    : listFileJobs(userId, filters);
}

function sanitizeAdminJobFilters(queryParams = {}) {
  return {
    userId: sanitizeOptionalSegment(queryParams.userId, 'userId'),
    projectId: sanitizeOptionalSegment(queryParams.projectId, 'projectId'),
    chapterId: sanitizeOptionalSegment(queryParams.chapterId, 'chapterId'),
    type: queryParams.type ? sanitizeJobType(queryParams.type) : undefined,
    status: queryParams.status ? sanitizeJobStatus(queryParams.status) : undefined,
    limit: clampInteger(queryParams.limit, DEFAULT_JOB_LIMIT, 1, MAX_JOB_LIMIT),
  };
}

async function listJobsForAdmin(queryParams = {}) {
  const filters = sanitizeAdminJobFilters(queryParams);
  return isPostgresJobStoreEnabled()
    ? listPostgresJobsForAdmin(filters)
    : listFileJobsForAdmin(filters);
}

async function getJobSummaryForAdmin() {
  return isPostgresJobStoreEnabled()
    ? getPostgresJobSummaryForAdmin()
    : getFileJobSummaryForAdmin();
}

async function getJob(userId, jobId) {
  const id = sanitizeSegment(jobId, 'jobId');
  return isPostgresJobStoreEnabled()
    ? getPostgresJob(userId, id)
    : getFileJob(userId, id);
}

async function updateJob(userId, jobId, body) {
  const id = sanitizeSegment(jobId, 'jobId');
  const updates = {
    status: body.status === undefined ? undefined : sanitizeJobStatus(body.status),
    progress: body.progress === undefined ? undefined : sanitizeJson(body.progress, 'progress'),
    output: body.output === undefined ? undefined : sanitizeJson(body.output, 'output'),
    error: body.error === undefined ? undefined : sanitizeJson(body.error, 'error'),
    media: body.media === undefined ? undefined : sanitizeJson(body.media, 'media'),
    attempt: body.attempt === undefined ? undefined : clampInteger(body.attempt, 0, 0, 1000),
    leaseOwner: sanitizeText(body.leaseOwner, 'leaseOwner', 200),
    leaseExpiresAt: sanitizeText(body.leaseExpiresAt, 'leaseExpiresAt', 80),
  };
  return isPostgresJobStoreEnabled()
    ? updatePostgresJob(userId, id, updates)
    : updateFileJob(userId, id, updates);
}

async function cancelJob(userId, jobId, reason = '用户取消任务') {
  const job = await updateJob(userId, jobId, {
    status: 'cancelled',
    error: { message: reason },
  });
  await appendJobEvent(userId, job.id, {
    level: 'warning',
    phase: 'cancelled',
    message: reason,
  }).catch(() => undefined);
  return job;
}

async function retryJob(userId, jobId, reason = '用户手动重试后台任务') {
  const id = sanitizeSegment(jobId, 'jobId');
  const message = sanitizeText(reason, 'reason', 1000) || '用户手动重试后台任务';
  return isPostgresJobStoreEnabled()
    ? retryPostgresJob(userId, id, message)
    : retryFileJob(userId, id, message);
}

async function appendJobEvent(userId, jobId, body) {
  const id = sanitizeSegment(jobId, 'jobId');
  const event = {
    level: sanitizeEventLevel(body.level),
    phase: sanitizeText(body.phase, 'phase', 120),
    message: sanitizeText(body.message, 'message', 2000),
    data: sanitizeJson(body.data, 'data'),
  };
  if (!event.message) throw new HttpError(400, 'message is required');
  return isPostgresJobStoreEnabled()
    ? appendPostgresJobEvent(userId, id, event)
    : appendFileJobEvent(userId, id, event);
}

async function listJobEvents(userId, jobId, queryParams) {
  const id = sanitizeSegment(jobId, 'jobId');
  const limit = clampInteger(queryParams.limit, 100, 1, MAX_EVENT_LIMIT);
  return isPostgresJobStoreEnabled()
    ? listPostgresJobEvents(userId, id, limit)
    : listFileJobEvents(userId, id, limit);
}

async function claimNextJobForWorker(options = {}) {
  if (isPostgresJobStoreEnabled()) {
    return claimPostgresJobForWorker(options);
  }
  return claimNextFileJobForWorker(options);
}

async function heartbeatJobForWorker(jobId, options = {}) {
  if (isPostgresJobStoreEnabled()) {
    return heartbeatPostgresJobForWorker(jobId, options);
  }
  const userId = await resolveFileJobUserId(jobId, options.userId);
  return heartbeatFileJobForWorker(userId, jobId, options);
}

async function finishJobForWorker(jobId, options = {}) {
  if (isPostgresJobStoreEnabled()) {
    return finishPostgresJobForWorker(jobId, options);
  }
  const userId = await resolveFileJobUserId(jobId, options.userId);
  return finishFileJobForWorker(userId, jobId, options);
}

function requireWorkerAccess(req) {
  const configuredToken = String(process.env.BACKGROUND_WORKER_TOKEN || '').trim();
  const providedToken = String(req.get('x-xiakeman-worker-token') || '').trim();
  if (configuredToken && providedToken) {
    const configuredBuffer = Buffer.from(configuredToken);
    const providedBuffer = Buffer.from(providedToken);
    if (configuredBuffer.length === providedBuffer.length
      && crypto.timingSafeEqual(configuredBuffer, providedBuffer)) {
      return;
    }
  }
  if (req.authUser?.role === 'admin') return;
  throw new HttpError(403, '需要后台 Worker 权限');
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function getUserId(req) {
  if (!req.authUser?.id) throw new HttpError(401, '请先登录');
  return sanitizeSegment(req.authUser.id, 'userId');
}

function createBackgroundJobRouter({ rateLimit, cancelHandlers } = {}) {
  const router = express.Router();
  const remoteCancelHandlers = cancelHandlers && typeof cancelHandlers === 'object' ? cancelHandlers : {};
  if (rateLimit) router.use(rateLimit);

  router.get('/health', asyncRoute(async (_req, res) => {
    res.json({
      ok: true,
      driver: getJobStoreDriver(),
      postgresConfigured: isPostgresConfigured(),
      supportedTypes: Array.from(JOB_TYPES),
      supportedStatuses: Array.from(JOB_STATUSES),
    });
  }));

  router.get('/', asyncRoute(async (req, res) => {
    const jobs = await listJobs(getUserId(req), req.query || {});
    res.json({ jobs });
  }));

  router.post('/', asyncRoute(async (req, res) => {
    const result = await createJob(getUserId(req), req.body || {});
    res.status(result.reused ? 200 : 201).json(result);
  }));

  router.post('/worker/claim', asyncRoute(async (req, res) => {
    requireWorkerAccess(req);
    const job = await claimNextJobForWorker({
      ...(req.body || {}),
      userId: req.body?.userId || req.authUser?.id,
    });
    res.json({ job });
  }));

  router.post('/worker/:id/heartbeat', asyncRoute(async (req, res) => {
    requireWorkerAccess(req);
    const job = await heartbeatJobForWorker(req.params.id, {
      ...(req.body || {}),
      userId: req.body?.userId || req.authUser?.id,
    });
    if (!job) throw new HttpError(409, 'Background job lease is not active');
    res.json({ job });
  }));

  router.post('/worker/:id/finish', asyncRoute(async (req, res) => {
    requireWorkerAccess(req);
    const job = await finishJobForWorker(req.params.id, {
      ...(req.body || {}),
      userId: req.body?.userId || req.authUser?.id,
    });
    if (!job) throw new HttpError(409, 'Background job lease is not active');
    res.json({ job });
  }));

  router.get('/:id', asyncRoute(async (req, res) => {
    const job = await getJob(getUserId(req), req.params.id);
    if (!job) throw new HttpError(404, 'Background job not found');
    res.json({ job });
  }));

  router.patch('/:id', asyncRoute(async (req, res) => {
    const job = await updateJob(getUserId(req), req.params.id, req.body || {});
    res.json({ job });
  }));

  router.post('/:id/cancel', asyncRoute(async (req, res) => {
    const reason = sanitizeText(req.body?.reason, 'reason', 1000) || '??????';
    const userId = getUserId(req);
    const before = await getJob(userId, req.params.id);
    if (!before) throw new HttpError(404, 'Background job not found');
    const job = await cancelJob(userId, req.params.id, reason);
    const handler = remoteCancelHandlers[before.type];
    let remoteCancel;
    if (typeof handler === 'function') {
      remoteCancel = await handler(before, { reason, userId }).catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        await appendJobEvent(userId, before.id, {
          level: 'warning',
          phase: 'remote-cancel',
          message: `???????${message}`,
          data: { error: message },
        }).catch(() => undefined);
        return { success: false, message };
      });
    }
    res.json({ job, remoteCancel });
  }));

  router.post('/:id/retry', asyncRoute(async (req, res) => {
    const reason = sanitizeText(req.body?.reason, 'reason', 1000) || '用户手动重试后台任务';
    const job = await retryJob(getUserId(req), req.params.id, reason);
    res.json({ job });
  }));

  router.get('/:id/events', asyncRoute(async (req, res) => {
    const events = await listJobEvents(getUserId(req), req.params.id, req.query || {});
    res.json({ events });
  }));

  router.post('/:id/events', asyncRoute(async (req, res) => {
    const event = await appendJobEvent(getUserId(req), req.params.id, req.body || {});
    res.status(201).json({ event });
  }));

  router.use((error, _req, res, next) => {
    if (!error) return next();
    const status = Number(error.status || 500);
    if (status >= 500) {
      console.error('[background-jobs] request failed', error);
    }
    res.status(status).json({
      error: status >= 500 ? 'Background job request failed' : String(error.message || error),
    });
  });

  return router;
}

module.exports = {
  JOB_STATUSES,
  JOB_TYPES,
  createBackgroundJobRouter,
  cancelJob,
  claimNextJobForWorker,
  createJob,
  finishJobForWorker,
  getJob,
  getJobStoreDriver,
  getJobSummaryForAdmin,
  heartbeatJobForWorker,
  listJobEvents,
  listJobsForAdmin,
  listJobs,
  retryJob,
  updateJob,
  appendJobEvent,
};
