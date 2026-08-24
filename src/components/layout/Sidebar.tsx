// ============================================================
// 左侧边栏 - 项目/章节导航 - 第一阶段框架升级版
// ============================================================

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useCurrentProject } from '@/stores/projectStore';
import {
  FileText,
  BarChart3,
  Film,
  Clapperboard,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Trash2,
  Pencil,
  Copy,
  FolderOpen,
  Download,
  Import,
  ImageIcon,
  Sparkles,
  Layers,
  CheckCircle2,
  Circle,
  Loader2,
  DownloadCloud,
  PanelLeftClose,
  PanelLeftOpen,
} from '@/components/icons';
import { BrandMark } from '@/components/brand/BrandMark';
import { AssetLibrarySheet } from '@/components/step3/AssetLibrarySheet';
import { useConfirm, usePrompt } from '@/hooks/useConfirmPrompt';
import { exportProject, exportWorkflowSnapshot, importTransferFile } from '@/lib/projectTransfer';
import { toast } from 'sonner';
import { countStoryboardStep4Ready, isStoryboardPromptReady } from '@/lib/storyboardReadiness';
import { DEFAULT_STEP4_OUTPUT_MODE } from '@/lib/storage';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Chapter, GlobalTask as StoredGlobalTask } from '@/types';

const STEP4_BUSY_STATUSES = new Set([
  'checking',
  'correcting',
  'choreographing',
  'choreo-checking',
  'generating',
  'self-checking',
]);

function isStoryboardDirectorChapter(chapter: Chapter | null) {
  return (chapter?.step4OutputMode ?? DEFAULT_STEP4_OUTPUT_MODE) === 'storyboard-director';
}

function getChapterStatusBadge(chapter: Chapter) {
  if (chapter.step1Task?.running) return chapter.step1Task.phase === 'adapting' ? 'Step1 改编中' : 'Step1 分析中';
  if (chapter.step3Task?.running) return chapter.step3Task.phase === 'optimize' ? 'Step3 润色中' : chapter.step3Task.phase === 'lightweight' ? 'Step3 压缩中' : 'Step3 生成中';
  if (chapter.status === 'idle') return '';
  if (chapter.status === 'adapting') return '改编中';
  if (chapter.status === 'scripting') return '进行中';
  if (chapter.status === 'analyzing') return '待确认';
  if (chapter.status === 'assets') return '资产阶段';
  if (chapter.status === 'videos') return '视频阶段';
  if (chapter.status === 'dubbing') return '成片阶段';
  if (chapter.status === 'compositing') return '成片阶段';
  if (chapter.status !== 'generating') return '';

  const hasBusyStoryboard = chapter.storyboards.some((storyboard) => STEP4_BUSY_STATUSES.has(storyboard.status));
  const promptDone = countStoryboardStep4Ready(chapter.storyboards);
  const isStoryboardDirectorMode = isStoryboardDirectorChapter(chapter);

  if (chapter.storyboards.length > 0 && promptDone === chapter.storyboards.length && !hasBusyStoryboard) {
    return isStoryboardDirectorMode ? '故事板完成' : '提示词完成';
  }

  return hasBusyStoryboard ? '生成中' : isStoryboardDirectorMode ? '故事板阶段' : '提示词阶段';
}

function getChapterStatusTone(statusBadge: string) {
  if (!statusBadge) return '';
  if (statusBadge.includes('Step1')) return 'is-script';
  if (statusBadge.includes('Step3')) return 'is-assets';
  if (statusBadge.includes('改编')) return 'is-adapting';
  if (statusBadge.includes('进行')) return 'is-script';
  if (statusBadge.includes('待确认')) return 'is-analysis';
  if (statusBadge.includes('资产')) return 'is-assets';
  if (statusBadge.includes('视频')) return 'is-video';
  if (statusBadge.includes('配音')) return 'is-dubbing';
  if (statusBadge.includes('成片')) return 'is-composite';
  if (statusBadge.includes('故事板')) return statusBadge.includes('完成') ? 'is-storyboard-done' : 'is-storyboard';
  if (statusBadge.includes('提示词')) return statusBadge.includes('完成') ? 'is-prompt-done' : 'is-prompt';
  if (statusBadge.includes('完成')) return 'is-success';
  if (statusBadge.includes('生成')) return 'is-generating';
  return 'is-neutral';
}

type GlobalTaskView = {
  id: string;
  projectId: string;
  chapterId: string;
  step: Chapter['status'];
  title: string;
  detail: string;
  progressText: string;
  percent: number;
  status?: StoredGlobalTask['status'] | 'running';
  source: 'step1' | 'step3' | 'step4' | 'step5';
};

type WorkspaceView = 'home' | 'series' | 'chapter' | 'canvas-workbench' | 'image-workbench' | 'video-workbench' | 'task-center';
type SidebarVariant = 'classic' | 'next';

interface SidebarProps {
  variant?: SidebarVariant;
  activeView: WorkspaceView;
  onOpenHome: () => void;
  onOpenSeries: () => void;
  onOpenChapter: () => void;
  onOpenCanvas?: () => void;
  onOpenImageWorkbench?: () => void;
  onOpenVideoWorkbench?: () => void;
  onOpenTaskCenter?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

function getPromptDoneCount(chapter: Chapter) {
  return countStoryboardStep4Ready(chapter.storyboards);
}

function getStoredTaskStatusText(status: StoredGlobalTask['status']) {
  if (status === 'queued') return '等待中';
  if (status === 'running') return '运行中';
  if (status === 'done') return '已完成';
  if (status === 'failed') return '失败';
  return '已取消';
}

function getStep4TaskProgress(input: {
  total: number;
  done: number;
  currentIndex: number;
  status: StoredGlobalTask['status'] | 'running';
}) {
  const total = Math.max(input.total, 1);
  const done = Math.min(total, Math.max(0, input.done));
  const current = input.currentIndex >= 0 ? Math.min(total, input.currentIndex + 1) : done;
  const currentText = input.status === 'running' && current > 0 ? ` · 当前 ${current}/${total}` : '';
  const doneText = input.status === 'running' ? ` · 已完成 ${done}/${total}` : '';
  return {
    display: done,
    total,
    detail: `${currentText}${doneText}`,
    percent: Math.min(100, Math.round((done / total) * 100)),
  };
}

function getChapterQuickSelectLabel(chapter: Chapter, index: number, task?: GlobalTaskView) {
  const chapterNo = String(index + 1).padStart(2, '0');
  const scriptLabel = chapter.rawScript ? `${chapter.rawScript.length}字` : '未导入';
  if (task) {
    const taskLabel = task.status === 'queued' ? '排队' : '运行';
    return `${chapterNo} · ${chapter.title} · ${scriptLabel} · ${taskLabel} ${task.progressText}`;
  }

  const statusBadge = getChapterStatusBadge(chapter);
  return statusBadge
    ? `${chapterNo} · ${chapter.title} · ${scriptLabel} · ${statusBadge}`
    : `${chapterNo} · ${chapter.title} · ${scriptLabel}`;
}

function getGlobalTaskIdentityKey(task: StoredGlobalTask) {
  return `${task.type}:${task.projectId}:${task.chapterId}`;
}

function getLatestTaskIdsByIdentity(globalTasks: StoredGlobalTask[]) {
  const latest = new Map<string, StoredGlobalTask>();
  for (const task of globalTasks) {
    const key = getGlobalTaskIdentityKey(task);
    const previous = latest.get(key);
    if (!previous || task.createdAt > previous.createdAt || (task.createdAt === previous.createdAt && task.updatedAt > previous.updatedAt)) {
      latest.set(key, task);
    }
  }
  return new Set(Array.from(latest.values()).map((task) => task.id));
}

function collectGlobalTasks(
  projects: Array<{ id: string; name: string; chapters: Chapter[] }>,
  globalTasks: StoredGlobalTask[],
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
    const statusText = getStoredTaskStatusText(task.status);

    if (task.type === 'step1-analysis') {
      step1TaskChapterKeys.add(chapterKey);
      const textLength = task.streamTextLength ?? chapter.step1Task?.streamTextLength ?? 0;
      tasks.push({
        id: task.id,
        projectId: task.projectId,
        chapterId: task.chapterId,
        step: 'scripting',
        title: `${statusText} 路 Step1`,
        detail: `${project.name} / ${chapter.title} 路 ${textLength > 0 ? `${textLength} 字` : '等待回流'}`,
        progressText: task.status === 'queued' ? '排队' : textLength > 0 ? `${textLength}字` : '等待',
        percent: task.status === 'done' ? 100 : task.status === 'queued' ? 0 : 50,
        status: task.status,
        source: 'step1',
      });
      continue;
    }

    if (task.type === 'step3-batch') {
      step3TaskChapterKeys.add(chapterKey);
      const total = Math.max(task.total || chapter.step3Task?.total || 0, 1);
      const done = Math.max(task.doneCount ?? 0, chapter.step3Task?.done ?? 0);
      tasks.push({
        id: task.id,
        projectId: task.projectId,
        chapterId: task.chapterId,
        step: 'assets',
        title: `${statusText} 路 Step3 图片资产`,
        detail: `${project.name} / ${chapter.title} 路 ${task.status === 'queued' ? '排队等待' : `${done}/${total}`}`,
        progressText: task.status === 'queued' ? '排队' : `${done}/${total}`,
        percent: task.status === 'done' ? 100 : task.status === 'queued' ? 0 : Math.min(100, Math.round((done / total) * 100)),
        status: task.status,
        source: 'step3',
      });
      continue;
    }

    if (task.type === 'step5-batch') {
      step5TaskChapterKeys.add(chapterKey);
      const indices = task.step5Indices?.length
        ? task.step5Indices
        : chapter.storyboards.map((_, index) => index);
      const videoStoryboards = indices
        .map((index) => chapter.storyboards[index])
        .filter((storyboard): storyboard is Chapter['storyboards'][number] => !!storyboard);
      const total = Math.max(task.total || videoStoryboards.length || 1, 1);
      const done = Math.max(task.doneCount ?? 0, videoStoryboards.filter((storyboard) =>
        storyboard.videoStatus === 'done' || storyboard.videoStatus === 'failed',
      ).length);
      tasks.push({
        id: task.id,
        projectId: task.projectId,
        chapterId: task.chapterId,
        step: 'videos',
        title: `${statusText} · Step5 视频批量生成`,
        detail: `${project.name} / ${chapter.title} · ${task.status === 'queued' ? '排队等待' : `${done}/${total}`}`,
        progressText: task.status === 'queued' ? '排队' : `${done}/${total}`,
        percent: task.status === 'done' ? 100 : task.status === 'queued' ? 0 : Math.min(100, Math.round((done / total) * 100)),
        status: task.status,
        source: 'step5',
      });
      continue;
    }

    if (task.type !== 'step4-batch') continue;
    step4TaskChapterKeys.add(chapterKey);

    const total = task.total || chapter.storyboards.length || 1;
    const done = Math.max(task.doneCount ?? 0, getPromptDoneCount(chapter));
    const progress = getStep4TaskProgress({ total, done, currentIndex: task.currentIndex, status: task.status });
    tasks.push({
      id: task.id,
      projectId: task.projectId,
      chapterId: task.chapterId,
      step: 'generating',
      title: `${statusText} · ${isStoryboardDirectorChapter(chapter) ? 'Step4 故事板批量生成' : 'Step4 提示词批量生成'}`,
      detail: `${project.name} / ${chapter.title}${progress.detail}`,
      progressText: `${progress.display}/${progress.total}`,
      percent: progress.percent,
      status: task.status,
      source: 'step4',
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
          step: chapter.step1Task.phase === 'adapting' ? 'adapting' : 'scripting',
          title: `运行中 · Step1 ${phaseLabel}`,
          detail: `${project.name} / ${chapter.title} · ${textLength > 0 ? `${textLength} 字` : '等待回流'}`,
          progressText: textLength > 0 ? `${textLength}字` : '等待',
          percent: chapter.step1Task.phase === 'adapting' ? 35 : 65,
          status: 'running',
          source: 'step1',
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
          step: 'assets',
          title: `运行中 · Step3 ${phaseLabel}`,
          detail: `${project.name} / ${chapter.title} · ${chapter.step3Task.currentLabel ?? `${done}/${total}`}`,
          progressText: `${done}/${total}`,
          percent: Math.min(100, Math.round((done / total) * 100)),
          status: 'running',
          source: 'step3',
        });
      }

      if (chapter.autoGenerate?.running && !step4TaskChapterKeys.has(`${project.id}:${chapter.id}`)) {
        const total = chapter.autoGenerate.total || chapter.storyboards.length || 1;
        const done = Math.max(chapter.autoGenerate.doneCount ?? 0, getPromptDoneCount(chapter));
        const progress = getStep4TaskProgress({
          total,
          done,
          currentIndex: chapter.autoGenerate.currentIndex,
          status: 'running',
        });
        tasks.push({
          id: `step4:${project.id}:${chapter.id}`,
          projectId: project.id,
          chapterId: chapter.id,
          step: 'generating',
          title: isStoryboardDirectorChapter(chapter) ? '运行中 · Step4 故事板批量生成' : '运行中 · Step4 提示词批量生成',
          detail: `${project.name} / ${chapter.title}${progress.detail}`,
          progressText: `${progress.display}/${progress.total}`,
          percent: progress.percent,
          status: 'running',
          source: 'step4',
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
          step: 'videos',
          title: 'Step5 视频生成',
          detail: `${project.name} / ${chapter.title} · 运行 ${runningVideos} 个 · 已完成 ${videoDone}/${videoTotal}`,
          progressText: `${videoDone}/${videoTotal}`,
          percent: Math.min(100, Math.round((videoDone / Math.max(videoTotal, 1)) * 100)),
          status: 'running',
          source: 'step5',
        });
      }
    }
  }

  const statusRank: Record<string, number> = {
    running: 0,
    queued: 1,
    failed: 2,
    cancelled: 3,
    done: 4,
  };
  return tasks.sort((a, b) => (statusRank[a.status ?? 'running'] ?? 9) - (statusRank[b.status ?? 'running'] ?? 9));
}

export function Sidebar({
  variant = 'classic',
  activeView,
  collapsed = false,
  onToggleCollapsed,
  onOpenHome,
  onOpenSeries,
  onOpenChapter,
  onOpenCanvas,
  onOpenImageWorkbench,
  onOpenVideoWorkbench,
  onOpenTaskCenter,
}: SidebarProps) {
  const { state, dispatch, currentProject, currentChapter: chapter } = useCurrentProject();
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const { confirm, ConfirmDialog: ConfirmDlg } = useConfirm();
  const { prompt, PromptDialog: PromptDlg } = usePrompt();

  const handleRenameProject = async (projectId: string, currentName: string) => {
    const name = await prompt('输入新项目名称：', currentName);
    if (!name?.trim() || name.trim() === currentName) return;
    dispatch({ type: 'RENAME_PROJECT', projectId, name: name.trim() });
    toast.success(`项目已重命名为「${name.trim()}」`);
  };

  const handleNewProject = async () => {
    const name = await prompt('输入项目名称：');
    if (!name?.trim()) return;
    dispatch({ type: 'CREATE_PROJECT', name: name.trim() });
    onOpenChapter();
  };

  const handleSwitchProject = (id: string) => {
    dispatch({ type: 'SWITCH_PROJECT', projectId: id });
    onOpenChapter();
  };

  const handleDeleteProject = async (projectId: string, projectName: string) => {
    if (!(await confirm(`确定删除项目「${projectName}」？此操作不可恢复。`))) return;
    dispatch({ type: 'DELETE_PROJECT', projectId });
  };

  const handleNewChapter = async () => {
    const next = (currentProject?.chapters.length ?? 0) + 1;
    const title = await prompt('输入章节名称：', `第${next}章`);
    if (!title?.trim()) return;
    dispatch({ type: 'CREATE_CHAPTER', title: title.trim() });
    onOpenChapter();
  };

  const handleDeleteChapter = async (chapterId: string) => {
    if (!(await confirm('确定删除该章节？'))) return;
    dispatch({ type: 'DELETE_CHAPTER', chapterId });
  };

  const handleRenameChapter = async (chapterId: string, currentTitle: string) => {
    const title = await prompt('输入章节名称：', currentTitle);
    if (!title?.trim() || title.trim() === currentTitle) return;
    dispatch({ type: 'RENAME_CHAPTER', chapterId, title: title.trim() });
    toast.success(`章节已重命名为「${title.trim()}」`);
  };

  const handleMoveChapter = (chapterId: string, direction: 'up' | 'down') => {
    dispatch({ type: 'MOVE_CHAPTER', chapterId, direction });
  };

  const handleDuplicateChapter = async (chapterId: string, currentTitle: string) => {
    const title = await prompt('输入复制后的章节名称：', `${currentTitle} 副本`);
    if (!title?.trim()) return;
    dispatch({ type: 'DUPLICATE_CHAPTER', chapterId, title: title.trim() });
    toast.success(`已复制为「${title.trim()}」`);
  };

  const handleImportChapterText = async (chapterId: string, chapterTitle: string, hasScript: boolean) => {
    if (!currentProject) return;
    if (hasScript) {
      const confirmed = await confirm(`导入文本会覆盖「${chapterTitle}」当前脚本内容，已有分析会标记为需重新分析。是否继续？`, '导入章节文本');
      if (!confirmed) return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,text/plain,text/markdown';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = (await file.text()).trim();
        if (!text) {
          toast.error('导入失败：文件内容为空');
          return;
        }
        dispatch({ type: 'SWITCH_CHAPTER', chapterId });
        onOpenChapter();
        dispatch({ type: 'SET_RAW_SCRIPT', script: text, projectId: currentProject.id, chapterId });
        dispatch({ type: 'SET_CHAPTER_STATUS', status: 'idle', projectId: currentProject.id, chapterId });
        toast.success(`已导入「${file.name}」到「${chapterTitle}」`, {
          description: `${text.length} 字符，下一步可直接在 Step1 分析。`,
        });
      } catch (err) {
        toast.error(`导入失败：${err instanceof Error ? err.message : String(err)}`);
      }
    };
    input.click();
  };

  const handleSwitchChapter = (chapterId: string) => {
    dispatch({ type: 'SWITCH_CHAPTER', chapterId });
    onOpenChapter();
  };

  const handleExportProject = async (projectId: string) => {
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return;
    try {
      await exportProject(project);
      toast.success(`已导出项目「${project.name}」`);
    } catch (err) {
      toast.error(`导出项目失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleExportWorkflowSnapshot = async () => {
    if (!currentProject) return;
    try {
      await exportWorkflowSnapshot(state);
      toast.success(`已导出工作流快照「${currentProject.name}」`);
    } catch (err) {
      toast.error(`导出工作流快照失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleImportProject = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const transfer = await importTransferFile(file);
        if (transfer.kind === 'workflow-snapshot') {
          const confirmed = await confirm('导入工作流快照会覆盖当前全部项目和设置，确定继续吗？');
          if (!confirmed) return;
          dispatch({ type: 'IMPORT_APP_STATE', state: transfer.state });
          onOpenChapter();
          const firstProjectName = transfer.state.projects[0]?.name ?? '未命名项目';
          toast.success(`已导入工作流快照，当前项目「${firstProjectName}」`);
          return;
        }

        dispatch({ type: 'IMPORT_PROJECT', project: transfer.project });
        onOpenChapter();
        toast.success(`已导入项目「${transfer.project.name}」`);
      } catch (err) {
        toast.error(`导入失败：${err instanceof Error ? err.message : String(err)}`);
      }
    };
    input.click();
  };

  const status = chapter?.status ?? 'idle';
  const hasAnalysis = !!chapter?.analysis;
  const hasStoryboards = (chapter?.storyboards.length ?? 0) > 0;
  const promptReadyStoryboards = chapter?.storyboards.filter(isStoryboardPromptReady) ?? [];
  const promptReadyCount = promptReadyStoryboards.length;
  const promptTotalCount = chapter?.storyboards.length ?? 0;
  const hasPrompts = promptReadyCount > 0;
  const videoDoneCount = chapter?.storyboards.filter((s) => s.videoStatus === 'done').length ?? 0;
  const hasVideos = videoDoneCount > 0;
  const isChapterView = activeView === 'chapter';
  const isStoryboardDirectorMode = isStoryboardDirectorChapter(chapter ?? null);
  const step4OutputLabel = isStoryboardDirectorMode ? '故事板' : '提示词';
  const step1Active = isChapterView && (status === 'idle' || status === 'adapting');
  const step2Active = isChapterView && (status === 'scripting' || status === 'analyzing');
  const step3Active = isChapterView && status === 'assets';
  const step4Active = isChapterView && status === 'generating';
  const step5Active = isChapterView && status === 'videos';
  const step7Active = isChapterView && (status === 'compositing' || status === 'dubbing');
  const step1Done = !!chapter?.rawScript.trim() && !step1Active;
  const step2Done = hasAnalysis && !step2Active;
  const step3Done = hasStoryboards && !step3Active;
  const step4Done = promptTotalCount > 0 && promptReadyCount === promptTotalCount && !step4Active;
  const step5Done = hasVideos && !step5Active;
  const activeTasks = collectGlobalTasks(state.projects, state.globalTasks).filter((task) =>
    task.status === 'queued' || task.status === 'running' || !task.status,
  );
  const activeTaskByChapterId = new Map(
    activeTasks
      .filter((task) => task.projectId === currentProject?.id)
      .map((task) => [task.chapterId, task]),
  );
  const seriesPlan = currentProject?.seriesPlan;
  const seriesEpisodeCards = seriesPlan?.episodeCards ?? [];
  const seriesCharacters = seriesPlan?.characters ?? [];
  const seriesScriptCount = seriesEpisodeCards.filter((episode) => !!episode.generatedScript?.trim()).length;
  const seriesStatus = seriesScriptCount > 0
    ? `已出稿 ${seriesScriptCount} 集`
    : seriesEpisodeCards.length > 0
      ? `已有集卡 ${seriesEpisodeCards.length} 集`
      : seriesCharacters.length > 0
        ? '已有人设'
        : '未开始';

  const handleOpenStep = (stepId: string) => {
    if (!chapter) return;
    onOpenChapter();
    switch (stepId) {
      case 'step1':
        dispatch({ type: 'SET_CHAPTER_STATUS', status: 'idle', chapterId: chapter.id });
        break;
      case 'step2':
        if (hasAnalysis) dispatch({ type: 'SET_CHAPTER_STATUS', status: 'analyzing', chapterId: chapter.id });
        break;
      case 'step3':
        if (hasStoryboards) dispatch({ type: 'SET_CHAPTER_STATUS', status: 'assets', chapterId: chapter.id });
        break;
      case 'step4':
        if (hasStoryboards) dispatch({ type: 'SET_CHAPTER_STATUS', status: 'generating', chapterId: chapter.id });
        break;
      case 'step5':
        if (hasPrompts) dispatch({ type: 'SET_CHAPTER_STATUS', status: 'videos', chapterId: chapter.id });
        break;
      case 'step7':
        if (hasVideos) dispatch({ type: 'SET_CHAPTER_STATUS', status: 'compositing', chapterId: chapter.id });
        break;
      default:
        break;
    }
  };

  const steps = [
    {
      id: 'step1',
      label: '脚本输入',
      icon: FileText,
      description: chapter?.rawScript ? `${chapter.rawScript.slice(0, 18)}...` : '输入原始剧本或网文',
      active: step1Active,
      done: step1Done,
      disabled: false,
    },
    {
      id: 'step2',
      label: '分析结果',
      icon: BarChart3,
      description: chapter?.analysisIsStale
        ? '脚本已修改，建议重新分析'
        : chapter?.analysis
          ? `${chapter.analysis.storyboards.length} 个分镜待确认`
          : '等待分析输出',
      active: step2Active,
      done: step2Done,
      disabled: !chapter?.analysis,
    },
    {
      id: 'step3',
      label: '图片资产',
      icon: ImageIcon,
      description: hasStoryboards
        ? (currentProject?.assetLibrary?.length ? `${currentProject.assetLibrary.length} 项素材` : '角色 / 场景 / 物品')
        : '先确认分析结果',
      active: step3Active,
      done: step3Done,
      disabled: !hasStoryboards,
    },
    {
      id: 'step4',
      label: isStoryboardDirectorMode ? '故事板生成' : '提示词生成',
      icon: Sparkles,
      description: chapter?.storyboards.length
        ? `${promptReadyCount}/${promptTotalCount} 已完成`
        : '等待分镜建立',
      active: step4Active,
      done: step4Done,
      disabled: !chapter?.storyboards.length,
    },
    {
      id: 'step5',
      label: '视频生成',
      icon: Film,
      description: promptReadyCount > 0
        ? `${videoDoneCount}/${promptReadyCount} 已完成`
        : `等待${step4OutputLabel}完成`,
      active: step5Active,
      done: step5Done,
      disabled: !hasPrompts,
    },
    {
      id: 'step7',
      label: '成片合成',
      icon: Clapperboard,
      description: hasVideos ? '视频原声 / 音效 / BGM 拼接' : '至少需要 1 个视频',
      active: step7Active,
      done: false,
      disabled: !hasVideos,
    },
  ];

  const completedSteps = steps.filter((s) => s.done || s.active).length;
  const totalSteps = steps.length;
  const progressPercent = Math.max(8, Math.round((completedSteps / totalSteps) * 100));

  if (variant === 'next') {
    const activeStepIndex = steps.findIndex((step) => step.active);
    const nextStepIndex = steps.findIndex((step) => !step.done && !step.disabled);
    const focusStepIndex = activeStepIndex >= 0 ? activeStepIndex : Math.max(0, nextStepIndex);
    const focusStep = steps[focusStepIndex] ?? steps[0];
    const FocusStepIcon = focusStep?.icon ?? Sparkles;
    const compactStepLabels: Record<string, string> = {
      step1: '脚本',
      step2: '分析',
      step3: '资产',
      step4: '故事板',
      step5: '视频',
      step7: '成片',
    };

    return (
      <>
        <aside className={cn('next-sidebar hidden w-[276px] shrink-0 lg:flex lg:flex-col', collapsed && 'is-collapsed')}>
          <div className="next-sidebar-scroll flex-1 overflow-y-auto overflow-x-hidden">
            <section className="next-sidebar-hero">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  className={cn('brand-mark-shell next-sidebar-logo border border-border/40 p-1.5', activeView === 'home' && 'is-active')}
                  onClick={onOpenHome}
                  title="返回工作台"
                  aria-label="返回工作台"
                >
                  <BrandMark size={34} className="h-8 w-8" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="next-eyebrow">当前制作</p>
                  <h2 className="next-current-project-title" title={currentProject?.name ?? '尚未创建项目'}>
                    {currentProject?.name ?? '尚未创建项目'}
                  </h2>
                  <p className="next-current-chapter-title" title={chapter?.title ?? '创建项目后开始制作'}>
                    {chapter?.title ?? '创建项目后开始制作'}
                  </p>
                </div>
                {onToggleCollapsed && (
                  <button
                    type="button"
                    className="next-sidebar-collapse-trigger"
                    onClick={onToggleCollapsed}
                    title={collapsed ? '展开侧边栏' : '收窄侧边栏，进入专注模式'}
                    aria-label={collapsed ? '展开侧边栏' : '收窄侧边栏'}
                  >
                    {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
                    {!collapsed && <span>专注</span>}
                  </button>
                )}
              </div>

              <div className="next-context-progress mt-3">
                <div className="next-context-progress-row">
                  <FocusStepIcon className="next-context-progress-icon h-3.5 w-3.5 shrink-0" />
                  <span className="next-context-progress-label min-w-0 flex-1 truncate">
                    {focusStep?.label ?? '准备开始'}
                  </span>
                  <span className="next-step-count">{progressPercent}%</span>
                </div>
                <div className="next-progress-track">
                  <div className="brand-gradient h-full rounded-full" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            </section>


            <section className="next-sidebar-section next-primary-entry-section">
              <div className="next-section-heading">
                <span>短剧制作</span>
                <span className="next-count-badge">主流程</span>
              </div>

              <button
                type="button"
                onClick={onOpenChapter}
                className={cn('next-wide-action next-main-flow-action', activeView === 'chapter' && 'is-active')}
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold">章节工作台</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {chapter?.title ?? '选择或新建章节'}
                  </span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
              </button>

              {currentProject && (
                <button
                  type="button"
                  onClick={onOpenSeries}
                  className={cn('next-wide-action next-series-action', activeView === 'series' && 'is-active')}
                >
                  <Sparkles className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold">剧本策划</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{seriesStatus}</span>
                  </span>
                  <span className="next-mini-badge">Step0</span>
                </button>
              )}

            </section>

            {(onOpenCanvas || onOpenImageWorkbench || onOpenVideoWorkbench || onOpenTaskCenter) && (
              <section className="next-sidebar-section next-toolbox-section">
                <div className="next-section-heading">
                  <span>自由创作</span>
                  <span className="next-count-badge">工具台</span>
                </div>

                {onOpenCanvas && (
                  <button
                    type="button"
                    onClick={onOpenCanvas}
                    className={cn('next-wide-action', activeView === 'canvas-workbench' && 'is-active')}
                  >
                    <Layers className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold">创作画布</span>
                      <span className="block truncate text-[10px] text-muted-foreground">节点编排 / 多模型创作</span>
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </button>
                )}

                {onOpenImageWorkbench && (
                  <button
                    type="button"
                    onClick={onOpenImageWorkbench}
                    className={cn('next-wide-action', activeView === 'image-workbench' && 'is-active')}
                  >
                    <ImageIcon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold">图片工作台</span>
                      <span className="block truncate text-[10px] text-muted-foreground">单图生成 / 精修</span>
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </button>
                )}

                {onOpenVideoWorkbench && (
                  <button
                    type="button"
                    onClick={onOpenVideoWorkbench}
                    className={cn('next-wide-action', activeView === 'video-workbench' && 'is-active')}
                  >
                    <Clapperboard className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold">视频工作台</span>
                      <span className="block truncate text-[10px] text-muted-foreground">图生视频 / 结果管理</span>
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </button>
                )}

                {onOpenTaskCenter && (
                  <button
                    type="button"
                    onClick={onOpenTaskCenter}
                    className={cn('next-wide-action', activeView === 'task-center' && 'is-active')}
                  >
                    <Loader2 className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold">任务中心</span>
                      <span className="block truncate text-[10px] text-muted-foreground">查看排队和恢复任务</span>
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </button>
                )}
              </section>
            )}

            <section className="next-sidebar-section next-workflow-section hidden">
              <div className="next-section-heading">
                <span>步骤跳转</span>
                <span className="next-count-badge">{progressPercent}%</span>
              </div>
              <div className="next-step-list">
                {steps.map((step, idx) => {
                  const StepIcon = step.icon;
                  const stepBusy =
                    (step.id === 'step1' && status === 'adapting')
                    || (step.id === 'step2' && status === 'scripting');
                  return (
                    <button
                      key={step.id}
                      type="button"
                      disabled={step.disabled}
                      onClick={() => handleOpenStep(step.id)}
                      className={cn(
                        'next-step-row',
                        step.active && 'is-active',
                        step.done && !step.active && 'is-done',
                        step.disabled && 'is-disabled',
                      )}
                      title={step.disabled ? step.description : `打开${step.label}`}
                    >
                      <span className="next-step-index">{String(idx + 1).padStart(2, '0')}</span>
                      <span className="next-step-icon">
                        {stepBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <StepIcon className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold">{compactStepLabels[step.id] ?? step.label}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">{step.description}</span>
                      </span>
                      {step.done ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-40" />}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className={cn('next-sidebar-section next-project-section', state.projects.length === 0 && 'is-empty')}>
              <div className="next-section-heading">
                <span>项目</span>
                <div className="next-heading-actions">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="next-text-action">
                        更多
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="next-sidebar-menu">
                      <DropdownMenuItem onSelect={handleImportProject}>
                        导入项目
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={handleExportWorkflowSnapshot}>
                        导出工作流快照
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="next-entity-list">
                {state.projects.length === 0 ? (
                  <p className="next-empty-sidebar-note">创建项目后会显示在这里。</p>
                ) : state.projects.map((p) => (
                  <div
                    key={p.id}
                    className={cn('next-entity-row group', p.id === state.currentProjectId && 'is-active')}
                  >
                    <button
                      type="button"
                      onClick={() => handleSwitchProject(p.id)}
                      className="next-entity-main next-project-main"
                      title={p.name}
                    >
                      <Film className="h-3.5 w-3.5 shrink-0 opacity-70" />
                      <span className="next-entity-copy">
                        <span className="next-entity-title">{p.name}</span>
                      </span>
                      <span className="next-side-badge">{p.chapters.length}章</span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="next-row-menu-trigger" aria-label={`管理项目 ${p.name}`}>
                          管理
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="next-sidebar-menu">
                        <DropdownMenuItem onSelect={() => handleRenameProject(p.id, p.name)}>
                          重命名项目
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => handleExportProject(p.id)}>
                          导出项目
                        </DropdownMenuItem>
                        {state.projects.length > 1 && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => handleDeleteProject(p.id, p.name)}
                            >
                              删除项目
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            </section>

            {currentProject && (
              <section className="next-sidebar-section next-chapter-section">
                <div className="next-section-heading">
                  <span>章节</span>
                  <button type="button" onClick={handleNewChapter} className="next-text-action">新增</button>
                </div>
                <Select
                  value={currentProject.currentChapterId ?? undefined}
                  onValueChange={handleSwitchChapter}
                >
                  <SelectTrigger
                    size="sm"
                    className="next-chapter-select-trigger"
                    aria-label="快速选择章节"
                  >
                    <SelectValue placeholder="选择章节" />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    align="start"
                    className="next-chapter-select-content"
                  >
                    {currentProject.chapters.map((c, chapterIndex) => (
                      <SelectItem
                        key={c.id}
                        value={c.id}
                        textValue={getChapterQuickSelectLabel(c, chapterIndex, activeTaskByChapterId.get(c.id))}
                        className="next-chapter-select-item"
                      >
                        {getChapterQuickSelectLabel(c, chapterIndex, activeTaskByChapterId.get(c.id))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="next-entity-list">
                  {currentProject.chapters.map((c, chapterIndex) => {
                    const isActive = c.id === currentProject.currentChapterId;
                    const canMoveUp = chapterIndex > 0;
                    const canMoveDown = chapterIndex < currentProject.chapters.length - 1;
                    const statusBadge = getChapterStatusBadge(c);
                    const activeChapterTask = activeTaskByChapterId.get(c.id);
                    const activeTaskStatusText = activeChapterTask?.status === 'queued' ? '排队' : '运行';
                    return (
                      <div key={c.id} className={cn('next-entity-row group', isActive && activeView === 'chapter' && 'is-active')}>
                        <button
                          type="button"
                          onClick={() => handleSwitchChapter(c.id)}
                          className="next-entity-main next-chapter-main"
                          title={c.title}
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                          <span className="next-entity-copy">
                            <span className="next-entity-title">{c.title}</span>
                            <span className="next-entity-subtitle">
                              {c.rawScript ? `${c.rawScript.length}字` : '未导入正文'}
                            </span>
                          </span>
                          {activeChapterTask ? (
                            <span
                              className={cn(
                                'next-status-badge',
                                activeChapterTask.status === 'queued' ? 'is-task-queued' : 'is-task-running',
                              )}
                              title={`${activeTaskStatusText} · ${activeChapterTask.progressText}`}
                            >
                              {activeTaskStatusText} {activeChapterTask.progressText}
                            </span>
                          ) : statusBadge && (
                            <span className={cn('next-status-badge', getChapterStatusTone(statusBadge))}>
                              {statusBadge}
                            </span>
                          )}
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="next-row-menu-trigger" aria-label={`管理章节 ${c.title}`}>
                              管理
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="next-sidebar-menu">
                            <DropdownMenuItem onSelect={() => handleRenameChapter(c.id, c.title)}>
                              重命名章节
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => handleImportChapterText(c.id, c.title, !!c.rawScript.trim())}>
                              {c.rawScript.trim() ? '替换正文' : '导入正文'}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => handleDuplicateChapter(c.id, c.title)}>
                              复制章节
                            </DropdownMenuItem>
                            {currentProject.chapters.length > 1 && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  disabled={!canMoveUp}
                                  onSelect={() => handleMoveChapter(c.id, 'up')}
                                >
                                  上移章节
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!canMoveDown}
                                  onSelect={() => handleMoveChapter(c.id, 'down')}
                                >
                                  下移章节
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => handleDeleteChapter(c.id)}
                                >
                                  删除章节
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          <div className="next-sidebar-footer">
            <button
              type="button"
              onClick={() => setAssetLibraryOpen(true)}
              className="next-wide-action"
            >
              <FolderOpen className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold">资产库</span>
                <span className="block truncate text-[10px] text-muted-foreground">全局素材与引用关系</span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
            </button>
          </div>
        </aside>

        <AssetLibrarySheet open={assetLibraryOpen} onOpenChange={setAssetLibraryOpen} />
        {ConfirmDlg}
        {PromptDlg}
      </>
    );
  }

  return (
    <>
      <aside className="hidden w-[304px] shrink-0 border-r border-sidebar-border bg-sidebar/95 lg:flex lg:flex-col">
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="sidebar-panel mb-4 overflow-hidden rounded-[28px] p-4">
            <div className="flex items-start gap-3">
              <button
                type="button"
                className="brand-mark-shell rounded-2xl border border-border/40 p-1.5 shadow-brand-sm outline-none transition focus-visible:ring-2 focus-visible:ring-brand-orange/40"
                onClick={onOpenHome}
                title="返回工作台"
                aria-label="返回工作台"
              >
                <BrandMark size={36} className="h-9 w-9" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                  当前工作区
                </p>
                <h2 className="truncate pt-1 text-[15px] font-semibold text-foreground">
                  {currentProject?.name ?? '尚未创建项目'}
                </h2>
                <p className="truncate text-xs text-muted-foreground">
                  {chapter?.title ?? '新建项目后开始章节创作'}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-border/40 bg-background/60 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                  项目
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">{state.projects.length}</p>
              </div>
              <div className="rounded-2xl border border-border/40 bg-background/60 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                  章节
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {currentProject?.chapters.length ?? 0}
                </p>
              </div>
              <div className="rounded-2xl border border-border/40 bg-background/60 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                  进度
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">{progressPercent}%</p>
              </div>
            </div>
          </div>

          <div className="sidebar-panel mb-4 rounded-[24px] p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                项目
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleNewProject}
                  className="text-[11px] font-medium text-brand-orange transition-colors hover:text-brand-orange/80"
                  title="新建项目"
                >
                  + 新建
                </button>
                <button
                  onClick={handleImportProject}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
                  title="导入项目"
                >
                  <Import className="h-3 w-3" />
                </button>
                <button
                  onClick={handleExportWorkflowSnapshot}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-brand-orange"
                  title="导出工作流快照"
                >
                  <DownloadCloud className="h-3 w-3" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              {state.projects.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    'group flex items-center gap-2 rounded-2xl px-2.5 py-2.5 text-sm transition-all duration-200',
                    p.id === state.currentProjectId
                      ? 'bg-brand-orange/10 text-brand-orange shadow-xs ring-1 ring-brand-orange/15'
                      : 'text-sidebar-foreground hover:bg-background/60',
                  )}
                >
                  <button
                    onClick={() => handleSwitchProject(p.id)}
                    className="flex flex-1 items-center gap-2 truncate text-left"
                  >
                    <Film className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {p.chapters.length} 章
                    </span>
                  </button>
                  {state.projects.length > 1 && (
                    <button
                      onClick={() => handleDeleteProject(p.id, p.name)}
                      className="opacity-0 transition-all duration-200 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                      title="删除项目"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    onClick={() => handleRenameProject(p.id, p.name)}
                    className="opacity-0 transition-all duration-200 group-hover:opacity-100 text-muted-foreground hover:text-brand-orange"
                    title="重命名项目"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => handleExportProject(p.id)}
                    className="opacity-0 transition-all duration-200 group-hover:opacity-100 text-muted-foreground hover:text-brand-orange"
                    title="导出项目"
                  >
                    <Download className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {currentProject && (
            <div className="sidebar-panel mb-4 rounded-[24px] p-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                  章节
                </span>
                <button
                  onClick={handleNewChapter}
                  className="text-[11px] font-medium text-brand-orange transition-colors hover:text-brand-orange/80"
                  title="新建章节"
                >
                  + 新增
                </button>
              </div>

              <Select
                value={currentProject.currentChapterId ?? undefined}
                onValueChange={handleSwitchChapter}
              >
                <SelectTrigger
                  size="sm"
                  className="mb-2 h-8 w-full rounded-2xl border-border/60 bg-background/60 text-left text-xs"
                  aria-label="快速选择章节"
                >
                  <SelectValue placeholder="选择章节" />
                </SelectTrigger>
                <SelectContent position="popper" align="start" className="max-w-[280px]">
                  {currentProject.chapters.map((c, chapterIndex) => (
                    <SelectItem
                      key={c.id}
                      value={c.id}
                      textValue={getChapterQuickSelectLabel(c, chapterIndex, activeTaskByChapterId.get(c.id))}
                      className="text-xs"
                    >
                      {getChapterQuickSelectLabel(c, chapterIndex, activeTaskByChapterId.get(c.id))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="space-y-1.5">
                {currentProject.chapters.map((c, chapterIndex) => {
                  const isActive = c.id === currentProject.currentChapterId;
                  const canMoveUp = chapterIndex > 0;
                  const canMoveDown = chapterIndex < currentProject.chapters.length - 1;
                  const statusBadge = getChapterStatusBadge(c);

                  return (
                    <div
                      key={c.id}
                      className={cn(
                        'group flex items-center gap-2 rounded-2xl px-2.5 py-2.5 text-sm transition-all duration-200',
                        isActive && activeView === 'chapter'
                          ? 'bg-background/75 text-foreground shadow-xs ring-1 ring-border/50'
                          : 'text-muted-foreground hover:bg-background/55 hover:text-foreground',
                      )}
                    >
                      <button
                        onClick={() => handleSwitchChapter(c.id)}
                        className="min-w-0 flex-1 text-left"
                        title={c.title}
                      >
                        <span className="block truncate text-[13px] font-medium">{c.title}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                          {c.rawScript ? `${c.rawScript.length} 字 · ${c.scriptType === 'novel' ? '小说' : '剧本'}` : '未导入正文'}
                        </span>
                      </button>
                      {statusBadge && (
                        <span className="shrink-0 text-[10px] font-medium text-brand-orange animate-pulse-soft">
                          {statusBadge}
                        </span>
                      )}
                      <button
                        onClick={() => handleRenameChapter(c.id, c.title)}
                        className="opacity-0 transition-all duration-200 group-hover:opacity-100 text-muted-foreground hover:text-brand-orange"
                        title="重命名章节"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => handleImportChapterText(c.id, c.title, !!c.rawScript.trim())}
                        className="opacity-0 transition-all duration-200 group-hover:opacity-100 text-muted-foreground hover:text-brand-orange"
                        title="导入文本到该章节"
                      >
                        <Import className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => handleDuplicateChapter(c.id, c.title)}
                        className="opacity-0 transition-all duration-200 group-hover:opacity-100 text-muted-foreground hover:text-brand-orange"
                        title="复制章节"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      {currentProject.chapters.length > 1 && (
                        <>
                          <button
                            onClick={() => handleMoveChapter(c.id, 'up')}
                            disabled={!canMoveUp}
                            className="opacity-0 transition-all duration-200 group-hover:opacity-100 text-muted-foreground hover:text-brand-orange disabled:pointer-events-none disabled:opacity-20"
                            title="上移章节"
                          >
                            <ChevronUp className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => handleMoveChapter(c.id, 'down')}
                            disabled={!canMoveDown}
                            className="opacity-0 transition-all duration-200 group-hover:opacity-100 text-muted-foreground hover:text-brand-orange disabled:pointer-events-none disabled:opacity-20"
                            title="下移章节"
                          >
                            <ChevronDown className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => handleDeleteChapter(c.id)}
                            className="opacity-0 transition-all duration-200 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                            title="删除章节"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {currentProject && (
            <div className="sidebar-panel mb-4 rounded-[24px] p-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                  项目级
                </span>
                <span className="text-[11px] font-semibold text-brand-orange">Step0</span>
              </div>
              <button
                onClick={onOpenSeries}
                className={cn(
                  'flex w-full items-center gap-2 rounded-2xl px-2.5 py-2.5 text-left text-sm transition-all duration-200',
                  activeView === 'series'
                    ? 'bg-brand-orange/10 text-brand-orange shadow-xs ring-1 ring-brand-orange/15'
                    : 'text-sidebar-foreground hover:bg-background/60',
                )}
              >
                <Sparkles className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">剧本策划</p>
                  <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
                    {seriesStatus}
                  </p>
                </div>
                {activeView === 'series' && (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-brand-orange/60" />
                )}
              </button>
            </div>
          )}

          {(onOpenCanvas || onOpenImageWorkbench || onOpenVideoWorkbench || onOpenTaskCenter) && (
            <div className="sidebar-panel mb-4 rounded-[24px] p-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                  自由创作
                </span>
                <span className="text-[11px] font-semibold text-brand-orange">工具台</span>
              </div>
              <div className="space-y-1">
                {onOpenCanvas && (
                  <button
                    onClick={onOpenCanvas}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-2xl px-2.5 py-2.5 text-left text-sm transition-all duration-200',
                      activeView === 'canvas-workbench'
                        ? 'bg-brand-orange/10 text-brand-orange shadow-xs ring-1 ring-brand-orange/15'
                        : 'text-sidebar-foreground hover:bg-background/60',
                    )}
                  >
                    <Layers className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">创作画布</p>
                      <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
                        节点编排 / 多模型创作
                      </p>
                    </div>
                    {activeView === 'canvas-workbench' && (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-brand-orange/60" />
                    )}
                  </button>
                )}
                {onOpenImageWorkbench && (
                  <button
                    onClick={onOpenImageWorkbench}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-2xl px-2.5 py-2.5 text-left text-sm transition-all duration-200',
                      activeView === 'image-workbench'
                        ? 'bg-brand-orange/10 text-brand-orange shadow-xs ring-1 ring-brand-orange/15'
                        : 'text-sidebar-foreground hover:bg-background/60',
                    )}
                  >
                    <ImageIcon className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">图片工作台</p>
                      <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
                        单图生成 / 精修
                      </p>
                    </div>
                  </button>
                )}
                {onOpenVideoWorkbench && (
                  <button
                    onClick={onOpenVideoWorkbench}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-2xl px-2.5 py-2.5 text-left text-sm transition-all duration-200',
                      activeView === 'video-workbench'
                        ? 'bg-brand-orange/10 text-brand-orange shadow-xs ring-1 ring-brand-orange/15'
                        : 'text-sidebar-foreground hover:bg-background/60',
                    )}
                  >
                    <Clapperboard className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">视频工作台</p>
                      <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
                        图生视频 / 结果管理
                      </p>
                    </div>
                  </button>
                )}
                {onOpenTaskCenter && (
                  <button
                    onClick={onOpenTaskCenter}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-2xl px-2.5 py-2.5 text-left text-sm transition-all duration-200',
                      activeView === 'task-center'
                        ? 'bg-brand-orange/10 text-brand-orange shadow-xs ring-1 ring-brand-orange/15'
                        : 'text-sidebar-foreground hover:bg-background/60',
                    )}
                  >
                    <Loader2 className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">任务中心</p>
                      <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
                        查看排队和恢复任务
                      </p>
                    </div>
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="sidebar-panel rounded-[24px] p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                步骤
              </span>
              <span className="text-[11px] font-semibold text-brand-orange">{progressPercent}%</span>
            </div>

            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted/80">
              <div
                className="brand-gradient h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="space-y-0.5">
              {steps.map((step, idx) => {
                const StepIcon = step.icon;
                const stepBusy =
                  (step.id === 'step1' && status === 'adapting')
                  || (step.id === 'step2' && status === 'scripting');

                return (
                  <div key={step.id} className="flex min-w-0 items-stretch">
                    <div className="mr-2 flex w-6 flex-col items-center py-1">
                      <div
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all duration-300',
                          step.active
                            ? 'brand-gradient scale-110 text-white shadow-brand-sm'
                            : step.done
                              ? 'bg-success text-success-foreground'
                              : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {stepBusy ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : step.done ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <Circle className="h-2.5 w-2.5" />
                        )}
                      </div>
                      {idx < steps.length - 1 && (
                        <div
                          className={cn(
                            'mt-1 w-px flex-1 transition-colors duration-300',
                            step.done ? 'bg-success/40' : 'bg-border',
                          )}
                        />
                      )}
                    </div>

                    <button
                      disabled={step.disabled}
                      onClick={() => handleOpenStep(step.id)}
                      title={step.disabled ? step.description : `打开${step.label}`}
                      className={cn(
                        'mb-0.5 flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-2xl px-2.5 py-2.5 text-left text-sm transition-all duration-200',
                        step.active
                          ? 'bg-brand-orange/10 text-brand-orange shadow-xs ring-1 ring-brand-orange/15'
                          : step.done
                            ? 'text-foreground hover:bg-background/55'
                            : 'text-muted-foreground',
                        !step.disabled && !step.active && 'hover:bg-background/55',
                        step.disabled && 'pointer-events-none opacity-50',
                      )}
                    >
                      <StepIcon className="h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="max-w-full truncate text-[13px] font-medium">{step.label}</p>
                        <p className="mt-0.5 max-w-full truncate text-[10px] leading-tight text-muted-foreground">
                          {step.description}
                        </p>
                      </div>
                      {step.active && (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-brand-orange/60" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="border-t border-sidebar-border px-4 py-4">
          <button
            onClick={() => setAssetLibraryOpen(true)}
            className="sidebar-panel flex w-full items-center gap-2.5 rounded-[24px] px-3 py-3 text-left text-sm text-muted-foreground transition-all duration-200 hover:text-sidebar-accent-foreground"
          >
            <FolderOpen className="h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">资产库</p>
              <p className="truncate text-[10px] text-muted-foreground">查看全局素材与引用关系</p>
            </div>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-40" />
          </button>
        </div>
      </aside>

      <AssetLibrarySheet open={assetLibraryOpen} onOpenChange={setAssetLibraryOpen} />
      {ConfirmDlg}
      {PromptDlg}
    </>
  );
}
