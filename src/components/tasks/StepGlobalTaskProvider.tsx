import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useCurrentProject, type Action } from '@/stores/projectStore';
import { bffChatComplete, bffChatCompleteStream } from '@/lib/bff-client';
import { canStartGlobalTask, getGlobalTaskPermanentBlockReason } from '@/lib/globalTaskDependencies';
import type { ChatMessage } from '@/lib/api-client';
import { buildStep1UserPrompt } from '@/lib/prompt-templates/build-context-L3';
import { buildSeriesRuntimeContext } from '@/lib/seriesRuntime';
import { buildNovelAdaptUserPrompt } from '@/lib/prompt-templates/novel-adapt';
import { buildScriptFormatAdaptUserPrompt } from '@/lib/prompt-templates/script-format-adapt';
import { parseAnalysisResponseDetailed, getAnalysisSparseReason } from '@/lib/analysisParser';
import { validateAnalysisBeforeConfirm } from '@/lib/analysisValidation';
import { resolveStep1StyleConfig } from '@/lib/style-presets';
import { validateAnnotatedScriptInput } from '@/components/step1/annotatedScriptPrecheck';
import { polishKnownAdaptedScriptIssues } from '@/components/step1/adaptedScriptQuality';
import {
  detectScriptType,
  localDetectionToClassifierDecision,
  parseScriptTypeClassifierDecision,
} from '@/components/step1/scriptTypeDetection';
import { loadBlob, saveBlob } from '@/lib/imageStore';
import { encodeWebpSameSize } from '@/lib/lightweightImageCompression';
import {
  buildDirectImagePrompt,
  enforceImagePromptGuards,
  generateImage,
  normalizeImageSizeForConfig,
} from '@/lib/imageApiClient';
import {
  getImageRefCharacterVariantKey,
  isStoryboardCharacterReferenceConcept,
} from '@/lib/characterReferenceUtils';
import { inferCharacterGenderHint } from '@/lib/characterIdentityHints';
import { isNonHumanSystemCharacterText } from '@/lib/nonHumanCharacterVisual';
import { getErrorMessage, isTransientApiError } from '@/lib/transientApiError';
import { buildAllImageRefs, partitionImageRefs, buildAssetItems } from '@/components/step3/assetSlotDerivation';
import {
  getBatchGenerationTasks,
  linkGeneratedCharacterBase,
  resolveGenerationItem,
  shouldDeferGenerationTask,
  type BatchSelectionOptions,
} from '@/components/step3/assetBatchPlanning';
import { requireImg2ImgSourceBlob, resolveImg2ImgSourceAsset } from '@/components/step3/assetGenerationSource';
import {
  type AssetItem,
  genId,
  isTurnaroundConcept,
  mergeManualPromptWithCurrentTemplate,
} from '@/components/step3/assetUtils';
import {
  buildAssetContext,
  buildAssetDescription,
  buildTurnaroundPromptForItem,
  inferCharacterFocusProfile,
} from '@/components/step3/assetPromptDerivation';
import {
  applyOfficialNoFacePromptGuard,
  getGeneratedAssetExternalFields,
  getOfficialModeConceptLabel,
  getSelectedNoFaceOutfitDescription,
  isAbortError,
  isNoFaceCharacterVisualSlot,
  isOfficialVirtualHumanAsset,
  isOfficialVirtualHumanSlot,
  sanitizeNoFaceCharacterDescription,
} from '@/components/step3/assetManagerRules';
import { buildGroupCharacterPrompt, enforceGroupCharacterPromptGuards, getCharacterMultiplicity } from '@/lib/groupCharacterAssets';
import type {
  ApiConfig,
  AppState,
  Asset,
  Chapter,
  GlobalTask,
  ImageReference,
  Project,
  ScriptType,
  Step1TaskPhase,
  Step3TaskFailure,
} from '@/types';

const STEP1_STREAM_PREVIEW_LIMIT = 4000;
const STEP1_STREAM_UPDATE_INTERVAL_MS = 2000;
const STEP1_STREAM_UPDATE_MIN_CHARS = 500;
const STEP1_STREAM_IDLE_TIMEOUT_MS = 300_000;
const STEP1_LLM_RETRY_DELAYS_MS = [3000, 8000] as const;
const STEP3_IMAGE_GENERATE_RETRY_DELAYS_MS = [2500, 7000, 15000] as const;
const STEP3_DEFAULT_CONCURRENCY = 3;
const STEP3_MAX_CONCURRENCY = 8;
const LIGHTWEIGHT_WEBP_QUALITY = 0.95;
const LIGHTWEIGHT_WEBP_QUALITY_LABEL = 95;
const LIGHTWEIGHT_MIN_SAVED_BYTES = 1024;
const MIN_ADAPTED_STORYBOARD_DURATION = 4;
const MAX_ADAPTED_STORYBOARD_DURATION = 15;
const STORYBOARD_HEADING_PATTERN = /^(?:#{1,3}\s*)?分镜\s*0*(\d+)([^\n]*)$/gim;
const STORYBOARD_HEADING_DURATION_PATTERN = /([0-9０-９]+(?:[.．][0-9０-９]+)?)\s*秒/;
const STREAM_FAILURE_MARKER_PATTERN = /消息流出现异常|LLM API Error|BFF Error|API Error/i;

const step1StreamThrottle = new Map<string, { textLength: number; updatedAt: number }>();

type Dispatch = React.Dispatch<Action>;

function isRequestCancelledError(err: unknown): boolean {
  return (err instanceof DOMException && err.name === 'AbortError')
    || (err instanceof Error && (err.name === 'AbortError' || err.message.includes('已取消')));
}

function clampStep3Concurrency(value: number | undefined) {
  return Math.min(STEP3_MAX_CONCURRENCY, Math.max(1, Math.round(value ?? STEP3_DEFAULT_CONCURRENCY)));
}

function countAdaptedStoryboards(scriptText: string): number {
  return scriptText.match(STORYBOARD_HEADING_PATTERN)?.length ?? 0;
}

function normalizeDigits(value: string): string {
  return value.replace(/[�?９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
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
  if (!trimmedScript) throw new Error(`${stageLabel}未返回有效内容，请重试。`);
  if (STREAM_FAILURE_MARKER_PATTERN.test(trimmedScript)) {
    throw new Error(`${stageLabel}未完整返回：检测到消息流异常，已保留上一版完整稿，请稍后重试。`);
  }

  const storyboardCount = countAdaptedStoryboards(trimmedScript);
  if (storyboardCount === 0) {
    throw new Error(`${stageLabel}未完整返回：没有检测到“分�?1�?~15秒）”这类分镜标题，请重试。`);
  }
  const durations = getAdaptedStoryboardDurations(trimmedScript);
  if (durations.length !== storyboardCount) {
    throw new Error(`${stageLabel}未完整返回：有分镜标题缺�?4~15 秒单镜时长，请重试。`);
  }
  const invalidDurationIndex = durations.findIndex((duration) =>
    duration < MIN_ADAPTED_STORYBOARD_DURATION || duration > MAX_ADAPTED_STORYBOARD_DURATION);
  if (invalidDurationIndex >= 0) {
    throw new Error(`${stageLabel}返回的分�?{String(invalidDurationIndex + 1).padStart(2, '0')}时长�?${durations[invalidDurationIndex]} 秒，请控制在 4~15 秒后重试。`);
  }

  return trimmedScript;
}

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
  const recurringProps = seriesPlan.recurringProps ?? [];
  const relatedRecurringProps = recurringProps.filter(termMatchesContext);
  const selectedCharacters = (relatedCharacters.length > 0 ? relatedCharacters : seriesPlan.characters).slice(0, 6);

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

function runBffStream(
  apiConfig: ApiConfig,
  userMessages: ChatMessage[],
  templateType: string,
  options: {
    temperature?: number;
    maxTokens?: number;
    reasoningEffort?: 'low' | 'medium' | 'high';
    forceFresh?: boolean;
    disableBackgroundJob?: boolean;
    backgroundProgressMode?: 'detailed' | 'stage-only';
    templateVars?: Record<string, unknown>;
    signal: AbortSignal;
    onText: (fullText: string, event: 'chunk' | 'replace' | 'done' | 'activity') => void;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let fullText = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    const armIdleTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        settle(() => reject(new Error('流式生成超过 300 秒没有收到模型输出或思考活动，请检查模型连接后重试。')));
      }, STEP1_STREAM_IDLE_TIMEOUT_MS);
    };

    armIdleTimer();
    bffChatCompleteStream({
      templateType,
      templateVars: options.templateVars,
      userMessages,
      apiConfig,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      reasoningEffort: options.reasoningEffort,
      forceFresh: options.forceFresh,
      disableBackgroundJob: options.disableBackgroundJob,
      backgroundProgressMode: options.backgroundProgressMode,
    }, {
      onChunk: (delta) => {
        armIdleTimer();
        fullText += delta;
        options.onText(fullText, 'chunk');
      },
      onActivity: () => {
        armIdleTimer();
        options.onText(fullText, 'activity');
      },
      onReplace: (nextFullText) => {
        armIdleTimer();
        fullText = nextFullText;
        options.onText(fullText, 'replace');
      },
      onDone: (doneText) => {
        fullText = doneText || fullText;
        options.onText(fullText, 'done');
        settle(() => resolve(fullText));
      },
      onError: (error) => {
        settle(() => reject(error));
      },
    }, options.signal).catch((error) => {
      settle(() => reject(error));
    });
  });
}

function updateTaskStream(
  dispatch: Dispatch,
  task: GlobalTask,
  phase: Step1TaskPhase,
  text: string,
  event: string,
  stageLabel: string,
) {
  const now = Date.now();
  const previous = step1StreamThrottle.get(task.id);
  const gainedChars = previous ? text.length - previous.textLength : text.length;
  if (
    previous
    && now - previous.updatedAt < STEP1_STREAM_UPDATE_INTERVAL_MS
    && gainedChars < STEP1_STREAM_UPDATE_MIN_CHARS
  ) {
    return;
  }
  step1StreamThrottle.set(task.id, { textLength: text.length, updatedAt: now });
  const preview = text.slice(-STEP1_STREAM_PREVIEW_LIMIT);
  const updates = {
    streamTextPreview: '',
    streamTextLength: text.length,
    streamStageLabel: stageLabel,
    streamUpdatedAt: now,
    streamStageLastActivityAt: now,
  };
  dispatch({ type: 'UPDATE_GLOBAL_TASK', taskId: task.id, updates });
  dispatch({
    type: 'UPDATE_STEP1_TASK',
    projectId: task.projectId,
    chapterId: task.chapterId,
    updates: {
      running: true,
      sessionId: task.id,
      phase,
      streamTextPreview: preview,
      streamTextLength: text.length,
      streamActivityAt: now,
      streamLastEvent: event,
    },
  });
}

function failStep1Task(dispatch: Dispatch, task: GlobalTask, message: string) {
  step1StreamThrottle.delete(task.id);
  dispatch({
    type: 'END_STEP1_TASK',
    projectId: task.projectId,
    chapterId: task.chapterId,
    updates: { error: message },
  });
  dispatch({ type: 'SET_CHAPTER_STATUS', projectId: task.projectId, chapterId: task.chapterId, status: 'idle' });
  dispatch({
    type: 'UPDATE_GLOBAL_TASK',
    taskId: task.id,
    updates: { errors: [{ index: 0, error: message }], streamStageLabel: '已失败' },
  });
  dispatch({ type: 'FINISH_GLOBAL_TASK', taskId: task.id, status: 'failed', stopReason: 'failed' });
}

function failQueuedGlobalTask(dispatch: Dispatch, task: GlobalTask, message: string) {
  dispatch({
    type: 'UPDATE_GLOBAL_TASK',
    taskId: task.id,
    updates: {
      errors: [{ index: 0, error: message }],
      streamStageLabel: '前置步骤未完成',
      streamTextPreview: '',
      streamTextLength: 0,
      streamUpdatedAt: Date.now(),
    },
  });
  dispatch({
    type: 'APPEND_GLOBAL_TASK_EVENT',
    taskId: task.id,
    event: {
      level: 'error',
      label: '前置条件阻塞',
      detail: message,
    },
  });
  dispatch({ type: 'FINISH_GLOBAL_TASK', taskId: task.id, status: 'failed', stopReason: 'failed' });
}

function waitForStep1Retry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The user aborted a request.', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('The user aborted a request.', 'AbortError'));
    }, { once: true });
  });
}

async function runStep1TaskWithRetry(
  task: GlobalTask,
  stateRef: React.MutableRefObject<AppState>,
  dispatch: Dispatch,
  signal: AbortSignal,
) {
  let lastError: unknown;
  const maxRetries = STEP1_LLM_RETRY_DELAYS_MS.length;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      const error = getErrorMessage(lastError);
      const now = Date.now();
      dispatch({
        type: 'UPDATE_GLOBAL_TASK',
        taskId: task.id,
        updates: {
          retryNotice: { index: 0, attempt, maxRetries, error },
          streamStageLabel: `Step1 自动重试 ${attempt}/${maxRetries}`,
          streamTextPreview: '',
          streamUpdatedAt: now,
          streamStageLastActivityAt: now,
        },
      });
      dispatch({
        type: 'UPDATE_STEP1_TASK',
        projectId: task.projectId,
        chapterId: task.chapterId,
        updates: {
          running: true,
          sessionId: task.id,
          streamActivityAt: now,
          streamLastEvent: 'retry',
          streamTextPreview: '',
          streamTextLength: 0,
        },
      });
      dispatch({
        type: 'APPEND_GLOBAL_TASK_EVENT',
        taskId: task.id,
        event: {
          level: 'retry',
          label: `Step1 自动重试 ${attempt}/${maxRetries}`,
          detail: error,
          phase: 'step1',
        },
      });
      await waitForStep1Retry(STEP1_LLM_RETRY_DELAYS_MS[attempt - 1] ?? 0, signal);
    }

    try {
      await runStep1Task(task, stateRef, dispatch, signal);
      dispatch({
        type: 'UPDATE_GLOBAL_TASK',
        taskId: task.id,
        updates: { retryNotice: undefined },
      });
      return;
    } catch (error) {
      if (isRequestCancelledError(error) || signal.aborted) throw error;
      lastError = error;
      if (attempt >= maxRetries || !isTransientApiError(error)) {
        dispatch({
          type: 'UPDATE_GLOBAL_TASK',
          taskId: task.id,
          updates: { retryNotice: undefined },
        });
        throw error;
      }
    }
  }

  throw lastError ?? new Error('Step1 failed without an error');
}

function finalizeStep1Analysis(
  dispatch: Dispatch,
  task: GlobalTask,
  analysisResponse: string,
  analyzedSourceText: string,
  styleSourceText: string,
) {
  const parsedResult = parseAnalysisResponseDetailed(analysisResponse);
  const { analysis: parsedAnalysis, source, warnings } = parsedResult;
  const analysis = {
    ...parsedAnalysis,
    styleConfig: resolveStep1StyleConfig(
      parsedAnalysis.styleConfig,
      [analyzedSourceText, styleSourceText].filter(Boolean).join('\n'),
    ),
  };

  if (source === 'fallback-text') {
    throw new Error(warnings[0] ?? 'AI 返回的不是合法 JSON，已停留在 Step1，请重新分析。');
  }
  if (warnings.length > 0) toast.warning(warnings[0]);

  const sparseReason = getAnalysisSparseReason(analysis);
  if (sparseReason) throw new Error(sparseReason);

  const validationError = validateAnalysisBeforeConfirm(analysis, { requireStep3Details: false });
  if (validationError) throw new Error(validationError);

  dispatch({
    type: 'SET_ANALYSIS',
    analysis,
    projectId: task.projectId,
    chapterId: task.chapterId,
    sourceText: analyzedSourceText.trim(),
  });
  dispatch({ type: 'SET_CHAPTER_STATUS', status: 'analyzing', projectId: task.projectId, chapterId: task.chapterId });
  dispatch({
    type: 'END_STEP1_TASK',
    projectId: task.projectId,
    chapterId: task.chapterId,
    updates: {
      error: undefined,
      streamTextPreview: '',
      streamTextLength: analysisResponse.length,
    },
  });
}

async function runStep1Task(
  task: GlobalTask,
  stateRef: React.MutableRefObject<AppState>,
  dispatch: Dispatch,
  signal: AbortSignal,
) {
  const project = stateRef.current.projects.find((item) => item.id === task.projectId);
  const chapter = project?.chapters.find((item) => item.id === task.chapterId);
  if (!project || !chapter) throw new Error('找不到当前 Step1 章节。');

  const mode = task.step1Mode ?? 'auto';
  const rawScript = chapter.rawScript.trim();
  const detectedSource = detectScriptType(rawScript);
  let classifierDecision = localDetectionToClassifierDecision(detectedSource);
  if (mode !== 'adapted-analysis') {
    try {
      const classificationResponse = await bffChatComplete({
        templateType: 'script_type_classifier',
        userMessages: [{ role: 'user', content: JSON.stringify({ scriptText: rawScript }) }],
        apiConfig: stateRef.current.apiConfig,
        temperature: 0.1,
        maxTokens: 500,
        reasoningEffort: 'low',
        forceFresh: true,
        disableBackgroundJob: true,
      }, signal);
      classifierDecision = parseScriptTypeClassifierDecision(classificationResponse, detectedSource);
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[Step1 后台任务] LLM 输入类型识别失败，回退本地规则', err);
    }
  }
  const sourceType: ScriptType = mode === 'adapted-analysis'
    ? (chapter.scriptType ?? detectedSource.scriptType)
    : classifierDecision.scriptType;
  const shouldAdaptNovel = mode !== 'adapted-analysis' && classifierDecision.recommendedFlow === 'novel-adapt';
  const shouldFormatLooseScript = mode !== 'adapted-analysis' && classifierDecision.recommendedFlow === 'script-format-adapt';
  const sourceForDirectAnalysis = mode === 'adapted-analysis'
    ? chapter.adaptedScript.trim()
    : rawScript;

  if (!sourceForDirectAnalysis) throw new Error('当前章节没有可分析的剧本内容。');
  if (!shouldAdaptNovel && !shouldFormatLooseScript) {
    const precheckError = validateAnnotatedScriptInput(sourceForDirectAnalysis);
    if (precheckError) throw new Error(precheckError);
  }
  if (mode !== 'adapted-analysis' && chapter.scriptType !== sourceType) {
    dispatch({ type: 'SET_SCRIPT_TYPE', scriptType: sourceType, projectId: task.projectId, chapterId: task.chapterId });
  }

  const startedAt = Date.now();
  dispatch({ type: 'START_GLOBAL_TASK', taskId: task.id, startedAt });
  dispatch({
    type: 'UPDATE_GLOBAL_TASK',
    taskId: task.id,
    updates: {
      streamStageLastActivityAt: startedAt,
      streamUpdatedAt: startedAt,
    },
  });
  dispatch({
    type: 'UPDATE_STEP1_TASK',
    projectId: task.projectId,
    chapterId: task.chapterId,
    updates: {
      running: true,
      sessionId: task.id,
      phase: shouldAdaptNovel || shouldFormatLooseScript ? 'adapting' : 'scripting',
      streamTextPreview: '',
      streamTextLength: 0,
      streamActivityAt: startedAt,
      streamLastEvent: 'start',
      error: undefined,
      startedAt,
    },
  });
  dispatch({
    type: 'SET_CHAPTER_STATUS',
    status: shouldAdaptNovel || shouldFormatLooseScript ? 'adapting' : 'scripting',
    projectId: task.projectId,
    chapterId: task.chapterId,
  });

  let scriptToAnalyze = sourceForDirectAnalysis;
  let originalSourceText = mode === 'adapted-analysis' ? chapter.rawScript : '';
  let sourceTypeForAnalysis: ScriptType = sourceType;
  const useBrowserDirectTextLlm = true;
  const backgroundTextLlmOptions = {
    disableBackgroundJob: useBrowserDirectTextLlm,
    backgroundProgressMode: useBrowserDirectTextLlm ? undefined : 'stage-only' as const,
    templateVars: {
      projectId: task.projectId,
      chapterId: task.chapterId,
    },
  };

  if (shouldAdaptNovel) {
    const adaptResponse = await runBffStream(
      stateRef.current.apiConfig,
      [{ role: 'user', content: buildNovelAdaptUserPrompt(rawScript, MAX_ADAPTED_STORYBOARD_DURATION, chapter.episodeDuration || 120) }],
      'novel_adapt',
      {
        temperature: 0.3,
        forceFresh: true,
        ...backgroundTextLlmOptions,
        signal,
        onText: (text, event) => updateTaskStream(dispatch, task, 'adapting', text, event, '网文改编'),
      },
    );
    scriptToAnalyze = polishKnownAdaptedScriptIssues(assertCompleteAdaptedStoryboardScript(
      adaptResponse,
      '网文改编',
    ));
    dispatch({ type: 'SET_ADAPTED_SCRIPT', script: scriptToAnalyze, projectId: task.projectId, chapterId: task.chapterId });
    originalSourceText = rawScript;
    sourceTypeForAnalysis = 'novel';
    const precheckError = validateAnnotatedScriptInput(scriptToAnalyze);
    if (precheckError) throw new Error(precheckError);
  }

  if (shouldFormatLooseScript) {
    const adaptedResponse = await runBffStream(
      stateRef.current.apiConfig,
      [{ role: 'user', content: buildScriptFormatAdaptUserPrompt(rawScript, chapter.episodeDuration || 120) }],
      'script_format_adapt',
      {
        temperature: 0.2,
        forceFresh: true,
        ...backgroundTextLlmOptions,
        signal,
        onText: (text, event) => updateTaskStream(dispatch, task, 'adapting', text, event, '剧本格式适配'),
      },
    );
    scriptToAnalyze = assertCompleteAdaptedStoryboardScript(adaptedResponse, '剧本格式适配');
    originalSourceText = rawScript;
    sourceTypeForAnalysis = 'annotated';
    const precheckError = validateAnnotatedScriptInput(scriptToAnalyze);
    if (precheckError) throw new Error(precheckError);
  }

  dispatch({ type: 'SET_CHAPTER_STATUS', status: 'scripting', projectId: task.projectId, chapterId: task.chapterId });
  dispatch({
    type: 'UPDATE_STEP1_TASK',
    projectId: task.projectId,
    chapterId: task.chapterId,
    updates: {
      phase: 'scripting',
      streamTextPreview: '',
      streamTextLength: 0,
      streamActivityAt: Date.now(),
      streamLastEvent: 'start',
    },
  });

  const latestProject = stateRef.current.projects.find((item) => item.id === task.projectId) ?? project;
  const seriesContext = buildSeriesContextForChapter(latestProject, task.chapterId);
  const styleSourceText = [
    scriptToAnalyze,
    originalSourceText,
    seriesContext ? JSON.stringify(seriesContext) : '',
  ].join('\n');
  const analysisResponse = await runBffStream(
    stateRef.current.apiConfig,
    [{
      role: 'user',
      content: buildStep1UserPrompt({
        scriptText: scriptToAnalyze,
        originalSourceText,
        sourceType: sourceTypeForAnalysis,
        seriesContext,
      }),
    }],
    'step1',
    {
      temperature: 0.3,
      maxTokens: 12000,
      reasoningEffort: 'medium',
      forceFresh: true,
      ...backgroundTextLlmOptions,
      signal,
      onText: (text, event) => updateTaskStream(dispatch, task, 'scripting', text, event, '结构化分析'),
    },
  );

  finalizeStep1Analysis(dispatch, task, analysisResponse, scriptToAnalyze, styleSourceText);
  step1StreamThrottle.delete(task.id);
  dispatch({
    type: 'UPDATE_GLOBAL_TASK',
    taskId: task.id,
    updates: {
      doneCount: 1,
      streamStageLabel: '已完成',
      streamTextPreview: '',
      streamTextLength: analysisResponse.length,
      errors: [],
    },
  });
  dispatch({ type: 'FINISH_GLOBAL_TASK', taskId: task.id, status: 'done', stopReason: 'completed' });
}

function canGenerateLightweightAsset(asset: Pick<Asset, 'blobKey' | 'source'>) {
  return asset.source !== 'volc_virtual_human' && !asset.blobKey.startsWith('external:');
}

function buildNoFaceCharacterPrompt(item: AssetItem, analysis: Chapter['analysis'], buildDescription: (item: AssetItem) => string) {
  const styleLine = analysis?.styleConfig ? `整体风格�?{analysis.styleConfig}` : '';
  const outfitDesc = sanitizeNoFaceCharacterDescription(
    getSelectedNoFaceOutfitDescription(item, analysis?.outfitTracking),
  );
  const outfitLine = outfitDesc ? `变装/服装细节�?{outfitDesc}` : '';
  const layoutLine = isTurnaroundConcept(item.concept)
    ? '画面结构：16:9横版无脸服装/体态工业参考表，固定 CHARACTER REFERENCE SHEET 版式；主体上半区约80%严格排成6个固定面板：FRONT VIEW、SIDE VIEW、BACK VIEW、BLANK HEAD FRONT CLOSE-UP、BLANK HEAD SIDE CLOSE-UP、COSTUME / SUIT DETAIL VIEW。不得出现五官、头发、真实皮肤和身份特征。背景干净，电影级灯光，高清细节。'
    : '画面结构：单人服装产品设定图，优先无头裁缝人台、脖子以下服装人台或头部完全裁出画面；重点展示服装层次、装备、材质和配色。背景干净，电影级灯光，高清细节。';
  const prompt = [
    '无脸服装/体态参考图，不是角色肖像图，不要面部特写，不要头脸大特写。',
    '画面使用无头裁缝人台、脖子以下服装人台、无脸塑料模特或空白中性模特展示服装；不得出现真人脸、清晰五官、眼睛、鼻口、眉毛、表情、真实皮肤纹理、肖像脸、自拍脸、头发造型或可识别人物身份。',
    `服装/体态目标：${sanitizeNoFaceCharacterDescription(buildDescription(item))}`,
    outfitLine,
    '严禁把官方定妆照的脸、发型、肤色或身份特征带入这张服装参考图。',
    'Consistency Notes: only clothing, body proportion, material, outfit silhouette, accessories, and equipment may be inherited.',
    'Negative Prompt: no face, no facial features, no hairstyle, no skin identity, no portrait identity.',
    styleLine,
    layoutLine,
  ].filter(Boolean).join('\n');
  return applyOfficialNoFacePromptGuard(prompt, item, true);
}

function createStep3PromptBuilders(chapter: Chapter, useVolcVirtualHumans: boolean) {
  const analysis = chapter.analysis;
  const buildDescription = (item: AssetItem) => analysis
    ? buildAssetDescription({ item, analysis, adaptedScript: chapter.adaptedScript ?? '' })
    : item.name;
  const buildContext = (item: AssetItem) => buildAssetContext({
    item,
    rawScript: chapter.rawScript ?? '',
    adaptedScript: chapter.adaptedScript ?? '',
    analysis: analysis ?? undefined,
  });
  const buildTurnaroundPrompt = (item: AssetItem): string => {
    if (isNoFaceCharacterVisualSlot(item, useVolcVirtualHumans)) {
      return buildNoFaceCharacterPrompt(item, analysis, buildDescription);
    }
    const description = buildDescription(item);
    const nonHumanSystem = isNonHumanSystemCharacterText([item.name, description].join('\n'));
    const genderHint = nonHumanSystem ? undefined : inferCharacterGenderHint(item.name, description);
    const exclusivePropLines = [...description.matchAll(/专属物品设定：([^；。]+)/g)]
      .map((match) => match[1]?.trim())
      .filter(Boolean)
      .join('；');
    return buildTurnaroundPromptForItem(item, analysis?.styleConfig, exclusivePropLines, genderHint, nonHumanSystem);
  };
  const getCharacterFocus = (item: AssetItem) => {
    if (!analysis || item.type !== 'character') return 'support' as const;
    return inferCharacterFocusProfile({
      name: item.name,
      analysis,
      adaptedScript: chapter.adaptedScript ?? '',
      rawScript: chapter.rawScript ?? '',
    }).tier;
  };
  const buildDirectPrompt = (item: AssetItem) => {
    if (item.type === 'character' && getCharacterMultiplicity(item.name) === 'group') {
      return buildGroupCharacterPrompt({
        name: item.name,
        description: buildDescription(item),
        styleConfig: analysis?.styleConfig,
        concept: item.concept,
      });
    }
    if (isNoFaceCharacterVisualSlot(item, useVolcVirtualHumans)) {
      return buildNoFaceCharacterPrompt(item, analysis, buildDescription);
    }
    if (isTurnaroundConcept(item.concept)) return buildTurnaroundPrompt(item);
    const description = buildDescription(item);
    const genderHint = inferCharacterGenderHint(item.name, description, item.optimizedPrompt);
    return buildDirectImagePrompt(
      description,
      analysis?.styleConfig ?? '',
      item.type,
      item.concept,
      getCharacterFocus(item),
      genderHint,
    );
  };
  const getEffectivePrompt = (item: AssetItem) => {
    if (item.type === 'character' && getCharacterMultiplicity(item.name) === 'group') {
      return enforceGroupCharacterPromptGuards(buildDirectPrompt(item), item.concept);
    }
    const manualPrompt = item.optimizedPrompt.trim();
    const currentTemplatePrompt = buildDirectPrompt(item);
    const nonHumanSystem = item.type === 'character'
      ? isNonHumanSystemCharacterText([item.name, buildDescription(item)].join('\n'))
      : false;
    const guardedPrompt = enforceImagePromptGuards(
      mergeManualPromptWithCurrentTemplate(manualPrompt, currentTemplatePrompt),
      item.type,
      item.concept,
      { nonHumanSystem },
    );
    return applyOfficialNoFacePromptGuard(guardedPrompt, item, useVolcVirtualHumans);
  };
  return { buildDescription, buildContext, getEffectivePrompt };
}

function resolveGenerationItemForCurrentMode(
  item: AssetItem,
  sourceItems: Record<string, AssetItem>,
  sourceAssets: readonly Asset[],
  useVolcVirtualHumans: boolean,
): { item: AssetItem; error?: string } {
  const resolved = resolveGenerationItem(item, sourceItems);
  if (!isNoFaceCharacterVisualSlot(item, useVolcVirtualHumans)) return resolved;

  if (resolved.error) {
    const fallbackItem: AssetItem = {
      ...item,
      baseAssetId: undefined,
      generationMode: item.generationMode === 'upload' ? 'upload' : 'txt2img',
    };
    return { item: fallbackItem };
  }

  const sourceAsset = resolved.item.baseAssetId
    ? sourceAssets.find((asset) => asset.id === resolved.item.baseAssetId)
    : undefined;
  if (sourceAsset?.source !== 'volc_virtual_human') return resolved;

  const fallbackItem: AssetItem = {
    ...resolved.item,
    baseAssetId: undefined,
    generationMode: resolved.item.generationMode === 'upload' ? 'upload' : 'txt2img',
  };
  return { item: fallbackItem };
}

async function waitForStep3RetryDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('The user aborted a request.', 'AbortError');
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException('The user aborted a request.', 'AbortError'));
    };
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

async function generateStep3ImageWithRetry(params: {
  state: AppState;
  item: AssetItem;
  prompt: string;
  sourceAssets: readonly Asset[];
  signal: AbortSignal;
  onStatus: (message: string) => void;
  onRetry?: (message: string, error: unknown, attempt: number, maxRetries: number, delayMs: number) => void;
}) {
  const maxRetries = STEP3_IMAGE_GENERATE_RETRY_DELAYS_MS.length;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (params.signal.aborted) throw new DOMException('The user aborted a request.', 'AbortError');
    try {
      if (isOfficialVirtualHumanSlot(params.item, params.state.projects.find((project) => project.id === params.state.currentProjectId)?.step3Settings?.useVolcVirtualHumans ?? false)) {
        throw new Error('官方虚拟人像槽位需要从官方库匹配选择，不再生成或上传真人脸。');
      }
      let sourceBlob: Blob | undefined;
      const sourceAsset = resolveImg2ImgSourceAsset(params.item, params.sourceAssets);
      if (sourceAsset) {
        sourceBlob = requireImg2ImgSourceBlob(
          sourceAsset,
          await loadBlob(sourceAsset.blobKey) ?? undefined,
        );
      }
      const effectiveImageSize = normalizeImageSizeForConfig(params.state.imageApiConfig, params.item.imageSize, '1K');
      const result = await generateImage(params.state.imageApiConfig, {
        prompt: params.prompt,
        aspectRatio: params.item.aspectRatio,
        imageSize: effectiveImageSize,
        sourceBlob,
        signal: params.signal,
        onStatus: params.onStatus,
        background: {
          projectId: params.state.currentProjectId ?? undefined,
          namespace: `step3-${params.item.key}`,
          requireBackend: false,
        },
      }, params.state.videoApiConfig);
      return { ...result, imageSize: effectiveImageSize };
    } catch (error) {
      if (isAbortError(error) || params.signal.aborted || attempt >= maxRetries || !isTransientApiError(error)) throw error;
      const delayMs = STEP3_IMAGE_GENERATE_RETRY_DELAYS_MS[attempt] ?? 0;
      const retryMessage = `临时失败，${Math.round(delayMs / 1000)} 秒后自动重试 ${attempt + 2}/${maxRetries + 1}`;
      params.onStatus(retryMessage);
      params.onRetry?.(
        retryMessage,
        error,
        attempt + 1,
        maxRetries,
        delayMs,
      );
      await waitForStep3RetryDelay(delayMs, params.signal);
    }
  }
  throw new Error('图片生成失败，但未返回具体错误。');
}

function shouldSyncPrimaryImageRefs(item: Pick<AssetItem, 'type' | 'concept'>) {
  return item.type === 'scene'
    || item.type === 'prop'
    || (item.type === 'character' && isStoryboardCharacterReferenceConcept(item.concept));
}

function syncPrimaryImageRefs(dispatch: Dispatch, projectId: string, chapter: Chapter, item: AssetItem, assetId: string) {
  if (!shouldSyncPrimaryImageRefs(item)) return;
  chapter.storyboards.forEach((storyboard, storyboardIndex) => {
    storyboard.imageRefs.forEach((imageRef) => {
      const matchesRef = imageRef.type === item.type && (item.type === 'prop'
        ? imageRef.trackingId === item.identityKey
        : item.type === 'character'
          ? imageRef.name === item.name
            && (item.variantKey
              ? getImageRefCharacterVariantKey(imageRef) === item.variantKey
              : !getImageRefCharacterVariantKey(imageRef))
          : imageRef.name === item.name);
      if (!matchesRef) return;
      dispatch({
        type: 'LINK_ASSET_TO_STORYBOARD',
        projectId,
        chapterId: chapter.id,
        sbIndex: storyboardIndex,
        imageRefRefId: imageRef.refId,
        assetId,
        bindingMode: item.type === 'scene' ? 'auto' : 'manual',
        preserveGeneratedBoards: item.type !== 'scene',
      });
    });
  });
}

function mergeAssetLibrarySnapshots(
  latestAssets: readonly Asset[] | undefined,
  workingAssets: readonly Asset[],
) {
  const mergedAssetsById = new Map<string, Asset>();
  for (const asset of latestAssets ?? []) {
    mergedAssetsById.set(asset.id, asset);
  }
  for (const asset of workingAssets) {
    mergedAssetsById.set(asset.id, {
      ...asset,
      ...mergedAssetsById.get(asset.id),
    });
  }
  return Array.from(mergedAssetsById.values());
}

function collectStep3ItemsForTask(
  task: GlobalTask,
  items: Record<string, AssetItem>,
  allRefs: ReturnType<typeof partitionImageRefs>,
  options: BatchSelectionOptions,
) {
  if (task.step3Mode !== 'section-images' || !task.step3Section) {
    return items;
  }
  const refs: ImageReference[] = task.step3Section === 'character'
    ? allRefs.characters
    : task.step3Section === 'scene'
      ? allRefs.scenes
      : allRefs.props;
  const sectionItems: Record<string, AssetItem> = {};
  for (const ref of refs) {
    for (const item of Object.values(items)) {
      const matches = item.type === task.step3Section && (item.type === 'prop'
        ? item.identityKey === ref.trackingId
        : item.name === ref.name);
      if (matches) sectionItems[item.key] = item;
    }
  }
  return task.step3Section === 'character' || options.includeOutfitVariants ? sectionItems : sectionItems;
}

async function runLightweightStep3Task(
  task: GlobalTask,
  project: Project,
  dispatch: Dispatch,
  signal: AbortSignal,
  assetIdFilter?: ReadonlySet<string>,
) {
  const allCandidates = (project.assetLibrary ?? [])
    .filter((asset) => !assetIdFilter || assetIdFilter.has(asset.id))
    .filter(canGenerateLightweightAsset);
  const candidates = allCandidates.filter((asset) => !asset.lightweightBlobKey);
  dispatch({ type: 'START_GLOBAL_TASK', taskId: task.id, startedAt: Date.now() });
  dispatch({
    type: 'UPDATE_STEP3_TASK',
    projectId: task.projectId,
    chapterId: task.chapterId,
    updates: {
      running: true,
      sessionId: task.id,
      phase: 'lightweight',
      done: 0,
      total: candidates.length,
      success: 0,
      failed: 0,
      currentLabel: '正在压缩参考图...',
      stopRequested: false,
      stopped: false,
      error: undefined,
      failures: [],
      startedAt: Date.now(),
    },
  });
  dispatch({ type: 'UPDATE_GLOBAL_TASK', taskId: task.id, updates: { total: candidates.length, doneCount: 0, streamStageLabel: '参考图压缩' } });
  let generated = 0;
  let skippedNoGain = 0;
  let failed = 0;
  await Promise.allSettled(candidates.map(async (asset) => {
    if (signal.aborted) return;
    try {
      const originalBlob = await loadBlob(asset.blobKey);
      if (!originalBlob) {
        failed += 1;
        return;
      }
      const result = await encodeWebpSameSize(originalBlob, LIGHTWEIGHT_WEBP_QUALITY);
      if (result.compressedBytes >= result.originalBytes - LIGHTWEIGHT_MIN_SAVED_BYTES) {
        skippedNoGain += 1;
        return;
      }
      const newBlobKey = await saveBlob(result.blob);
      const updatedAt = Date.now();
      dispatch({
        type: 'UPDATE_ASSET',
        projectId: task.projectId,
        assetId: asset.id,
        updates: {
          lightweightBlobKey: newBlobKey,
          lightweightMimeType: 'image/webp',
          lightweightQuality: LIGHTWEIGHT_WEBP_QUALITY_LABEL,
          lightweightOriginalBytes: result.originalBytes,
          lightweightBytes: result.compressedBytes,
          lightweightWidth: result.width,
          lightweightHeight: result.height,
          lightweightCreatedAt: updatedAt,
          updatedAt,
        },
      });
      generated += 1;
    } catch {
      failed += 1;
    } finally {
      const done = generated + skippedNoGain + failed;
      dispatch({
        type: 'UPDATE_STEP3_TASK',
        projectId: task.projectId,
        chapterId: task.chapterId,
        updates: { done, total: candidates.length, success: generated, failed, currentLabel: `正在压缩参考图 ${done}/${candidates.length}` },
      });
      dispatch({ type: 'UPDATE_GLOBAL_TASK', taskId: task.id, updates: { doneCount: done, streamTextPreview: `参考图压缩 ${done}/${candidates.length}` } });
    }
  }));
  dispatch({
    type: 'END_STEP3_TASK',
    projectId: task.projectId,
    chapterId: task.chapterId,
    updates: {
      phase: 'lightweight',
      done: candidates.length,
      total: candidates.length,
      success: generated,
      failed,
      currentLabel: null,
      error: failed > 0 ? `压缩完成�?{failed} 张失败` : undefined,
    },
  });
  dispatch({ type: 'FINISH_GLOBAL_TASK', taskId: task.id, status: failed > 0 ? 'failed' : 'done', stopReason: failed > 0 ? 'failed' : 'completed' });
}

async function runStep3Task(
  task: GlobalTask,
  stateRef: React.MutableRefObject<AppState>,
  dispatch: Dispatch,
  signal: AbortSignal,
) {
  const project = stateRef.current.projects.find((item) => item.id === task.projectId);
  const chapter = project?.chapters.find((item) => item.id === task.chapterId);
  if (!project || !chapter) throw new Error('找不到当前 Step3 章节。');
  if (task.step3Mode === 'lightweight-assets') {
    await runLightweightStep3Task(task, project, dispatch, signal);
    return;
  }
  if (!chapter.analysis) throw new Error('请先完成 Step1 分析，再生成图片资产。');

  const useVolcVirtualHumans = project.step3Settings?.useVolcVirtualHumans ?? false;
  const imageRefAssetLibrary = useVolcVirtualHumans
    ? project.assetLibrary
    : project.assetLibrary.filter((asset) => !isOfficialVirtualHumanAsset(asset));
  const allImageRefs = buildAllImageRefs(chapter.analysis, chapter.storyboards, imageRefAssetLibrary);
  const allRefs = partitionImageRefs(allImageRefs);
  const items = buildAssetItems({
    previousItems: {},
    allImageRefs,
    assetLibrary: project.assetLibrary,
    styleConfig: chapter.analysis.styleConfig,
    analysis: chapter.analysis,
    allowOfficialVirtualHumanAssets: useVolcVirtualHumans,
    officialNoFaceCharacterVisuals: useVolcVirtualHumans,
  });
  const options: BatchSelectionOptions = {
    includeOutfitVariants: task.step3IncludeOutfitVariants ?? true,
  };
  const sourceItems = collectStep3ItemsForTask(task, items, allRefs, options);
  const orderedTasks = getBatchGenerationTasks(sourceItems, options)
    .filter((item) => !isOfficialVirtualHumanSlot(item, useVolcVirtualHumans));
  let batchTotal = orderedTasks.length;
  if (orderedTasks.length === 0) throw new Error('当前没有需要生成的 Step3 图片。');

  dispatch({ type: 'START_GLOBAL_TASK', taskId: task.id, startedAt: Date.now() });
  dispatch({ type: 'SET_CHAPTER_STATUS', status: 'assets', projectId: task.projectId, chapterId: task.chapterId });
  dispatch({
    type: 'UPDATE_STEP3_TASK',
    projectId: task.projectId,
    chapterId: task.chapterId,
    updates: {
      running: true,
      sessionId: task.id,
      phase: 'generate',
      done: 0,
      total: batchTotal,
      success: 0,
      failed: 0,
      currentLabel: null,
      stopRequested: false,
      stopped: false,
      error: undefined,
      failures: [],
      startedAt: Date.now(),
    },
  });
  dispatch({ type: 'UPDATE_GLOBAL_TASK', taskId: task.id, updates: { total: batchTotal, doneCount: 0, streamStageLabel: '图片生成' } });

  const promptBuilders = createStep3PromptBuilders(chapter, useVolcVirtualHumans);
  let workingItems = { ...items };
  const workingAssetLibrary = [...project.assetLibrary];
  const queue = [...orderedTasks];
  const pendingKeys = new Set(queue.map((item) => item.key));
  const inFlight = new Set<Promise<void>>();
  const inFlightKeys = new Set<string>();
  const failures: Step3TaskFailure[] = [];
  const progress = { done: 0, success: 0, failed: 0 };
  const maxConcurrency = clampStep3Concurrency(project.step3Settings?.generateConcurrency);
  const generatedAssetIds = new Set<string>();
  const activeLabels = new Map<string, string>();

  const formatRunningLabel = (fallback?: string | null) => {
    const labels = Array.from(activeLabels.values());
    if (labels.length === 0) return fallback ?? null;
    const visibleLabels = labels.slice(0, 3).join('、');
    const extraCount = labels.length > 3 ? ` 等 ${labels.length} 项` : '';
    return `并发 ${maxConcurrency} 路 · 正在生成 ${labels.length} 项：${visibleLabels}${extraCount}`;
  };

  const pushProgress = (currentLabel?: string | null) => {
    const displayLabel = formatRunningLabel(currentLabel);
    dispatch({
      type: 'UPDATE_STEP3_TASK',
      projectId: task.projectId,
      chapterId: task.chapterId,
      updates: {
        done: progress.done,
        total: batchTotal,
        success: progress.success,
        failed: progress.failed,
        currentLabel: displayLabel,
        failures,
      },
    });
    dispatch({
      type: 'UPDATE_GLOBAL_TASK',
      taskId: task.id,
      updates: {
        doneCount: progress.done,
        errors: failures.map((failure, index) => ({ index, error: `${failure.name}�?{failure.error}` })),
        streamTextPreview: displayLabel ?? '',
        streamTextLength: displayLabel?.length ?? 0,
        streamUpdatedAt: Date.now(),
      },
    });
  };

  const dequeueNextTask = () => {
    for (let index = 0; index < queue.length; index += 1) {
      const candidate = queue[index];
      const currentCandidate = workingItems[candidate.key] ?? candidate;
      if (shouldDeferGenerationTask(currentCandidate, workingItems, pendingKeys, inFlightKeys)) continue;
      queue.splice(index, 1);
      pendingKeys.delete(candidate.key);
      return candidate;
    }
    return null;
  };

  const runTask = async (assetTask: AssetItem) => {
    if (signal.aborted) return;
    const label = `${assetTask.name} · ${getOfficialModeConceptLabel(assetTask.concept, useVolcVirtualHumans)}`;
    activeLabels.set(assetTask.key, label);
    pushProgress();

    const resolved = resolveGenerationItemForCurrentMode(
      workingItems[assetTask.key] ?? assetTask,
      workingItems,
      workingAssetLibrary,
      useVolcVirtualHumans,
    );
    if (resolved.error) {
      failures.push({
        key: assetTask.key,
        name: assetTask.name,
        concept: assetTask.concept,
        phase: 'generate',
        retryMode: 'generate_only',
        error: resolved.error,
      });
      progress.done += 1;
      progress.failed += 1;
      activeLabels.delete(assetTask.key);
      pushProgress(label);
      return;
    }

    const finalItem = resolved.item;
    const prompt = promptBuilders.getEffectivePrompt(finalItem);
    try {
      const imageResult = await generateStep3ImageWithRetry({
        state: stateRef.current,
        item: finalItem,
        prompt,
        sourceAssets: workingAssetLibrary,
        signal,
        onStatus: (message) => {
          activeLabels.set(assetTask.key, `${finalItem.name} · ${message}`);
          pushProgress();
        },
        onRetry: (message, error, attempt, maxRetries) => {
          const detail = `${finalItem.name} · ${getErrorMessage(error)}`;
          dispatch({
            type: 'UPDATE_GLOBAL_TASK',
            taskId: task.id,
            updates: {
              streamStageLabel: `Step3 临时失败自动重试 ${attempt}/${maxRetries}`,
              streamTextPreview: `${finalItem.name} · ${message}`,
              streamTextLength: `${finalItem.name} · ${message}`.length,
              streamUpdatedAt: Date.now(),
            },
          });
          dispatch({
            type: 'APPEND_GLOBAL_TASK_EVENT',
            taskId: task.id,
            event: {
              level: 'retry',
              label: `Step3 临时失败自动重试 ${attempt}/${maxRetries}`,
              detail,
              phase: 'step3',
            },
          });
        },
      });
      const blobKey = await saveBlob(imageResult.blob);
      const assetDescription = promptBuilders.buildDescription(finalItem);
      const now = Date.now();
      const asset: Asset = {
        id: genId(),
        name: finalItem.name,
        type: finalItem.type,
        concept: finalItem.concept,
        description: assetDescription,
        identityKey: finalItem.identityKey,
        variantKey: finalItem.variantKey,
        outfitSeq: finalItem.outfitSeq,
        optimizedPrompt: prompt,
        generationMode: finalItem.generationMode,
        baseAssetId: finalItem.baseAssetId,
        blobKey,
        aspectRatio: finalItem.aspectRatio,
        imageSize: imageResult.imageSize,
        ...getGeneratedAssetExternalFields(imageResult),
        usedInStoryboards: [finalItem.key],
        createdAt: now,
        updatedAt: now,
      };
      dispatch({ type: 'ADD_ASSET', projectId: task.projectId, asset });
      generatedAssetIds.add(asset.id);
      workingAssetLibrary.push(asset);
      workingItems = {
        ...workingItems,
        [assetTask.key]: { ...finalItem, optimizedPrompt: prompt, asset, isProcessing: false },
      };
      syncPrimaryImageRefs(dispatch, task.projectId, chapter, finalItem, asset.id);
      if (finalItem.type === 'character' && (finalItem.concept === 'portrait_closeup' || finalItem.concept === 'portrait_outfit')) {
        workingItems = linkGeneratedCharacterBase(
          workingItems,
          finalItem.name,
          asset.id,
          finalItem.concept,
          finalItem.variantKey,
        );
      }
      progress.success += 1;
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return;
      failures.push({
        key: assetTask.key,
        name: assetTask.name,
        concept: assetTask.concept,
        phase: 'generate',
        retryMode: 'generate_only',
        error: getErrorMessage(error),
      });
      progress.failed += 1;
    } finally {
      progress.done += 1;
      activeLabels.delete(assetTask.key);
      pushProgress(label);
    }
  };

  const runQueuedGenerationTasks = async () => {
    while ((queue.length > 0 || inFlight.size > 0) && !signal.aborted) {
      while (!signal.aborted && inFlight.size < maxConcurrency) {
        const nextTask = dequeueNextTask();
        if (!nextTask) break;
        inFlightKeys.add(nextTask.key);
        const promise = runTask(nextTask).finally(() => {
          inFlightKeys.delete(nextTask.key);
          inFlight.delete(promise);
        });
        inFlight.add(promise);
      }
      if (inFlight.size === 0) break;
      await Promise.race(inFlight);
    }
    if (inFlight.size > 0) await Promise.allSettled(Array.from(inFlight));
  };

  const collectRemainingGenerationTasks = () => {
    const latestProject = stateRef.current.projects.find((item) => item.id === task.projectId);
    const latestChapter = latestProject?.chapters.find((item) => item.id === task.chapterId);
    if (!latestProject || !latestChapter?.analysis) return [];
    const latestAssetLibrary = mergeAssetLibrarySnapshots(latestProject.assetLibrary, workingAssetLibrary);
    const latestImageRefAssetLibrary = useVolcVirtualHumans
      ? latestAssetLibrary
      : latestAssetLibrary.filter((asset) => !isOfficialVirtualHumanAsset(asset));
    const latestAllImageRefs = buildAllImageRefs(latestChapter.analysis, latestChapter.storyboards, latestImageRefAssetLibrary);
    const latestAllRefs = partitionImageRefs(latestAllImageRefs);
    const latestItems = buildAssetItems({
      previousItems: workingItems,
      allImageRefs: latestAllImageRefs,
      assetLibrary: latestAssetLibrary,
      styleConfig: latestChapter.analysis.styleConfig,
      analysis: latestChapter.analysis,
      allowOfficialVirtualHumanAssets: useVolcVirtualHumans,
      officialNoFaceCharacterVisuals: useVolcVirtualHumans,
    });
    workingItems = { ...workingItems, ...latestItems };
    const latestSourceItems = collectStep3ItemsForTask(task, latestItems, latestAllRefs, options);
    return getBatchGenerationTasks(latestSourceItems, options)
      .filter((item) => !isOfficialVirtualHumanSlot(item, useVolcVirtualHumans));
  };

  await runQueuedGenerationTasks();

  for (let pass = 0; pass < 5 && !signal.aborted && failures.length === 0; pass += 1) {
    const additionalTasks = collectRemainingGenerationTasks()
      .filter((item) => !pendingKeys.has(item.key) && !inFlightKeys.has(item.key));
    if (additionalTasks.length === 0) break;
    batchTotal += additionalTasks.length;
    additionalTasks.forEach((item) => {
      queue.push(item);
      pendingKeys.add(item.key);
    });
    const label = `继续补齐剩余图片 ${additionalTasks.length} 项`;
    dispatch({
      type: 'UPDATE_STEP3_TASK',
      projectId: task.projectId,
      chapterId: task.chapterId,
      updates: { total: batchTotal, currentLabel: label },
    });
    dispatch({
      type: 'UPDATE_GLOBAL_TASK',
      taskId: task.id,
      updates: {
        total: batchTotal,
        streamTextPreview: label,
        streamTextLength: label.length,
        streamUpdatedAt: Date.now(),
      },
    });
    await runQueuedGenerationTasks();
  }

  const stopped = signal.aborted;
  dispatch({
    type: 'END_STEP3_TASK',
    projectId: task.projectId,
    chapterId: task.chapterId,
    updates: {
      phase: 'generate',
      done: progress.done,
      total: batchTotal,
      success: progress.success,
      failed: progress.failed,
      currentLabel: null,
      stopped,
      error: stopped ? '已停止' : progress.failed > 0 ? `${progress.failed} 项生成失败` : undefined,
      failures,
    },
  });

  if (!stopped && progress.failed === 0) {
    const latestProject = stateRef.current.projects.find((item) => item.id === task.projectId);
    const lightweightProject = latestProject ?? project;
    if (lightweightProject) {
      await runLightweightStep3Task(
        { ...task, id: task.id, step3Mode: 'lightweight-assets', total: progress.done },
        {
          ...lightweightProject,
          assetLibrary: mergeAssetLibrarySnapshots(lightweightProject.assetLibrary, workingAssetLibrary),
        },
        dispatch,
        signal,
        generatedAssetIds,
      );
      return;
    }
  }

  dispatch({
    type: 'FINISH_GLOBAL_TASK',
    taskId: task.id,
    status: stopped ? 'cancelled' : progress.failed > 0 ? 'failed' : 'done',
    stopReason: stopped ? 'cancelled' : progress.failed > 0 ? 'failed' : 'completed',
  });
}

export function StepGlobalTaskProvider({ children }: { children: ReactNode }) {
  const { state, dispatch } = useCurrentProject();
  const stateRef = useRef(state);
  const runningTaskIdsRef = useRef<Set<string>>(new Set());
  const taskControllersRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const runTask = useCallback((task: GlobalTask) => {
    if (runningTaskIdsRef.current.has(task.id)) return;
    const blockReason = getGlobalTaskPermanentBlockReason(stateRef.current, task);
    if (blockReason) {
      failQueuedGlobalTask(dispatch, task, blockReason);
      return;
    }
    if (!canStartGlobalTask(stateRef.current, task)) return;
    runningTaskIdsRef.current.add(task.id);
    const controller = new AbortController();
    taskControllersRef.current.set(task.id, controller);

    (async () => {
      try {
        if (task.type === 'step1-analysis') {
          await runStep1TaskWithRetry(task, stateRef, dispatch, controller.signal);
        } else if (task.type === 'step3-batch') {
          await runStep3Task(task, stateRef, dispatch, controller.signal);
        }
      } catch (error) {
        const latest = stateRef.current.globalTasks.find((item) => item.id === task.id);
        if (controller.signal.aborted || latest?.status === 'cancelled' || isRequestCancelledError(error)) {
          if (task.type === 'step1-analysis') {
            dispatch({ type: 'END_STEP1_TASK', projectId: task.projectId, chapterId: task.chapterId });
          }
          if (task.type === 'step3-batch') {
            dispatch({
              type: 'END_STEP3_TASK',
              projectId: task.projectId,
              chapterId: task.chapterId,
              updates: { stopped: true, error: '已停止' },
            });
          }
          dispatch({ type: 'FINISH_GLOBAL_TASK', taskId: task.id, status: 'cancelled', stopReason: 'cancelled' });
          return;
        }
        const message = getErrorMessage(error);
        if (task.type === 'step1-analysis') {
          failStep1Task(dispatch, task, message);
        } else if (task.type === 'step3-batch') {
          dispatch({
            type: 'END_STEP3_TASK',
            projectId: task.projectId,
            chapterId: task.chapterId,
            updates: { error: message, failures: [{ key: 'global', name: 'Step3', phase: 'generate', retryMode: 'generate_only', error: message }] },
          });
          dispatch({ type: 'UPDATE_GLOBAL_TASK', taskId: task.id, updates: { errors: [{ index: 0, error: message }], streamStageLabel: '已失败' } });
          dispatch({ type: 'FINISH_GLOBAL_TASK', taskId: task.id, status: 'failed', stopReason: 'failed' });
        }
      } finally {
        runningTaskIdsRef.current.delete(task.id);
        taskControllersRef.current.delete(task.id);
      }
    })();
  }, [dispatch]);

  useEffect(() => {
    for (const task of state.globalTasks) {
      if ((task.type === 'step1-analysis' || task.type === 'step3-batch') && task.status === 'queued') {
        const blockReason = getGlobalTaskPermanentBlockReason(stateRef.current, task);
        if (blockReason) {
          failQueuedGlobalTask(dispatch, task, blockReason);
        } else if (canStartGlobalTask(stateRef.current, task)) {
          runTask(task);
        }
      }
      if (task.status === 'cancelled') {
        taskControllersRef.current.get(task.id)?.abort();
      }
    }
  }, [dispatch, runTask, state.globalTasks]);

  return <>{children}</>;
}
