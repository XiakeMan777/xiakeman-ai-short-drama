import type { AppState, GlobalTask } from '@/types';
import {
  countStoryboardStep4Ready,
  getMissingImageReferenceLabels,
} from '@/lib/storyboardReadiness';

const GLOBAL_TASK_ORDER: Record<GlobalTask['type'], number> = {
  'step1-analysis': 1,
  'step3-batch': 3,
  'step4-batch': 4,
  'step5-batch': 5,
};

export function isActiveGlobalTaskStatus(status: GlobalTask['status']) {
  return status === 'queued' || status === 'running';
}

export function getGlobalTaskOrder(task: Pick<GlobalTask, 'type'>) {
  return GLOBAL_TASK_ORDER[task.type] ?? 99;
}

export function hasBlockingGlobalTaskForChapter(
  tasks: readonly GlobalTask[],
  candidate: Pick<GlobalTask, 'id' | 'type' | 'projectId' | 'chapterId'>,
) {
  const candidateOrder = getGlobalTaskOrder(candidate);
  return tasks.some((task) => {
    if (task.id === candidate.id) return false;
    if (task.projectId !== candidate.projectId || task.chapterId !== candidate.chapterId) return false;
    if (!isActiveGlobalTaskStatus(task.status)) return false;
    if (task.status === 'running') return true;
    return getGlobalTaskOrder(task) < candidateOrder;
  });
}

export function canStartGlobalTask(state: AppState, task: GlobalTask) {
  return !hasBlockingGlobalTaskForChapter(state.globalTasks, task);
}

function findTaskChapter(state: AppState, task: Pick<GlobalTask, 'projectId' | 'chapterId'>) {
  const project = state.projects.find((item) => item.id === task.projectId);
  return project?.chapters.find((item) => item.id === task.chapterId);
}

function getLatestTaskForChapter(
  tasks: readonly GlobalTask[],
  type: GlobalTask['type'],
  task: Pick<GlobalTask, 'projectId' | 'chapterId'>,
) {
  return [...tasks]
    .filter((item) =>
      item.type === type
      && item.projectId === task.projectId
      && item.chapterId === task.chapterId,
    )
    .sort((left, right) => right.createdAt - left.createdAt || right.updatedAt - left.updatedAt)[0];
}

function isTerminalFailure(status: GlobalTask['status'] | undefined) {
  return status === 'failed' || status === 'cancelled';
}

export function getGlobalTaskPermanentBlockReason(state: AppState, task: GlobalTask): string | null {
  if (hasBlockingGlobalTaskForChapter(state.globalTasks, task)) return null;

  const chapter = findTaskChapter(state, task);
  if (!chapter) return '章节不存在，无法启动任务。';

  if (task.type === 'step1-analysis') return null;

  const latestStep1 = getLatestTaskForChapter(state.globalTasks, 'step1-analysis', task);
  if (!chapter.analysis) {
    return isTerminalFailure(latestStep1?.status)
      ? 'Step1 分析未完成或已失败，请先重新完成 Step1。'
      : '缺少 Step1 分析结果，请先完成 Step1。';
  }

  if (task.type === 'step3-batch') return null;

  const latestStep3 = getLatestTaskForChapter(state.globalTasks, 'step3-batch', task);
  const missingReferenceCount = chapter.storyboards.reduce(
    (total, storyboard) => total + getMissingImageReferenceLabels(storyboard.imageRefs).length,
    0,
  );
  if (task.type === 'step4-batch' && isTerminalFailure(latestStep3?.status) && missingReferenceCount > 0) {
    return `Step3 参考图未完成，仍缺少 ${missingReferenceCount} 个分镜参考绑定，请先修复 Step3。`;
  }

  if (task.type === 'step5-batch') {
    const readyCount = countStoryboardStep4Ready(chapter.storyboards);
    const latestStep4 = getLatestTaskForChapter(state.globalTasks, 'step4-batch', task);
    if (readyCount <= 0) {
      return isTerminalFailure(latestStep4?.status)
        ? 'Step4 尚无可提交分镜，且最近一次 Step4 已失败或取消，请先修复 Step4。'
        : 'Step4 尚无可提交分镜，请先完成 Step4。';
    }
  }

  return null;
}
