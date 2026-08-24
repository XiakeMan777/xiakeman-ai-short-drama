import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { ProjectProvider, useCurrentProject } from '@/stores/projectStore';
import { BrandMark } from '@/components/brand/BrandMark';
import { Header, type HeaderWorkflowStep } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { GlobalTaskFloatingPanel } from '@/components/layout/GlobalTaskFloatingPanel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Film,
  ArrowLeft,
  ArrowRight,
  ImageIcon,
  Clapperboard,
  Layers,
  Sparkles,
  Loader2,
  ChevronRight,
} from '@/components/icons';
import { Toaster } from '@/components/ui/sonner';
import { useConfirm, usePrompt } from '@/hooks/useConfirmPrompt';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  fetchVersionManifest,
  getCurrentBuildLabel,
  getVersionCheckIntervalMs,
} from '@/lib/versionClient';
import { DEFAULT_STEP4_OUTPUT_MODE } from '@/lib/storage';
import { getFrameDisplayLabel } from '@/lib/frameRatio';
import { getMissingImageReferenceLabels, isStoryboardPromptReady } from '@/lib/storyboardReadiness';
import { hasActiveLongRunningTasks } from '@/lib/activeLongTasks';
import { ENABLE_NEXT_UI_PREVIEW } from '@/lib/uiMode';
import type { Chapter } from '@/types';
import { cn } from '@/lib/utils';
import { Step4TaskProvider } from '@/components/step4/StoryboardGenerationContext';
import { StepGlobalTaskProvider } from '@/components/tasks/StepGlobalTaskProvider';
import { Step5TaskProvider } from '@/components/step5/Step5TaskProvider';
import { AppErrorBoundary } from '@/components/shared/AppErrorBoundary';
import { buildWorkflowChecklist, type WorkflowChecklistItem } from '@/lib/workflowChecklist';
import { ImageWorkbench } from '@/components/workbenches/ImageWorkbench';
import { VideoWorkbench } from '@/components/workbenches/VideoWorkbench';
import { CanvasWorkbench } from '@/components/workbenches/CanvasWorkbench';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'xkm-sidebar-collapsed-v1';
const ACTIVE_VIEW_STORAGE_KEY = 'xkm-active-view-v1';

const ScriptInput = lazy(() =>
  import('@/components/step1/ScriptInput').then((module) => ({ default: module.ScriptInput })),
);
const SeriesDesigner = lazy(() =>
  import('@/components/series/SeriesDesigner').then((module) => ({ default: module.SeriesDesigner })),
);
const AnalysisResult = lazy(() =>
  import('@/components/step2/AnalysisResult').then((module) => ({
    default: module.AnalysisResult,
  })),
);
const AssetManager = lazy(() =>
  import('@/components/step3/AssetManager').then((module) => ({ default: module.AssetManager })),
);
const AssetManagerNextPreview = lazy(() =>
  import('@/components/step3/AssetManagerNextPreview').then((module) => ({
    default: module.AssetManagerNextPreview,
  })),
);
const PromptGenerator = lazy(() =>
  import('@/components/step4/PromptGenerator').then((module) => ({
    default: module.PromptGenerator,
  })),
);
const Step5VideoGenerator = lazy(() =>
  import('@/components/step5/VideoGenerator').then((module) => ({
    default: module.Step5VideoGenerator,
  })),
);
const Step7Compositor = lazy(() =>
  import('@/components/step7/Compositor').then((module) => ({
    default: module.Step7Compositor,
  })),
);

type WorkspaceMetric = {
  label: string;
  value: string;
  tone?: 'shots' | 'script' | 'progress' | 'frame' | 'style';
  wide?: boolean;
};

type WorkspaceStepMeta = {
  title: string;
  description: string;
  badge: string;
  badgeClassName: string;
  metrics: WorkspaceMetric[];
};

function WelcomeDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="xkm-welcome-dialog sm:max-w-md" showCloseButton={false}>
        <DialogHeader className="items-center">
          <div className="brand-mark-shell mb-2 flex h-20 w-20 items-center justify-center rounded-3xl animate-scale-in">
            <BrandMark size={68} className="h-16 w-16" />
          </div>
          <DialogTitle className="text-xl">欢迎使用虾客漫</DialogTitle>
          <DialogDescription className="max-w-sm">
            AI 漫剧短剧一站式创作平台。创建你的第一个项目，从小说、剧本到分镜、出图、视频，一路生成。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center">
          <Button
            size="lg"
            className="brand-gradient w-full shadow-brand-sm transition-shadow duration-300 hover:shadow-brand-md sm:w-auto"
            onClick={onCreate}
          >
            + 新建项目
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepNavigation({
  onBack,
  backLabel,
  onForward,
  forwardLabel,
  forwardVariant = 'outline',
  forwardColorClass = '',
  badge,
  summaryTitle,
  summaryDetail,
  summaryBadge,
  forwardDisabled = false,
  forwardTitle,
  sticky = true,
}: {
  onBack?: () => void;
  backLabel?: string;
  onForward?: () => void;
  forwardLabel?: string;
  forwardVariant?: 'default' | 'outline';
  forwardColorClass?: string;
  badge?: ReactNode;
  summaryTitle?: string;
  summaryDetail?: string;
  summaryBadge?: ReactNode;
  forwardDisabled?: boolean;
  forwardTitle?: string;
  sticky?: boolean;
}) {
  if (ENABLE_NEXT_UI_PREVIEW) {
    return (
      <div className={cn(
        'surface-panel next-step-navigation flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-200/70 bg-background/90 px-4 py-3 shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-background/80 dark:border-orange-400/25',
        sticky ? 'sticky bottom-3 z-30' : 'relative z-0',
      )}>
        <div className="next-step-navigation-copy">
          <div className="flex min-w-0 items-center gap-2">
            {summaryBadge}
            <p className="next-step-navigation-title">
              {summaryTitle ?? (forwardLabel ? `下一步：${forwardLabel}` : '当前步骤')}
            </p>
          </div>
          {summaryDetail && (
            <p className="next-step-navigation-detail">{summaryDetail}</p>
          )}
        </div>
        <div className="next-step-navigation-actions">
          {onBack && (
            <button
              onClick={onBack}
              className="next-step-back-button group"
            >
              <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
              {backLabel || '返回'}
            </button>
          )}
          {onForward && (
            <Button
              size="lg"
              variant={forwardVariant}
              className={cn(
                'next-step-forward-button gap-1.5 transition-all duration-200',
                forwardVariant === 'default' && 'brand-gradient shadow-brand-sm hover:shadow-brand-md',
                forwardColorClass,
              )}
              onClick={onForward}
              disabled={forwardDisabled}
              title={forwardTitle}
            >
              {forwardLabel}
              {badge}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in flex items-center justify-between px-1 py-4">
      {onBack ? (
        <button
          onClick={onBack}
          className="group flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          {backLabel || '返回'}
        </button>
      ) : (
        <div />
      )}
      {onForward && (
        <Button
          size="sm"
          variant={forwardVariant}
          className={cn(
            'gap-1.5 transition-all duration-200',
            forwardVariant === 'default' && 'brand-gradient shadow-brand-sm hover:shadow-brand-md',
            forwardColorClass,
          )}
          onClick={onForward}
          disabled={forwardDisabled}
          title={forwardTitle}
        >
          {forwardLabel}
          {badge}
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function StepLoadingFallback() {
  return (
    <div className="flex min-h-[280px] items-center justify-center rounded-lg border border-dashed border-muted-foreground/20 bg-muted/20 text-sm text-muted-foreground">
      加载中…
    </div>
  );
}

function formatCountLabel(count: number, unit: string) {
  return `${count} ${unit}`;
}

const STEP4_BUSY_STATUSES = new Set([
  'checking',
  'correcting',
  'choreographing',
  'choreo-checking',
  'generating',
  'self-checking',
]);

function getPromptStageBadge(chapter: Chapter) {
  const storyboards = chapter.storyboards ?? [];
  const hasBusyStoryboard = storyboards.some((sb) => STEP4_BUSY_STATUSES.has(sb.status));
  const readyCount = storyboards.filter(isStoryboardPromptReady).length;
  const isComplete = storyboards.length > 0 && readyCount === storyboards.length && !hasBusyStoryboard;
  const isStoryboardDirectorMode = isStoryboardDirectorChapter(chapter);

  if (isComplete) return isStoryboardDirectorMode ? '故事板完成' : '提示词完成';
  if (hasBusyStoryboard) return '生成中';
  return isStoryboardDirectorMode ? '故事板阶段' : '提示词阶段';
}

function isStoryboardDirectorChapter(chapter: Chapter | null) {
  return (chapter?.step4OutputMode ?? DEFAULT_STEP4_OUTPUT_MODE) === 'storyboard-director';
}

function getWorkspaceStepMeta(chapter: Chapter | null): WorkspaceStepMeta {
  if (!chapter) {
    return {
      title: '开始新的创作流程',
      description: '创建项目后，我们会带着你从脚本输入一路走到视频生成。',
      badge: '待开始',
      badgeClassName:
        'border-border/70 bg-muted/60 text-muted-foreground dark:bg-muted/30',
      metrics: [] as WorkspaceMetric[],
    };
  }

  const storyboardTotal = chapter.analysis?.storyboards.length ?? chapter.storyboards.length ?? 0;
  const promptDone = chapter.storyboards.filter(isStoryboardPromptReady).length;
  const videoReady = chapter.storyboards.filter((sb) => sb.videoStatus === 'done').length;
  const isStoryboardDirectorMode = isStoryboardDirectorChapter(chapter);
  const isSmartStoryboardBoardMode = chapter.storyboardBoardMode === 'smart-shot-plan-landscape';

  const sharedMetrics = [
    chapter.analysis
      ? { label: '分镜', value: formatCountLabel(storyboardTotal, '个'), tone: 'shots' }
      : null,
    chapter.rawScript
      ? { label: '脚本', value: formatCountLabel(chapter.rawScript.length, '字'), tone: 'script' }
      : null,
  ].filter(Boolean) as WorkspaceMetric[];

  switch (chapter.status) {
    case 'idle':
    case 'adapting':
    case 'scripting':
      return {
        title: '脚本输入与改编',
        description:
          chapter.status === 'adapting'
            ? '正在把网文内容收束成适合短剧节奏的脚本，这一步会优先保留冲突、反差和推进点。'
            : '输入剧本或小说章节，确认这一章的原始素材，再进入自动分析与分镜阶段。',
        badge: chapter.status === 'adapting' ? '改编中' : '脚本阶段',
        badgeClassName:
          'border-warning/30 bg-warning/10 text-warning dark:bg-warning/15 dark:text-yellow-200',
        metrics: sharedMetrics,
      };
    case 'analyzing':
      return {
        title: '分析结果确认',
        description:
          '核对场景、角色、道具和分镜真相，把这一章的结构化信息定下来，后面所有素材都会基于这里继续。',
        badge: '待确认',
        badgeClassName:
          'border-brand-orange/30 bg-brand-orange/10 text-brand-orange dark:bg-brand-orange/15',
        metrics: sharedMetrics,
      };
    case 'assets':
      return {
        title: '图片资产工作台',
        description:
          '在这里完成角色、场景和物品素材的准备。先把关键参考图做稳，后面的提示词和视频会更省心。',
        badge: '素材阶段',
        badgeClassName:
          'border-brand-orange/30 bg-brand-orange/10 text-brand-orange dark:bg-brand-orange/15',
        metrics: [
          ...sharedMetrics,
          { label: '镜头数', value: formatCountLabel(chapter.storyboards.length, '镜'), tone: 'shots' },
        ],
      };
    case 'generating':
      return {
        title: isStoryboardDirectorMode ? '本集故事板生成' : '本集提示词生成',
        description:
          isStoryboardDirectorMode
            ? isSmartStoryboardBoardMode
              ? '默认一键按剧情节奏生成本集全部镜头的智能故事板，可自适应 6/9/12/15 格；分镜列表只用于检查、跳转和局部返工。'
              : '默认一键生成本集全部镜头的固定15宫格 Shot Sheet；分镜列表只用于检查、跳转和局部返工。'
            : '默认一键生成本集全部镜头的可拍视频提示词；分镜列表只用于检查、跳转和局部返工。',
        badge: getPromptStageBadge(chapter),
        badgeClassName:
          'border-brand-violet/30 bg-brand-violet/10 text-purple-600 dark:bg-brand-violet/15 dark:text-purple-200',
        metrics: [
          ...sharedMetrics,
          { label: '已完成', value: `${promptDone}/${Math.max(chapter.storyboards.length, 0)}`, tone: 'progress' },
        ],
      };
    case 'videos':
      return {
        title: '本集视频生成',
        description:
          '以本集为单位批量提交视频任务，单镜头卡片只用于预览、重试和质量排查。',
        badge: '视频阶段',
        badgeClassName:
          'border-success/30 bg-success/10 text-success dark:bg-success/15 dark:text-emerald-200',
        metrics: [
          ...sharedMetrics,
          { label: '已完成', value: `${videoReady}/${Math.max(chapter.storyboards.length, 0)}`, tone: 'progress' },
        ],
      };
    case 'dubbing':
      return {
        title: '本集成片合成',
        description: '把 Step5 已完成的视频按顺序合成为本集成片，默认保留视频原声，可补充音效和背景音乐。',
        badge: '成片阶段',
        badgeClassName:
          'border-warning/30 bg-warning/10 text-warning dark:bg-warning/15 dark:text-yellow-200',
        metrics: sharedMetrics,
      };
    case 'compositing':
      return {
        title: '本集成片合成',
        description:
          '把 Step5 已完成的视频按顺序合成为本集成片，默认保留视频原声，可补充音效和背景音乐。',
        badge: '成片阶段',
        badgeClassName:
          'border-warning/30 bg-warning/10 text-warning dark:bg-warning/15 dark:text-yellow-200',
        metrics: sharedMetrics,
      };
    default:
      return {
        title: '当前工作区',
        description: '继续处理这一章的创作流程。',
        badge: '进行中',
        badgeClassName:
          'border-border/70 bg-muted/60 text-muted-foreground dark:bg-muted/30',
        metrics: sharedMetrics,
      };
  }
}

function WorkspaceHeader({
  projectName,
  chapter,
  frameRatio,
}: {
  projectName?: string;
  chapter: Chapter | null;
  frameRatio?: string | null;
}) {
  const meta = getWorkspaceStepMeta(chapter);
  const globalStyle = chapter?.analysis?.styleConfig?.trim();
  const showGlobalStyleMetric = !!chapter?.analysis;
  const headerMetrics: WorkspaceMetric[] = [
    ...meta.metrics,
    { label: '画幅', value: getFrameDisplayLabel(frameRatio), tone: 'frame' as const },
    ...(showGlobalStyleMetric
      ? ([{
          label: '全局风格',
          value: globalStyle || '未设置',
          tone: 'style' as const,
          wide: true,
        }] as WorkspaceMetric[])
      : []),
  ];
  const compactMetrics = headerMetrics.filter((metric) => !metric.wide);
  const wideMetrics = headerMetrics.filter((metric) => metric.wide);
  const contextMetrics: WorkspaceMetric[] = wideMetrics;

  if (ENABLE_NEXT_UI_PREVIEW) {
    return (
      <div className="next-workspace-command">
        <div className="next-command-topline">
          <div className="next-command-breadcrumbs">
            {projectName && <span className="next-breadcrumb-pill" title={projectName}>{projectName}</span>}
            {chapter && <span className="next-breadcrumb-pill" title={chapter.title}>{chapter.title}</span>}
            <span className={cn('next-status-pill next-command-stage-badge', meta.badgeClassName)}>
              {meta.badge}
            </span>
          </div>
        </div>
        <div className="next-command-main">
          <div className="next-command-copy">
            <h2 className="next-command-title">{meta.title}</h2>
            <p className="next-command-description">{meta.description}</p>
          </div>
          {compactMetrics.length > 0 && (
            <div className="next-metric-strip" aria-label="当前章节关键指标">
              {compactMetrics.map((metric) => (
                <div
                  key={metric.label}
                  className={cn('next-metric-cell', metric.tone && `is-${metric.tone}`)}
                  title={metric.value}
                >
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
        {contextMetrics.length > 0 && (
          <div className="next-context-strip" aria-label="全局上下文">
            {contextMetrics.map((metric) => (
              <div
                key={metric.label}
                className={cn('next-context-item', metric.tone && `is-${metric.tone}`)}
                title={metric.value}
              >
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn('surface-panel mb-4 overflow-hidden rounded-2xl px-4 py-4 sm:px-5', ENABLE_NEXT_UI_PREVIEW && 'next-ui-workspace-header')}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {projectName && (
              <Badge variant="outline" className="rounded-full border-border/60 bg-background/70">
                {projectName}
              </Badge>
            )}
            {chapter && (
              <Badge variant="outline" className="rounded-full border-border/60 bg-background/70">
                {chapter.title}
              </Badge>
            )}
            <span
              className={cn(
                'inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold',
                meta.badgeClassName,
              )}
            >
              {meta.badge}
            </span>
          </div>
          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold text-foreground sm:text-2xl">
              {meta.title}
            </h2>
            <p className="max-w-3xl text-sm leading-5 text-muted-foreground">
              {meta.description}
            </p>
          </div>
        </div>

        {compactMetrics.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-2 xl:max-w-[420px] xl:justify-end">
            {compactMetrics.map((metric) => (
              <div
                key={metric.label}
                className="min-w-[76px] rounded-xl border border-border/50 bg-background/55 px-3 py-2"
                title={metric.value}
              >
                <p className="text-[11px] font-medium text-muted-foreground">
                  {metric.label}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {metric.value}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
      {wideMetrics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border/45 pt-3">
          {wideMetrics.map((metric) => (
            <div
              key={metric.label}
              className="flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-border/45 bg-background/45 px-3 py-2 text-xs"
              title={metric.value}
            >
              <span className="shrink-0 font-medium text-muted-foreground">{metric.label}</span>
              <span className="min-w-0 truncate font-semibold text-foreground">{metric.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getChecklistClassName(status: WorkflowChecklistItem['status']) {
  if (status === 'done') return 'border-success/30 bg-success/10 text-success';
  if (status === 'active') return 'border-brand-orange/40 bg-brand-orange/10 text-brand-orange';
  if (status === 'blocked') return 'border-destructive/30 bg-destructive/10 text-destructive';
  return 'border-border/70 bg-background/65 text-muted-foreground';
}

function WorkflowChecklist({ chapter }: { chapter: Chapter | null }) {
  const items = buildWorkflowChecklist(chapter);

  if (ENABLE_NEXT_UI_PREVIEW) {
    return (
      <div className="next-pipeline">
        {items.map((item, index) => (
          <div
            key={item.id}
            className={cn('next-pipeline-item', `is-${item.status}`)}
            title={item.detail}
          >
            <span className="next-pipeline-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold">{item.label}</span>
              <span className="block truncate text-[10px] text-muted-foreground">{item.detail}</span>
            </span>
            <span className="next-pipeline-state">
              {item.status === 'done' ? '完成' : item.status === 'active' ? '当前' : item.status === 'blocked' ? '阻塞' : '待处理'}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('mb-5 rounded-2xl border border-border/60 bg-background/55 px-3 py-3', ENABLE_NEXT_UI_PREVIEW && 'next-ui-checklist')}>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              'min-w-[132px] flex-1 rounded-xl border px-3 py-2 transition-colors sm:flex-none',
              getChecklistClassName(item.status),
            )}
            title={item.detail}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">{item.label}</span>
              <span className="text-[10px]">
                {item.status === 'done' ? '完成' : item.status === 'active' ? '当前' : item.status === 'blocked' ? '阻塞' : '待处理'}
              </span>
            </div>
            <p className="mt-1 truncate text-[11px] opacity-85">{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

type ActiveView = 'home' | 'series' | 'chapter' | 'canvas-workbench' | 'image-workbench' | 'video-workbench' | 'task-center';

const ACTIVE_VIEWS = new Set<ActiveView>([
  'home',
  'series',
  'chapter',
  'canvas-workbench',
  'image-workbench',
  'video-workbench',
  'task-center',
]);

function normalizeStoredActiveView(value: string | null): ActiveView | null {
  return value && ACTIVE_VIEWS.has(value as ActiveView) ? value as ActiveView : null;
}

function getDefaultActiveView(hasProject: boolean): ActiveView {
  return hasProject ? 'chapter' : 'home';
}

function canOpenActiveView(view: ActiveView, hasProject: boolean, hasChapter: boolean): boolean {
  if (view === 'series' || view === 'chapter') return hasProject && hasChapter;
  return true;
}

function countActiveTasks(state: ReturnType<typeof useCurrentProject>['state']) {
  return state.globalTasks.filter((task) => task.status === 'queued' || task.status === 'running').length;
}

function WorkbenchShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="animate-fade-in space-y-5">
      <section className="xkm-hub-hero">
        <div className="min-w-0">
          <p className="xkm-hub-eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </section>
      {children}
    </div>
  );
}

function WorkbenchCard({
  icon: Icon,
  title,
  description,
  meta,
  primaryLabel,
  onPrimary,
  disabled = false,
  featured = false,
}: {
  icon: typeof Sparkles;
  title: string;
  description: string;
  meta: string;
  primaryLabel: string;
  onPrimary?: () => void;
  disabled?: boolean;
  featured?: boolean;
}) {
  return (
    <article className={cn('xkm-workbench-card', featured && 'is-featured')}>
      <div className="xkm-workbench-card-icon">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
          <Badge variant="outline" className="xkm-workbench-meta">
            {meta}
          </Badge>
        </div>
        <Button
          type="button"
          size="sm"
          variant={featured && !disabled ? 'default' : 'outline'}
          className={cn(
            'mt-4 gap-1.5',
            featured && !disabled ? 'brand-gradient shadow-brand-sm' : 'xkm-workbench-secondary-action',
          )}
          disabled={disabled}
          onClick={onPrimary}
        >
          {primaryLabel}
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </article>
  );
}

function CreationCenter({
  state,
  currentProject,
  currentChapter,
  onNewProject,
  onOpenSeries,
  onOpenChapter,
  onOpenImageWorkbench,
  onOpenVideoWorkbench,
  onOpenCanvasWorkbench,
  onOpenTaskCenter,
}: {
  state: ReturnType<typeof useCurrentProject>['state'];
  currentProject: ReturnType<typeof useCurrentProject>['currentProject'];
  currentChapter: Chapter | null;
  onNewProject: (initialRawScript?: string) => void;
  onOpenSeries: () => void;
  onOpenChapter: () => void;
  onOpenImageWorkbench: () => void;
  onOpenVideoWorkbench: () => void;
  onOpenCanvasWorkbench: () => void;
  onOpenTaskCenter: () => void;
}) {
  const [homeDraft, setHomeDraft] = useState('');
  const activeTasks = countActiveTasks(state);
  const recentProjectName = currentProject?.name ?? '暂无项目';
  const recentChapterName = currentChapter?.title ?? '创建项目后开始制作';
  const statusLine = `当前：${recentProjectName} / ${recentChapterName} / 后台${activeTasks > 0 ? `${activeTasks} 个运行中` : '空闲'}`;
  const hasHomeDraft = homeDraft.trim().length > 0;
  const handlePrimaryStart = () => {
    if (hasHomeDraft) {
      onNewProject(homeDraft);
      setHomeDraft('');
      return;
    }
    if (currentProject) {
      onOpenChapter();
      return;
    }
    onNewProject();
  };

  const projectCount = state.projects.length;
  const chapterCount = state.projects.reduce((total, project) => total + project.chapters.length, 0);
  const storyboardCount = state.projects.reduce(
    (total, project) => total + project.chapters.reduce((sum, chapter) => sum + chapter.storyboards.length, 0),
    0,
  );
  const recentProjects = state.projects
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 3);

  const startModes = [
    {
      label: '小说改编',
      hint: '粘贴网文章节，自动拆成短剧节奏',
      value: '',
    },
    {
      label: '剧本改编',
      hint: '粘贴已有剧本，保留剧情并统一格式',
      value: '剧本正文：\n\n人物：\n场景：\n正文：',
    },
    {
      label: '从想法开始',
      hint: '只有一句话也可以先建项目',
      value: '故事想法：\n主角：\n核心冲突：\n结尾反转：',
    },
  ];

  return (
    <div className="xkm-home-starter animate-fade-in">
      <section className="xkm-home-hero-panel">
        <div className="xkm-home-hero-copy">
          <p className="xkm-home-kicker">虾客漫创作启动台</p>
          <h1>把小说或剧本，变成漫剧项目。</h1>
          <p>
            新手只需要粘贴原文。系统会继续带你完成剧本分析、角色场景、分镜故事板和视频生成。
          </p>
        </div>

        <div className="xkm-home-compose">
          <div className="xkm-home-mode-row" aria-label="选择创作方式">
            {startModes.map((mode) => (
              <button
                key={mode.label}
                type="button"
                className={cn('xkm-home-mode-chip', homeDraft === mode.value && 'is-active')}
                onClick={() => setHomeDraft(mode.value)}
              >
                <strong>{mode.label}</strong>
                <span>{mode.hint}</span>
              </button>
            ))}
          </div>

          <textarea
            value={homeDraft}
            onChange={(event) => setHomeDraft(event.target.value)}
            placeholder="粘贴小说章节、剧本正文、故事梗概，或直接写一句想法..."
            aria-label="创作输入"
          />

          <div className="xkm-home-compose-footer">
            <div className="xkm-home-status-pill">
              <span>{activeTasks > 0 ? `${activeTasks} 个任务运行中` : '当前空闲'}</span>
              <i />
              <span>{currentProject ? `最近：${currentProject.name}` : '还没有项目'}</span>
            </div>
            <Button
              type="button"
              size="lg"
              className="xkm-home-primary-button brand-gradient"
              onClick={handlePrimaryStart}
            >
              {hasHomeDraft ? '用内容创建项目' : currentProject ? '继续当前项目' : '创建空白项目'}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      <section className="xkm-home-quick-paths" aria-label="常用入口">
        <button type="button" className="xkm-home-path-card is-primary" onClick={currentProject ? onOpenChapter : () => onNewProject(homeDraft)}>
          <Film className="h-5 w-5" />
          <span>完整漫剧流程</span>
          <strong>从 Step1 到视频成片</strong>
        </button>
        <button type="button" className="xkm-home-path-card" onClick={currentProject ? onOpenSeries : () => onNewProject()}>
          <Sparkles className="h-5 w-5" />
          <span>剧本策划</span>
          <strong>人设、系列、分集先搭好</strong>
        </button>
        <button type="button" className="xkm-home-path-card" onClick={onOpenTaskCenter}>
          <Loader2 className="h-5 w-5" />
          <span>任务中心</span>
          <strong>{activeTasks > 0 ? `查看 ${activeTasks} 个运行任务` : '查看历史与恢复任务'}</strong>
        </button>
      </section>

      <section className="xkm-home-lower-grid">
        <div className="xkm-home-recent-panel">
          <div className="xkm-home-panel-head">
            <p className="xkm-home-kicker">最近项目</p>
            <h2>{projectCount > 0 ? '继续上次的创作' : '先创建第一个项目'}</h2>
          </div>
          {recentProjects.length > 0 ? (
            <div className="xkm-home-project-list">
              {recentProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className={cn('xkm-home-project-row', project.id === currentProject?.id && 'is-current')}
                  onClick={onOpenChapter}
                >
                  <span>{project.name}</span>
                  <strong>{project.chapters.length} 集 / {project.chapters.reduce((sum, chapter) => sum + chapter.storyboards.length, 0)} 分镜</strong>
                </button>
              ))}
            </div>
          ) : (
            <div className="xkm-home-empty-project">
              <span>粘贴原文后，虾客漫会自动为你建立项目并进入第一步。</span>
              <Button type="button" variant="outline" onClick={() => onNewProject()}>
                空白创建
              </Button>
            </div>
          )}
        </div>

        <div className="xkm-home-tools-panel">
          <div className="xkm-home-panel-head">
            <p className="xkm-home-kicker">高级工具</p>
            <h2>需要时再打开</h2>
          </div>
          <div className="xkm-home-tool-grid">
            <button type="button" onClick={onOpenCanvasWorkbench}>
              <Layers className="h-4 w-4" />
              创作画布
            </button>
            <button type="button" onClick={onOpenImageWorkbench}>
              <ImageIcon className="h-4 w-4" />
              图片工作台
            </button>
            <button type="button" onClick={onOpenVideoWorkbench}>
              <Clapperboard className="h-4 w-4" />
              视频工作台
            </button>
          </div>
          <div className="xkm-home-mini-stats">
            <span>{projectCount} 项目</span>
            <span>{chapterCount} 集</span>
            <span>{storyboardCount} 分镜</span>
          </div>
        </div>
      </section>
    </div>
  );

  return (
    <div className="xkm-creation-center animate-fade-in">
      <section className="xkm-command-workbench">
        <div className="xkm-command-title-block">
          <p className="xkm-hub-eyebrow">虾客漫工作台</p>
          <h2>AI 短剧生产工作台</h2>
          <p>粘贴小说或剧本，直接进入短剧项目；也可以从策划、资产和视频工具继续制作。</p>
        </div>

        <div className="xkm-new-user-guide">
          <span>第一次使用</span>
          <strong>建议从「短剧制作」开始：</strong>
          <em>粘贴剧本或小说 → AI 识别 → 分析 → 资产 → 故事板 → 视频</em>
        </div>

        <div className="xkm-command-input-shell">
          <div className="xkm-command-chip-row" aria-label="快捷开始">
            <button type="button" onClick={() => setHomeDraft('')} className="xkm-command-chip is-active">
              粘贴小说章节
            </button>
            <button
              type="button"
              onClick={() => setHomeDraft('短剧大纲：\n主角：\n核心冲突：\n结尾反转：')}
              className="xkm-command-chip"
            >
              导入短剧大纲
            </button>
            <button type="button" onClick={() => onNewProject()} className="xkm-command-chip">
              空白项目
            </button>
          </div>
          <textarea
            value={homeDraft}
            onChange={(event) => setHomeDraft(event.target.value)}
            placeholder="粘贴小说章节、短剧剧本、分镜文本或一句话点子..."
            aria-label="创作输入区"
          />
          <div className="xkm-command-actions">
            <span className="xkm-command-action-hint">
              粘贴内容可直接创建项目；已有项目可从下方入口继续。
            </span>
            <Button
              type="button"
              className="xkm-command-submit brand-gradient"
              onClick={handlePrimaryStart}
            >
              {hasHomeDraft ? '用草稿创建项目' : currentProject ? '继续制作' : '开始创作'}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="xkm-command-status-line" title={statusLine}>
          <span>当前</span>
          <strong>{recentProjectName}</strong>
          <i />
          <strong>{recentChapterName}</strong>
          <i />
          <strong>后台{activeTasks > 0 ? `${activeTasks} 个运行中` : '空闲'}</strong>
        </div>
      </section>

      <section className="xkm-home-section">
        <div className="xkm-home-section-head">
          <p className="xkm-hub-eyebrow">核心功能</p>
          <h3>按制作阶段进入</h3>
        </div>
        <div className="xkm-workbench-groups">
          <div className="xkm-workbench-group is-primary">
            <span className="xkm-workbench-group-label">推荐开始</span>
            <div className="xkm-workbench-grid">
              <WorkbenchCard
                icon={Film}
                title="短剧制作"
                description={currentProject ? '继续当前项目' : '已有剧本，走完整成片流程。'}
                meta="主流程"
                primaryLabel={currentProject ? '进入流程' : '新建项目'}
                onPrimary={currentProject ? onOpenChapter : onNewProject}
                featured
              />
              <WorkbenchCard
                icon={Sparkles}
                title="剧本策划"
                description="还没剧本，先做人设、系列和分集。"
                meta="策划"
                primaryLabel={currentProject ? '打开策划' : '新建后策划'}
                onPrimary={currentProject ? onOpenSeries : onNewProject}
              />
            </div>
          </div>
          <div className="xkm-workbench-group">
            <span className="xkm-workbench-group-label">制作资产</span>
            <div className="xkm-workbench-grid">
              <WorkbenchCard
                icon={Layers}
                title="创作画布"
                description="把素材、分镜、故事板和视频结果放到一张画布里整理。"
                meta="画布"
                primaryLabel="打开"
                onPrimary={onOpenCanvasWorkbench}
              />
              <WorkbenchCard
                icon={ImageIcon}
                title="图片工作台"
                description="单图、图生图、多参考图和临时素材。"
                meta="图片"
                primaryLabel="打开"
                onPrimary={onOpenImageWorkbench}
              />
              <WorkbenchCard
                icon={Clapperboard}
                title="视频工作台"
                description="单条视频测试、参考图验证、模型试跑。"
                meta="视频"
                primaryLabel="打开"
                onPrimary={onOpenVideoWorkbench}
              />
            </div>
          </div>
          <div className="xkm-workbench-group">
            <span className="xkm-workbench-group-label">管理</span>
            <div className="xkm-workbench-grid">
              <WorkbenchCard
                icon={Loader2}
                title="任务中心"
                description="后台队列、失败重试、历史日志。"
                meta={activeTasks > 0 ? `${activeTasks} 个运行中` : '管理'}
                primaryLabel="查看"
                onPrimary={onOpenTaskCenter}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function TaskCenterLanding({ state }: { state: ReturnType<typeof useCurrentProject>['state'] }) {
  const tasks = state.globalTasks
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);

  return (
    <WorkbenchShell
      eyebrow="任务中心"
      title="后台任务统一可视化"
      description="短剧、图片、视频和 Agent 触发的后台任务都应该在这里统一展示、重试和补救。"
    >
      <section className="xkm-task-list">
        {tasks.length === 0 ? (
          <div className="xkm-empty-task">
            <Loader2 className="h-4 w-4" />
            暂无后台任务
          </div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="xkm-task-row">
              <div>
                <strong>{task.type}</strong>
                <span>{task.projectId} / {task.chapterId}</span>
              </div>
              <Badge variant="outline">{task.status}</Badge>
            </div>
          ))
        )}
      </section>
    </WorkbenchShell>
  );
}

function AppContent() {
  const { state, dispatch, currentProject, currentChapter, persistenceStatus } = useCurrentProject();
  const { confirm, ConfirmDialog } = useConfirm();
  const { prompt, PromptDialog } = usePrompt();

  const [welcomeOpen, setWelcomeOpen] = useState(false);

  const [activeView, setActiveView] = useState<ActiveView>(() => {
    const hasProject = state.projects.length > 0;
    try {
      const storedView = normalizeStoredActiveView(localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY));
      if (storedView === 'canvas-workbench') return 'home';
      if (storedView) return storedView;
    } catch {
      // Ignore private-mode storage failures.
    }
    return getDefaultActiveView(hasProject);
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const versionToastShownRef = useRef(false);

  const openView = (view: ActiveView) => {
    setActiveView(view);
  };

  const handleNewProject = async (initialRawScript?: string) => {
    const name = await prompt('输入项目名称：', '新项目');
    if (!name?.trim()) return;
    dispatch({ type: 'CREATE_PROJECT', name: name.trim(), initialRawScript });
    openView('chapter');
    setWelcomeOpen(false);
  };

  useEffect(() => {
    try {
      if (activeView === 'canvas-workbench') {
        localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, 'home');
        return;
      }
      localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, activeView);
    } catch {
      // Ignore private-mode storage failures.
    }
  }, [activeView]);

  useEffect(() => {
    if (!persistenceStatus.hasHydrated) return;
    const hasProject = state.projects.length > 0;
    const hasChapter = !!currentChapter;
    if (!canOpenActiveView(activeView, hasProject, hasChapter)) {
      setActiveView(getDefaultActiveView(hasProject));
    }
  }, [activeView, currentChapter, persistenceStatus.hasHydrated, state.projects.length]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      // Ignore private-mode storage failures.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    let cancelled = false;

    const checkForUpdates = async () => {
      if (cancelled || versionToastShownRef.current) return;

      const manifest = await fetchVersionManifest();
      if (!manifest || cancelled) return;
      if (manifest.buildLabel === getCurrentBuildLabel()) return;

      versionToastShownRef.current = true;
      toast.info('发现新版本，点击刷新即可更新。', {
        id: 'app-version-update',
        duration: Infinity,
        action: {
          label: '立即刷新',
          onClick: () => window.location.reload(),
        },
        cancel: {
          label: '稍后',
          onClick: () => undefined,
        },
      });
    };

    const intervalId = window.setInterval(checkForUpdates, getVersionCheckIntervalMs());
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkForUpdates();
      }
    };

    window.addEventListener('focus', checkForUpdates);
    document.addEventListener('visibilitychange', onVisibilityChange);
    void checkForUpdates();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', checkForUpdates);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!hasActiveLongRunningTasks(state)) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state]);

  const workflowChecklistItems = buildWorkflowChecklist(currentChapter);
  const workflowStatusById = new Map(workflowChecklistItems.map((item) => [item.id, item.status]));
  const storyboards = currentChapter?.storyboards ?? [];
  const promptReadyCount = storyboards.filter(isStoryboardPromptReady).length;
  const videoDoneCount = storyboards.filter((storyboard) => storyboard.videoStatus === 'done').length;
  const activeWorkflowIdByStatus: Partial<Record<Chapter['status'], HeaderWorkflowStep['id']>> = {
    idle: 'script',
    scripting: 'script',
    adapting: 'script',
    analyzing: 'analysis',
    assets: 'assets',
    generating: 'prompts',
    videos: 'videos',
    dubbing: 'render',
    compositing: 'render',
  };
  const activeWorkflowId =
    activeView === 'chapter' && currentChapter ? activeWorkflowIdByStatus[currentChapter.status] : undefined;
  const getHeaderWorkflowStatus = (id: HeaderWorkflowStep['id']) =>
    activeWorkflowId === id ? 'active' : workflowStatusById.get(id) ?? 'todo';
  const openWorkflowStep = (status: Chapter['status']) => {
    if (!currentChapter) return;
    openView('chapter');
    dispatch({ type: 'SET_CHAPTER_STATUS', status, chapterId: currentChapter.id });
  };
  const headerWorkflowSteps: HeaderWorkflowStep[] = [
    {
      id: 'script',
      label: '脚本',
      status: getHeaderWorkflowStatus('script'),
      disabled: !currentChapter,
      title: '打开脚本输入与改编',
      onClick: () => openWorkflowStep('idle'),
    },
    {
      id: 'analysis',
      label: '分析',
      status: getHeaderWorkflowStatus('analysis'),
      disabled: !currentChapter?.analysis,
      title: currentChapter?.analysis ? '打开分析结果' : '需要先完成脚本分析',
      onClick: () => openWorkflowStep('analyzing'),
    },
    {
      id: 'assets',
      label: '资产',
      status: getHeaderWorkflowStatus('assets'),
      disabled: storyboards.length === 0,
      title: storyboards.length > 0 ? '打开图片资产工作台' : '需要先确认分镜分析',
      onClick: () => openWorkflowStep('assets'),
    },
    {
      id: 'prompts',
      label: '故事板',
      status: getHeaderWorkflowStatus('prompts'),
      disabled: storyboards.length === 0,
      title: storyboards.length > 0 ? '打开故事板生成' : '需要先生成分镜',
      onClick: () => openWorkflowStep('generating'),
    },
    {
      id: 'videos',
      label: '视频',
      status: getHeaderWorkflowStatus('videos'),
      disabled: promptReadyCount === 0,
      title: promptReadyCount > 0 ? '打开视频生成' : '需要先完成故事板',
      onClick: () => openWorkflowStep('videos'),
    },
    {
      id: 'render',
      label: '成片',
      status: getHeaderWorkflowStatus('render'),
      disabled: videoDoneCount === 0,
      title: videoDoneCount > 0 ? '打开成片合成' : '需要至少完成 1 个视频',
      onClick: () => openWorkflowStep('compositing'),
    },
  ];

  if (state.projects.length > 0 && !currentChapter) {
    console.warn('[App] currentChapter is null - showing fallback');
    return (
      <div className={cn('flex h-screen flex-col overflow-hidden bg-background', ENABLE_NEXT_UI_PREVIEW && 'next-ui-preview')}>
        <Header
          onNewProject={handleNewProject}
          onOpenHome={() => openView('home')}
          variant={ENABLE_NEXT_UI_PREVIEW ? 'next' : 'classic'}
          workflowSteps={ENABLE_NEXT_UI_PREVIEW ? headerWorkflowSteps : undefined}
        />
        <main className="workspace-backdrop flex-1 overflow-y-auto px-8 py-8">
          <div className="surface-panel rounded-[28px] px-6 py-8">
            <p className="text-destructive">章节加载异常，请刷新重试。</p>
            <Button className="mt-4" onClick={() => dispatch({ type: 'CREATE_PROJECT', name: '新项目' })}>
              新建项目
            </Button>
          </div>
        </main>
        {ConfirmDialog}
        {PromptDialog}
      </div>
    );
  }

  return (
    <div className={cn('flex h-screen flex-col overflow-hidden bg-background', ENABLE_NEXT_UI_PREVIEW && 'next-ui-preview')}>
      <Header
        onNewProject={handleNewProject}
        onOpenHome={() => openView('home')}
        variant={ENABLE_NEXT_UI_PREVIEW ? 'next' : 'classic'}
        workflowSteps={ENABLE_NEXT_UI_PREVIEW ? headerWorkflowSteps : undefined}
      />

      <div className={cn(
        'flex flex-1 overflow-hidden',
        ENABLE_NEXT_UI_PREVIEW && 'next-ui-shell',
        sidebarCollapsed && 'is-sidebar-collapsed',
      )}>
        <Sidebar
          variant={ENABLE_NEXT_UI_PREVIEW ? 'next' : 'classic'}
          activeView={activeView}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
          onOpenHome={() => openView('home')}
          onOpenSeries={() => openView('series')}
          onOpenChapter={() => openView('chapter')}
          onOpenCanvas={() => openView('canvas-workbench')}
          onOpenImageWorkbench={() => openView('image-workbench')}
          onOpenVideoWorkbench={() => openView('video-workbench')}
          onOpenTaskCenter={() => openView('task-center')}
        />

        <main className={cn('workspace-backdrop min-h-0 min-w-0 flex-1', activeView === 'canvas-workbench' ? 'overflow-hidden' : 'overflow-y-auto')}>
          <div
            className={cn(
              activeView === 'canvas-workbench'
                ? 'h-full min-h-0 max-w-none p-0'
                : 'mx-auto max-w-6xl px-5 py-6 sm:px-6 lg:px-8',
              ENABLE_NEXT_UI_PREVIEW && activeView !== 'canvas-workbench' && 'next-ui-content',
            )}
          >
            {activeView === 'home' ? (
              <CreationCenter
                state={state}
                currentProject={currentProject}
                currentChapter={currentChapter}
                onNewProject={handleNewProject}
                onOpenSeries={() => openView('series')}
                onOpenChapter={() => openView('chapter')}
                onOpenImageWorkbench={() => openView('image-workbench')}
                onOpenVideoWorkbench={() => openView('video-workbench')}
                onOpenCanvasWorkbench={() => openView('canvas-workbench')}
                onOpenTaskCenter={() => openView('task-center')}
              />
            ) : activeView === 'image-workbench' ? (
              <ImageWorkbench />
            ) : activeView === 'video-workbench' ? (
              <VideoWorkbench />
            ) : activeView === 'canvas-workbench' ? (
              <CanvasWorkbench />
            ) : activeView === 'task-center' ? (
              <TaskCenterLanding state={state} />
            ) : activeView === 'series' && currentProject ? (
              <div className={cn('animate-fade-in', ENABLE_NEXT_UI_PREVIEW && 'next-stage-body next-stage-series')}>
                <Suspense fallback={<StepLoadingFallback />}>
                  <SeriesDesigner onOpenChapter={() => openView('chapter')} />
                </Suspense>
              </div>
            ) : (
              <>
            <WorkspaceHeader
              projectName={currentProject?.name}
              chapter={currentChapter}
              frameRatio={state.videoApiConfig.videoRatio}
            />
            {!ENABLE_NEXT_UI_PREVIEW && <WorkflowChecklist chapter={currentChapter} />}

            {!currentChapter && (
              <div className={cn('surface-panel animate-fade-in flex min-h-[60vh] flex-col items-center justify-center rounded-[28px] px-8 py-12 text-center', ENABLE_NEXT_UI_PREVIEW && 'next-empty-state')}>
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-muted/50">
                  <Film className="h-10 w-10 text-muted-foreground/30" />
                </div>
                <h2 className="mb-1 text-lg font-medium text-muted-foreground/60">暂无工作内容</h2>
                <p className="max-w-xs text-sm text-muted-foreground/40">
                  创建项目后，即可开始 AI 剧本分析与短漫视频生成。
                </p>
              </div>
            )}

            {currentChapter &&
              (currentChapter.status === 'idle' ||
                currentChapter.status === 'scripting' ||
                currentChapter.status === 'adapting') && (
                <div className={cn('animate-fade-in', ENABLE_NEXT_UI_PREVIEW && 'next-stage-body next-stage-script')}>
                  <Suspense fallback={<StepLoadingFallback />}>
                    <ScriptInput
                      key={currentChapter.id}
                      onOpenSeries={() => openView('series')}
                    />
                  </Suspense>
                </div>
              )}

            {currentChapter &&
              currentChapter.status === 'analyzing' &&
              currentChapter.analysis && (
                <div className={cn('animate-fade-in space-y-2', ENABLE_NEXT_UI_PREVIEW && 'next-stage-body next-stage-analysis')}>
                  <Suspense fallback={<StepLoadingFallback />}>
                    <AnalysisResult key={currentChapter.id} />
                  </Suspense>
                  {!ENABLE_NEXT_UI_PREVIEW && (
                    <StepNavigation
                      onBack={() => dispatch({ type: 'SET_CHAPTER_STATUS', status: 'idle' })}
                      backLabel="返回修改脚本"
                    />
                  )}
                </div>
              )}

            {currentChapter && currentChapter.status === 'assets' && (() => {
              const assetRefs = currentChapter.storyboards.flatMap((storyboard) => storyboard.imageRefs ?? []);
              const assetTotal = assetRefs.length;
              const assetBound = assetRefs.filter((ref) => !!ref.assetId).length;
              const assetReady = assetTotal === 0 || assetBound >= assetTotal;

              return (
                <div className={cn('animate-fade-in space-y-2', ENABLE_NEXT_UI_PREVIEW && 'next-stage-body next-stage-assets')}>
                  <Suspense fallback={<StepLoadingFallback />}>
                    {ENABLE_NEXT_UI_PREVIEW ? (
                      <AssetManagerNextPreview key={currentChapter.id} />
                    ) : (
                      <AssetManager key={currentChapter.id} />
                    )}
                  </Suspense>
                  <StepNavigation
                    onBack={async () => {
                      if (await confirm('确定要返回修改分析结果吗？')) {
                        dispatch({ type: 'SET_CHAPTER_STATUS', status: 'analyzing' });
                      }
                    }}
                    backLabel="返回修改分析结果"
                    onForward={() => dispatch({ type: 'SET_CHAPTER_STATUS', status: 'generating' })}
                    forwardLabel={isStoryboardDirectorChapter(currentChapter) ? '进入故事板生成' : '进入提示词生成'}
                    forwardColorClass="border-success/50 text-success hover:bg-success/10"
                    summaryBadge={(
                      <Badge variant={assetReady ? 'secondary' : 'outline'} className={assetReady ? 'bg-success/10 text-success' : 'border-brand-orange/50 text-brand-orange'}>
                        {assetBound}/{assetTotal || 0}
                      </Badge>
                    )}
                    summaryTitle={assetReady ? '图片资产已就绪，可进入故事板生成' : '图片资产仍有缺口，也可以继续进入下一步'}
                    summaryDetail={assetTotal > 0
                      ? `参考图绑定 ${assetBound}/${assetTotal} · 进入下一步后仍可回来补图、压缩和替换`
                      : '当前还没有参考图需求，可先进入故事板生成'}
                  />
                </div>
              );
            })()}

            {currentChapter &&
              currentChapter.status === 'generating' &&
              (() => {
              const allStoryboards = currentChapter.storyboards ?? [];
              const doneCount = allStoryboards.filter(isStoryboardPromptReady).length;
              const total = allStoryboards.length;
                const step4OutputLabel = isStoryboardDirectorChapter(currentChapter) ? '故事板' : '提示词';
                const allDone = doneCount === total && total > 0;
                const missingReferenceCount = allStoryboards.reduce(
                  (sum, sb) => sum + getMissingImageReferenceLabels(sb.imageRefs).length,
                  0,
                );

                return (
                  <div className={cn('animate-fade-in space-y-2', ENABLE_NEXT_UI_PREVIEW && 'next-stage-body next-stage-prompts')}>
                    <Suspense fallback={<StepLoadingFallback />}>
                      <PromptGenerator key={currentChapter.id} />
                    </Suspense>
                    <StepNavigation
                      onBack={async () => {
                        if (await confirm('确定要返回图片资产管理吗？')) {
                          dispatch({ type: 'SET_CHAPTER_STATUS', status: 'assets' });
                        }
                      }}
                      backLabel="返回图片资产管理"
                      onForward={async () => {
                        if (allDone) {
                          dispatch({ type: 'SET_CHAPTER_STATUS', status: 'videos' });
                        } else {
                          const readinessWarningText = `已准备好 ${doneCount}/${total} 个分镜${step4OutputLabel}。${missingReferenceCount > 0 ? `还有 ${missingReferenceCount} 个参考图未绑定 Step3 资产；` : ''}未准备好的分镜将无法稳定生成视频。确认仍然进入吗？`;
                          const confirmed = await confirm(readinessWarningText);
                          if (confirmed) {
                            dispatch({ type: 'SET_CHAPTER_STATUS', status: 'videos' });
                          }
                        }
                      }}
                      forwardLabel="进入视频生成"
                      forwardVariant={allDone ? 'default' : 'outline'}
                      forwardColorClass={
                        !allDone ? 'border-success/50 text-success hover:bg-success/10' : ''
                      }
                      badge={(
                        <Badge
                          variant={allDone ? 'secondary' : 'outline'}
                          className={cn(
                            'ml-1.5 text-xs',
                            allDone
                              ? 'bg-success/10 text-success'
                              : 'border-success/50 text-success',
                          )}
                        >
                          {doneCount}/{total}
                        </Badge>
                      )}
                      summaryBadge={(
                        <Badge variant={allDone ? 'secondary' : 'outline'} className={allDone ? 'bg-success/10 text-success' : 'border-brand-orange/50 text-brand-orange'}>
                          {doneCount}/{total}
                        </Badge>
                      )}
                      summaryTitle={allDone ? '故事板已完成，可进入视频生成' : '故事板尚未全部完成，进入前会提示确认'}
                      summaryDetail={`${step4OutputLabel} ${doneCount}/${total}${missingReferenceCount > 0 ? ` · 参考图缺口 ${missingReferenceCount}` : ''}`}
                    />
                  </div>
                );
              })()}

            {currentChapter && currentChapter.status === 'videos' && (
              (() => {
                const videoReadyTotal = currentChapter.storyboards.filter(isStoryboardPromptReady).length;
                const videoTotal = currentChapter.storyboards.length;
                const videoDone = currentChapter.storyboards.filter((sb) => sb.videoStatus === 'done').length;
                const canEnterCompositing = videoDone > 0;
                const isPartialVideoReady = canEnterCompositing && videoDone < videoTotal;
                const compositingDisabledReason = videoReadyTotal === 0
                  ? isStoryboardDirectorChapter(currentChapter)
                    ? '请先完成 Step4 分镜故事板，再进入成片合成。'
                    : '请先完成 Step4 分镜提示词，再进入成片合成。'
                  : '请至少完成 1 个视频，再进入成片合成。';
                const compositingTitle = !canEnterCompositing
                  ? compositingDisabledReason
                  : isPartialVideoReady
                    ? `当前已完成 ${videoDone}/${videoTotal}，可先合成已完成片段；最终成片前建议补齐剩余视频。`
                    : '进入成片合成';

                return (
                  <div className={cn('animate-fade-in space-y-2', ENABLE_NEXT_UI_PREVIEW && 'next-stage-body next-stage-videos')}>
                    <Suspense fallback={<StepLoadingFallback />}>
                      <Step5VideoGenerator key={currentChapter.id} />
                    </Suspense>
                    <StepNavigation
                      onBack={async () => {
                        if (
                          await confirm(
                            isStoryboardDirectorChapter(currentChapter)
                              ? '确定要返回分镜故事板生成吗？正在生成的视频可能会受到影响。'
                              : '确定要返回分镜提示词生成吗？正在生成的视频可能会受到影响。',
                          )
                        ) {
                          dispatch({ type: 'SET_CHAPTER_STATUS', status: 'generating' });
                        }
                      }}
                      backLabel={isStoryboardDirectorChapter(currentChapter) ? '返回故事板生成' : '返回提示词生成'}
                      onForward={() => dispatch({ type: 'SET_CHAPTER_STATUS', status: 'compositing' })}
                      forwardLabel="进入成片合成"
                      forwardVariant={canEnterCompositing ? 'default' : 'outline'}
                      forwardColorClass={canEnterCompositing ? 'border-warning/50 text-warning hover:bg-warning/10' : ''}
                      forwardDisabled={!canEnterCompositing}
                      forwardTitle={compositingTitle}
                      badge={(
                        <Badge
                          variant={canEnterCompositing ? 'secondary' : 'outline'}
                          className={cn(
                            'ml-1.5 text-xs',
                            canEnterCompositing && !isPartialVideoReady
                              ? 'bg-success/10 text-success'
                              : isPartialVideoReady
                                ? 'bg-warning/10 text-warning'
                              : 'border-muted-foreground/30 text-muted-foreground',
                          )}
                        >
                          {videoDone}/{videoTotal}
                        </Badge>
                      )}
                      summaryBadge={(
                        <Badge
                          variant={canEnterCompositing ? 'secondary' : 'outline'}
                          className={cn(
                            canEnterCompositing && !isPartialVideoReady
                              ? 'bg-success/10 text-success'
                              : isPartialVideoReady
                                ? 'bg-warning/10 text-warning'
                                : 'border-muted-foreground/30 text-muted-foreground',
                          )}
                        >
                          {videoDone}/{videoTotal}
                        </Badge>
                      )}
                      summaryTitle={
                        !canEnterCompositing
                          ? '请先至少完成 1 个视频，再进入成片合成'
                          : videoDone >= videoTotal && videoTotal > 0
                            ? '本集视频已完成，可进入成片合成'
                            : '可先合成已完成片段，最终成片前再补齐视频'
                      }
                      summaryDetail={canEnterCompositing
                        ? `已完成视频 ${videoDone}/${videoTotal} · Step7 会直接使用 Step5 视频原声合成`
                        : compositingDisabledReason}
                    />
                  </div>
                );
              })()
            )}

            {currentChapter && (currentChapter.status === 'compositing' || currentChapter.status === 'dubbing') && (
              <div className={cn('animate-fade-in space-y-2', ENABLE_NEXT_UI_PREVIEW && 'next-stage-body next-stage-compositing')}>
                <Suspense fallback={<StepLoadingFallback />}>
                  <Step7Compositor key={currentChapter.id} />
                </Suspense>
                <StepNavigation
                  onBack={async () => {
                    if (await confirm('确定要返回视频生成吗？')) {
                      dispatch({ type: 'SET_CHAPTER_STATUS', status: 'videos' });
                    }
                  }}
                  backLabel="返回视频生成"
                  summaryTitle="成片合成工作台"
                  summaryDetail="默认使用 Step5 视频原声；只会合成已启用片段，未启用片段会保留在方案中等待补齐。"
                  sticky={false}
                />
              </div>
            )}
              </>
            )}
          </div>
        </main>
      </div>

      {ConfirmDialog}
      {PromptDialog}
      <GlobalTaskFloatingPanel onOpenChapter={() => openView('chapter')} />
      {state.projects.length === 0 && (
        <WelcomeDialog
          open={welcomeOpen}
          onOpenChange={setWelcomeOpen}
          onCreate={handleNewProject}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <ProjectProvider>
        <StepGlobalTaskProvider>
          <Step4TaskProvider>
            <Step5TaskProvider>
              <AppContent />
            </Step5TaskProvider>
          </Step4TaskProvider>
        </StepGlobalTaskProvider>
      </ProjectProvider>
      <Toaster />
    </AppErrorBoundary>
  );
}
