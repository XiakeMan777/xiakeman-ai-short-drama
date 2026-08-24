import type { Dispatch } from 'react';
import { saveBlob } from '@/lib/imageStore';
import { downloadValidatedVideoBlob } from '@/lib/videoBlobUtils';
import type { StoryboardState, VideoBackendType } from '@/types';
import type { Action } from '@/stores/projectStore';
import { formatVideoApiErrorMessage, parseVideoApiError } from './videoErrorFormat';

export interface CacheVideoBlobResult {
  mode: 'cached' | 'remote-url-only';
  blobKey?: string;
  reason?: string;
}

export function estimateRemainingTime(current: number, total: number, startTime: number): string {
  if (current <= 0) return '计算中...';
  const elapsed = (Date.now() - startTime) / 1000;
  const avgTime = elapsed / current;
  const remaining = (total - current) * avgTime;
  if (remaining < 60) return `约 ${Math.ceil(remaining)} 秒`;
  if (remaining < 3600) return `约 ${Math.ceil(remaining / 60)} 分钟`;
  return `约 ${(remaining / 3600).toFixed(1)} 小时`;
}

export function formatElapsed(startTime: number): string {
  const sec = Math.floor((Date.now() - startTime) / 1000);
  if (sec < 60) return `${sec}秒`;
  const min = Math.floor(sec / 60);
  const remainSec = sec % 60;
  if (min < 60) return `${min}分${remainSec > 0 ? `${remainSec}秒` : ''}`;
  return `${Math.floor(min / 60)}时${min % 60}分`;
}

export function formatVideoDuration(
  submittedAt: number | null | undefined,
  completedAt: number | null | undefined,
): string | null {
  if (!submittedAt) return null;
  const end = completedAt ?? Date.now();
  const sec = Math.floor((end - submittedAt) / 1000);
  if (sec < 60) return `${sec}秒`;
  const min = Math.floor(sec / 60);
  const remainSec = sec % 60;
  if (min < 60) return `${min}分${remainSec > 0 ? `${remainSec}秒` : ''}`;
  return `${Math.floor(min / 60)}时${min % 60}分`;
}

export function buildErrorDetail(
  backend: string,
  opts: { taskId?: string; prompt?: string; rawError?: string },
): StoryboardState['videoErrorDetail'] {
  const parsed = parseVideoApiError(opts.rawError);
  const readableError = formatVideoApiErrorMessage(parsed.message || parsed.detail);
  return {
    backend,
    taskId: opts.taskId,
    submittedAt: Date.now(),
    prompt: opts.prompt ? opts.prompt.slice(0, 200) : undefined,
    rawError: opts.rawError,
    httpStatus: parsed.httpStatus,
    errorCode: parsed.code,
    errorMsg: readableError ?? parsed.message ?? parsed.detail,
  };
}

export async function cacheVideoBlob(
  videoUrl: string,
  index: number,
  chapterId: string,
  dispatch: Dispatch<Action>,
  options: {
    completedAt?: number;
    taskId?: string;
    clientTaskId?: string;
    backend?: VideoBackendType;
    submittedAt?: number;
    duration?: number;
  } = {},
): Promise<CacheVideoBlobResult> {
  const downloadResult = await downloadValidatedVideoBlob(videoUrl, { proxyFallback: true });

  if (!downloadResult.ok || !downloadResult.blob) {
      if (import.meta.env.DEV) {
        console.warn('[Step5] 视频缓存失败，回退远端结果：', downloadResult.reason ?? 'unknown');
      }
      if (downloadResult.status && downloadResult.status >= 400) {
        dispatch({
          type: 'SET_VIDEO_ERROR',
          index,
          chapterId,
          error: downloadResult.reason ?? '远端视频地址不可用',
          errorDetail: buildErrorDetail('video', { rawError: downloadResult.reason }),
        });
        return {
          mode: 'remote-url-only',
          reason: downloadResult.reason ?? '视频远端地址不可用',
        };
      }
      dispatch({ type: 'SET_VIDEO_COMPLETE', index, videoUrl, chapterId, ...options });
      return {
      mode: 'remote-url-only',
      reason: downloadResult.reason ?? '视频下载或校验失败',
    };
  }

  try {
    const blobKey = await saveBlob(downloadResult.blob);
    dispatch({ type: 'SET_VIDEO_COMPLETE', index, videoUrl, blobKey, chapterId, ...options });
    return { mode: 'cached', blobKey };
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[Step5] 视频保存到本地缓存失败，回退远端结果：', error);
    }
    dispatch({ type: 'SET_VIDEO_COMPLETE', index, videoUrl, chapterId, ...options });
    return {
      mode: 'remote-url-only',
      reason: error instanceof Error ? error.message : '本地缓存保存失败',
    };
  }
}

export function getVideoState(sb: StoryboardState) {
  return {
    status: (sb.videoStatus ?? 'idle') as 'idle' | 'submitting' | 'polling' | 'done' | 'failed',
    progress: sb.videoProgress ?? 0,
    progressIsEstimated: sb.videoProgressIsEstimated ?? false,
    statusDetail: sb.videoStatusDetail ?? null,
    submittedAt: sb.videoSubmittedAt ?? null,
    completedAt: sb.videoCompletedAt ?? null,
    videoUrl: sb.videoUrl ?? null,
    videoBlobKey: sb.videoBlobKey ?? null,
    error: formatVideoApiErrorMessage(sb.videoError) ?? sb.videoError ?? null,
    errorDetail: sb.videoErrorDetail ?? null,
    taskId: sb.videoTaskId ?? null,
    clientTaskId: sb.videoClientTaskId ?? null,
  };
}
