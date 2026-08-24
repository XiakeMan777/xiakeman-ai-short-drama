// ============================================================
// L3: 动态上下文构建器（壳文件）
// 用户侧提示词模板也由 BFF 服务端拼接，前端只发送原始数据
// ============================================================

import type {
  ScriptAnalysis,
  StoryboardInfo,
  ImageReference,
  LogicFix,
  SceneBlueprint,
  Choreography,
  PropConsistency,
  Step4GenerateMode,
  SpatialBlockingSnapshot,
  SpatialContinuityIssue,
} from '@/types';
import { sanitizeStoryboardCharacters } from '@/lib/storyboardCharacterSanitizer';

function pickItemTrackerPayload(itemTracker?: Record<string, string>) {
  return itemTracker && Object.keys(itemTracker).length > 0 ? itemTracker : undefined;
}

function isStoryboardNumberInRange(storyboardNumber: number | undefined, storyboardRange: string): boolean {
  if (!storyboardRange.trim() || storyboardNumber === undefined) return false;

  const rangeMatch = storyboardRange.match(/分镜\s*(\d+)\s*[-–—]\s*(\d+)/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    return storyboardNumber >= start && storyboardNumber <= end;
  }

  const singleMatch = storyboardRange.match(/分镜\s*(\d+)/);
  if (singleMatch) {
    return storyboardNumber === parseInt(singleMatch[1], 10);
  }

  return false;
}

function filterRelevantPropTracking(
  storyboard: StoryboardInfo,
  propTracking?: PropConsistency[],
  allowedNames?: Iterable<string | undefined | null>,
) {
  if (!propTracking?.length) return [];
  const storyboardCharacters = sanitizeStoryboardCharacters(storyboard.characters, { allowedNames });

  return propTracking.filter((prop) => {
    if (prop.needsTracking === false && !prop.needsImage) return false;

    const inStoryboardRange = isStoryboardNumberInRange(storyboard.number, prop.storyboardRange);
    const holder = prop.holder || '';
    const holderRelevant = storyboardCharacters.some((character) => holder.includes(character));
    const sceneRelevant = !!storyboard.scene && (!holder || holder.includes('场景') || holder.includes('无'));

    return inStoryboardRange || holderRelevant || sceneRelevant;
  });
}

function getAnalysisCharacterNames(analysis: Pick<ScriptAnalysis, 'allCharacterNames' | 'characterProfiles'> | undefined) {
  return [
    ...(analysis?.allCharacterNames ?? []),
    ...(analysis?.characterProfiles ?? []).map((profile) => profile.name),
  ];
}

function getImageRefCharacterNames(imageRefs: ImageReference[] | undefined) {
  return (imageRefs ?? [])
    .filter((reference) => reference.type === 'character')
    .map((reference) => reference.name);
}

function serializeImageReferenceForBff(r: ImageReference) {
  return {
    refId: r.refId,
    type: r.type,
    name: r.name,
    trackingId: r.trackingId,
    assetId: r.assetId,
    variantKey: r.variantKey,
    outfitSeq: r.outfitSeq,
    assetBindingMode: r.assetBindingMode,
  };
}

type SerializedImageReferenceForBff = ReturnType<typeof serializeImageReferenceForBff>;

interface GeneratePromptPayloadForBff {
  type?: string;
  imageRefs?: SerializedImageReferenceForBff[];
  [key: string]: unknown;
}

function buildOfficialVirtualHumanRefs(imageRefs: SerializedImageReferenceForBff[] | undefined) {
  return (imageRefs ?? [])
    .filter((ref) => ref.type === 'character')
    .map((ref) => ({
      refId: ref.refId,
      name: ref.name,
      assetId: ref.assetId,
      variantKey: ref.variantKey,
      outfitSeq: ref.outfitSeq,
      visualReferenceRole: 'outfit_body_only',
      identityReferenceRole: 'official_virtual_human_face',
    }));
}

function withOfficialVirtualHumanGeneratePayload(payloadJson: string): string {
  const payload = JSON.parse(payloadJson) as GeneratePromptPayloadForBff;
  return JSON.stringify({
    ...payload,
    type: 'generate_official_virtual_human',
    officialVirtualHumanMode: true,
    officialVirtualHumanRefs: buildOfficialVirtualHumanRefs(payload.imageRefs),
  });
}

function getSceneReferenceLabel(refId?: string) {
  const imageNumber = refId?.match(/\d+/)?.[0];
  return imageNumber ? `参考图片${imageNumber}` : '';
}

function resolveScenePromptContext(
  storyboard: StoryboardInfo,
  analysis: ScriptAnalysis,
  imageRefs: ImageReference[],
) {
  const sceneRef = imageRefs.find((reference) => reference.type === 'scene');
  const sceneName = storyboard.scene || sceneRef?.name || '';
  const sceneDetail = (sceneName
    ? analysis.scenes.find((scene) => scene.name === sceneName)
    : null)
    ?? (sceneRef ? analysis.scenes.find((scene) => scene.name === sceneRef.name) : null)
    ?? null;

  return {
    sceneRef,
    sceneName,
    sceneDetail,
    hasSceneReference: !!sceneRef,
    sceneReferenceLabel: getSceneReferenceLabel(sceneRef?.refId),
  };
}

/**
 * 步骤1 用户消息 — 只发送剧本文本，格式说明由 BFF 注入
 */
export interface Step1PromptPayload {
  scriptText: string;
  originalSourceText?: string;
  sourceType?: 'annotated' | 'novel';
  seriesContext?: Record<string, unknown>;
}

export function buildStep1UserPrompt(payload: string | Step1PromptPayload): string {
  if (typeof payload === 'string') {
    return JSON.stringify({
      scriptText: payload,
      originalSourceText: '',
      sourceType: 'annotated',
    });
  }

  return JSON.stringify({
    scriptText: payload.scriptText,
    originalSourceText: payload.originalSourceText ?? '',
    sourceType: payload.sourceType ?? 'annotated',
    seriesContext: payload.seriesContext,
  });
}

/**
 * 步骤4.1 检查(check) — 只发送结构化数据，检查规则由 BFF 注入
 */
export function buildCheckPrompt(
  storyboard: StoryboardInfo,
  scriptText: string,
  analysis: ScriptAnalysis,
  prevLastFrameInfo: string,
  itemTracker: Record<string, string>,
  isLastStoryboard: boolean,
  isFirstStoryboard: boolean,
  prevLogicFixSummary?: string,
  propTracking?: PropConsistency[],
  nextStoryboardSummary?: string,
  prevSpatialBlocking?: SpatialBlockingSnapshot | null,
  sceneSpatialBible?: string,
): string {
  const allowedNames = getAnalysisCharacterNames(analysis);
  const scopedPropTracking = filterRelevantPropTracking(storyboard, propTracking, allowedNames);

  return JSON.stringify({
    type: 'check',
    storyboard: {
      number: storyboard.number,
      name: storyboard.name,
      duration: storyboard.duration,
      shotSize: storyboard.shotSize,
      characters: sanitizeStoryboardCharacters(storyboard.characters, { allowedNames }),
    },
    scriptText,
    prevLastFrameInfo: prevLastFrameInfo || '',
    prevSpatialBlocking: prevSpatialBlocking ?? null,
    sceneSpatialBible: sceneSpatialBible || '',
    itemTracker: pickItemTrackerPayload(itemTracker),
    isLastStoryboard,
    isFirstStoryboard,
    prevLogicFixSummary: prevLogicFixSummary || '',
    nextStoryboardSummary: nextStoryboardSummary || '',
    propTracking: scopedPropTracking.map(p => ({
      trackingId: p.trackingId,
      propName: p.propName,
      appearanceDesc: p.appearanceDesc,
      holder: p.holder,
      storyboardRange: p.storyboardRange,
      stateChanges: p.stateChanges,
      needsTracking: p.needsTracking,
      needsImage: p.needsImage,
    })),
  });
}

/**
 * 步骤4.1 预处理 — 向后兼容，内部走 check 流程
 */
export function buildPreprocessPrompt(
  storyboard: StoryboardInfo,
  scriptText: string,
  analysis: ScriptAnalysis,
  prevLastFrameInfo: string,
  itemTracker: Record<string, string>,
  isLastStoryboard: boolean,
  prevLogicFixSummary?: string,
  propTracking?: PropConsistency[],
): string {
  return buildCheckPrompt(
    storyboard, scriptText, analysis, prevLastFrameInfo, itemTracker,
    isLastStoryboard, false, prevLogicFixSummary, propTracking,
  );
}

/**
 * 步骤4.2 修正(correct) — 发送检查结果，让 LLM 改写剧本片段
 */
export function buildCorrectPrompt(
  storyboard: StoryboardInfo,
  scriptText: string,
  logicFixes: LogicFix[],
  isFirstStoryboard: boolean,
  isLastStoryboard: boolean,
  itemTracker?: Record<string, string>,
  propTracking?: PropConsistency[],
  prevNarrativeSummary?: string,
  prevLogicFixSummary?: string,
  sceneBlueprint?: SceneBlueprint | null,
  nextStoryboardSummary?: string,
  allowedCharacterNames?: string[],
): string {
  const allowedNames = allowedCharacterNames ?? [];
  const scopedPropTracking = filterRelevantPropTracking(storyboard, propTracking, allowedNames);

  return JSON.stringify({
    type: 'correct',
    storyboard: {
      number: storyboard.number,
      name: storyboard.name,
      duration: storyboard.duration,
      shotSize: storyboard.shotSize,
      characters: sanitizeStoryboardCharacters(storyboard.characters, { allowedNames }),
    },
    scriptText,
    logicFixes: logicFixes.map((f) => ({
      originalIssue: f.originalIssue,
      correction: f.correction,
      reason: f.reason,
    })),
    isFirstStoryboard,
    isLastStoryboard,
    itemTracker: pickItemTrackerPayload(itemTracker),
    sceneBlueprint: sceneBlueprint ? {
      sceneType: sceneBlueprint.sceneType,
      combatSubType: sceneBlueprint.combatSubType,
      combatType: sceneBlueprint.combatType,
      intensity: sceneBlueprint.intensity,
      emotionArc: sceneBlueprint.emotionArc,
    } : null,
    propTracking: scopedPropTracking.map(p => ({
      trackingId: p.trackingId,
      propName: p.propName,
      appearanceDesc: p.appearanceDesc,
      holder: p.holder,
      storyboardRange: p.storyboardRange,
      stateChanges: p.stateChanges,
      needsTracking: p.needsTracking,
      needsImage: p.needsImage,
    })),
    prevNarrativeSummary: prevNarrativeSummary || '',
    prevLogicFixSummary: prevLogicFixSummary || '',
    nextStoryboardSummary: nextStoryboardSummary || '',
  });
}

/**
 * 步骤4.3 生成(generate) — 只发送结构化数据，格式模板由 BFF 注入
 * correctedScript 为修正后剧本（主源），rawScript 降级为参考
 */
export function buildGeneratePrompt(
  storyboard: StoryboardInfo,
  scriptText: string,
  analysis: ScriptAnalysis,
  imageRefs: ImageReference[],
  logicFixSummary: string,
  prevLastFrameInfo: string,
  isLastStoryboard: boolean,
  preprocessNotes?: string,
  correctedScript?: string,
  isFirstStoryboard?: boolean,
  choreoCheckFailSummary?: string,
  sceneBlueprint?: SceneBlueprint | null,
  propTracking?: PropConsistency[],
  prevNarrativeSummary?: string,
  itemTracker?: Record<string, string>,
  nextStoryboardSummary?: string,
): string {
  const sceneContext = resolveScenePromptContext(storyboard, analysis, imageRefs);
  const allowedNames = [...getAnalysisCharacterNames(analysis), ...getImageRefCharacterNames(imageRefs)];
  const scopedPropTracking = filterRelevantPropTracking(storyboard, propTracking, allowedNames);

  return JSON.stringify({
    type: 'generate',
    storyboard: {
      number: storyboard.number,
      name: storyboard.name,
      scene: sceneContext.sceneName,
      duration: storyboard.duration,
      shotSize: storyboard.shotSize,
      characters: sanitizeStoryboardCharacters(storyboard.characters, { allowedNames }),
    },
    sceneDetail: sceneContext.sceneDetail
      ? {
          timeOfDay: sceneContext.sceneDetail.timeOfDay || '',
          environment: sceneContext.sceneDetail.environment || '',
          colorTone: sceneContext.sceneDetail.colorTone || '',
        }
      : null,
    imageRefs: imageRefs.map(serializeImageReferenceForBff),
    sceneRefName: sceneContext.sceneRef?.name || '',
    hasSceneReference: sceneContext.hasSceneReference,
    sceneReferenceLabel: sceneContext.sceneReferenceLabel,
    scriptText,
    styleConfig: analysis.styleConfig,
    logicFixSummary: logicFixSummary || '',
    prevLastFrameInfo: prevLastFrameInfo || '',
    itemTracker: pickItemTrackerPayload(itemTracker),
    isLastStoryboard,
    isFirstStoryboard: isFirstStoryboard ?? false,
    preprocessNotes: preprocessNotes || '',
    correctedScript: correctedScript || '',
    choreoCheckFailSummary: choreoCheckFailSummary || '',
    generateMode: 'full' satisfies Step4GenerateMode,
    sceneBlueprint: sceneBlueprint ? {
      sceneType: sceneBlueprint.sceneType,
      combatSubType: sceneBlueprint.combatSubType,
      combatType: sceneBlueprint.combatType,
      intensity: sceneBlueprint.intensity,
      emotionArc: sceneBlueprint.emotionArc,
    } : null,
    propTracking: scopedPropTracking.map(p => ({
      trackingId: p.trackingId,
      propName: p.propName,
      appearanceDesc: p.appearanceDesc,
      holder: p.holder,
      storyboardRange: p.storyboardRange,
      stateChanges: p.stateChanges,
      needsTracking: p.needsTracking,
      needsImage: p.needsImage,
    })),
    prevNarrativeSummary: prevNarrativeSummary || '',
    nextStoryboardSummary: nextStoryboardSummary || '',
  });
}

/**
 * 步骤4.3 动作编排(choreograph) — 发送分镜信息+场景蓝图，BFF 根据场景类型注入对应 system prompt
 */
export function buildChoreographPrompt(
  storyboard: StoryboardInfo,
  scriptText: string,
  analysis: ScriptAnalysis,
  imageRefs: ImageReference[],
  correctedScript: string,
  sceneBlueprint: SceneBlueprint | null,
  prevLastFrameInfo: string,
  propTracking?: PropConsistency[],
  itemTracker?: Record<string, string>,
  isFirstStoryboard?: boolean,
  isLastStoryboard?: boolean,
  styleConfig?: string,
  prevNarrativeSummary?: string,
  prevLogicFixSummary?: string,
  nextStoryboardSummary?: string,
  preprocessNotes?: string,
  prevSpatialBlocking?: SpatialBlockingSnapshot | null,
  sceneSpatialBible?: string,
): string {
  const sceneContext = resolveScenePromptContext(storyboard, analysis, imageRefs);
  const allowedNames = [...getAnalysisCharacterNames(analysis), ...getImageRefCharacterNames(imageRefs)];
  const scopedPropTracking = filterRelevantPropTracking(storyboard, propTracking, allowedNames);

  return JSON.stringify({
    type: 'choreograph',
    storyboard: {
      number: storyboard.number,
      name: storyboard.name,
      scene: sceneContext.sceneName,
      duration: storyboard.duration,
      shotSize: storyboard.shotSize,
      characters: sanitizeStoryboardCharacters(storyboard.characters, { allowedNames }),
    },
    sceneDetail: sceneContext.sceneDetail
      ? {
          timeOfDay: sceneContext.sceneDetail.timeOfDay || '',
          environment: sceneContext.sceneDetail.environment || '',
          colorTone: sceneContext.sceneDetail.colorTone || '',
        }
      : null,
    sceneSpatialBible: sceneSpatialBible || '',
    imageRefs: imageRefs.map(serializeImageReferenceForBff),
    scriptText,
    correctedScript: correctedScript || '',
    sceneBlueprint: sceneBlueprint ? {
      sceneType: sceneBlueprint.sceneType,
      combatSubType: sceneBlueprint.combatSubType,
      combatType: sceneBlueprint.combatType,
      intensity: sceneBlueprint.intensity,
      emotionArc: sceneBlueprint.emotionArc,
      keyMoments: sceneBlueprint.keyMoments,
      cameraStyle: sceneBlueprint.cameraStyle,
      suggestedCuts: sceneBlueprint.suggestedCuts,
      needsSlowMotion: sceneBlueprint.needsSlowMotion,
      slowMotionMoments: sceneBlueprint.slowMotionMoments,
      soundDesign: sceneBlueprint.soundDesign,
    } : null,
    prevLastFrameInfo: prevLastFrameInfo || '',
    prevSpatialBlocking: prevSpatialBlocking ?? null,
    propTracking: scopedPropTracking.map(p => ({
      trackingId: p.trackingId,
      propName: p.propName,
      appearanceDesc: p.appearanceDesc,
      holder: p.holder,
      storyboardRange: p.storyboardRange,
      stateChanges: p.stateChanges,
      needsTracking: p.needsTracking,
      needsImage: p.needsImage,
    })),
    itemTracker: pickItemTrackerPayload(itemTracker),
    isFirstStoryboard: isFirstStoryboard ?? false,
    isLastStoryboard: isLastStoryboard ?? false,
    styleConfig: styleConfig || analysis.styleConfig || '',
    prevNarrativeSummary: prevNarrativeSummary || '',
    prevLogicFixSummary: prevLogicFixSummary || '',
    nextStoryboardSummary: nextStoryboardSummary || '',
    preprocessNotes: preprocessNotes || '',
  });
}

/**
 * 步骤4.3.5 编排方案逻辑检查(choreo-check) — 校验 Choreograph 输出的一致性，输出修正后的 choreography JSON
 */
export function buildChoreoCheckPrompt(
  storyboard: StoryboardInfo,
  choreography: Choreography,
  propTracking?: PropConsistency[],
  itemTracker?: Record<string, string>,
  correctedScript?: string,
  scriptText?: string,
  sceneBlueprint?: SceneBlueprint | null,
  prevLastFrameInfo?: string,
  allowedCharacterNames?: string[],
  imageRefs?: ImageReference[],
  nextStoryboardSummary?: string,
  prevSpatialBlocking?: SpatialBlockingSnapshot | null,
  sceneSpatialBible?: string,
  deterministicSpatialIssues?: SpatialContinuityIssue[],
): string {
  const allowedNames = allowedCharacterNames ?? [];
  const scopedPropTracking = filterRelevantPropTracking(storyboard, propTracking, allowedNames);

  return JSON.stringify({
    type: 'choreo_check',
    storyboard: {
      number: storyboard.number,
      name: storyboard.name,
      duration: storyboard.duration,
      characters: sanitizeStoryboardCharacters(storyboard.characters, { allowedNames }),
    },
    choreographyJson: JSON.stringify(choreography),
    propTracking: scopedPropTracking.map(p => ({
      trackingId: p.trackingId,
      propName: p.propName,
      appearanceDesc: p.appearanceDesc,
      holder: p.holder,
      storyboardRange: p.storyboardRange,
      stateChanges: p.stateChanges,
      needsTracking: p.needsTracking,
      needsImage: p.needsImage,
    })),
    imageRefs: (imageRefs ?? []).map(serializeImageReferenceForBff),
    sceneSpatialBible: sceneSpatialBible || '',
    itemTracker: pickItemTrackerPayload(itemTracker),
    correctedScript: correctedScript || '',
    scriptText: scriptText || '',
    sceneBlueprint: sceneBlueprint ? {
      sceneType: sceneBlueprint.sceneType,
      combatSubType: sceneBlueprint.combatSubType,
      combatType: sceneBlueprint.combatType,
      intensity: sceneBlueprint.intensity,
      emotionArc: sceneBlueprint.emotionArc,
      cameraStyle: sceneBlueprint.cameraStyle,
      suggestedCuts: sceneBlueprint.suggestedCuts,
      needsSlowMotion: sceneBlueprint.needsSlowMotion,
      slowMotionMoments: sceneBlueprint.slowMotionMoments,
      soundDesign: sceneBlueprint.soundDesign,
    } : null,
    prevLastFrameInfo: prevLastFrameInfo || '',
    prevSpatialBlocking: prevSpatialBlocking ?? null,
    nextStoryboardSummary: nextStoryboardSummary || '',
    deterministicSpatialIssues: (deterministicSpatialIssues ?? []).map(issue => ({
      character: issue.character,
      type: issue.type,
      message: issue.message,
    })),
  });
}

/**
 * 步骤4.4 带编排方案的 generate — 发送编排方案JSON，BFF 使用简化版格式化模板
 */
export function buildGenerateWithChoreographyPrompt(
  storyboard: StoryboardInfo,
  scriptText: string,
  analysis: ScriptAnalysis,
  imageRefs: ImageReference[],
  choreography: Choreography,
  correctedScript: string,
  prevLastFrameInfo: string,
  isLastStoryboard: boolean,
  isFirstStoryboard: boolean,
  logicFixSummary?: string,
  sceneBlueprint?: SceneBlueprint | null,
  propTracking?: PropConsistency[],
  choreoCheckFailSummary?: string,
  prevNarrativeSummary?: string,
  itemTracker?: Record<string, string>,
  nextStoryboardSummary?: string,
  preprocessNotes?: string,
  prevSpatialBlocking?: SpatialBlockingSnapshot | null,
  sceneSpatialBible?: string,
): string {
  const sceneContext = resolveScenePromptContext(storyboard, analysis, imageRefs);
  const allowedNames = [...getAnalysisCharacterNames(analysis), ...getImageRefCharacterNames(imageRefs)];
  const scopedPropTracking = filterRelevantPropTracking(storyboard, propTracking, allowedNames);

  return JSON.stringify({
    type: 'generate',
    storyboard: {
      number: storyboard.number,
      name: storyboard.name,
      scene: sceneContext.sceneName,
      duration: storyboard.duration,
      shotSize: storyboard.shotSize,
      characters: sanitizeStoryboardCharacters(storyboard.characters, { allowedNames }),
    },
    sceneDetail: sceneContext.sceneDetail
      ? {
          timeOfDay: sceneContext.sceneDetail.timeOfDay || '',
          environment: sceneContext.sceneDetail.environment || '',
          colorTone: sceneContext.sceneDetail.colorTone || '',
        }
      : null,
    imageRefs: imageRefs.map(serializeImageReferenceForBff),
    hasSceneReference: sceneContext.hasSceneReference,
    sceneReferenceLabel: sceneContext.sceneReferenceLabel,
    sceneSpatialBible: sceneSpatialBible || '',
    styleConfig: analysis.styleConfig,
    scriptText,
    correctedScript: correctedScript || '',
    choreography,
    prevLastFrameInfo: prevLastFrameInfo || '',
    prevSpatialBlocking: prevSpatialBlocking ?? null,
    itemTracker: pickItemTrackerPayload(itemTracker),
    isLastStoryboard,
    isFirstStoryboard,
    generateMode: 'formatter' satisfies Step4GenerateMode,
    logicFixSummary: logicFixSummary || '',
    sceneBlueprint: sceneBlueprint ? {
      sceneType: sceneBlueprint.sceneType,
      combatSubType: sceneBlueprint.combatSubType,
      combatType: sceneBlueprint.combatType,
      intensity: sceneBlueprint.intensity,
      emotionArc: sceneBlueprint.emotionArc,
    } : null,
    propTracking: scopedPropTracking.map(p => ({
      trackingId: p.trackingId,
      propName: p.propName,
      appearanceDesc: p.appearanceDesc,
      holder: p.holder,
      storyboardRange: p.storyboardRange,
      stateChanges: p.stateChanges,
      needsTracking: p.needsTracking,
      needsImage: p.needsImage,
    })),
    choreoCheckFailSummary: choreoCheckFailSummary || '',
    prevNarrativeSummary: prevNarrativeSummary || '',
    nextStoryboardSummary: nextStoryboardSummary || '',
    preprocessNotes: preprocessNotes || '',
  });
}

export function buildOfficialVirtualHumanGeneratePrompt(
  storyboard: StoryboardInfo,
  scriptText: string,
  analysis: ScriptAnalysis,
  imageRefs: ImageReference[],
  logicFixSummary: string,
  prevLastFrameInfo: string,
  isLastStoryboard: boolean,
  preprocessNotes?: string,
  correctedScript?: string,
  isFirstStoryboard?: boolean,
  choreoCheckFailSummary?: string,
  sceneBlueprint?: SceneBlueprint | null,
  propTracking?: PropConsistency[],
  prevNarrativeSummary?: string,
  itemTracker?: Record<string, string>,
  nextStoryboardSummary?: string,
): string {
  return withOfficialVirtualHumanGeneratePayload(buildGeneratePrompt(
    storyboard,
    scriptText,
    analysis,
    imageRefs,
    logicFixSummary,
    prevLastFrameInfo,
    isLastStoryboard,
    preprocessNotes,
    correctedScript,
    isFirstStoryboard,
    choreoCheckFailSummary,
    sceneBlueprint,
    propTracking,
    prevNarrativeSummary,
    itemTracker,
    nextStoryboardSummary,
  ));
}

export function buildOfficialVirtualHumanGenerateWithChoreographyPrompt(
  storyboard: StoryboardInfo,
  scriptText: string,
  analysis: ScriptAnalysis,
  imageRefs: ImageReference[],
  choreography: Choreography,
  correctedScript: string,
  prevLastFrameInfo: string,
  isLastStoryboard: boolean,
  isFirstStoryboard: boolean,
  logicFixSummary?: string,
  sceneBlueprint?: SceneBlueprint | null,
  propTracking?: PropConsistency[],
  choreoCheckFailSummary?: string,
  prevNarrativeSummary?: string,
  itemTracker?: Record<string, string>,
  nextStoryboardSummary?: string,
  preprocessNotes?: string,
  prevSpatialBlocking?: SpatialBlockingSnapshot | null,
  sceneSpatialBible?: string,
): string {
  return withOfficialVirtualHumanGeneratePayload(buildGenerateWithChoreographyPrompt(
    storyboard,
    scriptText,
    analysis,
    imageRefs,
    choreography,
    correctedScript,
    prevLastFrameInfo,
    isLastStoryboard,
    isFirstStoryboard,
    logicFixSummary,
    sceneBlueprint,
    propTracking,
    choreoCheckFailSummary,
    prevNarrativeSummary,
    itemTracker,
    nextStoryboardSummary,
    preprocessNotes,
    prevSpatialBlocking,
    sceneSpatialBible,
  ));
}
