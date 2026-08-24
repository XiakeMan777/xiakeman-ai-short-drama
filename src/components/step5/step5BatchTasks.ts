import type { AppState, StoryboardState, VideoApiConfig } from '@/types';
import { getStoryboardVideoImageRefs } from './videoImageRefs';
import { getStoryboardVideoSubmissionReadiness } from './videoSubmissionReadiness';
import type { VideoTask } from './VideoTask';

export function getStep5Project(state: AppState, projectId: string | undefined) {
  return projectId ? state.projects.find((project) => project.id === projectId) : undefined;
}

export function getStep5ProjectChapters(state: AppState, projectId: string | undefined) {
  return getStep5Project(state, projectId)?.chapters ?? [];
}

export function isStep5VideoPending(storyboard?: StoryboardState): boolean {
  const status = storyboard?.videoStatus;
  if (status === 'failed') return true;
  if (status === 'idle' || !status) return !storyboard?.videoTaskId;
  return false;
}

export function isStep5VideoRunning(storyboard?: StoryboardState): boolean {
  return storyboard?.videoStatus === 'polling' || storyboard?.videoStatus === 'submitting';
}

export function isStoryboardReadyForStep5Submit(input: {
  state: AppState;
  projectId: string | undefined;
  chapterId: string;
  storyboardIndex: number;
  videoConfig: VideoApiConfig;
}) {
  const project = getStep5Project(input.state, input.projectId);
  const chapter = project?.chapters.find((item) => item.id === input.chapterId);
  const storyboard = chapter?.storyboards[input.storyboardIndex];
  if (!project || !chapter || !storyboard) return false;

  return getStoryboardVideoSubmissionReadiness({
    storyboard,
    analysis: chapter.analysis,
    assetLibrary: project.assetLibrary ?? [],
    project,
    storyboardIndex: input.storyboardIndex,
    videoRatio: input.videoConfig.videoRatio,
    videoConfig: input.videoConfig,
    imageRefs: getStoryboardVideoImageRefs(storyboard),
  }).ready;
}

export function collectPendingStep5VideoTasks(input: {
  state: AppState;
  projectId: string | undefined;
  videoConfig: VideoApiConfig;
  tasks?: VideoTask[];
  selectedInChapter?: { chapterId: string; indices?: number[] };
}) {
  const chapters = getStep5ProjectChapters(input.state, input.projectId);
  const isReady = (chapterId: string, storyboardIndex: number) => isStoryboardReadyForStep5Submit({
    state: input.state,
    projectId: input.projectId,
    chapterId,
    storyboardIndex,
    videoConfig: input.videoConfig,
  });

  if (input.tasks?.length) {
    return input.tasks.filter((task) => {
      const chapter = chapters.find((item) => item.id === task.chapterId);
      const storyboard = chapter?.storyboards[task.storyboardIndex];
      return !!storyboard && isReady(task.chapterId, task.storyboardIndex) && isStep5VideoPending(storyboard);
    });
  }

  if (input.selectedInChapter) {
    const chapter = chapters.find((item) => item.id === input.selectedInChapter?.chapterId);
    const indices = input.selectedInChapter.indices?.length
      ? input.selectedInChapter.indices
      : (chapter?.storyboards.map((_, index) => index) ?? []);

    return indices
      .filter((storyboardIndex) => {
        const storyboard = chapter?.storyboards[storyboardIndex];
        return !!storyboard
          && isReady(input.selectedInChapter!.chapterId, storyboardIndex)
          && isStep5VideoPending(storyboard);
      })
      .map((storyboardIndex) => ({
        chapterId: input.selectedInChapter!.chapterId,
        storyboardIndex,
      }));
  }

  const pendingTasks: VideoTask[] = [];
  for (const chapter of chapters) {
    chapter.storyboards.forEach((storyboard, storyboardIndex) => {
      if (isReady(chapter.id, storyboardIndex) && isStep5VideoPending(storyboard)) {
        pendingTasks.push({ chapterId: chapter.id, storyboardIndex });
      }
    });
  }
  return pendingTasks;
}

export function summarizeStep5VideoTasks(state: AppState, projectId: string | undefined, tasks: readonly VideoTask[]) {
  const chapters = getStep5ProjectChapters(state, projectId);
  let done = 0;
  let failed = 0;
  let running = 0;

  for (const task of tasks) {
    const chapter = chapters.find((item) => item.id === task.chapterId);
    const storyboard = chapter?.storyboards[task.storyboardIndex];
    if (storyboard?.videoStatus === 'done') done += 1;
    if (storyboard?.videoStatus === 'failed') failed += 1;
    if (isStep5VideoRunning(storyboard)) running += 1;
  }

  return { done, failed, running, processed: done + failed };
}

export function getStep5TasksFromGlobalTask(state: AppState, task: {
  projectId: string;
  chapterId: string;
  step5Indices?: number[];
}) {
  const chapter = getStep5ProjectChapters(state, task.projectId).find((item) => item.id === task.chapterId);
  const indices = task.step5Indices?.length
    ? task.step5Indices
    : (chapter?.storyboards.map((_, index) => index) ?? []);
  return indices.map((storyboardIndex) => ({ chapterId: task.chapterId, storyboardIndex }));
}
