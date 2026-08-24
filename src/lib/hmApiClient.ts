import type { VideoApiConfig } from '@/types';
import type { ProgressDetail } from '@/lib/videoPoller';
import { sleep } from '@/lib/async-utils';
import { HM_STATUS_LABELS } from '@/lib/videoStatusLabels';

const HM_API_BASE = '/api/hm';
export const HM_POLL_INTERVAL = 5_000;
const MAX_POLL_TIME = 120 * 60 * 1000;
const HM_SUBMIT_TIMEOUT = 120_000;
const MAX_CONSECUTIVE_ERRORS = 3;

export interface HmMaterialDesc {
  type: 'image';
  name: string;
}

export type HmTaskStatus =
  | 'pending'
  | 'submitted'
  | 'generating'
  | 'post_processing'
  | 'finalizing'
  | 'success'
  | 'failed';

export interface HmTaskResult {
  taskId: string;
  status: HmTaskStatus;
  progress: number;
  progressText: string;
  resultUrls: string[];
  failReason: string;
}

interface HmApiErrorInfo {
  code?: string;
  detail?: string;
  message: string;
  retryable: boolean;
}

class HmApiError extends Error {
  status: number;
  code?: string;
  retryable: boolean;

  constructor(message: string, status: number, code?: string, retryable = false) {
    super(message);
    this.name = 'HmApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function mapHmModelName(model: string | undefined): string {
  switch (model) {
    case 'jimeng-video-seedance-2.0':
      return 'HM-Video-SD2.0';
    case 'jimeng-video-seedance-2.0-fast':
      return 'HM-Video-SD2.0Fast';
    default:
      return model || 'HM-Video-SD2.0Fast';
  }
}

function mergeAbortSignals(signal?: AbortSignal, timeoutMs = HM_SUBMIT_TIMEOUT): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  return AbortSignal.any([signal, timeoutSignal]);
}

function parseHmApiErrorPayload(errorText: string): { code?: string; detail?: string } {
  if (!errorText) return {};

  try {
    const json = JSON.parse(errorText) as Record<string, unknown>;
    const code = typeof json.code === 'string' ? json.code : undefined;
    const detail = [
      typeof json.message === 'string' ? json.message : undefined,
      typeof json.error === 'string' ? json.error : undefined,
      typeof json.detail === 'string' ? json.detail : undefined,
    ].find(Boolean);
    return { code, detail };
  } catch {
    return { detail: errorText.slice(0, 200) };
  }
}

function formatHmApiErrorMessage(baseMessage: string, detail?: string): string {
  if (!detail) return baseMessage;
  const normalizedDetail = detail.trim();
  if (!normalizedDetail || baseMessage.includes(normalizedDetail)) return baseMessage;
  return `${baseMessage}（${normalizedDetail}）`;
}

function buildHmApiErrorInfo(status: number, errorText: string): HmApiErrorInfo {
  const { code, detail } = parseHmApiErrorPayload(errorText);

  if (status === 400) {
    return {
      code,
      detail,
      message: formatHmApiErrorMessage('HM 参数错误，请检查模型、时长、画幅或参考素材配置。', detail),
      retryable: false,
    };
  }

  if (status === 401) {
    return {
      code,
      detail,
      message: formatHmApiErrorMessage('HM API Key 无效、已过期或已禁用。', detail),
      retryable: false,
    };
  }

  if (status === 402) {
    return {
      code,
      detail,
      message: formatHmApiErrorMessage('HM 账户余额不足，请充值后再试。', detail),
      retryable: false,
    };
  }

  if (status === 429) {
    if (code === 'GENERATING_LIMIT') {
      return {
        code,
        detail,
        message: formatHmApiErrorMessage('HM 当前生成中的任务数已达上限，请等待已有任务完成后再试。', detail),
        retryable: true,
      };
    }

    return {
      code,
      detail,
      message: formatHmApiErrorMessage('HM 请求过于频繁，请稍后重试。', detail),
      retryable: true,
    };
  }

  if (status === 500) {
    return {
      code,
      detail,
      message: formatHmApiErrorMessage('HM 官方服务内部错误，请稍后重试。', detail),
      retryable: true,
    };
  }

  if (status === 503) {
    return {
      code,
      detail,
      message: formatHmApiErrorMessage('HM 官方服务繁忙，请稍后重试。', detail),
      retryable: true,
    };
  }

  return {
    code,
    detail,
    message: formatHmApiErrorMessage(`HM API 请求失败（${status}）`, detail),
    retryable: false,
  };
}

export function buildHmApiErrorMessage(status: number, errorText: string): string {
  return buildHmApiErrorInfo(status, errorText).message;
}

function toHmApiError(status: number, errorText: string): HmApiError {
  const info = buildHmApiErrorInfo(status, errorText);
  return new HmApiError(info.message, status, info.code, info.retryable);
}

function isTerminalHmError(error: unknown): boolean {
  if (error instanceof HmApiError) {
    return !error.retryable;
  }

  if (!(error instanceof Error)) return false;

  return [
    'HM 视频生成失败',
    'HM 视频生成成功但未返回视频 URL',
    'HM 视频生成超时',
    'HM API 提交成功但未返回任务号',
  ].some((fragment) => error.message.includes(fragment));
}

export function getHmApiBase(): string {
  return HM_API_BASE;
}

export async function hmSubmitVideo(
  config: VideoApiConfig,
  prompt: string,
  imageBlobs: Blob[],
  options?: {
    duration?: number;
    ratio?: string;
    materialNames?: string[];
    signal?: AbortSignal;
  },
): Promise<{ taskId: string }> {
  const { duration = 10, ratio = '9:16', materialNames, signal } = options || {};

  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('model', mapHmModelName(config.hmapiModel));
  formData.append('ratio', ratio);
  formData.append('duration', String(duration));
  formData.append('channel', 'official');

  const hasNamedMaterials = !!materialNames?.length;
  if (imageBlobs.length > 0) {
    if (hasNamedMaterials) {
      formData.append('function_mode', 'omni_reference');
      const materials: HmMaterialDesc[] = imageBlobs.slice(0, 9).map((_, index) => ({
        type: 'image',
        name: materialNames?.[index] || `参考图片${index + 1}`,
      }));
      formData.append('materials', JSON.stringify(materials));
      for (let index = 0; index < imageBlobs.length && index < 9; index += 1) {
        formData.append(`image_file_${index + 1}`, imageBlobs[index], `reference_${index + 1}.png`);
      }
    } else if (imageBlobs.length === 1) {
      formData.append('first_frame', imageBlobs[0], 'reference.png');
    } else {
      formData.append('function_mode', 'omni_reference');
      const materials: HmMaterialDesc[] = imageBlobs.slice(0, 9).map((_, index) => ({
        type: 'image',
        name: `参考图片${index + 1}`,
      }));
      formData.append('materials', JSON.stringify(materials));
      for (let index = 0; index < imageBlobs.length && index < 9; index += 1) {
        formData.append(`image_file_${index + 1}`, imageBlobs[index], `reference_${index + 1}.png`);
      }
    }
  }

  const response = await fetch(`${getHmApiBase()}/v1/videos/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.hmapiApiKey}`,
    },
    body: formData,
    signal: mergeAbortSignals(signal),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw toHmApiError(response.status, errorText);
  }

  const result = await response.json();
  if (!result.task_id) {
    throw new Error(`HM API 提交成功但未返回任务号：${JSON.stringify(result).slice(0, 200)}`);
  }

  return { taskId: result.task_id as string };
}

export async function hmPollTask(
  config: VideoApiConfig,
  taskId: string,
): Promise<HmTaskResult> {
  const response = await fetch(`${getHmApiBase()}/v1/tasks/${taskId}`, {
    headers: {
      Authorization: `Bearer ${config.hmapiApiKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw toHmApiError(response.status, errorText);
  }

  const data = await response.json();
  return {
    taskId: data.task_id ?? taskId,
    status: (data.status ?? 'pending') as HmTaskStatus,
    progress: data.progress_pct ?? 0,
    progressText: data.progress_text ?? '',
    resultUrls: data.result_urls ?? [],
    failReason: data.fail_reason ?? '',
  };
}

export async function hmGenerateVideo(
  config: VideoApiConfig,
  prompt: string,
  imageBlobs: Blob[],
  options?: {
    duration?: number;
    ratio?: string;
    materialNames?: string[];
    onSubmitting?: (detail: ProgressDetail) => void;
    onProgress?: (detail: ProgressDetail) => void;
    onSubmitted?: (taskId: string) => void;
    signal?: AbortSignal;
  },
): Promise<string> {
  const { onSubmitting, onProgress, onSubmitted, signal } = options || {};

  onSubmitting?.({
    progress: 8,
    isEstimated: true,
    statusLabel: '正在上传参考图到 HM...',
  });
  const { taskId } = await hmSubmitVideo(config, prompt, imageBlobs, options);
  onSubmitting?.({
    progress: 12,
    isEstimated: true,
    statusLabel: '已拿到任务号，准备开始轮询...',
  });
  onSubmitted?.(taskId);

  const startedAt = Date.now();
  let consecutiveErrors = 0;

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('The user aborted a request.', 'AbortError');
    }
    if (Date.now() - startedAt > MAX_POLL_TIME) {
      throw new Error('HM 视频生成超时（120 分钟），请稍后重试。');
    }

    try {
      const result = await hmPollTask(config, taskId);
      consecutiveErrors = 0;
      onProgress?.(buildHmProgressDetail(result));

      if (result.status === 'success' && result.resultUrls.length > 0) {
        return result.resultUrls[0];
      }
      if (result.status === 'success') {
        throw new Error('HM 视频生成成功但未返回视频 URL。');
      }
      if (result.status === 'failed') {
        throw new Error(result.failReason || 'HM 视频生成失败。');
      }

      await sleep(HM_POLL_INTERVAL, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      if (isTerminalHmError(error)) {
        throw error;
      }

      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw new Error(`连续 ${MAX_CONSECUTIVE_ERRORS} 次请求失败，请检查网络连接或稍后再试。`);
      }
      await sleep(HM_POLL_INTERVAL, signal);
    }
  }
}

export async function hmQueryBalance(config: VideoApiConfig): Promise<Record<string, unknown>> {
  const response = await fetch(`${getHmApiBase()}/v1/balance`, {
    headers: {
      Authorization: `Bearer ${config.hmapiApiKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw toHmApiError(response.status, errorText);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

export function mapHmProgress(result: HmTaskResult): number {
  if (result.progress > 0) return result.progress;

  switch (result.status) {
    case 'pending':
      return 5;
    case 'submitted':
      return 10;
    case 'generating':
      return 35;
    case 'post_processing':
      return 75;
    case 'finalizing':
      return 90;
    case 'success':
      return 100;
    default:
      return 0;
  }
}

function buildHmProgressDetail(result: HmTaskResult): ProgressDetail {
  return {
    progress: mapHmProgress(result),
    isEstimated: result.progress <= 0,
    statusLabel: result.progressText || HM_STATUS_LABELS[result.status] || result.status,
    backendRawStatus: result.status,
    progressText: result.progressText || undefined,
  };
}
