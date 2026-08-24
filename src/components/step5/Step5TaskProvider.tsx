/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, type MutableRefObject, type ReactNode } from 'react';
import { useCurrentProject } from '@/stores/projectStore';
import { canStartGlobalTask, getGlobalTaskPermanentBlockReason } from '@/lib/globalTaskDependencies';
import { isSeedanceServiceBackend } from '@/lib/seedanceApi';
import type { AppState, GlobalTask } from '@/types';
import { useVideoSubmit } from './useVideoSubmit';
import { useVideoTaskPolling } from './useVideoTaskPolling';
import type { VideoTask } from './VideoTask';
import {
  getStep5Project,
  getStep5ProjectChapters,
  getStep5TasksFromGlobalTask,
  isStep5VideoPending,
  isStep5VideoRunning,
  isStoryboardReadyForStep5Submit,
  summarizeStep5VideoTasks,
} from './step5BatchTasks';
import { supportsVideoExtensionBackend, isVideoExtensionEnabled } from './videoExtensionConfig';
import { formatVideoApiErrorMessage } from './videoErrorFormat';
import { useStep5VideoTaskLogEffect } from './useStep5VideoTaskLogEffect';

const STEP5_BATCH_POLL_INTERVAL_MS = 3000;
const STEP5_BATCH_MAX_WAIT_MS = 30 * 60_000;

type Step5TaskRuntime = ReturnType<typeof useVideoSubmit> & {
  abortPollingForTask: ReturnType<typeof useVideoTaskPolling>['abortPollingForTask'];
  abortAllPollingTasks: ReturnType<typeof useVideoTaskPolling>['abortAllPollingTasks'];
};

const Step5TaskContext = createContext<Step5TaskRuntime | null>(null);

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function getStep5TaskItems(state: AppState, task: GlobalTask) {
  const project = getStep5Project(state, task.projectId);
  const chapter = project?.chapters.find((item) => item.id === task.chapterId);
  if (!project || !chapter) return [];

  return getStep5TasksFromGlobalTask(state, task).filter((videoTask) => {
    const storyboard = chapter.storyboards[videoTask.storyboardIndex];
    if (!storyboard || !isStep5VideoPending(storyboard)) return false;
    return isStoryboardReadyForStep5Submit({
      state,
      projectId: task.projectId,
      chapterId: task.chapterId,
      storyboardIndex: videoTask.storyboardIndex,
      videoConfig: state.videoApiConfig,
    });
  });
}

function collectStep5TaskErrors(state: AppState, projectId: string, tasks: readonly VideoTask[]) {
  const chapters = getStep5ProjectChapters(state, projectId);
  return tasks.flatMap((task) => {
    const chapter = chapters.find((item) => item.id === task.chapterId);
    const storyboard = chapter?.storyboards[task.storyboardIndex];
    if (storyboard?.videoStatus !== 'failed') return [];
    return [{
      index: task.storyboardIndex,
      error: formatVideoApiErrorMessage(storyboard.videoError) ?? storyboard.videoError ?? '视频生成失败',
    }];
  });
}

function collectUnfinishedStep5TaskErrors(state: AppState, projectId: string, tasks: readonly VideoTask[]) {
  const chapters = getStep5ProjectChapters(state, projectId);
  return tasks.flatMap((task) => {
    const chapter = chapters.find((item) => item.id === task.chapterId);
    const storyboard = chapter?.storyboards[task.storyboardIndex];
    if (storyboard?.videoStatus === 'done' || storyboard?.videoStatus === 'failed') return [];
    return [{
      index: task.storyboardIndex,
      error: '该镜头未能进入视频终态，请检查当前镜头状态后由用户手动重试。',
    }];
  });
}

function getStep5TerminalSnapshot(state: AppState, task: GlobalTask, tasks: readonly VideoTask[]) {
  const summary = summarizeStep5VideoTasks(state, task.projectId, tasks);
  const total = tasks.length || task.total || 0;
  const allProcessed = total > 0 && summary.processed >= total;
  const settled = allProcessed && summary.running === 0;
  const errors = [
    ...collectStep5TaskErrors(state, task.projectId, tasks),
    ...(allProcessed ? [] : collectUnfinishedStep5TaskErrors(state, task.projectId, tasks)),
  ];
  return { summary, total, settled, errors };
}

async function waitForStep5TasksSettled(input: {
  stateRef: MutableRefObject<AppState>;
  projectId: string;
  tasks: readonly VideoTask[];
  signal: AbortSignal;
  onProgress: () => void;
}) {
  const startedAt = Date.now();
  while (!input.signal.aborted) {
    input.onProgress();
    const summary = summarizeStep5VideoTasks(input.stateRef.current, input.projectId, input.tasks);
    if (summary.processed >= input.tasks.length && summary.running === 0) return true;
    const chapters = getStep5ProjectChapters(input.stateRef.current, input.projectId);
    const stillRunning = input.tasks.some((task) => {
      const chapter = chapters.find((item) => item.id === task.chapterId);
      return isStep5VideoRunning(chapter?.storyboards[task.storyboardIndex]);
    });
    if (!stillRunning) return true;
    if (Date.now() - startedAt > STEP5_BATCH_MAX_WAIT_MS) return false;
    await sleep(STEP5_BATCH_POLL_INTERVAL_MS, input.signal);
  }
  return false;
}

export function Step5TaskProvider({ children }: { children: ReactNode }) {
  const { state, dispatch } = useCurrentProject();
  const stateRef = useRef(state);
  const projectIdRef = useRef<string | undefined>(state.currentProjectId ?? undefined);
  const runningTaskIdsRef = useRef<Set<string>>(new Set());
  const taskControllersRef = useRef<Map<string, AbortController>>(new Map());
  const taskVideoItemsRef = useRef<Map<string, VideoTask[]>>(new Map());

  useEffect(() => {
    stateRef.current = state;
    projectIdRef.current = state.currentProjectId ?? undefined;
  }, [state]);

  const pollingRuntime = useVideoTaskPolling(state, state.videoApiConfig);
  const submitRuntime = useVideoSubmit(
    state.videoApiConfig,
    pollingRuntime.dispatchRef,
    stateRef,
    projectIdRef,
  );
  useStep5VideoTaskLogEffect(state);

  const runStep5BatchTask = useCallback((task: GlobalTask) => {
    if (task.type !== 'step5-batch') return;
    if (runningTaskIdsRef.current.has(task.id)) return;
    const blockReason = getGlobalTaskPermanentBlockReason(stateRef.current, task);
    if (blockReason) {
      dispatch({
        type: 'UPDATE_GLOBAL_TASK',
        taskId: task.id,
        updates: {
          errors: [{ index: 0, error: blockReason }],
          streamStageLabel: '前置步骤未完成',
          streamTextPreview: '',
          streamTextLength: 0,
          streamUpdatedAt: Date.now(),
        },
      });
      dispatch({ type: 'FINISH_GLOBAL_TASK', taskId: task.id, status: 'failed', stopReason: 'failed' });
      return;
    }
    if (!canStartGlobalTask(stateRef.current, task)) return;

    runningTaskIdsRef.current.add(task.id);
    const controller = new AbortController();
    taskControllersRef.current.set(task.id, controller);

    (async () => {
      const startedAt = Date.now();
      const initialTasks = getStep5TaskItems(stateRef.current, task);
      taskVideoItemsRef.current.set(task.id, initialTasks);

      if (initialTasks.length === 0) {
        dispatch({
          type: 'UPDATE_GLOBAL_TASK',
          taskId: task.id,
          updates: { doneCount: task.doneCount, streamStageLabel: '没有待提交的视频' },
        });
        dispatch({ type: 'FINISH_GLOBAL_TASK', taskId: task.id, status: 'done', stopReason: 'completed' });
        return;
      }

      dispatch({ type: 'START_GLOBAL_TASK', taskId: task.id, startedAt });
      dispatch({
        type: 'UPDATE_GLOBAL_TASK',
        taskId: task.id,
        updates: {
          total: initialTasks.length,
          doneCount: 0,
          streamStageLabel: '视频提交',
          streamTextPreview: '',
          streamTextLength: 0,
        },
      });

      const updateProgress = (stageLabel = '视频生成中') => {
        const summary = summarizeStep5VideoTasks(stateRef.current, task.projectId, initialTasks);
        const errors = collectStep5TaskErrors(stateRef.current, task.projectId, initialTasks);
        dispatch({
          type: 'UPDATE_GLOBAL_TASK',
          taskId: task.id,
          updates: {
            doneCount: summary.processed,
            errors,
            streamStageLabel: stageLabel,
            streamTextPreview: `${summary.done} 个完成，${summary.failed} 个失败，${summary.running} 个进行中`,
            streamTextLength: 0,
            streamUpdatedAt: Date.now(),
          },
        });
      };

      const videoConfig = stateRef.current.videoApiConfig;
      const backend = videoConfig.backend;
      const seedanceDelayMs = (isSeedanceServiceBackend(backend) ? (videoConfig.seedanceBatchDelay ?? 30) : 0) * 1000;
      const extensionSerialMode = supportsVideoExtensionBackend(backend) && isVideoExtensionEnabled(videoConfig);
      const concurrency = isSeedanceServiceBackend(backend) || backend === 'xyqagent' || extensionSerialMode
        ? 1
        : Math.max(1, Math.min(videoConfig.batchConcurrency || 3, initialTasks.length));

      const executeTask = async (videoTask: VideoTask, sequenceIndex: number) => {
        if (controller.signal.aborted) return;
        const chapter = getStep5ProjectChapters(stateRef.current, task.projectId)
          .find((item) => item.id === videoTask.chapterId);
        const storyboard = chapter?.storyboards[videoTask.storyboardIndex];
        if (!storyboard || storyboard.videoStatus === 'done') return;
        if (!isStoryboardReadyForStep5Submit({
          state: stateRef.current,
          projectId: task.projectId,
          chapterId: videoTask.chapterId,
          storyboardIndex: videoTask.storyboardIndex,
          videoConfig: stateRef.current.videoApiConfig,
        })) return;

        dispatch({
          type: 'UPDATE_GLOBAL_TASK',
          taskId: task.id,
          updates: {
            currentIndex: videoTask.storyboardIndex,
            streamStageLabel: '视频提交',
            streamTextPreview: `提交分镜 ${videoTask.storyboardIndex + 1}/${chapter?.storyboards.length ?? initialTasks.length}`,
            streamUpdatedAt: Date.now(),
          },
        });

        if (isSeedanceServiceBackend(backend) && sequenceIndex > 0 && seedanceDelayMs > 0) {
          await sleep(seedanceDelayMs, controller.signal);
        }
        if (controller.signal.aborted) return;

        if (isSeedanceServiceBackend(backend) || backend === 'xyqagent') {
          await submitRuntime.submitVideoAsync(videoTask);
        } else {
          await submitRuntime.submitVideo(videoTask);
        }
        updateProgress('等待视频结果');
      };

      try {
        if (concurrency <= 1) {
          for (let index = 0; index < initialTasks.length; index += 1) {
            await executeTask(initialTasks[index], index);
            if (controller.signal.aborted) break;
          }
        } else {
          let nextIndex = 0;
          const runWorker = async () => {
            while (!controller.signal.aborted && nextIndex < initialTasks.length) {
              const index = nextIndex;
              nextIndex += 1;
              await executeTask(initialTasks[index], index);
            }
          };
          await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
        }

        const settled = await waitForStep5TasksSettled({
          stateRef,
          projectId: task.projectId,
          tasks: initialTasks,
          signal: controller.signal,
          onProgress: () => updateProgress('等待视频结果'),
        });

        const finalSummary = summarizeStep5VideoTasks(stateRef.current, task.projectId, initialTasks);
        const allProcessed = finalSummary.processed >= initialTasks.length;
        const finalErrors = [
          ...collectStep5TaskErrors(stateRef.current, task.projectId, initialTasks),
          ...(allProcessed ? [] : collectUnfinishedStep5TaskErrors(stateRef.current, task.projectId, initialTasks)),
        ];
        dispatch({
          type: 'UPDATE_GLOBAL_TASK',
          taskId: task.id,
          updates: {
            currentIndex: -1,
            doneCount: finalSummary.processed,
            errors: settled ? finalErrors : [
              ...finalErrors,
              { index: 0, error: '等待视频任务完成超过 30 分钟，已停止本次批量等待。远端任务仍可在 Step5 自动恢复。' },
            ],
            streamStageLabel: settled ? '视频批量完成' : '等待超时',
          },
        });

        if (controller.signal.aborted) {
          dispatch({ type: 'FINISH_GLOBAL_TASK', taskId: task.id, status: 'cancelled', stopReason: 'cancelled' });
        } else if (!settled || !allProcessed || finalSummary.failed > 0) {
          dispatch({ type: 'FINISH_GLOBAL_TASK', taskId: task.id, status: 'failed', stopReason: 'failed' });
        } else {
          dispatch({ type: 'FINISH_GLOBAL_TASK', taskId: task.id, status: 'done', stopReason: 'completed' });
        }
      } finally {
        runningTaskIdsRef.current.delete(task.id);
        taskControllersRef.current.delete(task.id);
        taskVideoItemsRef.current.delete(task.id);
      }
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const readableMessage = formatVideoApiErrorMessage(message) ?? message;
      dispatch({
        type: 'UPDATE_GLOBAL_TASK',
        taskId: task.id,
        updates: { errors: [{ index: 0, error: readableMessage }], streamStageLabel: '视频批量失败' },
      });
      dispatch({ type: 'FINISH_GLOBAL_TASK', taskId: task.id, status: 'failed', stopReason: 'failed' });
      runningTaskIdsRef.current.delete(task.id);
      taskControllersRef.current.delete(task.id);
      taskVideoItemsRef.current.delete(task.id);
    });
  }, [dispatch, submitRuntime]);

  useEffect(() => {
    for (const task of state.globalTasks) {
      if (task.type !== 'step5-batch' || task.status !== 'running') continue;

      const videoTasks = taskVideoItemsRef.current.get(task.id) ?? getStep5TasksFromGlobalTask(state, task);
      if (videoTasks.length === 0) continue;

      const snapshot = getStep5TerminalSnapshot(state, task, videoTasks);
      if (!snapshot.settled) continue;

      taskControllersRef.current.get(task.id)?.abort();
      taskControllersRef.current.delete(task.id);
      runningTaskIdsRef.current.delete(task.id);
      taskVideoItemsRef.current.delete(task.id);

      dispatch({
        type: 'UPDATE_GLOBAL_TASK',
        taskId: task.id,
        updates: {
          currentIndex: -1,
          doneCount: snapshot.summary.processed,
          total: snapshot.total,
          errors: snapshot.errors,
          streamStageLabel: snapshot.summary.failed > 0 ? '视频批量完成，有失败项待处理' : '视频批量完成',
          streamTextPreview: `${snapshot.summary.done} 个完成，${snapshot.summary.failed} 个失败`,
          streamTextLength: 0,
          streamUpdatedAt: Date.now(),
        },
      });
      dispatch({
        type: 'FINISH_GLOBAL_TASK',
        taskId: task.id,
        status: snapshot.summary.failed > 0 || snapshot.errors.length > 0 ? 'failed' : 'done',
        stopReason: snapshot.summary.failed > 0 || snapshot.errors.length > 0 ? 'failed' : 'completed',
      });
    }
  }, [dispatch, state]);

  useEffect(() => {
    for (const task of state.globalTasks) {
      if (task.type === 'step5-batch' && task.status === 'queued') {
        runStep5BatchTask(task);
      }
      if (task.type === 'step5-batch' && task.status === 'cancelled') {
        taskControllersRef.current.get(task.id)?.abort();
        const videoTasks = taskVideoItemsRef.current.get(task.id) ?? [];
        videoTasks.forEach((videoTask) => {
          submitRuntime.abortPolling(videoTask);
          const chapter = getStep5ProjectChapters(stateRef.current, task.projectId)
            .find((item) => item.id === videoTask.chapterId);
          const storyboard = chapter?.storyboards[videoTask.storyboardIndex];
          if (storyboard?.videoTaskId && !storyboard.videoTaskId.endsWith('-pending')) {
            pollingRuntime.abortPollingForTask(storyboard.videoTaskId, storyboard.videoBackend);
          }
        });
      }
    }
  }, [pollingRuntime, runStep5BatchTask, state.globalTasks, submitRuntime]);

  const runtime: Step5TaskRuntime = {
    ...submitRuntime,
    abortPollingForTask: pollingRuntime.abortPollingForTask,
    abortAllPollingTasks: pollingRuntime.abortAllPollingTasks,
  };

  return (
    <Step5TaskContext.Provider value={runtime}>
      {children}
    </Step5TaskContext.Provider>
  );
}

export function useStep5TaskRuntime() {
  const runtime = useContext(Step5TaskContext);
  if (!runtime) {
    throw new Error('useStep5TaskRuntime must be used within Step5TaskProvider');
  }
  return runtime;
}
