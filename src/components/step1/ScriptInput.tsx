// ============================================================
// 步骤1: 剧本输入组件（统一入口，自动识别标注剧本 / 网文小说）
// ============================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  AlertCircle,
  ArrowRight,
  BookOpen,
  BookText,
  Check,
  Clapperboard,
  Import,
  MapPin,
  Pencil,
  Settings,
  Sparkles,
  Square,
  Trash2,
  UsersRound,
  X,
  Zap,
} from '@/components/icons';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useCurrentProject } from '@/stores/projectStore';
import { OPEN_API_SETTINGS_EVENT } from '@/components/shared/apiSettingsEvents';
import { useApiCall } from '@/hooks/useApiCall';
import { buildStep1UserPrompt } from '@/lib/prompt-templates/build-context-L3';
import { buildSeriesRuntimeContext } from '@/lib/seriesRuntime';
import { buildNovelAdaptRhythmRepairUserPrompt, buildNovelAdaptUserPrompt } from '@/lib/prompt-templates/novel-adapt';
import { buildScriptFormatAdaptUserPrompt } from '@/lib/prompt-templates/script-format-adapt';
import { parseAnalysisResponseDetailed, getAnalysisSparseReason } from '@/lib/analysisParser';
import { validateAnalysisBeforeConfirm } from '@/lib/analysisValidation';
import { resolveStep1StyleConfig } from '@/lib/style-presets';
import { ENABLE_NEXT_UI_PREVIEW } from '@/lib/uiMode';
import { buildStep1RecoveryHints } from './recoveryHints';
import { validateAnnotatedScriptInput } from './annotatedScriptPrecheck';
import { findAdaptedScriptQualityIssues, formatAdaptedScriptQualityIssues, polishKnownAdaptedScriptIssues } from './adaptedScriptQuality';
import {
  detectScriptType,
  localDetectionToClassifierDecision,
  parseScriptTypeClassifierDecision,
  type ScriptTypeClassifierDecision,
} from './scriptTypeDetection';
import { buildStep1ImportPreview } from './intakeImport';
import type { ChatMessage as ApiChatMessage } from '@/lib/api-client';
import type { Project, ScriptType, Step1TaskPhase, Step1TaskState } from '@/types';

type ChatMessage = ApiChatMessage;
type ScriptTypeOverride = ScriptType | 'auto';

function isRequestCancelledError(err: unknown): boolean {
  return (err instanceof DOMException && err.name === 'AbortError')
    || (err instanceof Error && (err.name === 'AbortError' || err.message === '请求已取消'));
}

const STORYBOARD_DURATION_OPTIONS = [
  { value: '10', label: '10 秒' },
  { value: '15', label: '15 秒（默认）' },
  { value: '20', label: '20 秒' },
  { value: '30', label: '30 秒' },
  { value: 'custom', label: '自定义' },
];

const MIN_ADAPTED_STORYBOARD_DURATION = 4;
const MAX_ADAPTED_STORYBOARD_DURATION = 15;
const ENABLE_NOVEL_STORYBOARD_DURATION_SELECTION = false;
const RHYTHM_ISSUE_ID = 'short-video-dialogue-rhythm-overloaded';
const STRUCTURAL_ISSUE_IDS = new Set([
  'observation-storyboard-standalone',
  'adjacent-storyboard-duplicate-goal',
  'storyboard-missing-relay',
]);
const MAX_RHYTHM_REPAIR_ATTEMPTS = 2;
const ENABLE_ADAPTED_SCRIPT_QUALITY_GATE = false;
const ENABLE_GLOBAL_STEP1_TASKS: boolean = false;
const STEP1_LLM_REQUEST_TIMEOUT_SECONDS = 300;
const STREAM_FAILURE_MARKER_PATTERN = /消息流出现异常|LLM API Error|BFF Error|API Error/i;
const STORYBOARD_HEADING_PATTERN = /^(?:#{1,3}\s*)?分镜\s*0*(\d+)([^\n]*)$/gim;
const STORYBOARD_HEADING_DURATION_PATTERN = /([0-9０-９]+(?:[.．][0-9０-９]+)?)\s*秒/;
const STEP1_STREAM_PREVIEW_LIMIT = 12000;

function countAdaptedStoryboards(scriptText: string): number {
  return scriptText.match(STORYBOARD_HEADING_PATTERN)?.length ?? 0;
}

function normalizeDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function parseStoryboardDuration(value: string): number {
  return Number(normalizeDigits(value).replace('．', '.'));
}

function normalizeAdaptedStoryboardHeadings(scriptText: string): string {
  return scriptText.replace(STORYBOARD_HEADING_PATTERN, (_match, rawNumber: string, rawRest: string) => {
    const storyboardNumber = String(parseInt(rawNumber, 10)).padStart(2, '0');
    const rest = rawRest.trim();

    return `## 分镜${storyboardNumber}${rest ? ` ${rest}` : ''}`;
  });
}

function getAdaptedStoryboardDurations(scriptText: string): number[] {
  return [...scriptText.matchAll(STORYBOARD_HEADING_PATTERN)]
    .map((match) => {
      const durationMatch = (match[2] || match[0]).match(STORYBOARD_HEADING_DURATION_PATTERN);
      return durationMatch ? parseStoryboardDuration(durationMatch[1]) : null;
    })
    .filter((duration): duration is number => duration !== null && Number.isFinite(duration));
}

function assertCompleteAdaptedStoryboardScript(
  scriptText: string,
  stageLabel: string,
): string {
  const trimmedScript = normalizeAdaptedStoryboardHeadings(scriptText.trim());
  if (!trimmedScript) {
    throw new Error(`${stageLabel}未返回有效内容，请重试。`);
  }
  if (STREAM_FAILURE_MARKER_PATTERN.test(trimmedScript)) {
    throw new Error(`${stageLabel}未完整返回：检测到消息流异常，已保留上一版完整稿，请稍后重试。`);
  }

  const storyboardCount = countAdaptedStoryboards(trimmedScript);
  if (storyboardCount === 0) {
    throw new Error(`${stageLabel}未完整返回：没有检测到“分镜01（4~15秒）”这类分镜标题，已保留上一版完整稿，请重试。`);
  }
  const durations = getAdaptedStoryboardDurations(trimmedScript);
  if (durations.length !== storyboardCount) {
    throw new Error(`${stageLabel}未完整返回：有分镜标题缺少 4~15 秒单镜时长，已保留上一版完整稿，请重试。`);
  }
  const invalidDurationIndex = durations.findIndex((duration) =>
    duration < MIN_ADAPTED_STORYBOARD_DURATION || duration > MAX_ADAPTED_STORYBOARD_DURATION);
  if (invalidDurationIndex >= 0) {
    throw new Error(`${stageLabel}返回的分镜${String(invalidDurationIndex + 1).padStart(2, '0')}时长为 ${durations[invalidDurationIndex]} 秒，请控制在 4~15 秒后重试。`);
  }

  return trimmedScript;
}

const EPISODE_DURATION_OPTIONS = [
  { value: '90', label: '90 秒' },
  { value: '120', label: '120 秒（默认）' },
  { value: '150', label: '150 秒' },
  { value: '180', label: '180 秒' },
  { value: 'custom', label: '自定义' },
];

const MIN_ANALYSIS_CHAR_COUNT = 80;

function buildSeriesContextForChapter(project: Project | undefined, chapterId: string) {
  const chapter = project?.chapters.find((item) => item.id === chapterId);
  const seriesPlan = project?.seriesPlan;
  const seriesRuntime = project?.seriesRuntime;
  if (!chapter?.sourceSeriesEpisodeId || !seriesPlan) return undefined;
  const episode = seriesPlan.episodeCards.find((item) => item.id === chapter.sourceSeriesEpisodeId);
  if (!episode) return undefined;
  const contextText = [
    chapter.rawScript,
    chapter.adaptedScript,
    JSON.stringify(episode),
  ].filter(Boolean).join('\n').toLowerCase();
  const termMatchesContext = (value: unknown) => {
    const term = String(value ?? '').trim().toLowerCase();
    return term.length >= 2 && contextText.includes(term);
  };
  const relatedCharacters = seriesPlan.characters.filter((character) => (
    termMatchesContext(character.name)
    || termMatchesContext(character.role)
    || termMatchesContext(character.visualAnchor)
    || (character.recurringProps ?? []).some(termMatchesContext)
  ));
  const selectedCharacters = (relatedCharacters.length > 0 ? relatedCharacters : seriesPlan.characters).slice(0, 6);
  const recurringProps = seriesPlan.recurringProps ?? [];
  const relatedRecurringProps = recurringProps.filter(termMatchesContext);

  return {
    premise: seriesPlan.premise,
    tone: seriesPlan.tone,
    styleConfig: project?.styleConfig || seriesPlan.styleConfig,
    longRunningSecrets: (seriesPlan.longRunningSecrets ?? []).slice(0, 6),
    recurringProps: (relatedRecurringProps.length > 0 ? relatedRecurringProps : recurringProps).slice(0, 8),
    characters: selectedCharacters.map((character) => ({
      name: character.name,
      role: character.role,
      actionStyle: character.actionStyle,
      voiceStyle: character.voiceStyle,
      visualAnchor: character.visualAnchor,
      continuityNotes: character.continuityNotes,
    })),
    episode: {
      episodeNumber: episode.episodeNumber,
      title: episode.title,
      mainQuestion: episode.mainQuestion,
      openingHook: episode.openingHook,
      satisfactionType: episode.satisfactionType,
      satisfactionBeat: episode.satisfactionBeat,
      cliffhanger: episode.cliffhanger,
      continuityIn: episode.continuityIn,
      continuityOut: episode.continuityOut,
      visualReuse: episode.visualReuse,
    },
    seriesRuntime: buildSeriesRuntimeContext(seriesPlan, seriesRuntime, episode),
  };
}

interface ScriptInputProps {
  onOpenSeries?: () => void;
}

function isPresetDuration(options: { value: string }[], duration: number): boolean {
  return options.some((option) => option.value !== 'custom' && option.value === String(duration));
}

function getStep1StreamPhaseTitle(status: string | undefined, isNovel: boolean, isLooseScript: boolean): string {
  if (status === 'adapting') return isLooseScript ? '正在整理为 4~15 秒分镜' : '正在改编为 4~15 秒分镜';
  if (status === 'scripting') return isNovel ? '正在结构化改编稿' : '正在结构化剧本';
  return '正在等待模型响应';
}

function getStep1StreamPhaseDetail(status: string | undefined, isNovel: boolean, isLooseScript: boolean, hasFeedback: boolean): string {
  if (!hasFeedback && status === 'scripting') {
    return isNovel
      ? '改编稿已提交流式结构化分析，正在等待模型第一段内容或思考活动。'
      : '剧本已提交流式结构化分析，正在等待模型第一段内容或思考活动。';
  }
  if (!hasFeedback) return `请求已发出，正在等待模型返回第一段内容；连续 ${STEP1_LLM_REQUEST_TIMEOUT_SECONDS} 秒无内容或思考活动才会超时。`;
  if (status === 'adapting') {
    return isLooseScript
      ? '模型正在保留原对白，把不标准剧本整理成本站分镜格式。'
      : '模型正在把网文收束成短剧分镜，重点保留冲突、动作、场景和可拍画面。';
  }
  if (status === 'scripting') {
    return isNovel
      ? '改编稿已进入结构化分析，原始 JSON 片段已隐藏，完成后会自动进入 Step2。'
      : '剧本正在提取角色、场景、道具和分镜关系，原始 JSON 片段已隐藏。';
  }
  return '模型正在处理内容，完成后会自动进入下一步。';
}

function formatStep1Duration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours} 小时 ${restMinutes} 分钟` : `${hours} 小时`;
}

function getStep1StreamEventLabel(event?: string) {
  if (event === 'queued') return '排队等待';
  if (event === 'start') return '已提交';
  if (event === 'chunk' || event === 'replace') return '正文回流';
  if (event === 'activity') return '模型思考';
  if (event === 'retry') return '自动重试';
  if (event === 'done' || event === 'result') return '完成回流';
  return '等待连接';
}

export function ScriptInput({ onOpenSeries }: ScriptInputProps = {}) {
  const { state, dispatch, currentChapter: chapter } = useCurrentProject();
  const { loading, error, streamText, callApiViaBff, abort, reset } = useApiCall({ stream: true });
  const step1Task = chapter?.step1Task;
  const currentStep1GlobalTask = useMemo(
    () => state.globalTasks.find((task) =>
      task.type === 'step1-analysis'
      && task.projectId === state.currentProjectId
      && task.chapterId === chapter?.id
      && (task.status === 'queued' || task.status === 'running'),
    ) ?? null,
    [chapter?.id, state.currentProjectId, state.globalTasks],
  );
  const visibleLoading = loading || !!step1Task?.running || !!currentStep1GlobalTask;
  const visibleStreamText = streamText || step1Task?.streamTextPreview || '';
  const visibleStep1Phase = (step1Task?.running ? step1Task.phase : undefined) ?? chapter?.status;

  const savedScriptType: ScriptType = chapter?.scriptType ?? 'annotated';
  const storyboardDuration: number = chapter?.storyboardDuration ?? 15;
  const episodeDuration: number = chapter?.episodeDuration ?? 120;

  const [scriptText, setScriptText] = useState(chapter?.rawScript ?? '');
  const [scriptTypeOverride, setScriptTypeOverride] = useState<ScriptTypeOverride>('auto');
  const [showInputAdvanced, setShowInputAdvanced] = useState(false);
  const [showNovelAdaptSettings, setShowNovelAdaptSettings] = useState(false);
  const [customSbDuration, setCustomSbDuration] = useState('');
  const [customEpDuration, setCustomEpDuration] = useState('');
  const [showCustomSbDuration, setShowCustomSbDuration] = useState(false);
  const [showCustomEpDuration, setShowCustomEpDuration] = useState(false);
  const [analysisSparse, setAnalysisSparse] = useState(false);
  const [analysisIssue, setAnalysisIssue] = useState<string | null>(null);
  const [editingAdaptedScript, setEditingAdaptedScript] = useState(false);
  const [showScriptExample, setShowScriptExample] = useState(false);
  const [tempAdaptedScript, setTempAdaptedScript] = useState(chapter?.adaptedScript ?? '');
  const [dismissedImportSignature, setDismissedImportSignature] = useState('');
  const [showImportSegments, setShowImportSegments] = useState(false);
  const [step1Now, setStep1Now] = useState(() => Date.now());
  const hasAdaptedScript = !!chapter?.adaptedScript?.trim();
  const trimmedScriptText = scriptText.trim();
  const detectedScriptType = useMemo(() => detectScriptType(scriptText), [scriptText]);
  const importPreview = useMemo(() => buildStep1ImportPreview(scriptText), [scriptText]);
  const importPreviewSignature = `${importPreview.kind}:${importPreview.segments.length}:${trimmedScriptText.length}`;
  const shouldShowImportPreview = importPreview.shouldOfferImport
    && importPreview.segments.length >= 2
    && dismissedImportSignature !== importPreviewSignature;
  const previewNovelCount = importPreview.segments.filter((segment) => segment.scriptType === 'novel').length;
  const previewAnnotatedCount = importPreview.segments.length - previewNovelCount;
  const previewSegments = importPreview.segments.slice(0, 6);
  const effectiveScriptType: ScriptType = scriptTypeOverride === 'auto'
    ? (trimmedScriptText ? detectedScriptType.scriptType : savedScriptType)
    : scriptTypeOverride;
  const isNovel = effectiveScriptType === 'novel';
  const isLooseScript = effectiveScriptType === 'annotated'
    && (detectedScriptType.reason === 'loose-script' || detectedScriptType.reason === 'single-storyboard-marker');
  const detectionLabel = scriptTypeOverride === 'auto'
    ? detectedScriptType.label
    : effectiveScriptType === 'novel'
      ? '手动指定为网文小说'
      : '手动指定为标注剧本';
  const detectionDetail = scriptTypeOverride === 'auto'
    ? (trimmedScriptText ? detectedScriptType.detail : '输入小说或标注剧本后，系统会自动识别分析方式。')
    : effectiveScriptType === 'novel'
      ? '将先改编为短剧分镜，再进行结构化分析。'
      : isLooseScript
        ? '将先保留原对白整理成本站分镜格式，再进行结构化分析。'
        : '将直接按分镜剧本进行结构化分析。';
  const detectionConfidenceText = detectedScriptType.confidence === 'high'
    ? '高'
    : detectedScriptType.confidence === 'medium'
      ? '中'
      : '低';
  const isPresetStoryboardDuration = isPresetDuration(STORYBOARD_DURATION_OPTIONS, storyboardDuration);
  const isPresetEpisodeDuration = isPresetDuration(EPISODE_DURATION_OPTIONS, episodeDuration);
  const shouldShowCustomSbDuration = showCustomSbDuration || !isPresetStoryboardDuration;
  const shouldShowCustomEpDuration = showCustomEpDuration || !isPresetEpisodeDuration;
  const shouldGuardShortAutoInput = scriptTypeOverride === 'auto'
    && savedScriptType !== 'novel'
    && detectedScriptType.confidence === 'low';
  const isScriptTooShort = isNovel
    && shouldGuardShortAutoInput
    && trimmedScriptText.length > 0
    && trimmedScriptText.length < MIN_ANALYSIS_CHAR_COUNT;
  const canAnalyze = !!trimmedScriptText;
  const missingLlmApiKey = !state.apiConfig.apiKey.trim();
  const canReturnToExistingAnalysis = !!chapter?.analysis;
  const analyzeButtonLabel = !trimmedScriptText
    ? '输入内容后开始分析'
    : canReturnToExistingAnalysis
    ? (isNovel && hasAdaptedScript ? '重新从原文改编' : '重新分析当前内容')
    : isLooseScript
      ? '开始格式适配'
    : '开始分析';
  const failureMessage = analysisIssue ?? error;
  const recoveryHints = failureMessage
    ? buildStep1RecoveryHints({
      failureMessage,
      isNovel,
      hasAdaptedScript,
      hasRawScript: !!scriptText.trim(),
    })
    : [];
  const step1PipelinePhases = useMemo(() => (
    isNovel || isLooseScript
      ? [
        {
          id: 'adapt',
          title: isLooseScript ? '格式适配' : '改编分镜',
          desc: isLooseScript ? '保留对白转分镜' : '智能 4~15 秒/镜',
        },
        { id: 'analyze', title: '结构化分析', desc: '提取角色 / 场景 / 道具' },
        { id: 'confirm', title: '结果确认', desc: '完成后进入 Step2' },
      ]
      : [
        { id: 'analyze', title: '结构化分析', desc: '直接解析标注分镜' },
        { id: 'confirm', title: '结果确认', desc: '完成后进入 Step2' },
      ]
  ), [isLooseScript, isNovel]);
  const activePipelinePhaseId = visibleStep1Phase === 'adapting'
    ? 'adapt'
    : visibleStep1Phase === 'scripting'
      ? 'analyze'
      : '';
  const activePipelinePhaseIndex = step1PipelinePhases.findIndex((phase) => phase.id === activePipelinePhaseId);
  const hasStreamFeedback = visibleStreamText.trim().length > 0;
  const streamPhaseTitle = getStep1StreamPhaseTitle(visibleStep1Phase, isNovel, isLooseScript);
  const streamPhaseDetail = getStep1StreamPhaseDetail(visibleStep1Phase, isNovel, isLooseScript, hasStreamFeedback);
  const step1StartedAt = step1Task?.startedAt
    ?? currentStep1GlobalTask?.startedAt
    ?? currentStep1GlobalTask?.createdAt
    ?? (visibleLoading ? step1Now : undefined);
  const step1ActivityAt = step1Task?.streamActivityAt
    ?? currentStep1GlobalTask?.streamStageLastActivityAt
    ?? currentStep1GlobalTask?.streamUpdatedAt
    ?? step1Task?.updatedAt
    ?? step1StartedAt;
  const step1ElapsedText = step1StartedAt ? formatStep1Duration(step1Now - step1StartedAt) : '刚刚';
  const step1ActivityAgeText = step1ActivityAt ? `${formatStep1Duration(step1Now - step1ActivityAt)}前` : '暂无';
  const step1Event = step1Task?.streamLastEvent
    ?? (currentStep1GlobalTask?.retryNotice ? 'retry' : currentStep1GlobalTask?.status === 'queued' ? 'queued' : undefined);
  const step1LastEventLabel = getStep1StreamEventLabel(step1Event);
  const step1ReceivedLength = visibleStreamText.length
    || step1Task?.streamTextLength
    || currentStep1GlobalTask?.streamTextLength
    || 0;
  const step1RetryNotice = currentStep1GlobalTask?.retryNotice;

  const resetAnalysisFeedback = useCallback(() => {
    setAnalysisSparse(false);
    setAnalysisIssue(null);
  }, []);

  useEffect(() => {
    if (!visibleLoading) return undefined;
    setStep1Now(Date.now());
    const intervalId = window.setInterval(() => setStep1Now(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [visibleLoading]);

  const handleClearScriptText = () => {
    resetAnalysisFeedback();
    setScriptText('');
  };

  const handleScriptTypeOverrideChange = useCallback((nextOverride: ScriptTypeOverride) => {
    resetAnalysisFeedback();
    setScriptTypeOverride(nextOverride);
  }, [resetAnalysisFeedback]);

  const classifyScriptInputWithLlm = useCallback(async (
    sourceText: string,
    localDetection = detectScriptType(sourceText),
  ): Promise<ScriptTypeClassifierDecision> => {
    if (scriptTypeOverride !== 'auto') {
      return {
        scriptType: scriptTypeOverride,
        classifierType: scriptTypeOverride === 'novel' ? 'novel' : 'annotated',
        confidence: 'high',
        recommendedFlow: scriptTypeOverride === 'novel' ? 'novel-adapt' : 'direct-analysis',
        reason: '用户已手动指定输入类型',
        source: 'local',
      };
    }

    try {
      const response = await callApiViaBff(
        state.apiConfig,
        [{ role: 'user', content: JSON.stringify({ scriptText: sourceText }) }],
        { templateType: 'script_type_classifier' },
        {
          stream: false,
          temperature: 0.1,
          maxTokens: 500,
          reasoningEffort: 'low',
          disableBackgroundJob: true,
          suppressDisplayUpdates: true,
        },
      );
      return parseScriptTypeClassifierDecision(response, localDetection);
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[Step1] LLM 输入类型识别失败，回退本地规则', err);
      toast.warning('AI 输入类型识别失败，已临时使用本地规则继续。');
      return localDetectionToClassifierDecision(localDetection);
    }
  }, [callApiViaBff, scriptTypeOverride, state.apiConfig]);

  const handleCreateChaptersFromImport = useCallback(() => {
    const targetProjectId = state.currentProjectId ?? undefined;
    const targetChapterId = chapter?.id;

    if (!targetProjectId || !targetChapterId) {
      toast.error('当前章节不可用，请刷新后重试');
      return;
    }
    if (!importPreview.shouldOfferImport || importPreview.segments.length < 2) {
      toast.error('暂未识别到可拆分的章节');
      return;
    }

    resetAnalysisFeedback();
    dispatch({
      type: 'IMPORT_CHAPTERS_FROM_INPUT',
      projectId: targetProjectId,
      sourceChapterId: targetChapterId,
      sourceText: scriptText.trim(),
      chapters: importPreview.segments.map((segment) => ({
        title: segment.title,
        rawScript: segment.content,
        scriptType: segment.scriptType,
      })),
    });
    setDismissedImportSignature(importPreviewSignature);
    setShowImportSegments(false);
    toast.success(`已创建 ${importPreview.segments.length} 个章节，可从左侧章节列表选择处理`);
  }, [
    chapter?.id,
    dispatch,
    importPreview,
    importPreviewSignature,
    resetAnalysisFeedback,
    scriptText,
    state.currentProjectId,
  ]);

  const handleReturnToExistingAnalysis = useCallback(() => {
    if (!chapter?.analysis) return;
    dispatch({ type: 'SET_CHAPTER_STATUS', status: 'analyzing', chapterId: chapter.id });
  }, [chapter?.analysis, chapter?.id, dispatch]);

  const openApiSettings = useCallback(() => {
    window.dispatchEvent(new CustomEvent(OPEN_API_SETTINGS_EVENT));
  }, []);

  const updateStep1Task = useCallback((
    targetProjectId: string,
    targetChapterId: string,
    phase: Step1TaskPhase,
    updates: Partial<Step1TaskState> = {},
  ) => {
    dispatch({
      type: 'UPDATE_STEP1_TASK',
      projectId: targetProjectId,
      chapterId: targetChapterId,
      updates: {
        running: true,
        phase,
        error: undefined,
        ...updates,
      },
    });
  }, [dispatch]);

  const endStep1Task = useCallback((
    targetProjectId: string,
    targetChapterId: string,
    updates: Partial<Step1TaskState> = {},
  ) => {
    dispatch({
      type: 'END_STEP1_TASK',
      projectId: targetProjectId,
      chapterId: targetChapterId,
      updates,
    });
  }, [dispatch]);

  const createStep1StreamObserver = useCallback((
    targetProjectId: string,
    targetChapterId: string,
    phase: Step1TaskPhase,
  ) => (fullText: string, _delta: string, event: string) => {
    const text = fullText ?? '';
    updateStep1Task(targetProjectId, targetChapterId, phase, {
      streamTextPreview: text.slice(-STEP1_STREAM_PREVIEW_LIMIT),
      streamTextLength: text.length,
      streamActivityAt: Date.now(),
      streamLastEvent: event,
    });
  }, [updateStep1Task]);

  // ---- 实时保存剧本输入（debounce 1s） ----
  const prevScriptRef = useRef(scriptText);
  useEffect(() => {
    const currentSaved = chapter?.rawScript ?? '';
    if (scriptText.trim() === currentSaved.trim()) return;
    if (prevScriptRef.current === scriptText) return;
    const timer = setTimeout(() => {
      dispatch({ type: 'UPDATE_RAW_SCRIPT', script: scriptText.trim() });
    }, 1000);
    return () => clearTimeout(timer);
  }, [scriptText, chapter?.rawScript, dispatch]);

  // ---- 同步外部 script 变化（章节切换等） ----
  useEffect(() => {
    const saved = chapter?.rawScript ?? '';
    if (saved !== scriptText) {
      setScriptText(saved);
      prevScriptRef.current = saved;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.rawScript]);

  useEffect(() => {
    setEditingAdaptedScript(false);
    setTempAdaptedScript(chapter?.adaptedScript ?? '');
  }, [chapter?.id, chapter?.adaptedScript]);

  useEffect(() => {
    setScriptTypeOverride('auto');
  }, [chapter?.id]);

  useEffect(() => {
    if (!isNovel) {
      setShowNovelAdaptSettings(false);
    }
  }, [isNovel]);

  useEffect(() => {
    if (!isPresetStoryboardDuration) {
      setShowCustomSbDuration(true);
      setCustomSbDuration(String(storyboardDuration));
    }
  }, [isPresetStoryboardDuration, storyboardDuration]);

  useEffect(() => {
    if (!isPresetEpisodeDuration) {
      setShowCustomEpDuration(true);
      setCustomEpDuration(String(episodeDuration));
    }
  }, [episodeDuration, isPresetEpisodeDuration]);

  // ---- 处理分镜时长选择 ----
  const handleStoryboardDurationChange = useCallback((value: string) => {
    if (value === 'custom') {
      setShowCustomSbDuration(true);
      setCustomSbDuration(String(storyboardDuration));
      return;
    }
    setShowCustomSbDuration(false);
    setCustomSbDuration('');
    dispatch({ type: 'SET_STORYBOARD_DURATION', duration: parseInt(value, 10) });
  }, [dispatch, storyboardDuration]);

  const handleCustomSbDurationConfirm = useCallback(() => {
    const val = parseInt(customSbDuration, 10);
    if (isNaN(val) || val < 4 || val > 60) {
      toast.error('分镜时长需在 4~60 秒之间');
      return;
    }
    dispatch({ type: 'SET_STORYBOARD_DURATION', duration: val });
    setShowCustomSbDuration(!isPresetDuration(STORYBOARD_DURATION_OPTIONS, val));
    setCustomSbDuration(String(val));
    toast.success(`分镜时长已设为 ${val} 秒`);
  }, [customSbDuration, dispatch]);

  // ---- 处理单集时长选择 ----
  const handleEpisodeDurationChange = useCallback((value: string) => {
    if (value === 'custom') {
      setShowCustomEpDuration(true);
      setCustomEpDuration(String(episodeDuration));
      return;
    }
    setShowCustomEpDuration(false);
    setCustomEpDuration('');
    dispatch({ type: 'SET_EPISODE_DURATION', duration: parseInt(value, 10) });
  }, [dispatch, episodeDuration]);

  const handleCustomEpDurationConfirm = useCallback(() => {
    const val = parseInt(customEpDuration, 10);
    if (isNaN(val) || val < 30 || val > 600) {
      toast.error('单集时长需在 30~600 秒之间');
      return;
    }
    dispatch({ type: 'SET_EPISODE_DURATION', duration: val });
    setShowCustomEpDuration(!isPresetDuration(EPISODE_DURATION_OPTIONS, val));
    setCustomEpDuration(String(val));
    toast.success(`单集时长已设为 ${val} 秒`);
  }, [customEpDuration, dispatch]);

  const handleAnalysisValidationFailure = useCallback((
    message: string,
    targetProjectId: string,
    targetChapterId: string,
    sparse = false,
  ) => {
    setAnalysisSparse(sparse);
    setAnalysisIssue(message);
    dispatch({ type: 'SET_CHAPTER_STATUS', status: 'idle', projectId: targetProjectId, chapterId: targetChapterId });
    endStep1Task(targetProjectId, targetChapterId, { error: message });
    toast.error(message);
  }, [dispatch, endStep1Task]);

  const precheckStructuredScriptAnalysis = useCallback((
    scriptToAnalyze: string,
    targetProjectId: string,
    targetChapterId: string,
    options: { checkAdaptationQuality?: boolean } = {},
  ) => {
    const localValidationError = validateAnnotatedScriptInput(scriptToAnalyze.trim());
    if (localValidationError) {
      handleAnalysisValidationFailure(localValidationError, targetProjectId, targetChapterId);
      return false;
    }

    if (ENABLE_ADAPTED_SCRIPT_QUALITY_GATE && options.checkAdaptationQuality) {
      const qualityIssueMessage = formatAdaptedScriptQualityIssues(
        findAdaptedScriptQualityIssues(scriptToAnalyze),
      );
      if (qualityIssueMessage) {
        handleAnalysisValidationFailure(qualityIssueMessage, targetProjectId, targetChapterId);
        return false;
      }
    }

    return true;
  }, [handleAnalysisValidationFailure]);

  const finalizeAnalysis = useCallback((
    analysisResponse: string,
    analyzedSourceText: string,
    targetProjectId: string,
    targetChapterId: string,
    styleSourceText = '',
  ) => {
    const parsedResult = parseAnalysisResponseDetailed(analysisResponse);
    const { analysis: parsedAnalysis, source, warnings } = parsedResult;
    const analysis = {
      ...parsedAnalysis,
      styleConfig: resolveStep1StyleConfig(
        parsedAnalysis.styleConfig,
        [analyzedSourceText, styleSourceText].filter(Boolean).join('\n'),
      ),
    };

    if (import.meta.env.DEV) {
      console.log('[步骤1] 分析结果:', {
        source,
        scenes: analysis.scenes.length,
        storyboards: analysis.storyboards.length,
        characters: analysis.allCharacterNames.length,
      });
    }

    if (source === 'fallback-text') {
      handleAnalysisValidationFailure(
        warnings[0] ?? 'AI 返回的不是合格 JSON，已停留在 Step1，请重新分析。',
        targetProjectId,
        targetChapterId,
      );
      return false;
    }

    if (warnings.length > 0) {
      toast.warning(warnings[0]);
    }

    const sparseReason = getAnalysisSparseReason(analysis);
    if (sparseReason) {
      handleAnalysisValidationFailure(sparseReason, targetProjectId, targetChapterId, true);
      return false;
    }

    const validationError = validateAnalysisBeforeConfirm(analysis, { requireStep3Details: false });
    if (validationError) {
      handleAnalysisValidationFailure(validationError, targetProjectId, targetChapterId);
      return false;
    }

    resetAnalysisFeedback();
    dispatch({
      type: 'SET_ANALYSIS',
      analysis,
      projectId: targetProjectId,
      chapterId: targetChapterId,
      sourceText: analyzedSourceText.trim(),
    });
    dispatch({ type: 'SET_CHAPTER_STATUS', status: 'analyzing', projectId: targetProjectId, chapterId: targetChapterId });
    endStep1Task(targetProjectId, targetChapterId, {
      error: undefined,
      streamTextPreview: '',
      streamTextLength: analysisResponse.length,
    });
    return true;
  }, [dispatch, endStep1Task, handleAnalysisValidationFailure, resetAnalysisFeedback]);

  const analyzeScriptText = useCallback(async (
    scriptToAnalyze: string,
    targetProjectId: string,
    targetChapterId: string,
    options?: {
      originalSourceText?: string;
      sourceType?: 'annotated' | 'novel';
    },
  ) => {
    const targetProject = state.projects.find((project) => project.id === targetProjectId);
    const seriesContext = buildSeriesContextForChapter(targetProject, targetChapterId);
    const styleSourceText = [
      scriptToAnalyze,
      options?.originalSourceText ?? '',
      seriesContext ? JSON.stringify(seriesContext) : '',
    ].join('\n');
    const analysisUserMessages: ChatMessage[] = [
      {
        role: 'user',
        content: buildStep1UserPrompt({
          scriptText: scriptToAnalyze,
          originalSourceText: options?.originalSourceText ?? '',
          sourceType: options?.sourceType ?? 'annotated',
          seriesContext,
        }),
      },
    ];

    const analysisResponse = await callApiViaBff(state.apiConfig, analysisUserMessages, {
      templateType: 'step1',
    }, {
      temperature: 0.3,
      maxTokens: 12000,
      reasoningEffort: 'medium',
      stream: true,
      forceFresh: true,
      disableBackgroundJob: true,
      onStreamUpdate: createStep1StreamObserver(targetProjectId, targetChapterId, 'scripting'),
    });

    if (import.meta.env.DEV) {
      console.log(`[步骤1-分析] 分析完成，长度: ${analysisResponse.length} 字符`);
    }

    finalizeAnalysis(analysisResponse, scriptToAnalyze, targetProjectId, targetChapterId, styleSourceText);
  }, [callApiViaBff, createStep1StreamObserver, finalizeAnalysis, state.apiConfig, state.projects]);

  const persistAdaptedScript = useCallback((nextScript: string, silent = false) => {
    const trimmed = nextScript.trim();
    if (!trimmed) {
      toast.error('改编稿不能为空');
      return null;
    }

    dispatch({ type: 'SET_ADAPTED_SCRIPT', script: trimmed });
    setTempAdaptedScript(trimmed);
    setEditingAdaptedScript(false);
    if (!silent) {
      toast.success('改编稿已保存');
    }
    return trimmed;
  }, [dispatch]);

  const runAdaptedScriptAnalysis = useCallback(async (scriptToAnalyze: string) => {
    const targetProjectId = state.currentProjectId ?? undefined;
    const targetChapterId = chapter?.id;

    if (!targetProjectId || !targetChapterId) {
      toast.error('当前章节不可用，请刷新后重试');
      return;
    }

    resetAnalysisFeedback();

    const polishedScriptToAnalyze = normalizeAdaptedStoryboardHeadings(
      polishKnownAdaptedScriptIssues(scriptToAnalyze),
    );
    if (polishedScriptToAnalyze !== scriptToAnalyze.trim()) {
      dispatch({ type: 'SET_ADAPTED_SCRIPT', script: polishedScriptToAnalyze, projectId: targetProjectId, chapterId: targetChapterId });
      setTempAdaptedScript(polishedScriptToAnalyze);
    }

    if (!precheckStructuredScriptAnalysis(polishedScriptToAnalyze, targetProjectId, targetChapterId, {
      checkAdaptationQuality: true,
    })) {
      return;
    }

    dispatch({ type: 'SET_CHAPTER_STATUS', status: 'scripting', projectId: targetProjectId, chapterId: targetChapterId });
    updateStep1Task(targetProjectId, targetChapterId, 'scripting', {
      streamTextPreview: '',
      streamTextLength: 0,
      streamActivityAt: Date.now(),
      streamLastEvent: 'start',
      startedAt: Date.now(),
    });

    try {
      await analyzeScriptText(polishedScriptToAnalyze, targetProjectId, targetChapterId, {
        originalSourceText: chapter?.rawScript ?? '',
        sourceType: 'novel',
      });
    } catch (err) {
      if (isRequestCancelledError(err)) {
        dispatch({ type: 'SET_CHAPTER_STATUS', status: 'idle', projectId: targetProjectId, chapterId: targetChapterId });
        endStep1Task(targetProjectId, targetChapterId);
        return;
      }
      const message = err instanceof Error ? err.message : '分析过程出错，请重试';
      if (import.meta.env.DEV) console.error('[步骤1] 重新分析改编稿出错:', err);
      handleAnalysisValidationFailure(message, targetProjectId, targetChapterId);
    }
  }, [analyzeScriptText, chapter?.id, chapter?.rawScript, dispatch, endStep1Task, handleAnalysisValidationFailure, precheckStructuredScriptAnalysis, resetAnalysisFeedback, state.currentProjectId, updateStep1Task]);

  const saveAdaptedScript = useCallback(() => {
    persistAdaptedScript(tempAdaptedScript);
  }, [persistAdaptedScript, tempAdaptedScript]);

  const handleAbortAnalysis = useCallback(() => {
    if (currentStep1GlobalTask) {
      dispatch({ type: 'CANCEL_GLOBAL_TASK', taskId: currentStep1GlobalTask.id });
      toast.info('已请求停止当前 Step1 任务');
      return;
    }
    if (!loading) return;
    abort();
    if (state.currentProjectId && chapter?.id) {
      dispatch({ type: 'SET_CHAPTER_STATUS', status: 'idle', projectId: state.currentProjectId, chapterId: chapter.id });
      endStep1Task(state.currentProjectId, chapter.id);
    }
    toast.info('已取消当前分析');
  }, [abort, chapter?.id, currentStep1GlobalTask, dispatch, endStep1Task, loading, state.currentProjectId]);

  const handleReanalyzeAdaptedScript = useCallback(async () => {
    const targetProjectId = state.currentProjectId ?? undefined;
    const targetChapterId = chapter?.id;

    if (editingAdaptedScript) {
      if (!targetProjectId || !targetChapterId) {
        toast.error('当前章节不可用，请刷新后重试');
        return;
      }
      resetAnalysisFeedback();
      const polishedTempAdaptedScript = polishKnownAdaptedScriptIssues(tempAdaptedScript);
      if (!precheckStructuredScriptAnalysis(polishedTempAdaptedScript, targetProjectId, targetChapterId, {
        checkAdaptationQuality: true,
      })) {
        return;
      }
      if (polishedTempAdaptedScript !== tempAdaptedScript.trim()) {
        setTempAdaptedScript(polishedTempAdaptedScript);
      }
    }

    const nextScript = editingAdaptedScript
      ? persistAdaptedScript(polishKnownAdaptedScriptIssues(tempAdaptedScript), true)
      : chapter?.adaptedScript?.trim() ?? '';

    if (!nextScript) return;

    if (editingAdaptedScript) {
      toast.success('改编稿已保存');
    }

    if (!targetProjectId || !targetChapterId) return;
    if (ENABLE_GLOBAL_STEP1_TASKS) {
      dispatch({
        type: 'QUEUE_STEP1_TASK',
        projectId: targetProjectId,
        chapterId: targetChapterId,
        mode: 'adapted-analysis',
      });
      toast.success('改编稿分析已加入全局任务');
      return;
    }

    await runAdaptedScriptAnalysis(nextScript);
  }, [
    chapter?.adaptedScript,
    chapter?.id,
    editingAdaptedScript,
    dispatch,
    persistAdaptedScript,
    precheckStructuredScriptAnalysis,
    resetAnalysisFeedback,
    runAdaptedScriptAnalysis,
    state.currentProjectId,
    tempAdaptedScript,
  ]);

  const repairAdaptedScriptRhythmIfNeeded = useCallback(async (
    adaptedScript: string,
    originalNovelText: string,
  ) => {
    if (!ENABLE_ADAPTED_SCRIPT_QUALITY_GATE) {
      return adaptedScript;
    }

    let scriptToRepair = adaptedScript;
    let qualityIssues = findAdaptedScriptQualityIssues(scriptToRepair);

    for (let attempt = 1; attempt <= MAX_RHYTHM_REPAIR_ATTEMPTS; attempt += 1) {
      const shouldRepairRhythm = qualityIssues.some((issue) => issue.id === RHYTHM_ISSUE_ID);
      const shouldRepairStructure = qualityIssues.some((issue) => STRUCTURAL_ISSUE_IDS.has(issue.id));
      if (!shouldRepairRhythm && !shouldRepairStructure) return scriptToRepair;

      const qualityIssueSummary = formatAdaptedScriptQualityIssues(qualityIssues);
      const repairType = shouldRepairStructure ? '结构与对白' : '对白攻防';
      toast.info(attempt === 1
        ? `改编稿${repairType}不足，正在自动修稿`
        : `修稿后${repairType}仍不足，正在二次强化`);

      const repairUserMessages: ChatMessage[] = [
        {
          role: 'user',
          content: buildNovelAdaptRhythmRepairUserPrompt({
            novelText: originalNovelText,
            adaptedScript: scriptToRepair,
            qualityIssueSummary,
            storyboardDuration: MAX_ADAPTED_STORYBOARD_DURATION,
            episodeDuration,
          }),
        },
      ];

      const repairedScript = await callApiViaBff(state.apiConfig, repairUserMessages, {
        templateType: 'novel_adapt_rhythm_repair',
      }, {
        temperature: 0.2,
      });

      scriptToRepair = polishKnownAdaptedScriptIssues(assertCompleteAdaptedStoryboardScript(
        repairedScript,
        `改编节奏修稿第${attempt}轮`,
      ));
      qualityIssues = findAdaptedScriptQualityIssues(scriptToRepair);

      if (import.meta.env.DEV) {
        console.log(`[步骤1-改编节奏修稿] 第${attempt}轮修稿完成，长度: ${scriptToRepair.length} 字符`);
      }
    }

    return scriptToRepair;
  }, [callApiViaBff, episodeDuration, state.apiConfig]);

  // ---- 开始分析 ----
  const handleAnalyze = useCallback(async () => {
    const targetProjectId = state.currentProjectId ?? undefined;
    const targetChapterId = chapter?.id;

    if (!targetProjectId || !targetChapterId) {
      toast.error('当前章节不可用，请刷新后重试');
      return;
    }

    if (missingLlmApiKey) {
      toast.error('请先配置 API Key（点击右上角设置按钮）');
      openApiSettings();
      return;
    }
    if (!scriptText.trim()) {
      toast.error('请输入小说或标注剧本内容');
      return;
    }
    resetAnalysisFeedback();
    const localDetection = detectScriptType(scriptText);
    const classifierDecision = await classifyScriptInputWithLlm(scriptText.trim(), localDetection);
    const finalEffectiveScriptType = classifierDecision.scriptType;
    const finalIsNovel = classifierDecision.recommendedFlow === 'novel-adapt';
    const finalIsLooseScript = classifierDecision.recommendedFlow === 'script-format-adapt';

    if (finalIsNovel && scriptText.trim().length < MIN_ANALYSIS_CHAR_COUNT) {
      toast.error(`AI 识别为小说，但当前内容只有 ${scriptText.trim().length} 字，太短，容易误判。请先导入完整章节后再分析。`);
      return;
    }

    if (!finalIsNovel && !finalIsLooseScript) {
      if (!precheckStructuredScriptAnalysis(scriptText.trim(), targetProjectId, targetChapterId)) {
        return;
      }
    }

    // 保存剧本 + 设置状态
    if (savedScriptType !== finalEffectiveScriptType) {
      dispatch({ type: 'SET_SCRIPT_TYPE', scriptType: finalEffectiveScriptType });
    }
    dispatch({ type: 'SET_RAW_SCRIPT', script: scriptText.trim(), projectId: targetProjectId, chapterId: targetChapterId });
    if (classifierDecision.source === 'llm') {
      toast.success(`AI 已识别：${classifierDecision.classifierType === 'novel' ? '小说' : classifierDecision.classifierType === 'loose-script' ? '普通剧本' : '标注剧本'}`);
    }

    if (ENABLE_GLOBAL_STEP1_TASKS) {
      const queuedAt = Date.now();
      dispatch({
        type: 'QUEUE_STEP1_TASK',
        projectId: targetProjectId,
        chapterId: targetChapterId,
        mode: 'auto',
      });
      updateStep1Task(targetProjectId, targetChapterId, finalIsNovel || finalIsLooseScript ? 'adapting' : 'scripting', {
        streamTextPreview: '',
        streamTextLength: 0,
        streamActivityAt: queuedAt,
        streamLastEvent: 'queued',
        startedAt: queuedAt,
      });
      toast.success('Step1 已加入全局任务，可切换章节继续操作');
      return;
    }

    if (finalIsNovel) {
      // ===== 网文模式：两步调用 =====
      dispatch({ type: 'SET_CHAPTER_STATUS', status: 'adapting', projectId: targetProjectId, chapterId: targetChapterId });
      updateStep1Task(targetProjectId, targetChapterId, 'adapting', {
        streamTextPreview: '',
        streamTextLength: 0,
        streamActivityAt: Date.now(),
        streamLastEvent: 'start',
        startedAt: Date.now(),
      });

      try {
        // 第1步：改编（system prompt 由 BFF 注入）
        const adaptUserMessages: ChatMessage[] = [
          { role: 'user', content: buildNovelAdaptUserPrompt(scriptText.trim(), MAX_ADAPTED_STORYBOARD_DURATION, episodeDuration) },
        ];

        const rawAdaptedScript = await callApiViaBff(state.apiConfig, adaptUserMessages, {
          templateType: 'novel_adapt',
        }, {
          temperature: 0.3,
          forceFresh: true,
          disableBackgroundJob: true,
          onStreamUpdate: createStep1StreamObserver(targetProjectId, targetChapterId, 'adapting'),
        });
        let adaptedScript = polishKnownAdaptedScriptIssues(assertCompleteAdaptedStoryboardScript(
          rawAdaptedScript,
          '网文改编',
        ));
        adaptedScript = await repairAdaptedScriptRhythmIfNeeded(adaptedScript, scriptText.trim());

        if (import.meta.env.DEV) {
          console.log(`[步骤1-改编] 改编完成，长度: ${adaptedScript.length} 字符`);
        }

        // 保存改编结果，切换到分析状态
        dispatch({ type: 'SET_ADAPTED_SCRIPT', script: adaptedScript, projectId: targetProjectId, chapterId: targetChapterId });

        if (!precheckStructuredScriptAnalysis(adaptedScript, targetProjectId, targetChapterId, {
          checkAdaptationQuality: true,
        })) {
          return;
        }

        dispatch({ type: 'SET_CHAPTER_STATUS', status: 'scripting', projectId: targetProjectId, chapterId: targetChapterId });
        updateStep1Task(targetProjectId, targetChapterId, 'scripting', {
          streamTextPreview: '',
          streamTextLength: 0,
          streamActivityAt: Date.now(),
          streamLastEvent: 'start',
        });

        // 重置 streamText，避免改编结果残留到分析阶段的实时预览
        reset();
        await analyzeScriptText(adaptedScript, targetProjectId, targetChapterId, {
          originalSourceText: scriptText.trim(),
          sourceType: 'novel',
        });
      } catch (err) {
        if (isRequestCancelledError(err)) {
          dispatch({ type: 'SET_CHAPTER_STATUS', status: 'idle', projectId: targetProjectId, chapterId: targetChapterId });
          endStep1Task(targetProjectId, targetChapterId);
          return;
        }
        const message = err instanceof Error ? err.message : '分析过程出错，请重试';
        if (import.meta.env.DEV) console.error('[步骤1] 网文改编/分析出错:', err);
        handleAnalysisValidationFailure(message, targetProjectId, targetChapterId);
      }
    } else if (finalIsLooseScript) {
      // ===== 不标准剧本模式：先保对白做格式适配，再分析 =====
      dispatch({ type: 'SET_CHAPTER_STATUS', status: 'adapting', projectId: targetProjectId, chapterId: targetChapterId });
      updateStep1Task(targetProjectId, targetChapterId, 'adapting', {
        streamTextPreview: '',
        streamTextLength: 0,
        streamActivityAt: Date.now(),
        streamLastEvent: 'start',
        startedAt: Date.now(),
      });

      try {
        const formatUserMessages: ChatMessage[] = [
          { role: 'user', content: buildScriptFormatAdaptUserPrompt(scriptText.trim(), episodeDuration) },
        ];

        const formattedScript = assertCompleteAdaptedStoryboardScript(await callApiViaBff(state.apiConfig, formatUserMessages, {
          templateType: 'script_format_adapt',
        }, {
          temperature: 0.2,
          forceFresh: true,
          disableBackgroundJob: true,
          onStreamUpdate: createStep1StreamObserver(targetProjectId, targetChapterId, 'adapting'),
        }), '剧本格式适配');

        if (!precheckStructuredScriptAnalysis(formattedScript, targetProjectId, targetChapterId)) {
          return;
        }

        dispatch({ type: 'SET_CHAPTER_STATUS', status: 'scripting', projectId: targetProjectId, chapterId: targetChapterId });
        updateStep1Task(targetProjectId, targetChapterId, 'scripting', {
          streamTextPreview: '',
          streamTextLength: 0,
          streamActivityAt: Date.now(),
          streamLastEvent: 'start',
        });

        reset();
        await analyzeScriptText(formattedScript, targetProjectId, targetChapterId, {
          originalSourceText: scriptText.trim(),
          sourceType: 'annotated',
        });
      } catch (err) {
        if (isRequestCancelledError(err)) {
          dispatch({ type: 'SET_CHAPTER_STATUS', status: 'idle', projectId: targetProjectId, chapterId: targetChapterId });
          endStep1Task(targetProjectId, targetChapterId);
          return;
        }
        const message = err instanceof Error ? err.message : '分析过程出错，请重试';
        if (import.meta.env.DEV) console.error('[步骤1] 剧本格式适配/分析出错:', err);
        handleAnalysisValidationFailure(message, targetProjectId, targetChapterId);
      }
    } else {
      // ===== 标注剧本模式：单步调用（BFF 代理） =====
      dispatch({ type: 'SET_CHAPTER_STATUS', status: 'scripting', projectId: targetProjectId, chapterId: targetChapterId });
      updateStep1Task(targetProjectId, targetChapterId, 'scripting', {
        streamTextPreview: '',
        streamTextLength: 0,
        streamActivityAt: Date.now(),
        streamLastEvent: 'start',
        startedAt: Date.now(),
      });

      try {
        await analyzeScriptText(scriptText.trim(), targetProjectId, targetChapterId, {
          sourceType: 'annotated',
        });
      } catch (err) {
        if (isRequestCancelledError(err)) {
          dispatch({ type: 'SET_CHAPTER_STATUS', status: 'idle', projectId: targetProjectId, chapterId: targetChapterId });
          endStep1Task(targetProjectId, targetChapterId);
          return;
        }
        const message = err instanceof Error ? err.message : '分析过程出错，请重试';
        if (import.meta.env.DEV) console.error('[步骤1] 分析过程出错:', err);
        handleAnalysisValidationFailure(message, targetProjectId, targetChapterId);
      }
    }
  }, [state.currentProjectId, state.apiConfig, chapter?.id, scriptText, savedScriptType, episodeDuration, callApiViaBff, createStep1StreamObserver, dispatch, endStep1Task, reset, resetAnalysisFeedback, classifyScriptInputWithLlm, analyzeScriptText, precheckStructuredScriptAnalysis, missingLlmApiKey, openApiSettings, repairAdaptedScriptRhythmIfNeeded, handleAnalysisValidationFailure, updateStep1Task]);

  // ---- 判断当前状态文本 ----
  const getStatusText = () => {
    if (!visibleLoading) return '';
    if (visibleStep1Phase === 'adapting') return isLooseScript ? '正在整理剧本格式...' : '正在改编网文为分镜剧本...';
    if (visibleStep1Phase === 'scripting') return '正在分析剧本...';
    return '正在分析...';
  };

  // ---- 占位文本 ----
  const annotatedScriptExample = `分镜01（15秒）
画面：温知梨坐在寝室书桌前嗑瓜子，忽然发现彩票不见了。
对白：温知梨：“我的彩票呢？”

分镜02（15秒）
画面：系统在她身侧显形，抛出五百万奖励。
对白：系统：“请宿主保持人设，按照要求走完剧情，我们会奖励您五百万大奖哟！”

分镜03（15秒）
画面：温知梨抬眼看向系统，冷声反击。
对白：温知梨：“把我中的彩票还给我，不然抓你做研究。”`;
  const classicPlaceholder = `在此粘贴网文小说、小说片段，或已按分镜拆好的标注剧本。

系统会自动识别：
- 普通小说/网文：先改编为短剧分镜，再分析角色、场景、物品和分镜。
- 不标准剧本：先保留原对白整理成本站分镜格式，再分析。
- 标注剧本：检测到“分镜01（15秒）/画面/对白”等结构后，直接进入分析。

标注剧本示例：

${annotatedScriptExample}`;
  const nextPlaceholder = `输入网文小说、小说片段，或已按分镜拆好的标注剧本。
点击开始后，AI 会先判断输入类型：网文先改编，不标准剧本先保对白整理格式，标注剧本直接分析。
示例已收起，可在右上角查看。`;
  const placeholder = ENABLE_NEXT_UI_PREVIEW ? nextPlaceholder : classicPlaceholder;

  const scriptEditor = (
    <Textarea
      placeholder={placeholder}
      value={scriptText}
      onChange={(e) => {
        resetAnalysisFeedback();
        setScriptText(e.target.value);
      }}
      className={cn('step1-script-editor font-mono text-sm', visibleLoading ? 'is-loading min-h-[220px] max-h-[280px]' : 'min-h-[400px]')}
    />
  );

  return (
    <Card className="step1-workbench-card w-full">
      <CardHeader className="step1-workbench-header gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between">
        <div className="step1-workbench-heading min-w-0">
          <CardTitle className="step1-workbench-title flex items-center gap-2">
            <span className="step1-step-badge flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              {ENABLE_NEXT_UI_PREVIEW ? '01' : '1'}
            </span>
            输入小说或剧本
          </CardTitle>
          <p className="step1-workbench-subtitle text-sm text-muted-foreground">
            粘贴这一章的原文；系统会自动选择小说改编、剧本整理或直接分析。
          </p>
        </div>
        {onOpenSeries && (
          <Button
            type="button"
            aria-label="一句话写出多集爽剧剧本"
            onClick={onOpenSeries}
            className="step1-series-button h-auto min-w-[300px] shrink-0 gap-2 rounded-lg px-4 py-3 text-left shadow-sm"
          >
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex min-w-0 flex-col leading-none">
              <span className="text-sm font-semibold">
                {ENABLE_NEXT_UI_PREVIEW ? '系列策划生成' : '一句话写出多集爽剧剧本'}
              </span>
              <span className="mt-1 text-[11px] font-normal text-primary-foreground/75">
                {ENABLE_NEXT_UI_PREVIEW ? '人设 · 分集 · 长剧情' : '人设圣经 · 分集爽点卡 · 单集长剧情'}
              </span>
            </span>
            <ArrowRight className="ml-auto h-4 w-4 shrink-0" aria-hidden="true" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="step1-workbench-content space-y-4">
        <div className={cn('step1-onboarding-strip', ENABLE_NEXT_UI_PREVIEW && 'step1-empty-helper')}>
          <span>新手提示</span>
          <strong>直接粘贴内容即可：</strong>
          <em>小说会先改编，普通剧本会先整理，标准分镜剧本会直接分析。</em>
        </div>
        {/* 自动识别结果 */}
        <div className={cn('step1-detection-strip rounded-xl border bg-muted/30 p-3', !trimmedScriptText && ENABLE_NEXT_UI_PREVIEW && 'is-idle')}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="step1-detection-main flex items-start gap-3">
              <div className={cn(
                'step1-detection-icon mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border',
                isNovel ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-primary/25 bg-primary/10 text-primary',
              )}>
                {isNovel ? <BookOpen className="h-4 w-4" /> : <BookText className="h-4 w-4" />}
              </div>
              <div className="step1-detection-copy space-y-1">
                <div className="step1-detection-title-row flex flex-wrap items-center gap-2">
                  <span className="step1-detection-title text-sm font-semibold">{detectionLabel}</span>
                  <span className="step1-confidence-pill rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                    {scriptTypeOverride === 'auto' ? `自动识别 · 置信度${detectionConfidenceText}` : '手动指定'}
                  </span>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{detectionDetail}</p>
              </div>
            </div>
            <div className="step1-detection-actions">
              {ENABLE_NEXT_UI_PREVIEW && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowScriptExample((next) => !next)}
                >
                  {showScriptExample ? '收起示例' : '查看示例'}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowInputAdvanced((next) => !next)}
              >
                {showInputAdvanced ? '收起高级设置' : '高级设置'}
              </Button>
            </div>
          </div>

          {showInputAdvanced && (
            <div className="step1-mode-grid mt-3 grid gap-2 border-t pt-3 sm:grid-cols-3">
              {[
                { value: 'auto' as const, title: '自动识别', desc: '推荐，少一步操作' },
                { value: 'annotated' as const, title: '标注剧本', desc: '直接分析分镜结构' },
                { value: 'novel' as const, title: '网文小说', desc: '先改编再分析' },
              ].map((option) => {
                const selected = scriptTypeOverride === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleScriptTypeOverrideChange(option.value)}
                    className={cn(
                      'step1-mode-option relative rounded-lg border px-3 py-2 text-left transition-colors',
                      selected
                        ? 'is-selected border-primary bg-primary/5 text-primary'
                        : 'bg-background hover:border-primary/40 hover:bg-muted/50',
                    )}
                  >
                    <span className="block text-sm font-medium">{option.title}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{option.desc}</span>
                    {selected && <Check className="absolute right-2 top-2 h-3.5 w-3.5" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {shouldShowImportPreview && (
          <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 p-3 text-amber-950">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-white text-amber-700">
                  <Import className="h-4 w-4" />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{importPreview.label}</p>
                    <span className="rounded-full border border-amber-200 bg-white/80 px-2 py-0.5 text-[11px] text-amber-800">
                      建议先创建章节
                    </span>
                  </div>
                  <p className="text-xs leading-5 text-amber-900/80">{importPreview.detail}</p>
                  <div className="flex flex-wrap gap-2 text-[11px] text-amber-900/75">
                    <span>共 {importPreview.segments.length} 个章节</span>
                    {previewNovelCount > 0 && <span>小说 {previewNovelCount}</span>}
                    {previewAnnotatedCount > 0 && <span>标注剧本 {previewAnnotatedCount}</span>}
                    <span>{trimmedScriptText.length} 字符</span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCreateChaptersFromImport}
                  disabled={visibleLoading}
                  className="gap-1.5"
                >
                  <Import className="h-3.5 w-3.5" />
                  创建 {importPreview.segments.length} 个章节
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowImportSegments((next) => !next)}
                >
                  {showImportSegments ? '收起拆分' : '查看拆分'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setDismissedImportSignature(importPreviewSignature)}
                >
                  只分析当前文本
                </Button>
              </div>
            </div>

            {showImportSegments && (
              <div className="mt-3 grid gap-2 border-t border-amber-200/80 pt-3 md:grid-cols-2">
                {previewSegments.map((segment, index) => (
                  <div key={`${segment.title}-${index}`} className="rounded-lg border border-amber-200/80 bg-white/75 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-xs font-medium">{segment.title}</p>
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">
                        {segment.scriptType === 'novel' ? '小说' : '标注剧本'}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-amber-900/65">{segment.charCount} 字符</p>
                  </div>
                ))}
                {importPreview.segments.length > previewSegments.length && (
                  <div className="rounded-lg border border-dashed border-amber-200/90 bg-white/50 p-2 text-xs text-amber-900/70">
                    还有 {importPreview.segments.length - previewSegments.length} 个章节会一起创建
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 小说改编设置：只在网文模式下显示，标注剧本不会使用这些配置。 */}
        {isNovel && (
          <div className="step1-novel-settings rounded-xl border border-blue-200/70 bg-blue-50/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-white text-blue-600">
                  <BookOpen className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-blue-950">小说改编 · 单集设置</p>
                  <p className="text-xs leading-5 text-blue-900/70">
                    改编会按剧情单元生成 4~15 秒分镜；单集时长作为参考，优先保剧情。
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2.5 py-1 text-xs text-blue-900 shadow-sm">
                  分镜 4~15 秒
                </span>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs text-blue-900 shadow-sm">
                  单集 {episodeDuration} 秒
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowNovelAdaptSettings((next) => !next)}
                >
                  {showNovelAdaptSettings ? '收起单集设置' : '调整单集'}
                </Button>
              </div>
            </div>

            {showNovelAdaptSettings && (
              <div className="mt-3 grid gap-3 border-t border-blue-200/70 pt-3 md:grid-cols-2">
                <div className="space-y-2 rounded-lg bg-white/70 p-3">
                  <div>
                    <p className="text-sm font-medium">单分镜时长</p>
                    <p className="text-xs text-muted-foreground">
                      当前使用智能时长：每镜 4~15 秒，按剧情强弱自动浮动。
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {ENABLE_NOVEL_STORYBOARD_DURATION_SELECTION ? (
                      <>
                        <Select
                          value={String(MAX_ADAPTED_STORYBOARD_DURATION)}
                          onValueChange={handleStoryboardDurationChange}
                        >
                          <SelectTrigger className="h-8 w-[140px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STORYBOARD_DURATION_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {shouldShowCustomSbDuration && (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={5}
                              max={60}
                              value={customSbDuration}
                              onChange={(e) => setCustomSbDuration(e.target.value)}
                              placeholder={`${storyboardDuration}`}
                              className="h-8 w-20 rounded-md border bg-transparent px-2 text-center text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <span className="text-xs text-muted-foreground">秒</span>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleCustomSbDurationConfirm}>
                              确定
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800">
                          智能 4~15 秒
                        </span>
                        <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs text-blue-700">
                          智能时长预留
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2 rounded-lg bg-white/70 p-3">
                  <div>
                    <p className="text-sm font-medium">单集目标时长</p>
                    <p className="text-xs text-muted-foreground">控制小说改编后的目标总时长，默认 120 秒。</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={shouldShowCustomEpDuration ? 'custom' : String(episodeDuration)}
                      onValueChange={handleEpisodeDurationChange}
                    >
                      <SelectTrigger className="h-8 w-[140px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EPISODE_DURATION_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value} className="text-xs">
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {shouldShowCustomEpDuration && (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={30}
                          max={600}
                          value={customEpDuration}
                          onChange={(e) => setCustomEpDuration(e.target.value)}
                          placeholder={`${episodeDuration}`}
                          className="h-8 w-20 rounded-md border bg-transparent px-2 text-center text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <span className="text-xs text-muted-foreground">秒</span>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleCustomEpDurationConfirm}>
                          确定
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {ENABLE_NEXT_UI_PREVIEW ? (
          <div className={cn('step1-editor-shell', !trimmedScriptText && 'is-empty')}>
            <div className="step1-editor-toolbar">
              <div className="min-w-0">
                <p className="step1-editor-title">原始内容</p>
                <p className="step1-editor-meta">
                  {scriptText ? `${scriptText.length} 字符` : '等待输入'} · {detectionLabel}
                </p>
              </div>
              {scriptText && (
                <div className="step1-editor-actions">
                  <Button type="button" size="sm" variant="ghost" onClick={handleClearScriptText}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    清空
                  </Button>
                </div>
              )}
            </div>
            {showScriptExample && (
              <pre className="step1-script-example">
                {annotatedScriptExample}
              </pre>
            )}
            {scriptEditor}
            <div className="step1-editor-footer">
              <div className="step1-editor-footer-copy">
                {scriptText ? `${scriptText.length} 字符 · ${detectionLabel}` : '粘贴内容后可开始识别并分析'}
              </div>
              <div className="step1-editor-footer-actions">
                {canReturnToExistingAnalysis && !visibleLoading ? (
                  <>
                    <Button
                      type="button"
                      onClick={handleReturnToExistingAnalysis}
                      size="lg"
                      variant="outline"
                    >
                      返回已有分析
                    </Button>
                    <Button
                      type="button"
                      onClick={handleAnalyze}
                      disabled={!canAnalyze}
                      size="lg"
                    >
                      {analyzeButtonLabel}
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={handleAnalyze}
                    disabled={visibleLoading || !canAnalyze}
                    size="lg"
                  >
                    {visibleLoading
                      ? (isNovel ? '改编分析中...' : isLooseScript ? '格式适配中...' : '分析中...')
                      : analyzeButtonLabel}
                  </Button>
                )}
                {visibleLoading && (
                  <Button onClick={handleAbortAnalysis} variant="outline" size="lg">
                    <Square className="mr-1.5 h-4 w-4" />
                    停止
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : scriptEditor}

        <div className={cn('step1-action-row flex items-center gap-3', ENABLE_NEXT_UI_PREVIEW && 'hidden')}>
          {canReturnToExistingAnalysis && !visibleLoading ? (
            <>
              <Button
                type="button"
                onClick={handleReturnToExistingAnalysis}
                size="lg"
                className="min-w-[168px]"
              >
                返回已有分析结果
              </Button>
              <Button
                type="button"
                onClick={handleAnalyze}
                disabled={!canAnalyze}
                size="lg"
                variant="outline"
                className="min-w-[148px]"
              >
                {analyzeButtonLabel}
              </Button>
            </>
          ) : (
            <Button
              onClick={handleAnalyze}
              disabled={visibleLoading || !canAnalyze}
              size="lg"
              className="min-w-[160px]"
            >
              {visibleLoading
                ? (isNovel ? '改编分析中...' : isLooseScript ? '格式适配中...' : '分析中...')
                : analyzeButtonLabel}
            </Button>
          )}
          {visibleLoading && (
            <Button onClick={handleAbortAnalysis} variant="outline" size="lg">
              <Square className="mr-1.5 h-4 w-4" />
              停止
            </Button>
          )}
          {scriptText && (
            <span className="text-sm text-muted-foreground">
              {scriptText.length} 字符
            </span>
          )}
        </div>

        {canReturnToExistingAnalysis && (
          <div className="step1-existing-analysis rounded-xl border border-emerald-200/70 bg-emerald-50/60 p-3 text-sm text-emerald-950">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">当前章节已有分析结果</p>
                <p className="mt-1 text-xs leading-5 text-emerald-900/75">
                  {chapter?.analysisIsStale
                    ? '脚本内容已改动，旧分析仍可查看，但进入 Step3 前建议重新分析。'
                    : '如果只是回来检查原文，可以直接回到 Step2，不必重新调用模型。'}
                </p>
              </div>
              <span className="step1-existing-pill">推荐继续</span>
            </div>
          </div>
        )}

        {isScriptTooShort && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-900">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">当前内容较短，AI 会在开始前复核类型</p>
                <p className="mt-1 text-xs leading-5 text-amber-800/80">
                  现在只有 {trimmedScriptText.length} 字。如果这是占位文字，建议先粘贴完整章节；如果是短剧本片段，可以继续点击开始。
                </p>
              </div>
            </div>
          </div>
        )}

        {isNovel && chapter?.adaptedScript && (
          <Card className="border-primary/15 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="h-4 w-4 text-primary" />
                最近一次改编稿
                <span className="text-xs font-normal text-muted-foreground">
                  {chapter.adaptedScript.length} 字符
                </span>
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                网文改编成功后会保留在这里。若二段分析失败，可直接修改后重新分析，不必重新粘贴原网文。
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {editingAdaptedScript ? (
                <Textarea
                  value={tempAdaptedScript}
                  onChange={(e) => {
                    resetAnalysisFeedback();
                    setTempAdaptedScript(e.target.value);
                  }}
                  className="min-h-[260px] font-mono text-xs"
                />
              ) : (
                <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-background/80 p-3 text-xs text-muted-foreground">
                  {chapter.adaptedScript}
                </pre>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {editingAdaptedScript ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => {
                      setTempAdaptedScript(chapter.adaptedScript ?? '');
                      setEditingAdaptedScript(false);
                    }}>
                      <X className="mr-1 h-3.5 w-3.5" />
                      取消
                    </Button>
                    <Button size="sm" variant="outline" onClick={saveAdaptedScript}>
                      保存改编稿
                    </Button>
                    <Button size="sm" onClick={handleReanalyzeAdaptedScript} disabled={visibleLoading}>
                      保存并重新分析
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setEditingAdaptedScript(true)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      编辑改编稿
                    </Button>
                    <Button size="sm" onClick={handleReanalyzeAdaptedScript} disabled={visibleLoading}>
                      重新分析改编稿
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {!isNovel && (
          <div className="step1-annotated-note rounded-md border border-primary/15 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            标注剧本会以文本中每个分镜写明的时长为准，不使用小说改编参数；建议每个分镜都单独写明时长。
          </div>
        )}

        {failureMessage && (
          <div className={cn(
            'rounded-md border p-3 text-sm',
            analysisIssue && analysisSparse
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-red-200 bg-red-50 text-red-800',
          )}>
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-2">
                <p className="font-medium">
                  {analysisIssue
                    ? (analysisSparse ? '分析结果不完整，已停留在 Step1' : '分析结果未通过校验，已停留在 Step1')
                    : '分析过程未完成，已停留在 Step1'}
                </p>
                <p className={cn('mt-0.5', analysisIssue && analysisSparse ? 'text-amber-700' : 'text-red-700')}>
                  {failureMessage}
                </p>
                {recoveryHints.length > 0 && (
                  <ul className="space-y-1 text-xs leading-5">
                    {recoveryHints.map((hint) => (
                      <li key={hint} className="flex items-start gap-2">
                        <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                        <span>{hint}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {isNovel && hasAdaptedScript ? (
                    <>
                      <Button size="sm" onClick={handleReanalyzeAdaptedScript} disabled={visibleLoading}>
                        {editingAdaptedScript ? '保存并重新分析改编稿' : '只重新分析改编稿'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleAnalyze}
                        disabled={visibleLoading || !canAnalyze}
                      >
                        重新从原文改编
                      </Button>
                    </>
                ) : (
                  <Button size="sm" onClick={handleAnalyze} disabled={visibleLoading || !canAnalyze}>
                      重新分析当前内容
                  </Button>
                )}
                </div>
              </div>
            </div>
          </div>
        )}

        {missingLlmApiKey && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">对话模型 API Key 未配置</p>
                  <p className="mt-0.5 text-xs leading-5 text-amber-800">
                    Step1 的小说改编和结构化分析会调用对话模型，请先配置密钥后再开始。
                  </p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={openApiSettings}>
                <Settings className="mr-1.5 h-3.5 w-3.5" />
                打开 API 设置
              </Button>
            </div>
          </div>
        )}

        {visibleLoading && (
          <div className="rounded-xl border border-blue-200/70 bg-blue-50/40 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-blue-950">Step1 正在执行</p>
                <p className="text-xs leading-5 text-blue-900/70">
                  {isNovel
                    ? '先把网文改编成 4~15 秒分镜，再做结构化分析。'
                    : isLooseScript
                      ? '先保留原对白整理成本站分镜格式，再做结构化分析。'
                      : '正在把标注剧本转成角色、场景、道具和分镜结构。'}
                </p>
              </div>
              <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs text-blue-700">
                {getStatusText()}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {step1PipelinePhases.map((phase, index) => {
                const isActive = index === activePipelinePhaseIndex;
                const isDone = activePipelinePhaseIndex > index;
                return (
                  <div
                    key={phase.id}
                    className={cn(
                      'rounded-lg border px-3 py-2 transition-colors',
                      isActive
                        ? 'border-blue-300 bg-white shadow-sm'
                        : isDone
                          ? 'border-emerald-200 bg-emerald-50/70'
                          : 'border-blue-100 bg-white/60',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                          isActive
                            ? 'bg-blue-600 text-white'
                            : isDone
                              ? 'bg-emerald-500 text-white'
                              : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {isActive ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : isDone ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <span className="text-xs font-semibold text-foreground">{phase.title}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{phase.desc}</p>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
              <div className="rounded-lg border border-blue-100 bg-white/70 px-3 py-2 dark:border-blue-400/20 dark:bg-slate-950/30">
                <p className="text-blue-900/60 dark:text-blue-100/60">已等待</p>
                <p className="mt-1 font-semibold text-blue-950 dark:text-blue-50">{step1ElapsedText}</p>
              </div>
              <div className="rounded-lg border border-blue-100 bg-white/70 px-3 py-2 dark:border-blue-400/20 dark:bg-slate-950/30">
                <p className="text-blue-900/60 dark:text-blue-100/60">最近活动</p>
                <p className="mt-1 font-semibold text-blue-950 dark:text-blue-50">{step1ActivityAgeText}</p>
              </div>
              <div className="rounded-lg border border-blue-100 bg-white/70 px-3 py-2 dark:border-blue-400/20 dark:bg-slate-950/30">
                <p className="text-blue-900/60 dark:text-blue-100/60">当前信号</p>
                <p className="mt-1 font-semibold text-blue-950 dark:text-blue-50">{step1LastEventLabel}</p>
              </div>
              <div className="rounded-lg border border-blue-100 bg-white/70 px-3 py-2 dark:border-blue-400/20 dark:bg-slate-950/30">
                <p className="text-blue-900/60 dark:text-blue-100/60">已接收</p>
                <p className="mt-1 font-semibold text-blue-950 dark:text-blue-50">{step1ReceivedLength} 字符</p>
              </div>
            </div>
            {step1RetryNotice && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100">
                正在自动重试 {step1RetryNotice.attempt}/{step1RetryNotice.maxRetries}，上一轮错误：{step1RetryNotice.error}
              </div>
            )}
          </div>
        )}

        {/* 流式响应实时反馈 */}
        {visibleLoading && (
          <Card className="border-blue-200 bg-blue-50/30">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                实时反馈
                <span className="text-xs font-normal text-muted-foreground">
                  {step1ReceivedLength > 0 ? `${step1ReceivedLength} 字符已接收` : `等待模型活动 · 已等待 ${step1ElapsedText}`}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="rounded-md border border-blue-100 bg-white/75 px-3 py-2 dark:border-blue-400/20 dark:bg-slate-950/30">
                <p className="font-medium text-blue-900 dark:text-blue-100">
                  {streamPhaseTitle}
                  <span className="ml-1 inline-block h-3.5 w-0.5 animate-pulse bg-blue-400 align-middle" />
                </p>
                <p className="mt-1 text-xs leading-5 text-blue-800/75 dark:text-blue-100/75">
                  {streamPhaseDetail}
                </p>
                <p className="mt-1 text-xs leading-5 text-blue-800/75 dark:text-blue-100/75">
                  当前信号：{step1LastEventLabel}；最近活动：{step1ActivityAgeText}；连续 {STEP1_LLM_REQUEST_TIMEOUT_SECONDS} 秒没有模型活动才会停止。
                </p>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                为避免把模型中间态误当成最终结果，结构化 JSON 不在这里直接展示；只要内容或思考活动持续流动，就不会触发 300 秒空闲超时。
              </p>
            </CardContent>
          </Card>
        )}

        {/* 快捷提示 */}
        <div className="step1-quick-hints grid grid-cols-1 gap-3 rounded-md border bg-muted/50 p-3 sm:grid-cols-3">
          {(isNovel
            ? [
              { title: '开头钩子', desc: '前3秒强冲突开场', Icon: Sparkles },
              { title: '智能改编', desc: '自动优化节奏', Icon: Zap },
              { title: '悬念设计', desc: '留悬念驱动下集', Icon: Clapperboard },
            ]
            : [
              { title: '场景', desc: '自动提取场景清单', Icon: MapPin },
              { title: '角色', desc: '识别所有出场角色', Icon: UsersRound },
              { title: '分镜', desc: '拆分分镜结构', Icon: Clapperboard },
            ]
          ).map(({ title, desc, Icon }) => (
            <div key={title} className="flex items-center justify-center gap-2 text-center sm:flex-col sm:gap-1.5">
              <Icon className="h-4 w-4 shrink-0 text-primary sm:h-5 sm:w-5" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold leading-5">{title}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
