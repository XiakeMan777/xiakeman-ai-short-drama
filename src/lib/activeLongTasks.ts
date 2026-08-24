import type { AppState, Chapter, StoryboardState } from '@/types';

const STEP4_BUSY_STATUSES = new Set<StoryboardState['status']>([
  'checking',
  'correcting',
  'choreographing',
  'choreo-checking',
  'generating',
  'self-checking',
]);

function hasRunningStoryboardBoard(storyboard: StoryboardState) {
  return Object.values(storyboard.storyboardBoard?.variants ?? {}).some(
    (variant) => variant?.status === 'generating',
  );
}

function hasRunningScenePositionBoard(storyboard: StoryboardState) {
  return storyboard.scenePositionBoard?.status === 'generating';
}

function hasRunningVideoTask(storyboard: StoryboardState) {
  return storyboard.videoStatus === 'submitting' || storyboard.videoStatus === 'polling';
}

function hasRunningTtsTask(storyboard: StoryboardState) {
  return (storyboard.audioMix?.ttsLineGeneration ?? []).some((line) => line?.status === 'generating');
}

function hasRunningStoryboardTask(storyboard: StoryboardState) {
  return STEP4_BUSY_STATUSES.has(storyboard.status)
    || hasRunningStoryboardBoard(storyboard)
    || hasRunningScenePositionBoard(storyboard)
    || hasRunningVideoTask(storyboard)
    || hasRunningTtsTask(storyboard);
}

function hasRunningRenderTask(chapter: Chapter) {
  const status = chapter.postProduction?.renderJob?.status;
  return status === 'queued' || status === 'running';
}

export function hasActiveLongRunningTasks(state: AppState) {
  if (state.globalTasks.some((task) => task.status === 'queued' || task.status === 'running')) return true;
  return state.projects.some((project) =>
    project.chapters.some((chapter) =>
      chapter.step1Task?.running
        || chapter.step3Task?.running
        || chapter.autoGenerate.running
        || hasRunningRenderTask(chapter)
        || Object.values(chapter.sceneSpatialMasters ?? {}).some((master) => master.status === 'generating')
        || chapter.storyboards.some(hasRunningStoryboardTask),
    ),
  );
}
