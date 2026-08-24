import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { toast } from 'sonner';
import { useCurrentProject } from '@/stores/projectStore';
import {
  countStoryboardStep4Ready,
  getMissingImageReferenceLabels,
  isStoryboardPromptReady,
} from '@/lib/storyboardReadiness';
import { DEFAULT_STEP4_OUTPUT_MODE } from '@/lib/storage';
import { getStoryboardBoardSelectedMode, getStoryboardBoardVariant } from '@/lib/storyboardBoardState';
import { cn } from '@/lib/utils';
import { getStep4PhaseLabel, isStoryboardBusy } from '@/components/step4/promptGeneratorUtils';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Download,
  ExternalLink,
  Film,
  GripVertical,
  Layers,
  ListChecks,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  Trash2,
  XCircle,
} from '@/components/icons';
import type { Chapter, GlobalTask, GlobalTaskEvent, StoryboardState, VideoBackendType } from '@/types';
import {
  cancelBackgroundJob,
  getBackgroundJob,
  listBackgroundJobEvents,
  listBackgroundJobs,
  retryBackgroundJob,
  type BackgroundJob,
  type BackgroundJobEvent,
  type BackgroundJobStatus,
  type BackgroundJobType,
} from '@/lib/backgroundJobsClient';
import { createCloudProjectBlobDownloadUrl } from '@/lib/cloudProjectStore';
import { cacheVideoBlob } from '@/components/step5/videoUtils';
import { useAuthSession } from '@/components/auth/useAuthSession';

type TaskSource = 'step1' | 'step3' | 'step4' | 'step5' | 'backend';

type TaskTone = 'running' | 'queued' | 'done' | 'failed' | 'cancelled';

type TaskFilter = 'active' | 'failed' | 'done' | 'all';

type StoryboardRuntimeView = {
  index: number;
  title: string;
  label: string;
  detail: string;
  tone: 'done' | 'active' | 'waiting' | 'queued' | 'error' | 'stale';
  spinning: boolean;
};

type TaskStageCounts = {
  text: number;
  imageQueued: number;
  image: number;
  seedance: number;
  done: number;
  error: number;
};

type GlobalTaskView = {
  id: string;
  projectId: string;
  chapterId: string;
  source: TaskSource;
  step: Chapter['status'];
  status: TaskTone;
  projectName: string;
  chapterTitle: string;
  title: string;
  detail: string;
  progressText: string;
  percent: number;
  currentIndex: number;
  total: number;
  doneCount: number;
  errorCount: number;
  stageCounts: TaskStageCounts;
  storyboards: StoryboardRuntimeView[];
  currentStoryboard?: StoryboardRuntimeView;
  streamStageLabel?: string | null;
  streamStageStartedAt?: number;
  streamStageLastActivityAt?: number;
  streamStageTimeoutMs?: number;
  streamStageTimeoutMode?: 'hard' | 'idle';
  streamTextPreview?: string;
  streamTextLength?: number;
  streamUpdatedAt?: number;
  streamPreviousStageLabel?: string | null;
  streamPreviousTextLength?: number;
  streamPreviousUpdatedAt?: number;
  retryNotice?: GlobalTask['retryNotice'];
  errors: GlobalTask['errors'];
  eventLog?: GlobalTask['eventLog'];
  rawTask?: GlobalTask;
  backgroundJob?: BackgroundJob;
};

type FloatingPanelPosition = {
  left: number;
  bottom: number;
};

type FloatingPanelDragState = {
  startX: number;
  startY: number;
  offsetX: number;
  offsetBottom: number;
  width: number;
  height: number;
};

const FLOATING_PANEL_POSITION_KEY = 'xiakeman.globalTaskFloatingPanel.position';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readStoredFloatingPanelPosition(): FloatingPanelPosition | null {
  try {
    const raw = window.localStorage.getItem(FLOATING_PANEL_POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FloatingPanelPosition>;
    if (typeof parsed.left !== 'number' || typeof parsed.bottom !== 'number') return null;
    if (parsed.left < 0 || parsed.bottom < 0) return null;
    if (parsed.left > window.innerWidth - 96 || parsed.bottom > window.innerHeight - 42) return null;
    return {
      left: parsed.left,
      bottom: parsed.bottom,
    };
  } catch {
    return null;
  }
}

function storeFloatingPanelPosition(position: FloatingPanelPosition) {
  try {
    window.localStorage.setItem(FLOATING_PANEL_POSITION_KEY, JSON.stringify(position));
  } catch {
    // Ignore storage failures; dragging should still work for this session.
  }
}

function isStoryboardDirectorChapter(chapter: Chapter | null) {
  return (chapter?.step4OutputMode ?? DEFAULT_STEP4_OUTPUT_MODE) === 'storyboard-director';
}

function getTaskStatusText(status: TaskTone) {
  if (status === 'queued') return '等待中';
  if (status === 'running') return '运行中';
  if (status === 'done') return '已完成';
  if (status === 'failed') return '失败';
  return '已取消';
}

function isActiveTask(task: GlobalTaskView) {
  return task.status === 'running' || task.status === 'queued';
}

function getTaskSourceLabel(source: TaskSource) {
  if (source === 'step1') return 'Step1';
  if (source === 'step3') return 'Step3';
  if (source === 'step4') return 'Step4';
  if (source === 'backend') return '后台';
  return 'Step5';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getOptionalNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function getBackgroundTaskStatus(status: BackgroundJobStatus): TaskTone {
  if (status === 'succeeded') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'queued' || status === 'paused') return 'queued';
  return 'running';
}

function getBackgroundTaskStep(type: BackgroundJobType): Chapter['status'] {
  if (type === 'step5-videos') return 'videos';
  if (type === 'step6-tts') return 'dubbing';
  if (type === 'step6-bgm' || type === 'step6-render') return 'compositing';
  if (type === 'step3-assets' || type === 'image-generations') return 'assets';
  if (type === 'step1-analysis' || type === 'step2-analysis' || type === 'llm-completions') return 'analyzing';
  return 'generating';
}

function getBackgroundTaskTypeLabel(type: BackgroundJobType) {
  switch (type) {
    case 'step0-series':
      return '系列策划';
    case 'step1-analysis':
      return 'Step1 分析';
    case 'step2-analysis':
      return 'Step2 分析';
    case 'step3-assets':
      return 'Step3 资产';
    case 'step4-storyboards':
      return 'Step4 故事板';
    case 'step5-videos':
      return 'Step5 视频';
    case 'step6-tts':
      return 'Step6 配音';
    case 'step6-bgm':
      return 'Step6 BGM';
    case 'step6-render':
      return 'Step6 成片';
    case 'project-sync':
      return '云端保存';
    case 'llm-completions':
      return 'LLM 回流';
    case 'image-generations':
      return '图片生成';
    default:
      return type;
  }
}

function getBackgroundJobProgress(job: BackgroundJob) {
  const progress = asRecord(job.progress);
  const done = getNumber(progress.done, getNumber(progress.completed, 0));
  const total = Math.max(1, getNumber(progress.total, getNumber(progress.count, 1)));
  const explicitPercent = getNumber(progress.percent, Number.NaN);
  const percent = Number.isFinite(explicitPercent)
    ? Math.max(0, Math.min(100, Math.round(explicitPercent)))
    : job.status === 'succeeded'
      ? 100
      : job.status === 'queued' || job.status === 'paused'
        ? 0
        : Math.max(5, Math.min(95, Math.round((done / total) * 100)));

  return {
    done: Math.min(total, Math.max(0, done)),
    total,
    percent,
    text: Number.isFinite(explicitPercent) && !done
      ? `${percent}%`
      : `${Math.min(total, Math.max(0, done))}/${total}`,
  };
}

function normalizeBackgroundEventLevel(level: BackgroundJobEvent['level']): GlobalTaskEvent['level'] {
  return level === 'debug' ? 'info' : level;
}

function toGlobalTaskEvents(events: BackgroundJobEvent[]): GlobalTaskEvent[] {
  return events.map((event) => ({
    id: `${event.jobId}:${event.seq}`,
    at: Date.parse(event.createdAt) || Date.now(),
    level: normalizeBackgroundEventLevel(event.level),
    label: event.phase || event.message,
    detail: event.phase ? event.message : undefined,
    phase: event.phase,
  }));
}

function isVideoBackendType(value: unknown): value is VideoBackendType {
  return value === 'seedance'
    || value === 'seedancecloud'
    || value === 'xyqagent'
    || value === 'hmapi'
    || value === 'volcengine'
    || value === 'aliyunbailian';
}

function getTaskFilterText(filter: TaskFilter) {
  if (filter === 'active') return '进行中';
  if (filter === 'failed') return '需处理';
  if (filter === 'done') return '已完成';
  return '全部';
}

function getTaskFilterCount(tasks: GlobalTaskView[], filter: TaskFilter) {
  if (filter === 'active') return tasks.filter(isActiveTask).length;
  if (filter === 'failed') return tasks.filter((task) => task.status === 'failed' || task.status === 'cancelled').length;
  if (filter === 'done') return tasks.filter((task) => task.status === 'done').length;
  return tasks.length;
}

function taskMatchesFilter(task: GlobalTaskView, filter: TaskFilter) {
  if (filter === 'active') return isActiveTask(task);
  if (filter === 'failed') return task.status === 'failed' || task.status === 'cancelled';
  if (filter === 'done') return task.status === 'done';
  return true;
}

function taskMatchesQuery(task: GlobalTaskView, query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;
  return [
    task.id,
    task.projectName,
    task.chapterTitle,
    task.title,
    task.detail,
    task.streamStageLabel,
    task.backgroundJob?.type,
    getTaskSourceLabel(task.source),
    getTaskStatusText(task.status),
  ].filter(Boolean).some((value) => String(value).toLowerCase().includes(keyword));
}

function getStep4TaskProgress(input: {
  total: number;
  done: number;
  currentIndex: number;
  status: TaskTone;
}) {
  const total = Math.max(input.total, 1);
  const done = Math.min(total, Math.max(0, input.done));

  return {
    display: done,
    total,
    percent: Math.min(100, Math.round((done / total) * 100)),
  };
}

function getStoryboardRuntimeView(storyboard: StoryboardState, index: number): StoryboardRuntimeView {
  const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const boardVariant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode);
  const hasContinuityForNext = !!(
    storyboard.continuityOutput?.lastFrameInfo?.trim()
    || storyboard.lastFrameInfo?.trim()
  );
  const isBoardImageGenerating = boardVariant?.status === 'generating';
  const isSeedancePromptGenerating = storyboard.seedanceFinalVideoPromptStatus === 'generating';
  const isSeedancePromptDone = storyboard.seedanceFinalVideoPromptStatus === 'done';
  const isSeedancePromptFailed = storyboard.seedanceFinalVideoPromptStatus === 'failed';
  const missingReferenceLabels = getMissingImageReferenceLabels(storyboard.imageRefs);
  const title = storyboard.storyboard.name || `分镜${storyboard.storyboard.number}`;

  if (missingReferenceLabels.length > 0) {
    return {
      index,
      title,
      label: '缺参考图',
      detail: `缺少 ${missingReferenceLabels.length} 张 Step3 参考图`,
      tone: 'error',
      spinning: false,
    };
  }
  if (storyboard.status === 'error') {
    return {
      index,
      title,
      label: '生成失败',
      detail: storyboard.error ?? '需要重新生成',
      tone: 'error',
      spinning: false,
    };
  }
  if (storyboard.status === 'generating' && hasContinuityForNext) {
    if (isBoardImageGenerating && isSeedancePromptGenerating) {
      return {
        index,
        title,
        label: '图片 + 提交词',
        detail: '规划完成，图片与 Seedance 提交词并行',
        tone: 'waiting',
        spinning: true,
      };
    }
    if (isBoardImageGenerating) {
      return {
        index,
        title,
        label: '图片生成中',
        detail: isSeedancePromptDone
          ? '提交词已完成，等待图片返回'
          : isSeedancePromptFailed
            ? '提交词失败，图片仍在生成'
            : '连续性文本已就绪，图片生成中',
        tone: 'waiting',
        spinning: true,
      };
    }
    if (isSeedancePromptGenerating) {
      return {
        index,
        title,
        label: 'Seedance 提交词',
        detail: '规划完成，最终视频词正在回流',
        tone: 'waiting',
        spinning: true,
      };
    }
    return {
      index,
      title,
      label: '等待图片通道',
      detail: '连续性文本已就绪，等待图片任务',
      tone: 'waiting',
      spinning: true,
    };
  }
  if (isSeedancePromptGenerating) {
    return {
      index,
      title,
      label: 'Seedance 提交词',
      detail: '最终视频词正在回流',
      tone: 'active',
      spinning: true,
    };
  }
  if (isStoryboardPromptReady(storyboard)) {
    return {
      index,
      title,
      label: '已完成',
      detail: storyboard.seedanceFinalVideoPromptStatus === 'done'
        ? '故事板与提交词已完成'
        : 'Step4 输出已完成',
      tone: 'done',
      spinning: false,
    };
  }
  if (storyboard.isStale) {
    return {
      index,
      title,
      label: '待刷新',
      detail: '上游内容变化，需要重新生成',
      tone: 'stale',
      spinning: false,
    };
  }
  if (isStoryboardBusy(storyboard.status)) {
    return {
      index,
      title,
      label: getStep4PhaseLabel(storyboard.status),
      detail: '文本链路执行中',
      tone: 'active',
      spinning: true,
    };
  }
  return {
    index,
    title,
    label: '等待队列',
    detail: '等待上一镜连续性文本',
    tone: 'queued',
    spinning: false,
  };
}

function getStageCounts(storyboards: readonly StoryboardState[]): TaskStageCounts {
  return storyboards.reduce((counts, storyboard) => {
    const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
    const boardVariant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode);
    const hasContinuityForNext = !!(
      storyboard.continuityOutput?.lastFrameInfo?.trim()
      || storyboard.lastFrameInfo?.trim()
    );

    if (isStoryboardPromptReady(storyboard)) counts.done += 1;
    if (isStoryboardBusy(storyboard.status) && !(storyboard.status === 'generating' && hasContinuityForNext)) counts.text += 1;
    if (storyboard.status === 'generating' && hasContinuityForNext && boardVariant?.status !== 'generating' && !isStoryboardPromptReady(storyboard)) counts.imageQueued += 1;
    if (boardVariant?.status === 'generating') counts.image += 1;
    if (storyboard.seedanceFinalVideoPromptStatus === 'generating') counts.seedance += 1;
    if (storyboard.status === 'error') counts.error += 1;
    return counts;
  }, {
    text: 0,
    imageQueued: 0,
    image: 0,
    seedance: 0,
    done: 0,
    error: 0,
  });
}

function getTaskCurrentIndex(task: GlobalTask, chapter: Chapter) {
  if (typeof task.streamStoryboardIndex === 'number' && task.streamStoryboardIndex >= 0) {
    return Math.min(chapter.storyboards.length - 1, task.streamStoryboardIndex);
  }
  if (task.currentIndex >= 0) {
    return Math.min(chapter.storyboards.length - 1, task.currentIndex);
  }
  return -1;
}

function getGlobalTaskIdentityKey(task: GlobalTask) {
  return `${task.type}:${task.projectId}:${task.chapterId}`;
}

function getLatestTaskIdsByIdentity(globalTasks: GlobalTask[]) {
  const latest = new Map<string, GlobalTask>();
  for (const task of globalTasks) {
    const key = getGlobalTaskIdentityKey(task);
    const previous = latest.get(key);
    if (!previous || task.createdAt > previous.createdAt || (task.createdAt === previous.createdAt && task.updatedAt > previous.updatedAt)) {
      latest.set(key, task);
    }
  }
  return new Set(Array.from(latest.values()).map((task) => task.id));
}

function collectFloatingTaskViews(
  projects: Array<{ id: string; name: string; chapters: Chapter[] }>,
  globalTasks: GlobalTask[],
): GlobalTaskView[] {
  const tasks: GlobalTaskView[] = [];
  const step4TaskChapterKeys = new Set<string>();
  const step1TaskChapterKeys = new Set<string>();
  const step3TaskChapterKeys = new Set<string>();
  const step5TaskChapterKeys = new Set<string>();
  const latestTaskIds = getLatestTaskIdsByIdentity(globalTasks);

  for (const task of globalTasks) {
    if (!latestTaskIds.has(task.id)) continue;
    const project = projects.find((item) => item.id === task.projectId);
    const chapter = project?.chapters.find((item) => item.id === task.chapterId);
    if (!project || !chapter) continue;
    const chapterKey = `${task.projectId}:${task.chapterId}`;

    if (task.type === 'step1-analysis') {
      step1TaskChapterKeys.add(chapterKey);
      const phaseLabel = task.step1Mode === 'adapted-analysis'
        ? '结构化改编稿'
        : chapter.scriptType === 'novel'
          ? '网文改编与分析'
          : '结构化分析';
      const textLength = task.streamTextLength ?? chapter.step1Task?.streamTextLength ?? 0;
      tasks.push({
        id: task.id,
        projectId: task.projectId,
        chapterId: task.chapterId,
        source: 'step1',
        step: 'scripting',
        status: task.status,
        projectName: project.name,
        chapterTitle: chapter.title,
        title: `${getTaskStatusText(task.status)} · Step1 ${phaseLabel}`,
        detail: `${project.name} / ${chapter.title}`,
        progressText: task.status === 'queued' ? '排队' : textLength > 0 ? `${textLength}字` : '等待回流',
        percent: task.status === 'done' ? 100 : task.status === 'queued' ? 0 : chapter.step1Task?.phase === 'adapting' ? 35 : 65,
        currentIndex: -1,
        total: 1,
        doneCount: task.status === 'done' ? 1 : 0,
        errorCount: task.errors.length,
        stageCounts: getStageCounts([]),
        storyboards: [],
        streamStageLabel: task.streamStageLabel ?? phaseLabel,
        streamStageStartedAt: task.streamStageStartedAt,
        streamStageLastActivityAt: task.streamStageLastActivityAt,
        streamStageTimeoutMs: task.streamStageTimeoutMs,
        streamStageTimeoutMode: task.streamStageTimeoutMode,
        streamTextPreview: task.streamTextPreview ?? chapter.step1Task?.streamTextPreview,
        streamTextLength: task.streamTextLength ?? chapter.step1Task?.streamTextLength,
        streamUpdatedAt: task.streamUpdatedAt ?? chapter.step1Task?.updatedAt,
        streamPreviousStageLabel: task.streamPreviousStageLabel,
        streamPreviousTextLength: task.streamPreviousTextLength,
        streamPreviousUpdatedAt: task.streamPreviousUpdatedAt,
        errors: task.errors,
        eventLog: task.eventLog,
        rawTask: task,
      });
      continue;
    }

    if (task.type === 'step3-batch') {
      step3TaskChapterKeys.add(chapterKey);
      const total = Math.max(task.total || chapter.step3Task?.total || 0, 1);
      const done = Math.max(task.doneCount ?? 0, chapter.step3Task?.done ?? 0);
      const phaseLabel = task.step3Mode === 'lightweight-assets'
        ? '参考图压缩'
        : task.step3Section === 'character'
          ? '角色图片'
          : task.step3Section === 'scene'
            ? '场景图片'
            : task.step3Section === 'prop'
              ? '物品图片'
              : '图片资产';
      tasks.push({
        id: task.id,
        projectId: task.projectId,
        chapterId: task.chapterId,
        source: 'step3',
        step: 'assets',
        status: task.status,
        projectName: project.name,
        chapterTitle: chapter.title,
        title: `${getTaskStatusText(task.status)} · Step3 ${phaseLabel}`,
        detail: chapter.step3Task?.currentLabel
          ? `${chapter.title} · ${chapter.step3Task.currentLabel}`
          : `${project.name} / ${chapter.title}`,
        progressText: task.status === 'queued' ? '排队' : `${done}/${total}`,
        percent: task.status === 'done' ? 100 : task.status === 'queued' ? 0 : Math.min(100, Math.round((done / total) * 100)),
        currentIndex: -1,
        total,
        doneCount: done,
        errorCount: task.errors.length || chapter.step3Task?.failed || 0,
        stageCounts: {
          ...getStageCounts([]),
          image: chapter.step3Task?.phase === 'generate' ? done : 0,
          text: chapter.step3Task?.phase === 'optimize' ? done : 0,
        },
        storyboards: [],
        streamStageLabel: task.streamStageLabel ?? phaseLabel,
        streamStageStartedAt: task.streamStageStartedAt,
        streamStageLastActivityAt: task.streamStageLastActivityAt,
        streamStageTimeoutMs: task.streamStageTimeoutMs,
        streamStageTimeoutMode: task.streamStageTimeoutMode,
        streamTextPreview: task.streamTextPreview ?? chapter.step3Task?.currentLabel ?? '',
        streamTextLength: task.streamTextLength ?? chapter.step3Task?.currentLabel?.length,
        streamUpdatedAt: task.streamUpdatedAt ?? chapter.step3Task?.updatedAt,
        streamPreviousStageLabel: task.streamPreviousStageLabel,
        streamPreviousTextLength: task.streamPreviousTextLength,
        streamPreviousUpdatedAt: task.streamPreviousUpdatedAt,
        errors: task.errors.length > 0 ? task.errors : (chapter.step3Task?.error ? [{ index: 0, error: chapter.step3Task.error }] : []),
        eventLog: task.eventLog,
        rawTask: task,
      });
      continue;
    }

    if (task.type === 'step5-batch') {
      step5TaskChapterKeys.add(chapterKey);
      const targetIndices = task.step5Indices?.length
        ? task.step5Indices
        : chapter.storyboards.map((_, index) => index);
      const videoStoryboards = targetIndices
        .map((index) => chapter.storyboards[index])
        .filter((storyboard): storyboard is StoryboardState => !!storyboard);
      const videoDone = videoStoryboards.filter((storyboard) => storyboard.videoStatus === 'done').length;
      const videoFailed = videoStoryboards.filter((storyboard) => storyboard.videoStatus === 'failed').length;
      const videoRunning = videoStoryboards.filter((storyboard) =>
        storyboard.videoStatus === 'submitting' || storyboard.videoStatus === 'polling',
      ).length;
      const total = Math.max(task.total || videoStoryboards.length || 1, 1);
      const processed = Math.max(task.doneCount ?? 0, videoDone + videoFailed);
      tasks.push({
        id: task.id,
        projectId: task.projectId,
        chapterId: task.chapterId,
        source: 'step5',
        step: 'videos',
        status: task.status,
        projectName: project.name,
        chapterTitle: chapter.title,
        title: `${getTaskStatusText(task.status)} · Step5 视频`,
        detail: `${chapter.title} · ${videoRunning} 个进行中`,
        progressText: `${Math.min(processed, total)}/${total}`,
        percent: task.status === 'done' ? 100 : Math.min(100, Math.round((Math.min(processed, total) / total) * 100)),
        currentIndex: task.currentIndex,
        total,
        doneCount: processed,
        errorCount: task.errors.length || videoFailed,
        stageCounts: getStageCounts(chapter.storyboards),
        storyboards: chapter.storyboards.map(getStoryboardRuntimeView),
        streamStageLabel: task.streamStageLabel ?? '视频生成',
        streamStageStartedAt: task.streamStageStartedAt,
        streamStageLastActivityAt: task.streamStageLastActivityAt,
        streamStageTimeoutMs: task.streamStageTimeoutMs,
        streamStageTimeoutMode: task.streamStageTimeoutMode,
        streamTextPreview: task.streamTextPreview,
        streamTextLength: task.streamTextLength,
        streamUpdatedAt: task.streamUpdatedAt,
        streamPreviousStageLabel: task.streamPreviousStageLabel,
        streamPreviousTextLength: task.streamPreviousTextLength,
        streamPreviousUpdatedAt: task.streamPreviousUpdatedAt,
        errors: task.errors,
        eventLog: task.eventLog,
        rawTask: task,
      });
      continue;
    }

    if (task.type !== 'step4-batch') continue;
    step4TaskChapterKeys.add(chapterKey);

    const total = task.total || chapter.storyboards.length || 1;
    const done = Math.max(task.doneCount ?? 0, countStoryboardStep4Ready(chapter.storyboards));
    const currentIndex = getTaskCurrentIndex(task, chapter);
    const progress = getStep4TaskProgress({ total, done, currentIndex: task.currentIndex, status: task.status });
    const storyboards = chapter.storyboards.map(getStoryboardRuntimeView);
    const stageCounts = getStageCounts(chapter.storyboards);
    const currentStoryboard = currentIndex >= 0 ? storyboards[currentIndex] : undefined;
    const modeLabel = isStoryboardDirectorChapter(chapter) ? 'Step4 故事板' : 'Step4 提示词';

    tasks.push({
      id: task.id,
      projectId: task.projectId,
      chapterId: task.chapterId,
      source: 'step4',
      step: 'generating',
      status: task.status,
      projectName: project.name,
      chapterTitle: chapter.title,
      title: `${getTaskStatusText(task.status)} · ${modeLabel}`,
      detail: currentStoryboard
        ? `${chapter.title} · ${currentStoryboard.title}`
        : `${project.name} / ${chapter.title}`,
      progressText: `${progress.display}/${progress.total}`,
      percent: progress.percent,
      currentIndex,
      total: progress.total,
      doneCount: done,
      errorCount: task.errors.length || stageCounts.error,
      stageCounts,
      storyboards,
      currentStoryboard,
      streamStageLabel: task.streamStageLabel,
      streamStageStartedAt: task.streamStageStartedAt,
      streamStageLastActivityAt: task.streamStageLastActivityAt,
      streamStageTimeoutMs: task.streamStageTimeoutMs,
      streamStageTimeoutMode: task.streamStageTimeoutMode,
      streamTextPreview: task.streamTextPreview,
      streamTextLength: task.streamTextLength,
      streamUpdatedAt: task.streamUpdatedAt,
      streamPreviousStageLabel: task.streamPreviousStageLabel,
      streamPreviousTextLength: task.streamPreviousTextLength,
      streamPreviousUpdatedAt: task.streamPreviousUpdatedAt,
      retryNotice: task.retryNotice,
      errors: task.errors,
      eventLog: task.eventLog,
      rawTask: task,
    });
  }

  for (const project of projects) {
    for (const chapter of project.chapters) {
      if (chapter.step1Task?.running && !step1TaskChapterKeys.has(`${project.id}:${chapter.id}`)) {
        const phaseLabel = chapter.step1Task.phase === 'adapting' ? '网文改编' : '结构化分析';
        const textLength = chapter.step1Task.streamTextLength ?? chapter.step1Task.streamTextPreview?.length ?? 0;
        tasks.push({
          id: `step1:${project.id}:${chapter.id}`,
          projectId: project.id,
          chapterId: chapter.id,
          source: 'step1',
          step: chapter.step1Task.phase === 'adapting' ? 'adapting' : 'scripting',
          status: 'running',
          projectName: project.name,
          chapterTitle: chapter.title,
          title: `运行中 · Step1 ${phaseLabel}`,
          detail: `${project.name} / ${chapter.title}`,
          progressText: textLength > 0 ? `${textLength}字` : '等待',
          percent: chapter.step1Task.phase === 'adapting' ? 35 : 65,
          currentIndex: -1,
          total: 1,
          doneCount: 0,
          errorCount: 0,
          stageCounts: getStageCounts([]),
          storyboards: [],
          streamStageLabel: phaseLabel,
          streamTextPreview: chapter.step1Task.streamTextPreview,
          streamTextLength: chapter.step1Task.streamTextLength,
          streamUpdatedAt: chapter.step1Task.updatedAt,
          errors: chapter.step1Task.error ? [{ index: 0, error: chapter.step1Task.error }] : [],
        });
      }

      if (chapter.step3Task?.running && !step3TaskChapterKeys.has(`${project.id}:${chapter.id}`)) {
        const total = Math.max(chapter.step3Task.total || 0, 1);
        const done = Math.max(0, chapter.step3Task.done || 0);
        const phaseLabel = chapter.step3Task.phase === 'optimize'
          ? 'AI 润色'
          : chapter.step3Task.phase === 'lightweight'
            ? '参考图压缩'
            : '图片生成';
        tasks.push({
          id: `step3:${project.id}:${chapter.id}`,
          projectId: project.id,
          chapterId: chapter.id,
          source: 'step3',
          step: 'assets',
          status: 'running',
          projectName: project.name,
          chapterTitle: chapter.title,
          title: `运行中 · Step3 ${phaseLabel}`,
          detail: chapter.step3Task.currentLabel
            ? `${chapter.title} · ${chapter.step3Task.currentLabel}`
            : `${project.name} / ${chapter.title}`,
          progressText: `${done}/${total}`,
          percent: Math.min(100, Math.round((done / total) * 100)),
          currentIndex: -1,
          total,
          doneCount: done,
          errorCount: chapter.step3Task.failed || 0,
          stageCounts: {
            ...getStageCounts([]),
            image: chapter.step3Task.phase === 'generate' ? done : 0,
            text: chapter.step3Task.phase === 'optimize' ? done : 0,
          },
          storyboards: [],
          streamStageLabel: phaseLabel,
          streamTextPreview: chapter.step3Task.currentLabel ?? '',
          streamTextLength: chapter.step3Task.currentLabel?.length,
          streamUpdatedAt: chapter.step3Task.updatedAt,
          errors: chapter.step3Task.error ? [{ index: 0, error: chapter.step3Task.error }] : [],
        });
      }

      if (chapter.autoGenerate?.running && !step4TaskChapterKeys.has(`${project.id}:${chapter.id}`)) {
        const total = chapter.autoGenerate.total || chapter.storyboards.length || 1;
        const done = Math.max(chapter.autoGenerate.doneCount ?? 0, countStoryboardStep4Ready(chapter.storyboards));
        const progress = getStep4TaskProgress({
          total,
          done,
          currentIndex: chapter.autoGenerate.currentIndex,
          status: 'running',
        });
        const storyboards = chapter.storyboards.map(getStoryboardRuntimeView);
        const currentStoryboard = chapter.autoGenerate.currentIndex >= 0
          ? storyboards[chapter.autoGenerate.currentIndex]
          : undefined;
        const stageCounts = getStageCounts(chapter.storyboards);
        tasks.push({
          id: `step4:${project.id}:${chapter.id}`,
          projectId: project.id,
          chapterId: chapter.id,
          source: 'step4',
          step: 'generating',
          status: 'running',
          projectName: project.name,
          chapterTitle: chapter.title,
          title: isStoryboardDirectorChapter(chapter) ? '运行中 · Step4 故事板' : '运行中 · Step4 提示词',
          detail: `${project.name} / ${chapter.title}`,
          progressText: `${progress.display}/${progress.total}`,
          percent: progress.percent,
          currentIndex: chapter.autoGenerate.currentIndex,
          total: progress.total,
          doneCount: done,
          errorCount: chapter.autoGenerate.errors.length || stageCounts.error,
          stageCounts,
          storyboards,
          currentStoryboard,
          streamStageLabel: currentStoryboard ? getStep4PhaseLabel(currentStoryboard.index >= 0 ? chapter.storyboards[currentStoryboard.index]?.status ?? null : null) : undefined,
          retryNotice: chapter.autoGenerate.retryNotice,
          errors: chapter.autoGenerate.errors,
        });
      }

      const runningVideos = chapter.storyboards.filter((storyboard) =>
        storyboard.videoStatus === 'submitting' || storyboard.videoStatus === 'polling',
      ).length;
      if (runningVideos > 0 && !step5TaskChapterKeys.has(`${project.id}:${chapter.id}`)) {
        const videoTotal = countStoryboardStep4Ready(chapter.storyboards) || chapter.storyboards.length || 1;
        const videoDone = chapter.storyboards.filter((storyboard) => storyboard.videoStatus === 'done').length;
        tasks.push({
          id: `step5:${project.id}:${chapter.id}`,
          projectId: project.id,
          chapterId: chapter.id,
          source: 'step5',
          step: 'videos',
          status: 'running',
          projectName: project.name,
          chapterTitle: chapter.title,
          title: `运行中 · Step5 视频 ${runningVideos} 个`,
          detail: `${project.name} / ${chapter.title}`,
          progressText: `${videoDone}/${videoTotal}`,
          percent: Math.min(100, Math.round((videoDone / Math.max(videoTotal, 1)) * 100)),
          currentIndex: -1,
          total: videoTotal,
          doneCount: videoDone,
          errorCount: 0,
          stageCounts: getStageCounts(chapter.storyboards),
          storyboards: chapter.storyboards.map(getStoryboardRuntimeView),
          errors: [],
        });
      }
    }
  }

  const statusRank: Record<TaskTone, number> = {
    running: 0,
    queued: 1,
    failed: 2,
    cancelled: 3,
    done: 4,
  };
  return tasks.sort((a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9));
}

function collectBackgroundJobTaskViews(
  projects: Array<{ id: string; name: string; chapters: Chapter[] }>,
  jobs: BackgroundJob[],
  eventsByJobId: Record<string, GlobalTaskEvent[]>,
): GlobalTaskView[] {
  const views = jobs.map((job) => {
    const project = projects.find((item) => item.id === job.projectId);
    const chapter = project?.chapters.find((item) => item.id === job.chapterId);
    const input = asRecord(job.input);
    const output = asRecord(job.output);
    const media = asRecord(job.media);
    const outputItems = asArray(output.items).map(asRecord);
    const firstItem = outputItems[0] ?? asRecord(asArray(input.items)[0]);
    const storyboardIndex = Number.isFinite(Number(job.storyboardIndex))
      ? Number(job.storyboardIndex)
      : Number.isFinite(Number(firstItem.storyboardIndex))
        ? Number(firstItem.storyboardIndex)
        : -1;
    const progress = getBackgroundJobProgress(job);
    const status = getBackgroundTaskStatus(job.status);
    const error = asRecord(job.error);
    const errorMessage = getText(error.message || error.error || firstItem.error);
    const typeLabel = getBackgroundTaskTypeLabel(job.type);
    const backend = getText(firstItem.backend || input.backend);
    const outputBlobKey = getText(firstItem.videoBlobKey || firstItem.blobKey || media.outputBlobKey);
    const hasOutputVideo = !!(getText(firstItem.videoUrl) || outputBlobKey);
    const detailParts = [
      chapter?.title || job.chapterId || '全站任务',
      storyboardIndex >= 0 ? `分镜${String(storyboardIndex + 1).padStart(2, '0')}` : '',
      backend ? `通道 ${backend}` : '',
      hasOutputVideo ? '可重拉结果' : '',
    ].filter(Boolean);

    return {
      id: `background:${job.id}`,
      projectId: job.projectId,
      chapterId: job.chapterId ?? '',
      source: 'backend' as const,
      step: getBackgroundTaskStep(job.type),
      status,
      projectName: project?.name || job.projectId,
      chapterTitle: chapter?.title || job.chapterId || typeLabel,
      title: `${getTaskStatusText(status)} · 后台 ${typeLabel}`,
      detail: detailParts.join(' · '),
      progressText: progress.text,
      percent: progress.percent,
      currentIndex: storyboardIndex,
      total: progress.total,
      doneCount: progress.done,
      errorCount: errorMessage ? 1 : 0,
      stageCounts: getStageCounts([]),
      storyboards: [],
      streamStageLabel: getText(asRecord(job.progress).phase || firstItem.status || job.status) || typeLabel,
      streamStageStartedAt: job.startedAt ? Date.parse(job.startedAt) : undefined,
      streamStageLastActivityAt: job.updatedAt ? Date.parse(job.updatedAt) : undefined,
      streamUpdatedAt: job.updatedAt ? Date.parse(job.updatedAt) : undefined,
      errors: errorMessage ? [{ index: storyboardIndex >= 0 ? storyboardIndex : 0, error: errorMessage }] : [],
      eventLog: eventsByJobId[job.id],
      backgroundJob: job,
    } satisfies GlobalTaskView;
  });

  const statusRank: Record<TaskTone, number> = {
    running: 0,
    queued: 1,
    failed: 2,
    cancelled: 3,
    done: 4,
  };
  return views.sort((a, b) =>
    (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9)
    || (Date.parse(b.backgroundJob?.updatedAt ?? '') || 0) - (Date.parse(a.backgroundJob?.updatedAt ?? '') || 0)
  );
}

function getStatusIcon(task: GlobalTaskView) {
  if (task.status === 'running') return Loader2;
  if (task.status === 'done') return CheckCircle2;
  if (task.status === 'failed' || task.status === 'cancelled') return XCircle;
  return Circle;
}

function getStatusIconClass(task: GlobalTaskView) {
  if (task.status === 'running') return 'animate-spin text-cyan-600 dark:text-cyan-300';
  if (task.status === 'done') return 'text-emerald-600 dark:text-emerald-400';
  if (task.status === 'failed') return 'text-rose-600 dark:text-rose-400';
  if (task.status === 'cancelled') return 'text-slate-400 dark:text-muted-foreground';
  return 'text-amber-600 dark:text-amber-300';
}

function getTaskCardClass(task: GlobalTaskView, selected: boolean) {
  if (selected) return 'border-cyan-400 bg-cyan-50 text-cyan-950 shadow-[0_0_0_1px_rgba(8,145,178,.14)] dark:border-cyan-300/60 dark:bg-cyan-400/[0.12] dark:text-cyan-50 dark:shadow-[0_0_0_1px_rgba(34,211,238,.15)]';
  if (task.status === 'failed') return 'border-rose-200 bg-rose-50 text-rose-950 hover:border-rose-300 dark:border-rose-300/35 dark:bg-rose-500/10 dark:text-rose-50 dark:hover:border-rose-300/60';
  if (task.status === 'done') return 'border-emerald-200 bg-emerald-50 text-emerald-950 hover:border-emerald-300 dark:border-emerald-300/30 dark:bg-emerald-500/10 dark:text-emerald-50 dark:hover:border-emerald-300/55';
  if (task.status === 'cancelled') return 'border-slate-200 bg-slate-100 text-slate-700 hover:border-slate-300 dark:border-slate-500/45 dark:bg-slate-900/40 dark:text-slate-300 dark:hover:border-slate-400/60';
  return 'border-slate-200 bg-white/90 text-slate-800 hover:border-cyan-300 hover:bg-cyan-50 dark:border-slate-600/60 dark:bg-slate-950/55 dark:text-slate-300 dark:hover:border-cyan-300/45 dark:hover:bg-cyan-400/10';
}

function getStoryboardToneClass(tone: StoryboardRuntimeView['tone']) {
  if (tone === 'done') return 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-300/30 dark:bg-emerald-500/10 dark:text-emerald-50';
  if (tone === 'active') return 'border-cyan-200 bg-cyan-50 text-cyan-900 dark:border-cyan-300/35 dark:bg-cyan-500/10 dark:text-cyan-50';
  if (tone === 'waiting') return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-300/30 dark:bg-amber-500/10 dark:text-amber-50';
  if (tone === 'error') return 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-300/35 dark:bg-rose-500/10 dark:text-rose-50';
  if (tone === 'stale') return 'border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-300/35 dark:bg-orange-500/10 dark:text-orange-50';
  return 'border-slate-200 bg-white/90 text-slate-600 dark:border-slate-700 dark:bg-slate-950/55 dark:text-slate-300';
}

function formatUpdatedAt(timestamp: number | undefined) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function formatElapsedDuration(ms: number | undefined) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '--:--';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getTaskErrorSubject(task: GlobalTaskView, index: number | undefined) {
  if (task.source === 'step4') {
    return `分镜${String((index ?? 0) + 1).padStart(2, '0')}`;
  }
  if (task.source === 'step1') return 'Step1';
  if (task.source === 'step3') return 'Step3';
  if (task.source === 'step5') return 'Step5';
  return '任务';
}

export function GlobalTaskFloatingPanel({ onOpenChapter }: { onOpenChapter: () => void }) {
  const { state, dispatch } = useCurrentProject();
  const { user: authUser, checking: authChecking } = useAuthSession();
  const [open, setOpen] = useState(false);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all');
  const [taskSearchQuery, setTaskSearchQuery] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [position, setPosition] = useState<FloatingPanelPosition | null>(() => readStoredFloatingPanelPosition());
  const [backgroundJobs, setBackgroundJobs] = useState<BackgroundJob[]>([]);
  const [backgroundJobEvents, setBackgroundJobEvents] = useState<Record<string, GlobalTaskEvent[]>>({});
  const [backgroundJobsLoading, setBackgroundJobsLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<FloatingPanelDragState | null>(null);
  const dragMovedRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const frontendTasks = useMemo(
    () => collectFloatingTaskViews(state.projects, state.globalTasks),
    [state.globalTasks, state.projects],
  );
  const backgroundTasks = useMemo(
    () => collectBackgroundJobTaskViews(state.projects, backgroundJobs, backgroundJobEvents),
    [backgroundJobEvents, backgroundJobs, state.projects],
  );
  const tasks = useMemo(
    () => [...frontendTasks, ...backgroundTasks],
    [backgroundTasks, frontendTasks],
  );
  const filteredTasks = useMemo(
    () => tasks.filter((task) => taskMatchesFilter(task, taskFilter) && taskMatchesQuery(task, taskSearchQuery)),
    [taskFilter, taskSearchQuery, tasks],
  );
  const activeCount = tasks.filter(isActiveTask).length;
  const runningCount = tasks.filter((task) => task.status === 'running').length;
  const queuedCount = tasks.filter((task) => task.status === 'queued').length;
  const failedCount = tasks.filter((task) => task.status === 'failed').length;
  const cancelledCount = tasks.filter((task) => task.status === 'cancelled').length;
  const doneCount = tasks.filter((task) => task.status === 'done').length;
  const hasFinishedTasks = state.globalTasks.some((task) =>
    task.status === 'done' || task.status === 'failed' || task.status === 'cancelled',
  );
  const hiddenTaskCount = Math.max(0, tasks.length - filteredTasks.length);
  const selectedTask = filteredTasks.find((task) => task.id === selectedTaskId) ?? filteredTasks[0] ?? null;
  const [stageNow, setStageNow] = useState(() => Date.now());
  const taskFilters: TaskFilter[] = ['all', 'active', 'failed', 'done'];
  const cancellableTasks = tasks.filter((task) => (task.rawTask || task.backgroundJob) && isActiveTask(task));
  const retryableFailedTasks = tasks.filter((task) =>
    (task.rawTask || task.backgroundJob) && (task.status === 'failed' || task.status === 'cancelled')
  );
  const selectedStageElapsedMs = selectedTask?.streamStageStartedAt
    ? Math.max(0, stageNow - selectedTask.streamStageStartedAt)
    : undefined;
  const selectedStageIdleElapsedMs = selectedTask?.streamStageLastActivityAt
    ? Math.max(0, stageNow - selectedTask.streamStageLastActivityAt)
    : selectedStageElapsedMs;
  const selectedTaskUsesBackendStageOnly = false;
  const selectedStageProgress = !selectedTaskUsesBackendStageOnly && selectedTask?.streamStageTimeoutMs && selectedStageElapsedMs !== undefined
    ? Math.min(100, Math.max(4, (((selectedTask.streamStageTimeoutMode === 'idle'
      ? selectedStageIdleElapsedMs
      : selectedStageElapsedMs) ?? 0) / selectedTask.streamStageTimeoutMs) * 100))
    : undefined;
  const selectedStageNearTimeout = selectedStageProgress !== undefined && selectedStageProgress >= 85;
  const selectedDisplayStreamTextLength = selectedTask
    ? ((selectedTask.streamTextLength ?? 0) > 0
      ? (selectedTask.streamTextLength ?? 0)
      : (selectedTask.streamPreviousTextLength ?? 0))
    : 0;
  const selectedPreviousStreamHint = selectedTask
    && (selectedTask.streamTextLength ?? 0) === 0
    && selectedTask.streamPreviousStageLabel
    && selectedTask.streamPreviousTextLength
    ? `${selectedTask.streamPreviousStageLabel} ${selectedTask.streamPreviousTextLength} 字`
    : null;
  const selectedTaskRecentEvents = selectedTask?.eventLog?.slice(-8).reverse() ?? [];
  const hasActiveBackgroundJobs = backgroundJobs.some((job) =>
    job.status === 'queued' || job.status === 'running' || job.status === 'paused'
  );

  const loadBackgroundJobs = useCallback(async (options?: { quiet?: boolean }) => {
    if (authChecking || !authUser) {
      setBackgroundJobs([]);
      setBackgroundJobsLoading(false);
      return;
    }
    setBackgroundJobsLoading(true);
    try {
      const { jobs } = await listBackgroundJobs({ limit: 200 });
      setBackgroundJobs(jobs);
    } catch (error) {
      if (!options?.quiet) {
        const message = error instanceof Error ? error.message : String(error);
        toast.warning(`后台任务读取失败：${message}`);
      }
    } finally {
      setBackgroundJobsLoading(false);
    }
  }, [authChecking, authUser]);

  useEffect(() => {
    if (!position) return;
    storeFloatingPanelPosition(position);
  }, [position]);

  useEffect(() => {
    if (authChecking || !authUser) return;
    void loadBackgroundJobs({ quiet: true });
  }, [authChecking, authUser, loadBackgroundJobs]);

  useEffect(() => {
    if (authChecking || !authUser) return undefined;
    if (!open && !hasActiveBackgroundJobs) return undefined;
    const intervalMs = hasActiveBackgroundJobs ? 10_000 : 30_000;
    const timer = window.setInterval(() => {
      void loadBackgroundJobs({ quiet: true });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [authChecking, authUser, hasActiveBackgroundJobs, loadBackgroundJobs, open]);

  useEffect(() => {
    const jobId = selectedTask?.backgroundJob?.id;
    if (!jobId) return undefined;
    let cancelled = false;
    listBackgroundJobEvents(jobId, 80)
      .then(({ events }) => {
        if (cancelled) return;
        setBackgroundJobEvents((previous) => ({
          ...previous,
          [jobId]: toGlobalTaskEvents(events),
        }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selectedTask?.backgroundJob?.id]);

  useEffect(() => {
    if (!selectedTask?.streamStageStartedAt || selectedTask.status !== 'running') return undefined;
    setStageNow(Date.now());
    const timer = window.setInterval(() => setStageNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [selectedTask?.streamStageStartedAt, selectedTask?.status]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;
      const moved = Math.abs(event.clientX - dragState.startX) + Math.abs(event.clientY - dragState.startY) > 4;
      if (!moved && !dragMovedRef.current) return;
      dragMovedRef.current = true;

      const maxLeft = Math.max(12, window.innerWidth - dragState.width - 12);
      const maxBottom = Math.max(12, window.innerHeight - dragState.height - 12);
      const nextLeft = clamp(event.clientX - dragState.offsetX, 12, maxLeft);
      const nextBottom = clamp(window.innerHeight - event.clientY - dragState.offsetBottom, 12, maxBottom);

      setPosition({ left: nextLeft, bottom: nextBottom });
    };

    const handlePointerUp = () => {
      if (dragMovedRef.current) {
        suppressNextClickRef.current = true;
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 0);
      }
      dragStateRef.current = null;
      dragMovedRef.current = false;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  const startPanelDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetBottom: rect.bottom - event.clientY,
      width: rect.width,
      height: rect.height,
    };
    dragMovedRef.current = false;
  };

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    const handleOpenPanel = () => setOpen(true);
    window.addEventListener('xiakeman:open-global-task-panel', handleOpenPanel);
    return () => {
      window.removeEventListener('xiakeman:open-global-task-panel', handleOpenPanel);
    };
  }, []);

  if (tasks.length === 0) return null;

  const handleOpenTask = (task: GlobalTaskView) => {
    onOpenChapter();
    if (!task.chapterId) {
      dispatch({ type: 'SWITCH_PROJECT', projectId: task.projectId });
      return;
    }
    dispatch({ type: 'SWITCH_CHAPTER', projectId: task.projectId, chapterId: task.chapterId });
    dispatch({ type: 'SET_CHAPTER_STATUS', projectId: task.projectId, chapterId: task.chapterId, status: task.step });
    setSelectedTaskId(task.id);
  };

  const handleOpenTaskStoryboard = (task: GlobalTaskView, storyboardIndex: number) => {
    handleOpenTask(task);
    dispatch({ type: 'SET_CURRENT_STORYBOARD_INDEX', index: storyboardIndex });
  };

  const handleTaskAction = (task: GlobalTaskView) => {
    if (task.backgroundJob) {
      if (task.status === 'queued' || task.status === 'running') {
        cancelBackgroundJob(task.backgroundJob.id, '用户在任务中心取消后台任务')
          .then(() => {
            toast.success('后台任务已取消');
            return loadBackgroundJobs({ quiet: true });
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(`后台任务取消失败：${message}`);
          });
      }
      return;
    }
    if (task.status === 'queued' || task.status === 'running') {
      dispatch({ type: 'CANCEL_GLOBAL_TASK', taskId: task.id });
      return;
    }
    if (task.rawTask) dispatch({ type: 'REMOVE_GLOBAL_TASK', taskId: task.id });
  };

  const handleRetryTask = (task: GlobalTaskView) => {
    if (task.backgroundJob) {
      retryBackgroundJob(task.backgroundJob.id, '用户在任务中心手动重试后台任务')
        .then(() => {
          toast.success('后台任务已重新加入队列');
          setTaskFilter('active');
          return loadBackgroundJobs({ quiet: true });
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          toast.error(`后台任务重试失败：${message}`);
        });
      return;
    }
    const project = state.projects.find((item) => item.id === task.projectId);
    const chapter = project?.chapters.find((item) => item.id === task.chapterId);
    if (!chapter) return;
    if (task.source === 'step1') {
      dispatch({
        type: 'QUEUE_STEP1_TASK',
        projectId: task.projectId,
        chapterId: task.chapterId,
        mode: task.rawTask?.step1Mode ?? 'auto',
      });
      return;
    }
    if (task.source === 'step3') {
      dispatch({
        type: 'QUEUE_STEP3_BATCH_TASK',
        projectId: task.projectId,
        chapterId: task.chapterId,
        total: Math.max(1, task.total || chapter.step3Task?.total || 1),
        mode: task.rawTask?.step3Mode ?? 'all-images',
        section: task.rawTask?.step3Section,
        includeOutfitVariants: task.rawTask?.step3IncludeOutfitVariants,
      });
      return;
    }
    if (task.source === 'step5') {
      const retryIndices = task.rawTask?.step5Indices?.filter((index) =>
        chapter.storyboards[index]?.videoStatus !== 'done'
      ) ?? chapter.storyboards
        .map((storyboard, index) => (isStoryboardPromptReady(storyboard) && storyboard.videoStatus !== 'done' ? index : -1))
        .filter((index) => index >= 0);
      dispatch({
        type: 'QUEUE_STEP5_BATCH_TASK',
        projectId: task.projectId,
        chapterId: task.chapterId,
        total: Math.max(1, retryIndices.length || task.total || chapter.storyboards.length || 1),
        indices: retryIndices.length > 0 ? retryIndices : task.rawTask?.step5Indices,
        backend: task.rawTask?.step5Backend,
      });
      return;
    }
    dispatch({
      type: 'QUEUE_STEP4_BATCH_TASK',
      projectId: task.projectId,
      chapterId: task.chapterId,
      total: chapter.storyboards.length,
      doneCount: countStoryboardStep4Ready(chapter.storyboards),
      storyboardDirectorRunMode: chapter.storyboardDirectorRunMode,
    });
  };

  const handlePullBackgroundStep5Result = async (task: GlobalTaskView) => {
    const sourceJob = task.backgroundJob;
    if (!sourceJob || sourceJob.type !== 'step5-videos') return;

    try {
      const { job } = await getBackgroundJob(sourceJob.id);
      if (job.status !== 'succeeded') {
        toast.warning('这个后台视频任务还没有完成，暂时不能重拉结果。');
        return;
      }

      const input = asRecord(job.input);
      const output = asRecord(job.output);
      const media = asRecord(job.media);
      const outputItems = asArray(output.items).map(asRecord);
      const inputItems = asArray(input.items).map(asRecord);
      const fallbackItem = outputItems[0] ?? inputItems[0] ?? {};
      const targetStoryboardIndex = Number.isFinite(Number(job.storyboardIndex))
        ? Number(job.storyboardIndex)
        : Number.isFinite(Number(fallbackItem.storyboardIndex))
          ? Number(fallbackItem.storyboardIndex)
          : task.currentIndex;
      const item = outputItems.find((candidate) => Number(candidate.storyboardIndex) === targetStoryboardIndex)
        ?? fallbackItem;
      const chapterId = job.chapterId || task.chapterId;
      if (!chapterId || targetStoryboardIndex < 0) {
        toast.warning('后台任务缺少章节或分镜编号，无法自动绑定结果。');
        return;
      }

      const outputBlobKey = getText(item.videoBlobKey || item.blobKey || media.outputBlobKey);
      let videoUrl = getText(item.videoUrl);
      if (outputBlobKey) {
        try {
          videoUrl = await createCloudProjectBlobDownloadUrl(job.projectId, outputBlobKey);
        } catch (error) {
          if (!videoUrl) throw error;
        }
      }
      if (!videoUrl) {
        toast.warning('后台任务已完成，但没有找到可用视频地址或云端 blobKey。');
        return;
      }

      const rawBackend = item.backend || input.backend;
      const backend = isVideoBackendType(rawBackend) ? rawBackend : 'seedancecloud';
      const rawProductionMode = getText(item.productionMode || item.production_mode);
      const duration = getOptionalNumber(item.duration ?? input.duration);
      const extendSourceIndex = getOptionalNumber(item.sourceStoryboardIndex ?? item.source_storyboard_index);

      dispatch({
        type: 'SUBMIT_VIDEO',
        index: targetStoryboardIndex,
        taskId: `background:${job.id}`,
        clientTaskId: getText(item.clientTaskId || item.client_task_id) || undefined,
        submittedAt: job.startedAt ? Date.parse(job.startedAt) : undefined,
        duration,
        chapterId,
        backend,
        productionMode: rawProductionMode === 'extend' ? 'extend' : 'normal',
        continuityGroupId: getText(item.continuityGroupId || item.continuity_group_id) || undefined,
        continuityReason: getText(item.continuityReason || item.continuity_reason) || undefined,
        extendSourceIndex,
        extendSourceTaskId: getText(item.sourceTaskId || item.source_task_id) || undefined,
        extendSourceBlobKey: getText(item.sourceBlobKey || item.source_blob_key) || undefined,
        extendSubmittedAsExtend: rawProductionMode === 'extend' ? true : undefined,
      });

      const result = await cacheVideoBlob(videoUrl, targetStoryboardIndex, chapterId, dispatch, {
        completedAt: job.completedAt ? Date.parse(job.completedAt) : Date.now(),
      });
      if (result.mode === 'cached') {
        toast.success('已从后台任务重拉视频，并写回当前分镜。');
      } else {
        toast.warning(`已绑定后台视频结果${result.reason ? `，但本机缓存未写入：${result.reason}` : '。'}`);
      }
      await loadBackgroundJobs({ quiet: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`后台结果重拉失败：${message}`);
    }
  };

  const handleCancelActiveTasks = () => {
    cancellableTasks.forEach((task) => {
      handleTaskAction(task);
    });
  };

  const handleRetryFailedTasks = () => {
    retryableFailedTasks.forEach(handleRetryTask);
    setTaskFilter('active');
    setTaskSearchQuery('');
  };

  const handleExportTaskLog = () => {
    const exportedAt = new Date();
    const payload = {
      exportedAt: exportedAt.toISOString(),
      summary: {
        total: tasks.length,
        running: runningCount,
        queued: queuedCount,
        failed: failedCount,
        cancelled: cancelledCount,
        done: doneCount,
      },
      tasks: tasks.map((task) => ({
        id: task.id,
        source: task.source,
        status: task.status,
        projectName: task.projectName,
        chapterTitle: task.chapterTitle,
        title: task.title,
        detail: task.detail,
        progressText: task.progressText,
        doneCount: task.doneCount,
        total: task.total,
        errorCount: task.errorCount,
        stream: {
          stageLabel: task.streamStageLabel,
          textLength: task.streamTextLength,
          updatedAt: task.streamUpdatedAt,
          previousStageLabel: task.streamPreviousStageLabel,
          previousTextLength: task.streamPreviousTextLength,
          previousUpdatedAt: task.streamPreviousUpdatedAt,
        },
        retryNotice: task.retryNotice,
        errors: task.errors,
        eventLog: task.eventLog ?? task.rawTask?.eventLog ?? [],
        rawTask: task.rawTask,
        backgroundJob: task.backgroundJob,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `xiakeman-task-log-${exportedAt.toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const selectedTaskCanStop = !!(selectedTask?.rawTask || selectedTask?.backgroundJob)
    && (selectedTask.status === 'running' || selectedTask.status === 'queued');
  const selectedTaskCanRetry = !!(selectedTask?.rawTask || selectedTask?.backgroundJob)
    && (selectedTask.status === 'failed' || selectedTask.status === 'cancelled');
  const selectedTaskCanPullResult = selectedTask?.backgroundJob?.type === 'step5-videos'
    && selectedTask.status === 'done';

  return (
    <div
      ref={rootRef}
      className={cn(
        'global-task-floating-panel fixed z-50 flex max-w-[calc(100vw-1rem)] flex-col items-end gap-3',
        position ? '' : 'bottom-5 right-5',
      )}
      style={position ? { left: position.left, bottom: position.bottom } : undefined}
    >
      {open && (
        <div className="w-[min(780px,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-cyan-200 bg-white/95 text-slate-900 shadow-2xl shadow-slate-900/20 backdrop-blur-xl dark:border-cyan-300/25 dark:bg-slate-950/95 dark:text-slate-50 dark:shadow-black/35">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-white/10">
            <div
              className="flex min-w-0 flex-1 cursor-grab items-center gap-2 active:cursor-grabbing"
              onPointerDown={startPanelDrag}
              title="拖动移动全局总控"
            >
              <GripVertical className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
              <ListChecks className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-300" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">全局任务总控</div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  运行 {runningCount} · 排队 {queuedCount} · 失败 {failedCount} · 取消 {cancelledCount} · 已完成 {doneCount}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {cancellableTasks.length > 0 && (
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={handleCancelActiveTasks}
                  className="rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-medium text-rose-700 shadow-sm transition hover:border-rose-300 hover:bg-rose-100 dark:border-rose-300/25 dark:bg-rose-500/10 dark:text-rose-50 dark:hover:bg-rose-500/20"
                  title="停止所有正在运行或排队的任务"
                >
                  停止全部
                </button>
              )}
              {retryableFailedTasks.length > 0 && (
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={handleRetryFailedTasks}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-300/25 dark:bg-emerald-500/10 dark:text-emerald-50 dark:hover:bg-emerald-500/20"
                  title="把失败或已取消的任务重新加入队列"
                >
                  重试失败
                </button>
              )}
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => void loadBackgroundJobs()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                title="刷新后台 jobs 和任务中心状态"
              >
                <RotateCcw className={cn('h-3.5 w-3.5', backgroundJobsLoading ? 'animate-spin' : '')} />
                刷新
              </button>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={handleExportTaskLog}
                className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-2.5 py-1.5 text-[11px] font-medium text-cyan-700 shadow-sm transition hover:border-cyan-300 hover:bg-cyan-100 dark:border-cyan-300/25 dark:bg-cyan-500/10 dark:text-cyan-50 dark:hover:bg-cyan-500/20"
                title="导出当前任务总控日志"
              >
                <Download className="h-3.5 w-3.5" />
                导出
              </button>
              {hasFinishedTasks && (
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => dispatch({ type: 'CLEAR_FINISHED_GLOBAL_TASKS' })}
                  className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                  title="清理已结束任务"
                >
                  清理
                </button>
              )}
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                title="收起总控"
                aria-label="收起全局任务总控"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid max-h-[min(680px,calc(100vh-6rem))] grid-cols-1 overflow-hidden md:grid-cols-[290px_minmax(0,1fr)]">
            <div className="max-h-[min(680px,calc(100vh-6rem))] space-y-3 overflow-y-auto border-b border-slate-200 bg-slate-50/70 p-3 md:border-b-0 md:border-r dark:border-white/10 dark:bg-transparent">
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={taskSearchQuery}
                    onChange={(event) => setTaskSearchQuery(event.target.value)}
                    className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:focus:border-cyan-300/60 dark:focus:ring-cyan-300/10"
                    placeholder="搜索项目、章节或步骤"
                  />
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {taskFilters.map((filter) => {
                    const selected = taskFilter === filter;
                    const count = getTaskFilterCount(tasks, filter);
                    return (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setTaskFilter(filter)}
                        className={cn(
                          'rounded-lg border px-2 py-1.5 text-[10px] font-semibold transition',
                          selected
                            ? 'border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-300/45 dark:bg-cyan-300/10 dark:text-cyan-50'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-cyan-200 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:text-white',
                        )}
                      >
                        {getTaskFilterText(filter)}
                        <span className="ml-1 opacity-70">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {filteredTasks.map((task) => {
                const StatusIcon = getStatusIcon(task);
                const selected = task.id === selectedTask?.id;
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => setSelectedTaskId(task.id)}
                    className={cn(
                      'w-full rounded-xl border p-3 text-left transition',
                      getTaskCardClass(task, selected),
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <StatusIcon className={cn('mt-0.5 h-4 w-4 shrink-0', getStatusIconClass(task))} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-950 dark:text-white">
                            {task.chapterTitle}
                          </span>
                          <span className="shrink-0 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-bold text-cyan-800 dark:bg-white/10 dark:text-cyan-100">
                            {task.progressText}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">{task.title}</p>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all duration-500',
                              task.status === 'failed'
                                ? 'bg-rose-400'
                                : task.status === 'done'
                                  ? 'bg-emerald-400'
                                  : 'bg-cyan-300',
                            )}
                            style={{ width: `${Math.max(5, task.percent)}%` }}
                          />
                        </div>
                        {task.currentStoryboard && (
                          <p className="mt-2 line-clamp-1 text-[10px] text-slate-500 dark:text-slate-500">
                            {String(task.currentStoryboard.index + 1).padStart(2, '0')} · {task.currentStoryboard.label}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
              {filteredTasks.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-6 text-center text-xs text-slate-500 dark:border-white/15 dark:bg-white/[0.03] dark:text-slate-400">
                  没有匹配的任务
                </div>
              )}
              {hiddenTaskCount > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-[11px] text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                  已隐藏 {hiddenTaskCount} 个较早结束任务，可点“清理”收起历史。
                </div>
              )}
            </div>

            <div className="min-w-0 space-y-4 overflow-y-auto p-4">
              {selectedTask ? (
                <>
              <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-800 dark:border-cyan-300/25 dark:bg-cyan-300/10 dark:text-cyan-100">
                        {getTaskStatusText(selectedTask.status)}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                        {selectedTask.projectName}
                      </span>
                    </div>
                    <h3 className="mt-3 truncate text-lg font-semibold text-slate-950 dark:text-white">{selectedTask.chapterTitle}</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{selectedTask.detail}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenTask(selectedTask)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3 text-xs font-semibold text-cyan-800 transition hover:border-cyan-300 hover:bg-cyan-100 dark:border-cyan-300/25 dark:bg-cyan-300/10 dark:text-cyan-50 dark:hover:bg-cyan-300/20"
                      title="打开任务所在章节"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      打开章节
                    </button>
                    {selectedTaskCanStop && (
                      <button
                        type="button"
                        onClick={() => handleTaskAction(selectedTask)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 dark:border-rose-300/25 dark:bg-rose-500/10 dark:text-rose-50 dark:hover:bg-rose-500/20"
                        title="停止当前任务"
                      >
                        <Square className="h-3.5 w-3.5" />
                        停止
                      </button>
                    )}
                    {selectedTaskCanRetry && (
                      <button
                        type="button"
                        onClick={() => handleRetryTask(selectedTask)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-300/25 dark:bg-emerald-500/10 dark:text-emerald-50 dark:hover:bg-emerald-500/20"
                        title={selectedTask.source === 'backend' ? '重新加入后台队列' : '重新加入队列'}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {selectedTask.source === 'backend' ? '重试后台' : '重试剩余'}
                      </button>
                    )}
                    {selectedTaskCanPullResult && (
                      <button
                        type="button"
                        onClick={() => void handlePullBackgroundStep5Result(selectedTask)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3 text-xs font-semibold text-cyan-800 transition hover:border-cyan-300 hover:bg-cyan-100 dark:border-cyan-300/25 dark:bg-cyan-300/10 dark:text-cyan-50 dark:hover:bg-cyan-300/20"
                        title="从后台任务重新拉取视频结果并绑定到分镜"
                      >
                        <Download className="h-3.5 w-3.5" />
                        重拉结果
                      </button>
                    )}
                    {selectedTask.source === 'step4' && !selectedTaskCanStop && !selectedTaskCanRetry && (
                      <button
                        type="button"
                        onClick={() => handleTaskAction(selectedTask)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                        title="移除任务"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        移除
                      </button>
                    )}
                  </div>
                </div>

                {selectedTask.storyboards.length > 0 ? (
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-slate-950/50">
                      <div className="text-[10px] text-slate-500 dark:text-slate-500">完成</div>
                      <div className="mt-1 text-base font-semibold text-emerald-700 dark:text-emerald-200">{selectedTask.doneCount}/{selectedTask.total}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-slate-950/50">
                      <div className="text-[10px] text-slate-500 dark:text-slate-500">文本</div>
                      <div className="mt-1 text-base font-semibold text-cyan-700 dark:text-cyan-100">{selectedTask.stageCounts.text}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-slate-950/50">
                      <div className="text-[10px] text-slate-500 dark:text-slate-500">图片</div>
                      <div className="mt-1 text-base font-semibold text-amber-700 dark:text-amber-100">{selectedTask.stageCounts.image}</div>
                      <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-500">排队 {selectedTask.stageCounts.imageQueued}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-slate-950/50">
                      <div className="text-[10px] text-slate-500 dark:text-slate-500">提交词</div>
                      <div className="mt-1 text-base font-semibold text-violet-700 dark:text-violet-100">{selectedTask.stageCounts.seedance}</div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-slate-950/50">
                    <div className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                      <span>{selectedTask.streamStageLabel || '当前阶段'}</span>
                      <span>{selectedTask.progressText}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div className="h-full rounded-full bg-cyan-400 transition-all duration-500" style={{ width: `${Math.max(5, selectedTask.percent)}%` }} />
                    </div>
                  </div>
                )}
              </div>

              {(selectedTask.retryNotice || selectedTask.errors.length > 0) && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-300/25 dark:bg-amber-500/10 dark:text-amber-50">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0">
                      {selectedTask.retryNotice ? (
                        <p>
                          {getTaskErrorSubject(selectedTask, selectedTask.retryNotice.index)} 正在自动重试 {selectedTask.retryNotice.attempt}/{selectedTask.retryNotice.maxRetries}：
                          {selectedTask.retryNotice.error}
                        </p>
                      ) : (
                        <p>
                          最近失败：{getTaskErrorSubject(selectedTask, selectedTask.errors.at(-1)?.index)} · {selectedTask.errors.at(-1)?.error}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {selectedTaskRecentEvents.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-950 dark:text-white">事件日志</div>
                    <span className="text-[10px] text-slate-500 dark:text-slate-500">最近 {selectedTaskRecentEvents.length} 条</span>
                  </div>
                  <div className="space-y-1.5">
                    {selectedTaskRecentEvents.map((event) => (
                      <div
                        key={event.id}
                        className={cn(
                          'rounded-xl border px-2.5 py-2 text-xs',
                          event.level === 'error'
                            ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-300/30 dark:bg-rose-500/10 dark:text-rose-50'
                            : event.level === 'retry' || event.level === 'warning'
                              ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-300/25 dark:bg-amber-500/10 dark:text-amber-50'
                              : event.level === 'success'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-300/25 dark:bg-emerald-500/10 dark:text-emerald-50'
                                : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-200',
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold">{event.label}</span>
                          <span className="text-[10px] opacity-70">{formatUpdatedAt(event.at)}</span>
                        </div>
                        {event.detail && (
                          <div className="mt-1 line-clamp-2 opacity-80">{event.detail}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedTask.storyboards.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-white">
                    <Layers className="h-4 w-4 text-cyan-600 dark:text-cyan-200" />
                    当前回流
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {selectedTask.streamUpdatedAt && (
                      <span className="text-[10px] text-slate-500 dark:text-slate-500">更新 {formatUpdatedAt(selectedTask.streamUpdatedAt)}</span>
                    )}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-slate-950/70">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-cyan-100 px-2 py-0.5 font-semibold text-cyan-800 dark:bg-cyan-300/10 dark:text-cyan-100">
                      {selectedTask.streamStageLabel || selectedTask.currentStoryboard?.label || '等待回流'}
                    </span>
                    {selectedTask.currentStoryboard && (
                      <span className="text-slate-600 dark:text-slate-400">
                        分镜{String(selectedTask.currentStoryboard.index + 1).padStart(2, '0')} · {selectedTask.currentStoryboard.title}
                      </span>
                    )}
                    {selectedTaskUsesBackendStageOnly ? (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 font-medium text-slate-700 dark:bg-white/10 dark:text-slate-200">
                        任务运行中，等待当前阶段完成
                      </span>
                    ) : (
                      <span className="text-slate-500 dark:text-slate-500">已回流 {selectedDisplayStreamTextLength} 字</span>
                    )}
                    {!selectedTaskUsesBackendStageOnly && selectedPreviousStreamHint && (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-600 dark:bg-white/10 dark:text-slate-300">
                        上一阶段 {selectedPreviousStreamHint}
                      </span>
                    )}
                    {selectedStageElapsedMs !== undefined && (
                      <span className={cn(
                        'rounded-full px-2 py-0.5 font-medium',
                        selectedStageNearTimeout
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-100'
                          : 'bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-200',
                      )}>
                        已用 {formatElapsedDuration(selectedStageElapsedMs)}
                        {!selectedTaskUsesBackendStageOnly && selectedTask.streamStageTimeoutMs && selectedTask.streamStageTimeoutMode === 'hard'
                          ? ` / 上限 ${formatElapsedDuration(selectedTask.streamStageTimeoutMs)}`
                          : ''}
                        {!selectedTaskUsesBackendStageOnly && selectedTask.streamStageTimeoutMs && selectedTask.streamStageTimeoutMode === 'idle'
                          ? ` · 静默 ${formatElapsedDuration(selectedStageIdleElapsedMs)} / ${formatElapsedDuration(selectedTask.streamStageTimeoutMs)}`
                          : ''}
                      </span>
                    )}
                  </div>
                  {selectedStageProgress !== undefined && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500',
                          selectedStageNearTimeout ? 'bg-amber-500' : 'bg-cyan-400',
                        )}
                        style={{ width: `${selectedStageProgress}%` }}
                      />
                    </div>
                  )}
                  <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {selectedTaskUsesBackendStageOnly
                      ? '后端非流式任务只显示阶段流转；正文会在当前阶段完成后一次性写回。'
                      : '总控仅显示阶段、字数和更新时间；正文内容请在当前分镜页查看。'}
                  </p>
                </div>
              </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-white">
                    <Film className="h-4 w-4 text-cyan-600 dark:text-cyan-200" />
                    分镜队列
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                    {selectedTask.storyboards.length} 镜
                  </span>
                </div>
                <div className="max-h-[min(340px,38vh)] overflow-y-auto overscroll-contain pr-1">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {selectedTask.storyboards.map((storyboard) => (
                      <button
                        key={`${selectedTask.id}:${storyboard.index}`}
                        type="button"
                        onClick={() => handleOpenTaskStoryboard(selectedTask, storyboard.index)}
                        className={cn(
                          'rounded-xl border p-2.5 text-left text-xs transition hover:-translate-y-0.5 hover:border-cyan-300/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/50',
                          getStoryboardToneClass(storyboard.tone),
                          selectedTask.currentStoryboard?.index === storyboard.index ? 'ring-1 ring-cyan-300/60' : '',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/80 font-mono text-[10px] shadow-sm dark:bg-white/10 dark:shadow-none">
                            {storyboard.spinning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : String(storyboard.index + 1).padStart(2, '0')}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-semibold">{storyboard.title}</div>
                            <div className="mt-0.5 truncate opacity-75">{storyboard.label} · {storyboard.detail}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-6 text-center text-sm text-slate-500 dark:border-white/15 dark:bg-white/[0.04] dark:text-slate-400">
                  当前筛选下没有任务，切换筛选或清空搜索后查看。
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onPointerDown={startPanelDrag}
        onClick={() => {
          if (suppressNextClickRef.current) return;
          setOpen((current) => !current);
        }}
        className="flex h-12 cursor-grab items-center gap-2 rounded-full border border-cyan-200 bg-white/95 px-4 text-sm font-semibold text-slate-950 shadow-2xl shadow-slate-900/20 backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:border-cyan-300 hover:bg-cyan-50 active:cursor-grabbing dark:border-cyan-300/35 dark:bg-slate-950/95 dark:text-white dark:shadow-black/30 dark:hover:border-cyan-300/65 dark:hover:bg-slate-900"
        title="拖动移动；点击打开全局任务总控"
      >
        {runningCount > 0 ? (
          <Loader2 className="h-4 w-4 animate-spin text-cyan-600 dark:text-cyan-300" />
        ) : (
          <Sparkles className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        )}
        <span>任务总控</span>
        <span className="rounded-full bg-cyan-600 px-2 py-0.5 text-[11px] font-bold text-white dark:bg-cyan-300 dark:text-slate-950">
          {activeCount > 0 ? activeCount : tasks.length}
        </span>
      </button>
    </div>
  );
}
