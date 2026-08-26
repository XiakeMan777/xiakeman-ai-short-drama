import type {
  Choreography,
  ChoreographyTimeSegment,
  AssetSource,
  ImageReference,
  ImageConcept,
  SceneBlueprint,
  SpatialBlockingSnapshot,
  StoryboardBoardMode,
  StoryboardBoardPlan,
  StoryboardBoardPlanPanel,
  StoryboardContinuitySnapshot,
  StoryboardState,
} from '@/types';
import { normalizeFrameRatio } from '@/lib/frameRatio';
import { resolveStoryboardVideoDuration } from '@/lib/storyboardDuration';
import { isTransientApiError } from '@/lib/transientApiError';
import {
  buildStoryboardCameraSegmentContract,
  normalizeStoryboardCameraSegmentCount,
} from '@/lib/storyboardCameraSegments';
import { buildStoryboardReferenceReadingContract } from './storyboardReferenceReadingContract';
import {
  buildSeedanceVoiceReferencePromptBlock,
  type ResolvedStoryboardVoiceReference,
} from '@/lib/characterVoiceReferences';
import {
  formatStoryboardPanelLabel,
  getStoryboardBoardExpectedPanelCount,
  isShotPlanBoardMode,
  isSmartShotPlanBoardMode,
} from './storyboardBoardMode';

export type SeedanceFinalVideoPromptStatus = 'idle' | 'generating' | 'done' | 'failed';

export const SEEDANCE_FINAL_VIDEO_PROMPT_TIMEOUT_MS = 300_000;
export const SEEDANCE_FINAL_VIDEO_PROMPT_NO_OUTPUT_TIMEOUT_MS = 300_000;
export const SEEDANCE_FINAL_VIDEO_PROMPT_STALE_MS = 330_000;
export const SEEDANCE_FINAL_VIDEO_PROMPT_TIMEOUT_MESSAGE = 'Seedance 最终视频词生成超时，请重新点击刷新。';
export const SEEDANCE_FINAL_VIDEO_PROMPT_NO_OUTPUT_TIMEOUT_MESSAGE = 'Seedance 最终视频词流式生成已超过 300 秒没有模型输出或思考活动，请检查模型连接后重试。';
const DEFAULT_SEEDANCE_IMAGE_REFERENCE_LIMIT = 9;
const SEEDANCE_DIRECTOR_BOARD_REF_ID = '参考图片1';
const SEEDANCE_FINAL_VIDEO_PROMPT_RETRY_DELAYS_MS = [1200, 2800];

function normalizeSeedanceImageReferenceLimit(value?: number) {
  if (!Number.isFinite(value)) return DEFAULT_SEEDANCE_IMAGE_REFERENCE_LIMIT;
  return Math.max(1, Math.min(30, Math.floor(value!)));
}

export interface SeedanceFinalPromptReference {
  refId: string;
  originalRefId?: string;
  type: ImageReference['type'];
  name: string;
  assetId?: string;
  trackingId?: string;
  variantKey?: string;
  outfitSeq?: number;
  concept?: ImageConcept;
  assetSource?: AssetSource;
  isNoFaceCharacterVisual?: boolean;
}

export interface SeedanceFinalVideoPromptState {
  status: SeedanceFinalVideoPromptStatus;
  prompt: string;
  error?: string;
  warning?: string;
  sourceSnapshot: string;
  updatedAt?: number;
  isFresh: boolean;
  isUsable: boolean;
}

export interface BuildSeedanceFinalPromptInput {
  storyboard: StoryboardState;
  boardPlan?: StoryboardBoardPlan;
  references: readonly SeedanceFinalPromptReference[];
  voiceReferences?: readonly ResolvedStoryboardVoiceReference[];
  mode: StoryboardBoardMode;
  frameRatio?: string;
  projectVisualStyle?: string;
  cameraSegmentCount?: number;
  repairHint?: string;
  /** 当前提交模型的图片参考上限；Seedance 2.5 为 30，其余默认 9。 */
  maxImageReferences?: number;
}

export interface SeedanceFinalVideoPromptValidationContext {
  mode?: StoryboardBoardMode;
  references?: readonly SeedanceFinalPromptReference[];
  expectedPanelCount?: number;
  maxImageReferences?: number;
}

type SeedanceFinalVideoPromptValidationSeverity = 'error' | 'warning';

interface SeedanceFinalVideoPromptValidationResult {
  ok: boolean;
  reason?: string;
  severity?: SeedanceFinalVideoPromptValidationSeverity;
  repair?: boolean;
}

export interface SeedanceFinalVideoPromptRequestOptions {
  temperature: number;
  maxTokens: number;
  signal: AbortSignal;
  repairHint?: string;
}

export type SeedanceFinalVideoPromptRequester = (
  requestPayload: string,
  options: SeedanceFinalVideoPromptRequestOptions,
) => Promise<string>;

export interface SeedanceFinalVideoPromptStreamCallbacks {
  onChunk: (delta: string) => void;
  onActivity?: () => void;
  onReplace?: (fullText: string) => void;
}

export type SeedanceFinalVideoPromptStreamRequester = (
  requestPayload: string,
  options: SeedanceFinalVideoPromptRequestOptions,
  callbacks: SeedanceFinalVideoPromptStreamCallbacks,
) => Promise<string>;

export interface SeedanceFinalVideoPromptProgressCallbacks {
  onAttemptStart?: (repairHint?: string) => void;
  onProgress?: (fullText: string, delta: string, repairHint?: string) => void;
}

export async function withSeedanceFinalVideoPromptTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs = SEEDANCE_FINAL_VIDEO_PROMPT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
      reject(new Error(SEEDANCE_FINAL_VIDEO_PROMPT_TIMEOUT_MESSAGE));
    }, timeoutMs);

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    try {
      request(controller.signal).then(
        (value) => settle(() => resolve(value)),
        (error) => settle(() => reject(error)),
      );
    } catch (error) {
      settle(() => reject(error));
    }
  });
}

export async function withSeedanceFinalVideoPromptNoOutputTimeout<T>(
  request: (signal: AbortSignal, markOutput: () => void) => Promise<T>,
  timeoutMs = SEEDANCE_FINAL_VIDEO_PROMPT_NO_OUTPUT_TIMEOUT_MS,
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    };

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const onExternalAbort = () => {
      controller.abort();
      settle(() => reject(new DOMException('The user aborted a request.', 'AbortError')));
    };

    if (externalSignal?.aborted) {
      onExternalAbort();
      return;
    }
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    const resetTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        if (settled) return;
        controller.abort();
        settle(() => reject(new Error(SEEDANCE_FINAL_VIDEO_PROMPT_NO_OUTPUT_TIMEOUT_MESSAGE)));
      }, timeoutMs);
    };

    resetTimer();

    try {
      request(controller.signal, resetTimer).then(
        (value) => settle(() => resolve(value)),
        (error) => settle(() => reject(error)),
      );
    } catch (error) {
      settle(() => reject(error));
    }
  });
}

export function isSeedanceFinalVideoPromptGeneratingStale(
  storyboard: StoryboardState,
  now = Date.now(),
): boolean {
  if (storyboard.seedanceFinalVideoPromptStatus !== 'generating') return false;
  const updatedAt = storyboard.seedanceFinalVideoPromptUpdatedAt;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) return true;
  return now - updatedAt > SEEDANCE_FINAL_VIDEO_PROMPT_STALE_MS;
}

function compactText(value: string | undefined, maxLength = 180): string {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function pickSpatialBlocking(value: SpatialBlockingSnapshot | undefined) {
  if (!value) return undefined;
  return {
    ...value,
    characters: Array.isArray(value.characters) ? value.characters.slice() : value.characters,
    props: Array.isArray(value.props) ? value.props.slice() : value.props,
  };
}

function pickContinuity(value: StoryboardContinuitySnapshot | undefined) {
  if (!value) return undefined;
  return {
    itemTracker: value.itemTracker,
    lastFrameInfo: value.lastFrameInfo,
    spatialBlocking: pickSpatialBlocking(value.spatialBlocking),
    summary: value.summary,
    sourceStoryboardIndex: value.sourceStoryboardIndex,
    generatedAt: value.generatedAt,
  };
}

function pickChoreographySegment(segment: ChoreographyTimeSegment) {
  return {
    timeRange: segment.timeRange,
    segmentType: segment.segmentType,
    rhythm: segment.rhythm,
    actionFlow: segment.actionFlow,
    actions: segment.actions.map((action) => ({
      character: action.character,
      position: action.position,
      action: action.action,
      dialogue: action.dialogue,
      emotion: action.emotion,
      microAction: action.microAction,
      facing: action.facing,
      posture: action.posture,
      heldProps: action.heldProps,
    })),
    camera: segment.camera,
    vfx: segment.vfx,
    impact: segment.impact,
    sound: segment.sound,
    bgm: segment.bgm,
    dialoguePerformance: segment.dialoguePerformance,
  };
}

function pickChoreography(choreography: Choreography | null | undefined) {
  if (!choreography) return null;
  return {
    sceneType: choreography.sceneType,
    combatType: choreography.combatType,
    overallRhythm: choreography.overallRhythm,
    cameraOverview: choreography.cameraOverview,
    lightNotes: choreography.lightNotes,
    colorGrading: choreography.colorGrading,
    sceneAnchor: choreography.sceneAnchor,
    cameraAxis: choreography.cameraAxis,
    transitionType: choreography.transitionType,
    emotionArc: choreography.emotionArc,
    startBlocking: pickSpatialBlocking(choreography.startBlocking),
    endBlocking: pickSpatialBlocking(choreography.endBlocking),
    timeSegments: choreography.timeSegments.map(pickChoreographySegment),
  };
}

function pickPromptTimeSegments(prompt: StoryboardState['prompt']) {
  if (!prompt?.timeSegments?.length) return [];
  return prompt.timeSegments.map((segment) => ({
    timeRange: segment.timeRange,
    cameraShot: segment.cameraShot,
    actionDesc: segment.actionDesc,
    soundEffect: segment.soundEffect,
  }));
}

function pickBoardPlanPanel(panel: StoryboardBoardPlanPanel) {
  return {
    index: panel.index,
    timeRange: panel.timeRange,
    beat: panel.beat,
    shotType: panel.shotType,
    cameraAngle: panel.cameraAngle,
    primarySubject: panel.primarySubject,
    secondarySubjects: panel.secondarySubjects,
    composition: panel.composition,
    staticMoment: panel.staticMoment,
    blocking: panel.blocking,
    motion: panel.motion,
    cameraTask: panel.cameraTask,
    mustShow: panel.mustShow,
    background: panel.background,
    continuity: panel.continuity,
    worldAnchor: panel.worldAnchor,
    dialogue: panel.dialogue,
    sfx: panel.sfx,
    audio: panel.audio,
    transition: panel.transition,
    dialoguePerformance: panel.dialoguePerformance,
    continuityIn: panel.continuityIn,
    continuityOut: panel.continuityOut,
    directorNote: panel.directorNote,
  };
}

function pickBoardPlan(plan: StoryboardBoardPlan | undefined) {
  if (!plan) return undefined;
  return {
    mode: plan.mode,
    directorBrief: plan.directorBrief,
    boardGoal: plan.boardGoal,
    sceneAnchor: plan.sceneAnchor,
    styleAnchor: plan.styleAnchor,
    transitionBridge: plan.transitionBridge,
    directorContract: plan.directorContract,
    worldLock: plan.worldLock,
    blockingContinuity: plan.blockingContinuity,
    cameraPlan: plan.cameraPlan,
    consistencyRules: plan.consistencyRules,
    characterLocks: plan.characterLocks.map((lock) => ({
      refId: lock.refId,
      name: lock.name,
      role: lock.role,
      mustKeep: lock.mustKeep,
    })),
    propLocks: plan.propLocks,
    referencePriority: plan.referencePriority,
    layoutRules: plan.layoutRules,
    negativeRules: plan.negativeRules,
    panels: plan.panels.map(pickBoardPlanPanel),
  };
}

function hasOutfitReference(references: readonly SeedanceFinalPromptReference[]) {
  return references.some((reference) =>
    reference.type === 'character'
    && (
      reference.concept === 'landscape_outfit_turnaround'
      || reference.concept === 'portrait_outfit'
      || !!reference.variantKey
      || typeof reference.outfitSeq === 'number'
    ),
  );
}

function hasNoFaceReference(references: readonly SeedanceFinalPromptReference[]) {
  return references.some((reference) => reference.type === 'character' && reference.isNoFaceCharacterVisual);
}

function hasOfficialVirtualHumanReference(references: readonly SeedanceFinalPromptReference[]) {
  return references.some((reference) => reference.type === 'character' && reference.assetSource === 'volc_virtual_human');
}

function joinCompactParts(parts: Array<string | undefined>, maxLength = 260): string {
  return compactText(parts.filter((part): part is string => !!part?.trim()).join(' / '), maxLength);
}

function buildProjectVisualStyleAnchor(input: BuildSeedanceFinalPromptInput): string {
  return joinCompactParts([
    input.projectVisualStyle,
    input.boardPlan?.styleAnchor,
    input.boardPlan?.directorBrief?.styleStatement,
  ], 360) || 'the current project visual style from Step0/Step2/Step3 and the Step4 board plan';
}

function buildSeedancePromptReferenceLayout(
  references: readonly SeedanceFinalPromptReference[],
  maxImageReferences = DEFAULT_SEEDANCE_IMAGE_REFERENCE_LIMIT,
) {
  const visualReferenceLimit = Math.max(0, normalizeSeedanceImageReferenceLimit(maxImageReferences) - 1);
  const visibleReferences = references
    .slice(0, visualReferenceLimit)
    .map((reference, index) => ({
      ...reference,
      originalRefId: reference.originalRefId ?? reference.refId,
      refId: `参考图片${index + 2}`,
    }));
  const omittedReferences = references
    .slice(visualReferenceLimit)
    .map((reference) => ({
      refId: reference.refId,
      type: reference.type,
      name: reference.name,
      assetId: reference.assetId,
      trackingId: reference.trackingId,
      variantKey: reference.variantKey,
      outfitSeq: reference.outfitSeq,
      concept: reference.concept,
    }));

  return {
    directorBoardRefId: SEEDANCE_DIRECTOR_BOARD_REF_ID,
    references: visibleReferences,
    omittedReferences,
  };
}

function buildReferenceExecutionRole(reference: SeedanceFinalPromptReference, projectVisualStyle: string): string {
  if (reference.type === 'scene') {
    return 'scene execution lock: preserve spatial layout, material, lighting direction, entrance/exit, action zone, and camera axis; never inherit photographic style from the reference image.';
  }
  if (reference.type === 'prop') {
    return 'prop execution lock: preserve shape, material, state, scale, holder relation, and planned use only; never inherit photographic style from the reference image.';
  }
  if (reference.type === 'character' && reference.isNoFaceCharacterVisual) {
    return 'no-face outfit/body execution lock: preserve clothing version, body proportion, material, silhouette, accessories, and equipment only; never use it for face identity or photographic render style.';
  }
  if (reference.type === 'character' && (
    reference.concept === 'landscape_outfit_turnaround'
    || reference.concept === 'portrait_outfit'
    || !!reference.variantKey
    || typeof reference.outfitSeq === 'number'
  )) {
    const outfitLabel = reference.variantKey ?? (typeof reference.outfitSeq === 'number' ? `outfit-${reference.outfitSeq}` : 'selected outfit');
    return `character outfit execution lock: keep the same character identity and preserve ${outfitLabel}; never drift back to base/default outfit or preserve the source image as a photographic render style.`;
  }
  if (reference.type === 'character' && reference.assetSource === 'volc_virtual_human') {
    return 'official virtual human identity lock: use official portrait for face/identity only; outfit/body details must come from the matching visual outfit/body reference when present; never carry over photographic render style.';
  }
  if (reference.type === 'character') {
    return `character identity execution lock: preserve face identity, body proportion, hairstyle, posture, outfit, props, and performance state from this Step3 character reference, but render it in the current project visual style (${projectVisualStyle}) instead of copying the source image render style.`;
  }
  return `reference execution lock: preserve only the visual role described by this reference reading contract and render it in the current project visual style (${projectVisualStyle}) instead of copying the source image render style.`;
}

function buildReferenceRoleCards(
  references: readonly SeedanceFinalPromptReference[],
  directorBoardRefId: string,
  projectVisualStyle: string,
) {
  const referenceCards = references.map((reference) => {
    const readingContract = buildStoryboardReferenceReadingContract({
      refId: reference.refId,
      type: reference.type,
      name: reference.name,
      concept: reference.concept,
      assetSource: reference.assetSource,
      variantKey: reference.variantKey,
      outfitSeq: reference.outfitSeq,
      isNoFaceCharacterVisual: reference.isNoFaceCharacterVisual,
    });

    return {
      refId: reference.refId,
      type: reference.type,
      name: reference.name,
      concept: reference.concept,
      variantKey: reference.variantKey,
      outfitSeq: reference.outfitSeq,
      isNoFaceCharacterVisual: reference.isNoFaceCharacterVisual,
      executionRole: buildReferenceExecutionRole(reference, projectVisualStyle),
      readFor: readingContract.readFor,
      doNotUseFor: readingContract.doNotUseFor,
    };
  });

  return [
    {
      refId: directorBoardRefId,
      type: 'director-board',
      name: 'Step4 storyboard director board',
      executionRole: 'director board execution lock: read shot order, START FRAME, S-panel progression, blocking, camera rhythm, transition, and END BEAT; never reproduce board borders, labels, arrows, panel numbers, or footer text.',
      readFor: 'motion, blocking, camera rhythm, START FRAME, S-panel progression, transition, END BEAT, and final handoff.',
      doNotUseFor: 'storyboard grid, split-screen layout, panel labels, arrows, footer bars, production notes, or visible instruction text.',
    },
    ...referenceCards,
  ];
}

function buildPanelExecutionCards(plan: StoryboardBoardPlan | undefined) {
  return (plan?.panels ?? []).map((panel) => ({
    panel: panel.index,
    timeRange: panel.timeRange,
    beat: compactText(panel.beat, 180),
    action: joinCompactParts([
      panel.primarySubject,
      panel.secondarySubjects?.length ? `secondary: ${panel.secondarySubjects.join(', ')}` : undefined,
      panel.staticMoment,
      panel.blocking,
      panel.motion,
      panel.mustShow?.length ? `must show: ${panel.mustShow.join(', ')}` : undefined,
      panel.continuityIn ? `进入状态: ${panel.continuityIn}` : undefined,
      panel.continuityOut ? `结束状态: ${panel.continuityOut}` : undefined,
      panel.worldAnchor,
    ], 420),
    camera: joinCompactParts([
      panel.shotType,
      panel.cameraAngle,
      panel.composition,
      panel.cameraTask,
      panel.transition,
    ], 280),
    dialogue: compactText(panel.dialogue, 180) || undefined,
    sound: joinCompactParts([
      panel.sfx,
      panel.audio,
      panel.dialoguePerformance,
    ], 260) || undefined,
    openingContinuity: joinCompactParts([
      panel.continuityIn,
      panel.continuity,
    ], 220),
    endingContinuity: joinCompactParts([
      panel.continuityOut,
      panel.directorNote,
    ], 260),
  }));
}

function getPrimaryStoryboardCharacter(storyboard: StoryboardState): string {
  return storyboard.storyboard.characters?.find((name) => !!name?.trim())?.trim()
    || 'the first listed storyboard character';
}

function buildProtagonistFocusRules(input: BuildSeedanceFinalPromptInput) {
  const primaryCharacter = getPrimaryStoryboardCharacter(input.storyboard);
  const shotPlanRule = isShotPlanBoardMode(input.mode)
    ? 'For shot-plan storyboard mode, keep the protagonist visually dominant through the emotional center beat; antagonist, weapon, UI, and prop inserts may create pressure but must not steal the middle of the shot.'
    : 'Keep the protagonist visually readable at every major beat; supporting subjects and inserts must not steal the middle of the shot or displace the protagonist reaction.';

  return [
    `Default protagonist priority: treat ${primaryCharacter} as the primary visual subject unless boardPlan explicitly assigns a different protagonist.`,
    shotPlanRule,
    'When the protagonist speaks, resists, takes pain, notices a clue, or makes the central decision, show their face/body reaction in the same beat instead of cutting only to antagonist or object close-ups.',
    'Use inserts as motivated accents, then return to protagonist context before the next dialogue or handoff beat.',
  ];
}

function buildEndBeatHandoffRules(input: BuildSeedanceFinalPromptInput) {
  const primaryCharacter = getPrimaryStoryboardCharacter(input.storyboard);

  return [
    `END BEAT must be a continuity handoff frame centered on ${primaryCharacter}'s readable state, not an isolated prop, accessory, body detail, weapon, UI, or texture close-up unless boardPlan explicitly names that isolated object as the next-shot anchor.`,
    'In the final 0.8-1.0 seconds, preserve protagonist + pressure source + key continuity object/light in one readable composition whenever those elements define the next shot.',
    'If the story requires a small costume detail, weapon detail, handheld device, UI, clue object, or other insert near the ending, keep it as a brief motivated insert and return to the wider character/space handoff before final hold.',
    'Final hold must keep camera axis, left/right pressure relation, character position, and next-shot action direction readable.',
  ];
}

function buildVoiceIdentityRules() {
  return [
    'Voice identity must follow character identity from Step2/Step3 references and the current script: female-coded characters must keep clearly female voice and visual read; male-coded characters must keep clearly male voice; do not let short hair, armor, cold temperament, or combat posture flip gender read.',
    'Female protagonist dialogue should sound like a young adult female performance when the story identifies the character as female: natural, emotionally specific, controlled under pressure, not male, not neutral-low male, not announcer-like, and not AI narration.',
    'Dialogue must stay colloquial and actor-performed; preserve breathing, pain restraint, hesitation, and subtext without generating subtitles.',
  ];
}

function buildVoiceReferenceRules(input: BuildSeedanceFinalPromptInput) {
  const voiceReferenceBlock = buildSeedanceVoiceReferencePromptBlock(input.voiceReferences ?? []);
  if (!voiceReferenceBlock) return [];
  return [
    voiceReferenceBlock,
    'Reference numbering is scoped by media type: image references use @图片1..N, video references use @视频1..N, and audio references use @音频1..N. Never continue video/audio numbering from the image count or from mixed upload order.',
    'Use the voice references only for voice identity, mouth timing, speaking speed, breath, pause rhythm, emotional delivery, and audio-visual sync.',
    'Do not read character appearance, costume, lighting, composition, or black-screen video content from voice reference media.',
    'Keep the voice reference slot order exactly aligned with the submitted media order; do not invent extra voice references beyond the listed slots.',
  ];
}

function buildSeedanceVideoExecutionContract(input: BuildSeedanceFinalPromptInput, directorBoardRefId: string) {
  const maxImageReferences = normalizeSeedanceImageReferenceLimit(input.maxImageReferences);
  const plan = input.boardPlan;
  const directorContract = plan?.directorContract;
  const blockingContinuity = plan?.blockingContinuity;
  const transitionBridge = plan?.transitionBridge;
  const firstPanel = plan?.panels[0];
  const lastPanel = plan?.panels[plan.panels.length - 1];
  const expectedPanelCount = getStoryboardBoardExpectedPanelCount(
    input.mode,
    input.storyboard.storyboard.duration,
    plan?.panels.length,
  );
  const finalPanelLabel = formatStoryboardPanelLabel(expectedPanelCount);
  const projectVisualStyle = buildProjectVisualStyleAnchor(input);

  return {
    title: 'Storyboard-to-video Seedance execution contract',
    purpose: 'Convert Step4 storyboard mode into one continuous Seedance video prompt. The final text must be executable video direction, not a storyboard analysis or reference summary.',
    directorBoardRefId,
    imageReferenceNumbering: {
      hardLimit: maxImageReferences,
      directorBoardRefId,
      visualReferenceRange: `参考图片2..参考图片${maxImageReferences}`,
      rule: `Image references must stay within @图片1..@图片${maxImageReferences}. Never write @图片${maxImageReferences + 1} or higher.`,
    },
    projectVisualStyle,
    primaryStoryboardCharacter: getPrimaryStoryboardCharacter(input.storyboard),
    requiredExecutionFields: [
      'Opening frame: explicitly write the first visible frame from START FRAME, blockingContinuity.currentStart, transitionBridge.firstFrameInstruction, and panel 1; do not invent a new establishing frame.',
      'Action timeline: convert S panels into continuous video motion with visible beat progression, character action, prop state, and emotion shift.',
      `Door/entry mechanism: if any door, gate, entrance, threshold, broken glass boundary, hatch, elevator, wall breach, or inside/outside boundary exists, write the entrance state chain in the final prompt: state before S01, which S panels visibly change it, which side crosses the threshold, and the ${finalPanelLabel}/end state.`,
      'Critical trigger contact: if a beat causes a later result through kick, hit, smash, pull, press, plug, insert, shove, throw, catch, shoot, ignite, electrify, bite, open, close, break, or breach, the final prompt must include a visible contact/action frame before the result frame.',
      'Camera movement: write executable camera height, axis, lens relation, push/pull/pan/hold, and transition motivation; do not leave camera as storyboard metadata.',
      'Reference execution: state how each Step3 reference is read in the final video, keeping identity/outfit/scene/prop roles separate by refId.',
      'Sound and dialogue: keep full dialogue, diegetic sound, BGM, UI/countdown audio, and performance delivery synchronized with the visual beats.',
      'Ending frame: explicitly preserve END BEAT, blockingContinuity.currentEnd, final hold, and next-shot handoff; do not extend into the next storyboard event.',
      'Protagonist priority: apply protagonistFocusRules so the central character remains visually dominant during the emotional center; inserts must return to protagonist reaction.',
      'Final handoff framing: apply endBeatHandoffRules so END BEAT remains a readable character/space handoff rather than an isolated prop close-up.',
      'Voice identity: apply voiceIdentityRules so dialogue preserves gender/age read and natural spoken performance without subtitles.',
      'Character voice references: when voiceReferenceRules is non-empty, apply the listed slots only to the matching speaking characters and keep audio-visual sync stable.',
    ],
    continuityTargets: {
      startFrame: joinCompactParts([
        directorContract?.startFrameContract,
        transitionBridge?.firstFrameInstruction,
        blockingContinuity?.currentStart,
        firstPanel?.continuityIn,
        firstPanel?.staticMoment,
      ], 420),
      actionAxis: joinCompactParts([
        blockingContinuity?.movementAxis,
        plan?.cameraPlan.cameraAxis,
        plan?.worldLock.actionZone,
        directorContract?.spatialContract,
      ], 420),
      mechanismState: joinCompactParts([
        directorContract?.mechanismState,
        directorContract?.uiContinuity,
      ], 420) || undefined,
      endFrame: joinCompactParts([
        directorContract?.endBeatContract,
        blockingContinuity?.currentEnd,
        lastPanel?.continuityOut,
        lastPanel?.staticMoment,
      ], 420),
      handoff: joinCompactParts([
        transitionBridge?.visualBridge,
        transitionBridge?.soundBridge,
        transitionBridge?.cameraBridge,
        transitionBridge?.transitionRationale,
        input.storyboard.nextStoryboardSummary,
      ], 420),
    },
    cameraActionTargets: {
      cameraAxis: compactText(plan?.cameraPlan.cameraAxis, 220) || undefined,
      cameraRelation: compactText(plan?.cameraPlan.cameraRelation, 220) || undefined,
      lensPlan: compactText(plan?.cameraPlan.lensPlan, 220) || undefined,
      lightPlan: compactText(plan?.cameraPlan.lightPlan, 220) || undefined,
      transitionBridge: joinCompactParts([
        transitionBridge?.transitionType,
        transitionBridge?.visualBridge,
        transitionBridge?.cameraBridge,
      ], 360) || undefined,
    },
    referenceRoleCards: buildReferenceRoleCards(input.references, directorBoardRefId, projectVisualStyle),
    panelExecutionCards: buildPanelExecutionCards(plan),
    protagonistFocusRules: buildProtagonistFocusRules(input),
    endBeatHandoffRules: buildEndBeatHandoffRules(input),
    voiceIdentityRules: buildVoiceIdentityRules(),
    voiceReferenceRules: buildVoiceReferenceRules(input),
    negativeExecutionRules: [
      'Do not render a storyboard board, nine-grid collage, split screen, comic page, label text, panel number, arrow, footer bar, title, logo, watermark, subtitle, or reference explanation.',
      'Do not change face identity, hairstyle, body proportion, selected outfit version, scene axis, prop ownership, mechanism state, UI/countdown logic, or final handoff.',
      'Do not let doors, entrances, thresholds, broken-glass openings, hatches, or wall breaches change state without a visible action chain and a stable inside/outside direction.',
      'Do not skip causal contact frames; sparks, explosions, collapses, electrocution, entrances, or prop handoffs must have a visible touch/impact/insert/press frame first.',
      'Do not add unbound characters, extra plot events, rescue beats, next-storyboard action, random readable text, random UI digits, malformed limbs, or camera drift.',
      'No-face outfit/body references never provide face identity, facial features, hairstyle, skin tone, portrait likeness, or official-person identity.',
      'Do not let antagonist, weapon, UI, or prop inserts take over the middle of the shot when the protagonist is speaking, resisting, or reacting.',
      'Do not end on an isolated accessory, body detail, weapon, UI, or prop close-up unless the boardPlan explicitly defines that isolated object as the next-shot anchor.',
      'Do not render female-coded protagonists with male voice, male-coded face/body read, masculine jaw/neck/shoulder drift, or AI-announcer dialogue delivery.',
      'Do not treat voice reference audio or black-screen voice videos as visual reference material.',
    ],
  };
}

function buildFinalPromptContract(input: BuildSeedanceFinalPromptInput, directorBoardRefId: string) {
  const maxImageReferences = normalizeSeedanceImageReferenceLimit(input.maxImageReferences);
  const isShotPlanMode = isShotPlanBoardMode(input.mode);
  const expectedPanelCount = getStoryboardBoardExpectedPanelCount(
    input.mode,
    input.storyboard.storyboard.duration,
    input.boardPlan?.panels.length,
  );
  const finalPanelLabel = formatStoryboardPanelLabel(expectedPanelCount);
  const usesOutfitReference = hasOutfitReference(input.references);
  const usesNoFaceReference = hasNoFaceReference(input.references);
  const usesOfficialVirtualHuman = hasOfficialVirtualHumanReference(input.references);
  const projectVisualStyle = buildProjectVisualStyleAnchor(input);
  const cameraSegmentCount = normalizeStoryboardCameraSegmentCount(input.cameraSegmentCount);
  const cameraSegmentContract = buildStoryboardCameraSegmentContract(cameraSegmentCount);

  return {
    title: 'Seedance final video prompt contract',
    outputTarget: 'Return only the final Seedance video prompt text. Do not return JSON, Markdown fences, analysis, headings outside the required final prompt structure, or template explanations.',
    directorBoardRefId,
    projectVisualStyle,
    cameraSegmentCount,
    cameraSegmentContract,
    referenceExecutionRules: [
      'Match Step3 references by refId first. If the same character has identity, outfit, official portrait, and no-face body references, keep each reference role separate.',
      `The selected video model accepts at most ${maxImageReferences} image references: ${directorBoardRefId} is the director board, and Step3 visual references occupy @图片2..@图片${maxImageReferences}. Never write @图片${maxImageReferences + 1} or any higher image slot.`,
      'Use the director board reference as the motion, blocking, camera rhythm, START FRAME, S-panel progression, transition, and END BEAT source; the final video must not preserve storyboard borders, panel numbers, arrows, labels, footer bars, or instruction text.',
      'Character sheet references are final identity/body/outfit locks only; never describe or generate their FRONT VIEW/BACK VIEW/COSTUME DETAIL layout as video content.',
      `Reference style transfer is forbidden: read every reference for identity, shape, material, and motion locks only, then render the final video in the current project visual style (${projectVisualStyle}); do not hardcode any undeclared visual medium or aesthetic unless the current project style explicitly asks for it.`,
      usesOutfitReference
        ? 'OUTFIT VERSION final lock: when a selected outfit reference exists, the final prompt must preserve that outfit version and must not drift back to base outfit/default outfit.'
        : 'When no outfit variant reference exists, preserve the character clothing from the bound Step3 identity reference and do not invent a new costume.',
      usesNoFaceReference
        ? 'No-face reference safety: no-face outfit/body references control clothing version, body proportion, material, silhouette, accessories, and equipment only; never derive face, facial features, hairstyle, skin tone, portrait identity, or official-person likeness from them.'
        : 'If no no-face outfit/body reference exists, do not invent one; use available character references according to their reading contracts.',
      usesOfficialVirtualHuman
        ? 'Official virtual human portrait references provide official face/identity only; clothing, body proportion, material, and outfit details must come from the matching visual outfit/body reference when present.'
        : 'Do not invent official virtual human identity rules when no official portrait reference is provided.',
      'Scene references lock spatial layout, material, lighting direction, entrance/exit, action zone, and camera axis; props lock shape, material, state, scale, and holder relation.',
    ],
    directorBoardRules: [
      `The director board reference is ${directorBoardRefId}; read it as a shot-order control board, not as final on-screen graphic design.`,
      'The final video must not preserve storyboard borders, split-screen grid, panel numbers, arrows, label text, footer text, title bars, or production-board UI.',
      isShotPlanMode
        ? `For shot-plan mode, treat START FRAME as the incoming bridge before S01 and END BEAT as the outgoing handoff after ${finalPanelLabel}; explicitly obey every S01-${finalPanelLabel} beat while converting them into one continuous video action; S labels are action/state anchors, not cut points; do not collapse the planned beats into broad time blocks.`
        : 'For nine-grid mode, read S01-S09 as key beat anchors and convert them into one continuous video action, not nine separate frozen panels.',
      ...cameraSegmentContract,
    ],
    boardPlanRules: [
      'Use boardPlan.directorBrief.referenceMatching as the authoritative reference-role summary.',
      'Use finalPromptContract.projectVisualStyle as the authoritative project visual style source; boardPlan.styleAnchor and directorBrief.styleStatement may only add shot-level color, mood, and performance nuance.',
      'Use boardPlan.characterLocks and boardPlan.consistencyRules to preserve character identity, outfit, body proportion, posture, props, and side assignment.',
      'Use boardPlan.blockingContinuity, cameraPlan, transitionBridge, and directorContract to preserve first frame, final frame, space, mechanism state, UI/countdown strategy, and next-shot handoff.',
      `Use boardPlan.panels for beat order. In shot-plan mode, the final prompt must include a concise text-only S01-${finalPanelLabel} execution checklist so the video model has explicit action anchors; these labels must not appear as visible video text.`,
      `Use finalPromptContract.cameraSegmentCount as the upper limit for motivated camera segments; do not turn S01-${finalPanelLabel} into one cut per S row.`,
      'Use boardPlan.directorContract.mechanismState as a hard source for door/entry/threshold/breach state. If the source mentions a door, entrance, threshold, broken glass, wall breach, or inside/outside relation, the final prompt must repeat that state chain in read-image execution, S rows, and spatial constraints.',
      'Use panel continuityIn/continuityOut to preserve critical trigger contact frames. If a trigger action causes a result, the S rows must include the visible contact/impact/insert/press frame before the result.',
      'Use videoExecutionContract as the final assembly checklist: opening frame, action timeline, camera movement, reference execution, sound/dialogue sync, ending frame, and negative execution rules must all appear in the final video prompt.',
      'Use videoExecutionContract.protagonistFocusRules to keep the primary character visible through the emotional center; antagonist/weapon/prop inserts must not replace protagonist reaction beats.',
      'Use videoExecutionContract.endBeatHandoffRules to make END BEAT a readable next-shot handoff frame; isolated accessory/body-detail/prop/weapon close-ups are inserts, not the final hold, unless explicitly required by the boardPlan.',
      'Use videoExecutionContract.voiceIdentityRules to preserve speaker gender/age voice identity and natural actor dialogue; female-coded leads must not become male-voiced or male-read.',
      'If videoExecutionContract.voiceReferenceRules is non-empty, include those character voice reference requirements in the sound/dialogue performance section without treating audio or black-screen videos as visual references.',
    ],
    requiredFinalPromptSections: isShotPlanMode
      ? ['参考图职责：', '基础规格：', '读图执行：', '逐秒执行清单：', '完整台词与音画同步：', '声音与表演：', '空间硬约束：', '负面规则：']
      : ['frame/spec line', 'reference roles', 'single-shot action timeline', 'sound/BGM/dialogue performance', 'lighting/style', 'negative rules', 'final handoff'],
    negativeRules: [
      'Do not produce storyboard-page traces, nine-grid collage, comic page, UI board, reference explanation document, subtitles, title text, logo, watermark, or random readable text.',
      'Do not add unbound main characters, unplanned outfits, unplanned props, new plot events, or next-storyboard action.',
      'Do not solve missing visual continuity by adding prose only; final prompt must preserve blocking, motion, camera direction, sound, and handoff in the video action.',
      'Do not let entrances, doors, thresholds, broken-glass openings, wall breaches, hatches, or large mechanisms change state offscreen unless the prompt states they were already in that state before S01.',
      'Do not skip visible trigger contact frames; do not jump from intention/eye-line to aftermath when the story beat depends on impact, insertion, pressing, biting, breaking, or electricity.',
      'Do not copy accidental reference-image render artifacts; match the current project visual style instead, including photoreal/live-action only when that is the declared project style.',
      'Wardrobe boundary: no visible cleavage, no cleavage-focused framing, and no breast-exposure drift. Sensual, glamorous, or edgy styling is allowed when it fits the project and character design.',
      'Do not let the antagonist, weapon, UI, or prop close-ups steal the emotional center from the protagonist.',
      'Do not make the final frame an isolated accessory/body-detail/prop/weapon close-up when the next shot needs character + pressure source + space continuity.',
      'Do not allow female-coded protagonists to become male-read or male-voiced; do not use announcer, broadcast, or AI narration tone for dialogue.',
      'Do not use voice reference audio or black-screen voice videos as appearance, costume, lighting, or composition references.',
    ],
  };
}

function buildSnapshotPayload(input: BuildSeedanceFinalPromptInput, repairHint?: string) {
  const storyboard = input.storyboard;
  const effectiveDurationSeconds = resolveStoryboardVideoDuration(storyboard, storyboard.storyboard.duration);
  const effectiveDurationText = `${effectiveDurationSeconds}秒`;
  const maxImageReferences = normalizeSeedanceImageReferenceLimit(input.maxImageReferences);
  const referenceLayout = buildSeedancePromptReferenceLayout(input.references, maxImageReferences);
  const promptInput: BuildSeedanceFinalPromptInput = {
    ...input,
    references: referenceLayout.references,
  };
  const { directorBoardRefId } = referenceLayout;
  return {
    schemaVersion: 16,
    mode: input.mode,
    frameRatio: normalizeFrameRatio(input.frameRatio),
    projectVisualStyle: buildProjectVisualStyleAnchor(promptInput),
    imageReferenceNumbering: {
      hardLimit: maxImageReferences,
      directorBoardRefId,
      visualReferenceRange: `参考图片2..参考图片${maxImageReferences}`,
      rule: `Do not mention @图片${maxImageReferences + 1} or any higher image reference.`,
    },
    finalPromptContract: buildFinalPromptContract(promptInput, directorBoardRefId),
    videoExecutionContract: buildSeedanceVideoExecutionContract(promptInput, directorBoardRefId),
    cameraSegmentCount: normalizeStoryboardCameraSegmentCount(input.cameraSegmentCount),
    storyboard: {
      number: storyboard.storyboard.number,
      name: storyboard.storyboard.name,
      duration: effectiveDurationText,
      originalDuration: storyboard.storyboard.duration,
      smartVideoDurationSeconds: storyboard.smartVideoDurationSeconds,
      smartVideoDurationReason: storyboard.smartVideoDurationReason,
      shotSize: storyboard.storyboard.shotSize,
      scene: storyboard.storyboard.scene,
      characters: storyboard.storyboard.characters,
      promptRawText: storyboard.prompt?.rawText,
      promptTimeSegments: pickPromptTimeSegments(storyboard.prompt),
    },
    step4OutputMode: storyboard.step4OutputMode,
    generatedStep4OutputMode: storyboard.generatedStep4OutputMode,
    storyboardBoardStyle: storyboard.storyboardBoardStyle,
    correctedScript: storyboard.correctedScript,
    lastFrameInfo: storyboard.lastFrameInfo,
    promptRawText: storyboard.prompt?.rawText,
    promptTimeSegments: pickPromptTimeSegments(storyboard.prompt),
    sourceExcerpt: storyboard.sourceExcerpt,
    sourceExcerptSummary: compactText(storyboard.sourceExcerptSummary, 320),
    nextStoryboardSummary: compactText(storyboard.nextStoryboardSummary, 320),
    sceneBlueprint: storyboard.sceneBlueprint as SceneBlueprint | null,
    choreography: pickChoreography(storyboard.choreography),
    continuityInput: pickContinuity(storyboard.continuityInput),
    continuityOutput: pickContinuity(storyboard.continuityOutput),
    references: referenceLayout.references.map((reference) => ({
      refId: reference.refId,
      originalRefId: reference.originalRefId,
      type: reference.type,
      name: reference.name,
      assetId: reference.assetId,
      trackingId: reference.trackingId,
      variantKey: reference.variantKey,
      outfitSeq: reference.outfitSeq,
      concept: reference.concept,
      assetSource: reference.assetSource,
      isNoFaceCharacterVisual: reference.isNoFaceCharacterVisual,
      readingContract: buildStoryboardReferenceReadingContract({
        refId: reference.refId,
        type: reference.type,
        name: reference.name,
        concept: reference.concept,
        assetSource: reference.assetSource,
        variantKey: reference.variantKey,
        outfitSeq: reference.outfitSeq,
        isNoFaceCharacterVisual: reference.isNoFaceCharacterVisual,
      }),
    })),
    omittedReferences: referenceLayout.omittedReferences,
    voiceReferences: (input.voiceReferences ?? []).map((reference) => ({
      slot: reference.slot,
      mediaType: reference.mediaType,
      characterName: reference.characterName,
      displayName: reference.displayName,
      language: reference.language,
      sourceCharacter: reference.sourceCharacter,
      voiceTags: compactText(reference.voiceTags, 160) || undefined,
      sampleText: compactText(reference.sampleText, 160) || undefined,
      hasAudioBlob: !!reference.audioBlobKey,
      hasPublicAudioUrl: !!reference.publicAudioUrl,
      hasBlackVideo: !!reference.blackVideoBlobKey,
      audioFileName: reference.audioFileName,
      blackVideoFileName: reference.blackVideoFileName,
    })),
    directorBoardRefId,
    boardPlan: pickBoardPlan(input.boardPlan),
    repairHint: repairHint ? compactText(repairHint, 420) : undefined,
  };
}

export function buildSeedanceFinalPromptSourceSnapshot(input: BuildSeedanceFinalPromptInput): string {
  return JSON.stringify(buildSnapshotPayload(input));
}

export function buildSeedanceFinalPromptRequestPayload(
  input: BuildSeedanceFinalPromptInput,
  repairHint?: string,
): string {
  return JSON.stringify(buildSnapshotPayload(input, repairHint));
}

function normalizeSeedanceFinalPromptSourceSnapshotForComparison(snapshot: string): string {
  if (!snapshot) return '';
  try {
    const parsed = JSON.parse(snapshot) as Record<string, unknown>;
    delete parsed.lastFrameInfo;
    delete parsed.continuityOutput;
    return JSON.stringify(parsed);
  } catch {
    return snapshot;
  }
}

function seedanceFinalPromptSourceSnapshotsMatch(current: string, next: string): boolean {
  return normalizeSeedanceFinalPromptSourceSnapshotForComparison(current)
    === normalizeSeedanceFinalPromptSourceSnapshotForComparison(next);
}

function isOutfitReference(reference: SeedanceFinalPromptReference) {
  return reference.type === 'character'
    && (
      reference.concept === 'landscape_outfit_turnaround'
      || reference.concept === 'portrait_outfit'
      || !!reference.variantKey
      || typeof reference.outfitSeq === 'number'
    );
}

function hasFaceIdentityReference(references: readonly SeedanceFinalPromptReference[]) {
  return references.some((reference) =>
    reference.type === 'character'
    && !reference.isNoFaceCharacterVisual
    && !isOutfitReference(reference),
  );
}

function parseSeedanceFinalPromptValidationContext(snapshot?: string): SeedanceFinalVideoPromptValidationContext | undefined {
  if (!snapshot) return undefined;
  try {
    const parsed = JSON.parse(snapshot) as {
      mode?: StoryboardBoardMode;
      references?: SeedanceFinalPromptReference[];
      storyboard?: { duration?: string };
      boardPlan?: { panels?: unknown[] };
      imageReferenceNumbering?: { hardLimit?: number };
    };
    const expectedPanelCount = parsed.mode
      ? getStoryboardBoardExpectedPanelCount(
          parsed.mode,
          parsed.storyboard?.duration,
          Array.isArray(parsed.boardPlan?.panels) ? parsed.boardPlan.panels.length : undefined,
        )
      : undefined;
    return {
      mode: parsed.mode,
      references: Array.isArray(parsed.references) ? parsed.references : undefined,
      expectedPanelCount,
      maxImageReferences: parsed.imageReferenceNumbering?.hardLimit,
    };
  } catch {
    return undefined;
  }
}

function buildSeedanceFinalPromptValidationContext(
  input: BuildSeedanceFinalPromptInput,
): SeedanceFinalVideoPromptValidationContext {
  const maxImageReferences = normalizeSeedanceImageReferenceLimit(input.maxImageReferences);
  const referenceLayout = buildSeedancePromptReferenceLayout(input.references, maxImageReferences);
  return {
    mode: input.mode,
    references: referenceLayout.references,
    expectedPanelCount: getStoryboardBoardExpectedPanelCount(
      input.mode,
      input.storyboard.storyboard.duration,
      input.boardPlan?.panels.length,
    ),
    maxImageReferences,
  };
}

function extractSeedanceImageReferenceNumbers(prompt: string) {
  const numbers = new Set<number>();
  const pattern = /(?:参考\s*)?@?\s*图片\s*(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prompt))) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0) numbers.add(value);
  }
  return Array.from(numbers).sort((left, right) => left - right);
}

export function getSeedanceFinalVideoPromptState(
  storyboard: StoryboardState,
  currentSourceSnapshot?: string,
): SeedanceFinalVideoPromptState {
  const rawStatus = storyboard.seedanceFinalVideoPromptStatus ?? 'idle';
  const isGeneratingStale = isSeedanceFinalVideoPromptGeneratingStale(storyboard);
  const prompt = storyboard.seedanceFinalVideoPrompt?.trim() ?? '';
  const sourceSnapshot = storyboard.seedanceFinalVideoPromptSourceSnapshot ?? '';
  const hasCurrentSnapshot = typeof currentSourceSnapshot === 'string' && currentSourceSnapshot.length > 0;
  const snapshotMatches = hasCurrentSnapshot && seedanceFinalPromptSourceSnapshotsMatch(sourceSnapshot, currentSourceSnapshot);
  const isGeneratingSourceStale = rawStatus === 'generating'
    && hasCurrentSnapshot
    && !!sourceSnapshot
    && !snapshotMatches;
  const validationContext = parseSeedanceFinalPromptValidationContext(currentSourceSnapshot)
    ?? parseSeedanceFinalPromptValidationContext(sourceSnapshot);
  const validation = prompt ? validateSeedanceFinalVideoPrompt(prompt, validationContext) : { ok: false };
  const validationAcceptable = isSeedanceFinalPromptValidationAcceptable(validation);
  const canRecoverFailedValidation = rawStatus === 'failed'
    && !!prompt
    && validationAcceptable
    && isSeedanceFinalPromptValidationLikeError(storyboard.seedanceFinalVideoPromptError);
  const status = isGeneratingStale ? 'failed' : canRecoverFailedValidation ? 'done' : rawStatus;
  const isFresh = status === 'done' && !!prompt && snapshotMatches && validationAcceptable;
  const hasValidDonePrompt = status === 'done' && !!prompt && validationAcceptable;
  const warning = isFresh && isSeedanceFinalPromptValidationAdvisory(validation)
    ? validation.reason
    : undefined;
  return {
    status: isGeneratingSourceStale ? 'failed' : status,
    prompt,
    error: isGeneratingSourceStale
      ? 'Seedance 最终视频词生成已被页面刷新或引用变更中断，请重新点击刷新。'
      : isGeneratingStale
      ? 'Seedance 最终视频词生成已超时，点击刷新可重新生成。'
      : hasValidDonePrompt
      ? undefined
      : (!validationAcceptable && status === 'done' && snapshotMatches
        ? validation.reason
        : storyboard.seedanceFinalVideoPromptError),
    warning,
    sourceSnapshot,
    updatedAt: storyboard.seedanceFinalVideoPromptUpdatedAt,
    isFresh,
    isUsable: isFresh,
  };
}

function isSeedanceFinalPromptValidationLikeError(error?: string) {
  const text = error?.trim() ?? '';
  if (!text) return false;
  if (/API Key|超时|连接|取消|网络|请求失败|生成已被|请先/.test(text)) return false;
  return /最终视频提示词|最终视频词|最终词|提交词|15格 Seedance|智能故事板 Seedance|逐秒执行清单|Seedance 最多只支持/.test(text);
}

function isAbortLikeError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError');
}

function isSeedanceFinalPromptValidationAdvisory(
  validation: SeedanceFinalVideoPromptValidationResult,
): boolean {
  return !validation.ok && validation.severity === 'warning';
}

function isSeedanceFinalPromptValidationAcceptable(
  validation: SeedanceFinalVideoPromptValidationResult,
): boolean {
  return validation.ok || isSeedanceFinalPromptValidationAdvisory(validation);
}

function isLegacySeedanceReferenceSyntax(text: string): boolean {
  return /(?:^|\n)\s*(?:[-*]\s*)?参考图片\s*\d+\s*[：:是]/.test(text)
    || /(?:^|[^\w@])图片\s*\d+(?:[：:是]|中|里的?)/.test(text)
    || /参考\s*@图片\d+/.test(text);
}

export function validateSeedanceFinalVideoPrompt(
  prompt: string,
  context?: SeedanceFinalVideoPromptValidationContext,
): SeedanceFinalVideoPromptValidationResult {
  const normalized = prompt.trim();
  const isShotPlanIndustrial = normalized.startsWith('参考图职责：');
  const references = context?.references ?? [];
  const maxImageReferences = normalizeSeedanceImageReferenceLimit(context?.maxImageReferences);
  const expectedPanelCount = context?.mode && isShotPlanBoardMode(context.mode)
    ? (context.expectedPanelCount ?? 15)
    : 15;
  const expectedFinalPanelLabel = formatStoryboardPanelLabel(expectedPanelCount);
  const shotPlanValidationLabel = isSmartShotPlanBoardMode(context?.mode ?? 'shot-plan-landscape')
    ? '智能故事板 Seedance 最终词'
    : '15格 Seedance 最终词';
  const hasContext = !!context;
  const hasIdentityRef = hasContext ? hasFaceIdentityReference(references) : true;
  const hasNoFaceRef = hasContext ? hasNoFaceReference(references) : false;
  if (!normalized) return { ok: false, reason: '最终视频提示词为空。' };
  if (/Seedance 2\.0 提交词：/.test(normalized)) {
    return { ok: false, reason: '最终视频提示词不需要“Seedance 2.0 提交词：”标题。' };
  }
  if (/@参考图片\d+/.test(normalized)) {
    return { ok: false, reason: '最终视频提示词必须使用“名称【@图片N】”，不要写成 @参考图片N。' };
  }
  if (isLegacySeedanceReferenceSyntax(normalized)) {
    return { ok: false, reason: 'Seedance 最终词图片引用格式错误：必须写成“名称【@图片N】”，不要写“参考图片N：”“参考图片N是”“图片N中”或“参考 @图片N”。' };
  }
  if (/@(?:CurrentStoryboardRef|SceneRef|CharacterRef|PropRef|Reference)\b/.test(normalized) || /sound beats/i.test(normalized)) {
    return { ok: false, reason: '最终视频提示词必须使用“名称【@图片N】”，不要使用英文引用 alias 或 sound beats。' };
  }
  const overflowImageNumbers = extractSeedanceImageReferenceNumbers(normalized)
    .filter((value) => value > maxImageReferences);
  if (overflowImageNumbers.length > 0) {
    const labels = overflowImageNumbers.slice(0, 4).map((value) => `@图片${value}`).join('、');
    return {
      ok: false,
      reason: `当前视频模型最多只支持 ${maxImageReferences} 张图，最终词不能引用 ${labels}；主导演板固定为 @图片1，视觉参考只能写 @图片2..@图片${maxImageReferences}。`,
    };
  }
  const hasIntermediateTemplateTrace =
    /Reference Material Roles|参考图优先级|Continuity In\/Out|Timeline|Scene Goal|MODULE A-F/i.test(normalized)
    || (!isShotPlanIndustrial && /S01-S09/i.test(normalized));
  if (hasIntermediateTemplateTrace) {
    return { ok: false, reason: '最终视频提示词仍包含中间模板痕迹。' };
  }
  if (isShotPlanIndustrial) {
    const dialogueSyncHeading = '完整台词与音画同步：';
    const requiredHeadings = [
      '参考图职责：',
      '基础规格：',
      '读图执行：',
      '逐秒执行清单：',
      '声音与表演：',
      '空间硬约束：',
      '负面规则：',
    ];
    const missingHeadings = requiredHeadings.filter((heading) => !normalized.includes(heading));
    if (missingHeadings.length > 0) {
      return { ok: false, reason: `${shotPlanValidationLabel}缺少固定工业字段：${missingHeadings.join('、')}` };
    }
    if (/^\s*(?:[-*]\s*)?(?:跨分镜承接|角色状态与音色|场景与空间轴线|镜头与调度|动作与台词时间线|声音与BGM|风格)：/m.test(normalized)) {
      return { ok: false, reason: `${shotPlanValidationLabel}应使用短版读图执行卡字段，不要保留旧的长版逐秒字段。` };
    }
    const checklistMatch = normalized.match(/逐秒执行清单：([\s\S]*?)(?:完整台词与音画同步：|声音与表演：|空间硬约束：|负面规则：)/);
    const checklistText = checklistMatch?.[1] ?? '';
    const checklistRows = checklistText.match(/^\s*(?:[-*]\s*)?S(?:0[1-9]|1[0-5])\s*[｜|]\s*\d+(?:\.\d+)?\s*[–—-]\s*\d+(?:\.\d+)?\s*(?:s|秒)\s*[｜|].*$/gm) ?? [];
    const checklistLabels = new Set(
      checklistRows
        .map((row) => row.match(/S(?:0[1-9]|1[0-5])/)?.[0])
        .filter((value): value is string => !!value),
    );
    const expectedChecklistLabels = Array.from({ length: expectedPanelCount }, (_value, index) =>
      formatStoryboardPanelLabel(index + 1),
    );
    const hasEveryExpectedChecklistLabel = expectedChecklistLabels.every((label) => checklistLabels.has(label));
    if (!hasEveryExpectedChecklistLabel) {
      return { ok: false, reason: `${shotPlanValidationLabel}必须在“逐秒执行清单”中保留 S01-${expectedFinalPanelLabel} 共${expectedPanelCount}条动作锚点，不能压缩成四段。` };
    }
    const checklistRowsWithInlineRefs = checklistRows.filter((row) => /(?:参考\s*)?@图片\d+/.test(row));
    if (checklistRowsWithInlineRefs.length < expectedPanelCount) {
      return { ok: false, reason: '逐秒执行清单每一条都必须带 @图片N 内联引用锁，避免角色、道具和场景被视频模型自由改写。' };
    }
    if (/｜(?:SHOT|ACTION|DIALOGUE|PERFORMANCE|TRANSITION)：/.test(normalized)) {
      return { ok: false, reason: '逐秒执行清单应使用短硬动作锚点，不要保留旧版 SHOT/ACTION/PERFORMANCE 字段标签。' };
    }
    if (!normalized.includes(dialogueSyncHeading) || !/完整台词与音画同步：[\s\S]{20,}/.test(normalized) || !/[“"][^”"]{2,}[”"]/.test(normalized)) {
      return {
        ok: false,
        reason: `${shotPlanValidationLabel}建议提供完整台词与音画同步表，且台词不要被拆碎或省略。`,
        severity: 'warning',
        repair: false,
      };
    }
    if (!/读图执行：[\s\S]*(?:第一帧|首帧|START FRAME)[\s\S]*(?:尾帧|END BEAT|final hold)/.test(normalized)) {
      return { ok: false, reason: `${shotPlanValidationLabel}必须在“读图执行”中写明 START FRAME 首帧和 END BEAT 尾帧交接。` };
    }
    if (!/START FRAME/.test(normalized) || !/END BEAT/.test(normalized)) {
      return { ok: false, reason: `${shotPlanValidationLabel}必须显式读取主导演板的 START FRAME 和 END BEAT。` };
    }
    const hasDoorOrBoundaryLanguage = /门槛|门内|门外|入口|门|破口|玻璃门|墙洞|舱门|闸门|边界|gate|door|threshold|entrance|breach/i.test(normalized);
    if (
      hasDoorOrBoundaryLanguage
      && !(/入口状态链|门\/入口状态链|S01前|S01 前|初始状态|开场前/i.test(normalized)
        && new RegExp(`${expectedFinalPanelLabel}|END BEAT|最终状态|最终`).test(normalized)
        && /门槛|破口|门缝|门轴|门扇|玻璃|边界|threshold|breach|gap|hinge|crack/i.test(normalized))
    ) {
      return { ok: false, reason: `${shotPlanValidationLabel}涉及门/入口/边界时，建议写清 S01前到 ${expectedFinalPanelLabel} 的入口状态链。`, severity: 'warning' };
    }
    const hasTriggerActionLanguage = /踢|砸|撞|拉|按|插|塞|抛|接住|接上|接过|交接|射击|开枪|引爆|通电|咬住|破门|破窗|击中|命中|kick|hit|smash|pull|press|plug|insert|shove|throw|catch|shoot|ignite|electrify|bite|breach/i.test(normalized);
    if (
      hasTriggerActionLanguage
      && !(/接触帧|接触点|命中点|命中|击中|踢中|插入|塞入|塞进|按下|接上|咬住|impact|contact|insert|plug|press|bite/i.test(normalized)
        && /结果|反馈|火花|爆炸|电弧|倒塌|result|aftermath|spark|explosion|arc/i.test(normalized))
    ) {
      return { ok: false, reason: `${shotPlanValidationLabel}涉及触发动作时，建议保留可见接触/命中帧，再写结果反馈。`, severity: 'warning' };
    }
    if (hasIdentityRef && !/100%\s*锁定[\s\S]{0,20}五官[\s\S]{0,30}脸型[\s\S]{0,30}发型/.test(normalized)) {
      return { ok: false, reason: `${shotPlanValidationLabel}必须写明角色全程 100% 锁定五官、脸型和发型。` };
    }
    if (
      hasNoFaceRef
      && !/(无脸|no-face)[\s\S]{0,120}(不得|不能|禁止|never|不读取|不用于)[\s\S]{0,120}(脸|五官|发型|肤色|肖像|身份)/i.test(normalized)
    ) {
      return { ok: false, reason: `${shotPlanValidationLabel}必须写明无脸服装/体态参考不得读取脸、五官、发型、肤色或肖像身份。` };
    }
    if (normalized.length > 7200) {
      return { ok: false, reason: `${shotPlanValidationLabel}过长，应控制为读图执行卡。` };
    }
  }
  if (/禁止任何画面内文字|禁止中文字幕|禁止对白字幕|禁止歌词字幕|禁止贴字/.test(normalized) && /(任务面板|弹幕|倒计时|字幕|文字|贴字)/.test(normalized)) {
    return { ok: false, reason: '最终视频提示词的字幕禁令与画面元素表述冲突。' };
  }
  if (normalized.length < 800) return { ok: false, reason: '最终视频提示词过短。' };
  if (normalized.length > 9000) return { ok: false, reason: '最终视频提示词过长。' };
  if (!isShotPlanIndustrial && (!/音效：/.test(normalized) || !/BGM：/.test(normalized) || !/对白表演：/.test(normalized))) {
    return { ok: false, reason: '最终视频提示词缺少音效、BGM 或对白表演设计。' };
  }
  if (/[、，,：:；;]$/.test(normalized)) {
    return { ok: false, reason: 'Seedance 最终视频提示词疑似被截断。' };
  }
  const panelMentions = normalized.match(/S0[1-9]/g)?.length ?? 0;
  if (!isShotPlanIndustrial && panelMentions > 4) return { ok: false, reason: '最终视频提示词的逐格编号仍然过多。' };
  return { ok: true };
}

async function validateOrRepairSeedanceFinalPrompt(
  rawPrompt: string,
  validationContext: SeedanceFinalVideoPromptValidationContext,
  invokeWithRetry: (repairHint?: string) => Promise<string>,
): Promise<string> {
  let finalPrompt = rawPrompt.trim();
  let validation = validateSeedanceFinalVideoPrompt(finalPrompt, validationContext);

  if (validation.ok) return finalPrompt;

  if (isSeedanceFinalPromptValidationAdvisory(validation)) {
    if (validation.repair === false) return finalPrompt;

    try {
      const repairedPrompt = (await invokeWithRetry(validation.reason)).trim();
      const repairedValidation = validateSeedanceFinalVideoPrompt(repairedPrompt, validationContext);
      return isSeedanceFinalPromptValidationAcceptable(repairedValidation)
        ? repairedPrompt
        : finalPrompt;
    } catch (error) {
      if (isAbortLikeError(error)) throw error;
      return finalPrompt;
    }
  }

  finalPrompt = (await invokeWithRetry(validation.reason)).trim();
  validation = validateSeedanceFinalVideoPrompt(finalPrompt, validationContext);
  if (!isSeedanceFinalPromptValidationAcceptable(validation)) {
    throw new Error(validation.reason ?? 'Seedance 最终视频提示词校验失败。');
  }

  return finalPrompt;
}

export async function requestSeedanceFinalVideoPrompt(
  input: BuildSeedanceFinalPromptInput,
  request: SeedanceFinalVideoPromptRequester,
  timeoutMs = SEEDANCE_FINAL_VIDEO_PROMPT_TIMEOUT_MS,
): Promise<string> {
  const invoke = (repairHint?: string) => withSeedanceFinalVideoPromptTimeout(
    (signal) => request(
      buildSeedanceFinalPromptRequestPayload(input, repairHint),
      {
        temperature: repairHint ? 0.18 : 0.2,
        maxTokens: normalizeSeedanceImageReferenceLimit(input.maxImageReferences) > 9
          ? (isShotPlanBoardMode(input.mode) ? 6500 : 6000)
          : (isShotPlanBoardMode(input.mode) ? 4500 : 4000),
        signal,
        repairHint,
      },
    ),
    timeoutMs,
  );
  const invokeWithRetry = async (repairHint?: string) => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= SEEDANCE_FINAL_VIDEO_PROMPT_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await invoke(repairHint);
      } catch (error) {
        lastError = error;
        if (attempt >= SEEDANCE_FINAL_VIDEO_PROMPT_RETRY_DELAYS_MS.length || !isTransientApiError(error)) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, SEEDANCE_FINAL_VIDEO_PROMPT_RETRY_DELAYS_MS[attempt]));
      }
    }
    throw lastError ?? new Error('Seedance 最终视频提示词生成失败。');
  };

  const validationContext = buildSeedanceFinalPromptValidationContext(input);
  return validateOrRepairSeedanceFinalPrompt(await invokeWithRetry(), validationContext, invokeWithRetry);
}

export async function requestSeedanceFinalVideoPromptStream(
  input: BuildSeedanceFinalPromptInput,
  request: SeedanceFinalVideoPromptStreamRequester,
  progressCallbacks: SeedanceFinalVideoPromptProgressCallbacks = {},
  noOutputTimeoutMs = SEEDANCE_FINAL_VIDEO_PROMPT_NO_OUTPUT_TIMEOUT_MS,
  externalSignal?: AbortSignal,
): Promise<string> {
  const invoke = (repairHint?: string) => withSeedanceFinalVideoPromptNoOutputTimeout(
    async (signal, markOutput) => {
      progressCallbacks.onAttemptStart?.(repairHint);
      let streamedText = '';
      const requestPayload = buildSeedanceFinalPromptRequestPayload(input, repairHint);
      const requestOptions: SeedanceFinalVideoPromptRequestOptions = {
        temperature: repairHint ? 0.18 : 0.2,
        maxTokens: normalizeSeedanceImageReferenceLimit(input.maxImageReferences) > 9
          ? (isShotPlanBoardMode(input.mode) ? 6500 : 6000)
          : (isShotPlanBoardMode(input.mode) ? 4500 : 4000),
        signal,
        repairHint,
      };

      const result = await request(requestPayload, requestOptions, {
        onActivity: () => {
          markOutput();
        },
        onChunk: (delta) => {
          streamedText += delta;
          markOutput();
          progressCallbacks.onProgress?.(streamedText, delta, repairHint);
        },
        onReplace: (fullText) => {
          streamedText = fullText;
          markOutput();
          progressCallbacks.onProgress?.(streamedText, '', repairHint);
        },
      });

      const finalText = result.trim() || streamedText.trim();
      if (finalText) {
        markOutput();
        progressCallbacks.onProgress?.(finalText, '', repairHint);
      }
      return finalText;
    },
    noOutputTimeoutMs,
    externalSignal,
  );
  const invokeWithRetry = async (repairHint?: string) => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= SEEDANCE_FINAL_VIDEO_PROMPT_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await invoke(repairHint);
      } catch (error) {
        lastError = error;
        if (attempt >= SEEDANCE_FINAL_VIDEO_PROMPT_RETRY_DELAYS_MS.length || !isTransientApiError(error)) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, SEEDANCE_FINAL_VIDEO_PROMPT_RETRY_DELAYS_MS[attempt]));
      }
    }
    throw lastError ?? new Error('Seedance 最终视频提示词生成失败。');
  };

  const validationContext = buildSeedanceFinalPromptValidationContext(input);
  return validateOrRepairSeedanceFinalPrompt(await invokeWithRetry(), validationContext, invokeWithRetry);
}
