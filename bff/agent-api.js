const crypto = require('crypto');
const express = require('express');
const {
  cancelJob,
  createJob,
  getJob,
  getJobStoreDriver,
  listJobEvents,
  listJobs,
  retryJob,
} = require('./background-jobs');
const {
  getCloudProjectSnapshot,
  listCloudProjectsForUser,
  putCloudProjectSnapshot,
} = require('./cloud-store');
const {
  getEffectiveAgentDefaults,
  getEffectiveAgentDefaultsForUser,
  getPublicAgentDefaults,
  getPublicUserAgentDefaults,
  getPublicBackgroundWorkerConfig,
  getPublicObjectStorageConfig,
  saveAgentDefaults,
  saveUserAgentDefaults,
  saveObjectStorageConfig,
} = require('./commercial-settings');

const JSON_LIMIT = process.env.AGENT_API_JSON_LIMIT || '20mb';
const SUPPORTED_AGENT_JOB_TYPES = new Set([
  'step1-analysis',
  'step3-assets',
  'llm-completions',
  'image-generations',
  'step4-storyboards',
  'step5-videos',
  'step6-tts',
  'step6-bgm',
  'step6-render',
]);
const STEP_JOB_TYPE_MAP = {
  step1: 'step1-analysis',
  analysis: 'step1-analysis',
  'step1-analysis': 'step1-analysis',
  step3: 'step3-assets',
  assets: 'step3-assets',
  'step3-assets': 'step3-assets',
  llm: 'llm-completions',
  image: 'image-generations',
  video: 'step5-videos',
  step4: 'step4-storyboards',
  storyboard: 'step4-storyboards',
  storyboards: 'step4-storyboards',
  tts: 'step6-tts',
  bgm: 'step6-bgm',
  render: 'step6-render',
  step5: 'step5-videos',
  'step5-videos': 'step5-videos',
  'llm-completions': 'llm-completions',
  'image-generations': 'image-generations',
  'step4-storyboards': 'step4-storyboards',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireAdmin(req) {
  if (req.authUser?.role !== 'admin') {
    throw new HttpError(403, 'Only admins can change shared Agent configuration');
  }
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

function getUserId(req) {
  if (!req.authUser?.id) throw new HttpError(401, 'Please log in first');
  return sanitizeSegment(req.authUser.id, 'userId');
}

function getText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;
}

function createProjectSnapshot({ projectId, name, title, script, scriptType }) {
  const now = Date.now();
  const chapterId = createId('chapter');
  const normalizedTitle = getText(title, '第1集');
  const normalizedScriptType = getText(scriptType, 'annotated') === 'novel' ? 'novel' : 'annotated';
  return {
    version: 1,
    exportedAt: new Date(now).toISOString(),
    project: {
      id: projectId,
      name: getText(name, '未命名项目'),
      styleConfig: '',
      createdAt: now,
      allCharacterNames: [],
      characterProfiles: [],
      outfitTracking: [],
      propTracking: [],
      propInheritance: '',
      currentChapterId: chapterId,
      assetLibrary: [],
      characterVoiceReferences: [],
      step3Settings: {
        optimizeConcurrency: 5,
        generateConcurrency: 5,
        useVolcVirtualHumans: false,
      },
      chapters: [{
        id: chapterId,
        title: normalizedTitle,
        rawScript: getText(script),
        scriptType: normalizedScriptType,
        storyboardDuration: 15,
        episodeDuration: 120,
        adaptedScript: '',
        analysis: null,
        analysisSourceText: '',
        analysisIsStale: false,
        storyboards: [],
        step4OutputMode: 'storyboard-director',
        storyboardBoardMode: 'smart-shot-plan-landscape',
        storyboardBoardSmartPanelCount: 'auto',
        storyboardBoardSmartDurationCompressionEnabled: true,
        storyboardCameraSegmentCount: 'auto',
        storyboardBoardStyle: 'seedance-board',
        storyboardDirectorRunMode: 'fast',
        currentStoryboardIndex: 0,
        globalLastFrameInfo: '',
        itemTracker: {},
        autoGenerate: {
          running: false,
          currentIndex: -1,
          total: 0,
          doneCount: 0,
          errors: [],
          cancelled: false,
        },
        step1Task: { running: false },
        step3Task: { running: false, done: 0, total: 0, success: 0, failed: 0, failures: [] },
        status: 'idle',
        speakerVoiceOverrides: {},
        dubbingAnalysisLines: [],
        past: [],
        future: [],
      }],
    },
    blobs: {},
  };
}

function getChapter(snapshot, chapterId) {
  const chapters = Array.isArray(snapshot?.project?.chapters) ? snapshot.project.chapters : [];
  if (!chapterId) return chapters[0] || null;
  return chapters.find((chapter) => chapter?.id === chapterId) || null;
}

function getStoryboards(snapshot, chapterId) {
  const chapter = getChapter(snapshot, chapterId);
  return Array.isArray(chapter?.storyboards) ? chapter.storyboards : [];
}

function getRefinementStore(snapshot) {
  if (!Array.isArray(snapshot.agentRefinements)) snapshot.agentRefinements = [];
  return snapshot.agentRefinements;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function parseStoryboardIndex(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const index = Math.round(Number(value));
  if (!Number.isInteger(index) || index < 0) {
    throw new HttpError(400, 'storyboardIndex must be a non-negative integer');
  }
  return index;
}

function getAssetById(snapshot, assetId) {
  const targetId = getText(assetId);
  const assets = Array.isArray(snapshot?.project?.assetLibrary) ? snapshot.project.assetLibrary : [];
  return assets.find((asset) => getText(asset?.id) === targetId) || null;
}

const CHAPTER_REFINEMENT_FIELDS = new Set([
  'rawScript',
  'adaptedScript',
  'analysis',
  'styleConfig',
  'globalLastFrameInfo',
]);

const STORYBOARD_REFINEMENT_FIELDS = new Set([
  'storyboard',
  'prompt',
  'imagePrompt',
  'agentStoryboardDirectorBrief',
  'agentStoryboardBoardPlan',
  'agentStoryboardActionDirector',
  'seedanceFinalVideoPrompt',
  'seedanceFinalVideoPromptStatus',
  'lastFrameInfo',
  'continuityOutput',
  'videoImageRefs',
  'imageRefs',
]);

const ASSET_REFINEMENT_FIELDS = new Set([
  'name',
  'description',
  'optimizedPrompt',
  'type',
  'concept',
  'variantKey',
  'identityKey',
  'outfitSeq',
  'usedInStoryboards',
]);

function resolveRefinementTarget(snapshot, refinement) {
  const target = isPlainObject(refinement?.target) ? refinement.target : {};
  const scope = getText(target.scope).toLowerCase();
  if (scope === 'project') {
    const field = getText(target.field);
    if (!['styleConfig', 'allCharacterNames', 'characterProfiles', 'outfitTracking', 'propTracking', 'propInheritance'].includes(field)) {
      throw new HttpError(400, `Unsupported project refinement field: ${field || '(empty)'}`);
    }
    return { parent: snapshot.project, field, before: cloneJson(snapshot.project?.[field]) };
  }
  if (scope === 'chapter') {
    const chapter = getChapter(snapshot, sanitizeOptionalSegment(target.chapterId, 'chapterId'));
    if (!chapter) throw new HttpError(404, 'Chapter not found for refinement target');
    const field = getText(target.field);
    if (!CHAPTER_REFINEMENT_FIELDS.has(field)) {
      throw new HttpError(400, `Unsupported chapter refinement field: ${field || '(empty)'}`);
    }
    return { parent: chapter, field, before: cloneJson(chapter[field]) };
  }
  if (scope === 'storyboard') {
    const chapter = getChapter(snapshot, sanitizeOptionalSegment(target.chapterId, 'chapterId'));
    if (!chapter) throw new HttpError(404, 'Chapter not found for refinement target');
    const storyboardIndex = parseStoryboardIndex(target.storyboardIndex);
    if (storyboardIndex === undefined) throw new HttpError(400, 'storyboard refinement requires storyboardIndex');
    const storyboard = getStoryboards(snapshot, chapter.id)[storyboardIndex];
    if (!storyboard) throw new HttpError(404, 'Storyboard not found for refinement target');
    const field = getText(target.field);
    if (!STORYBOARD_REFINEMENT_FIELDS.has(field)) {
      throw new HttpError(400, `Unsupported storyboard refinement field: ${field || '(empty)'}`);
    }
    return { parent: storyboard, field, before: cloneJson(storyboard[field]) };
  }
  if (scope === 'asset') {
    const asset = getAssetById(snapshot, target.assetId);
    if (!asset) throw new HttpError(404, 'Asset not found for refinement target');
    const field = getText(target.field);
    if (!ASSET_REFINEMENT_FIELDS.has(field)) {
      throw new HttpError(400, `Unsupported asset refinement field: ${field || '(empty)'}`);
    }
    return { parent: asset, field, before: cloneJson(asset[field]) };
  }
  throw new HttpError(400, `Unsupported refinement scope: ${scope || '(empty)'}`);
}

function normalizeRefinementBody(body) {
  if (!isPlainObject(body)) throw new HttpError(400, 'Body must be a refinement object');
  if (!isPlainObject(body.target)) throw new HttpError(400, 'refinement.target is required');
  if (!Object.prototype.hasOwnProperty.call(body, 'proposedValue')) {
    throw new HttpError(400, 'refinement.proposedValue is required');
  }
  const riskLevel = getText(body.riskLevel).toLowerCase();
  return {
    title: getText(body.title, 'Agent refinement'),
    rationale: getText(body.rationale || body.reason),
    step: getText(body.step),
    target: {
      scope: getText(body.target.scope).toLowerCase(),
      chapterId: getText(body.target.chapterId),
      storyboardIndex: body.target.storyboardIndex,
      assetId: getText(body.target.assetId),
      field: getText(body.target.field),
    },
    proposedValue: cloneJson(body.proposedValue),
    riskLevel: ['low', 'medium', 'high'].includes(riskLevel) ? riskLevel : 'medium',
    notes: getText(body.notes),
  };
}

function asStatus(value) {
  return getText(value).toLowerCase();
}

function auditProjectSnapshot(snapshot) {
  const findings = [];
  const project = snapshot?.project;
  if (!isPlainObject(project)) {
    return [{ severity: 'error', code: 'project-missing', message: '项目快照缺少 project 对象。' }];
  }
  const chapters = Array.isArray(project.chapters) ? project.chapters : [];
  if (chapters.length === 0) {
    findings.push({ severity: 'error', code: 'chapters-missing', message: '项目没有章节。' });
  }
  if (!Array.isArray(project.assetLibrary) || project.assetLibrary.length === 0) {
    findings.push({ severity: 'warning', code: 'asset-library-empty', message: '项目参考图资产为空，Step3/Step4/Step5 可能无法继续。' });
  }

  for (const chapter of chapters) {
    const prefix = `${chapter.title || chapter.id || '未命名章节'}`;
    if (!getText(chapter.rawScript) && !getText(chapter.adaptedScript)) {
      findings.push({ severity: 'error', code: 'script-missing', chapterId: chapter.id, message: `${prefix} 缺少剧本文本。` });
    }
    if (!chapter.analysis) {
      findings.push({ severity: 'warning', code: 'analysis-missing', chapterId: chapter.id, message: `${prefix} 尚未完成 Step1 分析。` });
    }
    const storyboards = Array.isArray(chapter.storyboards) ? chapter.storyboards : [];
    if (storyboards.length === 0) {
      findings.push({ severity: 'warning', code: 'storyboards-missing', chapterId: chapter.id, message: `${prefix} 尚未生成分镜。` });
      continue;
    }
    storyboards.forEach((storyboard, index) => {
      const label = `分镜${String(index + 1).padStart(2, '0')}`;
      const boardStatus = asStatus(storyboard.status);
      const videoStatus = asStatus(storyboard.videoStatus);
      const seedanceStatus = asStatus(storyboard.seedanceFinalVideoPromptStatus);
      if (boardStatus === 'error' || boardStatus === 'failed') {
        findings.push({ severity: 'error', code: 'storyboard-error', chapterId: chapter.id, storyboardIndex: index, message: `${label} 故事板状态失败。` });
      }
      if (storyboard.error) {
        findings.push({ severity: 'error', code: 'storyboard-error-message', chapterId: chapter.id, storyboardIndex: index, message: `${label}: ${String(storyboard.error).slice(0, 240)}` });
      }
      if (chapter.step4OutputMode === 'storyboard-director' && seedanceStatus !== 'done') {
        findings.push({ severity: 'warning', code: 'seedance-prompt-missing', chapterId: chapter.id, storyboardIndex: index, message: `${label} 缺少 Seedance 最终提交词。` });
      }
      if (videoStatus === 'failed' || videoStatus === 'error') {
        findings.push({ severity: 'error', code: 'video-error', chapterId: chapter.id, storyboardIndex: index, message: `${label} 视频生成失败。` });
      }
      if (storyboard.videoImageRefs && Array.isArray(storyboard.videoImageRefs)) {
        const missing = storyboard.videoImageRefs.filter((ref) => !ref?.assetId && !ref?.blobKey && !ref?.url);
        if (missing.length > 0) {
          findings.push({ severity: 'error', code: 'image-ref-unresolved', chapterId: chapter.id, storyboardIndex: index, message: `${label} 有 ${missing.length} 个图片引用未绑定。` });
        }
      }
    });
  }
  return findings;
}

function normalizeJobType(body) {
  const raw = getText(body.type || body.step || body.kind).toLowerCase();
  const type = STEP_JOB_TYPE_MAP[raw] || raw;
  if (!SUPPORTED_AGENT_JOB_TYPES.has(type)) {
    throw new HttpError(
      400,
      `Unsupported Agent job type: ${raw || '(empty)'}. Supported: ${Array.from(SUPPORTED_AGENT_JOB_TYPES).join(', ')}`,
    );
  }
  return type;
}

function normalizeCreateJobBody(req, projectId) {
  const body = isPlainObject(req.body) ? req.body : {};
  const type = normalizeJobType(body);
  const chapterId = sanitizeOptionalSegment(body.chapterId, 'chapterId');
  const storyboardIndex = body.storyboardIndex === undefined ? undefined : Math.max(0, Math.round(Number(body.storyboardIndex) || 0));
  return {
    projectId,
    chapterId,
    storyboardIndex,
    type,
    priority: Number.isFinite(Number(body.priority)) ? Math.round(Number(body.priority)) : 10,
    maxAttempts: Number.isFinite(Number(body.maxAttempts)) ? Math.min(20, Math.max(1, Math.round(Number(body.maxAttempts)))) : 5,
    idempotencyKey: getText(body.idempotencyKey) || `agent:${type}:${projectId}:${chapterId || 'project'}:${storyboardIndex ?? 'all'}:${crypto.randomBytes(6).toString('hex')}`,
    input: isPlainObject(body.input) ? body.input : {},
    media: isPlainObject(body.media) ? body.media : {},
  };
}

function removeEmptySecrets(value) {
  if (!isPlainObject(value)) return value;
  const next = { ...value };
  Object.keys(next).forEach((key) => {
    if (/apiKey|licenseKey|secretKey|accessKey/i.test(key) && !getText(next[key])) {
      delete next[key];
    }
  });
  return next;
}

function mergeMissing(target, defaults) {
  const next = { ...(isPlainObject(target) ? target : {}) };
  Object.entries(defaults || {}).forEach(([key, value]) => {
    if (next[key] === undefined || next[key] === null || next[key] === '') {
      next[key] = value;
    }
  });
  return next;
}

function buildVideoJobDefaults(video = {}) {
  return {
    backend: video.backend,
    seedanceApiBase: video.seedanceCloudBaseUrl,
    seedanceCloudLicenseKey: video.seedanceCloudLicenseKey,
    xyqAgentBaseUrl: video.xyqAgentBaseUrl,
    xyqAgentAccessKey: video.xyqAgentAccessKey,
    hmapiApiKey: video.hmapiApiKey,
    hmapiModel: video.hmapiModel,
    volcBaseUrl: video.volcBaseUrl,
    volcApiKey: video.volcApiKey,
    volcModel: video.volcModel,
    aliyunApiKey: video.aliyunApiKey,
    aliyunModel: video.aliyunModel,
    aliyunRegion: video.aliyunRegion,
    timeoutMs: 7200 * 1000,
    pollIntervalMs: 30_000,
  };
}

function buildVideoItemDefaults(video = {}) {
  return {
    backend: video.backend,
    ratio: video.videoRatio,
    model: video.seedanceModel,
    resolution: video.videoResolution,
    duration: video.videoDuration,
    seedanceModel: video.seedanceModel,
    hmapiModel: video.hmapiModel,
    volcBaseUrl: video.volcBaseUrl,
    volcModel: video.volcModel,
    aliyunModel: video.aliyunModel,
  };
}

async function applyAgentDefaultsToJobInput(jobInput, userId) {
  const defaults = userId
    ? await getEffectiveAgentDefaultsForUser(userId)
    : await getEffectiveAgentDefaults();
  const input = { ...jobInput, input: { ...(jobInput.input || {}) } };

  if (input.type === 'llm-completions') {
    input.input.apiConfig = removeEmptySecrets(mergeMissing(input.input.apiConfig, defaults.llm));
    input.input.options = mergeMissing(input.input.options, {
      temperature: 0.7,
      maxTokens: 8000,
    });
  } else if (input.type === 'step1-analysis') {
    input.input.apiConfig = removeEmptySecrets(mergeMissing(input.input.apiConfig, defaults.llm));
    input.input.options = mergeMissing(input.input.options, {
      temperature: 0.7,
      maxTokens: 12000,
      reasoningEffort: 'high',
    });
  } else if (input.type === 'image-generations') {
    input.input.config = removeEmptySecrets(mergeMissing(input.input.config, defaults.image));
  } else if (input.type === 'step3-assets') {
    input.input.config = removeEmptySecrets(mergeMissing(input.input.config || input.input.imageConfig, defaults.image));
    input.input.mode = input.input.mode || 'generate';
    input.input.skipExisting = input.input.skipExisting !== false;
  } else if (input.type === 'step5-videos') {
    const video = defaults.video || {};
    input.input = removeEmptySecrets(mergeMissing(input.input, buildVideoJobDefaults(video)));
    if (Array.isArray(input.input.items)) {
      input.input.items = input.input.items.map((item) => removeEmptySecrets(mergeMissing(item, buildVideoItemDefaults(video))));
    }
  } else if (input.type === 'step4-storyboards') {
    input.input.apiConfig = removeEmptySecrets(mergeMissing(input.input.apiConfig, defaults.llm));
    input.input.frameRatio = input.input.frameRatio || '16:9';
  }

  return input;
}

function createAgentRouter({ rateLimit } = {}) {
  const router = express.Router();
  if (rateLimit) router.use(rateLimit);
  router.use(express.json({ limit: JSON_LIMIT }));

  router.get('/health', asyncRoute(async (req, res) => {
    res.json({
      ok: true,
      user: {
        id: req.authUser.id,
        email: req.authUser.email,
        role: req.authUser.role,
      },
      auth: {
        mode: req.agentKey ? 'agent-key' : 'cookie',
        agentKey: req.agentKey ? {
          id: req.agentKey.id,
          name: req.agentKey.name,
          keyPrefix: req.agentKey.keyPrefix,
          lastUsedAt: req.agentKey.lastUsedAt || null,
        } : null,
      },
      jobStore: getJobStoreDriver(),
      supportedJobTypes: Array.from(SUPPORTED_AGENT_JOB_TYPES),
      modes: {
        projectCloud: true,
        backgroundJobs: true,
        browserUiFallback: true,
      },
    });
  }));

  router.get('/config', asyncRoute(async (req, res) => {
    const [agentDefaults, storage, worker] = await Promise.all([
      getPublicUserAgentDefaults(getUserId(req)),
      getPublicObjectStorageConfig(),
      getPublicBackgroundWorkerConfig(),
    ]);
    res.json({ agentDefaults, storage, worker });
  }));

  router.put('/config/llm', asyncRoute(async (req, res) => {
    requireAdmin(req);
    res.json({ agentDefaults: await saveAgentDefaults('llm', req.body || {}) });
  }));

  router.put('/config/image', asyncRoute(async (req, res) => {
    requireAdmin(req);
    res.json({ agentDefaults: await saveAgentDefaults('image', req.body || {}) });
  }));

  router.put('/config/video', asyncRoute(async (req, res) => {
    requireAdmin(req);
    res.json({ agentDefaults: await saveAgentDefaults('video', req.body || {}) });
  }));

  router.put('/config/user/llm', asyncRoute(async (req, res) => {
    res.json({ agentDefaults: await saveUserAgentDefaults(getUserId(req), 'llm', req.body || {}) });
  }));

  router.put('/config/user/image', asyncRoute(async (req, res) => {
    res.json({ agentDefaults: await saveUserAgentDefaults(getUserId(req), 'image', req.body || {}) });
  }));

  router.put('/config/user/video', asyncRoute(async (req, res) => {
    res.json({ agentDefaults: await saveUserAgentDefaults(getUserId(req), 'video', req.body || {}) });
  }));

  router.put('/config/storage', asyncRoute(async (req, res) => {
    requireAdmin(req);
    res.json({ storage: await saveObjectStorageConfig(req.body || {}) });
  }));

  router.get('/projects', asyncRoute(async (req, res) => {
    res.json({ projects: await listCloudProjectsForUser(getUserId(req)) });
  }));

  router.post('/projects', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const body = req.body || {};
    const projectId = sanitizeOptionalSegment(body.projectId, 'projectId') || createId('project');
    const snapshot = createProjectSnapshot({
      projectId,
      name: body.name,
      title: body.title,
      script: body.script,
      scriptType: body.scriptType,
    });
    const metadata = await putCloudProjectSnapshot(userId, projectId, snapshot);
    res.status(201).json({ project: metadata, snapshot });
  }));

  router.get('/projects/:projectId', asyncRoute(async (req, res) => {
    const snapshot = await getCloudProjectSnapshot(getUserId(req), sanitizeSegment(req.params.projectId, 'projectId'));
    res.json(snapshot);
  }));

  router.put('/projects/:projectId', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    if (!isPlainObject(req.body) || !isPlainObject(req.body.project)) {
      throw new HttpError(400, 'Body must be a full project snapshot');
    }
    const metadata = await putCloudProjectSnapshot(userId, projectId, req.body);
    res.json({ project: metadata });
  }));

  router.put('/projects/:projectId/script', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    const snapshot = await getCloudProjectSnapshot(userId, projectId);
    const chapter = getChapter(snapshot, sanitizeOptionalSegment(req.body?.chapterId, 'chapterId'));
    if (!chapter) throw new HttpError(404, 'Chapter not found');
    chapter.rawScript = getText(req.body?.script);
    chapter.scriptType = getText(req.body?.scriptType, chapter.scriptType) === 'novel' ? 'novel' : 'annotated';
    if (getText(req.body?.title)) chapter.title = getText(req.body.title);
    chapter.analysisIsStale = !!chapter.analysis;
    snapshot.exportedAt = new Date().toISOString();
    const metadata = await putCloudProjectSnapshot(userId, projectId, snapshot);
    res.json({ project: metadata, chapter });
  }));

  router.post('/projects/:projectId/jobs', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    const input = await applyAgentDefaultsToJobInput(normalizeCreateJobBody(req, projectId), userId);
    const result = await createJob(userId, input);
    res.status(result.reused ? 200 : 201).json(result);
  }));

  router.get('/jobs', asyncRoute(async (req, res) => {
    res.json({ jobs: await listJobs(getUserId(req), req.query || {}) });
  }));

  router.get('/jobs/:jobId', asyncRoute(async (req, res) => {
    const job = await getJob(getUserId(req), req.params.jobId);
    if (!job) throw new HttpError(404, 'Background job not found');
    res.json({ job });
  }));

  router.get('/jobs/:jobId/events', asyncRoute(async (req, res) => {
    const events = await listJobEvents(getUserId(req), req.params.jobId, req.query || {});
    res.json({ events });
  }));

  router.post('/jobs/:jobId/retry', asyncRoute(async (req, res) => {
    const job = await retryJob(getUserId(req), req.params.jobId, getText(req.body?.reason, 'Agent requested retry'));
    res.json({ job });
  }));

  router.post('/jobs/:jobId/cancel', asyncRoute(async (req, res) => {
    const job = await cancelJob(getUserId(req), req.params.jobId, getText(req.body?.reason, 'Agent requested cancellation'));
    res.json({ job });
  }));

  router.post('/projects/:projectId/audit', asyncRoute(async (req, res) => {
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    const snapshot = await getCloudProjectSnapshot(getUserId(req), projectId);
    const findings = auditProjectSnapshot(snapshot);
    const errorCount = findings.filter((finding) => finding.severity === 'error').length;
    const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
    res.json({
      ok: errorCount === 0,
      summary: { errorCount, warningCount, findingCount: findings.length },
      findings,
    });
  }));

  router.get('/projects/:projectId/refinements', asyncRoute(async (req, res) => {
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    const snapshot = await getCloudProjectSnapshot(getUserId(req), projectId);
    const status = getText(req.query?.status).toLowerCase();
    const refinements = getRefinementStore(snapshot)
      .filter((item) => !status || getText(item.status).toLowerCase() === status);
    res.json({ refinements });
  }));

  router.post('/projects/:projectId/refinements', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    const snapshot = await getCloudProjectSnapshot(userId, projectId);
    const normalized = normalizeRefinementBody(req.body || {});
    const targetInfo = resolveRefinementTarget(snapshot, normalized);
    const now = new Date().toISOString();
    const refinement = {
      id: createId('refine'),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      createdBy: {
        userId,
        authMode: req.agentKey ? 'agent-key' : 'cookie',
        agentKeyId: req.agentKey?.id || null,
      },
      title: normalized.title,
      rationale: normalized.rationale,
      step: normalized.step,
      target: normalized.target,
      riskLevel: normalized.riskLevel,
      notes: normalized.notes,
      beforeValue: targetInfo.before,
      proposedValue: normalized.proposedValue,
    };
    getRefinementStore(snapshot).unshift(refinement);
    snapshot.exportedAt = now;
    await putCloudProjectSnapshot(userId, projectId, snapshot);
    res.status(201).json({ refinement });
  }));

  router.post('/projects/:projectId/refinements/:refinementId/apply', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    const refinementId = sanitizeSegment(req.params.refinementId, 'refinementId');
    const snapshot = await getCloudProjectSnapshot(userId, projectId);
    const refinement = getRefinementStore(snapshot).find((item) => getText(item.id) === refinementId);
    if (!refinement) throw new HttpError(404, 'Refinement not found');
    if (getText(refinement.status).toLowerCase() === 'applied') {
      res.json({ refinement, alreadyApplied: true });
      return;
    }
    if (getText(refinement.status).toLowerCase() === 'rejected') {
      throw new HttpError(409, 'Rejected refinement cannot be applied');
    }
    const targetInfo = resolveRefinementTarget(snapshot, refinement);
    if (req.body?.requireUnchanged !== false && JSON.stringify(targetInfo.before) !== JSON.stringify(refinement.beforeValue)) {
      throw new HttpError(409, 'Target has changed since refinement was created; review before applying');
    }
    targetInfo.parent[targetInfo.field] = cloneJson(refinement.proposedValue);
    const now = new Date().toISOString();
    refinement.status = 'applied';
    refinement.updatedAt = now;
    refinement.appliedAt = now;
    refinement.appliedBy = {
      userId,
      authMode: req.agentKey ? 'agent-key' : 'cookie',
      agentKeyId: req.agentKey?.id || null,
    };
    snapshot.exportedAt = now;
    await putCloudProjectSnapshot(userId, projectId, snapshot);
    res.json({ refinement });
  }));

  router.post('/projects/:projectId/refinements/:refinementId/reject', asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const projectId = sanitizeSegment(req.params.projectId, 'projectId');
    const refinementId = sanitizeSegment(req.params.refinementId, 'refinementId');
    const snapshot = await getCloudProjectSnapshot(userId, projectId);
    const refinement = getRefinementStore(snapshot).find((item) => getText(item.id) === refinementId);
    if (!refinement) throw new HttpError(404, 'Refinement not found');
    if (getText(refinement.status).toLowerCase() === 'applied') {
      throw new HttpError(409, 'Applied refinement cannot be rejected');
    }
    const now = new Date().toISOString();
    refinement.status = 'rejected';
    refinement.updatedAt = now;
    refinement.rejectedAt = now;
    refinement.rejectedReason = getText(req.body?.reason);
    snapshot.exportedAt = now;
    await putCloudProjectSnapshot(userId, projectId, snapshot);
    res.json({ refinement });
  }));

  router.use((error, _req, res, _next) => {
    const status = Number(error?.status || 500);
    if (status >= 500) {
      console.error('[agent-api] request failed', error);
    }
    res.status(status).json({
      error: status >= 500 ? 'Agent API request failed' : String(error.message || error),
    });
  });

  return router;
}

module.exports = {
  createAgentRouter,
};
