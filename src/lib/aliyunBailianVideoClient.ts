import type { VideoApiConfig } from '@/types';
import type { ProgressDetail } from '@/lib/videoPoller';
import { sleep } from '@/lib/async-utils';
import { ALIYUN_STATUS_LABELS, smoothVolcProgress } from '@/lib/videoStatusLabels';

const ALIYUN_API_BASE = '/api/aliyun';
const POLL_INTERVAL = 15_000;
const MAX_POLL_TIME = 120 * 60 * 1000;
const MAX_CONSECUTIVE_ERRORS = 3;
const SUBMIT_TIMEOUT_BASE = 120_000;
const SUBMIT_TIMEOUT_PER_IMAGE = 45_000;
const SUBMIT_TIMEOUT_MAX = 600_000;

const SUPPORTED_RATIOS = new Set(['16:9', '9:16', '3:4', '4:3', '4:5', '5:4', '1:1', '9:21', '21:9']);

export type AliyunBailianTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'expired' | 'unknown';

export interface AliyunBailianTaskResult {
  taskId: string;
  status: AliyunBailianTaskStatus;
  videoUrl: string | null;
  error: string | null;
  rawStatus?: string;
  usage?: unknown;
  errorDetail?: {
    errorCode?: string;
    errorMsg?: string;
    aliyunRequestId?: string;
  };
}

interface AliyunBailianTaskError extends Error {
  taskId?: string;
  errorDetail?: AliyunBailianTaskResult['errorDetail'];
}

function getSubmitTimeoutMs(imageCount: number): number {
  return Math.min(
    SUBMIT_TIMEOUT_MAX,
    SUBMIT_TIMEOUT_BASE + Math.max(0, imageCount) * SUBMIT_TIMEOUT_PER_IMAGE,
  );
}

export function getAliyunBailianApiBase() {
  return ALIYUN_API_BASE;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const reader = new FileReader();
  return new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function normalizeAliyunResolution(resolution?: VideoApiConfig['videoResolution']): '720P' | '1080P' {
  return resolution === '1080p' ? '1080P' : '720P';
}

function normalizeAliyunRatio(ratio?: string): string {
  const normalized = ratio?.trim() || '16:9';
  return SUPPORTED_RATIOS.has(normalized) ? normalized : '16:9';
}

function normalizeAliyunDuration(duration?: number): number {
  const value = Math.round(Number(duration) || 5);
  return Math.max(3, Math.min(15, value));
}

function normalizeAliyunSeed(seed?: string): number | undefined {
  const trimmed = seed?.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0 || value > 2147483647) {
    throw new Error('百炼 HappyHorse Seed 必须是 0~2147483647 之间的整数。');
  }
  return value;
}

export function buildAliyunHappyHorsePrompt(prompt: string, referenceCount: number): string {
  const replaceImageRef = (value: string, indexText: string) => {
    const index = Number(indexText);
    return Number.isInteger(index) && index >= 1 && index <= referenceCount
      ? `[Image ${index}]`
      : value;
  };

  const converted = prompt
    .replace(/@图片\s*([1-9])(?!\d)/g, replaceImageRef)
    .replace(/参考图片\s*([1-9])(?!\d)/g, replaceImageRef)
    .replace(/参考图\s*([1-9])(?!\d)/g, replaceImageRef)
    .replace(/图片\s*([1-9])(?!\d)/g, replaceImageRef);

  if (referenceCount <= 0) return converted;

  const hasAliyunImageToken = /\[Image\s+[1-9]\]/i.test(converted);
  const prefix = `参考图按 media 顺序编号为 ${Array.from({ length: referenceCount }, (_, index) => `[Image ${index + 1}]`).join('、')}。`;
  return hasAliyunImageToken
    ? `${prefix}\n${converted}`
    : `${prefix}\n请结合这些参考图生成视频。\n${converted}`;
}

function normalizeTaskStatus(status?: string): AliyunBailianTaskStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'PENDING':
      return 'queued';
    case 'RUNNING':
      return 'running';
    case 'SUCCEEDED':
      return 'succeeded';
    case 'FAILED':
      return 'failed';
    case 'CANCELED':
      return 'canceled';
    case 'UNKNOWN':
      return 'unknown';
    default:
      return 'unknown';
  }
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonText(text: string): JsonObject {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readNestedString(source: JsonObject, path: string[]): string | undefined {
  let current: unknown = source;
  for (const key of path) {
    if (!isJsonObject(current)) return undefined;
    current = current[key];
  }
  return typeof current === 'string' && current.trim() ? current : undefined;
}

function readAliyunError(data: JsonObject, fallback: string) {
  return readNestedString(data, ['output', 'message'])
    || readNestedString(data, ['output', 'error_message'])
    || readNestedString(data, ['message'])
    || readNestedString(data, ['error', 'message'])
    || fallback;
}

export async function aliyunBailianSubmitVideo(
  config: VideoApiConfig,
  prompt: string,
  imageBlobs: Blob[],
  options?: {
    duration?: number;
    ratio?: string;
    resolution?: VideoApiConfig['videoResolution'];
    signal?: AbortSignal;
  },
): Promise<{ taskId: string }> {
  if (!config.aliyunApiKey?.trim()) {
    throw new Error('请先在 API 设置中填写阿里云百炼 API Key。');
  }

  const imageUrls = await Promise.all(imageBlobs.slice(0, 9).map((blob) => blobToDataUrl(blob)));
  if (imageUrls.length === 0) {
    throw new Error('百炼 HappyHorse 至少需要 1 张参考图。');
  }

  const seed = normalizeAliyunSeed(config.aliyunSeed);
  const body: Record<string, unknown> = {
    model: config.aliyunModel || 'happyhorse-1.0-r2v',
    input: {
      prompt: buildAliyunHappyHorsePrompt(prompt, imageUrls.length),
      media: imageUrls.map((url) => ({
        type: 'reference_image',
        url,
      })),
    },
    parameters: {
      resolution: normalizeAliyunResolution(options?.resolution),
      ratio: normalizeAliyunRatio(options?.ratio),
      duration: normalizeAliyunDuration(options?.duration),
      watermark: config.aliyunWatermark === true,
      ...(seed !== undefined ? { seed } : {}),
    },
  };

  const controller = new AbortController();
  const submitTimeoutMs = getSubmitTimeoutMs(imageUrls.length);
  const timeoutId = window.setTimeout(() => controller.abort(), submitTimeoutMs);
  const abortFromOuterSignal = () => controller.abort();
  if (options?.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', abortFromOuterSignal, { once: true });
  }

  let resp: Response;
  try {
    resp = await fetch(`${getAliyunBailianApiBase()}/services/aigc/video-generation/video-synthesis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
        Authorization: `Bearer ${config.aliyunApiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      if (options?.signal?.aborted) {
        throw new DOMException('The user aborted a request.', 'AbortError');
      }
      throw new Error(`百炼 HappyHorse 提交超时（${Math.round(submitTimeoutMs / 1000)} 秒），请检查网络后重试。`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (options?.signal) options.signal.removeEventListener('abort', abortFromOuterSignal);
  }

  const text = await resp.text().catch(() => '');
  const data = parseJsonText(text);
  if (!resp.ok) {
    throw new Error(`百炼 HappyHorse API 提交失败 (${resp.status}): ${readAliyunError(data, text.slice(0, 200) || 'Unknown error')}`);
  }

  const output = isJsonObject(data.output) ? data.output : {};
  const taskId = output.task_id;
  if (!taskId || typeof taskId !== 'string') {
    throw new Error(`百炼 HappyHorse API 未返回任务 ID: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return { taskId };
}

export async function aliyunBailianPollTask(
  config: VideoApiConfig,
  taskId: string,
): Promise<AliyunBailianTaskResult> {
  if (!config.aliyunApiKey?.trim()) {
    throw new Error('请先在 API 设置中填写阿里云百炼 API Key。');
  }

  const resp = await fetch(`${getAliyunBailianApiBase()}/tasks/${taskId}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.aliyunApiKey}`,
    },
  });

  const text = await resp.text().catch(() => '');
  const data = parseJsonText(text);
  if (!resp.ok) {
    throw new Error(`百炼 HappyHorse API 查询失败 (${resp.status}): ${readAliyunError(data, text.slice(0, 200) || 'Unknown error')}`);
  }

  const output = isJsonObject(data.output) ? data.output : {};
  const rawStatus = String(output.task_status ?? 'UNKNOWN');
  const status = normalizeTaskStatus(rawStatus);
  const videoUrl = typeof output.video_url === 'string' && output.video_url.trim()
    ? output.video_url.trim()
    : null;
  const error = status === 'failed'
    ? readAliyunError(data, '视频生成失败')
    : null;

  return {
    taskId: typeof output.task_id === 'string' ? output.task_id : taskId,
    status,
    videoUrl,
    error,
    rawStatus,
    usage: data.usage ?? output.task_metrics,
    errorDetail: status === 'failed' ? {
      errorCode: typeof output.code === 'string' ? output.code : (typeof data.code === 'string' ? data.code : undefined),
      errorMsg: typeof output.message === 'string' ? output.message : (typeof data.message === 'string' ? data.message : undefined),
      aliyunRequestId: typeof data.request_id === 'string' ? data.request_id : undefined,
    } : undefined,
  };
}

export async function aliyunBailianGenerateVideo(
  config: VideoApiConfig,
  prompt: string,
  imageBlobs: Blob[],
  options?: {
    duration?: number;
    ratio?: string;
    resolution?: VideoApiConfig['videoResolution'];
    onProgress?: (detail: ProgressDetail) => void;
    onSubmitted?: (taskId: string) => void;
    signal?: AbortSignal;
  },
): Promise<string> {
  const { onProgress, onSubmitted, signal } = options || {};
  const { taskId } = await aliyunBailianSubmitVideo(config, prompt, imageBlobs, { ...options, signal });
  onSubmitted?.(taskId);

  const startTime = Date.now();
  let pollCount = 0;
  let consecutiveErrors = 0;

  while (true) {
    if (signal?.aborted) return '';
    if (Date.now() - startTime > MAX_POLL_TIME) {
      throw new Error('百炼 HappyHorse 视频生成超时（120 分钟）。');
    }

    try {
      pollCount += 1;
      const result = await aliyunBailianPollTask(config, taskId);
      consecutiveErrors = 0;

      const isSucceeded = result.status === 'succeeded';
      onProgress?.({
        progress: isSucceeded ? 100 : smoothVolcProgress(pollCount),
        isEstimated: !isSucceeded,
        statusLabel: ALIYUN_STATUS_LABELS[result.status] || result.status,
        backendRawStatus: result.rawStatus ?? result.status,
      });

      if (result.status === 'succeeded' && result.videoUrl) {
        return result.videoUrl;
      }

      if (result.status === 'succeeded') {
        throw new Error('百炼 HappyHorse 生成成功但未返回视频 URL。');
      }

      if (result.status === 'failed') {
        const error: AliyunBailianTaskError = new Error(result.error || '百炼 HappyHorse 视频生成失败。');
        error.taskId = result.taskId;
        error.errorDetail = result.errorDetail;
        throw error;
      }

      if (result.status === 'canceled') {
        const error: AliyunBailianTaskError = new Error('百炼 HappyHorse 任务已取消。');
        error.taskId = result.taskId;
        throw error;
      }

      await sleep(POLL_INTERVAL, signal);
    } catch (err) {
      if (err instanceof Error && (
        err.message.includes('百炼 HappyHorse 视频生成失败')
        || err.message.includes('任务已取消')
        || err.message.includes('未返回视频 URL')
      )) {
        throw err;
      }

      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw new Error(`连续 ${MAX_CONSECUTIVE_ERRORS} 次查询失败，请检查网络连接或百炼服务状态。`);
      }
      await sleep(POLL_INTERVAL, signal);
    }
  }
}
