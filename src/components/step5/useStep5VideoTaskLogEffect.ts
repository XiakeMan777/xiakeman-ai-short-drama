import { useEffect, useRef } from 'react';
import type { AppState, StoryboardState, VideoBackendType } from '@/types';
import {
  saveStep5VideoTaskLogSnapshot,
  type Step5VideoTaskLogSnapshot,
  type Step5VideoTaskLogStatus,
} from '@/lib/step5VideoTaskLog';
import { getStoryboardVideoImageRefs } from './videoImageRefs';

function shortHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function trimPreview(value: string | undefined, maxLength = 220) {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function isPendingTaskId(taskId: string | undefined) {
  return !!taskId && taskId.endsWith('-pending');
}

function isPollInterruptedError(error: string | undefined) {
  const text = error?.toLowerCase() ?? '';
  if (!text) return false;
  return /连续\s*\d+\s*次.*(?:请求|查询)失败/.test(text)
    || text.includes('failed to fetch')
    || text.includes('network')
    || text.includes('网络')
    || text.includes('轮询')
    || text.includes('查询失败')
    || text.includes('页面关闭时任务仍在生成中')
    || text.includes('生成超时');
}

function resolveLogStatus(storyboard: StoryboardState): Step5VideoTaskLogStatus | null {
  const status = storyboard.videoStatus;
  if (status === 'submitting') {
    return isPendingTaskId(storyboard.videoTaskId) ? 'submitting' : 'submitted';
  }
  if (status === 'polling') return 'polling';
  if (status === 'done') return storyboard.videoUrl && !storyboard.videoBlobKey ? 'succeeded_remote' : 'done';
  if (status === 'failed') {
    return storyboard.videoTaskId && isPollInterruptedError(storyboard.videoError)
      ? 'poll_interrupted'
      : 'failed';
  }
  if ((status === 'idle' || !status) && storyboard.videoTaskId) return 'poll_interrupted';
  return null;
}

function getEventLabel(status: Step5VideoTaskLogStatus) {
  switch (status) {
    case 'submitting':
      return '提交中';
    case 'submitted':
      return '已拿到任务号';
    case 'polling':
      return '轮询中';
    case 'poll_interrupted':
      return '轮询中断，可恢复';
    case 'succeeded_remote':
      return '远端成功，本地未缓存';
    case 'done':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

function getPromptText(storyboard: StoryboardState) {
  return storyboard.videoSubmitPromptOverride?.trim()
    || storyboard.seedanceFinalVideoPrompt?.trim()
    || storyboard.prompt?.rawText?.trim()
    || storyboard.correctedScript?.trim()
    || storyboard.storyboard?.name
    || '';
}

function getReferenceSignature(storyboard: StoryboardState) {
  const refs = getStoryboardVideoImageRefs(storyboard);
  const refSignature = refs.map((ref) => [
    ref.refId,
    ref.type,
    ref.name,
    ref.assetId,
    ref.trackingId,
    ref.variantKey,
    ref.outfitSeq,
  ].filter(Boolean).join(':')).join('|');
  const boardMode = storyboard.storyboardBoard?.selectedMode;
  const boardVariant = boardMode ? storyboard.storyboardBoard?.variants?.[boardMode] : undefined;
  return [
    refSignature,
    storyboard.scenePositionBoard?.cleanBlobKey,
    storyboard.scenePositionBoard?.markedBlobKey,
    boardVariant?.blobKey,
    boardVariant?.lightweightBlobKey,
  ].filter(Boolean).join('|');
}

function buildAttemptKey(storyboard: StoryboardState, fallback: string) {
  if (storyboard.videoClientTaskId) return `client:${storyboard.videoClientTaskId}`;
  if (storyboard.videoSubmittedAt) return `submitted:${storyboard.videoSubmittedAt}`;
  if (storyboard.videoTaskId) return `task:${storyboard.videoTaskId}`;
  if (storyboard.videoError) return `error:${shortHash(storyboard.videoError)}`;
  return fallback;
}

function buildLogSnapshot(input: {
  state: AppState;
  projectId: string;
  projectName?: string;
  chapterId: string;
  chapterTitle?: string;
  storyboard: StoryboardState;
  storyboardIndex: number;
}): Step5VideoTaskLogSnapshot | null {
  const { state, projectId, projectName, chapterId, chapterTitle, storyboard, storyboardIndex } = input;
  const status = resolveLogStatus(storyboard);
  if (!status) return null;

  const backend = storyboard.videoBackend ?? state.videoApiConfig.backend;
  const providerTaskId = isPendingTaskId(storyboard.videoTaskId) ? undefined : storyboard.videoTaskId;
  const pendingTaskId = isPendingTaskId(storyboard.videoTaskId) ? storyboard.videoTaskId : undefined;
  const promptText = getPromptText(storyboard);
  const referenceSignature = getReferenceSignature(storyboard);
  const attemptKey = buildAttemptKey(storyboard, `storyboard:${storyboardIndex}`);
  const id = `${projectId}:${chapterId}:${storyboardIndex}:${backend}:${attemptKey}`;

  return {
    id,
    projectId,
    projectName,
    chapterId,
    chapterTitle,
    storyboardIndex,
    storyboardNumber: storyboard.storyboard?.number,
    storyboardName: storyboard.storyboard?.name,
    backend: backend as VideoBackendType,
    productionMode: storyboard.videoProductionMode,
    providerTaskId,
    pendingTaskId,
    clientTaskId: storyboard.videoClientTaskId,
    status,
    progress: storyboard.videoProgress,
    statusDetail: storyboard.videoStatusDetail,
    duration: storyboard.videoSubmitDuration,
    promptHash: promptText ? shortHash(promptText) : undefined,
    promptPreview: trimPreview(promptText),
    referenceHash: referenceSignature ? shortHash(referenceSignature) : undefined,
    continuityGroupId: storyboard.videoContinuityGroupId,
    continuityReason: storyboard.videoContinuityReason,
    extendSourceIndex: storyboard.videoExtendSourceIndex,
    extendSourceTaskId: storyboard.videoExtendSourceTaskId,
    extendSourceBlobKey: storyboard.videoExtendSourceBlobKey,
    extendSubmittedAsExtend: storyboard.videoExtendSubmittedAsExtend,
    error: storyboard.videoError,
    videoUrl: storyboard.videoUrl,
    blobKey: storyboard.videoBlobKey,
    submittedAt: storyboard.videoSubmittedAt,
    completedAt: storyboard.videoCompletedAt,
    eventLabel: getEventLabel(status),
    eventDetail: storyboard.videoError ?? storyboard.videoStatusDetail,
  };
}

function buildSnapshotFingerprint(snapshot: Step5VideoTaskLogSnapshot) {
  return JSON.stringify([
    snapshot.status,
    snapshot.providerTaskId,
    snapshot.pendingTaskId,
    snapshot.clientTaskId,
    snapshot.progress,
    snapshot.statusDetail,
    snapshot.error,
    snapshot.videoUrl,
    snapshot.blobKey,
    snapshot.completedAt,
    snapshot.promptHash,
    snapshot.referenceHash,
  ]);
}

export function useStep5VideoTaskLogEffect(state: AppState) {
  const fingerprintRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const snapshots: Step5VideoTaskLogSnapshot[] = [];
    for (const project of state.projects) {
      for (const chapter of project.chapters) {
        chapter.storyboards.forEach((storyboard, storyboardIndex) => {
          const snapshot = buildLogSnapshot({
            state,
            projectId: project.id,
            projectName: project.name,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            storyboard,
            storyboardIndex,
          });
          if (snapshot) snapshots.push(snapshot);
        });
      }
    }

    snapshots.forEach((snapshot) => {
      const fingerprint = buildSnapshotFingerprint(snapshot);
      if (fingerprintRef.current.get(snapshot.id) === fingerprint) return;
      fingerprintRef.current.set(snapshot.id, fingerprint);
      saveStep5VideoTaskLogSnapshot(snapshot).catch((error) => {
        if (import.meta.env.DEV) {
          console.warn('[Step5] 历史任务日志写入失败', error);
        }
      });
    });
  }, [state]);
}
