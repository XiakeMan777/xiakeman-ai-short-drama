const crypto = require('crypto');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  ensureCommercialSchema,
  isPostgresConfigured,
  query,
} = require('./postgres');

const SETTINGS_KEY = 'object_storage';
const BACKGROUND_WORKER_SETTINGS_KEY = 'background_worker';
const AGENT_DEFAULTS_SETTINGS_KEY = 'agent_defaults';
const USER_AGENT_DEFAULTS_SETTINGS_PREFIX = 'user_agent_defaults:';
const DEFAULT_BACKGROUND_WORKER_CONFIG = {
  concurrency: 256,
  typeConcurrency: {
    'step1-analysis': 32,
    'step3-assets': 32,
    'step4-storyboards': 24,
    'image-generations': 64,
    'llm-completions': 128,
    'step5-videos': 24,
    'step6-tts': 64,
    'step6-bgm': 32,
    'step6-render': 12,
  },
};
const SETTINGS_ROOT = process.env.APP_SETTINGS_DIR
  || path.join(process.env.CLOUD_STORAGE_DIR || path.join(os.tmpdir(), 'xiakeman-cloud-store'), 'settings');
const SETTINGS_FILE = path.join(SETTINGS_ROOT, 'app-settings.json');
const LOCAL_KEY_FILE = path.join(SETTINGS_ROOT, 'settings-encryption.key');

function isPostgresSettingsEnabled() {
  const driver = String(process.env.APP_SETTINGS_DRIVER || process.env.AUTH_STORE_DRIVER || '').toLowerCase();
  return (driver === 'postgres' || driver === 'pg') && isPostgresConfigured();
}

function nowIso() {
  return new Date().toISOString();
}

function maskSecret(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 8) return '*'.repeat(text.length);
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function secretLast4(value) {
  const text = String(value || '').trim();
  return text ? text.slice(-4) : '';
}

function userAgentDefaultsSettingsKey(userId) {
  const id = String(userId || '').trim();
  if (!id) throw new Error('userId is required for user Agent defaults');
  return `${USER_AGENT_DEFAULTS_SETTINGS_PREFIX}${id}`;
}

function normalizeDriver(value) {
  const driver = String(value || 'local').trim().toLowerCase();
  if (driver === 'tencent-cos' || driver === 'cos') return 'tencent-cos';
  if (driver === 'local') return 'local';
  throw new Error('Unsupported object storage driver');
}

function normalizePublicConfig(input = {}) {
  const driver = normalizeDriver(input.driver);
  return {
    driver,
    bucket: String(input.bucket || '').trim(),
    region: String(input.region || '').trim(),
    endpoint: String(input.endpoint || '').trim(),
    prefix: String(input.prefix || '').trim().replace(/^\/+|\/+$/g, ''),
    secretId: String(input.secretId || '').trim(),
  };
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function envBackgroundWorkerConfig() {
  const hasEnv = [
    'BACKGROUND_WORKER_CONCURRENCY',
    'BACKGROUND_WORKER_STEP1_CONCURRENCY',
    'BACKGROUND_WORKER_STEP3_CONCURRENCY',
    'BACKGROUND_WORKER_IMAGE_CONCURRENCY',
    'BACKGROUND_WORKER_LLM_CONCURRENCY',
    'BACKGROUND_WORKER_VIDEO_CONCURRENCY',
    'BACKGROUND_WORKER_TTS_CONCURRENCY',
    'BACKGROUND_WORKER_BGM_CONCURRENCY',
    'BACKGROUND_WORKER_RENDER_CONCURRENCY',
  ].some((key) => process.env[key] !== undefined);

  return normalizeBackgroundWorkerConfig({
    concurrency: process.env.BACKGROUND_WORKER_CONCURRENCY,
    typeConcurrency: {
      'step1-analysis': process.env.BACKGROUND_WORKER_STEP1_CONCURRENCY,
      'step3-assets': process.env.BACKGROUND_WORKER_STEP3_CONCURRENCY,
      'step4-storyboards': process.env.BACKGROUND_WORKER_STEP4_CONCURRENCY,
      'image-generations': process.env.BACKGROUND_WORKER_IMAGE_CONCURRENCY,
      'llm-completions': process.env.BACKGROUND_WORKER_LLM_CONCURRENCY,
      'step5-videos': process.env.BACKGROUND_WORKER_VIDEO_CONCURRENCY,
      'step6-tts': process.env.BACKGROUND_WORKER_TTS_CONCURRENCY,
      'step6-bgm': process.env.BACKGROUND_WORKER_BGM_CONCURRENCY,
      'step6-render': process.env.BACKGROUND_WORKER_RENDER_CONCURRENCY,
    },
  }, { source: hasEnv ? 'env' : 'default' });
}

function normalizeBackgroundWorkerConfig(input = {}, meta = {}) {
  const fallback = DEFAULT_BACKGROUND_WORKER_CONFIG;
  const inputTypes = input.typeConcurrency && typeof input.typeConcurrency === 'object'
    ? input.typeConcurrency
    : {};
  const typeConcurrency = {};
  for (const [type, defaultValue] of Object.entries(fallback.typeConcurrency)) {
    typeConcurrency[type] = clampInteger(inputTypes[type], defaultValue, 1, 512);
  }
  return {
    source: meta.source || input.source || 'admin',
    concurrency: clampInteger(input.concurrency, fallback.concurrency, 1, 1024),
    typeConcurrency,
    updatedAt: meta.updatedAt || input.updatedAt || null,
  };
}

async function readFileSettings() {
  try {
    const text = await fsp.readFile(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeFileSettings(settings) {
  await fsp.mkdir(SETTINGS_ROOT, { recursive: true });
  const tempPath = `${SETTINGS_FILE}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tempPath, JSON.stringify(settings), 'utf8');
  await fsp.rename(tempPath, SETTINGS_FILE);
}

async function readSetting(key) {
  if (isPostgresSettingsEnabled()) {
    await ensureCommercialSchema();
    const result = await query('SELECT value_json FROM xiakeman_app_settings WHERE key = $1', [key]);
    return result.rows[0]?.value_json || null;
  }

  const settings = await readFileSettings();
  return settings[key] || null;
}

async function writeSetting(key, value) {
  if (isPostgresSettingsEnabled()) {
    await ensureCommercialSchema();
    await query(`
      INSERT INTO xiakeman_app_settings (key, value_json, created_at, updated_at)
      VALUES ($1, $2::jsonb, now(), now())
      ON CONFLICT (key) DO UPDATE SET
        value_json = EXCLUDED.value_json,
        updated_at = now()
    `, [key, JSON.stringify(value)]);
    return;
  }

  const settings = await readFileSettings();
  settings[key] = value;
  await writeFileSettings(settings);
}

async function getEncryptionKey() {
  const explicit = process.env.APP_SETTINGS_SECRET
    || process.env.SETTINGS_ENCRYPTION_KEY
    || process.env.AUTH_SECRET;
  if (explicit && explicit.trim()) {
    return crypto.createHash('sha256').update(explicit.trim()).digest();
  }

  await fsp.mkdir(SETTINGS_ROOT, { recursive: true });
  try {
    const raw = await fsp.readFile(LOCAL_KEY_FILE, 'utf8');
    return Buffer.from(raw.trim(), 'base64');
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }

  const key = crypto.randomBytes(32);
  await fsp.writeFile(LOCAL_KEY_FILE, key.toString('base64'), { mode: 0o600 });
  return key;
}

async function encryptSecret(plainText) {
  const text = String(plainText || '');
  if (!text) return null;
  const key = await getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

async function decryptSecret(encrypted) {
  const text = String(encrypted || '');
  if (!text) return '';
  const [version, ivText, tagText, payloadText] = text.split(':');
  if (version !== 'v1' || !ivText || !tagText || !payloadText) return '';
  const key = await getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(payloadText, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function envObjectStorageConfig() {
  const driver = normalizeDriver(process.env.OBJECT_STORAGE_DRIVER || process.env.MEDIA_STORAGE_DRIVER || 'local');
  if (driver !== 'tencent-cos') {
    return { driver: 'local', source: 'env' };
  }

  return {
    driver,
    source: 'env',
    bucket: process.env.TENCENT_COS_BUCKET || process.env.COS_BUCKET || '',
    region: process.env.TENCENT_COS_REGION || process.env.COS_REGION || '',
    endpoint: process.env.TENCENT_COS_ENDPOINT || process.env.COS_ENDPOINT || '',
    prefix: String(process.env.TENCENT_COS_PREFIX || process.env.COS_PREFIX || '').replace(/^\/+|\/+$/g, ''),
    secretId: process.env.TENCENT_COS_SECRET_ID || process.env.COS_SECRET_ID || '',
    secretKey: process.env.TENCENT_COS_SECRET_KEY || process.env.COS_SECRET_KEY || '',
  };
}

async function getSavedObjectStorageConfig() {
  const saved = await readSetting(SETTINGS_KEY);
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
  const publicConfig = normalizePublicConfig(saved);
  const secretKey = await decryptSecret(saved.secretKeyEncrypted);
  return {
    ...publicConfig,
    source: 'admin',
    secretKey,
    secretKeySet: !!secretKey,
    secretKeyLast4: saved.secretKeyLast4 || '',
    updatedAt: saved.updatedAt || null,
  };
}

async function getEffectiveObjectStorageConfig(override) {
  const saved = await getSavedObjectStorageConfig();
  const envConfig = envObjectStorageConfig();

  if (override && typeof override === 'object') {
    const fallback = saved || envConfig;
    const publicConfig = normalizePublicConfig({ ...fallback, ...override });
    publicConfig.secretId = publicConfig.secretId || fallback.secretId || '';
    return {
      ...publicConfig,
      source: 'override',
      secretKey: String(override.secretKey || '').trim() || fallback.secretKey || '',
    };
  }

  if (saved) return saved;
  return envConfig;
}

async function getPublicObjectStorageConfig() {
  const saved = await getSavedObjectStorageConfig();
  const effective = saved || envObjectStorageConfig();
  return {
    source: effective.source,
    driver: effective.driver,
    bucket: effective.bucket || '',
    region: effective.region || '',
    endpoint: effective.endpoint || '',
    prefix: effective.prefix || '',
    secretIdMasked: maskSecret(effective.secretId),
    secretKeySet: !!effective.secretKey,
    secretKeyLast4: effective.secretKeyLast4 || String(effective.secretKey || '').slice(-4),
    updatedAt: effective.updatedAt || null,
  };
}

async function saveObjectStorageConfig(input = {}) {
  const existing = await getSavedObjectStorageConfig();
  const fallback = existing || envObjectStorageConfig();
  const publicConfig = normalizePublicConfig(input);
  publicConfig.bucket = publicConfig.bucket || fallback?.bucket || '';
  publicConfig.region = publicConfig.region || fallback?.region || '';
  publicConfig.endpoint = publicConfig.endpoint || fallback?.endpoint || '';
  publicConfig.prefix = publicConfig.prefix || fallback?.prefix || '';
  publicConfig.secretId = publicConfig.secretId || fallback?.secretId || '';
  const secretKeyInput = String(input.secretKey || '').trim();
  const secretKey = secretKeyInput || fallback?.secretKey || '';
  if (publicConfig.secretId.length > 160) throw new Error('COS SecretId is too long');
  if (secretKey.length > 256) throw new Error('COS SecretKey is too long');

  if (publicConfig.driver === 'tencent-cos') {
    if (!publicConfig.bucket) throw new Error('COS bucket is required');
    if (!publicConfig.region) throw new Error('COS region is required');
    if (!publicConfig.secretId) throw new Error('COS SecretId is required');
    if (!secretKey) throw new Error('COS SecretKey is required');
  }

  const value = {
    ...publicConfig,
    secretKeyEncrypted: secretKey ? await encryptSecret(secretKey) : null,
    secretKeyLast4: secretKey ? secretKey.slice(-4) : '',
    updatedAt: nowIso(),
  };
  await writeSetting(SETTINGS_KEY, value);
  return await getPublicObjectStorageConfig();
}

async function getSavedBackgroundWorkerConfig() {
  const saved = await readSetting(BACKGROUND_WORKER_SETTINGS_KEY);
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
  return normalizeBackgroundWorkerConfig(saved, {
    source: 'admin',
    updatedAt: saved.updatedAt || null,
  });
}

async function getEffectiveBackgroundWorkerConfig() {
  const saved = await getSavedBackgroundWorkerConfig();
  if (saved) return saved;
  return envBackgroundWorkerConfig();
}

async function getPublicBackgroundWorkerConfig() {
  return await getEffectiveBackgroundWorkerConfig();
}

async function saveBackgroundWorkerConfig(input = {}) {
  const value = normalizeBackgroundWorkerConfig(input, {
    source: 'admin',
    updatedAt: nowIso(),
  });
  await writeSetting(BACKGROUND_WORKER_SETTINGS_KEY, value);
  return await getPublicBackgroundWorkerConfig();
}

function normalizeAgentLlmConfig(input = {}) {
  return {
    baseUrl: String(input.baseUrl || 'https://api.openai.com/v1').trim(),
    model: String(input.model || '').trim(),
    apiKey: String(input.apiKey || '').trim(),
  };
}

function normalizeAgentImageConfig(input = {}) {
  return {
    baseUrl: String(input.baseUrl || 'https://api.openai.com/v1').trim(),
    model: String(input.model || '').trim(),
    apiKey: String(input.apiKey || '').trim(),
    defaultImageSize: String(input.defaultImageSize || '1K').trim(),
  };
}

const DEFAULT_SEEDANCE_CLOUD_API_BASE = String(
  process.env.SEEDANCE_CLOUD_API_BASE || 'http://127.0.0.1:8034/api',
).trim().replace(/\/+$/, '');
const SEEDANCE_CLOUD_BASE_ALIASES = new Map([
  ['/api/seedance-cloud', DEFAULT_SEEDANCE_CLOUD_API_BASE],
  ['http://127.0.0.1:8034', DEFAULT_SEEDANCE_CLOUD_API_BASE],
  ['http://127.0.0.1:8034/api', DEFAULT_SEEDANCE_CLOUD_API_BASE],
  ['http://localhost:8034', DEFAULT_SEEDANCE_CLOUD_API_BASE],
  ['http://localhost:8034/api', DEFAULT_SEEDANCE_CLOUD_API_BASE],
]);

function normalizeSeedanceCloudApiBase(value) {
  const raw = String(value || DEFAULT_SEEDANCE_CLOUD_API_BASE).trim().replace(/\/+$/, '');
  return SEEDANCE_CLOUD_BASE_ALIASES.get(raw) || raw;
}

function normalizeAgentVideoConfig(input = {}) {
  const backend = ['seedancecloud', 'xyqagent', 'seedance', 'hmapi', 'volcengine', 'aliyunbailian']
    .includes(String(input.backend || '').trim())
    ? String(input.backend).trim()
    : 'seedancecloud';
  return {
    backend,
    videoRatio: String(input.videoRatio || '16:9').trim(),
    videoResolution: String(input.videoResolution || '720p').trim(),
    videoDuration: Math.min(15, Math.max(4, Math.round(Number(input.videoDuration) || 15))),
    seedanceModel: String(input.seedanceModel || 'fast').trim(),
    seedanceCloudBaseUrl: normalizeSeedanceCloudApiBase(input.seedanceCloudBaseUrl),
    seedanceCloudLicenseKey: String(input.seedanceCloudLicenseKey || '').trim(),
    xyqAgentBaseUrl: String(input.xyqAgentBaseUrl || 'https://xyq.jianying.com').trim(),
    xyqAgentAccessKey: String(input.xyqAgentAccessKey || '').trim(),
    hmapiApiKey: String(input.hmapiApiKey || '').trim(),
    hmapiModel: String(input.hmapiModel || 'jimeng-video-seedance-2.0-fast').trim(),
    volcBaseUrl: String(input.volcBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3').trim().replace(/\/+$/, ''),
    volcApiKey: String(input.volcApiKey || '').trim(),
    volcModel: String(input.volcModel || 'doubao-seedance-2-0-260128-fast').trim(),
    aliyunApiKey: String(input.aliyunApiKey || '').trim(),
    aliyunModel: String(input.aliyunModel || 'happyhorse-1.0-r2v').trim(),
    aliyunRegion: String(input.aliyunRegion || 'cn-beijing').trim(),
    useBackendVideoJobs: input.useBackendVideoJobs === true ? true : false,
  };
}

function publicAgentDefaults(effective = {}) {
  const llm = effective.llm || normalizeAgentLlmConfig();
  const image = effective.image || normalizeAgentImageConfig();
  const video = effective.video || normalizeAgentVideoConfig();
  return {
    llm: {
      baseUrl: llm.baseUrl || '',
      model: llm.model || '',
      apiKeySet: !!llm.apiKey,
      apiKeyLast4: secretLast4(llm.apiKey),
    },
    image: {
      baseUrl: image.baseUrl || '',
      model: image.model || '',
      defaultImageSize: image.defaultImageSize || '1K',
      apiKeySet: !!image.apiKey,
      apiKeyLast4: secretLast4(image.apiKey),
    },
    video: {
      backend: video.backend || 'seedancecloud',
      videoRatio: video.videoRatio || '16:9',
      videoResolution: video.videoResolution || '720p',
      videoDuration: video.videoDuration || 15,
      seedanceModel: video.seedanceModel || 'fast',
      seedanceCloudBaseUrl: video.seedanceCloudBaseUrl || '',
      seedanceCloudLicenseKeySet: !!video.seedanceCloudLicenseKey,
      seedanceCloudLicenseKeyLast4: secretLast4(video.seedanceCloudLicenseKey),
      xyqAgentBaseUrl: video.xyqAgentBaseUrl || '',
      xyqAgentAccessKeySet: !!video.xyqAgentAccessKey,
      xyqAgentAccessKeyLast4: secretLast4(video.xyqAgentAccessKey),
      hmapiModel: video.hmapiModel || '',
      hmapiApiKeySet: !!video.hmapiApiKey,
      hmapiApiKeyLast4: secretLast4(video.hmapiApiKey),
      volcBaseUrl: video.volcBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
      volcModel: video.volcModel || '',
      volcApiKeySet: !!video.volcApiKey,
      volcApiKeyLast4: secretLast4(video.volcApiKey),
      aliyunModel: video.aliyunModel || '',
      aliyunRegion: video.aliyunRegion || '',
      aliyunApiKeySet: !!video.aliyunApiKey,
      aliyunApiKeyLast4: secretLast4(video.aliyunApiKey),
      useBackendVideoJobs: video.useBackendVideoJobs === true ? true : false,
    },
    updatedAt: effective.updatedAt || null,
  };
}

async function decryptAgentDefaults(saved) {
  const llm = normalizeAgentLlmConfig(saved?.llm || {});
  const image = normalizeAgentImageConfig(saved?.image || {});
  const video = normalizeAgentVideoConfig(saved?.video || {});
  const configuredSections = Array.isArray(saved?.configuredSections)
    ? saved.configuredSections.filter((item) => ['llm', 'image', 'video'].includes(item))
    : null;
  return {
    llm: {
      ...llm,
      apiKey: await decryptSecret(saved?.llm?.apiKeyEncrypted) || llm.apiKey || '',
    },
    image: {
      ...image,
      apiKey: await decryptSecret(saved?.image?.apiKeyEncrypted) || image.apiKey || '',
    },
    video: {
      ...video,
      seedanceCloudLicenseKey: await decryptSecret(saved?.video?.seedanceCloudLicenseKeyEncrypted) || video.seedanceCloudLicenseKey || '',
      xyqAgentAccessKey: await decryptSecret(saved?.video?.xyqAgentAccessKeyEncrypted) || video.xyqAgentAccessKey || '',
      hmapiApiKey: await decryptSecret(saved?.video?.hmapiApiKeyEncrypted) || video.hmapiApiKey || '',
      volcApiKey: await decryptSecret(saved?.video?.volcApiKeyEncrypted) || video.volcApiKey || '',
      aliyunApiKey: await decryptSecret(saved?.video?.aliyunApiKeyEncrypted) || video.aliyunApiKey || '',
    },
    updatedAt: saved?.updatedAt || null,
    configuredSections,
  };
}

async function getEffectiveAgentDefaults() {
  const saved = await readSetting(AGENT_DEFAULTS_SETTINGS_KEY);
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    return decryptAgentDefaults(saved);
  }
  return {
    llm: normalizeAgentLlmConfig(),
    image: normalizeAgentImageConfig(),
    video: normalizeAgentVideoConfig(),
    updatedAt: null,
  };
}

async function getPublicAgentDefaults() {
  return publicAgentDefaults(await getEffectiveAgentDefaults());
}

async function getSavedUserAgentDefaults(userId) {
  const saved = await readSetting(userAgentDefaultsSettingsKey(userId));
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    return decryptAgentDefaults(saved);
  }
  return null;
}

async function getEffectiveAgentDefaultsForUser(userId) {
  const adminDefaults = await getEffectiveAgentDefaults();
  const userDefaults = await getSavedUserAgentDefaults(userId);
  if (!userDefaults) return adminDefaults;
  const configuredSections = Array.isArray(userDefaults.configuredSections)
    ? new Set(userDefaults.configuredSections)
    : new Set(['llm', 'image', 'video']);
  const useUserLlm = configuredSections.has('llm');
  const useUserImage = configuredSections.has('image');
  const useUserVideo = configuredSections.has('video');
  return {
    llm: useUserLlm ? {
      ...adminDefaults.llm,
      ...userDefaults.llm,
      apiKey: userDefaults.llm?.apiKey || adminDefaults.llm?.apiKey || '',
    } : adminDefaults.llm,
    image: useUserImage ? {
      ...adminDefaults.image,
      ...userDefaults.image,
      apiKey: userDefaults.image?.apiKey || adminDefaults.image?.apiKey || '',
    } : adminDefaults.image,
    video: useUserVideo ? {
      ...adminDefaults.video,
      ...userDefaults.video,
      seedanceCloudLicenseKey: userDefaults.video?.seedanceCloudLicenseKey || adminDefaults.video?.seedanceCloudLicenseKey || '',
      xyqAgentAccessKey: userDefaults.video?.xyqAgentAccessKey || adminDefaults.video?.xyqAgentAccessKey || '',
      hmapiApiKey: userDefaults.video?.hmapiApiKey || adminDefaults.video?.hmapiApiKey || '',
      volcApiKey: userDefaults.video?.volcApiKey || adminDefaults.video?.volcApiKey || '',
      aliyunApiKey: userDefaults.video?.aliyunApiKey || adminDefaults.video?.aliyunApiKey || '',
    } : adminDefaults.video,
    updatedAt: userDefaults.updatedAt || adminDefaults.updatedAt || null,
  };
}

async function getPublicUserAgentDefaults(userId) {
  const [adminDefaults, userDefaults] = await Promise.all([
    getEffectiveAgentDefaults(),
    getSavedUserAgentDefaults(userId),
  ]);
  const effective = userDefaults ? await getEffectiveAgentDefaultsForUser(userId) : adminDefaults;
  return {
    effective: publicAgentDefaults(effective),
    user: userDefaults ? publicAgentDefaults(userDefaults) : null,
    fallback: publicAgentDefaults(adminDefaults),
    source: userDefaults ? 'user' : 'admin',
    configuredSections: userDefaults?.configuredSections || [],
  };
}

async function saveAgentDefaults(section, input = {}) {
  const existing = await getEffectiveAgentDefaults();
  const next = {
    llm: existing.llm,
    image: existing.image,
    video: existing.video,
    updatedAt: nowIso(),
  };
  if (section === 'llm') next.llm = normalizeAgentLlmConfig({ ...existing.llm, ...input });
  else if (section === 'image') next.image = normalizeAgentImageConfig({ ...existing.image, ...input });
  else if (section === 'video') next.video = normalizeAgentVideoConfig({ ...existing.video, ...input });
  else throw new Error('Unsupported agent default section');

  const value = {
    llm: {
      baseUrl: next.llm.baseUrl,
      model: next.llm.model,
      apiKeyEncrypted: next.llm.apiKey ? await encryptSecret(next.llm.apiKey) : null,
      apiKeyLast4: secretLast4(next.llm.apiKey),
    },
    image: {
      baseUrl: next.image.baseUrl,
      model: next.image.model,
      defaultImageSize: next.image.defaultImageSize,
      apiKeyEncrypted: next.image.apiKey ? await encryptSecret(next.image.apiKey) : null,
      apiKeyLast4: secretLast4(next.image.apiKey),
    },
    video: {
      backend: next.video.backend,
      videoRatio: next.video.videoRatio,
      videoResolution: next.video.videoResolution,
      videoDuration: next.video.videoDuration,
      seedanceModel: next.video.seedanceModel,
      seedanceCloudBaseUrl: next.video.seedanceCloudBaseUrl,
      seedanceCloudLicenseKeyEncrypted: next.video.seedanceCloudLicenseKey ? await encryptSecret(next.video.seedanceCloudLicenseKey) : null,
      seedanceCloudLicenseKeyLast4: secretLast4(next.video.seedanceCloudLicenseKey),
      xyqAgentBaseUrl: next.video.xyqAgentBaseUrl,
      xyqAgentAccessKeyEncrypted: next.video.xyqAgentAccessKey ? await encryptSecret(next.video.xyqAgentAccessKey) : null,
      xyqAgentAccessKeyLast4: secretLast4(next.video.xyqAgentAccessKey),
      hmapiModel: next.video.hmapiModel,
      hmapiApiKeyEncrypted: next.video.hmapiApiKey ? await encryptSecret(next.video.hmapiApiKey) : null,
      hmapiApiKeyLast4: secretLast4(next.video.hmapiApiKey),
      volcBaseUrl: next.video.volcBaseUrl,
      volcModel: next.video.volcModel,
      volcApiKeyEncrypted: next.video.volcApiKey ? await encryptSecret(next.video.volcApiKey) : null,
      volcApiKeyLast4: secretLast4(next.video.volcApiKey),
      aliyunModel: next.video.aliyunModel,
      aliyunRegion: next.video.aliyunRegion,
      aliyunApiKeyEncrypted: next.video.aliyunApiKey ? await encryptSecret(next.video.aliyunApiKey) : null,
      aliyunApiKeyLast4: secretLast4(next.video.aliyunApiKey),
      useBackendVideoJobs: next.video.useBackendVideoJobs === true ? true : false,
    },
    updatedAt: next.updatedAt,
  };
  await writeSetting(AGENT_DEFAULTS_SETTINGS_KEY, value);
  return publicAgentDefaults(next);
}

async function saveUserAgentDefaults(userId, section, input = {}) {
  const existing = await getSavedUserAgentDefaults(userId) || {
    llm: normalizeAgentLlmConfig(),
    image: normalizeAgentImageConfig(),
    video: normalizeAgentVideoConfig(),
    updatedAt: null,
  };
  const next = {
    llm: existing.llm,
    image: existing.image,
    video: existing.video,
    updatedAt: nowIso(),
  };
  if (section === 'llm') next.llm = normalizeAgentLlmConfig({ ...existing.llm, ...input });
  else if (section === 'image') next.image = normalizeAgentImageConfig({ ...existing.image, ...input });
  else if (section === 'video') next.video = normalizeAgentVideoConfig({ ...existing.video, ...input });
  else throw new Error('Unsupported user Agent default section');
  const configuredSections = Array.isArray(existing.configuredSections)
    ? [...new Set([...existing.configuredSections, section])]
    : [section];

  const value = {
    configuredSections,
    llm: {
      baseUrl: next.llm.baseUrl,
      model: next.llm.model,
      apiKeyEncrypted: next.llm.apiKey ? await encryptSecret(next.llm.apiKey) : null,
      apiKeyLast4: secretLast4(next.llm.apiKey),
    },
    image: {
      baseUrl: next.image.baseUrl,
      model: next.image.model,
      defaultImageSize: next.image.defaultImageSize,
      apiKeyEncrypted: next.image.apiKey ? await encryptSecret(next.image.apiKey) : null,
      apiKeyLast4: secretLast4(next.image.apiKey),
    },
    video: {
      backend: next.video.backend,
      videoRatio: next.video.videoRatio,
      videoResolution: next.video.videoResolution,
      videoDuration: next.video.videoDuration,
      seedanceModel: next.video.seedanceModel,
      seedanceCloudBaseUrl: next.video.seedanceCloudBaseUrl,
      seedanceCloudLicenseKeyEncrypted: next.video.seedanceCloudLicenseKey ? await encryptSecret(next.video.seedanceCloudLicenseKey) : null,
      seedanceCloudLicenseKeyLast4: secretLast4(next.video.seedanceCloudLicenseKey),
      xyqAgentBaseUrl: next.video.xyqAgentBaseUrl,
      xyqAgentAccessKeyEncrypted: next.video.xyqAgentAccessKey ? await encryptSecret(next.video.xyqAgentAccessKey) : null,
      xyqAgentAccessKeyLast4: secretLast4(next.video.xyqAgentAccessKey),
      hmapiModel: next.video.hmapiModel,
      hmapiApiKeyEncrypted: next.video.hmapiApiKey ? await encryptSecret(next.video.hmapiApiKey) : null,
      hmapiApiKeyLast4: secretLast4(next.video.hmapiApiKey),
      volcBaseUrl: next.video.volcBaseUrl,
      volcModel: next.video.volcModel,
      volcApiKeyEncrypted: next.video.volcApiKey ? await encryptSecret(next.video.volcApiKey) : null,
      volcApiKeyLast4: secretLast4(next.video.volcApiKey),
      aliyunModel: next.video.aliyunModel,
      aliyunRegion: next.video.aliyunRegion,
      aliyunApiKeyEncrypted: next.video.aliyunApiKey ? await encryptSecret(next.video.aliyunApiKey) : null,
      aliyunApiKeyLast4: secretLast4(next.video.aliyunApiKey),
      useBackendVideoJobs: next.video.useBackendVideoJobs === true ? true : false,
    },
    updatedAt: next.updatedAt,
  };
  await writeSetting(userAgentDefaultsSettingsKey(userId), value);
  return getPublicUserAgentDefaults(userId);
}

module.exports = {
  getEffectiveObjectStorageConfig,
  getEffectiveAgentDefaults,
  getEffectiveAgentDefaultsForUser,
  getEffectiveBackgroundWorkerConfig,
  getPublicAgentDefaults,
  getPublicUserAgentDefaults,
  getPublicBackgroundWorkerConfig,
  getPublicObjectStorageConfig,
  saveAgentDefaults,
  saveUserAgentDefaults,
  saveBackgroundWorkerConfig,
  saveObjectStorageConfig,
};
