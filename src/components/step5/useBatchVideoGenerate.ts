import { useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { useCurrentProject } from '@/stores/projectStore';
import {
  getOfficialVirtualHumanIncompatibleMessage,
  isOfficialVirtualHumanCompatibleVideoBackend,
} from '@/lib/officialVirtualHumanVideoMode';
import type { AppState, VideoApiConfig } from '@/types';
import {
  hasOfficialVirtualHumanVideoReferences,
  resolveVideoReferenceAssets,
} from './videoReferenceResolver';
import type { VideoTask } from './VideoTask';
import { isStoryboardDirectorMode } from './storyboardBoardVideoReference';
import { getStoryboardVideoImageRefs } from './videoImageRefs';
import {
  collectPendingStep5VideoTasks,
  getStep5Project,
  getStep5ProjectChapters,
  getStep5TasksFromGlobalTask,
  summarizeStep5VideoTasks,
} from './step5BatchTasks';

export function useBatchVideoGenerate(
  videoApiConfig: VideoApiConfig,
  state: AppState,
  confirm: (message: string, title?: string) => Promise<boolean>,
) {
  const { dispatch } = useCurrentProject();
  const stateRef = useRef(state);
  const abortAllPollingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const currentProjectId = state.currentProjectId ?? undefined;
  const currentProject = getStep5Project(state, currentProjectId);
  const currentChapterId = currentProject?.currentChapterId;
  const currentStep5GlobalTask = useMemo(() => state.globalTasks.find((task) =>
    task.type === 'step5-batch'
    && task.projectId === currentProjectId
    && task.chapterId === currentChapterId
    && (task.status === 'queued' || task.status === 'running'),
  ), [currentChapterId, currentProjectId, state.globalTasks]);
  const activeStep5Tasks = useMemo(() =>
    currentStep5GlobalTask
      ? getStep5TasksFromGlobalTask(state, currentStep5GlobalTask)
      : [],
  [currentStep5GlobalTask, state]);
  const activeStep5Summary = useMemo(() =>
    summarizeStep5VideoTasks(state, currentProjectId, activeStep5Tasks),
  [activeStep5Tasks, currentProjectId, state]);

  const isBatchGenerating = !!currentStep5GlobalTask;
  const batchProgress = {
    current: currentStep5GlobalTask?.doneCount ?? activeStep5Summary.processed,
    total: currentStep5GlobalTask?.total ?? activeStep5Tasks.length,
  };
  const batchStartTime = currentStep5GlobalTask?.startedAt ?? null;

  const handleBatchGenerate = useCallback(
    async (
      tasks?: VideoTask[],
      selectedInChapter?: { chapterId: string; indices?: number[] },
    ) => {
      const projectId = stateRef.current.currentProjectId ?? undefined;
      const project = getStep5Project(stateRef.current, projectId);
      if (!projectId || !project) {
        toast.error('当前项目不可用，请刷新后重试');
        return;
      }

      const chapters = getStep5ProjectChapters(stateRef.current, projectId);
      const pendingTasks = collectPendingStep5VideoTasks({
        state: stateRef.current,
        projectId,
        videoConfig: videoApiConfig,
        tasks,
        selectedInChapter,
      });

      if (pendingTasks.length === 0) {
        toast.warning('没有待生成的视频。');
        return;
      }

      if (!isOfficialVirtualHumanCompatibleVideoBackend(videoApiConfig.backend)) {
        const assetLibrary = project.assetLibrary ?? [];
        const blockedCount = pendingTasks.filter((task) => {
          const chapter = chapters.find((item) => item.id === task.chapterId);
          const storyboard = chapter?.storyboards[task.storyboardIndex];
          if (!chapter || !storyboard) return false;
          const imageRefs = getStoryboardVideoImageRefs(storyboard);
          const resolution = resolveVideoReferenceAssets(
            imageRefs,
            assetLibrary,
            undefined,
            storyboard.scenePositionBoard,
            videoApiConfig.videoRatio,
            {
              includeScenePositionBoard: false,
              useStoryboardBoardReferencePack: isStoryboardDirectorMode(storyboard),
              finalVideoPrompt: storyboard.seedanceFinalVideoPrompt?.trim() || storyboard.prompt?.rawText?.trim(),
            },
          );
          return hasOfficialVirtualHumanVideoReferences(resolution);
        }).length;

        if (blockedCount > 0) {
          toast.error(`${getOfficialVirtualHumanIncompatibleMessage(videoApiConfig.backend)} 当前批量队列中有 ${blockedCount} 个分镜使用了官方虚拟人脸。`);
          return;
        }
      }

      const chapterTaskCounts = new Map<string, number>();
      for (const task of pendingTasks) {
        chapterTaskCounts.set(task.chapterId, (chapterTaskCounts.get(task.chapterId) ?? 0) + 1);
      }
      const chapterSummary = Array.from(chapterTaskCounts.entries())
        .map(([chapterId, count]) => {
          const chapter = chapters.find((item) => item.id === chapterId);
          return `${chapter?.title ?? chapterId}: ${count} 个`;
        })
        .join('；');

      const confirmed = await confirm(`确定要批量生成 ${pendingTasks.length} 个视频吗？\n${chapterSummary}`);
      if (!confirmed) return;

      const tasksByChapter = new Map<string, VideoTask[]>();
      pendingTasks.forEach((task) => {
        const list = tasksByChapter.get(task.chapterId) ?? [];
        list.push(task);
        tasksByChapter.set(task.chapterId, list);
      });

      for (const [chapterId, chapterTasks] of tasksByChapter) {
        dispatch({
          type: 'QUEUE_STEP5_BATCH_TASK',
          projectId,
          chapterId,
          total: chapterTasks.length,
          indices: chapterTasks.map((task) => task.storyboardIndex),
          backend: videoApiConfig.backend,
        });
      }

      toast.success(`Step5 已加入全局任务：${pendingTasks.length} 个视频`);
    },
    [confirm, dispatch, videoApiConfig],
  );

  const cancelBatch = useCallback(() => {
    const projectId = stateRef.current.currentProjectId ?? undefined;
    const project = getStep5Project(stateRef.current, projectId);
    const chapterId = project?.currentChapterId;
    stateRef.current.globalTasks
      .filter((task) =>
        task.type === 'step5-batch'
        && task.projectId === projectId
        && task.chapterId === chapterId
        && (task.status === 'queued' || task.status === 'running'),
      )
      .forEach((task) => dispatch({ type: 'CANCEL_GLOBAL_TASK', taskId: task.id }));
    if (abortAllPollingRef.current) abortAllPollingRef.current();
  }, [dispatch]);

  return {
    isBatchGenerating,
    batchProgress,
    batchStartTime,
    handleBatchGenerate,
    cancelBatch,
    abortAllPollingRef,
  };
}
