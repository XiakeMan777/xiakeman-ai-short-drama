import type { Dispatch, MutableRefObject } from 'react';
import type { Action } from '@/stores/projectStore';
import type { VideoApiConfig } from '@/types';
import {
  buildXyqAgentVideoMessage,
  submitXyqAgentRun,
  uploadXyqAgentAsset,
} from '@/lib/xyqAgentClient';

interface XyqAgentSubmitOptions {
  duration?: number;
}

function getImageReferenceFileName(blob: Blob, index: number) {
  const extension = blob.type === 'image/webp'
    ? 'webp'
    : blob.type === 'image/jpeg'
      ? 'jpg'
      : 'png';
  return `xyq-agent-reference-${String(index + 1).padStart(2, '0')}.${extension}`;
}

export async function submitXyqAgentVideo(
  index: number,
  prompt: string,
  blobs: Blob[],
  videoConfig: VideoApiConfig,
  chapterId: string,
  dispatchRef: MutableRefObject<Dispatch<Action>>,
  abortCtrl: AbortController,
  options: XyqAgentSubmitOptions = {},
): Promise<void> {
  if (!videoConfig.xyqAgentAccessKey?.trim()) {
    throw new Error('请先在视频模型设置中填写小云雀 Agent Access Key。');
  }

  dispatchRef.current({
    type: 'SUBMIT_VIDEO',
    index,
    taskId: 'xyqagent-pending',
    chapterId,
    backend: 'xyqagent',
    duration: options.duration ?? videoConfig.videoDuration,
    productionMode: 'normal',
  });

  const assetIds: string[] = [];
  for (let blobIndex = 0; blobIndex < blobs.length; blobIndex += 1) {
    const blob = blobs[blobIndex];
    const assetId = await uploadXyqAgentAsset(
      blob,
      videoConfig,
      getImageReferenceFileName(blob, blobIndex),
      abortCtrl.signal,
    );
    assetIds.push(assetId);
  }

  const message = buildXyqAgentVideoMessage(prompt, {
    ...videoConfig,
    videoDuration: options.duration ?? videoConfig.videoDuration,
  });
  const result = await submitXyqAgentRun(videoConfig, message, assetIds, abortCtrl.signal);
  if (abortCtrl.signal.aborted) return;

  dispatchRef.current({
    type: 'SUBMIT_VIDEO',
    index,
    taskId: result.taskId,
    clientTaskId: result.webThreadLink,
    chapterId,
    backend: 'xyqagent',
    duration: options.duration ?? videoConfig.videoDuration,
    productionMode: 'normal',
  });
}
