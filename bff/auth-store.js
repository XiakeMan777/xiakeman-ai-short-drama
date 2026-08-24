const express = require('express');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'xiakeman_session';
const AUTH_ROOT = process.env.AUTH_STORAGE_DIR
  || path.join(process.env.CLOUD_STORAGE_DIR || path.join(os.tmpdir(), 'xiakeman-cloud-store'), 'auth');
const AUTH_FILE = path.join(AUTH_ROOT, 'auth.json');
const SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_DAYS || 14) * 24 * 60 * 60 * 1000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
);
const { listCloudProjectsForUser, deleteCloudProjectForUser } = require('./cloud-store');
const {
  getPublicBackgroundWorkerConfig,
  getPublicObjectStorageConfig,
  getPublicUserAgentDefaults,
  saveBackgroundWorkerConfig,
  saveUserAgentDefaults,
  saveObjectStorageConfig,
} = require('./commercial-settings');
const {
  getObjectStorageStatus,
  resetObjectStorageClient,
  testObjectStorageConfig,
} = require('./object-storage');
const {
  getJobStoreDriver,
  getJobSummaryForAdmin,
  listJobsForAdmin,
} = require('./background-jobs');
const {
  ensureCommercialSchema,
  isPostgresConfigured,
  query,
  toIso,
  withTransaction,
} = require('./postgres');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function emptyStore() {
  return {
    version: 1,
    users: [],
    sessions: [],
    agentKeys: [],
  };
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeUserRecord(user, index) {
  const email = String(user.email || '').toLowerCase();
  const role = user.role === 'admin' || ADMIN_EMAILS.has(email) ? 'admin' : 'user';
  return {
    ...user,
    email,
    role,
    status: user.status === 'suspended' ? 'suspended' : 'active',
    displayName: String(user.displayName || email.split('@')[0] || '创作者').slice(0, 60),
    createdAt: user.createdAt || nowIso(),
    updatedAt: user.updatedAt || user.createdAt || nowIso(),
    _index: index,
  };
}

function normalizeStore(store) {
  store.users = store.users.map((user, index) => normalizeUserRecord(user, index));
  store.sessions = Array.isArray(store.sessions) ? store.sessions : [];
  store.agentKeys = Array.isArray(store.agentKeys) ? store.agentKeys : [];
  if (store.users.length > 0 && !store.users.some((user) => user.role === 'admin')) {
    store.users[0].role = 'admin';
  }
  for (const user of store.users) {
    delete user._index;
  }
  cleanupExpiredSessions(store);
  return store;
}

function isPostgresAuthStoreEnabled() {
  const driver = String(process.env.AUTH_STORE_DRIVER || '').toLowerCase();
  return driver === 'postgres' || driver === 'pg';
}

async function readPostgresStore() {
  if (!isPostgresConfigured()) {
    throw new Error('DATABASE_URL is required when AUTH_STORE_DRIVER=postgres');
  }
  await ensureCommercialSchema();
  const [usersResult, sessionsResult, agentKeysResult] = await Promise.all([
    query(`
      SELECT id, email, display_name, role, status, password_json, created_at, updated_at
      FROM xiakeman_users
      ORDER BY created_at ASC
    `),
    query(`
      SELECT id, user_id, token_hash, created_at, last_seen_at, expires_at, user_agent
      FROM xiakeman_auth_sessions
      ORDER BY created_at ASC
    `),
    query(`
      SELECT id, user_id, name, key_hash, key_prefix, created_at, last_used_at, revoked_at
      FROM xiakeman_agent_keys
      ORDER BY created_at ASC
    `),
  ]);

  return normalizeStore({
    version: 1,
    users: usersResult.rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      status: row.status,
      password: row.password_json,
      createdAt: toIso(row.created_at) || nowIso(),
      updatedAt: toIso(row.updated_at) || toIso(row.created_at) || nowIso(),
    })),
    sessions: sessionsResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      createdAt: toIso(row.created_at) || nowIso(),
      lastSeenAt: toIso(row.last_seen_at) || toIso(row.created_at) || nowIso(),
      expiresAt: toIso(row.expires_at) || nowIso(),
      userAgent: row.user_agent || '',
    })),
    agentKeys: agentKeysResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      keyHash: row.key_hash,
      keyPrefix: row.key_prefix,
      createdAt: toIso(row.created_at) || nowIso(),
      lastUsedAt: toIso(row.last_used_at) || null,
      revokedAt: toIso(row.revoked_at) || null,
    })),
  });
}

async function writePostgresStore(store) {
  if (!isPostgresConfigured()) {
    throw new Error('DATABASE_URL is required when AUTH_STORE_DRIVER=postgres');
  }
  await ensureCommercialSchema();
  await withTransaction(async (client) => {
    for (const user of store.users) {
      await client.query(`
        INSERT INTO xiakeman_users (
          id, email, display_name, role, status, password_json, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, $8::timestamptz)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          display_name = EXCLUDED.display_name,
          role = EXCLUDED.role,
          status = EXCLUDED.status,
          password_json = EXCLUDED.password_json,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
      `, [
        user.id,
        user.email,
        user.displayName,
        user.role === 'admin' ? 'admin' : 'user',
        user.status === 'suspended' ? 'suspended' : 'active',
        JSON.stringify(user.password || {}),
        user.createdAt || nowIso(),
        user.updatedAt || user.createdAt || nowIso(),
      ]);
    }

    const sessionIds = store.sessions.map((session) => session.id);
    if (sessionIds.length > 0) {
      await client.query('DELETE FROM xiakeman_auth_sessions WHERE NOT (id = ANY($1::text[]))', [sessionIds]);
    } else {
      await client.query('DELETE FROM xiakeman_auth_sessions');
    }

    for (const session of store.sessions) {
      await client.query(`
        INSERT INTO xiakeman_auth_sessions (
          id, user_id, token_hash, created_at, last_seen_at, expires_at, user_agent
        )
        VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::timestamptz, $7)
        ON CONFLICT (id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          token_hash = EXCLUDED.token_hash,
          created_at = EXCLUDED.created_at,
          last_seen_at = EXCLUDED.last_seen_at,
          expires_at = EXCLUDED.expires_at,
          user_agent = EXCLUDED.user_agent
      `, [
        session.id,
        session.userId,
        session.tokenHash,
        session.createdAt || nowIso(),
        session.lastSeenAt || session.createdAt || nowIso(),
        session.expiresAt,
        session.userAgent || '',
      ]);
    }

    for (const key of store.agentKeys || []) {
      await client.query(`
        INSERT INTO xiakeman_agent_keys (
          id, user_id, name, key_hash, key_prefix, created_at, last_used_at, revoked_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz)
        ON CONFLICT (id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          name = EXCLUDED.name,
          key_hash = EXCLUDED.key_hash,
          key_prefix = EXCLUDED.key_prefix,
          created_at = EXCLUDED.created_at,
          last_used_at = EXCLUDED.last_used_at,
          revoked_at = EXCLUDED.revoked_at
      `, [
        key.id,
        key.userId,
        key.name || 'Agent Key',
        key.keyHash,
        key.keyPrefix,
        key.createdAt || nowIso(),
        key.lastUsedAt || null,
        key.revokedAt || null,
      ]);
    }
  });
}

async function readStore() {
  if (isPostgresAuthStoreEnabled()) {
    return await readPostgresStore();
  }

  try {
    const text = await fsp.readFile(AUTH_FILE, 'utf8');
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed)) return emptyStore();
    return normalizeStore({
      version: 1,
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      agentKeys: Array.isArray(parsed.agentKeys) ? parsed.agentKeys : [],
    });
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyStore();
    throw error;
  }
}

async function writeStore(store) {
  if (isPostgresAuthStoreEnabled()) {
    await writePostgresStore(store);
    return;
  }

  await fsp.mkdir(AUTH_ROOT, { recursive: true });
  const tempPath = `${AUTH_FILE}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tempPath, JSON.stringify(store), 'utf8');
  await fsp.rename(tempPath, AUTH_FILE);
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(18).toString('base64url')}`;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, '请输入有效邮箱');
  }
  return email;
}

function normalizeDisplayName(value, fallbackEmail) {
  const displayName = String(value || '').trim();
  if (displayName) return displayName.slice(0, 60);
  return fallbackEmail.split('@')[0].slice(0, 60) || '创作者';
}

function validatePassword(value) {
  const password = String(value || '');
  if (password.length < 8) throw new HttpError(400, '密码至少 8 位');
  if (password.length > 128) throw new HttpError(400, '密码过长');
  return password;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('base64')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('base64');
  return {
    algorithm: 'scrypt',
    salt,
    hash,
  };
}

function verifyPassword(password, stored) {
  if (!stored || stored.algorithm !== 'scrypt' || !stored.salt || !stored.hash) return false;
  const expected = Buffer.from(stored.hash, 'base64');
  const actual = Buffer.from(hashPassword(password, stored.salt).hash, 'base64');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hashAgentKey(key) {
  return crypto.createHash('sha256').update(String(key || '')).digest('hex');
}

function getAgentKeyFromRequest(req) {
  const direct = String(req.get('x-agent-key') || '').trim();
  if (direct) return direct;
  const authorization = String(req.get('authorization') || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function publicAgentKey(key) {
  return {
    id: key.id,
    name: key.name || 'Agent Key',
    keyPrefix: key.keyPrefix,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt || null,
    revokedAt: key.revokedAt || null,
  };
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role === 'admin' ? 'admin' : 'user',
    status: user.status === 'suspended' ? 'suspended' : 'active',
    createdAt: user.createdAt,
  };
}

function parseCookies(header) {
  const cookies = new Map();
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies.set(key, decodeURIComponent(value));
  }
  return cookies;
}

function getSessionToken(req) {
  return parseCookies(req.headers.cookie).get(AUTH_COOKIE_NAME) || '';
}

function sessionCookie(value, maxAgeSeconds) {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (IS_PRODUCTION || process.env.AUTH_COOKIE_SECURE === 'true') parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie() {
  return sessionCookie('', 0);
}

function cleanupExpiredSessions(store) {
  const now = Date.now();
  store.sessions = store.sessions.filter((session) => Date.parse(session.expiresAt) > now);
}

async function createSession(store, user, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  store.sessions.push({
    id: randomId('sess'),
    userId: user.id,
    tokenHash: hashSessionToken(token),
    createdAt,
    lastSeenAt: createdAt,
    expiresAt,
    userAgent: String(req.get('user-agent') || '').slice(0, 220),
  });
  return token;
}

async function loadAuthFromRequest(req, { touch = false } = {}) {
  const token = getSessionToken(req);
  if (!token) return await loadAgentKeyAuthFromRequest(req, { touch });

  const store = await readStore();
  cleanupExpiredSessions(store);
  const tokenHash = hashSessionToken(token);
  const session = store.sessions.find((item) => item.tokenHash === tokenHash);
  if (!session) {
    await writeStore(store);
    return await loadAgentKeyAuthFromRequest(req, { touch });
  }

  const user = store.users.find((item) => item.id === session.userId);
  if (!user) return await loadAgentKeyAuthFromRequest(req, { touch });
  if (user.status === 'suspended') return await loadAgentKeyAuthFromRequest(req, { touch });

  if (touch && Date.now() - Date.parse(session.lastSeenAt || session.createdAt) > 5 * 60 * 1000) {
    session.lastSeenAt = nowIso();
    await writeStore(store);
  }

  return { user, session };
}

async function loadAgentKeyAuthFromRequest(req, { touch = false } = {}) {
  const key = getAgentKeyFromRequest(req);
  if (!key) return null;

  const store = await readStore();
  const keyHash = hashAgentKey(key);
  const agentKey = (store.agentKeys || []).find((item) => {
    if (!item || item.revokedAt) return false;
    const expected = Buffer.from(String(item.keyHash || ''), 'hex');
    const actual = Buffer.from(keyHash, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  });
  if (!agentKey) return null;

  const user = store.users.find((item) => item.id === agentKey.userId);
  if (!user || user.status === 'suspended') return null;

  if (touch) {
    agentKey.lastUsedAt = nowIso();
    await writeStore(store);
  }

  return { user, agentKey };
}

async function listAgentKeysForUser(userId) {
  const store = await readStore();
  return (store.agentKeys || [])
    .filter((key) => key.userId === userId)
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
    .map(publicAgentKey);
}

async function createAgentKeyForUser(userId, name) {
  const store = await readStore();
  const user = store.users.find((item) => item.id === userId);
  if (!user || user.status === 'suspended') throw new HttpError(404, '用户不存在或已停用');
  const rawKey = `xkm_agent_${crypto.randomBytes(32).toString('base64url')}`;
  const createdAt = nowIso();
  const key = {
    id: randomId('ak'),
    userId,
    name: String(name || '').trim().slice(0, 60) || 'Codex / OpenClaw',
    keyHash: hashAgentKey(rawKey),
    keyPrefix: `${rawKey.slice(0, 18)}...`,
    createdAt,
    lastUsedAt: null,
    revokedAt: null,
  };
  store.agentKeys = Array.isArray(store.agentKeys) ? store.agentKeys : [];
  store.agentKeys.push(key);
  await writeStore(store);
  return { key: publicAgentKey(key), agentKey: rawKey };
}

async function revokeAgentKeyForUser(userId, keyId) {
  const store = await readStore();
  const key = (store.agentKeys || []).find((item) => item.id === keyId && item.userId === userId);
  if (!key) throw new HttpError(404, 'Agent Key 不存在');
  if (!key.revokedAt) {
    key.revokedAt = nowIso();
    await writeStore(store);
  }
  return publicAgentKey(key);
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

async function attachAuthUser(req, _res, next) {
  try {
    const auth = await loadAuthFromRequest(req, { touch: true });
    if (auth) {
      req.authUser = publicUser(auth.user);
      req.authSession = auth.session;
      req.agentKey = auth.agentKey ? publicAgentKey(auth.agentKey) : undefined;
    }
    next();
  } catch (error) {
    next(error);
  }
}

function requireAuth(req, res, next) {
  if (!req.authUser) {
    res.status(401).json({ error: '请先登录' });
    return;
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.authUser) {
    res.status(401).json({ error: '请先登录' });
    return;
  }
  if (req.authUser.role !== 'admin') {
    res.status(403).json({ error: '需要管理员权限' });
    return;
  }
  next();
}

function createAuthRouter({ rateLimit } = {}) {
  const router = express.Router();
  if (rateLimit) router.use(rateLimit);
  router.use(express.json({ limit: '64kb' }));

  router.get('/me', asyncRoute(async (req, res) => {
    const auth = await loadAuthFromRequest(req, { touch: true });
    if (!auth) {
      // Session discovery is optional on public pages. Returning 200 keeps a
      // normal signed-out visit from appearing as a browser/network failure.
      res.json({ user: null });
      return;
    }
    res.json({ user: publicUser(auth.user) });
  }));

  router.post('/register', asyncRoute(async (req, res) => {
    if (process.env.AUTH_ALLOW_REGISTRATION === 'false') {
      throw new HttpError(403, '当前暂未开放注册');
    }

    const email = normalizeEmail(req.body?.email);
    const password = validatePassword(req.body?.password);
    const store = await readStore();
    cleanupExpiredSessions(store);

    if (store.users.some((user) => String(user.email).toLowerCase() === email)) {
      throw new HttpError(409, '该邮箱已注册，请直接登录');
    }

    const createdAt = nowIso();
    const isFirstUser = store.users.length === 0;
    const user = {
      id: randomId('usr'),
      email,
      displayName: normalizeDisplayName(req.body?.displayName, email),
      role: isFirstUser || ADMIN_EMAILS.has(email) ? 'admin' : 'user',
      status: 'active',
      password: hashPassword(password),
      createdAt,
      updatedAt: createdAt,
    };
    store.users.push(user);
    const token = await createSession(store, user, req);
    await writeStore(store);

    res.setHeader('Set-Cookie', sessionCookie(token, SESSION_TTL_MS / 1000));
    res.status(201).json({ user: publicUser(user) });
  }));

  router.post('/login', asyncRoute(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = validatePassword(req.body?.password);
    const store = await readStore();
    cleanupExpiredSessions(store);
    const user = store.users.find((item) => String(item.email).toLowerCase() === email);

    if (!user || !verifyPassword(password, user.password)) {
      throw new HttpError(401, '邮箱或密码不正确');
    }
    if (user.status === 'suspended') {
      throw new HttpError(403, '该账号已被停用');
    }

    const token = await createSession(store, user, req);
    await writeStore(store);
    res.setHeader('Set-Cookie', sessionCookie(token, SESSION_TTL_MS / 1000));
    res.json({ user: publicUser(user) });
  }));

  router.post('/logout', asyncRoute(async (req, res) => {
    const token = getSessionToken(req);
    if (token) {
      const store = await readStore();
      const tokenHash = hashSessionToken(token);
      store.sessions = store.sessions.filter((session) => session.tokenHash !== tokenHash);
      await writeStore(store);
    }
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ ok: true });
  }));

  router.get('/agent-keys', asyncRoute(async (req, res) => {
    const auth = await loadAuthFromRequest(req, { touch: true });
    if (!auth) throw new HttpError(401, '请先登录');
    res.json({ keys: await listAgentKeysForUser(auth.user.id) });
  }));

  router.post('/agent-keys', asyncRoute(async (req, res) => {
    const auth = await loadAuthFromRequest(req, { touch: true });
    if (!auth) throw new HttpError(401, '请先登录');
    const created = await createAgentKeyForUser(auth.user.id, req.body?.name);
    res.status(201).json(created);
  }));

  router.delete('/agent-keys/:keyId', asyncRoute(async (req, res) => {
    const auth = await loadAuthFromRequest(req, { touch: true });
    if (!auth) throw new HttpError(401, '请先登录');
    res.json({ key: await revokeAgentKeyForUser(auth.user.id, req.params.keyId) });
  }));

  router.get('/model-config', asyncRoute(async (req, res) => {
    const auth = await loadAuthFromRequest(req, { touch: true });
    if (!auth) throw new HttpError(401, '请先登录');
    res.json({ agentDefaults: await getPublicUserAgentDefaults(auth.user.id) });
  }));

  router.put('/model-config/llm', asyncRoute(async (req, res) => {
    const auth = await loadAuthFromRequest(req, { touch: true });
    if (!auth) throw new HttpError(401, '请先登录');
    res.json({ agentDefaults: await saveUserAgentDefaults(auth.user.id, 'llm', req.body || {}) });
  }));

  router.put('/model-config/image', asyncRoute(async (req, res) => {
    const auth = await loadAuthFromRequest(req, { touch: true });
    if (!auth) throw new HttpError(401, '请先登录');
    res.json({ agentDefaults: await saveUserAgentDefaults(auth.user.id, 'image', req.body || {}) });
  }));

  router.put('/model-config/video', asyncRoute(async (req, res) => {
    const auth = await loadAuthFromRequest(req, { touch: true });
    if (!auth) throw new HttpError(401, '请先登录');
    res.json({ agentDefaults: await saveUserAgentDefaults(auth.user.id, 'video', req.body || {}) });
  }));

  router.use((error, _req, res, _next) => {
    const status = Number(error?.status || 500);
    res.status(status).json({
      error: status >= 500 ? '账号服务暂时不可用' : String(error.message || error),
    });
  });

  return router;
}

function toAdminUser(user, projects) {
  const storageBytes = projects.reduce((sum, project) => sum + Number(project.sizeBytes || 0), 0);
  const latestProjectAt = projects[0]?.updatedAt ?? null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role === 'admin' ? 'admin' : 'user',
    status: user.status === 'suspended' ? 'suspended' : 'active',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    projectCount: projects.length,
    storageBytes,
    latestProjectAt,
  };
}

async function getAdminUsersWithProjects() {
  const store = await readStore();
  const users = [];
  for (const user of store.users) {
    const projects = await listCloudProjectsForUser(user.id);
    users.push(toAdminUser(user, projects));
  }
  return users.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

function createAdminRouter({ rateLimit, getBackgroundWorkerStatus, updateBackgroundWorkerConfig } = {}) {
  const router = express.Router();
  if (rateLimit) router.use(rateLimit);
  router.use(express.json({ limit: '64kb' }));

  router.get('/summary', asyncRoute(async (_req, res) => {
    const [users, jobs] = await Promise.all([
      getAdminUsersWithProjects(),
      getJobSummaryForAdmin().catch((error) => ({
        error: error instanceof Error ? error.message : String(error),
        total: 0,
        activeCount: 0,
        expiredLeaseCount: 0,
        statusCounts: {},
        typeCounts: {},
        recentJobs: [],
      })),
    ]);
    res.json({
      summary: {
        userCount: users.length,
        adminCount: users.filter((user) => user.role === 'admin').length,
        suspendedCount: users.filter((user) => user.status === 'suspended').length,
        projectCount: users.reduce((sum, user) => sum + user.projectCount, 0),
        storageBytes: users.reduce((sum, user) => sum + user.storageBytes, 0),
        jobs: {
          driver: getJobStoreDriver(),
          ...jobs,
        },
      },
    });
  }));

  router.get('/background-jobs', asyncRoute(async (req, res) => {
    const jobs = await listJobsForAdmin(req.query || {});
    res.json({ jobs });
  }));

  router.get('/background-worker-config', asyncRoute(async (_req, res) => {
    res.json({
      config: await getPublicBackgroundWorkerConfig(),
      worker: typeof getBackgroundWorkerStatus === 'function' ? getBackgroundWorkerStatus() : null,
    });
  }));

  router.put('/background-worker-config', asyncRoute(async (req, res) => {
    const config = await saveBackgroundWorkerConfig(req.body || {});
    const worker = typeof updateBackgroundWorkerConfig === 'function'
      ? updateBackgroundWorkerConfig(config)
      : (typeof getBackgroundWorkerStatus === 'function' ? getBackgroundWorkerStatus() : null);
    res.json({ config, worker });
  }));

  router.get('/users', asyncRoute(async (_req, res) => {
    res.json({ users: await getAdminUsersWithProjects() });
  }));

  router.get('/storage-config', asyncRoute(async (_req, res) => {
    res.json({
      config: await getPublicObjectStorageConfig(),
      effective: await getObjectStorageStatus(),
    });
  }));

  router.put('/storage-config', asyncRoute(async (req, res) => {
    const config = await saveObjectStorageConfig(req.body || {});
    resetObjectStorageClient();
    res.json({
      config,
      effective: await getObjectStorageStatus(),
    });
  }));

  router.post('/storage-config/test', asyncRoute(async (req, res) => {
    const result = await testObjectStorageConfig(req.body?.config);
    res.json({
      ok: true,
      result,
      effective: await getObjectStorageStatus(),
    });
  }));

  router.get('/users/:userId/projects', asyncRoute(async (req, res) => {
    const projects = await listCloudProjectsForUser(req.params.userId);
    res.json({ projects });
  }));

  router.patch('/users/:userId', asyncRoute(async (req, res) => {
    const store = await readStore();
    const user = store.users.find((item) => item.id === req.params.userId);
    if (!user) throw new HttpError(404, '用户不存在');

    const nextRole = req.body?.role;
    const nextStatus = req.body?.status;
    if (nextRole !== undefined) {
      if (nextRole !== 'admin' && nextRole !== 'user') throw new HttpError(400, '角色不合法');
      if (user.id === req.authUser.id && nextRole !== 'admin') throw new HttpError(400, '不能取消自己的管理员权限');
      user.role = nextRole;
    }
    if (nextStatus !== undefined) {
      if (nextStatus !== 'active' && nextStatus !== 'suspended') throw new HttpError(400, '状态不合法');
      if (user.id === req.authUser.id && nextStatus === 'suspended') throw new HttpError(400, '不能停用自己的账号');
      user.status = nextStatus;
      if (nextStatus === 'suspended') {
        store.sessions = store.sessions.filter((session) => session.userId !== user.id);
      }
    }
    user.updatedAt = nowIso();
    await writeStore(store);

    const projects = await listCloudProjectsForUser(user.id);
    res.json({ user: toAdminUser(user, projects) });
  }));

  router.delete('/users/:userId/projects/:projectId', asyncRoute(async (req, res) => {
    await deleteCloudProjectForUser(req.params.userId, req.params.projectId);
    res.json({ ok: true });
  }));

  router.use((error, _req, res, _next) => {
    const status = Number(error?.status || 500);
    res.status(status).json({
      error: status >= 500 ? '管理后台暂时不可用' : String(error.message || error),
    });
  });

  return router;
}

module.exports = {
  AUTH_COOKIE_NAME,
  attachAuthUser,
  createAdminRouter,
  createAuthRouter,
  requireAdmin,
  requireAuth,
};
