import type { Dispatch, MutableRefObject } from 'react';
import type { Action } from '@/stores/projectStore';
import type { VideoApiConfig } from '@/types';
import { aliyunBailianGenerateVideo } from '@/lib/aliyunBailianVideoClient';
import { normalizeFrameRatio } from '@/lib/frameRatio';
import { cacheVideoBlob } from './videoUtils';
import { formatVideoApiErrorMessage } from './videoErrorFormat';

interface AliyunSubmitError {
  taskId?: string;
  errorDetail?: {
    errorCode?: string;
    errorMsg?: string;
    aliyunRequestId?: string;
  };
}

interface AliyunSubmitOptions {
  duration?: number;
}

export async function submitAliyunBailianVideo(
  index: number,
  prompt: string,
  blobs: Blob[],
  videoConfig: VideoApiConfig,
  chapterId: string,
  dispatchRef: MutableRefObject<Dispatch<Action>>,
  abortCtrl: AbortController,
  options: AliyunSubmitOptions = {},
): Promise<void> {
  dispatchRef.current({
    type: 'SUBMIT_VIDEO',
    index,
    taskId: 'aliyun-pending',
    chapterId,
    backend: 'aliyunbailian',
    duration: options.duration ?? videoConfig.videoDuration,
    productionMode: 'normal',
  });

  try {
    const videoUrl = await aliyunBailianGenerateVideo(
      videoConfig,
      prompt,
      blobs,
      {
        duration: options.duration ?? videoConfig.videoDuration,
        ratio: normalizeFrameRatio(videoConfig.videoRatio),
        resolution: videoConfig.videoResolution === '4k' ? '1080p' : videoConfig.videoResolution ?? '720p',
        onProgress: (detail) => {
          dispatchRef.current({
            type: 'UPDATE_VIDEO_PROGRESS',
            index,
            progress: detail.progress,
            status: 'polling',
            statusDetail: detail.statusLabel,
            progressIsEstimated: detail.isEstimated,
            chapterId,
          });
        },
        onSubmitted: (taskId) => {
          dispatchRef.current({
            type: 'UPDATE_VIDEO_PROGRESS',
            index,
            progress: 0,
            status: 'polling',
            statusDetail: '已提交',
            taskId,
            chapterId,
          });
        },
        signal: abortCtrl.signal,
      },
    );
    if (abortCtrl.signal.aborted) return;
    await cacheVideoBlob(videoUrl, index, chapterId, dispatchRef.current);
  } catch (err) {
    if (abortCtrl.signal.aborted) return;
    buildAliyunBailianError(index, prompt, err, chapterId, dispatchRef.current);
  }
}

export function buildAliyunBailianError(
  index: number,
  prompt: string,
  err: unknown,
  chapterId: string,
  dispatch: Dispatch<Action>,
) {
  const rawMsg = err instanceof Error ? err.message : String(err);
  const msg = formatVideoApiErrorMessage(rawMsg) ?? rawMsg;
  const aliyunError = typeof err === 'object' && err !== null ? err as AliyunSubmitError : undefined;
  const taskId = aliyunError?.taskId;
  const errorDetail = aliyunError?.errorDetail;

  dispatch({
    type: 'SET_VIDEO_ERROR',
    index,
    error: msg,
    errorDetail: {
      backend: 'aliyunbailian',
      taskId,
      prompt: prompt.slice(0, 200),
      rawError: rawMsg,
      errorCode: errorDetail?.errorCode,
      errorMsg: formatVideoApiErrorMessage(errorDetail?.errorMsg) ?? errorDetail?.errorMsg ?? msg,
      aliyunRequestId: errorDetail?.aliyunRequestId,
    },
    chapterId,
  });
}
