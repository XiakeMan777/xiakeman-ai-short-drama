import type { Project, VideoApiConfig, VideoProductionMode } from '@/types';
import {
  createBackgroundJob,
  getBackgroundJob,
  getBackgroundJobsHealth,
  type BackgroundJob,
} from '@/lib/backgroundJobsClient';
import {
  ensureCloudProjectBlobsAvailable,
  getCloudHealth,
  uploadProjectToCloud,
} from '@/lib/cloudProjectStore';
import {
  buildSeedanceClientTaskId,
} from '@/lib/seedanceTaskClient';
import {
  getSeedanceApiBase,
  getSeedanceCloudLicenseKey,
  getSeedanceTransit9Resolution,
  isSeedanceCloudBackend,
  isSeedanceServiceBackend,
  normalizeSeedanceServiceDuration,
  normalizeSeedanceServiceModel,
} from '@/lib/seedanceApi';
import { formatVideoApiErrorMessage } from './videoErrorFormat';

export type Step5BackendMediaItem = {
  role: 'image' | 'audio' | 'reference_video';
  blobKey?: string;
  url?: string;
  fileName?: string;
  contentType?: string;
  characterName?: string;
};

export interface Step5BackendSubmitOptions {
  project: Project;
  chapterId: string;
  storyboardIndex: number;
  prompt: string;
  videoConfig: VideoApiConfig;
  duration: number;
  productionMode: VideoProductionMode;
  continuityGroupId?: string;
  continuityReason?: string;
  sourceTaskId?: string;
  sourceStoryboardIndex?: number;
  sourceBlobKey?: string;
  images: Step5BackendMediaItem[];
  audios?: Step5BackendMediaItem[];
  voiceReferenceCharacters?: string[];
}

export interface Step5BackendSubmitResult {
  job: BackgroundJob;
  clientTaskId: string;
  outputBlobKey: string;
}

export interface Step5BackendPollResult {
  videoUrl: string;
  blobKey?: string;
  providerTaskId?: string;
  clientTaskId?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms);
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const projectCloudSyncCache = new Map<string, {
  expiresAt: number;
  promise: Promise<unknown>;
}>();
let backendAvailabilityCache: {
  expiresAt: number;
  value: boolean;
} | null = null;

function collectStep5BackendBlobKeys(options: Step5BackendSubmitOptions): string[] {
  return [
    ...options.images.map((item) => item.blobKey),
    ...(options.audios ?? []).map((item) => item.blobKey),
    options.sourceBlobKey,
  ].filter((key): key is string => !!key?.trim());
}

function isCloudBlobAvailabilityError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Cloud blob not found|云端资源下载链接|云端同步缺少/i.test(message);
}

function formatCloudSyncPreflightError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = formatVideoApiErrorMessage(raw) || raw;
  if (/云端项目结构保存失败/i.test(raw)) {
    const detail = raw.replace(/^云端项目结构保存失败[:：]?\s*/i, '').trim();
    if (/401|登录|Unauthorized|请先登录/i.test(detail)) {
      return '云端同步失败：登录状态已失效，请重新登录后再生成视频。';
    }
    if (/413|larger than|payload|too large|150mb|请求体/i.test(detail)) {
      return '云端同步失败：当前项目结构过大，请先拆分项目或清理不必要的历史内容后再生成视频。';
    }
    return `云端同步暂时失败，已自动重试但仍未成功。请稍后重试当前视频任务；原始原因：${detail || normalized}`;
  }
  return normalized;
}

async function syncProjectToCloudForBackendJob(
  project: Project,
  options: { force?: boolean; requiredBlobKeys?: readonly string[] } = {},
): Promise<void> {
  const now = Date.now();
  const cached = projectCloudSyncCache.get(project.id);
  if (!options.force && cached && cached.expiresAt > now) {
    await cached.promise;
    if (options.requiredBlobKeys?.length) {
      await ensureCloudProjectBlobsAvailable(project.id, options.requiredBlobKeys);
    }
    return;
  }

  const requiredBlobKeys = options.requiredBlobKeys ?? [];
  const promise = uploadProjectToCloud(project, undefined, {
    failOnMissingBlobs: requiredBlobKeys.length > 0,
    requiredBlobKeys,
  });
  projectCloudSyncCache.set(project.id, {
    expiresAt: now + 5 * 60_000,
    promise,
  });
  try {
    await promise;
    if (options.requiredBlobKeys?.length) {
      await ensureCloudProjectBlobsAvailable(project.id, options.requiredBlobKeys);
    }
  } catch (error) {
    projectCloudSyncCache.delete(project.id);
    throw error;
  }
}

async function ensureBackendMediaReady(options: Step5BackendSubmitOptions): Promise<void> {
  const requiredBlobKeys = collectStep5BackendBlobKeys(options);
  try {
    await syncProjectToCloudForBackendJob(options.project, {
      force: false,
      requiredBlobKeys,
    });
  } catch (error) {
    throw new Error(formatCloudSyncPreflightError(error));
  }

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await ensureCloudProjectBlobsAvailable(options.project.id, requiredBlobKeys);
      return;
    } catch (error) {
      if (attempt >= 4 || !isCloudBlobAvailabilityError(error)) {
        throw new Error(formatCloudSyncPreflightError(error));
      }
      await sleep(2_000 * attempt);
      try {
        await syncProjectToCloudForBackendJob(options.project, {
          force: true,
          requiredBlobKeys,
        });
      } catch (syncError) {
        throw new Error(formatCloudSyncPreflightError(syncError));
      }
    }
  }
}

function getAbsoluteSeedanceApiBase(videoConfig: VideoApiConfig): string | undefined {
  const base = getSeedanceApiBase(videoConfig).trim();
  if (!base) return undefined;
  if (isSeedanceCloudBackend(videoConfig.backend) && base.startsWith('/')) {
    return undefined;
  }
  try {
    const parsed = new URL(base, window.location.origin);
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function getSeedanceBackend(videoConfig: VideoApiConfig) {
  return isSeedanceCloudBackend(videoConfig.backend) ? 'seedancecloud' : 'seedance';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getOutputItems(job: BackgroundJob): Array<Record<string, unknown>> {
  const output = asRecord(job.output);
  const items = output.items;
  return Array.isArray(items) ? items.map(asRecord) : [];
}

function getText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isTransientBackendPollError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch|NetworkError|Load failed|fetch failed|timeout|timed out|502|503|504/i.test(message);
}

export async function canUseStep5BackendVideoJobs(videoConfig: VideoApiConfig): Promise<boolean> {
  if (!isSeedanceServiceBackend(videoConfig.backend)) return false;
  if (backendAvailabilityCache && backendAvailabilityCache.expiresAt > Date.now()) {
    return backendAvailabilityCache.value;
  }

  try {
    const [jobsHealth, cloudHealth] = await Promise.all([
      getBackgroundJobsHealth(),
      getCloudHealth(),
    ]);
    const available = jobsHealth.ok === true
      && jobsHealth.postgresConfigured === true
      && cloudHealth.storage === 'postgres'
      && cloudHealth.directTransfer?.enabled === true;
    backendAvailabilityCache = {
      expiresAt: Date.now() + 60_000,
      value: available,
    };
    return available;
  } catch {
    backendAvailabilityCache = {
      expiresAt: Date.now() + 15_000,
      value: false,
    };
    return false;
  }
}

export async function canUseStep5BackgroundVideoJobs(videoConfig: VideoApiConfig): Promise<boolean> {
  if (videoConfig.useBackendVideoJobs === false) return false;
  if (!isSeedanceServiceBackend(videoConfig.backend)) return false;
  if (backendAvailabilityCache && backendAvailabilityCache.expiresAt > Date.now()) {
    return backendAvailabilityCache.value;
  }

  try {
    const [jobsHealth, cloudHealth] = await Promise.all([
      getBackgroundJobsHealth(),
      getCloudHealth(),
    ]);
    const available = jobsHealth.ok === true
      && jobsHealth.postgresConfigured === true
      && cloudHealth.storage === 'postgres'
      && cloudHealth.directTransfer?.enabled === true;
    backendAvailabilityCache = {
      expiresAt: Date.now() + 60_000,
      value: available,
    };
    return available;
  } catch {
    backendAvailabilityCache = {
      expiresAt: Date.now() + 15_000,
      value: false,
    };
    return false;
  }
}

export async function submitStep5BackendSeedanceJob(
  options: Step5BackendSubmitOptions,
): Promise<Step5BackendSubmitResult> {
  const clientTaskId = buildSeedanceClientTaskId(options.chapterId, options.storyboardIndex);
  const outputBlobKey = crypto.randomUUID();
  const apiBase = getAbsoluteSeedanceApiBase(options.videoConfig);
  const seedanceModel = isSeedanceCloudBackend(options.videoConfig.backend)
    ? normalizeSeedanceServiceModel(options.videoConfig.seedanceModel)
    : (options.videoConfig.seedanceModel || 'fast');
  const seedanceResolution = isSeedanceCloudBackend(options.videoConfig.backend)
    ? getSeedanceTransit9Resolution(seedanceModel, options.videoConfig.videoResolution)
    : undefined;

  await ensureBackendMediaReady(options);

  const media = {
    images: options.images.map((item) => ({
      role: 'image',
      blobKey: item.blobKey,
      url: item.url,
      fileName: item.fileName,
      contentType: item.contentType,
    })),
    audios: (options.audios ?? []).map((item) => ({
      role: 'audio',
      blobKey: item.blobKey,
      url: item.url,
      fileName: item.fileName,
      contentType: item.contentType,
      characterName: item.characterName,
    })),
    sourceVideo: options.productionMode === 'extend' && options.sourceBlobKey
      ? {
          role: 'reference_video',
          blobKey: options.sourceBlobKey,
          fileName: typeof options.sourceStoryboardIndex === 'number'
            ? `source-storyboard-${String(options.sourceStoryboardIndex + 1).padStart(2, '0')}.mp4`
            : 'source-storyboard-previous.mp4',
          contentType: 'video/mp4',
        }
      : undefined,
  };

  const { job } = await createBackgroundJob({
    type: 'step5-videos',
    projectId: options.project.id,
    chapterId: options.chapterId,
    storyboardIndex: options.storyboardIndex,
    priority: 20,
    maxAttempts: 5,
    idempotencyKey: `step5:${options.chapterId}:${options.storyboardIndex}:${clientTaskId}`,
    input: {
      backend: getSeedanceBackend(options.videoConfig),
      projectId: options.project.id,
      chapterId: options.chapterId,
      seedanceApiBase: apiBase,
      seedanceCloudLicenseKey: getSeedanceCloudLicenseKey(options.videoConfig),
      timeoutMs: Math.max(60, options.videoConfig.seedanceTimeout || 7200) * 1000,
      pollIntervalMs: 30_000,
      items: [{
        storyboardIndex: options.storyboardIndex,
        prompt: options.prompt,
        duration: normalizeSeedanceServiceDuration(options.duration),
        ratio: options.videoConfig.videoRatio,
        model: seedanceModel,
        resolution: seedanceResolution,
        clientTaskId,
        productionMode: options.productionMode,
        continuityGroupId: options.continuityGroupId,
        continuityReason: options.continuityReason,
        sourceTaskId: options.sourceTaskId,
        sourceStoryboardIndex: options.sourceStoryboardIndex,
        outputBlobKey,
        voiceReferenceCharacters: options.voiceReferenceCharacters,
        media,
      }],
    },
    media: {
      inputImageCount: options.images.length,
      inputAudioCount: options.audios?.length ?? 0,
      outputBlobKey,
    },
  });

  return { job, clientTaskId, outputBlobKey };
}

export async function pollStep5BackendJobUntilDone(
  jobId: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
    onProgress?: (job: BackgroundJob) => void;
  } = {},
): Promise<Step5BackendPollResult> {
  const timeoutMs = options.timeoutMs ?? 130 * 60_000;
  const intervalMs = options.intervalMs ?? 5000;
  const startedAt = Date.now();
  let latestJob: BackgroundJob | null = null;
  let consecutivePollErrors = 0;

  while (Date.now() - startedAt <= timeoutMs) {
    throwIfAborted(options.signal);
    let job: BackgroundJob;
    try {
      ({ job } = await getBackgroundJob(jobId));
      consecutivePollErrors = 0;
    } catch (error) {
      if (!isTransientBackendPollError(error) || consecutivePollErrors >= 8) throw error;
      consecutivePollErrors += 1;
      await sleepWithAbort(Math.min(30_000, intervalMs * consecutivePollErrors), options.signal);
      continue;
    }
    latestJob = job;
    options.onProgress?.(job);

    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      break;
    }
    await sleepWithAbort(intervalMs, options.signal);
  }

  if (!latestJob) throw new Error('后台视频任务未返回状态');
  if (latestJob.status !== 'succeeded') {
    const error = asRecord(latestJob.error);
    const rawMessage = getText(error.message) || getText(error.error);
    throw new Error(formatVideoApiErrorMessage(rawMessage) || rawMessage || '后台视频任务生成失败');
  }

  const item = getOutputItems(latestJob)[0];
  const videoUrl = getText(item.videoUrl);
  if (!videoUrl) throw new Error('后台视频任务完成但没有返回视频地址');

  return {
    videoUrl,
    blobKey: getText(item.videoBlobKey) || undefined,
    providerTaskId: getText(item.providerTaskId || item.taskId) || undefined,
    clientTaskId: getText(item.clientTaskId) || undefined,
  };
}
