import { useCallback, useEffect, useRef } from 'react';
import type { AppState, VideoApiConfig } from '@/types';
import { useCurrentProject } from '@/stores/projectStore';
import { pollVideoTask } from '@/lib/videoPoller';
import { listSeedanceTasks } from '@/lib/seedanceTaskClient';
import { volcCancelTask } from '@/lib/volcengineApiClient';
import { cancelBackgroundJob } from '@/lib/backgroundJobsClient';
import { buildErrorDetail } from './videoUtils';
import { formatVideoApiErrorMessage } from './videoErrorFormat';
import {
  buildSeedanceFetchInit,
  getSeedanceApiBase,
  isSeedanceServiceBackend,
} from '@/lib/seedanceApi';
import { pollStep5BackendJobUntilDone } from './backendVideoJobs';

export function useVideoTaskPolling(
  state: AppState,
  videoApiConfig: VideoApiConfig,
) {
  const { dispatch } = useCurrentProject();

  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  const pollingTaskIdRef = useRef<Set<string>>(new Set());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const pollingSnapshot = buildPollingSnapshot(state);
  const seedancePendingSnapshot = buildSeedancePendingSnapshot(state);

  const videoConfigRef = useRef(videoApiConfig);
  useEffect(() => {
    videoConfigRef.current = videoApiConfig;
  }, [videoApiConfig]);

  const buildTaskVideoConfig = useCallback((backend: VideoApiConfig['backend'] | undefined): VideoApiConfig => {
    if (!backend) return videoConfigRef.current;
    return {
      ...videoConfigRef.current,
      backend,
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      for (const project of state.projects) {
        for (const chapter of project.chapters) {
          const hasPolling = chapter.storyboards.some(
            (sb) => (sb.videoStatus === 'polling' || sb.videoStatus === 'submitting') && sb.videoTaskId,
          );
          if (hasPolling) {
            dispatchRef.current({
              type: 'MARK_POLLING_AS_RESUMABLE',
              projectId: project.id,
              chapterId: chapter.id,
            });
          }
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state]);

  useEffect(() => {
    const abortControllers = abortControllersRef.current;
    const pollingTaskIds = pollingTaskIdRef.current;

    return () => {
      abortControllers.forEach((controller) => controller.abort());
      abortControllers.clear();
      pollingTaskIds.clear();
    };
  }, []);

  useEffect(() => {
    const newPollingTasks: { index: number; taskId: string; chapterId: string; backend: VideoApiConfig['backend'] | undefined }[] = [];

    for (const project of state.projects) {
      for (const chapter of project.chapters) {
        chapter.storyboards.forEach((sb, index) => {
          if (!sb.videoTaskId) return;
          if (sb.videoTaskId.endsWith('-pending')) return;
          if (pollingTaskIdRef.current.has(sb.videoTaskId)) return;

          const needsPolling = sb.videoStatus === 'polling'
            || sb.videoStatus === 'submitting'
            || (sb.videoStatus === 'idle' && sb.videoTaskId)
            || (sb.videoBackend === 'xyqagent' && sb.videoStatus === 'done' && !sb.videoUrl);
          if (!needsPolling) return;

          newPollingTasks.push({
            index,
            taskId: sb.videoTaskId,
            chapterId: chapter.id,
            backend: sb.videoBackend,
          });
          pollingTaskIdRef.current.add(sb.videoTaskId);
        });
      }
    }

    if (newPollingTasks.length === 0) return;

    if (import.meta.env.DEV) {
      console.log(`[Step5] 恢复 ${newPollingTasks.length} 个轮询任务，当前已跟踪 ${pollingTaskIdRef.current.size} 个。`);
    }

    newPollingTasks.forEach(({ index, taskId, chapterId, backend }) => {
      const abortController = new AbortController();
      abortControllersRef.current.set(taskId, abortController);

      const taskVideoConfig = buildTaskVideoConfig(backend);
      dispatchRef.current({
        type: 'UPDATE_VIDEO_PROGRESS',
        index,
        progress: 5,
        status: 'polling',
        statusDetail: '恢复轮询中...',
        chapterId,
      });

      if (import.meta.env.DEV) {
        console.log(`[Step5] 启动轮询: taskId=${taskId}, index=${index}, chapterId=${chapterId}`);
      }

      if (taskId.startsWith('background:')) {
        const jobId = taskId.slice('background:'.length);
        pollStep5BackendJobUntilDone(jobId, {
          signal: abortController.signal,
          onProgress: (job) => {
            if (abortController.signal.aborted) return;
            const done = Number((job.progress as { done?: unknown })?.done || 0);
            const total = Number((job.progress as { total?: unknown })?.total || 1);
            dispatchRef.current({
              type: 'UPDATE_VIDEO_PROGRESS',
              index,
              progress: job.status === 'running'
                ? Math.min(95, Math.max(5, Math.round((done / total) * 100)))
                : 5,
              status: 'polling',
              statusDetail: job.status === 'queued' ? '后台排队中' : '后台生成中',
              progressIsEstimated: true,
              chapterId,
            });
          },
        }).then((result) => {
          pollingTaskIdRef.current.delete(taskId);
          abortControllersRef.current.delete(taskId);
          if (abortController.signal.aborted) return;
          dispatchRef.current({
            type: 'SET_VIDEO_COMPLETE',
            index,
            videoUrl: result.videoUrl,
            blobKey: result.blobKey,
            chapterId,
          });
        }).catch((error) => {
          pollingTaskIdRef.current.delete(taskId);
          abortControllersRef.current.delete(taskId);
          if (abortController.signal.aborted) return;
          const message = error instanceof Error ? error.message : String(error);
          dispatchRef.current({
            type: 'SET_VIDEO_ERROR',
            index,
            error: formatVideoApiErrorMessage(message) ?? message,
            errorDetail: buildErrorDetail(taskVideoConfig.backend, { taskId, rawError: message }),
            chapterId,
          });
        });
        return;
      }

      pollVideoTask(
        taskId,
        index,
        taskVideoConfig,
        {
          onProgress: (idx, detail) => {
            if (abortController.signal.aborted) return;
            dispatchRef.current({
              type: 'UPDATE_VIDEO_PROGRESS',
              index: idx,
              progress: detail.progress,
              status: 'polling',
              statusDetail: detail.statusLabel,
              progressIsEstimated: detail.isEstimated,
              chapterId,
            });
          },
          onComplete: (idx, videoUrl, blobKey) => {
            pollingTaskIdRef.current.delete(taskId);
            abortControllersRef.current.delete(taskId);
            if (abortController.signal.aborted) {
              if (import.meta.env.DEV) console.warn(`[Step5] 轮询完成但任务已中止: taskId=${taskId}`);
              return;
            }
            if (import.meta.env.DEV) console.log(`[Step5] 轮询完成: taskId=${taskId}, index=${idx}`);
            dispatchRef.current({
              type: 'SET_VIDEO_COMPLETE',
              index: idx,
              videoUrl,
              blobKey,
              chapterId,
            });
          },
          onError: (idx, error) => {
            pollingTaskIdRef.current.delete(taskId);
            abortControllersRef.current.delete(taskId);
            if (abortController.signal.aborted) {
              if (import.meta.env.DEV) console.warn(`[Step5] 轮询报错但任务已中止: taskId=${taskId}`);
              return;
            }
            if (import.meta.env.DEV) console.warn(`[Step5] 轮询错误: taskId=${taskId}, error=${error}`);
            dispatchRef.current({
              type: 'SET_VIDEO_ERROR',
              index: idx,
              error: formatVideoApiErrorMessage(error) ?? error,
              errorDetail: buildErrorDetail(taskVideoConfig.backend, { taskId, rawError: error }),
              chapterId,
            });
          },
        },
        { signal: abortController.signal },
      ).catch((error) => {
        pollingTaskIdRef.current.delete(taskId);
        abortControllersRef.current.delete(taskId);
        if (abortController.signal.aborted) return;
        if (import.meta.env.DEV) {
          console.warn(`[Step5] 轮询异常退出: taskId=${taskId}`, error);
        }
      });
    });
  }, [buildTaskVideoConfig, pollingSnapshot, state]);

  useEffect(() => {
    if (!seedancePendingSnapshot) return;

    const pendingTasks: {
      index: number;
      chapterId: string;
      backend: VideoApiConfig['backend'];
      clientTaskId: string;
      productionMode: ReturnType<typeof getSeedancePendingMetadata>['productionMode'];
      continuityGroupId: string | undefined;
      continuityReason: string | undefined;
      extendSourceIndex: number | undefined;
      extendSourceTaskId: string | undefined;
      extendSourceBlobKey: string | undefined;
      extendSubmittedAsExtend: boolean | undefined;
    }[] = [];

    for (const project of state.projects) {
      for (const chapter of project.chapters) {
        chapter.storyboards.forEach((sb, index) => {
          if (!isSeedanceServiceBackend(sb.videoBackend)) return;
          if (sb.videoStatus !== 'submitting') return;
          if (!sb.videoTaskId?.endsWith('-pending')) return;
          if (!sb.videoClientTaskId) return;
          pendingTasks.push({
            index,
            chapterId: chapter.id,
            backend: sb.videoBackend ?? 'seedance',
            clientTaskId: sb.videoClientTaskId,
            ...getSeedancePendingMetadata(sb),
          });
        });
      }
    }

    if (pendingTasks.length === 0) return;

    let cancelled = false;
    const recoverPendingTasks = async () => {
      try {
        const tasksByBackend = new Map<VideoApiConfig['backend'], Awaited<ReturnType<typeof listSeedanceTasks>>>();
        for (const backend of new Set(pendingTasks.map((pending) => pending.backend))) {
          tasksByBackend.set(backend, await listSeedanceTasks(20, buildTaskVideoConfig(backend)));
        }
        if (cancelled) return;
        pendingTasks.forEach((pending) => {
          const remoteTasks = tasksByBackend.get(pending.backend) ?? [];
          const matched = remoteTasks.find((task) => task.client_task_id === pending.clientTaskId);
          if (!matched?.task_id) return;
          dispatchRef.current({
            type: 'SUBMIT_VIDEO',
            index: pending.index,
            taskId: matched.task_id,
            clientTaskId: pending.clientTaskId,
            submittedAt: parseSeedanceTimestamp(matched.created_at),
            chapterId: pending.chapterId,
            backend: pending.backend,
            productionMode: pending.productionMode,
            continuityGroupId: pending.continuityGroupId,
            continuityReason: pending.continuityReason,
            extendSourceIndex: pending.extendSourceIndex,
            extendSourceTaskId: pending.extendSourceTaskId,
            extendSourceBlobKey: pending.extendSourceBlobKey,
            extendSubmittedAsExtend: pending.extendSubmittedAsExtend,
          });
        });
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn('[Step5] 小云雀 pending 任务恢复失败', error);
        }
      }
    };

    recoverPendingTasks();
    const timer = window.setInterval(recoverPendingTasks, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [buildTaskVideoConfig, seedancePendingSnapshot, state]);

  const abortPollingForTask = useCallback((
    taskId: string,
    backend?: VideoApiConfig['backend'],
    options?: { remoteCancel?: boolean },
  ) => {
    const controller = abortControllersRef.current.get(taskId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(taskId);
      pollingTaskIdRef.current.delete(taskId);

      const taskBackend = backend ?? videoConfigRef.current.backend;
      if (options?.remoteCancel !== false && taskId.startsWith('background:')) {
        cancelBackgroundJob(taskId.slice('background:'.length), '用户取消视频后台任务').catch(() => undefined);
        return;
      }
      if (options?.remoteCancel !== false && isSeedanceServiceBackend(taskBackend) && taskId) {
        const taskVideoConfig = buildTaskVideoConfig(taskBackend);
        fetch(`${getSeedanceApiBase(taskVideoConfig)}/task/${taskId}/cancel`, buildSeedanceFetchInit(taskVideoConfig, { method: 'POST' })).catch(() => {
          // 服务器取消属于尽力而为，前端这里静默处理。
        });
      }
    }
  }, [buildTaskVideoConfig]);

  const abortAllPollingTasks = useCallback(async () => {
    const volcTaskIdsToCancel = new Set<string>();

    for (const project of state.projects) {
      for (const chapter of project.chapters) {
        for (const sb of chapter.storyboards) {
          if (!sb.videoTaskId || sb.videoTaskId.endsWith('-pending')) continue;
          if (sb.videoStatus !== 'polling' && sb.videoStatus !== 'submitting') continue;

          if ((sb.videoBackend ?? videoConfigRef.current.backend) === 'volcengine') {
            volcTaskIdsToCancel.add(sb.videoTaskId);
          }

          abortPollingForTask(sb.videoTaskId, sb.videoBackend);
        }
      }
    }

    if (videoConfigRef.current.backend === 'volcengine' && videoConfigRef.current.volcApiKey) {
      await Promise.allSettled(
        Array.from(volcTaskIdsToCancel).map((taskId) => volcCancelTask(videoConfigRef.current, taskId)),
      );
    }
  }, [abortPollingForTask, state]);

  const pollingCount = state.projects
    .find((p) => p.id === state.currentProjectId)
    ?.chapters.reduce((sum, chapter) => sum + chapter.storyboards.filter((sb) => sb.videoStatus === 'polling').length, 0) ?? 0;

  return {
    dispatchRef,
    pollingTaskIdRef,
    pollingCount,
    abortPollingForTask,
    abortAllPollingTasks,
  };
}

function buildPollingSnapshot(state: AppState): string {
  const parts: string[] = [];
  for (const project of state.projects) {
    for (const chapter of project.chapters) {
      const taskIds = chapter.storyboards
        .filter(
          (sb) => sb.videoTaskId
            && !sb.videoTaskId.endsWith('-pending')
            && (
              sb.videoStatus === 'polling'
              || sb.videoStatus === 'submitting'
              || (sb.videoStatus === 'idle' && sb.videoTaskId)
              || (sb.videoBackend === 'xyqagent' && sb.videoStatus === 'done' && !sb.videoUrl)
            ),
        )
        .map((sb) => sb.videoTaskId);

      if (taskIds.length > 0) {
        parts.push(`${project.id}:${chapter.id}:${taskIds.join('+')}`);
      }
    }
  }

  return parts.join('|');
}

function getSeedancePendingMetadata(sb: AppState['projects'][number]['chapters'][number]['storyboards'][number]) {
  return {
    productionMode: sb.videoProductionMode,
    continuityGroupId: sb.videoContinuityGroupId,
    continuityReason: sb.videoContinuityReason,
    extendSourceIndex: sb.videoExtendSourceIndex,
    extendSourceTaskId: sb.videoExtendSourceTaskId,
    extendSourceBlobKey: sb.videoExtendSourceBlobKey,
    extendSubmittedAsExtend: sb.videoExtendSubmittedAsExtend,
  };
}

function parseSeedanceTimestamp(value?: string | null) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function buildSeedancePendingSnapshot(state: AppState): string {
  const parts: string[] = [];
  for (const project of state.projects) {
    for (const chapter of project.chapters) {
      const clientTaskIds = chapter.storyboards
        .filter((sb) =>
          isSeedanceServiceBackend(sb.videoBackend)
          && sb.videoStatus === 'submitting'
          && !!sb.videoTaskId?.endsWith('-pending')
          && !!sb.videoClientTaskId,
        )
        .map((sb) => `${sb.videoBackend ?? 'seedance'}:${sb.videoClientTaskId}`);

      if (clientTaskIds.length > 0) {
        parts.push(`${project.id}:${chapter.id}:${clientTaskIds.join('+')}`);
      }
    }
  }

  return parts.join('|');
}
