const express = require('express');
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
const {
  createSignedGetUrl,
  createSignedPutUrl,
  deleteObjects,
  getDirectObjectStorageStatus,
  getObjectBuffer,
  getObjectStorageStatus,
  headObject,
  putObjectBuffer,
  sha256,
} = require('./object-storage');

const STORE_VERSION = 1;
const CLOUD_ROOT = process.env.CLOUD_STORAGE_DIR || path.join(os.tmpdir(), 'xiakeman-cloud-store');
const JSON_LIMIT = process.env.CLOUD_PROJECT_JSON_LIMIT || '150mb';
const BLOB_UPLOAD_LIMIT = process.env.CLOUD_BLOB_UPLOAD_LIMIT || '300mb';
const DIRECT_BLOB_MAX_BYTES = Number(process.env.CLOUD_DIRECT_BLOB_MAX_BYTES || 2 * 1024 * 1024 * 1024);
const DIRECT_URL_BATCH_LIMIT = Math.max(1, Number(process.env.CLOUD_DIRECT_URL_BATCH_LIMIT || 200));
const FILE_BLOB_MANIFEST_NAME = 'blob-manifest.json';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeSegment(value, label) {
  const segment = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment)) {
    throw new HttpError(400, `${label} contains unsupported characters`);
  }
  return segment;
}

function getCloudStoreDriver() {
  return String(process.env.CLOUD_STORE_DRIVER || 'file').toLowerCase();
}

function isPostgresCloudStoreEnabled() {
  const driver = getCloudStoreDriver();
  return driver === 'postgres' || driver === 'pg';
}

function getUserId(req) {
  if (req.authUser?.id) {
    return sanitizeSegment(req.authUser.id, 'userId');
  }

  if (process.env.CLOUD_ALLOW_HEADER_USER === 'true') {
    const raw = req.get('x-xiakeman-user-id') || req.query.userId;
    return sanitizeSegment(raw || 'local-dev', 'userId');
  }

  throw new HttpError(401, '请先登录');
}

function getUserProjectsDir(userId) {
  return path.join(CLOUD_ROOT, 'users', userId, 'projects');
}

function getProjectDir(userId, projectId) {
  return path.join(getUserProjectsDir(userId), projectId);
}

function getFileBlobManifestPath(userId, projectId) {
  return path.join(getProjectDir(userId, projectId), FILE_BLOB_MANIFEST_NAME);
}

async function readJson(filePath) {
  const text = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

async function atomicWriteJson(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const text = JSON.stringify(data);
  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fsp.writeFile(tempPath, text, 'utf8');
  await fsp.rename(tempPath, filePath);
  return Buffer.byteLength(text, 'utf8');
}

function normalizeProjectSnapshot(input, projectId) {
  if (!isPlainObject(input)) {
    throw new HttpError(400, 'Snapshot must be a JSON object');
  }

  const project = input.project;
  if (!isPlainObject(project) || typeof project.id !== 'string' || typeof project.name !== 'string') {
    throw new HttpError(400, 'Snapshot is missing project.id or project.name');
  }

  if (project.id !== projectId) {
    throw new HttpError(409, 'Project id in payload does not match request path');
  }

  const blobs = isPlainObject(input.blobs) ? input.blobs : {};
  return {
    version: Number(input.version || 1),
    exportedAt: typeof input.exportedAt === 'string' ? input.exportedAt : new Date().toISOString(),
    project,
    blobs,
  };
}

function base64ToBuffer(base64) {
  const text = String(base64 || '');
  const commaIndex = text.indexOf(',');
  const clean = commaIndex >= 0 ? text.slice(commaIndex + 1) : text;
  return Buffer.from(clean, 'base64');
}

function isBackgroundJobBlobKey(blobKey) {
  return String(blobKey || '').startsWith('background-');
}

function getBackgroundInputShaPrefix(blobKey) {
  const match = String(blobKey || '').match(/^background-image-inputs\/([a-f0-9]{16,64})-/i);
  return match ? match[1].toLowerCase() : '';
}

function findFileBackgroundInputFallback(manifest, blobKey) {
  const shaPrefix = getBackgroundInputShaPrefix(blobKey);
  if (!shaPrefix) return null;
  for (const record of Object.values(manifest.blobs || {})) {
    const sha = String(record?.sha256 || '').toLowerCase();
    if (record?.objectKey && sha.startsWith(shaPrefix)) return record;
  }
  return null;
}

function createInternalBlobDownloadDescriptor(projectId, blobKey) {
  return {
    method: 'GET',
    url: `/api/cloud/projects/${encodeURIComponent(projectId)}/blobs/raw?blobKey=${encodeURIComponent(blobKey)}`,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  };
}

function buildMetadata(snapshot, sizeBytes, updatedAt = new Date().toISOString()) {
  const project = snapshot.project;
  const blobCount = isPlainObject(snapshot.blobs) ? Object.keys(snapshot.blobs).length : 0;
  return {
    storeVersion: STORE_VERSION,
    projectId: project.id,
    name: project.name || '未命名项目',
    updatedAt,
    exportedAt: snapshot.exportedAt || null,
    chapterCount: Array.isArray(project.chapters) ? project.chapters.length : 0,
    blobCount,
    sizeBytes,
  };
}

async function readProjectMetadata(projectDir) {
  const metadataPath = path.join(projectDir, 'metadata.json');
  try {
    return await readJson(metadataPath);
  } catch {
    const snapshotPath = path.join(projectDir, 'snapshot.json');
    const snapshot = await readJson(snapshotPath);
    const stat = await fsp.stat(snapshotPath);
    return buildMetadata(snapshot, stat.size);
  }
}

async function listFileCloudProjectsForUser(userId) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const projectsDir = getUserProjectsDir(normalizedUserId);
  let entries = [];

  try {
    entries = await fsp.readdir(projectsDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }

  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const metadata = await readProjectMetadata(path.join(projectsDir, entry.name));
      projects.push(metadata);
    } catch {
      // Ignore incomplete project folders.
    }
  }

  projects.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  return projects;
}

async function deleteFileCloudProjectForUser(userId, projectId) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  await fsp.rm(getProjectDir(normalizedUserId, normalizedProjectId), { recursive: true, force: true });
}

async function getFileCloudProjectSnapshot(userId, projectId) {
  const snapshotPath = path.join(getProjectDir(userId, projectId), 'snapshot.json');
  try {
    return await readJson(snapshotPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new HttpError(404, 'Cloud project not found');
    throw error;
  }
}

async function putFileCloudProjectSnapshot(userId, projectId, snapshot) {
  const projectDir = getProjectDir(userId, projectId);
  const snapshotPath = path.join(projectDir, 'snapshot.json');
  const metadataPath = path.join(projectDir, 'metadata.json');

  const sizeBytes = await atomicWriteJson(snapshotPath, snapshot);
  const metadata = buildMetadata(snapshot, sizeBytes);
  await atomicWriteJson(metadataPath, metadata);
  return metadata;
}

async function readFileBlobManifest(userId, projectId) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  try {
    const parsed = await readJson(getFileBlobManifestPath(normalizedUserId, normalizedProjectId));
    return {
      version: STORE_VERSION,
      blobs: isPlainObject(parsed.blobs) ? parsed.blobs : {},
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { version: STORE_VERSION, blobs: {} };
    throw error;
  }
}

async function writeFileBlobManifest(userId, projectId, manifest) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  const cleanManifest = {
    version: STORE_VERSION,
    blobs: isPlainObject(manifest.blobs) ? manifest.blobs : {},
  };
  await atomicWriteJson(getFileBlobManifestPath(normalizedUserId, normalizedProjectId), cleanManifest);
  return cleanManifest;
}

function getFileBlobRows(manifest) {
  return Object.entries(manifest.blobs || {}).map(([blobKey, record]) => ({
    blobKey,
    objectKey: record?.objectKey,
    contentType: record?.contentType || 'application/octet-stream',
    sizeBytes: Number(record?.sizeBytes || 0),
    sha256: record?.sha256,
    createdAt: record?.createdAt,
    updatedAt: record?.updatedAt,
  })).filter((row) => row.objectKey);
}

async function updateFileProjectMetadataFromManifest(userId, projectId, manifest) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  const projectDir = getProjectDir(normalizedUserId, normalizedProjectId);
  const metadataPath = path.join(projectDir, 'metadata.json');
  const rows = getFileBlobRows(manifest);
  const blobBytes = sumUniqueObjectBytes(rows.map((row) => ({
    object_key: row.objectKey,
    size_bytes: row.sizeBytes,
  })));
  let projectBytes = 0;
  try {
    const stat = await fsp.stat(path.join(projectDir, 'snapshot.json'));
    projectBytes = stat.size;
  } catch {
    projectBytes = 0;
  }

  let metadata;
  try {
    metadata = await readProjectMetadata(projectDir);
  } catch {
    metadata = {
      storeVersion: STORE_VERSION,
      projectId: normalizedProjectId,
      name: 'Untitled project',
      updatedAt: new Date().toISOString(),
      exportedAt: null,
      chapterCount: 0,
      blobCount: 0,
      sizeBytes: 0,
    };
  }

  const next = {
    ...metadata,
    blobCount: rows.length,
    sizeBytes: projectBytes + blobBytes,
    updatedAt: new Date().toISOString(),
  };
  await atomicWriteJson(metadataPath, next);
  return next;
}

async function findReusableFileBlob(manifest, digest, sizeBytes, excludeBlobKey, excludeObjectKey) {
  const rows = getFileBlobRows(manifest)
    .filter((row) =>
      row.sha256 === digest
      && Number(row.sizeBytes || 0) === Number(sizeBytes || 0)
      && (!excludeBlobKey || row.blobKey !== excludeBlobKey)
      && (!excludeObjectKey || row.objectKey !== excludeObjectKey));

  rows.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  for (const row of rows) {
    try {
      const metadata = await headObject(row.objectKey);
      if (Number(metadata.contentLength || 0) === Number(sizeBytes || 0)) return row;
    } catch {
      // Ignore stale file manifest records whose object has disappeared.
    }
  }
  return null;
}

async function deleteFileObjectKeysIfUnreferenced(manifest, objectKeys) {
  const candidates = [...new Set((objectKeys || []).filter(Boolean))];
  if (candidates.length === 0) return;
  const referenced = new Set(getFileBlobRows(manifest).map((row) => row.objectKey));
  await deleteObjects(candidates.filter((key) => !referenced.has(key)));
}

function requirePostgresCloudStore() {
  if (!isPostgresConfigured()) {
    throw new Error('DATABASE_URL is required when CLOUD_STORE_DRIVER=postgres');
  }
}

function rowToMetadata(row) {
  return {
    storeVersion: STORE_VERSION,
    projectId: row.project_id,
    name: row.name,
    updatedAt: toIso(row.updated_at) || new Date().toISOString(),
    exportedAt: toIso(row.exported_at),
    chapterCount: Number(row.chapter_count || 0),
    blobCount: Number(row.blob_count || 0),
    sizeBytes: Number(row.size_bytes || 0),
  };
}

function projectJsonSizeBytes(snapshot) {
  return Buffer.byteLength(JSON.stringify({
    version: snapshot.version,
    exportedAt: snapshot.exportedAt,
    project: snapshot.project,
    blobs: {},
  }), 'utf8');
}

function buildObjectKey({ userId, projectId, blobKey, digest }) {
  const safeBlobKey = encodeURIComponent(String(blobKey));
  return `users/${userId}/projects/${projectId}/blobs/${safeBlobKey}-${digest.slice(0, 16)}`;
}

function sanitizeBlobKey(value) {
  const key = String(value || '').trim();
  if (!key || key.length > 700 || key.includes('\0') || key.includes('..')) {
    throw new HttpError(400, 'blobKey contains unsupported characters');
  }
  return key;
}

function normalizeSha256(value) {
  const digest = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new HttpError(400, 'sha256 must be a 64-character hex string');
  }
  return digest;
}

function normalizeContentType(value) {
  const contentType = String(value || 'application/octet-stream').trim();
  if (!contentType || contentType.length > 160 || /[\r\n]/.test(contentType)) {
    throw new HttpError(400, 'contentType contains unsupported characters');
  }
  return contentType;
}

function normalizeSizeBytes(value) {
  const sizeBytes = Number(value);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > DIRECT_BLOB_MAX_BYTES) {
    throw new HttpError(400, `sizeBytes must be between 1 and ${DIRECT_BLOB_MAX_BYTES}`);
  }
  return sizeBytes;
}

function normalizeBlobKeyList(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'blobKeys must be an array');
  if (value.length > DIRECT_URL_BATCH_LIMIT) {
    throw new HttpError(400, `blobKeys contains more than ${DIRECT_URL_BATCH_LIMIT} items`);
  }
  return [...new Set(value.map(sanitizeBlobKey))];
}

function makeContentReuseKey(digest, sizeBytes) {
  return `${digest}:${Number(sizeBytes || 0)}`;
}

function sumUniqueObjectBytes(rows) {
  const bytesByObjectKey = new Map();
  for (const row of rows || []) {
    const objectKey = row.object_key || row.objectKey;
    if (!objectKey || bytesByObjectKey.has(objectKey)) continue;
    bytesByObjectKey.set(objectKey, Number(row.size_bytes || row.sizeBytes || 0));
  }
  return [...bytesByObjectKey.values()].reduce((sum, value) => sum + value, 0);
}

async function findReusablePostgresBlob({
  userId,
  projectId,
  digest,
  sizeBytes,
  excludeBlobKey,
  excludeObjectKey,
}) {
  const params = [userId, projectId, digest, Number(sizeBytes || 0)];
  const filters = [
    'user_id = $1',
    'project_id = $2',
    'sha256 = $3',
    'size_bytes = $4',
  ];
  if (excludeBlobKey) {
    params.push(excludeBlobKey);
    filters.push(`blob_key <> $${params.length}`);
  }
  if (excludeObjectKey) {
    params.push(excludeObjectKey);
    filters.push(`object_key <> $${params.length}`);
  }

  const result = await query(`
    SELECT blob_key, object_key, content_type, size_bytes, sha256
    FROM xiakeman_cloud_project_blobs
    WHERE ${filters.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT 8
  `, params);

  for (const row of result.rows) {
    try {
      const metadata = await headObject(row.object_key);
      if (Number(metadata.contentLength || 0) === Number(sizeBytes || 0)) {
        return row;
      }
    } catch {
      // Ignore stale DB rows whose object has already disappeared.
    }
  }
  return null;
}

async function deleteObjectKeysIfUnreferenced(userId, projectId, objectKeys) {
  const candidates = [...new Set((objectKeys || []).filter(Boolean))];
  if (candidates.length === 0) return;

  const result = await query(`
    SELECT DISTINCT object_key
    FROM xiakeman_cloud_project_blobs
    WHERE user_id = $1 AND project_id = $2 AND object_key = ANY($3::text[])
  `, [userId, projectId, candidates]);
  const stillReferenced = new Set(result.rows.map((row) => row.object_key));
  await deleteObjects(candidates.filter((key) => !stillReferenced.has(key)));
}

async function upsertPostgresCloudBlobRecord({
  userId,
  projectId,
  blobKey,
  objectKey,
  contentType,
  sizeBytes,
  digest,
}) {
  const oldResult = await query(`
    SELECT object_key
    FROM xiakeman_cloud_project_blobs
    WHERE user_id = $1 AND project_id = $2 AND blob_key = $3
  `, [userId, projectId, blobKey]);
  const oldObjectKey = oldResult.rows[0]?.object_key;

  await query(`
    INSERT INTO xiakeman_cloud_project_blobs (
      user_id, project_id, blob_key, object_key, content_type, size_bytes, sha256, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
    ON CONFLICT (user_id, project_id, blob_key) DO UPDATE SET
      object_key = EXCLUDED.object_key,
      content_type = EXCLUDED.content_type,
      size_bytes = EXCLUDED.size_bytes,
      sha256 = EXCLUDED.sha256,
      updated_at = now()
  `, [
    userId,
    projectId,
    blobKey,
    objectKey,
    normalizeContentType(contentType),
    sizeBytes,
    digest,
  ]);

  return oldObjectKey;
}

async function listPostgresCloudProjectsForUser(userId) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  requirePostgresCloudStore();
  await ensureCommercialSchema();
  const result = await query(`
    SELECT project_id, name, exported_at, chapter_count, blob_count, size_bytes, updated_at
    FROM xiakeman_cloud_projects
    WHERE user_id = $1
    ORDER BY updated_at DESC
  `, [normalizedUserId]);
  return result.rows.map(rowToMetadata);
}

async function getPostgresCloudProjectSnapshot(userId, projectId) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  requirePostgresCloudStore();
  await ensureCommercialSchema();

  const projectResult = await query(`
    SELECT version, exported_at, project_json
    FROM xiakeman_cloud_projects
    WHERE user_id = $1 AND project_id = $2
  `, [normalizedUserId, normalizedProjectId]);
  if (projectResult.rowCount === 0) throw new HttpError(404, 'Cloud project not found');

  const blobResult = await query(`
    SELECT blob_key, object_key
    FROM xiakeman_cloud_project_blobs
    WHERE user_id = $1 AND project_id = $2
    ORDER BY blob_key ASC
  `, [normalizedUserId, normalizedProjectId]);

  const blobs = {};
  for (const row of blobResult.rows) {
    const buffer = await getObjectBuffer(row.object_key);
    blobs[row.blob_key] = buffer.toString('base64');
  }

  const projectRow = projectResult.rows[0];
  return {
    version: Number(projectRow.version || 1),
    exportedAt: toIso(projectRow.exported_at) || new Date().toISOString(),
    project: projectRow.project_json,
    blobs,
  };
}

async function getPostgresCloudProjectStructure(userId, projectId) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  requirePostgresCloudStore();
  await ensureCommercialSchema();

  const projectResult = await query(`
    SELECT version, exported_at, project_json
    FROM xiakeman_cloud_projects
    WHERE user_id = $1 AND project_id = $2
  `, [normalizedUserId, normalizedProjectId]);
  if (projectResult.rowCount === 0) throw new HttpError(404, 'Cloud project not found');

  const projectRow = projectResult.rows[0];
  return {
    version: Number(projectRow.version || 1),
    exportedAt: toIso(projectRow.exported_at) || new Date().toISOString(),
    project: projectRow.project_json,
    blobs: {},
  };
}

async function getPostgresCloudProjectManifest(userId, projectId) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  requirePostgresCloudStore();
  await ensureCommercialSchema();

  const projectResult = await query(`
    SELECT project_id, name, exported_at, chapter_count, blob_count, size_bytes, updated_at
    FROM xiakeman_cloud_projects
    WHERE user_id = $1 AND project_id = $2
  `, [normalizedUserId, normalizedProjectId]);
  if (projectResult.rowCount === 0) throw new HttpError(404, 'Cloud project not found');

  const blobResult = await query(`
    SELECT blob_key, content_type, size_bytes, sha256, updated_at
    FROM xiakeman_cloud_project_blobs
    WHERE user_id = $1 AND project_id = $2
    ORDER BY blob_key ASC
  `, [normalizedUserId, normalizedProjectId]);

  return {
    project: rowToMetadata(projectResult.rows[0]),
    blobs: blobResult.rows.map((row) => ({
      blobKey: row.blob_key,
      contentType: row.content_type,
      sizeBytes: Number(row.size_bytes || 0),
      sha256: row.sha256,
      updatedAt: toIso(row.updated_at) || new Date().toISOString(),
    })),
  };
}

async function putPostgresCloudProjectSnapshot(userId, projectId, snapshot) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  requirePostgresCloudStore();
  await ensureCommercialSchema();

  const blobEntries = Object.entries(snapshot.blobs || {});
  const uploadedBlobs = [];
  const uploadedObjectSizes = new Map();
  const reusableByContent = new Map();

  for (const [blobKey, base64] of blobEntries) {
    const buffer = base64ToBuffer(base64);
    const digest = sha256(buffer);
    const reuseKey = makeContentReuseKey(digest, buffer.byteLength);
    let objectKey = reusableByContent.get(reuseKey);

    if (!objectKey) {
      const reusable = await findReusablePostgresBlob({
        userId: normalizedUserId,
        projectId: normalizedProjectId,
        digest,
        sizeBytes: buffer.byteLength,
      });
      objectKey = reusable?.object_key;
    }

    if (!objectKey) {
      objectKey = buildObjectKey({
        userId: normalizedUserId,
        projectId: normalizedProjectId,
        blobKey,
        digest,
      });
      await putObjectBuffer(objectKey, buffer, 'application/octet-stream');
    }

    reusableByContent.set(reuseKey, objectKey);
    uploadedObjectSizes.set(objectKey, buffer.byteLength);
    uploadedBlobs.push({
      blobKey,
      objectKey,
      sizeBytes: buffer.byteLength,
      sha256: digest,
    });
  }

  const exportedAt = snapshot.exportedAt || new Date().toISOString();
  const now = new Date().toISOString();
  const projectJsonBytes = projectJsonSizeBytes(snapshot);
  const metadata = buildMetadata(
    snapshot,
    projectJsonBytes + [...uploadedObjectSizes.values()].reduce((sum, value) => sum + value, 0),
    now,
  );
  let oldObjectKeys = [];

  await withTransaction(async (client) => {
    const oldResult = await client.query(`
      SELECT object_key
      FROM xiakeman_cloud_project_blobs
      WHERE user_id = $1 AND project_id = $2
    `, [normalizedUserId, normalizedProjectId]);
    oldObjectKeys = oldResult.rows.map((row) => row.object_key);

    await client.query(`
      INSERT INTO xiakeman_cloud_projects (
        user_id, project_id, name, version, exported_at, project_json,
        chapter_count, blob_count, size_bytes, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb, $7, $8, $9, $10::timestamptz, $10::timestamptz)
      ON CONFLICT (user_id, project_id) DO UPDATE SET
        name = EXCLUDED.name,
        version = EXCLUDED.version,
        exported_at = EXCLUDED.exported_at,
        project_json = EXCLUDED.project_json,
        chapter_count = EXCLUDED.chapter_count,
        blob_count = EXCLUDED.blob_count,
        size_bytes = EXCLUDED.size_bytes,
        updated_at = EXCLUDED.updated_at
    `, [
      normalizedUserId,
      normalizedProjectId,
      metadata.name,
      snapshot.version,
      exportedAt,
      JSON.stringify(snapshot.project),
      metadata.chapterCount,
      uploadedBlobs.length,
      metadata.sizeBytes,
      now,
    ]);

    await client.query(`
      DELETE FROM xiakeman_cloud_project_blobs
      WHERE user_id = $1 AND project_id = $2
    `, [normalizedUserId, normalizedProjectId]);

    for (const blob of uploadedBlobs) {
      await client.query(`
        INSERT INTO xiakeman_cloud_project_blobs (
          user_id, project_id, blob_key, object_key, content_type, size_bytes, sha256, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, 'application/octet-stream', $5, $6, $7::timestamptz, $7::timestamptz)
      `, [
        normalizedUserId,
        normalizedProjectId,
        blob.blobKey,
        blob.objectKey,
        blob.sizeBytes,
        blob.sha256,
        now,
      ]);
    }
  });

  const uploadedObjectKeys = new Set(uploadedBlobs.map((blob) => blob.objectKey));
  await deleteObjects(oldObjectKeys.filter((key) => !uploadedObjectKeys.has(key)));
  return metadata;
}

async function putPostgresCloudProjectStructure(userId, projectId, snapshot) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  requirePostgresCloudStore();
  await ensureCommercialSchema();

  const exportedAt = snapshot.exportedAt || new Date().toISOString();
  const now = new Date().toISOString();
  const projectJsonBytes = projectJsonSizeBytes({ ...snapshot, exportedAt, blobs: {} });
  const metadata = buildMetadata({ ...snapshot, exportedAt, blobs: {} }, projectJsonBytes, now);

  const result = await query(`
    INSERT INTO xiakeman_cloud_projects (
      user_id, project_id, name, version, exported_at, project_json,
      chapter_count, blob_count, size_bytes, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb, $7, 0, $8, $9::timestamptz, $9::timestamptz)
    ON CONFLICT (user_id, project_id) DO UPDATE SET
      name = EXCLUDED.name,
      version = EXCLUDED.version,
      exported_at = EXCLUDED.exported_at,
      project_json = EXCLUDED.project_json,
      chapter_count = EXCLUDED.chapter_count,
      size_bytes = EXCLUDED.size_bytes,
      updated_at = EXCLUDED.updated_at
    RETURNING project_id, name, exported_at, chapter_count, blob_count, size_bytes, updated_at
  `, [
    normalizedUserId,
    normalizedProjectId,
    metadata.name,
    snapshot.version,
    exportedAt,
    JSON.stringify(snapshot.project),
    metadata.chapterCount,
    projectJsonBytes,
    now,
  ]);

  return rowToMetadata(result.rows[0]);
}

async function putPostgresCloudProjectBlob(userId, projectId, blobKey, buffer, contentType) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  const normalizedBlobKey = sanitizeBlobKey(blobKey);
  requirePostgresCloudStore();
  await ensureCommercialSchema();

  if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
    throw new HttpError(400, 'Blob body is empty');
  }

  const projectResult = await query(`
    SELECT 1
    FROM xiakeman_cloud_projects
    WHERE user_id = $1 AND project_id = $2
  `, [normalizedUserId, normalizedProjectId]);
  if (projectResult.rowCount === 0) throw new HttpError(404, 'Cloud project structure not found');

  const digest = sha256(buffer);
  const reusable = await findReusablePostgresBlob({
    userId: normalizedUserId,
    projectId: normalizedProjectId,
    digest,
    sizeBytes: buffer.byteLength,
  });
  const objectKey = reusable?.object_key || buildObjectKey({
    userId: normalizedUserId,
    projectId: normalizedProjectId,
    blobKey: normalizedBlobKey,
    digest,
  });

  if (!reusable) {
    await putObjectBuffer(objectKey, buffer, contentType || 'application/octet-stream');
  }
  const oldObjectKey = await upsertPostgresCloudBlobRecord({
    userId: normalizedUserId,
    projectId: normalizedProjectId,
    blobKey: normalizedBlobKey,
    objectKey,
    contentType: contentType || 'application/octet-stream',
    sizeBytes: buffer.byteLength,
    digest,
  });

  if (oldObjectKey && oldObjectKey !== objectKey) {
    await deleteObjectKeysIfUnreferenced(normalizedUserId, normalizedProjectId, [oldObjectKey]);
  }

  return {
    blobKey: normalizedBlobKey,
    objectKey,
    sizeBytes: buffer.byteLength,
    sha256: digest,
    reused: !!reusable,
    reusedFromBlobKey: reusable?.blob_key,
  };
}

async function putFileCloudProjectBlob(userId, projectId, blobKey, buffer, contentType) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  const normalizedBlobKey = sanitizeBlobKey(blobKey);

  if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
    throw new HttpError(400, 'Blob body is empty');
  }

  const manifest = await readFileBlobManifest(normalizedUserId, normalizedProjectId);
  const digest = sha256(buffer);
  const now = new Date().toISOString();
  const reusable = await findReusableFileBlob(manifest, digest, buffer.byteLength, normalizedBlobKey);
  const objectKey = reusable?.objectKey || buildObjectKey({
    userId: normalizedUserId,
    projectId: normalizedProjectId,
    blobKey: normalizedBlobKey,
    digest,
  });

  if (!reusable) {
    await putObjectBuffer(objectKey, buffer, contentType || 'application/octet-stream');
  }

  const oldObjectKey = manifest.blobs[normalizedBlobKey]?.objectKey;
  manifest.blobs[normalizedBlobKey] = {
    blobKey: normalizedBlobKey,
    objectKey,
    contentType: contentType || 'application/octet-stream',
    sizeBytes: buffer.byteLength,
    sha256: digest,
    createdAt: manifest.blobs[normalizedBlobKey]?.createdAt || now,
    updatedAt: now,
  };

  await writeFileBlobManifest(normalizedUserId, normalizedProjectId, manifest);
  if (oldObjectKey && oldObjectKey !== objectKey) {
    await deleteFileObjectKeysIfUnreferenced(manifest, [oldObjectKey]);
  }
  await updateFileProjectMetadataFromManifest(normalizedUserId, normalizedProjectId, manifest);

  return {
    blobKey: normalizedBlobKey,
    objectKey,
    sizeBytes: buffer.byteLength,
    sha256: digest,
    reused: !!reusable,
    reusedFromBlobKey: reusable?.blobKey,
  };
}

async function createPostgresDirectBlobUpload(userId, projectId, input) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  const normalizedBlobKey = sanitizeBlobKey(input?.blobKey);
  const digest = normalizeSha256(input?.sha256);
  const sizeBytes = normalizeSizeBytes(input?.sizeBytes);
  const contentType = normalizeContentType(input?.contentType);
  requirePostgresCloudStore();
  await ensureCommercialSchema();

  const directStatus = await getDirectObjectStorageStatus();
  const useSignedDownload = directStatus.enabled;

  const projectResult = await query(`
    SELECT 1
    FROM xiakeman_cloud_projects
    WHERE user_id = $1 AND project_id = $2
  `, [normalizedUserId, normalizedProjectId]);
  if (projectResult.rowCount === 0) throw new HttpError(404, 'Cloud project structure not found');

  const reusable = await findReusablePostgresBlob({
    userId: normalizedUserId,
    projectId: normalizedProjectId,
    digest,
    sizeBytes,
  });
  if (reusable) {
    const oldObjectKey = await upsertPostgresCloudBlobRecord({
      userId: normalizedUserId,
      projectId: normalizedProjectId,
      blobKey: normalizedBlobKey,
      objectKey: reusable.object_key,
      contentType,
      sizeBytes,
      digest,
    });
    if (oldObjectKey && oldObjectKey !== reusable.object_key) {
      await deleteObjectKeysIfUnreferenced(normalizedUserId, normalizedProjectId, [oldObjectKey]);
    }
    return {
      blobKey: normalizedBlobKey,
      sizeBytes,
      sha256: digest,
      contentType,
      objectKey: reusable.object_key,
      reused: true,
      reusedFromBlobKey: reusable.blob_key,
    };
  }

  const objectKey = buildObjectKey({
    userId: normalizedUserId,
    projectId: normalizedProjectId,
    blobKey: normalizedBlobKey,
    digest,
  });
  const signed = await createSignedPutUrl(objectKey, contentType);
  return {
    blobKey: normalizedBlobKey,
    sizeBytes,
    sha256: digest,
    contentType,
    upload: signed,
  };
}

async function completePostgresDirectBlobUpload(userId, projectId, input) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  const normalizedBlobKey = sanitizeBlobKey(input?.blobKey);
  const digest = normalizeSha256(input?.sha256);
  const sizeBytes = normalizeSizeBytes(input?.sizeBytes);
  const contentType = normalizeContentType(input?.contentType);
  requirePostgresCloudStore();
  await ensureCommercialSchema();

  const objectKey = buildObjectKey({
    userId: normalizedUserId,
    projectId: normalizedProjectId,
    blobKey: normalizedBlobKey,
    digest,
  });
  const projectResult = await query(`
    SELECT 1
    FROM xiakeman_cloud_projects
    WHERE user_id = $1 AND project_id = $2
  `, [normalizedUserId, normalizedProjectId]);
  if (projectResult.rowCount === 0) throw new HttpError(404, 'Cloud project structure not found');

  const metadata = await headObject(objectKey);
  if (Number(metadata.contentLength || 0) !== sizeBytes) {
    await deleteObjects([objectKey]).catch(() => undefined);
    throw new HttpError(409, 'Uploaded object size does not match the expected blob size');
  }

  const reusable = await findReusablePostgresBlob({
    userId: normalizedUserId,
    projectId: normalizedProjectId,
    digest,
    sizeBytes,
    excludeObjectKey: objectKey,
  });
  const finalObjectKey = reusable?.object_key || objectKey;
  const oldObjectKey = await upsertPostgresCloudBlobRecord({
    userId: normalizedUserId,
    projectId: normalizedProjectId,
    blobKey: normalizedBlobKey,
    objectKey: finalObjectKey,
    contentType,
    sizeBytes,
    digest,
  });

  const deleteCandidates = [];
  if (reusable) deleteCandidates.push(objectKey);
  if (oldObjectKey && oldObjectKey !== finalObjectKey) deleteCandidates.push(oldObjectKey);
  if (deleteCandidates.length > 0) {
    await deleteObjectKeysIfUnreferenced(normalizedUserId, normalizedProjectId, deleteCandidates);
  }

  return {
    blobKey: normalizedBlobKey,
    objectKey: finalObjectKey,
    sizeBytes,
    sha256: digest,
    contentType,
    reused: !!reusable,
    reusedFromBlobKey: reusable?.blob_key,
  };
}

async function getFileCloudProjectManifest(userId, projectId) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  const manifest = await readFileBlobManifest(normalizedUserId, normalizedProjectId);
  let project;
  try {
    project = await readProjectMetadata(getProjectDir(normalizedUserId, normalizedProjectId));
  } catch {
    project = await updateFileProjectMetadataFromManifest(normalizedUserId, normalizedProjectId, manifest);
  }
  return {
    project,
    blobs: getFileBlobRows(manifest).map((row) => ({
      blobKey: row.blobKey,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      updatedAt: row.updatedAt || new Date().toISOString(),
    })),
  };
}

async function getFileCloudProjectStructure(userId, projectId) {
  const snapshot = await getFileCloudProjectSnapshot(userId, projectId);
  return { ...snapshot, blobs: {} };
}

async function putFileCloudProjectStructure(userId, projectId, snapshot) {
  return putFileCloudProjectSnapshot(userId, projectId, { ...snapshot, blobs: {} });
}

async function createFileDirectBlobUpload(userId, projectId, input) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  const normalizedBlobKey = sanitizeBlobKey(input?.blobKey);
  const digest = normalizeSha256(input?.sha256);
  const sizeBytes = normalizeSizeBytes(input?.sizeBytes);
  const contentType = normalizeContentType(input?.contentType);
  const manifest = await readFileBlobManifest(normalizedUserId, normalizedProjectId);
  const reusable = await findReusableFileBlob(manifest, digest, sizeBytes, normalizedBlobKey);

  if (reusable) {
    const now = new Date().toISOString();
    const oldObjectKey = manifest.blobs[normalizedBlobKey]?.objectKey;
    manifest.blobs[normalizedBlobKey] = {
      blobKey: normalizedBlobKey,
      objectKey: reusable.objectKey,
      contentType,
      sizeBytes,
      sha256: digest,
      createdAt: manifest.blobs[normalizedBlobKey]?.createdAt || now,
      updatedAt: now,
    };
    await writeFileBlobManifest(normalizedUserId, normalizedProjectId, manifest);
    if (oldObjectKey && oldObjectKey !== reusable.objectKey) {
      await deleteFileObjectKeysIfUnreferenced(manifest, [oldObjectKey]);
    }
    await updateFileProjectMetadataFromManifest(normalizedUserId, normalizedProjectId, manifest);
    return {
      blobKey: normalizedBlobKey,
      sizeBytes,
      sha256: digest,
      contentType,
      objectKey: reusable.objectKey,
      reused: true,
      reusedFromBlobKey: reusable.blobKey,
    };
  }

  const objectKey = buildObjectKey({
    userId: normalizedUserId,
    projectId: normalizedProjectId,
    blobKey: normalizedBlobKey,
    digest,
  });
  const signed = await createSignedPutUrl(objectKey, contentType);
  return {
    blobKey: normalizedBlobKey,
    sizeBytes,
    sha256: digest,
    contentType,
    upload: signed,
  };
}

async function completeFileDirectBlobUpload(userId, projectId, input) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  const normalizedBlobKey = sanitizeBlobKey(input?.blobKey);
  const digest = normalizeSha256(input?.sha256);
  const sizeBytes = normalizeSizeBytes(input?.sizeBytes);
  const contentType = normalizeContentType(input?.contentType);
  const objectKey = buildObjectKey({
    userId: normalizedUserId,
    projectId: normalizedProjectId,
    blobKey: normalizedBlobKey,
    digest,
  });
  const metadata = await headObject(objectKey);
  if (Number(metadata.contentLength || 0) !== sizeBytes) {
    await deleteObjects([objectKey]).catch(() => undefined);
    throw new HttpError(409, 'Uploaded object size does not match the expected blob size');
  }

  const manifest = await readFileBlobManifest(normalizedUserId, normalizedProjectId);
  const reusable = await findReusableFileBlob(manifest, digest, sizeBytes, normalizedBlobKey, objectKey);
  const finalObjectKey = reusable?.objectKey || objectKey;
  const oldObjectKey = manifest.blobs[normalizedBlobKey]?.objectKey;
  const now = new Date().toISOString();
  manifest.blobs[normalizedBlobKey] = {
    blobKey: normalizedBlobKey,
    objectKey: finalObjectKey,
    contentType,
    sizeBytes,
    sha256: digest,
    createdAt: manifest.blobs[normalizedBlobKey]?.createdAt || now,
    updatedAt: now,
  };
  await writeFileBlobManifest(normalizedUserId, normalizedProjectId, manifest);

  const deleteCandidates = [];
  if (reusable) deleteCandidates.push(objectKey);
  if (oldObjectKey && oldObjectKey !== finalObjectKey) deleteCandidates.push(oldObjectKey);
  await deleteFileObjectKeysIfUnreferenced(manifest, deleteCandidates);
  await updateFileProjectMetadataFromManifest(normalizedUserId, normalizedProjectId, manifest);

  return {
    blobKey: normalizedBlobKey,
    objectKey: finalObjectKey,
    sizeBytes,
    sha256: digest,
    contentType,
    reused: !!reusable,
    reusedFromBlobKey: reusable?.blobKey,
  };
}

async function createFileDirectDownloadUrls(userId, projectId, blobKeys) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  const requestedBlobKeys = normalizeBlobKeyList(blobKeys);
  if (requestedBlobKeys.length === 0) {
    throw new HttpError(400, 'blobKeys must contain at least one item');
  }

  const manifest = await readFileBlobManifest(normalizedUserId, normalizedProjectId);
  const blobs = [];
  for (const blobKey of requestedBlobKeys) {
    const row = manifest.blobs[blobKey] || findFileBackgroundInputFallback(manifest, blobKey);
    if (!row?.objectKey) throw new HttpError(404, `Cloud blob not found: ${blobKey}`);
    blobs.push({
      blobKey,
      objectKey: row.objectKey,
      contentType: row.contentType || 'application/octet-stream',
      sizeBytes: Number(row.sizeBytes || 0),
      sha256: row.sha256,
      updatedAt: row.updatedAt || new Date().toISOString(),
      download: createInternalBlobDownloadDescriptor(normalizedProjectId, blobKey),
    });
  }
  return { blobs };
}

async function getFileCloudProjectBlobBufferForUser(userId, projectId, blobKey) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  const normalizedBlobKey = sanitizeBlobKey(blobKey);
  const manifest = await readFileBlobManifest(normalizedUserId, normalizedProjectId);
  const row = manifest.blobs[normalizedBlobKey] || findFileBackgroundInputFallback(manifest, normalizedBlobKey);
  if (!row?.objectKey) throw new HttpError(404, `Cloud blob not found: ${normalizedBlobKey}`);
  const buffer = await getObjectBuffer(row.objectKey);
  return {
    blobKey: normalizedBlobKey,
    objectKey: row.objectKey,
    contentType: row.contentType || 'application/octet-stream',
    sizeBytes: Number(row.sizeBytes || buffer.byteLength || 0),
    sha256: row.sha256,
    updatedAt: row.updatedAt || new Date().toISOString(),
    buffer,
  };
}

async function finalizeFileCloudProject(userId, projectId, blobKeys) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  const expectedBlobKeys = [...new Set((blobKeys || []).map(sanitizeBlobKey))];
  const manifest = await readFileBlobManifest(normalizedUserId, normalizedProjectId);
  const expectedSet = new Set(expectedBlobKeys);
  const missing = expectedBlobKeys.filter((key) => !manifest.blobs[key]?.objectKey);
  if (missing.length > 0) {
    throw new HttpError(409, `Cloud upload is missing ${missing.length} blob(s)`);
  }

  const staleObjectKeys = [];
  for (const [blobKey, record] of Object.entries(manifest.blobs)) {
    if (expectedSet.has(blobKey) || isBackgroundJobBlobKey(blobKey)) continue;
    staleObjectKeys.push(record?.objectKey);
    delete manifest.blobs[blobKey];
  }
  await writeFileBlobManifest(normalizedUserId, normalizedProjectId, manifest);
  await deleteFileObjectKeysIfUnreferenced(manifest, staleObjectKeys);
  return updateFileProjectMetadataFromManifest(normalizedUserId, normalizedProjectId, manifest);
}

async function createPostgresDirectDownloadUrls(userId, projectId, blobKeys) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  const requestedBlobKeys = normalizeBlobKeyList(blobKeys);
  if (requestedBlobKeys.length === 0) {
    throw new HttpError(400, 'blobKeys must contain at least one item');
  }
  requirePostgresCloudStore();
  await ensureCommercialSchema();

  const directStatus = await getDirectObjectStorageStatus();
  if (!directStatus.enabled) {
    throw new HttpError(400, 'Direct cloud transfer requires Tencent COS object storage');
  }

  const projectResult = await query(`
    SELECT 1
    FROM xiakeman_cloud_projects
    WHERE user_id = $1 AND project_id = $2
  `, [normalizedUserId, normalizedProjectId]);
  if (projectResult.rowCount === 0) throw new HttpError(404, 'Cloud project not found');

  const params = [normalizedUserId, normalizedProjectId];
  params.push(requestedBlobKeys);
  const filterSql = `AND blob_key = ANY($${params.length}::text[])`;

  const blobResult = await query(`
    SELECT blob_key, object_key, content_type, size_bytes, sha256, updated_at
    FROM xiakeman_cloud_project_blobs
    WHERE user_id = $1 AND project_id = $2
    ${filterSql}
    ORDER BY blob_key ASC
  `, params);

  const rowsByRequestedKey = new Map(blobResult.rows.map((row) => [row.blob_key, row]));
  const missing = requestedBlobKeys.filter((key) => !rowsByRequestedKey.has(key));
  if (missing.length > 0) {
    for (const blobKey of missing) {
      const shaPrefix = getBackgroundInputShaPrefix(blobKey);
      if (!shaPrefix) continue;
      const fallbackResult = await query(`
        SELECT blob_key, object_key, content_type, size_bytes, sha256, updated_at
        FROM xiakeman_cloud_project_blobs
        WHERE user_id = $1
          AND project_id = $2
          AND sha256 LIKE $3
        ORDER BY updated_at DESC
        LIMIT 1
      `, [normalizedUserId, normalizedProjectId, `${shaPrefix}%`]);
      if (fallbackResult.rows[0]) rowsByRequestedKey.set(blobKey, fallbackResult.rows[0]);
    }
  }

  const stillMissing = requestedBlobKeys.filter((key) => !rowsByRequestedKey.has(key));
  if (stillMissing.length > 0) {
    throw new HttpError(404, `Cloud blob not found: ${stillMissing[0]}`);
  }

  const blobs = [];
  for (const blobKey of requestedBlobKeys) {
    const row = rowsByRequestedKey.get(blobKey);
    const download = useSignedDownload
      ? await createSignedGetUrl(row.object_key)
      : createInternalBlobDownloadDescriptor(normalizedProjectId, blobKey);
    blobs.push({
      blobKey,
      objectKey: row.object_key,
      contentType: row.content_type,
      sizeBytes: Number(row.size_bytes || 0),
      sha256: row.sha256,
      updatedAt: toIso(row.updated_at) || new Date().toISOString(),
      download,
    });
  }

  return { blobs };
}

async function getPostgresCloudProjectBlobBufferForUser(userId, projectId, blobKey) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  const normalizedBlobKey = sanitizeBlobKey(blobKey);
  requirePostgresCloudStore();
  await ensureCommercialSchema();

  const projectResult = await query(`
    SELECT 1
    FROM xiakeman_cloud_projects
    WHERE user_id = $1 AND project_id = $2
  `, [normalizedUserId, normalizedProjectId]);
  if (projectResult.rowCount === 0) throw new HttpError(404, 'Cloud project not found');

  let blobResult = await query(`
    SELECT blob_key, object_key, content_type, size_bytes, sha256, updated_at
    FROM xiakeman_cloud_project_blobs
    WHERE user_id = $1
      AND project_id = $2
      AND blob_key = $3
    LIMIT 1
  `, [normalizedUserId, normalizedProjectId, normalizedBlobKey]);

  if (blobResult.rowCount === 0) {
    const shaPrefix = getBackgroundInputShaPrefix(normalizedBlobKey);
    if (shaPrefix) {
      blobResult = await query(`
        SELECT blob_key, object_key, content_type, size_bytes, sha256, updated_at
        FROM xiakeman_cloud_project_blobs
        WHERE user_id = $1
          AND project_id = $2
          AND sha256 LIKE $3
        ORDER BY updated_at DESC
        LIMIT 1
      `, [normalizedUserId, normalizedProjectId, `${shaPrefix}%`]);
    }
  }

  const row = blobResult.rows[0];
  if (!row?.object_key) throw new HttpError(404, `Cloud blob not found: ${normalizedBlobKey}`);
  const buffer = await getObjectBuffer(row.object_key);
  return {
    blobKey: normalizedBlobKey,
    objectKey: row.object_key,
    contentType: row.content_type || 'application/octet-stream',
    sizeBytes: Number(row.size_bytes || buffer.byteLength || 0),
    sha256: row.sha256,
    updatedAt: toIso(row.updated_at) || new Date().toISOString(),
    buffer,
  };
}

async function createCloudBlobDownloadUrlsForUser(userId, projectId, blobKeys) {
  if (!isPostgresCloudStoreEnabled()) {
    return createFileDirectDownloadUrls(userId, projectId, blobKeys);
  }
  return createPostgresDirectDownloadUrls(userId, projectId, blobKeys);
}

async function getCloudProjectBlobBufferForUser(userId, projectId, blobKey) {
  if (!isPostgresCloudStoreEnabled()) {
    return getFileCloudProjectBlobBufferForUser(userId, projectId, blobKey);
  }
  return getPostgresCloudProjectBlobBufferForUser(userId, projectId, blobKey);
}

async function putCloudProjectBlobBufferForUser(userId, projectId, blobKey, buffer, contentType) {
  if (!isPostgresCloudStoreEnabled()) {
    return putFileCloudProjectBlob(userId, projectId, blobKey, buffer, contentType);
  }
  return putPostgresCloudProjectBlob(userId, projectId, blobKey, buffer, contentType);
}

async function finalizePostgresCloudProject(userId, projectId, blobKeys) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  const expectedBlobKeys = [...new Set((blobKeys || []).map(sanitizeBlobKey))];
  requirePostgresCloudStore();
  await ensureCommercialSchema();

  let staleObjectKeys = [];
  const updated = await withTransaction(async (client) => {
    const projectResult = await client.query(`
      SELECT version, exported_at, project_json
      FROM xiakeman_cloud_projects
      WHERE user_id = $1 AND project_id = $2
      FOR UPDATE
    `, [normalizedUserId, normalizedProjectId]);
    if (projectResult.rowCount === 0) throw new HttpError(404, 'Cloud project not found');

    const blobResult = await client.query(`
      SELECT blob_key, object_key, size_bytes
      FROM xiakeman_cloud_project_blobs
      WHERE user_id = $1 AND project_id = $2
    `, [normalizedUserId, normalizedProjectId]);

    const expectedSet = new Set(expectedBlobKeys);
    const keptRows = blobResult.rows.filter((row) =>
      expectedSet.has(row.blob_key) || isBackgroundJobBlobKey(row.blob_key));
    const keptSet = new Set(keptRows.map((row) => row.blob_key));
    const missing = expectedBlobKeys.filter((key) => !keptSet.has(key));
    if (missing.length > 0) {
      throw new HttpError(409, `Cloud upload is missing ${missing.length} blob(s)`);
    }

    const keptObjectKeys = new Set(keptRows.map((row) => row.object_key));
    staleObjectKeys = [...new Set(blobResult.rows
      .filter((row) => !expectedSet.has(row.blob_key) && !keptObjectKeys.has(row.object_key))
      .map((row) => row.object_key))];

    await client.query(`
      DELETE FROM xiakeman_cloud_project_blobs
      WHERE user_id = $1
        AND project_id = $2
        AND NOT (blob_key = ANY($3::text[]) OR blob_key LIKE 'background-%')
    `, [normalizedUserId, normalizedProjectId, expectedBlobKeys]);

    const projectRow = projectResult.rows[0];
    const projectJsonBytes = Buffer.byteLength(JSON.stringify({
      version: Number(projectRow.version || 1),
      exportedAt: toIso(projectRow.exported_at) || new Date().toISOString(),
      project: projectRow.project_json,
      blobs: {},
    }), 'utf8');
    const blobBytes = sumUniqueObjectBytes(keptRows);

    const updateResult = await client.query(`
      UPDATE xiakeman_cloud_projects
      SET blob_count = $3,
          size_bytes = $4,
          updated_at = now()
      WHERE user_id = $1 AND project_id = $2
      RETURNING project_id, name, exported_at, chapter_count, blob_count, size_bytes, updated_at
    `, [
      normalizedUserId,
      normalizedProjectId,
      keptRows.length,
      projectJsonBytes + blobBytes,
    ]);

    return rowToMetadata(updateResult.rows[0]);
  });

  await deleteObjects(staleObjectKeys);
  return updated;
}

async function deletePostgresCloudProjectForUser(userId, projectId) {
  const normalizedUserId = sanitizeSegment(userId, 'userId');
  const normalizedProjectId = sanitizeSegment(projectId, 'projectId');
  requirePostgresCloudStore();
  await ensureCommercialSchema();
  let objectKeys = [];

  await withTransaction(async (client) => {
    const result = await client.query(`
      SELECT object_key
      FROM xiakeman_cloud_project_blobs
      WHERE user_id = $1 AND project_id = $2
    `, [normalizedUserId, normalizedProjectId]);
    objectKeys = result.rows.map((row) => row.object_key);
    await client.query(`
      DELETE FROM xiakeman_cloud_projects
      WHERE user_id = $1 AND project_id = $2
    `, [normalizedUserId, normalizedProjectId]);
  });

  await deleteObjects(objectKeys);
}

async function listCloudProjectsForUser(userId) {
  if (isPostgresCloudStoreEnabled()) {
    return await listPostgresCloudProjectsForUser(userId);
  }
  return await listFileCloudProjectsForUser(userId);
}

async function deleteCloudProjectForUser(userId, projectId) {
  if (isPostgresCloudStoreEnabled()) {
    await deletePostgresCloudProjectForUser(userId, projectId);
    return;
  }
  await deleteFileCloudProjectForUser(userId, projectId);
}

async function getCloudProjectSnapshot(userId, projectId) {
  if (isPostgresCloudStoreEnabled()) {
    return await getPostgresCloudProjectSnapshot(userId, projectId);
  }
  return await getFileCloudProjectSnapshot(userId, projectId);
}

async function putCloudProjectSnapshot(userId, projectId, snapshot) {
  if (isPostgresCloudStoreEnabled()) {
    return await putPostgresCloudProjectSnapshot(userId, projectId, snapshot);
  }
  return await putFileCloudProjectSnapshot(userId, projectId, snapshot);
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function createCloudStoreRouter({ rateLimit } = {}) {
  const router = express.Router();

  if (rateLimit) router.use(rateLimit);

  router.put('/projects/:projectId/blobs', express.raw({ type: '*/*', limit: BLOB_UPLOAD_LIMIT }), asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    const blobKey = sanitizeBlobKey(req.query.blobKey);
    const blob = await putCloudProjectBlobBufferForUser(
      userId,
      projectId,
      blobKey,
      Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || ''),
      req.get('content-type') || 'application/octet-stream',
    );
    res.json({ blob });
  }));

  router.get('/projects/:projectId/blobs/raw', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    const blobKey = sanitizeBlobKey(req.query.blobKey);
    const blob = await getCloudProjectBlobBufferForUser(userId, projectId, blobKey);
    res.setHeader('Content-Type', blob.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', String(blob.buffer.byteLength));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(blob.buffer);
  }));

  router.use(express.json({ limit: JSON_LIMIT }));

  router.get('/health', asyncRoute(async (_req, res) => {
    if (isPostgresCloudStoreEnabled()) {
      requirePostgresCloudStore();
      await ensureCommercialSchema();
      const objectStorage = await getObjectStorageStatus();
      res.json({
        ok: true,
        storage: 'postgres',
        objectStorage,
        directTransfer: await getDirectObjectStorageStatus(),
        storeVersion: STORE_VERSION,
        jsonLimit: JSON_LIMIT,
        blobUploadLimit: BLOB_UPLOAD_LIMIT,
      });
      return;
    }

    await fsp.mkdir(CLOUD_ROOT, { recursive: true });
    const objectStorage = await getObjectStorageStatus();
    res.json({
      ok: true,
      storage: 'file',
      objectStorage,
      directTransfer: await getDirectObjectStorageStatus().catch(() => ({ enabled: false, driver: objectStorage.driver })),
      storeVersion: STORE_VERSION,
      jsonLimit: JSON_LIMIT,
    });
  }));

  router.get('/projects', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projects = await listCloudProjectsForUser(userId);
    res.json({ projects });
  }));

  router.get('/projects/:projectId', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    res.json(await getCloudProjectSnapshot(userId, projectId));
  }));

  router.get('/projects/:projectId/manifest', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    res.json(isPostgresCloudStoreEnabled()
      ? await getPostgresCloudProjectManifest(userId, projectId)
      : await getFileCloudProjectManifest(userId, projectId));
  }));

  router.get('/projects/:projectId/structure', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    res.json(isPostgresCloudStoreEnabled()
      ? await getPostgresCloudProjectStructure(userId, projectId)
      : await getFileCloudProjectStructure(userId, projectId));
  }));

  router.post('/projects/:projectId/blobs/direct-upload', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    res.json({ blob: isPostgresCloudStoreEnabled()
      ? await createPostgresDirectBlobUpload(userId, projectId, req.body || {})
      : await createFileDirectBlobUpload(userId, projectId, req.body || {}) });
  }));

  router.post('/projects/:projectId/blobs/direct-complete', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    res.json({ blob: isPostgresCloudStoreEnabled()
      ? await completePostgresDirectBlobUpload(userId, projectId, req.body || {})
      : await completeFileDirectBlobUpload(userId, projectId, req.body || {}) });
  }));

  router.post('/projects/:projectId/blobs/download-urls', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    res.json(await createCloudBlobDownloadUrlsForUser(userId, projectId, req.body?.blobKeys));
  }));

  router.put('/projects/:projectId/structure', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    const snapshot = normalizeProjectSnapshot({ ...(req.body || {}), blobs: {} }, projectId);
    const metadata = isPostgresCloudStoreEnabled()
      ? await putPostgresCloudProjectStructure(userId, projectId, snapshot)
      : await putFileCloudProjectStructure(userId, projectId, snapshot);
    res.json({ project: metadata });
  }));

  router.post('/projects/:projectId/finalize', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    const metadata = isPostgresCloudStoreEnabled()
      ? await finalizePostgresCloudProject(userId, projectId, req.body?.blobKeys || [])
      : await finalizeFileCloudProject(userId, projectId, req.body?.blobKeys || []);
    res.json({ project: metadata });
  }));

  router.put('/projects/:projectId', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    const snapshot = normalizeProjectSnapshot(req.body, projectId);
    const metadata = await putCloudProjectSnapshot(userId, projectId, snapshot);
    res.json({ project: metadata });
  }));

  router.delete('/projects/:projectId', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    await deleteCloudProjectForUser(userId, projectId);
    res.json({ ok: true });
  }));

  router.use((error, req, res, _next) => {
    if (error && error.type === 'entity.too.large') {
      const limit = String(req.originalUrl || req.url || '').includes('/blobs')
        ? BLOB_UPLOAD_LIMIT
        : JSON_LIMIT;
      res.status(413).json({ error: `Upload payload is larger than ${limit}` });
      return;
    }

    const status = Number(error?.status || 500);
    if (status >= 500) {
      console.error('[cloud-store] request failed', {
        status,
        message: error?.message || String(error),
      });
    }
    res.status(status).json({
      error: status >= 500 ? 'Cloud store request failed' : String(error.message || error),
    });
  });

  return router;
}

module.exports = {
  createCloudStoreRouter,
  createCloudBlobDownloadUrlsForUser,
  deleteCloudProjectForUser,
  getCloudProjectBlobBufferForUser,
  getCloudProjectSnapshot,
  listCloudProjectsForUser,
  putCloudProjectSnapshot,
  putCloudProjectBlobBufferForUser,
};
