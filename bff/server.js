// ============================================================
// 虾客漫 BFF 服务 - 提示词模板保护代理
// 提示词模板仅存在于本服务中，前端无法获取完整模板
// ============================================================

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const { spawn } = require('child_process');
const {
  buildStep1RepairPrompt,
  extractContentFromChatResponse,
  normalizeStep1AnalysisContent,
  replaceContentInChatResponse,
} = require('./structured-output');
const {
  buildSeriesJsonRepairPrompt,
  isSeriesJsonTemplateType,
  normalizeSeriesJsonContent,
} = require('./series-json-output');
const { createRenderRouter } = require('./render-jobs');
const { createXyqAgentRouter } = require('./xyq-agent');
const { createCloudStoreRouter } = require('./cloud-store');
const { createBackgroundJobRouter } = require('./background-jobs');
const { createAgentRouter } = require('./agent-api');
const { createBackgroundWorker } = require('./background-worker');
const { cancelStep5VideoJob, createVideoJobHandlers } = require('./video-job-handlers');
const { createRenderJobHandlers } = require('./render-job-handlers');
const { createLlmJobHandlers } = require('./llm-job-handlers');
const { createImageJobHandlers } = require('./image-job-handlers');
const { createStep1JobHandlers } = require('./step1-job-handlers');
const { createStep3JobHandlers } = require('./step3-job-handlers');
const { createStep4JobHandlers } = require('./step4-job-handlers');
const { createTtsJobHandlers } = require('./tts-job-handlers');
const { createBgmJobHandlers } = require('./bgm-job-handlers');
const {
  createSignedGetUrl,
  createSignedPutUrl,
  getDirectObjectStorageStatus,
} = require('./object-storage');
const { attachAuthUser, createAdminRouter, createAuthRouter, requireAdmin, requireAuth } = require('./auth-store');
const { getEffectiveBackgroundWorkerConfig } = require('./commercial-settings');
const { isHostnameAllowed, isPrivateHostname } = require('./url-policy');

const app = express();
const PORT = process.env.BFF_PORT || 8030;
const DEFAULT_CHAT_COMPLETION_TIMEOUT_MS = 300_000;
const SERIES_JSON_REPAIR_TIMEOUT_MS = 900_000;
const STREAM_IDLE_TIMEOUT_MS = 300_000;
const IMAGE_PROXY_FETCH_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_BACKGROUND_WORKER_CONCURRENCY = 256;
const CLIENT_ABORT_MESSAGE = 'Client disconnected before upstream completed';
const ALLOWED_REASONING_EFFORTS = new Set(['low', 'medium', 'high']);

const ALLOWED_TEMPLATE_TYPES = new Set([
  'step1',
  'analysis_autofill',
  'analysis_autofill_patch',
  'novel_adapt',
  'script_format_adapt',
  'script_type_classifier',
  'novel_adapt_rhythm_repair',
  'series_premise_polish',
  'series_concept_analyze',
  'series_concept_alignment_check',
  'series_step0_quality_check',
  'series_step0_quality_repair',
  'series_bible_generate',
  'series_episode_cards_generate',
  'series_episode_script_generate',
  'series_episode_script_repair',
  'series_episode_settle',
  'preprocess',
  'check',
  'correct',
  'choreograph',
  'choreo_check',
  'generate',
  'generate_official_virtual_human',
  'video_prompt_compact',
  'video_prompt_desensitize',
  'seedance_final_video_prompt',
  'dubbing_analysis',
  'storyboard_director_brief',
  'storyboard_action_director',
  'storyboard_board_plan',
  'storyboard_board_plan_nine',
  'storyboard_board_plan_shot15',
  'storyboard_board_plan_smart',
]);

const ALLOWED_VIDEO_DOMAINS = [
  'ark-acg-cn-beijing.oss-cn-beijing.aliyuncs.com',
  'dashscope-result.oss-cn-beijing.aliyuncs.com',
  'volces.com',
  'bj.bcebos.com',
  '365yg.com',
  'sd2.xiakeman.com',
];

const ALLOWED_IMAGE_DOMAINS = [
  'volces.com',
  'volcengine.com',
  'bytepluses.com',
  'apimart.ai',
  'blob.core.windows.net',
];

const LLM_BASE_URL_ALLOWLIST = (process.env.LLM_BASE_URL_ALLOWLIST || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const REWRITE_LOCALHOST_FOR_DOCKER = process.env.REWRITE_LOCALHOST_FOR_DOCKER !== 'false';
const DOCKER_HOST_GATEWAY = process.env.DOCKER_HOST_GATEWAY || 'host.docker.internal';
let runningInContainerCache;

function isRunningInContainer() {
  if (runningInContainerCache !== undefined) return runningInContainerCache;

  runningInContainerCache = false;
  try {
    if (fs.existsSync('/.dockerenv')) {
      runningInContainerCache = true;
      return runningInContainerCache;
    }
  } catch {
    // ignore platform-specific filesystem errors
  }

  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    runningInContainerCache = /docker|kubepods|containerd/i.test(cgroup);
  } catch {
    runningInContainerCache = false;
  }

  return runningInContainerCache;
}

function isLocalLoopbackHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '0.0.0.0'
    || normalized === '::1'
    || normalized === '[::1]';
}

function rewriteLocalhostBaseUrlForContainer(parsed) {
  if (!REWRITE_LOCALHOST_FOR_DOCKER || !isRunningInContainer()) return parsed;
  if (!isLocalLoopbackHostname(parsed.hostname)) return parsed;

  const rewritten = new URL(parsed.toString());
  rewritten.hostname = DOCKER_HOST_GATEWAY;
  return rewritten;
}

function isAllowedLlmBaseUrl(parsed) {
  if (LLM_BASE_URL_ALLOWLIST.length === 0) {
    return !(IS_PRODUCTION && isPrivateHostname(parsed.hostname));
  }

  return LLM_BASE_URL_ALLOWLIST.some((allowed) => {
    try {
      const allowedUrl = new URL(allowed);
      return parsed.origin === allowedUrl.origin
        && parsed.pathname.replace(/\/$/, '').startsWith(allowedUrl.pathname.replace(/\/$/, ''));
    } catch {
      return parsed.hostname === allowed || parsed.hostname.endsWith(`.${allowed}`);
    }
  });
}

function normalizeLlmBaseUrl(baseUrl) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    throw new Error('apiConfig.baseUrl must be a non-empty string');
  }

  const parsed = new URL(baseUrl.trim());
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('apiConfig.baseUrl must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('apiConfig.baseUrl must not include credentials');
  }
  const normalizedParsed = rewriteLocalhostBaseUrlForContainer(parsed);
  if (!isAllowedLlmBaseUrl(normalizedParsed)) {
    throw new Error('apiConfig.baseUrl is not allowed by BFF policy');
  }

  return normalizedParsed.toString().replace(/\/$/, '');
}

function clampNumber(value, fallback, min, max) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function validateChatRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request body must be a JSON object');
  }

  const { templateType, templateVars = {}, userMessages, apiConfig, options = {} } = body;
  if (typeof templateType !== 'string' || !ALLOWED_TEMPLATE_TYPES.has(templateType)) {
    throw new Error('Invalid templateType');
  }
  if (!templateVars || typeof templateVars !== 'object' || Array.isArray(templateVars)) {
    throw new Error('templateVars must be an object');
  }
  if (!Array.isArray(userMessages) || userMessages.length === 0 || userMessages.length > 20) {
    throw new Error('userMessages must be a non-empty array with at most 20 items');
  }

  const normalizedMessages = userMessages.map((message, index) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new Error(`userMessages[${index}] must be an object`);
    }
    if (!['user', 'assistant'].includes(message.role)) {
      throw new Error(`userMessages[${index}].role must be user or assistant`);
    }
    if (typeof message.content !== 'string' || message.content.length > 1_500_000) {
      throw new Error(`userMessages[${index}].content must be a string under 1.5MB`);
    }
    return { role: message.role, content: message.content };
  });

  if (!apiConfig || typeof apiConfig !== 'object' || Array.isArray(apiConfig)) {
    throw new Error('apiConfig must be an object');
  }
  if (typeof apiConfig.apiKey !== 'string' || !apiConfig.apiKey.trim()) {
    throw new Error('apiConfig.apiKey must be a non-empty string');
  }
  if (typeof apiConfig.model !== 'string' || !apiConfig.model.trim()) {
    throw new Error('apiConfig.model must be a non-empty string');
  }

  const reasoningEffort = typeof options.reasoningEffort === 'string'
    ? options.reasoningEffort
    : undefined;
  if (reasoningEffort && !ALLOWED_REASONING_EFFORTS.has(reasoningEffort)) {
    throw new Error('options.reasoningEffort must be low, medium, or high');
  }

  return {
    templateType,
    templateVars,
    userMessages: normalizedMessages,
    apiConfig: {
      baseUrl: normalizeLlmBaseUrl(apiConfig.baseUrl),
      apiKey: apiConfig.apiKey.trim(),
      model: apiConfig.model.trim(),
    },
    options: {
      temperature: clampNumber(options.temperature, 0.7, 0, 2),
      maxTokens: Math.round(clampNumber(options.maxTokens, 8000, 1, 50000)),
      reasoningEffort,
      stream: options.stream === true,
    },
  };
}

function isVideoUrlAllowed(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return isHostnameAllowed(parsed.hostname, ALLOWED_VIDEO_DOMAINS);
  } catch {
    return false;
  }
}

function isImageUrlAllowed(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (isPrivateHostname(parsed.hostname)) return false;
    return isHostnameAllowed(parsed.hostname, ALLOWED_IMAGE_DOMAINS);
  } catch {
    return false;
  }
}

const requestCounts = new Map();
const cloudRequestCounts = new Map();
const imageProxyRequestCounts = new Map();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = Number(process.env.BFF_RATE_LIMIT_MAX || 30);
const CLOUD_RATE_LIMIT_MAX = Number(process.env.BFF_CLOUD_RATE_LIMIT_MAX || 1200);
const BACKGROUND_JOB_RATE_LIMIT_MAX = Number(process.env.BFF_BACKGROUND_JOB_RATE_LIMIT_MAX || 600);
const IMAGE_PROXY_RATE_LIMIT_MAX = Number(process.env.BFF_IMAGE_PROXY_RATE_LIMIT_MAX || 180);
const SEEDANCE_DIRECT_UPLOAD_MAX_FILES = 24;
const SEEDANCE_DIRECT_UPLOAD_MAX_TOTAL_BYTES = 360 * 1024 * 1024;
const SEEDANCE_DIRECT_UPLOAD_TTL_SECONDS = 900;
const SEEDANCE_DIRECT_DOWNLOAD_TTL_SECONDS = 604800;
const SEEDANCE_DIRECT_UPLOAD_ROLES = new Set(['image', 'video', 'audio', 'reference_video']);
const SEEDANCE_CLOUD_LICENSE_VALIDATE_URL = process.env.SEEDANCE_CLOUD_LICENSE_VALIDATE_URL
  || 'http://127.0.0.1:8034/api/balance';
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 },
});

function applyRateLimit(store, maxRequests, req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const record = store.get(ip) || { count: 0, windowStart: now };
  if (now - record.windowStart > RATE_LIMIT_WINDOW) {
    record.count = 0;
    record.windowStart = now;
  }
  record.count++;
  store.set(ip, record);
  if (record.count > maxRequests) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  next();
}

function rateLimit(req, res, next) {
  return applyRateLimit(requestCounts, RATE_LIMIT_MAX, req, res, next);
}

function cloudRateLimit(req, res, next) {
  return applyRateLimit(cloudRequestCounts, CLOUD_RATE_LIMIT_MAX, req, res, next);
}

function imageProxyRateLimit(req, res, next) {
  return applyRateLimit(imageProxyRequestCounts, IMAGE_PROXY_RATE_LIMIT_MAX, req, res, next);
}

const backgroundJobRequestCounts = new Map();
function backgroundJobRateLimit(req, res, next) {
  return applyRateLimit(backgroundJobRequestCounts, BACKGROUND_JOB_RATE_LIMIT_MAX, req, res, next);
}

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:8022',
  credentials: true,
}));
let backgroundWorker;
const videoJobHandlers = createVideoJobHandlers();
app.use('/api/auth', createAuthRouter({ rateLimit }));
app.use('/api/admin', attachAuthUser, requireAdmin, createAdminRouter({
  rateLimit,
  getBackgroundWorkerStatus: () => backgroundWorker?.getStatus() || null,
  updateBackgroundWorkerConfig: (config) => {
    if (!backgroundWorker || typeof backgroundWorker.updateConfig !== 'function') return null;
    backgroundWorker.updateConfig(config);
    return backgroundWorker.getStatus();
  },
}));
app.use('/api/cloud', attachAuthUser, requireAuth, createCloudStoreRouter({ rateLimit: cloudRateLimit }));
app.use('/api/agent', attachAuthUser, requireAuth, createAgentRouter({ rateLimit: cloudRateLimit }));
app.use(express.json({ limit: '2mb' }));
app.use('/api/jobs', attachAuthUser, createBackgroundJobRouter({
  rateLimit: backgroundJobRateLimit,
  cancelHandlers: {
    'step5-videos': cancelStep5VideoJob,
  },
}));
app.use('/api/render', createRenderRouter());
app.use('/api/xyq-agent', createXyqAgentRouter({ rateLimit }));

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.slice(-1200) || `ffmpeg exited with code ${code}`));
    });
  });
}

async function removeDirSafe(dir) {
  if (!dir) return;
  await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

function getVoiceCorpusOutputDir() {
  if (process.env.VOICE_CORPUS_DIR) return process.env.VOICE_CORPUS_DIR;
  const candidates = [
    path.resolve(process.cwd(), 'voice_corpus', 'output'),
    path.resolve(process.cwd(), '..', 'voice_corpus', 'output'),
    path.resolve(process.cwd(), '..', '..', 'voice_corpus', 'output'),
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'voice_samples_manifest.json')))
    || candidates[0];
}

function getVoiceCorpusClipsDir() {
  return path.join(getVoiceCorpusOutputDir(), 'clips');
}

function getCrossPlatformBaseName(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const parts = text.split(/[\\/]+/);
  return parts[parts.length - 1] || '';
}

function safeResolveVoiceCorpusAudio(fileName) {
  const baseName = path.basename(String(fileName || ''));
  if (!/\.(?:wav|mp3|m4a|aac)$/i.test(baseName)) return null;
  const clipsDir = path.resolve(getVoiceCorpusClipsDir());
  const filePath = path.resolve(clipsDir, baseName);
  if (filePath !== clipsDir && !filePath.startsWith(`${clipsDir}${path.sep}`)) return null;
  return filePath;
}

function sanitizeSeedanceUploadFileName(value, fallback = 'media.bin') {
  const base = path.basename(String(value || '').trim() || fallback)
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
  return base || fallback;
}

function normalizeSeedanceUploadRole(value) {
  const role = String(value || '').trim().toLowerCase().replace(/-/g, '_');
  if (role === 'referencevideo' || role === 'reference-video' || role === 'imitation_video') return 'reference_video';
  if (!SEEDANCE_DIRECT_UPLOAD_ROLES.has(role)) throw new Error(`Unsupported media role: ${value}`);
  return role;
}

function normalizeSeedanceUploadContentType(value, role) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(raw)) return raw.slice(0, 160);
  if (role === 'image') return 'image/png';
  if (role === 'audio') return 'audio/mpeg';
  return 'video/mp4';
}

function buildSeedanceUploadObjectKey({ role, fileName, clientTaskId, licenseKey }) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const licenseSegment = crypto.createHash('sha256')
    .update(String(licenseKey || 'anonymous'))
    .digest('hex')
    .slice(0, 16);
  const taskSegment = String(clientTaskId || '').trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || crypto.randomUUID();
  return [
    'seedance-upload',
    date,
    licenseSegment,
    taskSegment,
    `${role}-${crypto.randomUUID()}-${sanitizeSeedanceUploadFileName(fileName)}`,
  ].join('/');
}

function normalizeSeedanceDirectUploadFiles(body) {
  const files = Array.isArray(body?.files) ? body.files : [];
  if (files.length === 0) throw new Error('files must contain at least one item');
  if (files.length > SEEDANCE_DIRECT_UPLOAD_MAX_FILES) {
    throw new Error(`files must contain at most ${SEEDANCE_DIRECT_UPLOAD_MAX_FILES} items`);
  }

  let totalBytes = 0;
  return files.map((file, index) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new Error(`files[${index}] must be an object`);
    }
    const role = normalizeSeedanceUploadRole(file.role);
    const sizeBytes = Number(file.sizeBytes ?? file.size_bytes ?? 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new Error(`files[${index}].sizeBytes must be positive`);
    }
    if (sizeBytes > 120 * 1024 * 1024) {
      throw new Error(`files[${index}] is too large`);
    }
    totalBytes += sizeBytes;
    if (totalBytes > SEEDANCE_DIRECT_UPLOAD_MAX_TOTAL_BYTES) {
      throw new Error('files total size is too large');
    }
    return {
      id: String(file.id || `${role}-${index}`),
      role,
      fileName: sanitizeSeedanceUploadFileName(file.fileName || file.file_name, `${role}-${index + 1}.bin`),
      contentType: normalizeSeedanceUploadContentType(file.contentType || file.content_type, role),
      sizeBytes,
    };
  });
}

async function validateSeedanceDirectUploadLicense(licenseKey) {
  const response = await fetch(SEEDANCE_CLOUD_LICENSE_VALIDATE_URL, {
    method: 'GET',
    headers: { 'X-License-Key': licenseKey },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.ok) return;
  const detail = await response.text().catch(() => '');
  const error = new Error(detail ? `License validation failed: ${detail.slice(0, 300)}` : 'License validation failed');
  error.status = response.status >= 400 && response.status < 500 ? 401 : 503;
  throw error;
}

app.post('/api/media/seedance-direct-upload-tickets', rateLimit, async (req, res) => {
  try {
    const licenseKey = String(req.get('x-license-key') || req.body?.licenseKey || req.body?.license_key || '').trim();
    if (!licenseKey) {
      return res.status(401).json({ error: 'Missing license key' });
    }
    await validateSeedanceDirectUploadLicense(licenseKey);

    const directStatus = await getDirectObjectStorageStatus();
    if (!directStatus.enabled) {
      return res.status(409).json({ error: 'Tencent COS direct upload is not enabled' });
    }

    const files = normalizeSeedanceDirectUploadFiles(req.body || {});
    const clientTaskId = String(req.body?.clientTaskId || req.body?.client_task_id || '').trim();
    const items = [];

    for (const file of files) {
      const objectKey = buildSeedanceUploadObjectKey({
        role: file.role,
        fileName: file.fileName,
        clientTaskId,
        licenseKey,
      });
      const upload = await createSignedPutUrl(objectKey, file.contentType, SEEDANCE_DIRECT_UPLOAD_TTL_SECONDS);
      const download = await createSignedGetUrl(objectKey, SEEDANCE_DIRECT_DOWNLOAD_TTL_SECONDS);
      items.push({
        ...file,
        objectKey,
        upload,
        download,
      });
    }

    res.json({
      status: 'success',
      storage: {
        driver: directStatus.driver,
        bucket: directStatus.bucket,
        region: directStatus.region,
        prefix: directStatus.prefix,
      },
      items,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = Number(err?.status || 0)
      || (/too large|at most|positive|Unsupported|must contain|must be/i.test(message) ? 400 : 500);
    res.status(status).json({ error: message });
  }
});

app.get('/api/media/voice-corpus', rateLimit, async (_req, res) => {
  try {
    const outputDir = getVoiceCorpusOutputDir();
    const manifestPath = path.join(outputDir, 'voice_samples_manifest.json');
    const raw = await fs.promises.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    const samples = Array.isArray(manifest) ? manifest : [];
    const result = [];

    for (const item of samples) {
      const sourcePath = item['本地文件'];
      const fileName = getCrossPlatformBaseName(sourcePath);
      const audioPath = safeResolveVoiceCorpusAudio(fileName);
      if (!audioPath || !fs.existsSync(audioPath)) continue;
      result.push({
        id: fileName,
        fileName,
        displayName: [item['角色'], item['语言'], item['推荐语音标题']].filter(Boolean).join(' · '),
        sourceWork: item['作品'],
        sourceCharacter: item['角色'],
        language: item['语言'],
        gender: item['性别'],
        ageAppearance: item['年龄段/外显'],
        heat: item['热度'],
        voiceActor: item['配音演员'],
        voiceTags: item['音色特点'],
        roleSuggestion: item['主配角建议'],
        sampleText: item['语音文本摘要'],
        durationSec: item['建议片段时长'] || item['源音频时长'],
        remoteAudioUrl: item['音频URL'],
        audioUrl: `/api/media/voice-corpus/audio?file=${encodeURIComponent(fileName)}`,
      });
    }

    res.json({ samples: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `voice corpus unavailable: ${message}` });
  }
});

app.get('/api/media/voice-corpus/audio', rateLimit, async (req, res) => {
  const filePath = safeResolveVoiceCorpusAudio(req.query.file);
  if (!filePath) {
    return res.status(400).send('Invalid voice corpus file');
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Voice corpus file not found');
  }
  if (/\.wav$/i.test(filePath)) res.setHeader('Content-Type', 'audio/wav');
  if (/\.mp3$/i.test(filePath)) res.setHeader('Content-Type', 'audio/mpeg');
  res.sendFile(filePath);
});

app.post('/api/media/audio-to-black-video', rateLimit, mediaUpload.single('audio'), async (req, res) => {
  const file = req.file;
  if (!file?.buffer?.length) {
    return res.status(400).send('Missing audio file');
  }

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xiakeman-voice-'));
  const inputPath = path.join(tempDir, 'input-audio');
  const outputPath = path.join(tempDir, 'voice-reference.mp4');

  try {
    await fs.promises.writeFile(inputPath, file.buffer);
    await runFfmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=black:s=1280x720:r=25',
      '-i', inputPath,
      '-shortest',
      '-c:v', 'libx264',
      '-tune', 'stillimage',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ]);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="voice-reference-black.mp4"');
    res.on('finish', () => {
      void removeDirSafe(tempDir);
    });
    res.sendFile(outputPath, (error) => {
      if (error && !res.headersSent) {
        res.status(500).send(error.message);
      }
      if (error) {
        void removeDirSafe(tempDir);
      }
    });
  } catch (error) {
    await removeDirSafe(tempDir);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).send(`audio-to-black-video failed: ${message}`);
  }
});

// ---- 提示词模板（核心资产，仅存在于服务端） ----
// 从独立文件加载，避免在主入口中明文暴露
const templates = require('./templates');

const STEP1_RESPONSE_FORMAT = { type: 'json_object' };
const STEP1_STREAM_CHUNK_SIZE = 160;

function shouldUseStep1StructuredMode(templateType) {
  return templateType === 'step1' || templateType === 'analysis_autofill';
}

function getRawUserContentForGuard(userMessages) {
  return userMessages
    .filter((message) => message.role === 'user' && typeof message.content === 'string')
    .map((message) => message.content)
    .join('\n\n');
}

function buildChatCompletionBody({ model, messages, temperature, maxTokens, stream, responseFormat, reasoningEffort }) {
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream,
  };

  if (responseFormat) {
    body.response_format = responseFormat;
  }
  if (reasoningEffort) {
    body.reasoning_effort = reasoningEffort;
  }

  return body;
}

function createTimeoutError(message) {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

function getAbortReasonMessage(signal, fallbackMessage) {
  const reason = signal?.reason;
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === 'string' && reason) return reason;
  return fallbackMessage;
}

function composeAbortSignals(signals) {
  const activeSignals = signals.filter(Boolean);
  if (activeSignals.length === 0) return undefined;
  if (activeSignals.length === 1) return activeSignals[0];
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(activeSignals);
  }

  const controller = new AbortController();
  const abortFrom = (signal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason || new Error('Request aborted'));
    }
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    signal.addEventListener('abort', () => abortFrom(signal), { once: true });
  }

  return controller.signal;
}

function createClientAbortController(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted && !res.writableEnded) {
      controller.abort(new Error(CLIENT_ABORT_MESSAGE));
    }
  };

  req.on('aborted', abort);
  res.on('close', abort);
  return controller;
}

function isResponseWritable(res) {
  return !res.destroyed && !res.writableEnded;
}

function writeRawSseLine(res, line) {
  if (!isResponseWritable(res)) return false;
  res.write(`${line}\n\n`);
  return true;
}

function writeDoneSse(res) {
  return writeRawSseLine(res, 'data: [DONE]');
}

function getNonStreamTimeoutMs(purpose = 'primary') {
  return purpose === 'repair'
    ? SERIES_JSON_REPAIR_TIMEOUT_MS
    : DEFAULT_CHAT_COMPLETION_TIMEOUT_MS;
}

function createStreamInactivityTimeout(timeoutMs = STREAM_IDLE_TIMEOUT_MS) {
  const controller = new AbortController();
  let timeoutId = null;

  const clear = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const refresh = () => {
    clear();
    timeoutId = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort(createTimeoutError(
          `LLM stream timeout: no upstream content or reasoning activity for ${Math.round(timeoutMs / 1000)} seconds`,
        ));
      }
    }, timeoutMs);
    if (typeof timeoutId.unref === 'function') timeoutId.unref();
  };

  refresh();
  return {
    signal: controller.signal,
    refresh,
    clear,
  };
}

function shouldRetryWithoutResponseFormat(status, errorBody) {
  if (!errorBody) return false;

  const mentionsStructuredFormat =
    /response[_ ]format|json[_ ]object|json schema|unsupported|not support|不支持/i.test(errorBody);
  if (status === 400) return mentionsStructuredFormat;

  // Some OpenAI-compatible gateways return a generic 5xx/HTML page instead of
  // a clean 400 when `response_format` is unsupported. Retry once without the
  // optional hint; Step1 still has server-side JSON validation and repair.
  if (status >= 500 && status < 600) {
    return mentionsStructuredFormat || /<html|<\/html>|nginx|Internal Server Error|Bad Gateway|Gateway Timeout/i.test(errorBody);
  }

  return false;
}

async function postJsonChatCompletion(url, apiKey, requestBody, options = {}) {
  const {
    timeoutMs = getNonStreamTimeoutMs(),
    signal,
  } = options;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  const doRequest = async (body) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const fetchSignal = composeAbortSignals([timeoutSignal, signal]);
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: fetchSignal,
    });
    const rawText = await response.text().catch(() => 'Unknown error');
    return { response, rawText };
  };

  let { response, rawText } = await doRequest(requestBody);

  if (!response.ok && requestBody.response_format && shouldRetryWithoutResponseFormat(response.status, rawText)) {
    const fallbackBody = { ...requestBody };
    delete fallbackBody.response_format;
    ({ response, rawText } = await doRequest(fallbackBody));
  }

  if (!response.ok) {
    throw new Error(`LLM API Error (${response.status}): ${rawText.slice(0, 500)}`);
  }

  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error('LLM API returned a non-JSON response envelope');
  }
}

async function openStreamingChatCompletion(url, apiKey, requestBody, options = {}) {
  const { signal } = options;
  const streamTimeout = createStreamInactivityTimeout();
  const fetchSignal = composeAbortSignals([streamTimeout.signal, signal]);
  const doFetch = (body) => fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: fetchSignal,
  });

  try {
    let response = await doFetch(requestBody);

    if (!response.ok && requestBody.response_format) {
      const errorBody = await response.text().catch(() => '');
      if (shouldRetryWithoutResponseFormat(response.status, errorBody)) {
        const fallbackBody = { ...requestBody };
        delete fallbackBody.response_format;
        streamTimeout.refresh();
        response = await doFetch(fallbackBody);
      } else {
        streamTimeout.clear();
        return { response, errorBody, streamTimeout: null };
      }
    }

    if (!response.ok) {
      streamTimeout.clear();
      return { response, errorBody: '', streamTimeout: null };
    }

    return { response, errorBody: '', streamTimeout };
  } catch (err) {
    const message = getAbortReasonMessage(
      fetchSignal,
      err instanceof Error ? err.message : String(err),
    );
    streamTimeout.clear();
    throw new Error(message);
  }
}

async function postStreamingChatCompletionContent(url, apiKey, requestBody, options = {}) {
  const { signal } = options;
  const streamingBody = { ...requestBody, stream: true };
  const { response, errorBody, streamTimeout } = await openStreamingChatCompletion(url, apiKey, streamingBody, {
    signal,
  });

  if (!response.ok) {
    streamTimeout?.clear();
    throw new Error(`LLM API Error (${response.status}): ${errorBody.slice(0, 500)}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    streamTimeout?.clear();
    throw new Error('BFF stream error: upstream response body is empty');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let streamedContent = '';
  let upstreamDoneReceived = false;

  const consumeSseLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed === 'data: [DONE]') {
      upstreamDoneReceived = true;
      return;
    }
    if (!trimmed.startsWith('data: ')) return;

    const json = JSON.parse(trimmed.slice(6));
    const body = unwrapResponseEnvelope(json);
    if (body?.error) {
      const message = typeof body.error?.message === 'string'
        ? body.error.message
        : JSON.stringify(body.error).slice(0, 500);
      throw new Error(`LLM stream error: ${message}`);
    }

    const activity = getStreamingDeltaActivity(body);
    if (activity.hasActivity) {
      streamTimeout?.refresh();
    }
    if (activity.content) {
      streamedContent += activity.content;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        consumeSseLine(line);
      }
    }

    const trailingLine = buffer.trim();
    if (trailingLine) {
      consumeSseLine(trailingLine);
    }

    if (!upstreamDoneReceived) {
      throw new Error('LLM stream ended before completion marker');
    }

    return streamedContent;
  } catch (err) {
    const message = getAbortReasonMessage(
      signal,
      getAbortReasonMessage(streamTimeout?.signal, err instanceof Error ? err.message : String(err)),
    );
    throw new Error(message);
  } finally {
    streamTimeout?.clear();
  }
}

function streamContentAsSse(res, content) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  for (let i = 0; i < content.length; i += STEP1_STREAM_CHUNK_SIZE) {
    const chunk = content.slice(i, i + STEP1_STREAM_CHUNK_SIZE);
    if (!writeRawSseLine(res, `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}`)) {
      return;
    }
  }

  writeDoneSse(res);
  if (isResponseWritable(res)) res.end();
}

function writeSseEvent(res, payload) {
  return writeRawSseLine(res, `data: ${JSON.stringify(payload)}`);
}

function unwrapResponseEnvelope(data) {
  if (!data || typeof data !== 'object' || !data.data || typeof data.data !== 'object') {
    return data;
  }
  return data.data;
}

function getStreamingDeltaActivity(json) {
  const body = unwrapResponseEnvelope(json);
  const delta = body?.choices?.[0]?.delta;
  const content = typeof delta?.content === 'string' ? delta.content : '';
  const reasoning = typeof delta?.reasoning_content === 'string'
    ? delta.reasoning_content
    : typeof delta?.reasoning === 'string'
      ? delta.reasoning
      : '';

  return {
    content,
    hasActivity: Boolean(content || reasoning),
  };
}

async function requestStructuredRepairCompletion({
  url,
  apiKey,
  model,
  messages,
  maxTokens,
  reason,
  signal,
  reasoningEffort,
}) {
  const repairMessages = [
    ...messages,
    { role: 'user', content: buildStep1RepairPrompt(reason) },
  ];

  const repairedContent = await postStreamingChatCompletionContent(url, apiKey, buildChatCompletionBody({
    model,
    messages: repairMessages,
    temperature: 0,
    maxTokens,
    stream: true,
    responseFormat: STEP1_RESPONSE_FORMAT,
    reasoningEffort,
  }), { timeoutMs: getNonStreamTimeoutMs('repair'), signal });

  const normalized = normalizeStep1AnalysisContent(repairedContent);
  if (!normalized.ok) {
    throw new Error(`Structured output validation failed after retry: ${normalized.reason}`);
  }

  return replaceContentInChatResponse({}, normalized.content);
}

async function stabilizeStructuredAnalysisContent({
  content,
  url,
  apiKey,
  model,
  messages,
  maxTokens,
  signal,
  reasoningEffort,
  allowModelRepair = true,
}) {
  const normalized = normalizeStep1AnalysisContent(content);
  if (normalized.ok) {
    return { content: normalized.content, repaired: normalized.repaired === true };
  }

  if (!allowModelRepair) {
    throw new Error(`Structured output validation failed: ${normalized.reason}`);
  }

  console.warn('[BFF] Structured output validation failed, retrying once:', normalized.reason);
  const repaired = await requestStructuredRepairCompletion({
    url,
    apiKey,
    model,
    messages,
    maxTokens,
    reason: normalized.reason,
    signal,
    reasoningEffort,
  });

  return {
    content: extractContentFromChatResponse(repaired),
    repaired: true,
  };
}

async function requestStableStep1Completion({
  url,
  apiKey,
  model,
  messages,
  temperature,
  maxTokens,
  signal,
  reasoningEffort,
}) {
  const firstContent = await postStreamingChatCompletionContent(url, apiKey, buildChatCompletionBody({
    model,
    messages,
    temperature,
    maxTokens,
    stream: true,
    responseFormat: STEP1_RESPONSE_FORMAT,
    reasoningEffort,
  }), { timeoutMs: getNonStreamTimeoutMs(), signal });

  const normalizedFirst = normalizeStep1AnalysisContent(firstContent);

  if (normalizedFirst.ok) {
    return replaceContentInChatResponse({}, normalizedFirst.content);
  }

  console.warn('[BFF] Step1 first pass failed structured validation, retrying once:', normalizedFirst.reason);
  return requestStructuredRepairCompletion({
    url,
    apiKey,
    model,
    messages,
    maxTokens,
    reason: normalizedFirst.reason,
    signal,
    reasoningEffort,
  });
}

async function requestSeriesJsonRepairCompletion({
  templateType,
  content,
  url,
  apiKey,
  model,
  messages,
  maxTokens,
  reason,
  signal,
  reasoningEffort,
}) {
  const repairMessages = [
    ...messages,
    { role: 'assistant', content },
    { role: 'user', content: buildSeriesJsonRepairPrompt(templateType, reason) },
  ];

  const repairedContent = await postStreamingChatCompletionContent(url, apiKey, buildChatCompletionBody({
    model,
    messages: repairMessages,
    temperature: 0,
    maxTokens,
    stream: true,
    responseFormat: STEP1_RESPONSE_FORMAT,
    reasoningEffort,
  }), { timeoutMs: getNonStreamTimeoutMs('repair'), signal });

  const normalized = normalizeSeriesJsonContent(repairedContent, templateType);
  if (!normalized.ok) {
    throw new Error(`Series JSON validation failed after retry: ${normalized.reason}`);
  }

  return replaceContentInChatResponse({}, normalized.content);
}

async function stabilizeSeriesJsonContent({
  templateType,
  content,
  url,
  apiKey,
  model,
  messages,
  maxTokens,
  signal,
  reasoningEffort,
  allowModelRepair = true,
}) {
  const normalized = normalizeSeriesJsonContent(content, templateType);
  if (normalized.ok) {
    return { content: normalized.content, repaired: normalized.repaired === true };
  }

  if (!allowModelRepair) {
    throw new Error(`Series JSON validation failed after local cleanup: ${normalized.reason}`);
  }

  console.warn('[BFF] Series JSON validation failed, retrying once:', normalized.reason);
  const repaired = await requestSeriesJsonRepairCompletion({
    templateType,
    content,
    url,
    apiKey,
    model,
    messages,
    maxTokens,
    reason: normalized.reason,
    signal,
    reasoningEffort,
  });

  return {
    content: extractContentFromChatResponse(repaired),
    repaired: true,
  };
}

async function requestStableSeriesJsonCompletion({
  templateType,
  url,
  apiKey,
  model,
  messages,
  temperature,
  maxTokens,
  signal,
  reasoningEffort,
}) {
  const firstContent = await postStreamingChatCompletionContent(url, apiKey, buildChatCompletionBody({
    model,
    messages,
    temperature,
    maxTokens,
    stream: true,
    responseFormat: STEP1_RESPONSE_FORMAT,
    reasoningEffort,
  }), { timeoutMs: getNonStreamTimeoutMs(), signal });

  const normalizedFirst = normalizeSeriesJsonContent(firstContent, templateType);
  if (normalizedFirst.ok) {
    return replaceContentInChatResponse({}, normalizedFirst.content);
  }

  console.warn('[BFF] Series JSON first pass failed validation, retrying once:', normalizedFirst.reason);
  return requestSeriesJsonRepairCompletion({
    templateType,
    content: firstContent,
    url,
    apiKey,
    model,
    messages,
    maxTokens,
    reason: normalizedFirst.reason,
    signal,
    reasoningEffort,
  });
}

async function repairSeriesEpisodeScriptIfNeeded({
  content,
  responseEnvelope = null,
  url,
  apiKey,
  model,
  messages,
  rawUserContent,
  maxTokens,
  signal,
  reasoningEffort,
}) {
  if (typeof templates.findSeriesEpisodeScriptGuardIssues !== 'function') {
    return responseEnvelope ? { responseEnvelope, repaired: false } : { content, repaired: false };
  }

  const issues = templates.findSeriesEpisodeScriptGuardIssues(content, rawUserContent);
  if (!issues.length) {
    return responseEnvelope ? { responseEnvelope, repaired: false } : { content, repaired: false };
  }

  console.warn('[BFF] Series script guard failed, repairing once:', issues.join('；'));
  const repairMessages = [
    ...messages,
    { role: 'assistant', content },
    {
      role: 'user',
      content: templates.buildSeriesEpisodeScriptRepairPrompt(issues),
    },
  ];

  const repairedContent = (await postStreamingChatCompletionContent(url, apiKey, buildChatCompletionBody({
    model,
    messages: repairMessages,
    temperature: 0.2,
    maxTokens,
    stream: true,
    reasoningEffort,
  }), { timeoutMs: getNonStreamTimeoutMs('repair'), signal })).trim();
  const secondPassIssues = templates.findSeriesEpisodeScriptGuardIssues(repairedContent, rawUserContent);
  if (secondPassIssues.length) {
    console.warn('[BFF] Series script guard still reports issues after repair:', secondPassIssues.join('；'));
    throw new Error(`Series script guard failed after repair: ${secondPassIssues.join('；')}`);
  }

  if (responseEnvelope) {
    return {
      responseEnvelope: replaceContentInChatResponse(responseEnvelope, repairedContent),
      repaired: true,
    };
  }

  return { content: repairedContent, repaired: true };
}

// ---- API 路由 ----

/**
 * POST /api/chat/completions
 * 代理 LLM 请求，在服务端注入 system prompt
 *
 * 请求体格式：
 * {
 *   templateType: 'step1' | 'novel_adapt' | 'script_format_adapt' | 'preprocess' | 'generate',
 *   templateVars: { styleConfig, storyboard, ... },  // 模板变量
 *   userMessages: ChatMessage[],                       // 用户侧消息（不含 system）
 *   apiConfig: { baseUrl, apiKey, model },             // LLM API 配置
 *   options?: { temperature, maxTokens, stream }       // 可选参数
 * }
 */
app.post('/api/chat/completions', rateLimit, async (req, res) => {
  let request;
  try {
    request = validateChatRequest(req.body);
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const { templateType, templateVars, userMessages, apiConfig, options } = request;
  const clientAbortController = createClientAbortController(req, res);

  // 服务端拼接 system prompt
  const systemPrompt = templates.buildSystemPrompt(templateType, templateVars);
  if (!systemPrompt) {
    return res.status(400).json({ error: `Unknown templateType: ${templateType}` });
  }

  let processedUserMessages;
  try {
    // 服务端拼接 user prompt — 前端只发送原始数据，模板规则在此注入
    processedUserMessages = userMessages.map((msg) => {
      if (msg.role === 'user') {
        const builtContent = templates.buildUserPrompt(templateType, msg.content, templateVars);
        return { ...msg, content: builtContent };
      }
      return msg;
    });
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 组装完整消息列表：system + user prompt 全部在服务端拼接，前端无法看到模板
  const messages = [
    { role: 'system', content: systemPrompt },
    ...processedUserMessages,
  ];
  const rawUserContent = getRawUserContentForGuard(userMessages);

  const { temperature, maxTokens, reasoningEffort, stream } = options;
  const url = `${apiConfig.baseUrl}/chat/completions`;

  let genericStreamTimeout = null;
  try {
    if (shouldUseStep1StructuredMode(templateType)) {
      if (stream) {
        const requestBody = buildChatCompletionBody({
          model: apiConfig.model,
          messages,
          temperature,
          maxTokens,
          stream: true,
          responseFormat: STEP1_RESPONSE_FORMAT,
          reasoningEffort,
        });

        const { response, errorBody, streamTimeout } = await openStreamingChatCompletion(url, apiConfig.apiKey, requestBody, {
          signal: clientAbortController.signal,
        });
        if (!response.ok) {
          return res.status(response.status).json({
            error: `LLM API Error (${response.status}): ${errorBody.slice(0, 500)}`,
          });
        }

        const reader = response.body?.getReader();
        if (!reader) {
          streamTimeout?.clear();
          return res.status(502).json({ error: 'BFF stream error: upstream response body is empty' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        if (typeof res.flushHeaders === 'function') {
          res.flushHeaders();
        }
        const decoder = new TextDecoder();
        let buffer = '';
        let streamedContent = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed === 'data: [DONE]') continue;

              if (trimmed.startsWith('data: ')) {
                try {
                  const json = JSON.parse(trimmed.slice(6));
                  const activity = getStreamingDeltaActivity(json);
                  if (activity.hasActivity) {
                    streamTimeout?.refresh();
                  }
                  if (activity.content) {
                    streamedContent += activity.content;
                  }
                } catch {
                  // Ignore malformed SSE lines from upstream and continue proxying.
                }
              }

              if (!writeRawSseLine(res, trimmed)) throw new Error(CLIENT_ABORT_MESSAGE);
            }
          }

          const trailingLine = buffer.trim();
          if (trailingLine && trailingLine !== 'data: [DONE]') {
            if (trailingLine.startsWith('data: ')) {
              try {
                const json = JSON.parse(trailingLine.slice(6));
                const activity = getStreamingDeltaActivity(json);
                if (activity.hasActivity) {
                  streamTimeout?.refresh();
                }
                if (activity.content) {
                  streamedContent += activity.content;
                }
              } catch {
                // Ignore malformed trailing SSE line from upstream.
              }
            }
            if (!writeRawSseLine(res, trailingLine)) throw new Error(CLIENT_ABORT_MESSAGE);
          }

          const stabilized = await stabilizeStructuredAnalysisContent({
            content: streamedContent,
            url,
            apiKey: apiConfig.apiKey,
            model: apiConfig.model,
            messages,
            maxTokens,
            signal: clientAbortController.signal,
            reasoningEffort,
            allowModelRepair: false,
          });

          if (stabilized.content !== streamedContent) {
            writeSseEvent(res, {
              type: 'replace',
              content: stabilized.content,
            });
          }

          writeDoneSse(res);
        } catch (err) {
          const message = getAbortReasonMessage(
            clientAbortController.signal,
            getAbortReasonMessage(streamTimeout?.signal, err instanceof Error ? err.message : String(err)),
          );
          console.error('[BFF] Step1 stream error:', message);
          writeSseEvent(res, {
            type: 'error',
            message: `Structured stream validation failed: ${message}`,
          });
          writeDoneSse(res);
        } finally {
          streamTimeout?.clear();
          if (isResponseWritable(res)) res.end();
        }
        return;
      }

      const stabilizedResponse = await requestStableStep1Completion({
        url,
        apiKey: apiConfig.apiKey,
        model: apiConfig.model,
        messages,
        temperature,
        maxTokens,
        signal: clientAbortController.signal,
        reasoningEffort,
      });

      if (stream) {
        streamContentAsSse(res, extractContentFromChatResponse(stabilizedResponse));
      } else {
        res.json(stabilizedResponse);
      }
      return;
    }

    if (isSeriesJsonTemplateType(templateType)) {
      if (stream) {
        const requestBody = buildChatCompletionBody({
          model: apiConfig.model,
          messages,
          temperature,
          maxTokens,
          stream: true,
          responseFormat: STEP1_RESPONSE_FORMAT,
          reasoningEffort,
        });

        const { response, errorBody, streamTimeout } = await openStreamingChatCompletion(url, apiConfig.apiKey, requestBody, {
          signal: clientAbortController.signal,
        });
        if (!response.ok) {
          return res.status(response.status).json({
            error: `LLM API Error (${response.status}): ${errorBody.slice(0, 500)}`,
          });
        }

        const reader = response.body?.getReader();
        if (!reader) {
          streamTimeout?.clear();
          return res.status(502).json({ error: 'BFF stream error: upstream response body is empty' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        if (typeof res.flushHeaders === 'function') {
          res.flushHeaders();
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let streamedContent = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed === 'data: [DONE]') continue;

              if (trimmed.startsWith('data: ')) {
                try {
                  const json = JSON.parse(trimmed.slice(6));
                  const activity = getStreamingDeltaActivity(json);
                  if (activity.hasActivity) {
                    streamTimeout?.refresh();
                  }
                  if (activity.content) {
                    streamedContent += activity.content;
                  }
                } catch {
                  // Ignore malformed SSE lines from upstream and continue proxying.
                }
              }

              if (!writeRawSseLine(res, trimmed)) throw new Error(CLIENT_ABORT_MESSAGE);
            }
          }

          const trailingLine = buffer.trim();
          if (trailingLine && trailingLine !== 'data: [DONE]') {
            if (trailingLine.startsWith('data: ')) {
              try {
                const json = JSON.parse(trailingLine.slice(6));
                const activity = getStreamingDeltaActivity(json);
                if (activity.hasActivity) {
                  streamTimeout?.refresh();
                }
                if (activity.content) {
                  streamedContent += activity.content;
                }
              } catch {
                // Ignore malformed trailing SSE line from upstream.
              }
            }
            if (!writeRawSseLine(res, trailingLine)) throw new Error(CLIENT_ABORT_MESSAGE);
          }

          const stabilized = await stabilizeSeriesJsonContent({
            templateType,
            content: streamedContent,
            url,
            apiKey: apiConfig.apiKey,
            model: apiConfig.model,
            messages,
            maxTokens,
            signal: clientAbortController.signal,
            reasoningEffort,
            allowModelRepair: false,
          });

          if (stabilized.content !== streamedContent) {
            writeSseEvent(res, {
              type: 'replace',
              content: stabilized.content,
            });
          }

          writeDoneSse(res);
        } catch (err) {
          const message = getAbortReasonMessage(
            clientAbortController.signal,
            getAbortReasonMessage(streamTimeout?.signal, err instanceof Error ? err.message : String(err)),
          );
          console.error('[BFF] Series JSON stream error:', message);
          writeSseEvent(res, {
            type: 'error',
            message: `Series JSON stream validation failed: ${message}`,
          });
          writeDoneSse(res);
        } finally {
          streamTimeout?.clear();
          if (isResponseWritable(res)) res.end();
        }
        return;
      }

      const stabilizedResponse = await requestStableSeriesJsonCompletion({
        templateType,
        url,
        apiKey: apiConfig.apiKey,
        model: apiConfig.model,
        messages,
        temperature,
        maxTokens,
        signal: clientAbortController.signal,
        reasoningEffort,
      });

      res.json(stabilizedResponse);
      return;
    }

    const requestBody = buildChatCompletionBody({
      model: apiConfig.model,
      messages,
      temperature,
      maxTokens,
      stream,
      reasoningEffort,
    });

    genericStreamTimeout = stream ? createStreamInactivityTimeout() : null;
    const upstreamSignal = genericStreamTimeout
      ? composeAbortSignals([genericStreamTimeout.signal, clientAbortController.signal])
      : composeAbortSignals([
        AbortSignal.timeout(getNonStreamTimeoutMs()),
        clientAbortController.signal,
      ]);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiConfig.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: upstreamSignal,
    });

    if (!response.ok) {
      genericStreamTimeout?.clear();
      const errorBody = await response.text().catch(() => 'Unknown error');
      return res.status(response.status).json({
        error: `LLM API Error (${response.status}): ${errorBody.slice(0, 500)}`,
      });
    }

    if (stream) {
      // 流式代理：逐块转发 SSE；系列剧本会在 DONE 前做一次服务端边界检查，必要时发送 replace。
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body?.getReader();
      if (!reader) {
        genericStreamTimeout?.clear();
        return res.status(502).json({ error: 'BFF stream error: upstream response body is empty' });
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let streamedContent = '';
      let upstreamDoneReceived = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed === 'data: [DONE]') {
              upstreamDoneReceived = true;
              continue;
            }

            if (trimmed.startsWith('data: ')) {
              try {
                const json = JSON.parse(trimmed.slice(6));
                const activity = getStreamingDeltaActivity(json);
                if (activity.hasActivity) {
                  genericStreamTimeout?.refresh();
                }
                if (activity.content) {
                  streamedContent += activity.content;
                }
              } catch {
                // Ignore malformed SSE lines from upstream and continue proxying.
              }
            }

            if (!writeRawSseLine(res, trimmed)) throw new Error(CLIENT_ABORT_MESSAGE);
          }
        }

        const trailingLine = buffer.trim();
        if (trailingLine === 'data: [DONE]') {
          upstreamDoneReceived = true;
        } else if (trailingLine) {
          if (trailingLine.startsWith('data: ')) {
            try {
              const json = JSON.parse(trailingLine.slice(6));
              const activity = getStreamingDeltaActivity(json);
              if (activity.hasActivity) {
                genericStreamTimeout?.refresh();
              }
              if (activity.content) {
                streamedContent += activity.content;
              }
            } catch {
              // Ignore malformed trailing SSE line from upstream.
            }
          }
          if (!writeRawSseLine(res, trailingLine)) throw new Error(CLIENT_ABORT_MESSAGE);
        }

        if (!upstreamDoneReceived) {
          throw new Error('LLM stream ended before completion marker');
        }

        if (templateType === 'series_episode_script_generate') {
          const repaired = await repairSeriesEpisodeScriptIfNeeded({
            content: streamedContent,
            url,
            apiKey: apiConfig.apiKey,
            model: apiConfig.model,
            messages,
            rawUserContent,
            maxTokens,
            signal: clientAbortController.signal,
            reasoningEffort,
          });
          if (repaired.repaired && repaired.content !== streamedContent) {
            writeSseEvent(res, {
              type: 'replace',
              content: repaired.content,
            });
          }
        }
      } catch (err) {
        const message = getAbortReasonMessage(
          clientAbortController.signal,
          getAbortReasonMessage(genericStreamTimeout?.signal, err instanceof Error ? err.message : String(err)),
        );
        console.error('[BFF] Stream error:', message);
        writeSseEvent(res, {
          type: 'error',
          message: `BFF stream error: ${message}`,
        });
      } finally {
        genericStreamTimeout?.clear();
        genericStreamTimeout = null;
        writeDoneSse(res);
        if (isResponseWritable(res)) res.end();
      }
    } else {
      // 非流式：直接转发 JSON
      const data = await response.json();
      if (templateType === 'series_episode_script_generate') {
        const repaired = await repairSeriesEpisodeScriptIfNeeded({
          content: extractContentFromChatResponse(data),
          responseEnvelope: data,
          url,
          apiKey: apiConfig.apiKey,
          model: apiConfig.model,
          messages,
          rawUserContent,
          maxTokens,
          signal: clientAbortController.signal,
          reasoningEffort,
        });
        res.json(repaired.responseEnvelope);
        return;
      }
      res.json(data);
    }
  } catch (err) {
    const message = getAbortReasonMessage(
      clientAbortController.signal,
      getAbortReasonMessage(genericStreamTimeout?.signal, err instanceof Error ? err.message : String(err)),
    );
    genericStreamTimeout?.clear();
    console.error('[BFF] Proxy error:', message);
    if (clientAbortController.signal.aborted && !isResponseWritable(res)) {
      return;
    }
    if (!res.headersSent && isResponseWritable(res)) {
      res.status(502).json({ error: `BFF proxy error: ${message}` });
    } else if (isResponseWritable(res)) {
      writeSseEvent(res, { type: 'error', message: `BFF proxy error: ${message}` });
      writeDoneSse(res);
      res.end();
    }
  }
});

/**
 * GET /api/health
 * 健康检查
 */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'xiakeman-bff' });
});

/**
 * GET /api/proxy/image
 * Downloads remote image outputs through the BFF to avoid browser CORS failures.
 * Query: url - encoded remote image URL.
 */
app.get('/api/proxy/image', imageProxyRateLimit, async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  if (!isImageUrlAllowed(url)) {
    return res.status(403).json({ error: 'Domain not allowed' });
  }

  try {
    const imageRes = await fetch(url, { signal: AbortSignal.timeout(IMAGE_PROXY_FETCH_TIMEOUT_MS) });
    if (!imageRes.ok) {
      return res.status(502).json({ error: `Failed to fetch image: ${imageRes.status}` });
    }

    const contentType = imageRes.headers.get('content-type') || 'image/png';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return res.status(502).json({ error: `Remote URL is not an image: ${contentType}` });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline; filename="image"');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    if (imageRes.body) {
      for await (const chunk of imageRes.body) {
        res.write(chunk);
      }
      res.end();
    } else {
      const arrayBuffer = await imageRes.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    }
  } catch (err) {
    console.error('[BFF] Image proxy error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Image proxy error' });
    }
  }
});

/**
 * GET /api/proxy/video
 * 代理下载视频，解决 CORS 跨域问题
 * 参数: url - 视频 URL（需要编码）
 */
app.get('/api/proxy/video', rateLimit, async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  if (!isVideoUrlAllowed(url)) {
    return res.status(403).json({ error: 'Domain not allowed' });
  }

  try {
    const upstreamHeaders = {};
    if (typeof req.headers.range === 'string') {
      upstreamHeaders.Range = req.headers.range;
    }

    const videoRes = await fetch(url, {
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(120_000),
    });
    if (!videoRes.ok) {
      return res.status(502).json({ error: `Failed to fetch video: ${videoRes.status}` });
    }

    const contentType = videoRes.headers.get('content-type') || 'video/mp4';
    const contentLength = videoRes.headers.get('content-length');
    const contentRange = videoRes.headers.get('content-range');
    const acceptRanges = videoRes.headers.get('accept-ranges') || 'bytes';
    if (videoRes.status === 206) {
      res.status(206);
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline; filename="video.mp4"');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Accept-Ranges', acceptRanges);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) res.setHeader('Content-Range', contentRange);

    if (videoRes.body) {
      for await (const chunk of videoRes.body) {
        res.write(chunk);
      }
      res.end();
    } else {
      const arrayBuffer = await videoRes.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    }
  } catch (err) {
    console.error('[BFF] Video proxy error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Video proxy error' });
    }
  }
});

async function startBackgroundWorker() {
  if (process.env.BACKGROUND_WORKER_ENABLED === 'false') return;
  let workerConfig = {
    concurrency: Number(process.env.BACKGROUND_WORKER_CONCURRENCY || DEFAULT_BACKGROUND_WORKER_CONCURRENCY),
    typeConcurrency: {
      'step1-analysis': Number(process.env.BACKGROUND_WORKER_STEP1_CONCURRENCY || 32),
      'step3-assets': Number(process.env.BACKGROUND_WORKER_STEP3_CONCURRENCY || 32),
      'step4-storyboards': Number(process.env.BACKGROUND_WORKER_STEP4_CONCURRENCY || 24),
      'image-generations': Number(process.env.BACKGROUND_WORKER_IMAGE_CONCURRENCY || 64),
      'llm-completions': Number(process.env.BACKGROUND_WORKER_LLM_CONCURRENCY || 128),
      'step5-videos': Number(process.env.BACKGROUND_WORKER_VIDEO_CONCURRENCY || 24),
      'step6-tts': Number(process.env.BACKGROUND_WORKER_TTS_CONCURRENCY || 64),
      'step6-bgm': Number(process.env.BACKGROUND_WORKER_BGM_CONCURRENCY || 32),
      'step6-render': Number(process.env.BACKGROUND_WORKER_RENDER_CONCURRENCY || 12),
    },
  };
  try {
    workerConfig = await getEffectiveBackgroundWorkerConfig();
  } catch (error) {
    console.warn('[BFF] Failed to load background worker config, using env defaults:', error.message);
  }

  backgroundWorker = createBackgroundWorker({
    workerId: process.env.BACKGROUND_WORKER_ID || `bff-${process.pid}`,
    handlers: {
      ...videoJobHandlers,
      ...createRenderJobHandlers(),
      ...createLlmJobHandlers(),
      ...createImageJobHandlers(),
      ...createStep1JobHandlers(),
      ...createStep3JobHandlers(),
      ...createStep4JobHandlers(),
      ...createTtsJobHandlers(),
      ...createBgmJobHandlers(),
    },
    concurrency: workerConfig.concurrency,
    typeConcurrency: workerConfig.typeConcurrency,
    leaseSeconds: Number(process.env.BACKGROUND_WORKER_LEASE_SECONDS || 1800),
    staleSeconds: Number(process.env.BACKGROUND_WORKER_STALE_SECONDS || 240),
  });
  backgroundWorker.start();
}

void startBackgroundWorker();

// ---- 启动 ----
app.listen(PORT, () => {
  console.log(`[虾客漫 BFF] 服务启动，端口: ${PORT}`);
  console.log(`[虾客漫 BFF] 提示词模板受保护，前端无法直接访问`);
  if (backgroundWorker) {
    console.log(`[虾客漫 BFF] 后台 Worker 已启用: ${backgroundWorker.getStatus().workerId}`);
  }
});
