import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ChevronDown,
  Download,
  Grid3x3,
  ImageIcon,
  Import as ImportIcon,
  Layers,
  Languages,
  ListChecks,
  Loader2,
  RotateCcw,
  Sparkles,
  Wand2,
  XCircle,
} from '@/components/icons';
import type {
  EpisodeShotSheetSegment,
  StoryboardBoardMode,
  StoryboardBoardReferenceBudgetItem,
  StoryboardBoardStyle,
  StoryboardBoardVariantState,
  StoryboardSequenceContinuityContext,
} from '@/types';
import type { ResolvedStoryboardBoardReference } from './storyboardReferenceResolver';
import type { StoryboardBoardConditionCheck } from './useStoryboardBoardGeneration';
import type { StoryboardBoardQualityReport, StoryboardBoardQualityTone } from './storyboardBoardQuality';
import type { SeedanceFinalVideoPromptState } from './seedanceFinalPrompt';
import { buildStoryboardBoardGenerationProgress } from './storyboardBoardGenerationProgress';
import {
  formatStoryboardPanelLabel,
  getStoryboardBoardExpectedPanelCount,
  isFixedShotPlanBoardMode,
  isShotPlanBoardMode,
  isSmartShotPlanBoardMode,
} from './storyboardBoardMode';

interface StoryboardBoardCardProps {
  boardState?: StoryboardBoardVariantState;
  selectedMode: StoryboardBoardMode;
  storyboardDuration?: string;
  smartVideoDurationSeconds?: number;
  smartVideoDurationReason?: string;
  previewAspectRatio: 'PORTRAIT' | 'LANDSCAPE';
  shotPlanFrameRatio: '9:16' | '16:9';
  previewUrl: string | null;
  visualPreviewUrl?: string | null;
  storyboardBoardReferenceEnabled: boolean;
  promptPreview: string;
  planPreview: string;
  references: ResolvedStoryboardBoardReference[];
  missingReferenceLabels: string[];
  conditionChecks: StoryboardBoardConditionCheck[];
  qualityReport: StoryboardBoardQualityReport;
  episodeShotSheetSegment?: EpisodeShotSheetSegment;
  sequenceContinuityContext?: StoryboardSequenceContinuityContext;
  boardStyle: StoryboardBoardStyle;
  optimizeDisabledReason: string | null;
  generateDisabledReason: string | null;
  seedanceFinalPromptPreview: string;
  seedanceFinalPromptState: SeedanceFinalVideoPromptState;
  seedanceFinalPromptDisabledReason: string | null;
  hasFreshPlan: boolean;
  isOptimizingPlan: boolean;
  isGenerating: boolean;
  onModeChange: (mode: StoryboardBoardMode) => void;
  onStyleChange: (style: StoryboardBoardStyle) => void;
  onOptimizePlan: () => void | Promise<unknown>;
  onGenerate: () => void | Promise<unknown>;
  onRefreshSeedanceFinalPrompt: () => void | Promise<unknown>;
  onImportImageUrl: (imageUrl: string) => void | Promise<unknown>;
  onRepairText: () => void | Promise<unknown>;
  onClear: () => void | Promise<unknown>;
  onDownload: () => void | Promise<unknown>;
}

function getReferenceBudgetDecisionLabel(decision: StoryboardBoardReferenceBudgetItem['decision']) {
  if (decision === 'mustKeep') return '必保';
  if (decision === 'textFallback') return '文字兜底';
  return '优先保留';
}

function getReferenceBudgetDecisionClass(decision: StoryboardBoardReferenceBudgetItem['decision']) {
  if (decision === 'mustKeep') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (decision === 'textFallback') return 'border-muted-foreground/30 bg-muted/40 text-muted-foreground';
  return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300';
}

const MODE_OPTIONS: Array<{ value: StoryboardBoardMode; label: string; hint: string; disabledReason?: string }> = [
  { value: 'nine-portrait', label: '竖版故事板', hint: '暂未开放 · 9:16 · 3x3故事板', disabledReason: '九宫格模式还在优化中，暂时只使用15格 Shot Sheet。' },
  { value: 'nine-landscape', label: '横版故事板', hint: '暂未开放 · 16:9 · 3x3故事板', disabledReason: '九宫格模式还在优化中，暂时只使用15格 Shot Sheet。' },
  { value: 'shot-plan-landscape', label: '横向 Shot Sheet', hint: '16:9 · 15格详细截图' },
  { value: 'smart-shot-plan-landscape', label: '智能故事板', hint: '16:9 · 自动6/9/12/15格' },
];

const STYLE_OPTIONS: Array<{ value: StoryboardBoardStyle; label: string; hint: string; disabledReason?: string }> = [
  { value: 'seedance-board', label: '详细故事板', hint: '九宫格 / 15格通用详细故事板' },
  { value: 'cinematic', label: '干净电影帧', hint: '暂未使用 · 更接近成片关键帧', disabledReason: '当前九宫格和15格都只使用详细故事板样式。' },
  { value: 'stick-figure', label: '低保真草图', hint: '暂未使用 · 只锁站位和动作', disabledReason: '当前九宫格和15格都只使用详细故事板样式。' },
];

function getStatusMeta(boardState?: StoryboardBoardVariantState) {
  if (!boardState) {
    return {
      label: '未生成',
      className: 'border-muted-foreground/30 text-muted-foreground',
      icon: ImageIcon,
    };
  }

  if (boardState.status === 'generating') {
    return {
      label: '生成中',
      className: 'border-brand-violet/30 bg-brand-violet/10 text-purple-600',
      icon: Loader2,
    };
  }

  if (boardState.status === 'done') {
    return {
      label: boardState.isStale ? '需更新' : '已生成',
      className: boardState.isStale
        ? 'border-warning/40 bg-warning/10 text-warning'
        : 'border-success/40 bg-success/10 text-success',
      icon: boardState.isStale ? AlertCircle : CheckCircle2,
    };
  }

  if (boardState.status === 'failed') {
    return {
      label: '生成失败',
      className: 'border-destructive/40 bg-destructive/10 text-destructive',
      icon: XCircle,
    };
  }

  return {
    label: '待生成',
    className: 'border-muted-foreground/30 text-muted-foreground',
    icon: ImageIcon,
  };
}

function formatGeneratedAt(timestamp?: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function useActionRunner() {
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function runAction(actionName: string, action: () => void | Promise<unknown>) {
    if (busyAction) return;
    setBusyAction(actionName);
    try {
      await action();
    } finally {
      setBusyAction(null);
    }
  }

  return { busyAction, runAction };
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-foreground">{value}</span>
    </div>
  );
}

function getToneClassName(tone: StoryboardBoardQualityTone) {
  if (tone === 'pass') return 'border-success/30 bg-success/10 text-success';
  if (tone === 'fail') return 'border-destructive/30 bg-destructive/10 text-destructive';
  return 'border-warning/30 bg-warning/10 text-warning';
}

function getReferenceDuty(type: ResolvedStoryboardBoardReference['imageRef']['type']) {
  if (type === 'scene') return '锁空间、材质、光线方向';
  if (type === 'prop') return '锁形状、材质、使用关系';
  return '锁角色身份、服装、体态';
}

function getGenerationProgressClassName(tone: 'normal' | 'slow' | 'very-slow' | 'stalled') {
  if (tone === 'stalled') return 'border-destructive/40 bg-destructive/10 text-destructive dark:border-destructive/35 dark:bg-destructive/15 dark:text-red-100';
  if (tone === 'very-slow') return 'border-amber-400/40 bg-amber-50 text-amber-950 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100';
  if (tone === 'slow') return 'border-sky-300/50 bg-sky-50 text-sky-950 dark:border-sky-400/25 dark:bg-sky-500/10 dark:text-sky-100';
  return 'border-indigo-300/50 bg-indigo-50 text-indigo-950 dark:border-indigo-400/25 dark:bg-indigo-500/10 dark:text-indigo-100';
}

type Step4FoldIcon = (props: { className?: string }) => ReactNode;

function FoldedInfoSection({
  title,
  icon: Icon,
  badge,
  children,
  className = 'bg-background/70',
  contentClassName = 'px-3 pb-3',
}: {
  title: string;
  icon?: Step4FoldIcon;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Collapsible className={`rounded-xl border border-border/70 ${className}`}>
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {Icon ? <Icon className="h-4 w-4 shrink-0 text-sky-500" /> : null}
          <span className="min-w-0 truncate">{title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge}
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-full p-0 text-muted-foreground"
              title="展开 / 收起"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </CollapsibleTrigger>
        </div>
      </div>
      <CollapsibleContent className={contentClassName}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function StoryboardBoardCard({
  boardState,
  selectedMode,
  storyboardDuration,
  smartVideoDurationSeconds,
  smartVideoDurationReason,
  previewAspectRatio,
  shotPlanFrameRatio,
  previewUrl,
  visualPreviewUrl,
  storyboardBoardReferenceEnabled,
  promptPreview,
  planPreview,
  references,
  missingReferenceLabels,
  conditionChecks,
  qualityReport,
  episodeShotSheetSegment,
  sequenceContinuityContext,
  boardStyle,
  optimizeDisabledReason,
  generateDisabledReason,
  seedanceFinalPromptPreview,
  seedanceFinalPromptState,
  seedanceFinalPromptDisabledReason,
  hasFreshPlan,
  isOptimizingPlan,
  isGenerating,
  onModeChange,
  onStyleChange,
  onOptimizePlan,
  onGenerate,
  onRefreshSeedanceFinalPrompt,
  onImportImageUrl,
  onRepairText,
  onClear,
  onDownload,
}: StoryboardBoardCardProps) {
  const { busyAction, runAction } = useActionRunner();
  const [importImageUrl, setImportImageUrl] = useState('');
  const [importImageError, setImportImageError] = useState<string | null>(null);
  const [progressNow, setProgressNow] = useState(() => Date.now());
  const statusMeta = getStatusMeta(boardState);
  const StatusIcon = statusMeta.icon;
  const modeOptions = useMemo(
    () => MODE_OPTIONS.map((option) => option.value === 'shot-plan-landscape'
      ? { ...option, hint: `${shotPlanFrameRatio} · 15格详细截图` }
      : option.value === 'smart-shot-plan-landscape'
        ? { ...option, hint: `${shotPlanFrameRatio} · 自动6/9/12/15格` }
      : option),
    [shotPlanFrameRatio],
  );
  const selectedOption = modeOptions.find((option) => option.value === selectedMode) ?? modeOptions[0];
  const selectedModeDisabledReason = selectedOption.disabledReason ?? null;
  const generatedAt = formatGeneratedAt(boardState?.generatedAt);
  const hasBoardImage = !!boardState?.blobKey;
  const directorPlan = boardState?.plan;
  const shouldShowImportImageRecovery = hasFreshPlan && !!directorPlan && (!hasBoardImage || boardState?.status === 'failed');
  const storyboardBoardStep5Used = storyboardBoardReferenceEnabled && hasBoardImage;
  const seedanceFinalPromptChars = seedanceFinalPromptPreview.trim().length;
  const seedanceFinalPromptBusy = seedanceFinalPromptState.status === 'generating';
  const canRepairBoardText = hasBoardImage
    && !boardState?.visualBoardBlobKey
    && !!directorPlan
    && boardStyle === 'seedance-board'
    && !isShotPlanBoardMode(selectedMode);
  const actionBusy = !!busyAction || isOptimizingPlan || isGenerating;
  const previewAspectClass = previewAspectRatio === 'PORTRAIT' ? 'aspect-[9/16] max-w-[420px]' : 'aspect-video';
  const generateButtonLabel = hasBoardImage ? `重新生成${selectedOption.label}` : `生成${selectedOption.label}`;
  const activeOptimizeDisabledReason = selectedModeDisabledReason ?? optimizeDisabledReason;
  const activeGenerateDisabledReason = selectedModeDisabledReason ?? generateDisabledReason;
  const sequenceContinuityWarnings = sequenceContinuityContext?.warnings ?? [];
  const isShotPlanMode = isShotPlanBoardMode(selectedMode);
  const isFixedShotPlanMode = isFixedShotPlanBoardMode(selectedMode);
  const isSmartShotPlanMode = isSmartShotPlanBoardMode(selectedMode);
  const plannedPanelCount = directorPlan?.panels.length;
  const activePanelCount = isSmartShotPlanMode
    ? plannedPanelCount || getStoryboardBoardExpectedPanelCount(selectedMode, storyboardDuration)
    : isFixedShotPlanMode ? 15 : 9;
  const finalPanelLabel = formatStoryboardPanelLabel(activePanelCount);
  const previousPanelLabel = isSmartShotPlanMode ? '上一镜最终格/End Beat' : isFixedShotPlanMode ? '上一镜S15/End Beat' : '上一镜S09';
  const currentEntryLabel = isShotPlanMode ? '本镜入场/S01' : '本镜S01入点';
  const currentOutLabel = isShotPlanMode ? `本镜${finalPanelLabel}/End Beat` : '本镜S09落幅';
  const qualityTitle = isSmartShotPlanMode ? '智能故事板自检' : isFixedShotPlanMode ? '15格 Shot Sheet 自检' : '详细九宫格自检';
  const panelPlanTitle = isSmartShotPlanMode
    ? plannedPanelCount ? `${plannedPanelCount}格智能导演规划` : '智能导演规划'
    : isFixedShotPlanMode ? '15格导演规划' : '逐格导演说明';
  const boardMetricLabel = isSmartShotPlanMode
    ? plannedPanelCount ? `${plannedPanelCount}格智能故事板` : '智能格数'
    : isFixedShotPlanMode ? '15格 Shot Sheet' : '详细九宫格';
  const boardMetricValue = isSmartShotPlanMode && !plannedPanelCount
    ? '待导演规划后确定'
    : selectedOption.label;
  const transitionBridge = directorPlan?.transitionBridge;
  const directorBrief = directorPlan?.directorBrief;
  const smartDurationLabel = typeof smartVideoDurationSeconds === 'number'
    ? `${smartVideoDurationSeconds}秒`
    : undefined;

  useEffect(() => {
    if (boardState?.status !== 'generating') return undefined;
    const tick = () => setProgressNow(Date.now());
    const initialTick = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(initialTick);
      window.clearInterval(timer);
    };
  }, [boardState?.status, boardState?.startedAt, boardState?.generationTiming?.imageStartedAt]);

  const referenceSummary = useMemo(
    () => references.map(({ imageRef, asset }) => ({
      key: `${imageRef.refId}-${asset.id}`,
      label: `${imageRef.refId} ${imageRef.name}`,
      type: imageRef.type,
      assetName: asset.name,
      duty: getReferenceDuty(imageRef.type),
    })),
    [references],
  );
  const generationProgress = useMemo(
    () => buildStoryboardBoardGenerationProgress(boardState, progressNow, referenceSummary.length),
    [boardState, progressNow, referenceSummary.length],
  );

  async function handleImportImageUrl() {
    const url = importImageUrl.trim();
    if (!url) {
      setImportImageError('请先粘贴已完成图片 URL。');
      return;
    }
    setImportImageError(null);
    try {
      await onImportImageUrl(url);
      setImportImageUrl('');
    } catch (error) {
      setImportImageError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Card className="surface-panel border-white/70">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Grid3x3 className="h-5 w-5 text-purple-500" />
              {isSmartShotPlanMode ? 'Seedance 智能故事板导演' : isFixedShotPlanMode ? 'Seedance 15格导演规划' : 'Seedance 详细九宫格导演'}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Step3 资产负责锁角色、场景和道具；这里把当前分镜整理成带 TIME / SHOT / ACTION / DIALOGUE / SFX / AUDIO / TRANSITION 的整板导演参考，并在 Shot Sheet 模式中单独规划上一镜 End Beat 的入场转场。
            </p>
          </div>
          <Badge variant="outline" className={statusMeta.className}>
            <StatusIcon className={`mr-1 h-3.5 w-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
            {statusMeta.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/30 p-1 md:grid-cols-4">
          {modeOptions.map((option) => {
            const optionDisabled = actionBusy || !!option.disabledReason;
            return (
              <button
                key={option.value}
                type="button"
                className={`rounded-md px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  selectedMode === option.value
                    ? 'bg-background text-foreground shadow-sm'
                    : option.disabledReason
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
                }`}
                disabled={optionDisabled}
                title={option.disabledReason}
                onClick={() => onModeChange(option.value)}
              >
                <span className="block text-xs font-medium">{option.label}</span>
                <span className="block text-[11px]">{option.hint}</span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-1 md:grid-cols-3">
          {STYLE_OPTIONS.map((option) => {
            const optionDisabled = actionBusy || !!option.disabledReason;
            return (
              <button
                key={option.value}
                type="button"
                className={`rounded-md px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  boardStyle === option.value
                    ? 'bg-background text-foreground shadow-sm'
                    : option.disabledReason
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
                }`}
                disabled={optionDisabled}
                title={option.disabledReason}
                onClick={() => onStyleChange(option.value)}
              >
                <span className="block text-xs font-medium">{option.label}</span>
                <span className="block text-[11px]">{option.hint}</span>
              </button>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/20">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={`${selectedOption.label}预览`}
              className={`${previewAspectClass} mx-auto w-full bg-black object-contain`}
            />
          ) : (
            <div className={`${previewAspectClass} mx-auto flex w-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground`}>
              <Grid3x3 className="h-8 w-8 text-muted-foreground/50" />
              <span>还没有{selectedOption.label}预览图</span>
            </div>
          )}
        </div>

        {visualPreviewUrl && (
          <div className="space-y-2 rounded-xl border border-dashed border-border/70 bg-muted/10 p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>视觉层预览</span>
              <span>debug</span>
            </div>
            <img
              src={visualPreviewUrl}
              alt={`${selectedOption.label}视觉层`}
              className={`${previewAspectClass} mx-auto w-full bg-black object-contain`}
            />
          </div>
        )}

        {generationProgress && (
          <section className={`space-y-3 rounded-xl border p-3 text-sm ${getGenerationProgressClassName(generationProgress.tone)}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 font-semibold">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                <span className="min-w-0">{generationProgress.title}</span>
              </div>
              <Badge variant="outline" className="rounded-full border-current/25 bg-background/60 text-[10px]">
                已等待 {generationProgress.elapsedLabel}
              </Badge>
            </div>
            <p className="text-xs leading-5 opacity-85">{generationProgress.detail}</p>
            <div className="grid gap-2 sm:grid-cols-4">
              {generationProgress.steps.map((step) => (
                <div
                  key={step.label}
                  className={`rounded-lg border px-2.5 py-2 text-xs ${
                    step.state === 'done'
                      ? 'border-success/30 bg-success/10 text-success'
                      : step.state === 'active'
                        ? 'border-current/25 bg-background/55 font-medium'
                        : 'border-current/15 bg-background/30 opacity-60'
                  }`}
                >
                  {step.label}
                </div>
              ))}
            </div>
          </section>
        )}

        {boardState?.error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {boardState.error}
          </div>
        )}

        {boardState?.planError && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            {boardState.planError}
          </div>
        )}

        {shouldShowImportImageRecovery && (
          <section className="space-y-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-200">
                <ImportIcon className="h-4 w-4" />
                导入已完成 Shot Sheet
              </div>
              <Badge variant="outline" className="rounded-full border-amber-500/30 bg-background/70 text-[10px]">
                不重新提交图片任务
              </Badge>
            </div>
            <div className="flex flex-col gap-2 md:flex-row">
              <Input
                value={importImageUrl}
                onChange={(event) => setImportImageUrl(event.target.value)}
                placeholder="粘贴 APIMart 图片 URL，或同源路径 /tmp/apimart-first-shot-sheet.png"
                className="h-9 bg-background/80 text-xs"
                disabled={actionBusy}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5 bg-background/80"
                disabled={actionBusy || !importImageUrl.trim()}
                onClick={() => void runAction('import-image-url', handleImportImageUrl)}
              >
                {busyAction === 'import-image-url' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImportIcon className="h-3.5 w-3.5" />
                )}
                导入并恢复
              </Button>
            </div>
            {importImageError ? (
              <div className="text-xs text-destructive">{importImageError}</div>
            ) : (
              <div className="text-xs text-amber-700 dark:text-amber-200">
                用于 APIMart 已完成但本地轮询失败的任务；导入后会作为当前 15宫格参考图继续刷新 Seedance 提交词。
              </div>
            )}
          </section>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-border/70 p-2">
            <div className="text-muted-foreground">{boardMetricLabel}</div>
            <div className="mt-1 font-medium">{boardMetricValue}</div>
          </div>
          <div className="rounded-lg border border-border/70 p-2">
            <div className="text-muted-foreground">参考图</div>
            <div className="mt-1 font-medium">{referenceSummary.length} 张可用</div>
          </div>
          <div className="rounded-lg border border-border/70 p-2">
            <div className="text-muted-foreground">导演规划</div>
            <div className="mt-1 font-medium">{hasFreshPlan ? '已就绪' : '待规划'}</div>
          </div>
          <div className="rounded-lg border border-border/70 p-2">
            <div className="text-muted-foreground">{generationProgress ? '已等待' : '生成时间'}</div>
            <div className="mt-1 font-medium">{generationProgress?.elapsedLabel || generatedAt || '暂无'}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className={`rounded-lg border p-2 ${boardState?.visualBoardBlobKey ? 'border-success/30 bg-success/10 text-success' : 'border-muted-foreground/30 text-muted-foreground'}`}>
            <div className="text-muted-foreground">视觉层</div>
            <div className="mt-1 font-medium">{boardState?.visualBoardBlobKey ? '已生成' : '未生成'}</div>
          </div>
          <div className={`rounded-lg border p-2 ${boardState?.blobKey ? 'border-success/30 bg-success/10 text-success' : 'border-muted-foreground/30 text-muted-foreground'}`}>
            <div className="text-muted-foreground">详细板</div>
            <div className="mt-1 font-medium">{boardState?.blobKey ? '已组装' : '未组装'}</div>
          </div>
          <div className={`rounded-lg border p-2 ${storyboardBoardStep5Used ? 'border-success/30 bg-success/10 text-success' : 'border-muted-foreground/30 text-muted-foreground'}`}>
            <div className="text-muted-foreground">Step5</div>
            <div className="mt-1 font-medium">{storyboardBoardStep5Used ? '已引用' : '未引用'}</div>
          </div>
        </div>

        {missingReferenceLabels.length > 0 && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            缺少参考图：{missingReferenceLabels.join('、')}
          </div>
        )}

        <FoldedInfoSection
          title="生成前检查"
          icon={ListChecks}
          badge={(
            <Badge variant="outline" className="rounded-full bg-white/70 text-[10px] dark:bg-white/5">
              {conditionChecks.filter((item) => item.passed).length}/{conditionChecks.length}
            </Badge>
          )}
        >
          <div className="grid gap-2 md:grid-cols-2">
            {conditionChecks.map((check) => (
              <div
                key={check.id}
                className={`rounded-lg border px-2.5 py-2 text-xs ${
                  check.passed
                    ? 'border-success/30 bg-success/10 text-success'
                    : check.blocking
                      ? 'border-warning/30 bg-warning/10 text-warning'
                      : 'border-muted bg-muted/20 text-muted-foreground'
                }`}
              >
                <div className="flex items-center gap-1.5 font-medium">
                  {check.passed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                  {check.label}
                </div>
                <div className="mt-1 leading-5 opacity-85">{check.detail}</div>
              </div>
            ))}
          </div>
        </FoldedInfoSection>

        {episodeShotSheetSegment && (
          <FoldedInfoSection
            title="整集 Shot Sheet 承接"
            className="bg-muted/20 text-xs"
            badge={(
              <Badge variant="outline" className="rounded-full bg-white/70 text-[10px] dark:bg-white/5">
                #{episodeShotSheetSegment.storyboardIndex + 1}
              </Badge>
            )}
          >
            <div className="grid gap-2 md:grid-cols-2">
              <DetailRow label="故事功能" value={episodeShotSheetSegment.storyFunction} />
              <DetailRow label="入点" value={episodeShotSheetSegment.continuityIn} />
              <DetailRow label="落幅" value={episodeShotSheetSegment.continuityOut} />
              <DetailRow label="角色状态" value={episodeShotSheetSegment.characterState} />
            </div>
          </FoldedInfoSection>
        )}

        {sequenceContinuityContext && (
          <FoldedInfoSection
            title="跨分镜承接"
            icon={Layers}
            className="bg-background/70 text-xs"
            badge={(
              <Badge
                variant="outline"
                className={`rounded-full text-[10px] ${
                  sequenceContinuityWarnings.length > 0
                    ? 'border-warning/30 bg-warning/10 text-warning'
                    : 'border-success/30 bg-success/10 text-success'
                }`}
              >
                {sequenceContinuityContext.hasPrevious ? '继承上一镜' : '首镜/降级'}
              </Badge>
            )}
          >
            <div className="grid gap-2 md:grid-cols-2">
              <DetailRow label="上一镜落幅" value={sequenceContinuityContext.previousLastFrameInfo} />
              <DetailRow label={previousPanelLabel} value={sequenceContinuityContext.previousFinalPanel?.staticMoment} />
              <DetailRow label={currentEntryLabel} value={sequenceContinuityContext.currentContinuityIn} />
              <DetailRow label={currentOutLabel} value={sequenceContinuityContext.currentContinuityOut} />
              <DetailRow label="下一镜预留" value={sequenceContinuityContext.nextContinuityIn} />
            </div>
            {sequenceContinuityWarnings.length > 0 && (
              <div className="space-y-1 rounded-lg border border-warning/30 bg-warning/10 p-2 text-warning">
                {sequenceContinuityWarnings.map((warning) => (
                  <div key={warning} className="flex gap-1.5">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            )}
          </FoldedInfoSection>
        )}

        <FoldedInfoSection
          title={qualityTitle}
          icon={CheckCircle2}
          badge={(
            <Badge
              variant="outline"
              className={`rounded-full text-[10px] ${
                qualityReport.failCount > 0
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : qualityReport.warningCount > 0
                    ? 'border-warning/30 bg-warning/10 text-warning'
                    : 'border-success/30 bg-success/10 text-success'
              }`}
            >
              {qualityReport.failCount > 0 ? `${qualityReport.failCount} 个需复核` : qualityReport.warningCount > 0 ? `${qualityReport.warningCount} 个风险` : '低风险'}
            </Badge>
          )}
        >
          <div className="grid gap-2 md:grid-cols-2">
            {qualityReport.checks.map((check) => (
              <div key={check.id} className={`rounded-lg border px-2.5 py-2 text-xs ${getToneClassName(check.tone)}`}>
                <div className="font-medium">{check.label}</div>
                <div className="mt-1 leading-5 opacity-85">{check.detail}</div>
              </div>
            ))}
          </div>
        </FoldedInfoSection>

        <FoldedInfoSection
          title={panelPlanTitle}
          icon={ListChecks}
          badge={(
            <Badge variant="outline" className="rounded-full bg-white/70 text-[10px] dark:bg-white/5">
              图外说明 · 不写进图片
            </Badge>
          )}
        >

          {directorPlan ? (
            <div className="space-y-3">
              {directorBrief && (
                <FoldedInfoSection
                  title="Step4.0 导演阐述 / 参考匹配"
                  icon={Sparkles}
                  className="border-brand-violet/25 bg-brand-violet/10"
                  badge={(
                    <Badge variant="outline" className="rounded-full border-brand-violet/30 bg-background/70 text-[10px]">
                      生成导演板前
                    </Badge>
                  )}
                >
                  <div className="grid gap-2 md:grid-cols-2">
                    <DetailRow label="风格" value={directorBrief.styleStatement} />
                    <DetailRow label="镜头" value={directorBrief.cameraStrategy} />
                    <DetailRow label="声音" value={directorBrief.soundStrategy} />
                    <DetailRow label="钩子" value={directorBrief.hookStrategy} />
                    <DetailRow label="拆分" value={directorBrief.storyboardStrategy} />
                    <DetailRow label="成片时长" value={smartDurationLabel} />
                    <DetailRow label="时长原因" value={smartVideoDurationReason} />
                  </div>
                  {directorBrief.referenceMatching.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-muted-foreground">参考匹配</div>
                      <div className="grid gap-1 md:grid-cols-2">
                        {directorBrief.referenceMatching.slice(0, 6).map((match, index) => (
                          <div key={`${match.refId || match.name}-${index}`} className="rounded-md bg-background/70 px-2 py-1.5 leading-5">
                            <div className="font-medium text-foreground">{[match.refId, match.name].filter(Boolean).join(' · ')}</div>
                            <div className="text-muted-foreground">读：{match.readFor}</div>
                            {match.doNotUseFor && <div className="text-muted-foreground">不读：{match.doNotUseFor}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(directorBrief.referenceBudget?.length ?? 0) > 0 && (
                    <div className="space-y-1">
                      <div className="text-muted-foreground">图片预算</div>
                      <div className="grid gap-1 md:grid-cols-2">
                        {directorBrief.referenceBudget?.slice(0, 8).map((item, index) => (
                          <div key={`${item.refId}-${index}`} className="rounded-md bg-background/70 px-2 py-1.5 leading-5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium text-foreground">{[item.refId, item.name].filter(Boolean).join(' · ')}</span>
                              <Badge variant="outline" className={`rounded-full text-[10px] ${getReferenceBudgetDecisionClass(item.decision)}`}>
                                {getReferenceBudgetDecisionLabel(item.decision)}
                              </Badge>
                            </div>
                            {item.reason && <div className="text-muted-foreground">{item.reason}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </FoldedInfoSection>
              )}
              {isShotPlanMode && transitionBridge && (
                <div className="space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
                      <Layers className="h-4 w-4" />
                      入场转场
                    </div>
                    <Badge variant="outline" className="rounded-full border-amber-500/30 bg-background/70 text-[10px]">
                      {transitionBridge.transitionType || '待导演判断'}
                    </Badge>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <DetailRow label="上一镜 End Beat" value={transitionBridge.previousEndBeat} />
                    <DetailRow label="剧情判断" value={transitionBridge.transitionRationale} />
                    <DetailRow label="视觉桥" value={transitionBridge.visualBridge} />
                    <DetailRow label="声音桥" value={transitionBridge.soundBridge} />
                    <DetailRow label="机位桥" value={transitionBridge.cameraBridge} />
                    <DetailRow label="S01 入场" value={transitionBridge.firstFrameInstruction} />
                  </div>
                </div>
              )}
              <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs md:grid-cols-3">
                <div>
                  <div className="text-muted-foreground">世界锁定</div>
                  <div className="mt-1 line-clamp-3 font-medium">{directorPlan.worldLock?.masterScene || directorPlan.sceneAnchor}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">站位承接</div>
                  <div className="mt-1 line-clamp-3 font-medium">{directorPlan.blockingContinuity?.currentStart || '待重新生成导演规划'}</div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Camera className="h-3.5 w-3.5" />
                    机位
                  </div>
                  <div className="mt-1 line-clamp-3 font-medium">
                    {[directorPlan.cameraPlan?.cameraId, directorPlan.cameraPlan?.cameraRelation].filter(Boolean).join(' · ') || '按本镜规划'}
                  </div>
                </div>
              </div>
              <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {directorPlan.panels.map((panel) => (
                  <div key={panel.index} className="rounded-lg border border-border/70 bg-background/80 p-3 text-xs">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="min-w-0 font-medium">
                        S{String(panel.index).padStart(2, '0')} · {panel.timeRange || panel.beat}
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {panel.primarySubject}
                      </Badge>
                    </div>
                    <div className="space-y-1 leading-relaxed">
                      <DetailRow label="站位" value={panel.blocking || panel.composition} />
                      <DetailRow label="动作" value={panel.motion || panel.staticMoment} />
                      <DetailRow label="镜头" value={panel.cameraTask || `${panel.shotType}，${panel.cameraAngle}`} />
                      <DetailRow label="对白" value={panel.dialogue} />
                      <DetailRow label="SFX" value={panel.sfx} />
                      <DetailRow label="AUDIO" value={panel.audio} />
                      <DetailRow label="TRANSITION" value={panel.transition} />
                      <DetailRow label="表演" value={panel.dialoguePerformance} />
                      <DetailRow label="入点" value={panel.continuityIn} />
                      <DetailRow label="落幅" value={panel.continuityOut || panel.continuity} />
                      <DetailRow label="锚点" value={panel.worldAnchor} />
                      <DetailRow label="导演" value={panel.directorNote} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border/70 p-4 text-center text-xs text-muted-foreground">
              暂无导演规划。生成或刷新后会显示每格的站位、动作、镜头、落幅，以及 15 格模式的入场转场。
            </div>
          )}
        </FoldedInfoSection>

        <FoldedInfoSection
          title="Step3 参考图职责"
          icon={Layers}
          className="bg-muted/20"
          badge={(
            <span className="text-xs text-muted-foreground">{referenceSummary.length} 张可用</span>
          )}
        >
          <div className="max-h-40 space-y-2 overflow-y-auto">
            {referenceSummary.length > 0 ? referenceSummary.map((reference) => (
              <div key={reference.key} className="flex items-center justify-between gap-2 rounded-lg bg-background/70 px-2 py-1.5 text-xs">
                <span className="min-w-0 truncate">{reference.label}</span>
                <span className="hidden min-w-0 truncate text-[10px] text-muted-foreground md:block">{reference.duty}</span>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {reference.type}
                </Badge>
              </div>
            )) : (
              <div className="py-4 text-center text-xs text-muted-foreground">
                当前没有可用参考图
              </div>
            )}
          </div>
        </FoldedInfoSection>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-8 w-full justify-between rounded-lg px-3 text-xs text-muted-foreground">
              调试信息
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">导演规划 JSON</div>
              <Textarea
                value={planPreview || '暂无导演规划。点击生成导演规划后会显示 JSON。'}
                readOnly
                className="min-h-36 resize-none font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">图片生成指令</div>
              <Textarea
                value={promptPreview || '暂无图片生成指令。需要先完成导演规划。'}
                readOnly
                className="min-h-36 resize-none font-mono text-xs"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <section className="space-y-2 rounded-xl border border-border/70 bg-background/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-fuchsia-500" />
              Seedance 提交词
            </div>
            <Badge
              variant="outline"
              className={`rounded-full text-[10px] ${
                seedanceFinalPromptState.status === 'failed'
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : seedanceFinalPromptState.status === 'generating'
                    ? 'border-warning/30 bg-warning/10 text-warning'
                    : seedanceFinalPromptState.warning
                      ? 'border-warning/30 bg-warning/10 text-warning'
                    : seedanceFinalPromptState.isFresh
                      ? 'border-success/30 bg-success/10 text-success'
                      : 'border-muted-foreground/30 text-muted-foreground'
              }`}
            >
              {seedanceFinalPromptState.status === 'generating'
                ? '生成中'
                : seedanceFinalPromptState.status === 'failed'
                  ? '生成失败'
                  : seedanceFinalPromptState.warning
                    ? '已更新·需复核'
                  : seedanceFinalPromptState.isFresh
                    ? '已更新'
                    : '待刷新'}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={seedanceFinalPromptState.isFresh ? 'outline' : 'default'}
              className={seedanceFinalPromptState.isFresh ? 'rounded-xl bg-white/70 dark:bg-white/5' : 'rounded-xl'}
              disabled={actionBusy || !!seedanceFinalPromptDisabledReason}
              title={seedanceFinalPromptDisabledReason ?? undefined}
              onClick={() => void runAction('seedance-final-prompt', onRefreshSeedanceFinalPrompt)}
            >
              {seedanceFinalPromptBusy || busyAction === 'seedance-final-prompt' ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  生成中...
                </>
              ) : (
                '刷新 Seedance 提交词'
              )}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {seedanceFinalPromptChars > 0 ? `${seedanceFinalPromptChars} 字` : '尚未生成'}
            </span>
          </div>
          {seedanceFinalPromptState.error ? (
            <div className="text-xs text-destructive">{seedanceFinalPromptState.error}</div>
          ) : seedanceFinalPromptState.warning ? (
            <div className="text-xs text-amber-600 dark:text-amber-200">{seedanceFinalPromptState.warning}</div>
          ) : seedanceFinalPromptDisabledReason ? (
            <div className="text-xs text-amber-600 dark:text-amber-200">{seedanceFinalPromptDisabledReason}</div>
          ) : seedanceFinalPromptState.isFresh ? (
            <div className="text-xs text-emerald-600 dark:text-emerald-200">当前最终词可直接带到 Step5 提交。</div>
          ) : (
            <div className="text-xs text-muted-foreground">这里放的是 Step4 生成的最终提交词，不再是长拼接版草稿。</div>
          )}
          <Textarea
            value={seedanceFinalPromptPreview || '暂无 Seedance 最终提交词，点击刷新生成。'}
            readOnly
            className="min-h-36 resize-none font-mono text-xs"
          />
        </section>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={actionBusy || !!activeOptimizeDisabledReason}
            title={activeOptimizeDisabledReason ?? undefined}
            onClick={() => void runAction('optimize', onOptimizePlan)}
          >
            {isOptimizingPlan || busyAction === 'optimize' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
              {hasFreshPlan ? '刷新导演规划' : '生成导演规划'}
          </Button>
          <Button
            type="button"
            size="sm"
            className="brand-gradient gap-1.5"
            disabled={actionBusy || !!activeGenerateDisabledReason}
            title={activeGenerateDisabledReason ?? undefined}
            onClick={() => void runAction('generate', onGenerate)}
          >
            {isGenerating || busyAction === 'generate' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" />
            )}
            {generateButtonLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={actionBusy || !canRepairBoardText}
            title={!canRepairBoardText ? '仅旧版带文字故事板可用' : 'legacy repair'}
            onClick={() => void runAction('repair-text', onRepairText)}
          >
            {busyAction === 'repair-text' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Languages className="h-3.5 w-3.5" />
            )}
            Legacy 修复
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={actionBusy || !hasBoardImage}
            onClick={() => void runAction('download', onDownload)}
          >
            <Download className="h-3.5 w-3.5" />
            下载
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            disabled={actionBusy || !boardState}
            onClick={() => void runAction('clear', onClear)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            清空故事板
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
