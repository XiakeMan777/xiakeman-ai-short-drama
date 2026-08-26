// ============================================================
// Step5: 火山方舟 提交策略（C1: 从 useVideoSubmit 拆分）
// ============================================================

import { volcGenerateVideo } from '@/lib/volcengineApiClient';
import type {
  VolcReferenceAudioInput,
  VolcReferenceImageInput,
  VolcReferenceVideoInput,
} from '@/lib/volcengineApiClient';
import { cacheVideoBlob } from './videoUtils';
import { normalizeFrameRatio } from '@/lib/frameRatio';
import { getVolcVideoModelCapabilities } from '@/lib/volcengineVideoModels';
import type { VideoApiConfig, VideoProductionMode } from '@/types';
import type { Action } from '@/stores/projectStore';
import type { Dispatch } from 'react';
import { formatVideoApiErrorMessage } from './videoErrorFormat';

interface VolcSubmitError {
  taskId?: string;
  errorDetail?: {
    errorCode?: string;
    errorMsg?: string;
    volcCode?: string;
    volcMessage?: string;
  };
}

interface VolcSubmitOptions {
  duration?: number;
  referenceImages?: VolcReferenceImageInput[];
  referenceVideos?: VolcReferenceVideoInput[];
  referenceAudios?: VolcReferenceAudioInput[];
  productionMode?: VideoProductionMode;
  continuityGroupId?: string;
  continuityReason?: string;
  sourceVideoUrl?: string;
  sourceVideoUrls?: string[];
  sourceTaskId?: string;
  sourceStoryboardIndex?: number;
  sourceBlobKey?: string;
}

export async function submitVolcVideo(
  index: number,
  prompt: string,
  blobs: Blob[],
  imageUrls: string[],
  videoConfig: VideoApiConfig,
  chapterId: string,
  dispatchRef: React.MutableRefObject<Dispatch<Action>>,
  abortCtrl: AbortController,
  options?: VolcSubmitOptions,
): Promise<void> {
  const isExtend = options?.productionMode === 'extend';
  const volcCapabilities = getVolcVideoModelCapabilities(videoConfig.volcModel);
  const referenceVideos = options?.referenceVideos
    ?? options?.sourceVideoUrls?.map((url) => ({ url }))
    ?? (options?.sourceVideoUrl ? [{ url: options.sourceVideoUrl }] : undefined);
  if (isExtend && (!referenceVideos || referenceVideos.length === 0)) {
    throw new Error('火山方舟全能参考多参模式缺少上一镜远程 video_url，已停止提交，避免退回普通生成。请先确认上一镜结果仍可恢复远程地址，或重新生成上一镜。');
  }

  const submitMetadata = {
    productionMode: options?.productionMode ?? 'normal',
    continuityGroupId: options?.continuityGroupId,
    continuityReason: options?.continuityReason,
    extendSourceIndex: options?.sourceStoryboardIndex,
    extendSourceTaskId: options?.sourceTaskId,
    extendSourceBlobKey: options?.sourceBlobKey,
    extendSubmittedAsExtend: isExtend ? true : undefined,
  };

  dispatchRef.current({
    type: 'SUBMIT_VIDEO',
    index,
    taskId: 'volc-pending',
    chapterId,
    backend: 'volcengine',
    duration: options?.duration ?? videoConfig.videoDuration,
    ...submitMetadata,
  });

  try {
    const volcResolution = videoConfig.videoResolution === '4k'
      ? '1080p'
      : videoConfig.videoResolution ?? '720p';
    const videoUrl = await volcGenerateVideo(
      videoConfig,
      prompt,
      blobs,
      {
        duration: options?.duration ?? videoConfig.videoDuration,
        ratio: volcCapabilities.isSeedance25 && isExtend
          ? 'adaptive'
          : normalizeFrameRatio(videoConfig.videoRatio),
        resolution: volcResolution,
        generateAudio: videoConfig.volcGenerateAudio,
        imageUrls,
        referenceImages: options?.referenceImages,
        referenceVideos,
        referenceAudios: options?.referenceAudios,
        omniReferenceTaskType: volcCapabilities.isSeedance25
          ? (isExtend ? 'extend' : 'reference')
          : undefined,
        outputFormat: volcCapabilities.isSeedance25 ? 'mp4' : undefined,
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
    buildVolcError(index, prompt, err, chapterId, dispatchRef.current);
  }
}

export function buildVolcError(index: number, prompt: string, err: unknown, chapterId: string, dispatch: Dispatch<Action>) {
  const rawMsg = err instanceof Error ? err.message : String(err);
  const msg = formatVideoApiErrorMessage(rawMsg) ?? rawMsg;
  const volcError = typeof err === 'object' && err !== null ? err as VolcSubmitError : undefined;
  const taskId = volcError?.taskId;
  const errorDetail = volcError?.errorDetail;

  dispatch({
    type: 'SET_VIDEO_ERROR',
    index,
    error: msg,
    errorDetail: {
      backend: 'volcengine',
      taskId,
      prompt: prompt.slice(0, 200),
      rawError: rawMsg,
      errorCode: errorDetail?.errorCode,
      errorMsg: formatVideoApiErrorMessage(errorDetail?.errorMsg) ?? errorDetail?.errorMsg ?? msg,
      volcCode: errorDetail?.volcCode,
      volcMessage: formatVideoApiErrorMessage(errorDetail?.volcMessage) ?? errorDetail?.volcMessage,
    },
    chapterId,
  });
}
