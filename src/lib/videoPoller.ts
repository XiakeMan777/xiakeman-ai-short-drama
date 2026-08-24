import type { VideoApiConfig } from '@/types';
import { aliyunBailianPollTask, type AliyunBailianTaskResult } from '@/lib/aliyunBailianVideoClient';
import { hmPollTask, mapHmProgress, type HmTaskResult } from '@/lib/hmApiClient';
import { volcPollTask, type VolcTaskResult } from '@/lib/volcengineApiClient';
import { pollXyqAgentTask } from '@/lib/xyqAgentClient';
import { saveBlob } from '@/lib/imageStore';
import { sleep } from '@/lib/async-utils';
import { downloadValidatedVideoBlob } from '@/lib/videoBlobUtils';
import { isTrustedDirectVideoUrl } from '@/lib/trustedMedia';
import {
  appendSeedanceCloudAuthQuery,
  buildSeedanceFetchInit,
  getSeedanceApiBase,
  isSeedanceServiceBackend,
  LOCAL_SEEDANCE_API_BASE,
} from '@/lib/seedanceApi';
import {
  ALIYUN_STATUS_LABELS,
  HM_STATUS_LABELS,
  SEEDANCE_STATUS_LABELS,
  VOLC_STATUS_LABELS,
  smoothVolcProgress,
} from '@/lib/videoStatusLabels';

const SEEDANCE_API_BASE = LOCAL_SEEDANCE_API_BASE;

const DEFAULT_POLL_INTERVAL = 30_000;
const XYQ_AGENT_POLL_INTERVAL = 10_000;
const HM_POLL_INTERVAL = 5_000;
const ALIYUN_POLL_INTERVAL = 15_000;
const MAX_POLL_TIME = 120 * 60 * 1000;
const MAX_CONSECUTIVE_ERRORS = 3;

export interface ProgressDetail {
  progress: number;
  isEstimated: boolean;
  statusLabel: string;
  backendRawStatus?: string;
  progressText?: string;
}

export interface PollCallbacks {
  onProgress: (index: number, detail: ProgressDetail) => void;
  onComplete: (index: number, videoUrl: string, blobKey?: string) => void;
  onError: (index: number, error: string) => void;
}

function getPollInterval(backend: VideoApiConfig['backend']): number {
  if (backend === 'xyqagent') return XYQ_AGENT_POLL_INTERVAL;
  if (backend === 'aliyunbailian') return ALIYUN_POLL_INTERVAL;
  return backend === 'hmapi' ? HM_POLL_INTERVAL : DEFAULT_POLL_INTERVAL;
}

export async function pollVideoTask(
  taskId: string,
  index: number,
  config: VideoApiConfig,
  callbacks: PollCallbacks,
  options?: { seedanceApiBase?: string; maxPollTime?: number; signal?: AbortSignal },
): Promise<void> {
  const maxTime = options?.maxPollTime
    ?? (isSeedanceServiceBackend(config.backend) && config.seedanceTimeout
      ? config.seedanceTimeout * 1000
      : config.backend === 'xyqagent' && config.xyqAgentTimeout
        ? config.xyqAgentTimeout * 1000
        : MAX_POLL_TIME);
  const startTime = Date.now();
  const maxTimeMinutes = Math.round(maxTime / 60000);
  const pollInterval = getPollInterval(config.backend);
  let volcPollCount = 0;
  let consecutiveErrors = 0;

  while (true) {
    if (options?.signal?.aborted) return;

    if (Date.now() - startTime > maxTime) {
      callbacks.onError(index, `视频生成超时（${maxTimeMinutes} 分钟）。`);
      return;
    }

    try {
      if (config.backend === 'hmapi') {
        const result = await hmPollTask(config, taskId);
        consecutiveErrors = 0;

        callbacks.onProgress(index, buildHmProgressDetail(result));

        if (result.status === 'success' && result.resultUrls.length > 0) {
          const videoUrl = result.resultUrls[0];
          const blobKey = await fetchAndCacheBlob(videoUrl, true);
          callbacks.onComplete(index, videoUrl, blobKey ?? undefined);
          return;
        }

        if (result.status === 'success') {
          callbacks.onError(index, '视频生成成功但未返回视频 URL。');
          return;
        }

        if (result.status === 'failed') {
          callbacks.onError(index, result.failReason || '视频生成失败。');
          return;
        }
      } else if (config.backend === 'volcengine') {
        volcPollCount += 1;
        const result = await volcPollTask(config, taskId);
        consecutiveErrors = 0;

        callbacks.onProgress(index, buildVolcProgressDetail(result, volcPollCount));

        if (result.status === 'succeeded' && result.videoUrl) {
          const blobKey = await fetchAndCacheBlob(result.videoUrl, true);
          callbacks.onComplete(index, result.videoUrl, blobKey ?? undefined);
          return;
        }

        if (result.status === 'succeeded') {
          callbacks.onError(index, '视频生成成功但未返回视频 URL。');
          return;
        }

        if (result.status === 'failed') {
          callbacks.onError(index, result.error || '视频生成失败。');
          return;
        }

        if (result.status === 'canceled') {
          callbacks.onError(index, '视频生成任务已取消。');
          return;
        }

        if (result.status === 'expired') {
          callbacks.onError(index, '视频生成任务已过期，请重新提交。');
          return;
        }
      } else if (config.backend === 'aliyunbailian') {
        volcPollCount += 1;
        const result = await aliyunBailianPollTask(config, taskId);
        consecutiveErrors = 0;

        callbacks.onProgress(index, buildAliyunProgressDetail(result, volcPollCount));

        if (result.status === 'succeeded' && result.videoUrl) {
          const blobKey = await fetchAndCacheBlob(result.videoUrl, true);
          callbacks.onComplete(index, result.videoUrl, blobKey ?? undefined);
          return;
        }

        if (result.status === 'succeeded') {
          callbacks.onError(index, '百炼 HappyHorse 生成成功但未返回视频 URL。');
          return;
        }

        if (result.status === 'failed') {
          callbacks.onError(index, result.error || '百炼 HappyHorse 视频生成失败。');
          return;
        }

        if (result.status === 'canceled') {
          callbacks.onError(index, '百炼 HappyHorse 任务已取消。');
          return;
        }
      } else if (config.backend === 'xyqagent') {
        const result = await pollXyqAgentTask(taskId, config, options?.signal);
        consecutiveErrors = 0;

        callbacks.onProgress(index, {
          progress: result.progress,
          isEstimated: result.status !== 'success',
          statusLabel: result.status === 'success'
            ? '已完成'
            : result.status === 'failed'
              ? '已失败'
              : result.status === 'cancelled'
                ? '已取消'
                : (result.message ? result.message.slice(0, 80) : '小云雀 Agent 生成中'),
          backendRawStatus: String(result.rawState ?? result.status),
        });

        if (result.status === 'success' && result.videoUrl) {
          const blobKey = await fetchAndCacheBlob(result.videoUrl, true);
          callbacks.onComplete(index, result.videoUrl, blobKey ?? undefined);
          return;
        }

        if (result.status === 'success') {
          callbacks.onError(index, '小云雀 Agent 任务完成但未返回视频 URL。');
          return;
        }

        if (result.status === 'failed') {
          callbacks.onError(index, result.message || '小云雀 Agent 视频生成失败。');
          return;
        }

        if (result.status === 'cancelled') {
          callbacks.onError(index, '小云雀 Agent 任务已取消。');
          return;
        }
      } else {
        const seedanceBase = options?.seedanceApiBase ?? getSeedanceApiBase(config);
        const response = await fetch(`${seedanceBase}/task/${taskId}`, buildSeedanceFetchInit(config, {
          signal: options?.signal,
        }));
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        consecutiveErrors = 0;

        let task: Record<string, unknown>;
        try {
          task = await response.json();
        } catch {
          throw new Error(`Seedance 返回了非 JSON 响应（HTTP ${response.status}）。`);
        }

        const status = task.status as string;
        const progress = (task.progress as number) ?? 0;
        callbacks.onProgress(index, buildSeedanceProgressDetail(status, progress));

        if (status === 'success') {
          const returnedVideoUrl = typeof task.video_url === 'string' && task.video_url.trim()
            ? task.video_url.trim()
            : null;
          const videoUrl = returnedVideoUrl ?? appendSeedanceCloudAuthQuery(`${seedanceBase}/video/${taskId}`, config);
          const blobKey = await fetchAndCacheBlob(videoUrl, true);
          callbacks.onComplete(index, videoUrl, blobKey ?? undefined);
          return;
        }

        if (status === 'failed') {
          callbacks.onError(index, (task.error_message as string) || '视频生成失败。');
          return;
        }
      }

      await sleep(pollInterval, options?.signal);
    } catch {
      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        callbacks.onError(index, `连续 ${MAX_CONSECUTIVE_ERRORS} 次请求失败，请检查网络连接或稍后再试。`);
        return;
      }
      await sleep(pollInterval, options?.signal);
    }
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

function buildVolcProgressDetail(result: VolcTaskResult, pollCount: number): ProgressDetail {
  const isSucceeded = result.status === 'succeeded';
  return {
    progress: isSucceeded ? 100 : smoothVolcProgress(pollCount),
    isEstimated: !isSucceeded,
    statusLabel: VOLC_STATUS_LABELS[result.status] || result.status,
    backendRawStatus: result.status,
  };
}

function buildAliyunProgressDetail(result: AliyunBailianTaskResult, pollCount: number): ProgressDetail {
  const isSucceeded = result.status === 'succeeded';
  return {
    progress: isSucceeded ? 100 : smoothVolcProgress(pollCount),
    isEstimated: !isSucceeded,
    statusLabel: ALIYUN_STATUS_LABELS[result.status] || result.status,
    backendRawStatus: result.rawStatus ?? result.status,
  };
}

function buildSeedanceProgressDetail(status: string, progress: number): ProgressDetail {
  return {
    progress,
    isEstimated: false,
    statusLabel: SEEDANCE_STATUS_LABELS[status] || (progress > 0 && progress < 100 ? '生成中' : status),
    backendRawStatus: status,
  };
}

async function fetchAndCacheBlob(videoUrl: string, allowProxyFallback = false): Promise<string | null> {
  if (isTrustedDirectVideoUrl(videoUrl)) {
    return null;
  }

  try {
    const result = await downloadValidatedVideoBlob(videoUrl, { proxyFallback: allowProxyFallback });
    if (!result.ok || !result.blob) {
      if (import.meta.env.DEV && result.reason) {
        console.warn('[Step5] 轮询结果视频缓存失败，已回退远端结果：', result.reason);
      }
      return null;
    }
    return await saveBlob(result.blob);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[Step5] 轮询结果视频缓存异常，已回退远端结果：', error);
    }
    return null;
  }
}

export { DEFAULT_POLL_INTERVAL, HM_POLL_INTERVAL, ALIYUN_POLL_INTERVAL, MAX_POLL_TIME, SEEDANCE_API_BASE };
