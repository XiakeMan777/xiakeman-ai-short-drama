import type {
  CharacterBlockingState,
  Choreography,
  SpatialBlockingSnapshot,
  StoryboardBoardMode,
  SmartStoryboardPanelCountPreference,
  StoryboardBoardPlan,
  StoryboardBoardBlockingContinuity,
  StoryboardBoardCameraPlan,
  StoryboardBoardDirectorBrief,
  StoryboardBoardDirectorBriefReferenceMatch,
  StoryboardBoardDirectorContract,
  StoryboardBoardPlanCharacterLock,
  StoryboardBoardPlanPanel,
  StoryboardBoardReferenceBudgetItem,
  StoryboardBoardTransitionBridge,
  StoryboardBoardStyle,
  StoryboardBoardWorldLock,
  StoryboardSequenceContinuityContext,
  StoryboardState,
  EpisodeShotSheetSegment,
} from '@/types';
import {
  SMART_STORYBOARD_PANEL_COUNTS,
  formatStoryboardPanelLabel,
  getSmartStoryboardLayoutRule,
  getStoryboardBoardExpectedPanelCount,
  getStoryboardBoardModeSpec,
  isFixedShotPlanBoardMode,
  isShotPlanBoardMode,
  isSmartShotPlanBoardMode,
} from './storyboardBoardMode';
import { getLockedSmartStoryboardPanelCount } from '@/lib/smartStoryboardPanelCount';
import {
  buildStoryboardCameraSegmentContract,
  normalizeStoryboardCameraSegmentCount,
} from '@/lib/storyboardCameraSegments';
import type { StoryboardBoardReference } from './storyboardBoardPrompt';
import { resolveProjectVisualStyle, type ProjectVisualStylePayload } from '@/lib/projectVisualStyle';
import {
  buildStoryboardReferenceReadingContract,
  type StoryboardReferenceReadingContract,
} from './storyboardReferenceReadingContract';
import { parseStoryboardDurationSeconds } from '@/lib/storyboardDuration';

interface StoryboardBoardPlanRequestPayload {
  mode: StoryboardBoardMode;
  repairMode?: 'format' | 'quality';
  panelCount: number;
  smartPanelCountPreference?: SmartStoryboardPanelCountPreference;
  smartPanelCountLocked?: boolean;
  cameraSegmentCount?: number;
  cameraSegmentContract?: string[];
  planningMode?: 'standard' | 'compact';
  compactPlanningContract?: string[];
  frameRatio?: '9:16' | '16:9';
  outputMode: 'prompt' | 'storyboard-director';
  boardStyle: StoryboardBoardStyle;
  projectStyle: ProjectVisualStylePayload;
  storyboardModeContract: StoryboardBoardPlanningContract;
  storyboard: {
    number: number;
    name: string;
    duration: string;
    shotSize: string;
  };
  correctedScript: string;
  prompt: {
    header: string;
    scene: string;
    characters: string;
    cameraOverview: string;
    colorLighting: string;
    rawText: string;
    timeSegments: Array<{
      timeRange: string;
      cameraShot: string;
      actionDesc: string;
      soundEffect?: string;
    }>;
  } | null;
  sceneBlueprint: {
    sceneType?: string;
    combatSubType?: string;
    emotionArc?: string;
    cameraStyle?: string;
  } | null;
  choreography: {
    overallRhythm?: string;
    cameraOverview?: string;
    lightNotes?: string;
    colorGrading?: string;
    timeSegments?: Array<{
      timeRange: string;
      segmentType: string;
      rhythm?: string;
      actionFlow?: string;
      camera: string;
      vfx: string;
      sound: string;
    }>;
  } | null;
  continuity: {
    previousLastFrameInfo?: string;
    previousSpatialBlocking?: SpatialBlockingSnapshot;
    currentSpatialBlocking?: SpatialBlockingSnapshot;
  };
  episodeShotSheetSegment?: EpisodeShotSheetSegment;
  sequenceContinuityContext?: StoryboardSequenceContinuityContext;
  directorBrief?: StoryboardBoardDirectorBrief;
  currentPlan?: StoryboardBoardPlan;
  previousRawText?: string;
  actionDirectorContract?: string[];
  referenceBudget: {
    totalVideoSlots: number;
    reservedStoryboardBoardSlots: number;
    step3ReferenceSlots: number;
    rule: string;
  };
  references: Array<StoryboardBoardReference & { label: string; readingContract: StoryboardReferenceReadingContract }>;
  repairHint?: string;
}

interface StoryboardBoardPlanningContract {
  mode: StoryboardBoardMode;
  purpose: string;
  planningOrder: string[];
  referenceRules: string[];
  characterRules: string[];
  panelRules: string[];
  continuityRules: string[];
  modeRules: string[];
  languageRules: string[];
  outputSchemaRules: string[];
  negativeRules: string[];
}

export type StoryboardBoardPlanTemplateType =
  | 'storyboard_board_plan_nine'
  | 'storyboard_board_plan_shot15'
  | 'storyboard_board_plan_smart';

export const STORYBOARD_DIRECTOR_BRIEF_TEMPLATE_TYPE = 'storyboard_director_brief';
export const STORYBOARD_ACTION_DIRECTOR_TEMPLATE_TYPE = 'storyboard_action_director';

export function getStoryboardBoardPlanTemplateType(mode: StoryboardBoardMode): StoryboardBoardPlanTemplateType {
  if (isFixedShotPlanBoardMode(mode)) return 'storyboard_board_plan_shot15';
  if (isSmartShotPlanBoardMode(mode)) return 'storyboard_board_plan_smart';
  return 'storyboard_board_plan_nine';
}

function compactWhitespace(value: string | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function clipText(value: string | undefined, maxLength: number) {
  const normalized = compactWhitespace(value);
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

function formatBlockingCharacter(character: CharacterBlockingState) {
  return [
    character.character,
    character.position,
    character.facing ? `朝向:${character.facing}` : '',
    character.posture ? `姿态:${character.posture}` : '',
    character.heldProps?.length ? `持有:${character.heldProps.join('、')}` : '',
  ].filter(Boolean).join('，');
}

function summarizeBlocking(blocking?: SpatialBlockingSnapshot | null) {
  if (!blocking) return '';
  return [
    blocking.sceneName ? `场景:${blocking.sceneName}` : '',
    blocking.sceneAnchor ? `锚点:${blocking.sceneAnchor}` : '',
    blocking.cameraAxis ? `机位轴线:${blocking.cameraAxis}` : '',
    ...(blocking.characters ?? []).slice(0, 4).map(formatBlockingCharacter),
    blocking.continuityNotes ? `备注:${blocking.continuityNotes}` : '',
  ].filter(Boolean).join('；');
}

function extractSceneAnchors(...sources: Array<string | undefined>) {
  const joined = sources.filter(Boolean).join(' ');
  const fixedAnchors = [
    'ENTRY DOOR',
    'EXIT DOOR',
    'CENTRAL COLUMN',
    'RIGHT MACHINE',
    'SAFE ACTION ZONE',
    'HANGING CHAIN',
    '入口',
    '出口',
    '中央立柱',
    '右侧机器',
    '安全行动区',
    '吊链',
  ];
  const found = fixedAnchors.filter((anchor) => joined.includes(anchor));
  return Array.from(new Set(found)).slice(0, 8);
}

function inferCameraChanged(previous?: SpatialBlockingSnapshot | null, current?: SpatialBlockingSnapshot | null) {
  if (!previous?.cameraAxis || !current?.cameraAxis) return undefined;
  return previous.cameraAxis !== current.cameraAxis;
}

function getChoreographyStartBlocking(choreography?: Choreography | null): SpatialBlockingSnapshot | undefined {
  return choreography?.startBlocking ?? undefined;
}

function getChoreographyEndBlocking(choreography?: Choreography | null): SpatialBlockingSnapshot | undefined {
  return choreography?.endBlocking ?? undefined;
}

function buildFallbackWorldLock(storyboard: StoryboardState): StoryboardBoardWorldLock {
  const source = [
    storyboard.storyboard.scene,
    storyboard.prompt?.scene,
    storyboard.choreography?.sceneAnchor,
    storyboard.choreography?.startBlocking?.sceneAnchor,
    storyboard.choreography?.endBlocking?.sceneAnchor,
  ];
  const anchors = extractSceneAnchors(...source);
  return {
    sceneName: storyboard.storyboard.scene,
    masterScene: clipText(storyboard.prompt?.scene || storyboard.choreography?.sceneAnchor, 180),
    anchors: anchors.length > 0 ? anchors : ['ENTRY DOOR', 'EXIT DOOR', 'SAFE ACTION ZONE'],
    actionZone: storyboard.choreography?.sceneAnchor || storyboard.choreography?.endBlocking?.sceneAnchor || '',
    continuityNotes: '同一场景母版、空间锚点、材质、光线方向保持一致',
  };
}

function buildFallbackCameraPlan(storyboard: StoryboardState): StoryboardBoardCameraPlan {
  const cameraOverview = storyboard.choreography?.cameraOverview || storyboard.prompt?.cameraOverview || storyboard.storyboard.shotSize;
  return {
    cameraId: 'CAMERA 1',
    cameraAxis: storyboard.choreography?.cameraAxis || storyboard.choreography?.startBlocking?.cameraAxis || cameraOverview,
    cameraRelation: '按当前分镜机位关系拍摄；如换角度，只改变镜头观察方向，不改变世界站位',
    lensPlan: clipText(cameraOverview, 180),
    lightPlan: clipText(storyboard.choreography?.lightNotes || storyboard.prompt?.colorLighting, 180),
  };
}

function buildFallbackBlockingContinuity(storyboard: StoryboardState): StoryboardBoardBlockingContinuity {
  const previous = storyboard.continuityInput?.spatialBlocking;
  const start = getChoreographyStartBlocking(storyboard.choreography);
  const end = getChoreographyEndBlocking(storyboard.choreography) ?? storyboard.spatialBlocking;
  const currentStart = summarizeBlocking(start) || summarizeBlocking(previous) || '本镜起点承接剧本开场站位';
  const currentEnd = summarizeBlocking(end) || storyboard.lastFrameInfo || '本镜落点按九宫格第9格收束';
  return {
    previousEnd: summarizeBlocking(previous) || storyboard.continuityInput?.lastFrameInfo || '',
    currentStart,
    currentEnd,
    cameraChanged: inferCameraChanged(previous, start),
    cameraChangeReason: '同场景可切换正打、反打、侧拍或跟拍；世界站位以场景锚点承接',
    movementAxis: storyboard.choreography?.cameraAxis || start?.cameraAxis || end?.cameraAxis || '',
    startBlocking: start,
    endBlocking: end,
  };
}

const CHARACTER_APPEARANCE_DETAIL_PATTERN = /外貌特征|外貌|五官|脸型|发型|发饰|发髻|妆容|服装细节|服饰|配饰|耳饰|钗饰|衣料|肤色|面部轮廓|眉眼|鼻梁|唇形|发丝|全程(?:100%)?锁定/;

function buildCharacterReferenceSummary(references: StoryboardBoardReference[]) {
  return references
    .filter((reference) => reference.type === 'character')
    .map((reference) => {
      const contract = buildStoryboardReferenceReadingContract(reference);
      return `${reference.name}（${reference.refId}）：${contract.readFor}`;
    })
    .join('；');
}

function hasNoFaceReference(references: StoryboardBoardReference[]) {
  return references.some((reference) => reference.type === 'character' && reference.isNoFaceCharacterVisual);
}

function hasOutfitReference(references: StoryboardBoardReference[]) {
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

function buildStoryboardModePlanningContract(
  mode: StoryboardBoardMode,
  references: StoryboardBoardReference[],
  frameRatio?: string,
  sequenceContinuityContext?: StoryboardSequenceContinuityContext,
): StoryboardBoardPlanningContract {
  const isShotPlanMode = isShotPlanBoardMode(mode);
  const isSmartShotPlanMode = isSmartShotPlanBoardMode(mode);
  const usesOutfitReference = hasOutfitReference(references);
  const usesNoFaceReference = hasNoFaceReference(references);
  const hasPrevious = !!sequenceContinuityContext?.hasPrevious;
  const targetFrameRatio = getBoardFrameRatio(mode, frameRatio);
  const ratioGrammarRule = targetFrameRatio === '9:16'
    ? 'Target video frame is 9:16 vertical: prioritize readable face/upper-body emotional beats, center-safe blocking, vertical depth, and fewer wide horizontal tracking moves; do not leak horizontal-only camera grammar into the plan.'
    : 'Target video frame is 16:9 horizontal: use wider spatial blocking when useful, but keep protagonist reactions readable and do not end on isolated props.';

  return {
    mode,
    purpose: 'Plan one current storyboard/video shot. The plan must become a reliable Seedance storyboard reference and must not redesign Step3 assets.',
    planningOrder: [
      'Read every references[].readingContract before writing directorBrief, characterLocks, referencePriority, or panels.',
      'For director brief requests, first decide directorBrief.referenceBudget and directorBrief.referencePriority from story importance before any image-reference compression.',
      'Write directorBrief.referenceMatching for each reference using the same refId, name, readFor, and doNotUseFor logic.',
      'Lock scene, character, prop, camera axis, and cross-shot continuity before splitting panels.',
      'Split the shot into panel-level beats with one clear visual task per panel.',
      'Only then write panels, layoutRules, negativeRules, and continuity handoff fields.',
    ],
    referenceRules: [
      'Seedance video submission can use 9 image slots total. In storyboard-board mode, the generated storyboard board image reserves 1 slot, so Step3 references must be budgeted to at most 8 slots.',
      'directorBrief.referenceBudget must mark every candidate reference as mustKeep, preferKeep, or textFallback with one concise story reason. Use mustKeep only for scene/character/prop references whose visual identity directly changes this shot.',
      'directorBrief.referencePriority must order references from most important to least important for the current shot; later deterministic code will still enforce hard safety rules.',
      'directorBrief.referenceMatching must cover every usable reference by refId; do not merge multiple references just because the character name is the same.',
      'Character sheet references are identity/body/outfit locks only; never paste front/back/detail panels or character-sheet layout into the storyboard.',
      usesOutfitReference
        ? 'Selected outfit version references must lock outfit version consistency; never drift back to base outfit or default outfit.'
        : 'If no outfit variant reference is present, preserve the existing character clothing from the bound Step3 identity assets.',
      usesNoFaceReference
        ? 'For no-face character outfit/body references, read only clothing version, body proportion, material, silhouette, accessories, and equipment; do not read face, facial features, hairstyle, skin tone, or portrait identity.'
        : 'If an official portrait and a no-face outfit reference both exist, use the official portrait for identity and the no-face reference for outfit/body only.',
      'Scene references define spatial layout, scale, material, lighting direction, entrances/exits, action zone, and camera axis; they are not poster backgrounds.',
      'Prop references define shape, material, color, state, scale, and holder relation; they are not decorative clutter.',
    ],
    characterRules: [
      'characterLocks must include all non-background characters needed by the current shot and use Step3 refIds when available.',
      'primarySubject, secondarySubjects, mustShow, blocking, and continuity fields must keep character identity, side assignment, posture, and held props continuous.',
      'If a visible character appears in any panel, the exact character name must appear in primarySubject, secondarySubjects, mustShow, dialogue, or directorNote; do not rely only on pronouns or vague role labels.',
      'Do not rewrite facial features, hairstyle, skin tone, or costume descriptions in panels; refer to the locked Step3 asset contracts instead.',
      'Background people must stay vague silhouettes or blurred extras unless they have their own Step3 reference.',
    ],
    panelRules: [
      'Each panel needs primarySubject, secondarySubjects, mustShow, blocking, motion, cameraTask, continuityIn, continuityOut, dialogue, sfx, audio, and transition when the mode supports them.',
      'primarySubject must name the visible lead subject for that panel, not a mood label.',
      'blocking must describe where the subject is in the scene and how it relates to the scene anchor or prop.',
      'motion must describe the action change from the previous panel and should not repeat the same unchanged pose three panels in a row.',
      'S panels are action/state anchors, not automatic cut points. A continuous camera segment may cover multiple panels when blocking, acting, prop state, focus, or sound changes visibly.',
      'mustShow should list only visible story-critical elements that must appear in that panel.',
      'If the scene contains UI, countdown, task panels, or diegetic数字, directorContract.uiContinuity must explicitly define first-clear / later-blur-or-placeholder / no-random-digits strategy and the relevant panel text must echo that policy.',
      'If the scene contains a door, gate, entrance, threshold, broken glass boundary, elevator, hatch, or breach, directorContract.mechanismState must define an entrance state chain and the relevant panels must echo the same state in motion/continuityIn/continuityOut.',
      'If an action triggers a later result, such as kick, hit, smash, pull, press, plug, insert, bite, shoot, ignite, electrify, open, close, or break, at least one panel must show the visible contact/action frame before any result panel; do not jump from intention to aftermath.',
    ],
    continuityRules: [
      hasPrevious
        ? isShotPlanMode
          ? 'START FRAME / TRANSITION IN must visually inherit the previous storyboard final frame; S01 begins the current action after that bridge without recapping prior action.'
          : 'S01 must visually inherit the previous storyboard final frame before adding new movement.'
        : isShotPlanMode
          ? 'START FRAME establishes the incoming bridge, then S01 starts the current shot clearly without recapping unrelated prior action.'
          : 'S01 starts the current shot clearly without recapping unrelated prior action.',
      isShotPlanMode
        ? 'blockingContinuity.currentStart must support START FRAME -> S01 continuity; blockingContinuity.currentEnd must support final panel -> END BEAT handoff.'
        : 'blockingContinuity.currentStart must match S01; blockingContinuity.currentEnd must match the final panel.',
      'Keep camera axis, threshold/boundary direction, prop ownership, and posture progression coherent across panels.',
      'The final panel must reserve a usable handoff for the next storyboard when next continuity exists.',
    ],
    modeRules: isSmartShotPlanMode
      ? [
          'Use the input panelCount as an adaptive cinematic shot sheet: only 6, 9, 12, or 15 panels are valid.',
          'Before board planning, the director brief must choose recommendedPanelCount from story rhythm, dialogue density, action complexity, and continuity risk; duration is only a fallback.',
          'Use continuous S labels from S01 to the final S label; each panel represents one visible rhythm anchor, not a cut point and not necessarily exactly one second.',
          'START FRAME / TRANSITION IN is a bridge frame from the previous END BEAT into S01; it may use match cut, J-cut, L-cut, smash cut, montage, or a same-space pre-roll, and it must not be a duplicate crop of S01.',
          'END BEAT is a separate next-shot handoff after the final S panel; it may hold, settle, or reserve the next motion, and it must not be a duplicate crop of the final panel.',
          ratioGrammarRule,
          'directorContract is mandatory: spatialContract, characterZones, mechanismState, uiContinuity, beatProgression, startFrameContract, endBeatContract, and rejectionRules.',
        ]
      : isShotPlanMode
      ? [
          'Use S01-S15 as a 15-panel shot sheet; each panel is about one second of visible progression, but S labels are action/state anchors rather than cut points.',
          'START FRAME / TRANSITION IN is a bridge frame from the previous END BEAT into S01; it may use match cut, J-cut, L-cut, smash cut, montage, or a same-space pre-roll, and it must not be a duplicate crop of S01.',
          'END BEAT is a separate next-shot handoff after S15; it may hold, settle, or reserve the next motion, and it must not be a duplicate crop of S15.',
          ratioGrammarRule,
          'directorContract is mandatory: spatialContract, characterZones, mechanismState, uiContinuity, beatProgression, startFrameContract, endBeatContract, and rejectionRules.',
        ]
      : [
          'Use S01-S09 as a 3x3 storyboard board; panels must read left-to-right, top-to-bottom.',
          'The nine panels should cover setup, push, turn, reaction, consequence, and final handoff without becoming repeated crops.',
          'Every panel must be a complete keyframe, not a cropped fragment from one large image.',
        ],
    languageRules: [
      'JSON schema keys must stay in English, but every user-visible value must be written in Simplified Chinese.',
      'Panel fields such as primarySubject, blocking, motion, cameraTask, mustShow, dialogue, sfx, audio, transition, continuityIn, continuityOut, directorNote, directorBrief, directorContract, and transitionBridge must use Simplified Chinese text.',
      'Only fixed technical labels such as S01, START FRAME, END BEAT, L-cut, J-cut, match cut, and refId may stay in English.',
      'Do not output English prose like "NO DIALOGUE", "crowd gasp", or "core hum"; translate them into concise Chinese such as "无对白", "人群倒吸气", and "核心低鸣".',
    ],
    outputSchemaRules: [
      'Return valid JSON only. No Markdown fences, comments, prose, or trailing commas.',
      'For director brief requests, return directorBrief fields with referenceBudget, referencePriority, referenceMatching, styleStatement, cameraStrategy, soundStrategy, hookStrategy, and storyboardStrategy.',
      'For board plan requests, return the full StoryboardBoardPlan JSON shape including directorBrief, worldLock, blockingContinuity, cameraPlan, characterLocks, propLocks, referencePriority, layoutRules, negativeRules, and panels.',
      'panels must have continuous indexes and exactly match panelCount.',
    ],
    negativeRules: [
      'Do not create a poster, collage, moodboard, comic page, character sheet, scene design sheet, prop sheet, or pasted reference board.',
      'Do not invent unbound new main characters, new outfits, new props, unreadable UI text, random countdown digits, logos, subtitles, or watermarks.',
      'Do not solve visual continuity by writing long notes; the plan must use blocking, motion, cameraTask, continuityIn, and continuityOut.',
    ],
  };
}

function buildStoryboardActionDirectorContract(mode: StoryboardBoardMode) {
  const isShotPlanMode = isShotPlanBoardMode(mode);
  const isSmartShotPlanMode = isSmartShotPlanBoardMode(mode);
  return [
    'Revision scope is targeted: preserve the current plan unless a field creates blocking, prop, camera, entrance, trigger-contact, or panel-continuity risk.',
    'Prefer short executable wording over long explanations. Do not expand appearance, style, reference reading, or story background unless it fixes a concrete continuity risk.',
    'Keep output complete and schema-compatible, but focus edits on directorContract, blockingContinuity, cameraPlan, propLocks, negativeRules, and panel blocking/motion/cameraTask/transition/continuityIn/continuityOut/directorNote.',
    'Only revise the existing StoryboardBoardPlan into a video-executable action plan; do not change story facts, cast, scene, style, or reference IDs.',
    'Choose a clear camera grammar: one continuous shot, or a small number of intentional cuts. Panel transitions must match that grammar.',
    'Lock spatial zones before panel revisions: each visible character must have one zone, facing direction, entrance/exit state, and offscreen state when not visible.',
    'Lock prop ownership before panel revisions: every important prop has exactly one holder/location, one handoff moment, and no duplicate instances.',
    'For every reveal, late entrance, or hidden helper, write positive offscreen timing before first appearance; do not rely only on negative rules.',
    'Each panel must inherit the previous panel through continuityIn, blocking, motion, and continuityOut; no panel may restart the shot from a fresh pose.',
    'Reduce overloaded one-second beats by assigning only one primary action per panel and moving secondary reactions to audio, background, or the next panel.',
    'If a panel requires close-up insert, specify how the insert returns to the same spatial layout and does not create prop/character duplicates.',
    'For any door, gate, entrance, threshold, broken glass boundary, hatch, elevator, or breach, write a door/entry state chain in directorContract.mechanismState: S01-before state, which S panels visibly change it, which side/threshold is crossed, and final-S/end state. Echo the same state in the affected panels; never leave it only as a summary note.',
    'For every causal trigger action, write a visible contact frame. Examples: a boot must visibly hit the jukebox before sparks; a plug must visibly enter the bottle cap before electricity; a bottle must visibly enter the zombie mouth before explosion. Use adjacent panels for prepare -> contact -> result when needed.',
    isSmartShotPlanMode
      ? 'For smart-shot-plan-landscape, preserve the input panelCount and S01-final S label as the adaptive video execution card: START FRAME is the incoming bridge before S01, END BEAT is the outgoing handoff after the final S panel, and every panel advances cause-and-effect.'
      : isShotPlanMode
      ? 'For shot-plan-landscape, S01-S15 must be a 15-second video execution card: START FRAME is the incoming bridge before S01, END BEAT is the outgoing handoff after S15, and every second advances cause-and-effect.'
      : 'For nine-panel boards, S01-S09 must still preserve clear movement causality even though the panels are keyframes rather than every second.',
    'Output the same StoryboardBoardPlan JSON schema only. The revised plan must remain valid for both storyboard image generation and final Seedance video prompt generation.',
  ];
}

function clipStringArray(values: string[] | undefined, itemMaxLength: number, maxItems = values?.length ?? 0) {
  return (values ?? [])
    .slice(0, maxItems)
    .map((value) => clipText(value, itemMaxLength))
    .filter(Boolean);
}

function compactActionDirectorBrief(brief: StoryboardBoardDirectorBrief | undefined): StoryboardBoardDirectorBrief | undefined {
  if (!brief) return undefined;
  return {
    ...brief,
    styleStatement: clipText(brief.styleStatement, 220),
    cameraStrategy: clipText(brief.cameraStrategy, 260),
    soundStrategy: clipText(brief.soundStrategy, 220),
    hookStrategy: clipText(brief.hookStrategy, 180),
    storyboardStrategy: clipText(brief.storyboardStrategy, 260),
    panelCountReason: clipText(brief.panelCountReason, 180),
    referenceMatching: (brief.referenceMatching ?? []).map((match) => ({
      ...match,
      readFor: clipText(match.readFor, 140),
      doNotUseFor: clipText(match.doNotUseFor, 120),
    })),
    referenceBudget: (brief.referenceBudget ?? []).map((item) => ({
      ...item,
      reason: clipText(item.reason, 120),
    })),
    referencePriority: clipStringArray(brief.referencePriority, 80),
  };
}

function compactActionDirectorPanel(panel: StoryboardBoardPlanPanel): StoryboardBoardPlanPanel {
  return {
    ...panel,
    beat: clipText(panel.beat, 160),
    shotType: clipText(panel.shotType, 80),
    cameraAngle: clipText(panel.cameraAngle, 100),
    primarySubject: clipText(panel.primarySubject, 120),
    secondarySubjects: clipStringArray(panel.secondarySubjects, 90, 6),
    composition: clipText(panel.composition, 120),
    staticMoment: clipText(panel.staticMoment, 140),
    blocking: clipText(panel.blocking, 180),
    motion: clipText(panel.motion, 180),
    cameraTask: clipText(panel.cameraTask, 180),
    mustShow: clipStringArray(panel.mustShow, 120, 6),
    background: clipText(panel.background, 120),
    continuity: clipText(panel.continuity, 140),
    worldAnchor: clipText(panel.worldAnchor, 120),
    dialogue: clipText(panel.dialogue, 180),
    sfx: clipText(panel.sfx, 120),
    audio: clipText(panel.audio, 140),
    transition: clipText(panel.transition, 120),
    dialoguePerformance: clipText(panel.dialoguePerformance, 140),
    continuityIn: clipText(panel.continuityIn, 160),
    continuityOut: clipText(panel.continuityOut, 160),
    directorNote: clipText(panel.directorNote, 180),
  };
}

function compactStoryboardBoardPlanForActionDirector(plan: StoryboardBoardPlan): StoryboardBoardPlan {
  return {
    ...plan,
    directorBrief: compactActionDirectorBrief(plan.directorBrief),
    boardGoal: clipText(plan.boardGoal, 160),
    sceneAnchor: clipText(plan.sceneAnchor, 180),
    styleAnchor: clipText(plan.styleAnchor, 160),
    transitionBridge: plan.transitionBridge
      ? {
          ...plan.transitionBridge,
          previousEndBeat: clipText(plan.transitionBridge.previousEndBeat, 160),
          transitionType: clipText(plan.transitionBridge.transitionType, 80),
          transitionRationale: clipText(plan.transitionBridge.transitionRationale, 160),
          visualBridge: clipText(plan.transitionBridge.visualBridge, 160),
          soundBridge: clipText(plan.transitionBridge.soundBridge, 140),
          cameraBridge: clipText(plan.transitionBridge.cameraBridge, 140),
          firstFrameInstruction: clipText(plan.transitionBridge.firstFrameInstruction, 180),
        }
      : undefined,
    directorContract: plan.directorContract
      ? {
          ...plan.directorContract,
          spatialContract: clipText(plan.directorContract.spatialContract, 220),
          characterZones: clipStringArray(plan.directorContract.characterZones, 160, 8),
          mechanismState: clipText(plan.directorContract.mechanismState, 260),
          uiContinuity: clipText(plan.directorContract.uiContinuity, 180),
          beatProgression: clipText(plan.directorContract.beatProgression, 220),
          startFrameContract: clipText(plan.directorContract.startFrameContract, 180),
          endBeatContract: clipText(plan.directorContract.endBeatContract, 180),
          rejectionRules: clipStringArray(plan.directorContract.rejectionRules, 160, 8),
        }
      : undefined,
    worldLock: {
      ...plan.worldLock,
      sceneName: clipText(plan.worldLock.sceneName, 100),
      masterScene: clipText(plan.worldLock.masterScene, 180),
      anchors: clipStringArray(plan.worldLock.anchors, 120, 8),
      actionZone: clipText(plan.worldLock.actionZone, 160),
      continuityNotes: clipText(plan.worldLock.continuityNotes, 180),
    },
    blockingContinuity: {
      ...plan.blockingContinuity,
      previousEnd: clipText(plan.blockingContinuity.previousEnd, 160),
      currentStart: clipText(plan.blockingContinuity.currentStart, 180),
      currentEnd: clipText(plan.blockingContinuity.currentEnd, 180),
      cameraChangeReason: clipText(plan.blockingContinuity.cameraChangeReason, 140),
      movementAxis: clipText(plan.blockingContinuity.movementAxis, 140),
    },
    cameraPlan: {
      ...plan.cameraPlan,
      cameraId: clipText(plan.cameraPlan.cameraId, 80),
      cameraAxis: clipText(plan.cameraPlan.cameraAxis, 160),
      cameraRelation: clipText(plan.cameraPlan.cameraRelation, 180),
      lensPlan: clipText(plan.cameraPlan.lensPlan, 160),
      lightPlan: clipText(plan.cameraPlan.lightPlan, 160),
    },
    consistencyRules: clipStringArray(plan.consistencyRules, 160, 6),
    characterLocks: plan.characterLocks.map((lock) => ({
      ...lock,
      name: clipText(lock.name, 80),
      mustKeep: clipStringArray(lock.mustKeep, 100, 5),
    })),
    propLocks: clipStringArray(plan.propLocks, 140, 8),
    referencePriority: clipStringArray(plan.referencePriority, 80),
    layoutRules: clipStringArray(plan.layoutRules, 160, 6),
    negativeRules: clipStringArray(plan.negativeRules, 180, 8),
    panels: plan.panels.map(compactActionDirectorPanel),
  };
}

function stripCharacterAppearanceText(value: string | undefined) {
  const source = value ?? '';
  if (!source.trim()) return '';

  const sections = source.split(/\n\s*\*\*\*\s*\n/g);

  if (sections.length <= 1) {
    return source;
  }

  return sections
    .filter((section) => {
      const normalized = compactWhitespace(section);
      if (!normalized) return false;
      const referenceMentions = normalized.match(/参考图片\d+/g) ?? [];
      return !(referenceMentions.length > 0 && CHARACTER_APPEARANCE_DETAIL_PATTERN.test(normalized));
    })
    .join('\n***\n');
}

function normalizeBoardRule(rule: string) {
  if (/角色|人物/.test(rule) && /外貌|五官|脸型|发型|发饰|发髻|妆容|服装|服饰|配饰/.test(rule)) {
    return '同一角色在所有格中只按绑定参考图锁定身份，不用文字重写外貌';
  }
  return rule;
}

function normalizeBoardRules(value: unknown, maxLength: number) {
  const seen = new Set<string>();
  return asStringArray(value, maxLength)
    .map(normalizeBoardRule)
    .filter((rule) => {
      if (!rule || seen.has(rule)) return false;
      seen.add(rule);
      return true;
    });
}

function sanitizeStaticText(value: string | undefined, maxLength: number) {
  let normalized = compactWhitespace(value)
    .replace(/音效[:：][^。；]*[。；]?/g, '')
    .replace(/内心独白[^。；]*[。；]?/g, '')
    .replace(/全程闭唇[^。；]*[。；]?/g, '')
    .replace(/无任何口型动作[^。；]*[。；]?/g, '')
    .replace(/[“"][^”"]{1,80}[”"]/g, '')
    .replace(/每秒\d+(?:\.\d+)?(?:厘米|米|帧)/g, '')
    .replace(/稳定性\d+%/g, '')
    .replace(/\d+(?:\.\d+)?秒(?:内|后)?/g, '')
    .replace(/无特效/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const clauses = normalized
    .split(/([，；。])/)
    .reduce<string[]>((result, part, index, array) => {
      if (index % 2 === 0) {
        const next = array[index + 1] ?? '';
        result.push(`${part}${next}`.trim());
      }
      return result;
    }, [])
    .filter((clause) => clause && !CHARACTER_APPEARANCE_DETAIL_PATTERN.test(clause));
  normalized = clauses.join('').trim();

  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

function sanitizeBoardInfoText(value: string | undefined, maxLength: number) {
  const normalized = compactWhitespace(value)
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

function extractDialogueSnippets(...sources: Array<string | undefined>) {
  const joined = sources.filter(Boolean).join('\n');
  const snippets: string[] = [];
  const patterns = [
    /“([^”\n]{1,80})”/g,
    /"([^"\n]{1,80})"/g,
    /「([^」\n]{1,80})」/g,
    /『([^』\n]{1,80})』/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(joined)) !== null) {
      const value = compactWhitespace(match[1]);
      if (value && !snippets.includes(value)) snippets.push(value);
      if (snippets.length >= 3) return snippets;
    }
  }

  return snippets;
}

function inferDialogue(
  storyboard: StoryboardState,
  actionDesc: string | undefined,
  panelIndex: number,
) {
  const snippets = extractDialogueSnippets(actionDesc, storyboard.correctedScript, storyboard.prompt?.rawText);
  if (snippets.length > 0) {
    const selected = snippets[Math.min(snippets.length - 1, panelIndex % snippets.length)];
    return sanitizeBoardInfoText(`"${selected}"`, 90);
  }
  const performance = storyboard.sceneBlueprint?.dialoguePerformance
    || storyboard.choreography?.timeSegments?.find((segment) => segment.dialoguePerformance)?.dialoguePerformance;
  if (performance) return sanitizeBoardInfoText(`表演对白节奏：${performance}`, 90);
  return 'NO DIALOGUE / 表情和呼吸推进';
}

function inferSfx(
  storyboard: StoryboardState,
  segment: { soundEffect?: string } | undefined,
  panelIndex: number,
) {
  const promptSfx = typeof segment === 'object' && segment && 'soundEffect' in segment
    ? sanitizeBoardInfoText((segment as { soundEffect?: string }).soundEffect, 90)
    : '';
  const choreoSfx = storyboard.choreography?.timeSegments?.[panelIndex % Math.max(1, storyboard.choreography.timeSegments.length)]?.sound;
  return promptSfx || sanitizeBoardInfoText(choreoSfx, 90) || 'ROOM TONE / subtle movement';
}

function inferAudio(
  storyboard: StoryboardState,
  panelIndex: number,
) {
  const segment = storyboard.choreography?.timeSegments?.[panelIndex % Math.max(1, storyboard.choreography.timeSegments.length)];
  const bgm = segment?.bgm || storyboard.audioMix?.bgm?.name;
  const rhythm = segment?.rhythm || storyboard.choreography?.overallRhythm;
  return sanitizeBoardInfoText([bgm ? `BGM ${bgm}` : '', rhythm ? `rhythm ${rhythm}` : 'natural sync audio'].filter(Boolean).join(' / '), 90);
}

function inferTransition(
  panelIndex: number,
  panelCount: number,
  storyboard: StoryboardState,
) {
  if (panelIndex === 0) return 'CUT IN / establish';
  if (panelIndex === panelCount - 1) return storyboard.choreography?.transitionType
    ? sanitizeBoardInfoText(`END / ${storyboard.choreography.transitionType}`, 70)
    : 'END HOLD / handoff';
  if (panelIndex === Math.floor(panelCount / 2)) return 'TURN / emphasis cut';
  return 'CUT / continue';
}

function inferCameraAngle(cameraShot: string | undefined) {
  const source = cameraShot ?? '';
  if (source.includes('俯拍') || source.includes('高位')) return '高位俯拍';
  if (source.includes('仰拍')) return '低位仰拍';
  if (source.includes('顶拍')) return '顶拍';
  if (source.includes('侧拍')) return '侧向观察';
  if (source.includes('背拍')) return '背向跟随';
  return '平视或轻微偏侧';
}

function inferShotType(cameraShot: string | undefined) {
  const source = sanitizeStaticText(cameraShot, 42);
  if (!source) return '中近景';
  return source;
}

function inferPrimarySubject(storyboard: StoryboardState, references: StoryboardBoardReference[]) {
  const firstCharacter = references.find((reference) => reference.type === 'character');
  if (firstCharacter) return firstCharacter.name;
  const sceneRef = references.find((reference) => reference.type === 'scene');
  if (sceneRef) return sceneRef.name;
  return storyboard.storyboard.name || '当前分镜主体';
}

function getBoardFrameRatio(mode: StoryboardBoardMode, frameRatio?: string) {
  if (isShotPlanBoardMode(mode)) return '16:9';
  if (mode === 'nine-landscape') return '16:9';
  if (frameRatio === '16:9' || frameRatio === '9:16') return frameRatio;
  return '9:16';
}

function getDefaultBoardLayoutRules(mode: StoryboardBoardMode, frameRatio?: string, panelCount?: number) {
  if (isFixedShotPlanBoardMode(mode)) {
    const targetFrameRatio = getBoardFrameRatio(mode, frameRatio);
    return [
      `整张 Shot Sheet 必须跟随当前视频画幅 ${targetFrameRatio}`,
      targetFrameRatio === '16:9'
        ? '直接生成一张固定版式详细 storyboard sheet：顶部标题/START FRAME横幅 + 固定5列×3行十五格，S01-S05 / S06-S10 / S11-S15 从左到右、从上到下阅读；该要求只约束导演板排版，不改变项目视觉风格'
        : '直接生成一张固定版式详细 storyboard sheet：顶部标题/START FRAME横幅 + 十五格，S01-S15 按阅读顺序连续推进；该要求只约束导演板排版，不改变项目视觉风格',
      '每格上半部是电影关键帧，下半部是黑底信息条，包含 TIME / CAMERA / ACTION / SOUND / TRANSITION',
      'S01-S15 必须覆盖完整 15 秒时间线，每格约 1 秒；S01 是 START FRAME 后的第一动作锚点，S15 是 END BEAT 前的尾动作锚点',
      '顶部 START FRAME 必须是 S01 前的入场桥接帧，承接上一镜 END BEAT 或专业转场，并说明如何进入 S01；不得只是 S01 重复裁图',
      '底部 END BEAT 必须是 S15 后的下一镜交接落幅，可来自 S15 余势、停顿、关键道具、最后接力物或最终情绪；不得只是 S15 重复裁图',
      '右下角 END BEAT footer 栏必须有一个独立小缩略图，画 S15 后的交接落幅，不能只有文字；它会成为下一分镜 START FRAME 的规划来源',
    ];
  }

  if (isSmartShotPlanBoardMode(mode)) {
    const count = panelCount ?? getStoryboardBoardExpectedPanelCount(mode);
    const finalLabel = formatStoryboardPanelLabel(count);
    return [
      '整张智能故事板必须是 16:9 横向详细 storyboard sheet',
      `智能格数为 ${count} 格，排版为 ${getSmartStoryboardLayoutRule(count)}`,
      `S01 是 START FRAME 后的第一动作锚点，${finalLabel} 是 END BEAT 前的尾动作锚点`,
      `顶部 START FRAME 必须是进入 S01 前的桥接帧；底部 END BEAT 必须是 ${finalLabel} 后的下一镜交接落幅；二者都不得重复裁图`,
      '每格上半部是电影关键帧，下半部是黑底信息条，包含 TIME / CAMERA / ACTION / SOUND / TRANSITION',
      '智能格数只改变节奏密度，不改变项目视觉风格，也不复制 Step3 参考图版式',
    ];
  }

  return [
    mode === 'nine-landscape'
      ? '每格必须是完整独立的 16:9 横版静帧'
      : '每格必须是完整独立的 9:16 竖屏静帧',
    '主主体清晰可读，不跨格',
    '按 1 到 N 顺序连续推进',
  ];
}

function buildFallbackCharacterLocks(references: StoryboardBoardReference[]): StoryboardBoardPlanCharacterLock[] {
  const characterRefs = references.filter((reference) => reference.type === 'character');
  return characterRefs.map((reference, index) => {
    const contract = buildStoryboardReferenceReadingContract(reference);
    return {
      refId: reference.refId,
      name: reference.name,
      role: index === 0 ? 'primary' : index < 3 ? 'secondary' : 'background',
      mustKeep: contract.mustKeep,
    };
  });
}

function buildFallbackPanels(
  storyboard: StoryboardState,
  references: StoryboardBoardReference[],
  mode: StoryboardBoardMode,
  panelCount = getStoryboardBoardExpectedPanelCount(mode, storyboard.storyboard.duration),
): StoryboardBoardPlanPanel[] {
  const segments = storyboard.prompt?.timeSegments ?? [];
  const fallbackPrimarySubject = inferPrimarySubject(storyboard, references);
  const fallbackSecondarySubjects = references
    .filter((reference) => reference.type === 'character')
    .map((reference) => reference.name)
    .filter((name) => name !== fallbackPrimarySubject)
    .slice(0, 2);
  const mustShow = references.slice(0, 4).map((reference) => reference.name);
  const totalSegments = Math.max(segments.length, 1);
  const fallbackWorldLock = buildFallbackWorldLock(storyboard);
  const fallbackCameraPlan = buildFallbackCameraPlan(storyboard);
  const fallbackContinuity = buildFallbackBlockingContinuity(storyboard);
  const primaryWorldAnchor = fallbackWorldLock.anchors[0] ?? storyboard.choreography?.sceneAnchor ?? storyboard.storyboard.scene ?? '';

  return Array.from({ length: panelCount }, (_, panelIndex) => {
    const segment = segments[Math.min(totalSegments - 1, Math.floor((panelIndex * totalSegments) / panelCount))];
    const cameraShot = segment?.cameraShot ?? storyboard.prompt?.cameraOverview ?? storyboard.storyboard.shotSize;
    const actionDesc = segment?.actionDesc ?? storyboard.correctedScript ?? storyboard.prompt?.scene ?? storyboard.storyboard.name;
    const isFirst = panelIndex === 0;
    const isLast = panelIndex === panelCount - 1;

    return {
      index: panelIndex + 1,
      timeRange: segment?.timeRange,
      beat: segment?.timeRange ? `${segment.timeRange} 关键静帧` : `关键静帧 ${panelIndex + 1}`,
      shotType: inferShotType(cameraShot),
      cameraAngle: inferCameraAngle(cameraShot),
      primarySubject: fallbackPrimarySubject,
      secondarySubjects: fallbackSecondarySubjects,
      composition: clipText(cameraShot, 72) || '主主体居中，保留明确前中后景层次与竖向纵深',
      staticMoment: sanitizeStaticText(actionDesc, 120) || '提取当前分镜最清晰、最可延展的静态关键瞬间',
      blocking: '按当前分镜空间关系保持人物落位和朝向连续',
      motion: sanitizeStaticText(actionDesc, 90),
      cameraTask: clipText(cameraShot, 90),
      mustShow,
      background: clipText(storyboard.prompt?.scene, 80) || '背景维持当前分镜场景与空间关系，不做额外扩展',
      continuity: '角色造型、关键道具、场景材质、光线方向必须保持连续一致',
      worldAnchor: primaryWorldAnchor,
      dialogue: inferDialogue(storyboard, actionDesc, panelIndex),
      sfx: inferSfx(storyboard, segment, panelIndex),
      audio: inferAudio(storyboard, panelIndex),
      transition: inferTransition(panelIndex, panelCount, storyboard),
      dialoguePerformance: storyboard.sceneBlueprint?.dialoguePerformance || storyboard.choreography?.timeSegments?.[0]?.dialoguePerformance || '如有对白，只保留说话节奏、表情和口型方向，不把台词写进图内',
      continuityIn: isFirst ? fallbackContinuity.previousEnd || fallbackContinuity.currentStart : `承接第${panelIndex}格落幅`,
      continuityOut: isLast ? fallbackContinuity.currentEnd : `落到第${panelIndex + 2}格动作起点`,
      directorNote: [
        isFirst ? '起势格：明确本镜起点和场景方向' : '',
        isLast ? '落幅格：明确下一镜可承接的站位和情绪' : '',
        fallbackCameraPlan.cameraId ? `${fallbackCameraPlan.cameraId} ${fallbackCameraPlan.cameraRelation ?? ''}` : '',
      ].filter(Boolean).join('；') || '按开发板逐格连续推进',
    };
  });
}

function extractJsonBlock(text: string) {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) return fencedMatch[1].trim();

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('LLM 未返回可解析的 JSON 规划');
  }
  return text.slice(firstBrace, lastBrace + 1);
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? compactWhitespace(value) || fallback : fallback;
}

function asStringArray(value: unknown, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => compactWhitespace(item))
    .filter(Boolean)
    .slice(0, maxLength);
}

function normalizeSmartPanelCount(value: unknown): 6 | 9 | 12 | 15 | undefined {
  const numericValue = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(numericValue)) return undefined;
  return SMART_STORYBOARD_PANEL_COUNTS.includes(numericValue as 6 | 9 | 12 | 15)
    ? numericValue as 6 | 9 | 12 | 15
    : undefined;
}

function normalizeSmartDurationSeconds(value: unknown, fallback?: number): number | undefined {
  const numericValue = typeof value === 'string' ? Number(value.trim()) : Number(value);
  const resolved = Number.isFinite(numericValue) ? numericValue : fallback;
  if (resolved === undefined || !Number.isFinite(resolved)) return undefined;
  return Math.max(4, Math.min(15, Math.round(resolved)));
}

function normalizeRhythmValue(value: string | undefined) {
  return value?.toLowerCase().trim() ?? '';
}

function inferSmartPanelCountFromRhythm(
  rhythm: Pick<StoryboardBoardDirectorBrief, 'paceLevel' | 'beatDensity' | 'dialogueDensity' | 'actionComplexity' | 'continuityRisk'>,
  fallbackCount: 6 | 9 | 12 | 15,
): 6 | 9 | 12 | 15 {
  const values = [
    rhythm.beatDensity,
    rhythm.dialogueDensity,
    rhythm.actionComplexity,
    rhythm.continuityRisk,
  ].map(normalizeRhythmValue);
  const lowCount = values.filter((value) => value.includes('low') || value.includes('低')).length;
  const highCount = values.filter((value) => value.includes('high') || value.includes('高')).length;
  const pace = normalizeRhythmValue(rhythm.paceLevel);

  if (lowCount >= 3 && !pace.includes('fast') && !pace.includes('high') && !pace.includes('快')) return 6;
  if (highCount >= 3) return 15;
  if (highCount >= 2 || pace.includes('fast') || pace.includes('high') || pace.includes('快')) {
    return fallbackCount >= 12 ? fallbackCount : 12;
  }
  return fallbackCount;
}

function getStoryboardRequestPanelCount(
  mode: StoryboardBoardMode,
  durationText?: string,
  directorBrief?: StoryboardBoardDirectorBrief,
  smartPanelCountPreference?: SmartStoryboardPanelCountPreference,
) {
  const lockedPanelCount = isSmartShotPlanBoardMode(mode)
    ? getLockedSmartStoryboardPanelCount(smartPanelCountPreference)
    : undefined;
  const recommendedPanelCount = isSmartShotPlanBoardMode(mode)
    ? lockedPanelCount ?? normalizeSmartPanelCount(directorBrief?.recommendedPanelCount)
    : undefined;
  return getStoryboardBoardExpectedPanelCount(mode, durationText, recommendedPanelCount);
}

function sanitizePlanVisualText(value: string, fallback = '') {
  const cleaned = sanitizeStaticText(value, 220);
  if (cleaned && !CHARACTER_APPEARANCE_DETAIL_PATTERN.test(cleaned)) return cleaned;
  const fallbackCleaned = sanitizeStaticText(fallback, 220);
  if (fallbackCleaned && !CHARACTER_APPEARANCE_DETAIL_PATTERN.test(fallbackCleaned)) return fallbackCleaned;
  return cleaned || fallbackCleaned;
}

function normalizeReferenceContractText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function mergeReferenceContractText(value: string, fallback = '') {
  const cleaned = sanitizePlanVisualText(value, fallback);
  const fallbackCleaned = sanitizePlanVisualText(fallback, '');
  if (!cleaned || !fallbackCleaned) return cleaned || fallbackCleaned;

  const normalized = normalizeReferenceContractText(cleaned);
  const fallbackNormalized = normalizeReferenceContractText(fallbackCleaned);
  if (normalized.includes(fallbackNormalized) || fallbackNormalized.includes(normalized)) {
    return cleaned.length >= fallbackCleaned.length ? cleaned : fallbackCleaned;
  }

  const merged = sanitizeStaticText(`${cleaned} Contract: ${fallbackCleaned}`, 520);
  return merged || fallbackCleaned;
}

function sanitizePlanVisualArray(value: string[], fallback: string[] = []) {
  const cleaned = value
    .map((item) => sanitizeStaticText(item, 80))
    .filter((item) => item && !CHARACTER_APPEARANCE_DETAIL_PATTERN.test(item));
  if (cleaned.length > 0) return cleaned;
  return fallback
    .map((item) => sanitizeStaticText(item, 80))
    .filter((item) => item && !CHARACTER_APPEARANCE_DETAIL_PATTERN.test(item));
}

function getReferenceBriefTypeLabel(type: StoryboardBoardReference['type']) {
  if (type === 'scene') return 'scene';
  if (type === 'prop') return 'prop';
  return 'character';
}

function getReferenceTypeFromBriefType(type: string | undefined): StoryboardBoardReference['type'] {
  if (type === 'scene' || type === 'prop') return type;
  return 'character';
}

function buildFallbackReferenceMatches(references: StoryboardBoardReference[]): StoryboardBoardDirectorBriefReferenceMatch[] {
  return references.map((reference) => {
    const type = getReferenceBriefTypeLabel(reference.type);
    const contract = buildStoryboardReferenceReadingContract(reference);
    return {
      refId: reference.refId,
      name: reference.name,
      type,
      readFor: contract.readFor,
      doNotUseFor: contract.doNotUseFor,
    };
  });
}

function getReferenceIdNumber(value: string | undefined) {
  return value?.match(/\d+/)?.[0] ?? '';
}

function isSameReferenceId(left: string | undefined, right: string | undefined) {
  const leftClean = normalizeReferenceContractText(left ?? '');
  const rightClean = normalizeReferenceContractText(right ?? '');
  if (!leftClean || !rightClean) return false;
  if (leftClean === rightClean) return true;

  const leftNumber = getReferenceIdNumber(leftClean);
  const rightNumber = getReferenceIdNumber(rightClean);
  if (!leftNumber || leftNumber !== rightNumber) return false;

  return /图|圖片|图片|image|ref|reference|参考/i.test(leftClean + rightClean);
}

function findReferenceByLooseIdentity(
  rawRefId: string | undefined,
  rawName: string | undefined,
  rawType: string | undefined,
  references: StoryboardBoardReference[],
): StoryboardBoardReference | undefined {
  if (rawRefId) {
    const byRefId = references.find((reference) => isSameReferenceId(reference.refId, rawRefId));
    if (byRefId) return byRefId;
  }

  const normalizedName = normalizeReferenceContractText(rawName ?? '');
  const normalizedType = normalizeReferenceContractText(rawType ?? '');
  if (!normalizedName) return undefined;

  return references.find((reference) =>
    normalizeReferenceContractText(reference.name) === normalizedName
    && (!normalizedType || normalizeReferenceContractText(getReferenceBriefTypeLabel(reference.type)) === normalizedType),
  );
}

function buildFallbackReferencePriority(references: StoryboardBoardReference[]) {
  return references.map((reference) => reference.refId);
}

function buildFallbackReferenceBudget(references: StoryboardBoardReference[]): StoryboardBoardReferenceBudgetItem[] {
  return references.map((reference) => ({
    refId: reference.refId,
    name: reference.name,
    type: getReferenceBriefTypeLabel(reference.type),
    decision: reference.type === 'prop' ? 'preferKeep' : 'mustKeep',
    reason: reference.type === 'scene'
      ? '锁定本镜空间、光线和机位基础。'
      : reference.type === 'character'
      ? '锁定本镜可见人物身份。'
      : '道具进入本镜预算时优先保持外观一致。',
  }));
}

function normalizeReferenceBudgetDecision(value: unknown): StoryboardBoardReferenceBudgetItem['decision'] {
  if (value === 'mustKeep' || value === 'preferKeep' || value === 'textFallback') return value;
  return 'preferKeep';
}

function normalizeDirectorReferencePriority(
  value: unknown,
  fallback: string[],
  references: StoryboardBoardReference[],
) {
  if (!Array.isArray(value)) return fallback;

  const normalized: string[] = [];
  value.forEach((item) => {
    const rawRefId = asString(item);
    const reference = findReferenceByLooseIdentity(rawRefId, undefined, undefined, references);
    const refId = reference?.refId;
    if (refId && !normalized.includes(refId)) {
      normalized.push(refId);
    }
  });

  fallback.forEach((refId) => {
    if (!normalized.includes(refId)) normalized.push(refId);
  });
  return normalized;
}

function normalizeReferenceBudget(
  value: unknown,
  fallback: StoryboardBoardReferenceBudgetItem[],
  references: StoryboardBoardReference[],
) {
  if (!Array.isArray(value)) return fallback;

  const normalized: StoryboardBoardReferenceBudgetItem[] = [];
  const seen = new Set<string>();

  value.forEach((item) => {
    const raw = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const reference = findReferenceByLooseIdentity(
      asString(raw.refId),
      asString(raw.name),
      asString(raw.type),
      references,
    );
    if (!reference || seen.has(reference.refId)) return;
    seen.add(reference.refId);
    normalized.push({
      refId: reference.refId,
      name: reference.name,
      type: getReferenceBriefTypeLabel(reference.type),
      decision: normalizeReferenceBudgetDecision(raw.decision),
      reason: sanitizePlanVisualText(
        asString(raw.reason),
        fallback.find((fallbackItem) => fallbackItem.refId === reference.refId)?.reason ?? '按当前剧情重要性参与参考图预算。',
      ),
    });
  });

  fallback.forEach((fallbackItem) => {
    if (!seen.has(fallbackItem.refId)) {
      normalized.push(fallbackItem);
      seen.add(fallbackItem.refId);
    }
  });

  return normalized;
}

function normalizeReferenceMatch(
  value: unknown,
  fallback?: StoryboardBoardDirectorBriefReferenceMatch,
): StoryboardBoardDirectorBriefReferenceMatch | null {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const name = asString(raw.name, fallback?.name ?? '');
  const type = asString(raw.type, fallback?.type ?? 'reference');
  const readFor = mergeReferenceContractText(asString(raw.readFor, fallback?.readFor ?? ''), fallback?.readFor ?? '');
  if (!name || !readFor) return fallback ?? null;
  return {
    refId: asString(raw.refId, fallback?.refId ?? ''),
    name,
    type,
    readFor,
    doNotUseFor: mergeReferenceContractText(asString(raw.doNotUseFor, fallback?.doNotUseFor ?? ''), fallback?.doNotUseFor ?? ''),
  };
}

function getReferenceMatchIdentity(match: StoryboardBoardDirectorBriefReferenceMatch): string {
  if (match.refId) return `ref:${normalizeReferenceContractText(match.refId)}`;
  return `name:${normalizeReferenceContractText(match.name)}|type:${normalizeReferenceContractText(match.type)}`;
}

function findFallbackReferenceMatch(
  value: unknown,
  fallbackMatches: StoryboardBoardDirectorBriefReferenceMatch[],
  index: number,
): StoryboardBoardDirectorBriefReferenceMatch | undefined {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawRefId = asString(raw.refId);
  if (rawRefId) {
    return fallbackMatches.find((match) =>
      isSameReferenceId(match.refId, rawRefId),
    );
  }

  const rawName = asString(raw.name);
  const rawType = asString(raw.type);
  if (rawName) {
    const byNameAndType = fallbackMatches.find((match) =>
      normalizeReferenceContractText(match.name) === normalizeReferenceContractText(rawName)
      && (!rawType || normalizeReferenceContractText(match.type) === normalizeReferenceContractText(rawType)),
    );
    if (byNameAndType) return byNameAndType;
  }

  return fallbackMatches[index];
}

function buildFallbackDirectorBrief(
  storyboard: StoryboardState,
  references: StoryboardBoardReference[],
  mode: StoryboardBoardMode,
  cameraPlan: StoryboardBoardCameraPlan,
  blockingContinuity: StoryboardBoardBlockingContinuity,
  panelCount = getStoryboardBoardExpectedPanelCount(mode, storyboard.storyboard.duration),
): StoryboardBoardDirectorBrief {
  const modeSpec = getStoryboardBoardModeSpec(mode);
  const sourceText = getStoryboardPlanningSourceText(storyboard);
  const soundSource = [
    storyboard.choreography?.overallRhythm,
    ...(storyboard.choreography?.timeSegments ?? []).map((segment) => segment.sound),
    ...(storyboard.prompt?.timeSegments ?? []).map((segment) => segment.soundEffect),
  ].filter(Boolean).join('；');
  const hookSource = [
    storyboard.storyboard.name,
    storyboard.correctedScript,
    blockingContinuity.currentEnd,
  ].filter(Boolean).join('；');

  const brief: StoryboardBoardDirectorBrief = {
    styleStatement: sanitizePlanVisualText(
      `${storyboard.sceneBlueprint?.emotionArc ?? storyboard.choreography?.overallRhythm ?? storyboard.storyboard.name}；${storyboard.choreography?.lightNotes ?? storyboard.prompt?.colorLighting ?? '按当前分镜光色'}；只服务当前单镜可拍执行。`,
      '先锁当前单镜的影像气质、光色和表演方向，再进入导演板拆分。',
    ),
    referenceMatching: buildFallbackReferenceMatches(references),
    referenceBudget: buildFallbackReferenceBudget(references),
    referencePriority: buildFallbackReferencePriority(references),
    cameraStrategy: sanitizePlanVisualText(
      [cameraPlan.cameraRelation, cameraPlan.lensPlan, cameraPlan.cameraAxis].filter(Boolean).join('；'),
      '先锁机位轴线、景别推进、人物站位和首尾落幅，再拆成逐格关键帧。',
    ),
    soundStrategy: sanitizePlanVisualText(
      soundSource,
      '提前定义对白口型、环境声、动作音效、BGM 压强和必要声音桥；画面内不新增字幕。',
    ),
    hookStrategy: sanitizePlanVisualText(
      hookSource,
      '0-3 秒必须给出当前镜可见钩子，尾格必须留下下一镜能继承的动作、物件或情绪落点。',
    ),
    storyboardStrategy: isSmartShotPlanBoardMode(mode)
      ? sanitizePlanVisualText(
          `${panelCount} 格按 S01-${formatStoryboardPanelLabel(panelCount)} 推进；START FRAME 是上一镜落幅进入 S01 的转场桥，不等于 S01；${formatStoryboardPanelLabel(panelCount)} 后另设 END BEAT 作为下一镜交接落幅，不等于最后一格复制。`,
          `${panelCount} 格按剧情密度与可见节拍拆分，首尾桥接独立于宫格本体。`,
        )
      : isShotPlanBoardMode(mode)
      ? sanitizePlanVisualText(
          `${panelCount} 格按 S01-${formatStoryboardPanelLabel(panelCount)} 推进；START FRAME 是 S01 前的入场桥，${formatStoryboardPanelLabel(panelCount)} 后另设 END BEAT 作为下一镜交接落幅，关键转折必须落到具体 panel。`,
          `${panelCount} 格按可见 beat 拆分，不用重复构图吞掉节拍。`,
        )
      : sanitizePlanVisualText(
          `${modeSpec.panelCount} 格按起势、推进、转折、反应、落幅拆分；每格只承担一个主视觉任务。${sourceText ? '' : ''}`,
          '9 格按起势、推进、转折、反应、落幅拆分，每格只承担一个主视觉任务。',
        ),
  };

  if (!isSmartShotPlanBoardMode(mode)) return brief;

  const durationSeconds = parseStoryboardDurationSeconds(storyboard.storyboard.duration);
  const safePanelCount: 6 | 9 | 12 | 15 = normalizeSmartPanelCount(panelCount)
    ?? normalizeSmartPanelCount(getStoryboardBoardExpectedPanelCount(mode, storyboard.storyboard.duration))
    ?? 15;
  return {
    ...brief,
    sceneType: storyboard.sceneBlueprint?.sceneType ?? 'mixed',
    paceLevel: storyboard.choreography?.overallRhythm ? 'medium' : 'medium',
    beatDensity: safePanelCount >= 12 ? 'high' : safePanelCount >= 9 ? 'medium' : 'low',
    dialogueDensity: (storyboard.prompt?.timeSegments ?? []).some((segment) => /对白|台词|说|喊|问|答/.test(segment.soundEffect ?? segment.actionDesc ?? ''))
      ? 'medium'
      : 'low',
    actionComplexity: safePanelCount >= 12 ? 'high' : safePanelCount >= 9 ? 'medium' : 'low',
    continuityRisk: safePanelCount >= 12 ? 'high' : safePanelCount >= 9 ? 'medium' : 'low',
    recommendedPanelCount: safePanelCount,
    recommendedDurationSeconds: normalizeSmartDurationSeconds(durationSeconds),
    panelCountReason: `按当前时长与可见节拍兜底推荐 ${safePanelCount} 格；智能模式可由导演阐述根据剧情密度改判。`,
  };
}

function normalizeDirectorBrief(
  value: unknown,
  fallback: StoryboardBoardDirectorBrief,
): StoryboardBoardDirectorBrief {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawMatches = Array.isArray(raw.referenceMatching) ? raw.referenceMatching : [];
  const fallbackMatches = fallback.referenceMatching;
  const referenceMatching = rawMatches
    .map((item, index) => normalizeReferenceMatch(item, findFallbackReferenceMatch(item, fallbackMatches, index)))
    .filter((item): item is StoryboardBoardDirectorBriefReferenceMatch => !!item);
  const seenReferenceMatches = new Set(referenceMatching.map(getReferenceMatchIdentity));
  fallbackMatches.forEach((fallbackMatch) => {
    const identity = getReferenceMatchIdentity(fallbackMatch);
    if (!seenReferenceMatches.has(identity)) {
      referenceMatching.push(fallbackMatch);
      seenReferenceMatches.add(identity);
    }
  });

  const brief: StoryboardBoardDirectorBrief = {
    styleStatement: sanitizePlanVisualText(asString(raw.styleStatement, fallback.styleStatement), fallback.styleStatement),
    referenceMatching: referenceMatching.length > 0 ? referenceMatching : fallbackMatches,
    referenceBudget: normalizeReferenceBudget(raw.referenceBudget, fallback.referenceBudget ?? [], fallbackMatches.map((match) => ({
      refId: match.refId ?? '',
      name: match.name,
      type: getReferenceTypeFromBriefType(match.type),
    }))),
    referencePriority: normalizeDirectorReferencePriority(raw.referencePriority, fallback.referencePriority ?? [], fallbackMatches.map((match) => ({
      refId: match.refId ?? '',
      name: match.name,
      type: getReferenceTypeFromBriefType(match.type),
    }))),
    cameraStrategy: sanitizePlanVisualText(asString(raw.cameraStrategy, fallback.cameraStrategy), fallback.cameraStrategy),
    soundStrategy: sanitizePlanVisualText(asString(raw.soundStrategy, fallback.soundStrategy), fallback.soundStrategy),
    hookStrategy: sanitizePlanVisualText(asString(raw.hookStrategy, fallback.hookStrategy), fallback.hookStrategy),
    storyboardStrategy: sanitizePlanVisualText(asString(raw.storyboardStrategy, fallback.storyboardStrategy), fallback.storyboardStrategy),
  };

  if (fallback.recommendedPanelCount === undefined) return brief;

  let recommendedPanelCount = normalizeSmartPanelCount(raw.recommendedPanelCount) ?? fallback.recommendedPanelCount;
  const sceneType = sanitizePlanVisualText(asString(raw.sceneType, fallback.sceneType), fallback.sceneType);
  const paceLevel = sanitizePlanVisualText(asString(raw.paceLevel, fallback.paceLevel), fallback.paceLevel);
  const beatDensity = sanitizePlanVisualText(asString(raw.beatDensity, fallback.beatDensity), fallback.beatDensity);
  const dialogueDensity = sanitizePlanVisualText(asString(raw.dialogueDensity, fallback.dialogueDensity), fallback.dialogueDensity);
  const actionComplexity = sanitizePlanVisualText(asString(raw.actionComplexity, fallback.actionComplexity), fallback.actionComplexity);
  const continuityRisk = sanitizePlanVisualText(asString(raw.continuityRisk, fallback.continuityRisk), fallback.continuityRisk);
  recommendedPanelCount = inferSmartPanelCountFromRhythm({
    paceLevel,
    beatDensity,
    dialogueDensity,
    actionComplexity,
    continuityRisk,
  }, recommendedPanelCount);

  return {
    ...brief,
    sceneType,
    paceLevel,
    beatDensity,
    dialogueDensity,
    actionComplexity,
    continuityRisk,
    recommendedPanelCount,
    recommendedDurationSeconds: normalizeSmartDurationSeconds(raw.recommendedDurationSeconds, fallback.recommendedDurationSeconds),
    panelCountReason: sanitizePlanVisualText(asString(raw.panelCountReason, fallback.panelCountReason), fallback.panelCountReason),
  };
}

function normalizeWorldLock(
  value: unknown,
  fallback: StoryboardBoardWorldLock,
): StoryboardBoardWorldLock {
  const worldLock = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const anchors = asStringArray(worldLock.anchors, 10);
  return {
    sceneName: asString(worldLock.sceneName, fallback.sceneName),
    masterScene: sanitizePlanVisualText(asString(worldLock.masterScene, fallback.masterScene), fallback.masterScene),
    anchors: anchors.length > 0 ? anchors : fallback.anchors,
    actionZone: sanitizePlanVisualText(asString(worldLock.actionZone, fallback.actionZone), fallback.actionZone),
    continuityNotes: sanitizePlanVisualText(asString(worldLock.continuityNotes, fallback.continuityNotes), fallback.continuityNotes),
  };
}

function normalizeBlockingSnapshot(value: unknown): SpatialBlockingSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as SpatialBlockingSnapshot;
  if (!Array.isArray(raw.characters)) return undefined;
  return raw;
}

function normalizeBlockingContinuity(
  value: unknown,
  fallback: StoryboardBoardBlockingContinuity,
): StoryboardBoardBlockingContinuity {
  const continuity = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    previousEnd: sanitizePlanVisualText(asString(continuity.previousEnd, fallback.previousEnd), fallback.previousEnd),
    currentStart: sanitizePlanVisualText(asString(continuity.currentStart, fallback.currentStart), fallback.currentStart),
    currentEnd: sanitizePlanVisualText(asString(continuity.currentEnd, fallback.currentEnd), fallback.currentEnd),
    cameraChanged: typeof continuity.cameraChanged === 'boolean' ? continuity.cameraChanged : fallback.cameraChanged,
    cameraChangeReason: sanitizePlanVisualText(asString(continuity.cameraChangeReason, fallback.cameraChangeReason), fallback.cameraChangeReason),
    movementAxis: sanitizePlanVisualText(asString(continuity.movementAxis, fallback.movementAxis), fallback.movementAxis),
    startBlocking: normalizeBlockingSnapshot(continuity.startBlocking) ?? fallback.startBlocking,
    endBlocking: normalizeBlockingSnapshot(continuity.endBlocking) ?? fallback.endBlocking,
  };
}

function normalizeCameraPlan(
  value: unknown,
  fallback: StoryboardBoardCameraPlan,
): StoryboardBoardCameraPlan {
  const cameraPlan = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    cameraId: sanitizePlanVisualText(asString(cameraPlan.cameraId, fallback.cameraId), fallback.cameraId),
    cameraAxis: sanitizePlanVisualText(asString(cameraPlan.cameraAxis, fallback.cameraAxis), fallback.cameraAxis),
    cameraRelation: sanitizePlanVisualText(asString(cameraPlan.cameraRelation, fallback.cameraRelation), fallback.cameraRelation),
    lensPlan: sanitizePlanVisualText(asString(cameraPlan.lensPlan, fallback.lensPlan), fallback.lensPlan),
    lightPlan: sanitizePlanVisualText(asString(cameraPlan.lightPlan, fallback.lightPlan), fallback.lightPlan),
  };
}

function buildFallbackTransitionBridge(
  blockingContinuity: StoryboardBoardBlockingContinuity,
): StoryboardBoardTransitionBridge {
  return {
    previousEndBeat: blockingContinuity.previousEnd || '',
    transitionType: blockingContinuity.previousEnd ? 'direct continuity cut' : 'fresh scene start',
    transitionRationale: blockingContinuity.previousEnd
      ? 'Use the previous end beat as the emotional and spatial handoff without adding an extra panel before S01.'
      : 'No previous end beat is available, so the shot can establish its own opening.',
    visualBridge: blockingContinuity.previousEnd
      ? 'Echo the previous end beat in the top transition-in note, then let S01 begin the current 15-second shot.'
      : '',
    soundBridge: 'Carry room tone or the previous impact tail only when it supports the current story beat.',
    cameraBridge: blockingContinuity.cameraChanged
      ? 'Camera angle may change, but world blocking and axis remain locked.'
      : 'Keep the same world axis unless the plan explicitly changes camera relation.',
    firstFrameInstruction: blockingContinuity.currentStart,
  };
}

function getStoryboardPlanningSourceText(storyboard: StoryboardState) {
  return [
    storyboard.storyboard.name,
    storyboard.storyboard.scene,
    storyboard.correctedScript,
    storyboard.lastFrameInfo,
    storyboard.prompt?.scene,
    storyboard.prompt?.rawText,
    storyboard.choreography?.sceneAnchor,
    storyboard.choreography?.overallRhythm,
    storyboard.choreography?.cameraOverview,
    ...(storyboard.prompt?.timeSegments ?? []).map((segment) => [
      segment.timeRange,
      segment.cameraShot,
      segment.actionDesc,
      segment.soundEffect,
    ].filter(Boolean).join(' ')),
    ...(storyboard.choreography?.timeSegments ?? []).map((segment) => [
      segment.timeRange,
      segment.segmentType,
      segment.rhythm,
      segment.actionFlow,
      segment.camera,
      segment.sound,
    ].filter(Boolean).join(' ')),
  ].filter(Boolean).join(' ');
}

function buildFallbackDirectorContract(
  storyboard: StoryboardState,
  mode: StoryboardBoardMode,
  blockingContinuity: StoryboardBoardBlockingContinuity,
  panelCount = getStoryboardBoardExpectedPanelCount(mode, storyboard.storyboard.duration),
): StoryboardBoardDirectorContract {
  const sourceText = getStoryboardPlanningSourceText(storyboard);
  const hasGateOrDoor = /门|入口|门槛|gate|door|threshold|entrance/i.test(sourceText);
  const hasBoundary = /门槛|门内|门外|越线|边界|禁区|inside|outside|threshold|boundary/i.test(sourceText);
  const hasUiOrCountdown = /倒计时|任务面板|系统面板|红色面板|弹幕|直播界面|UI|countdown|timer|panel/i.test(sourceText);
  const startLock = blockingContinuity.currentStart || 'START FRAME 必须定义进入 S01 前的桥接站位、机位高度和动作方向；S01 承接它进入当前动作第一锚点。';
  const finalPanelLabel = formatStoryboardPanelLabel(panelCount);
  const endLock = blockingContinuity.currentEnd || `${finalPanelLabel} 后的 END BEAT 必须定义下一镜可继承的交接落幅。`;
  const characterZones = [
    hasBoundary
      ? '边界/门槛戏必须先锁人物区域：边界外主体始终在外，边界内主体始终在内；只允许道具、视线、声音跨越边界，人物身体不得无因果越线。'
      : '所有人物必须有明确前景/中景/后景与左右/内外/高低区域，换机位时只改变观察方向，不改变世界站位。',
    `START ZONE: ${startLock}`,
    `END ZONE: ${endLock}`,
  ];

  return {
    spatialContract: hasBoundary
      ? '空间轴线、门槛/边界线、人物内外关系必须先于镜头调度锁定；所有 panel 只能在这个空间合同内变化。'
      : '空间轴线、人物站位区、道具位置和危险方向必须先于镜头调度锁定；所有 panel 只能在同一空间合同内变化。',
    characterZones,
    mechanismState: hasGateOrDoor
      ? `门/入口状态必须写成可执行状态链：S01前初始状态（关闭/半开/已破/敞开）→ 哪几个S格发生可见变化（撞裂、门缝扩大、门轴/门扇方向、玻璃破口、门槛越线）→ ${finalPanelLabel}最终状态。若本镜不拍开门动作，写明开场前已开/半开/敞开，揭示只靠机位/光线/声音完成；若本镜拍开门或破门，必须连续分配多个panel表现可见动作链。相关panel的motion、continuityIn、continuityOut必须复述该状态，禁止门、入口或边界突然跳变。`
      : '任何可动机关、门、屏幕、武器或大型道具必须先定义状态和动作因果；没有明确动作链时不得突然变化。',
    uiContinuity: hasUiOrCountdown
      ? 'diegetic UI / 倒计时数字策略必须先定义：只允许首次清晰显示剧情指定数字，后续用红光、虚焦、tick、局部遮挡或后期占位表现；禁止随机可读数字、倒计时乱跳、无关字幕或非剧情贴字。'
      : '无剧情 UI 时不得新增屏幕文字、字幕、随机数字、Logo 或说明贴字；如有道具界面，只能显示剧情必要信息。',
    beatProgression: isShotPlanBoardMode(mode)
      ? `S01-${finalPanelLabel} 必须推进连续可见 beat；S 格是动作/状态锚点，不等于逐秒切镜；同一构图/同一主体可以连续超过 2 格，但动作、表演、道具状态、焦点、声音或空间压力必须有可见变化。关键转折必须分配到具体 panel，不能被重复反应镜头吞掉。因果触发动作必须有可见接触帧：预备/接触/结果不能跳拍，例如踢中、撞裂、按下、插入、塞进、接上、电弧爆发必须有对应S格。`
      : '每格必须推进一个可见 beat；同一构图/同一主体可以连续超过 2 格，但动作、表演、道具状态、焦点、声音或空间压力必须有可见变化。',
    startFrameContract: `顶部 START FRAME 必须是进入 S01 前的桥接帧，承接上一镜落幅或本镜入场预备；它必须与 S01 空间/动作因果连续，但不得只是 S01 重复裁图。${blockingContinuity.previousEnd ? ` 必须承接：${blockingContinuity.previousEnd}` : ''}`,
    endBeatContract: `底部 END BEAT 必须是 ${finalPanelLabel} 之后的下一镜交接落幅，可来自 ${finalPanelLabel} 的余势、停顿、关键道具或情绪物件，但不得只是 ${finalPanelLabel} 重复裁图：${endLock}`,
    rejectionRules: [
      '拒绝人物区域互换、门内门外关系反转、角色无因果越线。',
      '拒绝门/机关/大型道具状态突变，拒绝没有动作链的突然开门或突然关闭。',
      '拒绝关键触发动作缺少接触帧；不得从“看向/准备”直接跳到“火花/爆炸/结果”。',
      '拒绝倒计时和任务面板出现随机可读数字，拒绝把非剧情说明词画成画面文字。',
      '拒绝连续 3 格以上重复同一主体、同一景别、同一机位的无推进构图。',
      `拒绝 START FRAME 到 S01 的入场桥断裂，拒绝 ${finalPanelLabel} 到 END BEAT 的交接桥断裂；也拒绝把 START FRAME 或 END BEAT 画成重复裁图。`,
    ],
  };
}

function normalizeDirectorContract(
  value: unknown,
  fallback: StoryboardBoardDirectorContract,
): StoryboardBoardDirectorContract {
  const contract = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const characterZones = asStringArray(contract.characterZones, 8)
    .map((item) => sanitizePlanVisualText(item, item))
    .filter(Boolean);
  const rejectionRules = asStringArray(contract.rejectionRules, 10)
    .map((item) => sanitizePlanVisualText(item, item))
    .filter(Boolean);

  return {
    spatialContract: sanitizePlanVisualText(asString(contract.spatialContract, fallback.spatialContract), fallback.spatialContract),
    characterZones: characterZones.length > 0 ? characterZones : fallback.characterZones,
    mechanismState: sanitizePlanVisualText(asString(contract.mechanismState, fallback.mechanismState), fallback.mechanismState),
    uiContinuity: sanitizePlanVisualText(asString(contract.uiContinuity, fallback.uiContinuity), fallback.uiContinuity),
    beatProgression: sanitizePlanVisualText(asString(contract.beatProgression, fallback.beatProgression), fallback.beatProgression),
    startFrameContract: sanitizePlanVisualText(asString(contract.startFrameContract, fallback.startFrameContract), fallback.startFrameContract),
    endBeatContract: sanitizePlanVisualText(asString(contract.endBeatContract, fallback.endBeatContract), fallback.endBeatContract),
    rejectionRules: rejectionRules.length > 0 ? rejectionRules : fallback.rejectionRules,
  };
}

function normalizeTransitionBridge(
  value: unknown,
  fallback: StoryboardBoardTransitionBridge,
): StoryboardBoardTransitionBridge {
  const bridge = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    previousEndBeat: sanitizePlanVisualText(asString(bridge.previousEndBeat, fallback.previousEndBeat), fallback.previousEndBeat),
    transitionType: sanitizeBoardInfoText(asString(bridge.transitionType, fallback.transitionType), 90),
    transitionRationale: sanitizePlanVisualText(asString(bridge.transitionRationale, fallback.transitionRationale), fallback.transitionRationale),
    visualBridge: sanitizePlanVisualText(asString(bridge.visualBridge, fallback.visualBridge), fallback.visualBridge),
    soundBridge: sanitizePlanVisualText(asString(bridge.soundBridge, fallback.soundBridge), fallback.soundBridge),
    cameraBridge: sanitizePlanVisualText(asString(bridge.cameraBridge, fallback.cameraBridge), fallback.cameraBridge),
    firstFrameInstruction: sanitizePlanVisualText(asString(bridge.firstFrameInstruction, fallback.firstFrameInstruction), fallback.firstFrameInstruction),
  };
}

function normalizePlanPanel(
  value: unknown,
  fallback: StoryboardBoardPlanPanel,
): StoryboardBoardPlanPanel {
  const panel = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    index: typeof panel.index === 'number' ? panel.index : fallback.index,
    timeRange: asString(panel.timeRange, fallback.timeRange),
    beat: asString(panel.beat, fallback.beat),
    shotType: asString(panel.shotType, fallback.shotType),
    cameraAngle: asString(panel.cameraAngle, fallback.cameraAngle),
    primarySubject: asString(panel.primarySubject, fallback.primarySubject),
    secondarySubjects: asStringArray(panel.secondarySubjects, 2),
    composition: sanitizePlanVisualText(asString(panel.composition, fallback.composition), fallback.composition),
    staticMoment: sanitizePlanVisualText(asString(panel.staticMoment, fallback.staticMoment), fallback.staticMoment),
    blocking: sanitizePlanVisualText(asString(panel.blocking, fallback.blocking), fallback.blocking),
    motion: sanitizePlanVisualText(asString(panel.motion, fallback.motion), fallback.motion),
    cameraTask: sanitizePlanVisualText(asString(panel.cameraTask, fallback.cameraTask), fallback.cameraTask),
    mustShow: sanitizePlanVisualArray(asStringArray(panel.mustShow, 5), fallback.mustShow),
    background: sanitizePlanVisualText(asString(panel.background, fallback.background), fallback.background),
    continuity: sanitizePlanVisualText(asString(panel.continuity, fallback.continuity), fallback.continuity),
    worldAnchor: sanitizePlanVisualText(asString(panel.worldAnchor, fallback.worldAnchor), fallback.worldAnchor),
    dialogue: sanitizeBoardInfoText(asString(panel.dialogue, fallback.dialogue), 140),
    sfx: sanitizeBoardInfoText(asString(panel.sfx, fallback.sfx), 120),
    audio: sanitizeBoardInfoText(asString(panel.audio, fallback.audio), 120),
    transition: sanitizeBoardInfoText(asString(panel.transition, fallback.transition), 90),
    dialoguePerformance: sanitizePlanVisualText(asString(panel.dialoguePerformance, fallback.dialoguePerformance), fallback.dialoguePerformance),
    continuityIn: sanitizePlanVisualText(asString(panel.continuityIn, fallback.continuityIn), fallback.continuityIn),
    continuityOut: sanitizePlanVisualText(asString(panel.continuityOut, fallback.continuityOut), fallback.continuityOut),
    directorNote: sanitizePlanVisualText(asString(panel.directorNote, fallback.directorNote), fallback.directorNote),
  };
}

function normalizeCharacterLocks(
  value: unknown,
  fallback: StoryboardBoardPlanCharacterLock[],
  references: StoryboardBoardReference[],
): StoryboardBoardPlanCharacterLock[] {
  if (!Array.isArray(value)) return fallback;

  const availableRefIds = new Set(references.map((reference) => reference.refId));
  const normalized = value.reduce<StoryboardBoardPlanCharacterLock[]>((result, item) => {
      const lock = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const role = lock.role === 'primary' || lock.role === 'secondary' || lock.role === 'background'
        ? lock.role
        : 'secondary';
      const refId = typeof lock.refId === 'string' && availableRefIds.has(lock.refId) ? lock.refId : undefined;
      const name = asString(lock.name);
      if (!name) return result;
      result.push({
        refId,
        name,
        role,
        mustKeep: ['锁定身份'],
      });
      return result;
    }, []);

  return normalized.length > 0 ? normalized : fallback;
}

export function buildStoryboardBoardPlanRequest(
  storyboard: StoryboardState,
  references: StoryboardBoardReference[],
  mode: StoryboardBoardMode,
  repairHint?: string,
  episodeShotSheetSegment?: EpisodeShotSheetSegment,
  frameRatio?: string,
  sequenceContinuityContext?: StoryboardSequenceContinuityContext,
  directorBrief?: StoryboardBoardDirectorBrief,
  styleConfig?: string,
  smartPanelCountPreference?: SmartStoryboardPanelCountPreference,
  cameraSegmentCount?: number,
  options?: {
    compactPlanning?: boolean;
  },
) {
  const prompt = storyboard.prompt;
  const characterReferenceSummary = buildCharacterReferenceSummary(references);
  const currentSpatialBlocking = storyboard.spatialBlocking
    ?? storyboard.choreography?.endBlocking
    ?? storyboard.choreography?.startBlocking
    ?? undefined;
  const lockedSmartPanelCount = isSmartShotPlanBoardMode(mode)
    ? getLockedSmartStoryboardPanelCount(smartPanelCountPreference)
    : undefined;
  const panelCount = getStoryboardRequestPanelCount(
    mode,
    storyboard.storyboard.duration,
    directorBrief,
    smartPanelCountPreference,
  );
  const normalizedCameraSegmentCount = normalizeStoryboardCameraSegmentCount(cameraSegmentCount);
  const payload: StoryboardBoardPlanRequestPayload = {
    mode,
    panelCount,
    smartPanelCountPreference,
    smartPanelCountLocked: Boolean(lockedSmartPanelCount),
    cameraSegmentCount: normalizedCameraSegmentCount,
    cameraSegmentContract: buildStoryboardCameraSegmentContract(normalizedCameraSegmentCount),
    planningMode: options?.compactPlanning ? 'compact' : 'standard',
    compactPlanningContract: options?.compactPlanning
      ? [
          '精简模式：不要等待或重写长篇导演阐述；直接使用本 payload 的 directorBrief、sequenceContinuityContext、continuity、episodeShotSheetSegment、references 和 correctedScript 生成完整 StoryboardBoardPlan。',
          '必须保留上下文胶囊：previousLastFrameInfo、previousFinalPanel、previousSpatialBlocking、current continuity input、nextContinuityIn 与 episode shot sheet 都要进入 START FRAME、S01 和 END BEAT 的桥接关系。',
          '输出仍必须是完整 StoryboardBoardPlan JSON；directorBrief 可以简短，但 panels、transitionBridge、directorContract、blockingContinuity、referencePriority、continuityIn/continuityOut 必须完整。',
          '只做结构性自检：JSON、panelCount、S 顺序、参考图绑定和连续性桥接不可坏；导演细节不要扩写成长分析。',
        ]
      : undefined,
    frameRatio: getBoardFrameRatio(mode, frameRatio),
    outputMode: storyboard.generatedStep4OutputMode ?? storyboard.step4OutputMode ?? 'prompt',
    boardStyle: storyboard.storyboardBoardStyle ?? (
      (storyboard.generatedStep4OutputMode ?? storyboard.step4OutputMode) === 'storyboard-director'
        ? 'seedance-board'
        : 'cinematic'
    ),
    projectStyle: resolveProjectVisualStyle({
      styleConfig,
      directorStyleStatement: directorBrief?.styleStatement,
      promptHeader: prompt?.header,
      promptColorLighting: prompt?.colorLighting,
    }),
    storyboardModeContract: buildStoryboardModePlanningContract(mode, references, frameRatio, sequenceContinuityContext),
    storyboard: {
      number: storyboard.storyboard.number,
      name: storyboard.storyboard.name,
      duration: storyboard.storyboard.duration,
      shotSize: storyboard.storyboard.shotSize,
    },
    correctedScript: clipText(storyboard.correctedScript, 3000),
    prompt: prompt
      ? {
          header: clipText(prompt.header, 320),
          scene: clipText(prompt.scene, 1200),
          characters: characterReferenceSummary,
          cameraOverview: clipText(prompt.cameraOverview, 800),
          colorLighting: clipText(prompt.colorLighting, 1200),
          rawText: clipText(stripCharacterAppearanceText(prompt.rawText), 5000),
          timeSegments: (prompt.timeSegments ?? []).map((segment) => ({
          timeRange: clipText(segment.timeRange, 40),
          cameraShot: clipText(segment.cameraShot, 300),
          actionDesc: sanitizeStaticText(segment.actionDesc, 420),
          soundEffect: clipText(segment.soundEffect, 160),
        })),
        }
      : null,
    sceneBlueprint: storyboard.sceneBlueprint
      ? {
          sceneType: storyboard.sceneBlueprint.sceneType,
          combatSubType: storyboard.sceneBlueprint.combatSubType,
          emotionArc: storyboard.sceneBlueprint.emotionArc,
          cameraStyle: storyboard.sceneBlueprint.cameraStyle,
        }
      : null,
    choreography: storyboard.choreography
      ? {
          overallRhythm: clipText(storyboard.choreography.overallRhythm, 220),
          cameraOverview: clipText(storyboard.choreography.cameraOverview, 320),
          lightNotes: clipText(storyboard.choreography.lightNotes, 220),
          colorGrading: clipText(storyboard.choreography.colorGrading, 220),
          timeSegments: (storyboard.choreography.timeSegments ?? []).map((segment) => ({
            timeRange: clipText(segment.timeRange, 60),
            segmentType: clipText(segment.segmentType, 80),
            rhythm: clipText(segment.rhythm, 60),
            actionFlow: sanitizeStaticText(segment.actionFlow, 420),
            camera: clipText(segment.camera, 260),
            vfx: clipText(segment.vfx, 160),
            sound: clipText(segment.sound, 160),
          })),
        }
      : null,
    continuity: {
      previousLastFrameInfo: clipText(storyboard.continuityInput?.lastFrameInfo, 500),
      previousSpatialBlocking: storyboard.continuityInput?.spatialBlocking,
      currentSpatialBlocking,
    },
    episodeShotSheetSegment,
    sequenceContinuityContext,
    directorBrief,
    referenceBudget: {
      totalVideoSlots: 9,
      reservedStoryboardBoardSlots: 1,
      step3ReferenceSlots: 8,
      rule: '故事板模式最终视频提交固定预留 1 张故事板宫格图，所以 Step3 参考图最多保留 8 张；请按当前剧情重要性给出 mustKeep / preferKeep / textFallback。',
    },
    references: references.map((reference) => ({
      ...reference,
      label: `${reference.type}:${reference.name}`,
      readingContract: buildStoryboardReferenceReadingContract(reference),
    })),
    repairHint: repairHint ? clipText(repairHint, 400) : undefined,
  };

  return JSON.stringify(payload);
}

export function buildStoryboardDirectorBriefRequest(
  storyboard: StoryboardState,
  references: StoryboardBoardReference[],
  mode: StoryboardBoardMode,
  episodeShotSheetSegment?: EpisodeShotSheetSegment,
  frameRatio?: string,
  sequenceContinuityContext?: StoryboardSequenceContinuityContext,
  styleConfig?: string,
  repairHint?: string,
  smartPanelCountPreference?: SmartStoryboardPanelCountPreference,
  cameraSegmentCount?: number,
) {
  return buildStoryboardBoardPlanRequest(
    storyboard,
    references,
    mode,
    repairHint,
    episodeShotSheetSegment,
    frameRatio,
    sequenceContinuityContext,
    undefined,
    styleConfig,
    smartPanelCountPreference,
    cameraSegmentCount,
  );
}

export function buildStoryboardActionDirectorRequest(
  storyboard: StoryboardState,
  references: StoryboardBoardReference[],
  mode: StoryboardBoardMode,
  currentPlan: StoryboardBoardPlan,
  repairHint?: string,
  episodeShotSheetSegment?: EpisodeShotSheetSegment,
  frameRatio?: string,
  sequenceContinuityContext?: StoryboardSequenceContinuityContext,
  directorBrief?: StoryboardBoardDirectorBrief,
  styleConfig?: string,
  smartPanelCountPreference?: SmartStoryboardPanelCountPreference,
  cameraSegmentCount?: number,
) {
  const payload = JSON.parse(buildStoryboardBoardPlanRequest(
    storyboard,
    references,
    mode,
    repairHint,
    episodeShotSheetSegment,
    frameRatio,
    sequenceContinuityContext,
    directorBrief,
    styleConfig,
    smartPanelCountPreference,
    cameraSegmentCount,
  )) as StoryboardBoardPlanRequestPayload;

  payload.currentPlan = compactStoryboardBoardPlanForActionDirector(currentPlan);
  payload.panelCount = getStoryboardBoardExpectedPanelCount(
    mode,
    storyboard.storyboard.duration,
    currentPlan.panels?.length,
  );
  payload.actionDirectorContract = buildStoryboardActionDirectorContract(mode);
  payload.cameraSegmentCount = normalizeStoryboardCameraSegmentCount(cameraSegmentCount);
  payload.cameraSegmentContract = buildStoryboardCameraSegmentContract(payload.cameraSegmentCount);
  payload.repairHint = repairHint ? clipText(repairHint, 600) : payload.repairHint;
  return JSON.stringify(payload);
}

export function buildStoryboardBoardFormatRepairRequest(
  storyboard: StoryboardState,
  references: StoryboardBoardReference[],
  mode: StoryboardBoardMode,
  previousRawText: string,
  repairHint: string,
  episodeShotSheetSegment?: EpisodeShotSheetSegment,
  frameRatio?: string,
  sequenceContinuityContext?: StoryboardSequenceContinuityContext,
  directorBrief?: StoryboardBoardDirectorBrief,
  styleConfig?: string,
  smartPanelCountPreference?: SmartStoryboardPanelCountPreference,
  cameraSegmentCount?: number,
  options?: {
    compactPlanning?: boolean;
  },
) {
  const payload = JSON.parse(buildStoryboardBoardPlanRequest(
    storyboard,
    references,
    mode,
    undefined,
    episodeShotSheetSegment,
    frameRatio,
    sequenceContinuityContext,
    directorBrief,
    styleConfig,
    smartPanelCountPreference,
    cameraSegmentCount,
    options,
  )) as StoryboardBoardPlanRequestPayload;

  payload.repairMode = 'format';
  payload.previousRawText = clipText(previousRawText, 12000);
  payload.repairHint = clipText(repairHint, 1200);
  payload.compactPlanningContract = [
    'Repair malformed JSON only. Preserve the original story facts, beat order, panel count, reference choices, dialogue text, and director intent from previousRawText.',
    'Do not re-plan the shot unless a missing required field must be filled from the provided context.',
    'Return one valid StoryboardBoardPlan JSON object with the expected schema and no markdown.',
  ];
  return JSON.stringify(payload);
}

export function buildStoryboardBoardQualityRepairRequest(
  storyboard: StoryboardState,
  references: StoryboardBoardReference[],
  mode: StoryboardBoardMode,
  currentPlan: StoryboardBoardPlan,
  repairHint: string,
  episodeShotSheetSegment?: EpisodeShotSheetSegment,
  frameRatio?: string,
  sequenceContinuityContext?: StoryboardSequenceContinuityContext,
  directorBrief?: StoryboardBoardDirectorBrief,
  styleConfig?: string,
  smartPanelCountPreference?: SmartStoryboardPanelCountPreference,
  cameraSegmentCount?: number,
  options?: {
    compactPlanning?: boolean;
  },
) {
  const payload = JSON.parse(buildStoryboardBoardPlanRequest(
    storyboard,
    references,
    mode,
    undefined,
    episodeShotSheetSegment,
    frameRatio,
    sequenceContinuityContext,
    directorBrief,
    styleConfig,
    smartPanelCountPreference,
    cameraSegmentCount,
    options,
  )) as StoryboardBoardPlanRequestPayload;

  payload.repairMode = 'quality';
  payload.currentPlan = compactStoryboardBoardPlanForActionDirector(currentPlan);
  payload.panelCount = getStoryboardBoardExpectedPanelCount(
    mode,
    storyboard.storyboard.duration,
    currentPlan.panels?.length,
  );
  payload.actionDirectorContract = buildStoryboardActionDirectorContract(mode);
  payload.repairHint = clipText(repairHint, 1600);
  payload.compactPlanningContract = [
    'Targeted quality repair only. Preserve every field that is not named by the quality report.',
    'Keep the same story facts, dialogue text, reference IDs, visual style, panel count, and shot order unless the report explicitly flags them.',
    'Fix blocking continuity, transition bridge, START FRAME, END BEAT, panel labels, or required schema fields with the smallest possible edits.',
  ];
  return JSON.stringify(payload);
}

export function parseStoryboardDirectorBrief(
  responseText: string,
  storyboard: StoryboardState,
  references: StoryboardBoardReference[],
  mode: StoryboardBoardMode,
  frameRatio?: string,
  smartPanelCountPreference?: SmartStoryboardPanelCountPreference,
): StoryboardBoardDirectorBrief {
  void frameRatio;
  const blockingContinuity = buildFallbackBlockingContinuity(storyboard);
  const cameraPlan = buildFallbackCameraPlan(storyboard);
  const panelCount = getStoryboardRequestPanelCount(
    mode,
    storyboard.storyboard.duration,
    undefined,
    smartPanelCountPreference,
  );
  const fallback = buildFallbackDirectorBrief(storyboard, references, mode, cameraPlan, blockingContinuity, panelCount);
  const parsed = JSON.parse(extractJsonBlock(responseText)) as Record<string, unknown>;
  const normalized = normalizeDirectorBrief(parsed, fallback);
  const lockedSmartPanelCount = isSmartShotPlanBoardMode(mode)
    ? getLockedSmartStoryboardPanelCount(smartPanelCountPreference)
    : undefined;
  if (normalized.referenceMatching.length === 0 && references.length > 0) {
    return {
      ...normalized,
      recommendedPanelCount: lockedSmartPanelCount ?? normalized.recommendedPanelCount,
      referenceMatching: buildFallbackReferenceMatches(references),
    };
  }
  return {
    ...normalized,
    recommendedPanelCount: lockedSmartPanelCount ?? normalized.recommendedPanelCount,
  };
}

export function parseStoryboardBoardPlan(
  responseText: string,
  storyboard: StoryboardState,
  references: StoryboardBoardReference[],
  mode: StoryboardBoardMode,
  frameRatio?: string,
  directorBrief?: StoryboardBoardDirectorBrief,
  smartPanelCountPreference?: SmartStoryboardPanelCountPreference,
): StoryboardBoardPlan {
  const parsed = JSON.parse(extractJsonBlock(responseText)) as Record<string, unknown>;
  const rawPanels = Array.isArray(parsed.panels) ? parsed.panels : [];
  const panelCount = getStoryboardRequestPanelCount(
    mode,
    storyboard.storyboard.duration,
    directorBrief,
    smartPanelCountPreference,
  );
  const fallbackPanels = buildFallbackPanels(storyboard, references, mode, panelCount);
  const fallbackCharacterLocks = buildFallbackCharacterLocks(references);
  const modeSpec = getStoryboardBoardModeSpec(mode);
  const referenceRefIds = references.map((reference) => reference.refId);
  const referencePrioritySet = new Set(referenceRefIds);
  const fallbackWorldLock = buildFallbackWorldLock(storyboard);
  const fallbackBlockingContinuity = buildFallbackBlockingContinuity(storyboard);
  const fallbackCameraPlan = buildFallbackCameraPlan(storyboard);
  const fallbackTransitionBridge = buildFallbackTransitionBridge(fallbackBlockingContinuity);
  const fallbackDirectorContract = buildFallbackDirectorContract(storyboard, mode, fallbackBlockingContinuity, panelCount);
  const fallbackDirectorBrief = directorBrief
    ?? buildFallbackDirectorBrief(storyboard, references, mode, fallbackCameraPlan, fallbackBlockingContinuity, panelCount);

  const panelMap = new Map<number, StoryboardBoardPlanPanel>();
  rawPanels.forEach((panelValue, arrayIndex) => {
    const fallbackPanel = fallbackPanels[Math.min(arrayIndex, fallbackPanels.length - 1)];
    const normalized = normalizePlanPanel(panelValue, fallbackPanel);
    const safeIndex = Math.min(panelCount, Math.max(1, normalized.index || fallbackPanel.index));
    if (!panelMap.has(safeIndex)) {
      panelMap.set(safeIndex, { ...normalized, index: safeIndex });
    }
  });

  const panels = fallbackPanels.map((fallbackPanel) => panelMap.get(fallbackPanel.index) ?? fallbackPanel);

  const referencePriority = asStringArray(parsed.referencePriority, referenceRefIds.length + 4)
    .filter((refId, index, array) => referencePrioritySet.has(refId) && array.indexOf(refId) === index);
  referenceRefIds.forEach((refId) => {
    if (!referencePriority.includes(refId)) {
      referencePriority.push(refId);
    }
  });

  const normalizedDirectorBrief = normalizeDirectorBrief(parsed.directorBrief, fallbackDirectorBrief);
  const finalDirectorBrief = isSmartShotPlanBoardMode(mode) && directorBrief
    ? {
        ...normalizedDirectorBrief,
        recommendedPanelCount: directorBrief.recommendedPanelCount,
        recommendedDurationSeconds: directorBrief.recommendedDurationSeconds,
        panelCountReason: directorBrief.panelCountReason,
      }
    : normalizedDirectorBrief;

  const plan: StoryboardBoardPlan = {
    mode,
    directorBrief: finalDirectorBrief,
    boardGoal: asString(parsed.boardGoal, `${modeSpec.modeLabel}，用于当前单个分镜的图生视频`),
    sceneAnchor: asString(parsed.sceneAnchor, clipText(storyboard.prompt?.scene, 200) || '场景、空间关系与道具陈设保持当前分镜设定'),
    styleAnchor: asString(parsed.styleAnchor, clipText(`${storyboard.prompt?.header ?? ''} ${storyboard.prompt?.colorLighting ?? ''}`, 220) || '保持当前分镜既定风格与光色'),
    transitionBridge: normalizeTransitionBridge(parsed.transitionBridge, fallbackTransitionBridge),
    directorContract: normalizeDirectorContract(parsed.directorContract, fallbackDirectorContract),
    worldLock: normalizeWorldLock(parsed.worldLock, fallbackWorldLock),
    blockingContinuity: normalizeBlockingContinuity(parsed.blockingContinuity, fallbackBlockingContinuity),
    cameraPlan: normalizeCameraPlan(parsed.cameraPlan, fallbackCameraPlan),
    consistencyRules: normalizeBoardRules(parsed.consistencyRules, 6).length > 0
      ? normalizeBoardRules(parsed.consistencyRules, 6)
      : [
          '同一角色在所有格中只按绑定参考图锁定身份，不用文字重写外貌',
          '同一场景的材质、空间方向、光线方向保持一致',
          '关键道具外观与持有关系保持一致',
        ],
    characterLocks: normalizeCharacterLocks(parsed.characterLocks, fallbackCharacterLocks, references),
    propLocks: asStringArray(parsed.propLocks, 6).length > 0
      ? asStringArray(parsed.propLocks, 6)
      : references.filter((reference) => reference.type === 'prop').map((reference) => reference.name),
    referencePriority,
    layoutRules: asStringArray(parsed.layoutRules, 6).length > 0
      ? asStringArray(parsed.layoutRules, 6)
      : getDefaultBoardLayoutRules(mode, frameRatio, panelCount),
    negativeRules: asStringArray(parsed.negativeRules, 8).length > 0
      ? asStringArray(parsed.negativeRules, 8)
      : [
          '禁止对白、字幕、气泡、注释、Logo、水印',
          '禁止海报感、拼贴感、漫画页感、情绪板排版',
          '禁止把完整动作轨迹画进同一格',
        ],
    panels,
  };

  return plan;
}

export function buildFallbackStoryboardBoardPlan(
  storyboard: StoryboardState,
  references: StoryboardBoardReference[],
  mode: StoryboardBoardMode,
  frameRatio?: string,
  directorBrief?: StoryboardBoardDirectorBrief,
): StoryboardBoardPlan {
  const modeSpec = getStoryboardBoardModeSpec(mode);
  const panelCount = getStoryboardRequestPanelCount(mode, storyboard.storyboard.duration, directorBrief);
  const worldLock = buildFallbackWorldLock(storyboard);
  const blockingContinuity = buildFallbackBlockingContinuity(storyboard);
  const cameraPlan = buildFallbackCameraPlan(storyboard);
  const transitionBridge = buildFallbackTransitionBridge(blockingContinuity);
  const directorContract = buildFallbackDirectorContract(storyboard, mode, blockingContinuity, panelCount);
  const fallbackDirectorBrief = directorBrief
    ?? buildFallbackDirectorBrief(storyboard, references, mode, cameraPlan, blockingContinuity, panelCount);
  return {
    mode,
    directorBrief: fallbackDirectorBrief,
    boardGoal: `${modeSpec.modeLabel}，用于当前单个分镜的图生视频`,
    sceneAnchor: clipText(storyboard.prompt?.scene, 220) || '保持当前分镜场景与空间关系不变',
    styleAnchor: clipText(`${storyboard.prompt?.header ?? ''} ${storyboard.prompt?.colorLighting ?? ''}`, 220) || '保持当前分镜风格与光色一致',
    transitionBridge,
    directorContract,
    worldLock,
    blockingContinuity,
    cameraPlan,
    consistencyRules: [
      '同一角色在所有格中只按绑定参考图锁定身份，不用文字重写外貌',
      '同一场景的材质、空间方向、光线方向保持一致',
      '关键道具外观与持有关系保持一致',
    ],
    characterLocks: buildFallbackCharacterLocks(references),
    propLocks: references.filter((reference) => reference.type === 'prop').map((reference) => reference.name),
    referencePriority: references.map((reference) => reference.refId),
    layoutRules: getDefaultBoardLayoutRules(mode, frameRatio, panelCount),
    negativeRules: [
      '禁止对白、字幕、气泡、注释、Logo、水印',
      '禁止海报感、拼贴感、漫画页感、情绪板排版',
      '禁止把完整动作轨迹画进同一格',
    ],
    panels: buildFallbackPanels(storyboard, references, mode, panelCount),
  };
}
