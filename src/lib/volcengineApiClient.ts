// ============================================================
// 火山方舟 Seedance 2.0 官方 API 客户端
// 文档: https://www.volcengine.com/docs/82379/1520757
// ============================================================

import type { VideoApiConfig } from '@/types';
import type { ProgressDetail } from '@/lib/videoPoller';
import { sleep } from '@/lib/async-utils';
import { VOLC_STATUS_LABELS, smoothVolcProgress } from '@/lib/videoStatusLabels';

const POLL_INTERVAL = 30000; // 30秒轮询间隔
const MAX_POLL_TIME = 120 * 60 * 1000; // 120分钟超时
const MAX_CONSECUTIVE_ERRORS = 3; // 连续错误上限（30s间隔×3=90s容忍）
const VOLC_SUBMIT_TIMEOUT_BASE = 120_000; // 基础提交超时 120 秒
const VOLC_SUBMIT_TIMEOUT_PER_IMAGE = 45_000; // 每张参考图额外增加 45 秒
const VOLC_SUBMIT_TIMEOUT_PER_VIDEO = 90_000; // 每个参考视频额外增加 90 秒
const VOLC_SUBMIT_TIMEOUT_PER_AUDIO = 30_000; // 每个参考音频额外增加 30 秒
const VOLC_SUBMIT_TIMEOUT_MAX = 600_000; // 提交超时上限 10 分钟
export const DEFAULT_VOLC_API_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
const VOLC_PROXY_BASE = '/api/volc';

export function normalizeVolcApiBaseUrl(value?: string): string {
  const trimmed = value?.trim().replace(/\/+$/, '');
  return trimmed || DEFAULT_VOLC_API_BASE;
}

/** 生成唯一的 request_id 用于幂等提交 */
function generateRequestId(): string {
  return `xiakeman-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getVolcSubmitTimeoutMs(imageCount: number, videoCount = 0, audioCount = 0): number {
  return Math.min(
    VOLC_SUBMIT_TIMEOUT_MAX,
    VOLC_SUBMIT_TIMEOUT_BASE
      + Math.max(0, imageCount) * VOLC_SUBMIT_TIMEOUT_PER_IMAGE
      + Math.max(0, videoCount) * VOLC_SUBMIT_TIMEOUT_PER_VIDEO
      + Math.max(0, audioCount) * VOLC_SUBMIT_TIMEOUT_PER_AUDIO,
  );
}

/** 获取代理 base URL（开发环境走 Vite 代理，生产环境走 nginx 代理） */
export function shouldUseDirectVolcApi(hostname?: string): boolean {
  const targetHostname = hostname
    ?? (typeof window !== 'undefined' ? window.location.hostname : '');
  return /(^|\.)xiakeman\.com$/i.test(targetHostname);
}

/** 获取火山接口 base URL：线上正式域名直连火山，开发环境与其他域名走代理 */
export function getVolcApiBase(
  config?: Pick<VideoApiConfig, 'volcBaseUrl'>,
  hostname?: string,
): string {
  const configuredBase = normalizeVolcApiBaseUrl(config?.volcBaseUrl);
  if (configuredBase !== DEFAULT_VOLC_API_BASE) return configuredBase;
  return shouldUseDirectVolcApi(hostname) ? DEFAULT_VOLC_API_BASE : VOLC_PROXY_BASE;
}

/** 火山方舟任务状态 */
export type VolcTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'expired' | 'canceled';

export interface VolcTaskResult {
  taskId: string;
  status: VolcTaskStatus;
  videoUrl: string | null;
  error: string | null;
  usage?: {
    completion_tokens: number;
    total_tokens: number;
  };
  // 火山官方错误详情（status === 'failed' 时填充）
  errorDetail?: {
    errorCode?: string;
    errorMsg?: string;
    volcCode?: string;
    volcMessage?: string;
  };
}

interface VolcTaskError extends Error {
  taskId?: string;
  errorDetail?: VolcTaskResult['errorDetail'];
}

/** 火山方舟 content item 类型 */
interface VolcContentItem {
  type: 'text' | 'image_url' | 'video_url' | 'audio_url';
  text?: string;
  image_url?: { url: string };
  video_url?: { url: string };
  audio_url?: { url: string };
  role?: 'reference_image' | 'reference_video' | 'reference_audio';
}

export type VolcReferenceImageInput =
  | { blob: Blob; url?: never }
  | { url: string; blob?: never };

export interface VolcReferenceVideoInput {
  url: string;
}

export interface VolcReferenceAudioInput {
  url: string;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const reader = new FileReader();
  return new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function buildOrderedReferenceImages(
  imageBlobs: Blob[],
  imageUrls: string[],
  referenceImages?: VolcReferenceImageInput[],
): VolcReferenceImageInput[] {
  if (referenceImages && referenceImages.length > 0) {
    return referenceImages.slice(0, 9);
  }

  return [
    ...imageBlobs.map((blob) => ({ blob })),
    ...imageUrls.map((url) => ({ url })),
  ].slice(0, 9);
}

function normalizeReferenceUrl(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function uniqueReferenceUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    const normalized = normalizeReferenceUrl(url);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function buildOrderedReferenceVideos(options?: {
  videoUrl?: string;
  videoUrls?: string[];
  referenceVideos?: VolcReferenceVideoInput[];
}): VolcReferenceVideoInput[] {
  const source = options?.referenceVideos?.length
    ? options.referenceVideos.map((item) => item.url)
    : options?.videoUrls?.length
      ? options.videoUrls
      : options?.videoUrl
        ? [options.videoUrl]
        : [];
  const urls = uniqueReferenceUrls(source);
  if (urls.length > 3) {
    throw new Error(`火山方舟 reference_video 最多支持 3 个，当前传入 ${urls.length} 个。请减少视频参考数量后重试。`);
  }
  return urls.map((url) => ({ url }));
}

function buildOrderedReferenceAudios(options?: {
  audioUrl?: string;
  audioUrls?: string[];
  referenceAudios?: VolcReferenceAudioInput[];
}): VolcReferenceAudioInput[] {
  const source = options?.referenceAudios?.length
    ? options.referenceAudios.map((item) => item.url)
    : options?.audioUrls?.length
      ? options.audioUrls
      : options?.audioUrl
        ? [options.audioUrl]
        : [];
  const urls = uniqueReferenceUrls(source);
  if (urls.length > 3) {
    throw new Error(`火山方舟 reference_audio 最多支持 3 个，当前传入 ${urls.length} 个。请减少音频参考数量后重试。`);
  }
  return urls.map((url) => ({ url }));
}

/** 火山方舟 - 提交视频生成任务 */
export async function volcSubmitVideo(
  config: VideoApiConfig,
  prompt: string,
  imageBlobs: Blob[],
  options?: {
    duration?: number;   // 4~15 秒，默认 10
    ratio?: string;      // 宽高比，默认 '9:16'
    resolution?: '480p' | '720p' | '1080p';  // 分辨率，默认 720p
    generateAudio?: boolean; // 是否生成音频
    /** 参考视频 URL（可选） */
    videoUrl?: string;
    /** 多个参考视频 URL（可选，最多3个） */
    videoUrls?: string[];
    /** 按提示词编号排序的统一参考视频列表（可选，最多3个） */
    referenceVideos?: VolcReferenceVideoInput[];
    /** 参考音频 URL（可选） */
    audioUrl?: string;
    /** 多个参考音频 URL（可选，最多3个） */
    audioUrls?: string[];
    /** 按提示词编号排序的统一参考音频列表（可选，最多3个） */
    referenceAudios?: VolcReferenceAudioInput[];
    /** 官方或远程参考图 URL，例如 asset://asset-xxxx */
    imageUrls?: string[];
    /** 按提示词编号排序的统一参考图列表；用于混合本地 Blob 和官方/远程 URL 时保持顺序 */
    referenceImages?: VolcReferenceImageInput[];
    /** 幂等请求 ID（可选） */
    requestId?: string;
    /** 外部取消信号（可选） */
    signal?: AbortSignal;
  },
): Promise<{ taskId: string }> {
  const baseUrl = getVolcApiBase(config);
  const { duration = 10, ratio = '9:16', resolution = '720p', generateAudio = config.volcGenerateAudio, imageUrls = [], referenceImages, requestId, signal } = options || {};
  const orderedReferenceImages = buildOrderedReferenceImages(imageBlobs, imageUrls, referenceImages);
  const orderedReferenceVideos = buildOrderedReferenceVideos(options);
  const orderedReferenceAudios = buildOrderedReferenceAudios(options);

  const content: VolcContentItem[] = [];

  // 文本提示词
  content.push({
    type: 'text',
    text: prompt,
  });

  // 参考图片（按提示词编号顺序提交，最多9张）
  for (const referenceImage of orderedReferenceImages) {
    const url = referenceImage.url ?? await blobToDataUrl(referenceImage.blob);
    content.push({
      type: 'image_url',
      image_url: { url },
      role: 'reference_image',
    });
  }

  // 参考视频（可选，按提示词中的“视频1/视频2/视频3”顺序提交）
  for (const referenceVideo of orderedReferenceVideos) {
    content.push({
      type: 'video_url',
      video_url: { url: referenceVideo.url },
      role: 'reference_video',
    });
  }

  // 参考音频（可选，按提示词中的“音频1/音频2/音频3”顺序提交）
  for (const referenceAudio of orderedReferenceAudios) {
    content.push({
      type: 'audio_url',
      audio_url: { url: referenceAudio.url },
      role: 'reference_audio',
    });
  }

  const body: Record<string, unknown> = {
    model: config.volcModel,
    content,
    ratio,
    duration,
    resolution,
    watermark: false,
  };

  // 幂等请求 ID（避免网络重试导致重复提交）
  if (requestId) {
    body.request_id = requestId;
  }

  // 只有明确开启才传 generate_audio
  if (generateAudio) {
    body.generate_audio = true;
  }

  const controller = new AbortController();
  const submitTimeoutMs = getVolcSubmitTimeoutMs(
    orderedReferenceImages.length,
    orderedReferenceVideos.length,
    orderedReferenceAudios.length,
  );
  const timeoutId = window.setTimeout(() => controller.abort(), submitTimeoutMs);
  const abortFromOuterSignal = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abortFromOuterSignal, { once: true });
  }

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/contents/generations/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.volcApiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      if (signal?.aborted) {
        throw new DOMException('The user aborted a request.', 'AbortError');
      }
      throw new Error(`火山方舟提交超时（>${Math.round(submitTimeoutMs / 1000)}秒），请检查网络后重试`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', abortFromOuterSignal);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => 'Unknown error');
    let errMsg = `火山方舟 API 提交失败 (${resp.status})`;
    try {
      const errJson = JSON.parse(errText);
      errMsg = `火山方舟: ${errJson.error?.message || errJson.message || errText.slice(0, 200)}`;
    } catch {
      errMsg = `火山方舟 API 提交失败 (${resp.status}): ${errText.slice(0, 200)}`;
    }
    throw new Error(errMsg);
  }

  const result = await resp.json();

  if (!result.id) {
    throw new Error(`火山方舟 API 未返回任务 ID: ${JSON.stringify(result).slice(0, 200)}`);
  }

  return { taskId: result.id as string };
}

/** 火山方舟 - 查询视频生成任务 */
export async function volcPollTask(
  config: VideoApiConfig,
  taskId: string,
): Promise<VolcTaskResult> {
  const baseUrl = getVolcApiBase(config);

  const resp = await fetch(`${baseUrl}/contents/generations/tasks/${taskId}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.volcApiKey}`,
    },
  });

  if (!resp.ok) {
    throw new Error(`火山方舟 API 查询失败 (${resp.status})`);
  }

  const data = await resp.json();

  const rawStatus = (data.status ?? 'queued') as string;
  const status = rawStatus === 'pending'
    ? 'queued'
    : rawStatus === 'processing'
      ? 'running'
      : rawStatus as VolcTaskStatus;
  const videoUrl = data.content?.video_url ?? null;
  // 优先使用 status_msg（官方字段），其次 error_message
  const error = status === 'failed' ? (data.status_msg || data.error_message || '视频生成失败') : null;

  return {
    taskId: data.id ?? taskId,
    status,
    videoUrl,
    error,
    usage: data.usage ?? undefined,
    // 火山官方错误详情（仅失败时填充）
    errorDetail: status === 'failed' ? {
      errorCode: data.error_code,
      errorMsg: data.status_msg || data.error_message,
      volcCode: data.code,
      volcMessage: data.message,
    } : undefined,
  };
}

/** 火山方舟 - 完整流程：提交 + 轮询，返回视频 URL */
export async function volcResolveCompletedVideoUrl(
  config: VideoApiConfig,
  taskId: string,
  fallbackVideoUrl?: string,
): Promise<string | null> {
  const result = await volcPollTask(config, taskId);

  if (result.status === 'succeeded') {
    return result.videoUrl ?? fallbackVideoUrl ?? null;
  }

  if (result.status === 'queued' || result.status === 'running') {
    return null;
  }

  if (result.status === 'failed') {
    throw new Error(result.error || '火山引擎视频生成失败');
  }

  if (result.status === 'canceled') {
    throw new Error('火山引擎任务已取消，无法重新下载结果');
  }

  if (result.status === 'expired') {
    throw new Error('火山引擎任务结果已过期，请重新生成');
  }

  return fallbackVideoUrl ?? null;
}

export async function volcGenerateVideo(
  config: VideoApiConfig,
  prompt: string,
  imageBlobs: Blob[],
  options?: {
    duration?: number;
    ratio?: string;
    resolution?: '480p' | '720p' | '1080p';
    generateAudio?: boolean;
    videoUrl?: string;
    videoUrls?: string[];
    referenceVideos?: VolcReferenceVideoInput[];
    audioUrl?: string;
    audioUrls?: string[];
    referenceAudios?: VolcReferenceAudioInput[];
    imageUrls?: string[];
    referenceImages?: VolcReferenceImageInput[];
    onProgress?: (detail: ProgressDetail) => void;
    /** 提交成功后回调，携带真实 taskId */
    onSubmitted?: (taskId: string) => void;
    /** AbortSignal 支持取消轮询 */
    signal?: AbortSignal;
    /** 幂等请求 ID（可选） */
    requestId?: string;
  },
): Promise<string> {
  const { onProgress, onSubmitted, signal } = options || {};

  // 生成幂等 request_id（避免网络重试导致重复计费）
  const requestId = options?.requestId ?? generateRequestId();

  // 1. 提交任务
  const { taskId } = await volcSubmitVideo(config, prompt, imageBlobs, { ...options, requestId, signal });

  if (import.meta.env.DEV) console.log(`[Volcengine] 任务已提交: ${taskId}, request_id: ${requestId}`);

  // 回调真实 taskId
  onSubmitted?.(taskId);

  // 2. 轮询结果
  const startTime = Date.now();
  let pollCount = 0;
  let consecutiveErrors = 0;

  while (true) {
    if (signal?.aborted) return '';
    if (Date.now() - startTime > MAX_POLL_TIME) {
      throw new Error('视频生成超时（120分钟）');
    }

    try {
      pollCount++;
      const result = await volcPollTask(config, taskId);
      consecutiveErrors = 0;

      if (import.meta.env.DEV) {
        console.log(`[Volcengine] 任务 ${taskId}: ${result.status}`);
      }

      // 映射进度
      const isSucceeded = result.status === 'succeeded';
      const progress = isSucceeded ? 100 : smoothVolcProgress(pollCount);
      const statusLabel = VOLC_STATUS_LABELS[result.status] || result.status;
      onProgress?.({
        progress,
        isEstimated: !isSucceeded,
        statusLabel,
        backendRawStatus: result.status,
      });

      if (result.status === 'succeeded' && result.videoUrl) {
        return result.videoUrl;
      }

      if (result.status === 'succeeded' && !result.videoUrl) {
        throw new Error('视频生成成功但未返回 URL');
      }

      if (result.status === 'failed') {
        const error: VolcTaskError = new Error(result.error || '火山方舟视频生成失败');
        error.taskId = result.taskId;
        error.errorDetail = result.errorDetail;
        throw error;
      }

      if (result.status === 'canceled') {
        const error: VolcTaskError = new Error('视频生成任务被取消');
        error.taskId = result.taskId;
        throw error;
      }

      if (result.status === 'expired') {
        const error: VolcTaskError = new Error('视频生成任务已过期（超时未处理），请重新提交');
        error.taskId = result.taskId;
        throw error;
      }

      // 继续轮询
      await sleep(POLL_INTERVAL, signal);
    } catch (err) {
      // 如果是明确的失败，直接抛出
      if (err instanceof Error && (
        err.message.includes('火山方舟视频生成失败') ||
        err.message.includes('任务被取消') ||
        err.message.includes('未返回 URL')
      )) {
        throw err;
      }
      // 网络错误等，计数并继续
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw new Error(`连续 ${MAX_CONSECUTIVE_ERRORS} 次请求失败，请检查网络连接或火山方舟服务`);
      }
      if (import.meta.env.DEV) console.warn(`[Volcengine] 轮询出错 (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, err);
      await sleep(POLL_INTERVAL, signal);
    }
  }
}

/** 取消或删除火山引擎视频生成任务 */
export async function volcCancelTask(
  config: VideoApiConfig,
  taskId: string,
): Promise<{ success: boolean; message: string }> {
  const baseUrl = getVolcApiBase(config);

  try {
    const resp = await fetch(`${baseUrl}/contents/generations/tasks/${taskId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.volcApiKey}`,
      },
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'Unknown error');
      return { success: false, message: `取消失败 (${resp.status}): ${errText.slice(0, 200)}` };
    }

    return { success: true, message: '任务已删除' };
  } catch (err) {
    return { success: false, message: `取消出错: ${err instanceof Error ? err.message : String(err)}` };
  }
}
