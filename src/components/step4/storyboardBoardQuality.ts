import type { StoryboardBoardMode, StoryboardBoardVariantState, StoryboardSequenceContinuityContext } from '@/types';
import {
  getStoryboardBoardExpectedPanelCount,
  isShotPlanBoardMode,
} from './storyboardBoardMode';
import type { StoryboardBoardReference } from './storyboardBoardPrompt';
import { buildStoryboardReferenceReadingContract } from './storyboardReferenceReadingContract';

export type StoryboardBoardQualityTone = 'pass' | 'warn' | 'fail';

export interface StoryboardBoardQualityCheck {
  id: string;
  label: string;
  detail: string;
  tone: StoryboardBoardQualityTone;
}

export interface StoryboardBoardQualityReport {
  checks: StoryboardBoardQualityCheck[];
  hasHighRisk: boolean;
  warningCount: number;
  failCount: number;
}

const STORYBOARD_BOARD_QUALITY_AUTO_REPAIR_CHECK_IDS = new Set([
  'reference-contracts',
  'panel-character-coverage',
  'outfit-version-consistency',
  'no-face-reference-safety',
  'director-contract',
  'mechanism-state',
  'trigger-contact-frame',
  'ui-countdown-contract',
  'start-end-contract',
]);

function isStoryboardBoardQualityAutoRepairEnabled() {
  return false;
}

export interface StoryboardBoardQualityOptions {
  references?: StoryboardBoardReference[];
}

type StoryboardBoardQualityPlan = NonNullable<StoryboardBoardVariantState['plan']>;
type StoryboardBoardQualityPanel = StoryboardBoardQualityPlan['panels'][number];
type StoryboardBoardQualityReferenceMatch = NonNullable<StoryboardBoardQualityPlan['directorBrief']>['referenceMatching'][number];

function compact(value: string | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function hasLongPlanningText(value: string | undefined) {
  const text = compact(value);
  return text.length > 180 || /对白框|气泡|UI|logo|watermark|MODULE/i.test(text);
}

function hasStoryboardReadableCue(value: string | undefined) {
  return compact(value).length > 0;
}

function joinDefined(values: Array<string | undefined>) {
  return values.map(compact).filter(Boolean).join(' ');
}

function normalizeForMatch(value: string | undefined) {
  return compact(value).toLowerCase();
}

function includesAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => !!pattern && text.includes(pattern.toLowerCase()));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map(compact).filter(Boolean)));
}

function collectPlanInspectionText(plan: StoryboardBoardVariantState['plan']) {
  if (!plan) return '';
  return joinDefined([
    plan.boardGoal,
    plan.sceneAnchor,
    plan.styleAnchor,
    plan.worldLock?.sceneName,
    plan.worldLock?.masterScene,
    plan.worldLock?.actionZone,
    plan.worldLock?.continuityNotes,
    plan.blockingContinuity?.previousEnd,
    plan.blockingContinuity?.currentStart,
    plan.blockingContinuity?.currentEnd,
    plan.blockingContinuity?.movementAxis,
    plan.transitionBridge?.previousEndBeat,
    plan.transitionBridge?.transitionType,
    plan.transitionBridge?.firstFrameInstruction,
    ...(plan.worldLock?.anchors ?? []),
    ...(plan.consistencyRules ?? []),
    ...(plan.characterLocks ?? []).flatMap((lock) => [lock.name, ...(lock.mustKeep ?? [])]),
    ...(plan.layoutRules ?? []),
    ...(plan.negativeRules ?? []),
    ...(plan.propLocks ?? []),
    ...(plan.panels ?? []).flatMap((panel) => [
      panel.beat,
      panel.primarySubject,
      panel.composition,
      panel.staticMoment,
      panel.blocking,
      panel.motion,
      panel.cameraTask,
      panel.background,
      panel.continuity,
      panel.worldAnchor,
      panel.dialogue,
      panel.sfx,
      panel.audio,
      panel.transition,
      panel.dialoguePerformance,
      panel.continuityIn,
      panel.continuityOut,
      panel.directorNote,
      ...(panel.mustShow ?? []),
    ]),
  ]);
}

function collectPanelInspectionText(panel: StoryboardBoardQualityPanel) {
  return joinDefined([
    panel.beat,
    panel.primarySubject,
    panel.composition,
    panel.staticMoment,
    panel.blocking,
    panel.motion,
    panel.cameraTask,
    panel.background,
    panel.continuity,
    panel.worldAnchor,
    panel.dialogue,
    panel.sfx,
    panel.audio,
    panel.transition,
    panel.dialoguePerformance,
    panel.continuityIn,
    panel.continuityOut,
    panel.directorNote,
    ...(panel.secondarySubjects ?? []),
    ...(panel.mustShow ?? []),
  ]);
}

function getReferenceLabel(reference: StoryboardBoardReference) {
  const version = reference.variantKey
    ?? (typeof reference.outfitSeq === 'number' ? `outfit-${reference.outfitSeq}` : '');
  return [reference.refId, reference.name, version].filter(Boolean).join(' ');
}

function findReferenceMatch(
  plan: StoryboardBoardVariantState['plan'],
  reference: StoryboardBoardReference,
): StoryboardBoardQualityReferenceMatch | undefined {
  const matches = plan?.directorBrief?.referenceMatching ?? [];
  const referenceName = normalizeForMatch(reference.name);
  const referenceId = normalizeForMatch(reference.refId);
  if (referenceId) {
    const idMatch = matches.find((match) => normalizeForMatch(match.refId) === referenceId);
    if (idMatch) return idMatch;
  }
  return matches.find((match) => !!referenceName && normalizeForMatch(match.name) === referenceName);
}

function isCharacterReference(reference: StoryboardBoardReference) {
  return reference.type === 'character';
}

function isOutfitReference(reference: StoryboardBoardReference) {
  return isCharacterReference(reference)
    && (
      reference.concept === 'landscape_outfit_turnaround'
      || reference.concept === 'portrait_outfit'
      || !!reference.variantKey
      || typeof reference.outfitSeq === 'number'
    );
}

function readForHasContractTerms(reference: StoryboardBoardReference, readFor: string, doNotUseFor: string) {
  if (reference.type === 'scene') {
    return includesAny(readFor, ['spatial layout', 'camera axis', 'lighting direction', 'action zone']);
  }

  if (reference.type === 'prop') {
    return includesAny(readFor, ['prop shape', 'material', 'state', 'holder relation']);
  }

  if (reference.isNoFaceCharacterVisual) {
    return includesAny(readFor, ['no-face', 'no face'])
      && includesAny(readFor, ['clothing version', 'body proportion', 'outfit silhouette', 'material', 'equipment'])
      && includesAny(doNotUseFor, ['face', 'facial features', 'hairstyle', 'skin tone', 'portrait identity']);
  }

  if (reference.assetSource === 'volc_virtual_human') {
    return includesAny(readFor, ['official identity', 'portrait identity', 'face identity'])
      && includesAny(doNotUseFor, ['clothing version', 'body proportion', 'material', 'outfit detail']);
  }

  if (reference.concept === 'landscape_outfit_turnaround') {
    return includesAny(readFor, ['outfit version lock', 'selected outfit', reference.variantKey ?? '', `outfit-${reference.outfitSeq ?? ''}`])
      && includesAny(readFor, ['same identity', 'face hero close-up'])
      && includesAny(readFor, ['front view', 'body proportion'])
      && includesAny(readFor, ['costume / suit detail', 'material', 'outfit details']);
  }

  if (reference.concept === 'landscape_turnaround') {
    return includesAny(readFor, ['face hero close-up', 'face identity'])
      && includesAny(readFor, ['front view', 'body proportion'])
      && includesAny(readFor, ['back view', 'base outfit silhouette'])
      && includesAny(readFor, ['costume / suit detail', 'material']);
  }

  if (reference.concept === 'portrait_outfit') {
    return includesAny(readFor, ['outfit portrait lock', 'selected outfit version', 'outfit version'])
      && includesAny(readFor, ['same character identity', 'same identity', 'body proportion']);
  }

  return includesAny(readFor, ['character identity lock', 'face identity', 'visual anchors', 'performance direction']);
}

function findReferenceContractIssues(
  references: StoryboardBoardReference[],
  plan: StoryboardBoardVariantState['plan'],
) {
  if (references.length === 0) return [];
  if (!plan) return references.map((reference) => `${getReferenceLabel(reference)}: missing plan`);

  return references.flatMap((reference) => {
    const match = findReferenceMatch(plan, reference);
    const expected = buildStoryboardReferenceReadingContract(reference);
    if (!match) {
      return [`${getReferenceLabel(reference)}: missing directorBrief.referenceMatching`];
    }

    const readFor = normalizeForMatch(match.readFor);
    const doNotUseFor = normalizeForMatch(match.doNotUseFor);
    const issues: string[] = [];
    if (!readForHasContractTerms(reference, readFor, doNotUseFor)) {
      issues.push(`${getReferenceLabel(reference)}: readFor must cover ${expected.mustKeep.slice(0, 3).join(', ')}`);
    }
    if (!doNotUseFor) {
      issues.push(`${getReferenceLabel(reference)}: missing doNotUseFor`);
    }
    return issues;
  });
}

function getExpectedCharacterNames(
  references: StoryboardBoardReference[],
  plan: StoryboardBoardVariantState['plan'],
) {
  const lockedNames = (plan?.characterLocks ?? [])
    .filter((lock) => lock.role !== 'background')
    .map((lock) => lock.name);
  if (lockedNames.length > 0) return uniqueStrings(lockedNames);
  return uniqueStrings(references.filter(isCharacterReference).map((reference) => reference.name));
}

function findPanelCharacterCoverageIssues(
  references: StoryboardBoardReference[],
  plan: StoryboardBoardVariantState['plan'],
) {
  if (!plan || references.filter(isCharacterReference).length === 0) return [];
  const allPanelText = normalizeForMatch(plan.panels.map(collectPanelInspectionText).join(' '));
  return getExpectedCharacterNames(references, plan)
    .filter((name) => !allPanelText.includes(normalizeForMatch(name)))
    .map((name) => `${name}: not visible in any storyboard panel text`);
}

function findOutfitConsistencyIssues(
  references: StoryboardBoardReference[],
  plan: StoryboardBoardVariantState['plan'],
) {
  const outfitReferences = references.filter(isOutfitReference);
  if (outfitReferences.length === 0) return [];
  if (!plan) return outfitReferences.map((reference) => `${getReferenceLabel(reference)}: missing plan`);

  const planText = normalizeForMatch([
    collectPlanInspectionText(plan),
    ...(plan.directorBrief?.referenceMatching ?? []).flatMap((match) => [match.readFor, match.doNotUseFor]),
  ].join(' '));
  const hasOutfitLock = includesAny(planText, [
    'outfit version lock',
    'outfit version consistency',
    'selected outfit version',
    'clothing version',
  ]);
  const issues: string[] = [];
  if (!hasOutfitLock) {
    issues.push('selected outfit reference is present but outfit version consistency is not locked');
  }

  const driftPanels = plan.panels
    .filter((panel) => /base outfit|default outfit|original outfit|basic outfit|基础服装|基础装|原始服装/i.test(collectPanelInspectionText(panel)))
    .map((panel) => `S${String(panel.index).padStart(2, '0')}`);
  if (driftPanels.length > 0) {
    issues.push(`base/default outfit drift in ${driftPanels.join(', ')}`);
  }

  outfitReferences.forEach((reference) => {
    if (!findReferenceMatch(plan, reference)) {
      issues.push(`${getReferenceLabel(reference)}: missing outfit reference match`);
    }
  });

  return issues;
}

function findNoFaceReferenceSafetyIssues(
  references: StoryboardBoardReference[],
  plan: StoryboardBoardVariantState['plan'],
) {
  const noFaceReferences = references.filter((reference) => reference.isNoFaceCharacterVisual);
  if (noFaceReferences.length === 0) return [];
  if (!plan) return noFaceReferences.map((reference) => `${getReferenceLabel(reference)}: missing plan`);

  return noFaceReferences.flatMap((reference) => {
    const match = findReferenceMatch(plan, reference);
    if (!match) return [`${getReferenceLabel(reference)}: missing no-face reference match`];
    const readFor = normalizeForMatch(match.readFor);
    const doNotUseFor = normalizeForMatch(match.doNotUseFor);
    const issues: string[] = [];
    if (/face identity|facial features|hairstyle|skin tone|portrait identity|official-person likeness|五官|脸型|发型|肤色/i.test(readFor)) {
      issues.push(`${getReferenceLabel(reference)}: no-face readFor leaks face identity terms`);
    }
    if (!includesAny(readFor, ['no-face', 'no face', 'clothing version', 'body proportion', 'material'])) {
      issues.push(`${getReferenceLabel(reference)}: no-face readFor does not stay on outfit/body/material`);
    }
    if (!includesAny(doNotUseFor, ['face', 'facial features', 'hairstyle', 'skin tone', 'portrait identity'])) {
      issues.push(`${getReferenceLabel(reference)}: no-face doNotUseFor lacks face/portrait prohibitions`);
    }
    return issues;
  });
}

function collectDirectorContractText(plan: StoryboardBoardVariantState['plan']) {
  const contract = plan?.directorContract;
  if (!contract) return '';
  return joinDefined([
    contract.spatialContract,
    contract.mechanismState,
    contract.uiContinuity,
    contract.beatProgression,
    contract.startFrameContract,
    contract.endBeatContract,
    ...(contract.characterZones ?? []),
    ...(contract.rejectionRules ?? []),
  ]);
}

function hasCompleteDirectorContract(plan: StoryboardBoardVariantState['plan']) {
  const contract = plan?.directorContract;
  return !!contract
    && !!compact(contract.spatialContract)
    && (contract.characterZones?.length ?? 0) > 0
    && !!compact(contract.mechanismState)
    && !!compact(contract.uiContinuity)
    && !!compact(contract.beatProgression)
    && !!compact(contract.startFrameContract)
    && !!compact(contract.endBeatContract)
    && (contract.rejectionRules?.length ?? 0) > 0;
}

function findRepeatedPanelRuns(panels: NonNullable<StoryboardBoardVariantState['plan']>['panels']) {
  const runs: string[] = [];
  let previous = '';
  let count = 0;
  let startIndex = 1;

  panels.forEach((panel, index) => {
    const signature = [
      compact(panel.primarySubject).toLowerCase(),
      compact(panel.shotType).toLowerCase(),
      compact(panel.cameraAngle).toLowerCase(),
      compact(panel.cameraTask).toLowerCase(),
    ].join('|');
    if (signature && signature === previous) {
      count += 1;
    } else {
      if (previous && count >= 3) runs.push(`S${String(startIndex).padStart(2, '0')}-S${String(index).padStart(2, '0')}`);
      previous = signature;
      count = signature ? 1 : 0;
      startIndex = index + 1;
    }
  });
  if (previous && count >= 3) runs.push(`S${String(startIndex).padStart(2, '0')}-S${String(panels.length).padStart(2, '0')}`);
  return runs;
}

function extractReadableUiTimers(panels: NonNullable<StoryboardBoardVariantState['plan']>['panels']) {
  const source = panels.map((panel) => joinDefined([
    panel.beat,
    panel.staticMoment,
    panel.blocking,
    panel.motion,
    panel.cameraTask,
    panel.background,
    panel.continuity,
    panel.dialogue,
    panel.sfx,
    panel.audio,
    panel.dialoguePerformance,
    panel.directorNote,
    ...(panel.mustShow ?? []),
  ])).join(' ');
  return Array.from(new Set(source.match(/(?:\d{1,2}[:：]\d{2}[:：]\d{2}|\d{1,2}[:：]\d{2}|倒计时\s*\d+|countdown\s*\d+)/gi) ?? []));
}

function buildCheck(
  id: string,
  passed: boolean,
  warning: boolean,
  label: string,
  passDetail: string,
  failDetail: string,
): StoryboardBoardQualityCheck {
  return {
    id,
    label,
    detail: passed ? passDetail : failDetail,
    tone: passed ? 'pass' : warning ? 'warn' : 'fail',
  };
}

export function getStoryboardBoardQualityAutoRepairChecks(
  report: StoryboardBoardQualityReport,
): StoryboardBoardQualityCheck[] {
  return report.checks.filter((check) =>
    check.tone !== 'pass' && STORYBOARD_BOARD_QUALITY_AUTO_REPAIR_CHECK_IDS.has(check.id),
  );
}

export function buildStoryboardBoardQualityRepairHint(
  report: StoryboardBoardQualityReport,
  attempt = 1,
): string | undefined {
  if (!isStoryboardBoardQualityAutoRepairEnabled()) return undefined;
  const repairChecks = getStoryboardBoardQualityAutoRepairChecks(report);
  if (repairChecks.length === 0) return undefined;

  return [
    `QUALITY_GATE_AUTO_REPAIR attempt ${attempt}: regenerate the storyboard board plan as valid JSON only.`,
    'Fix these quality checks before returning:',
    ...repairChecks.slice(0, 8).map((check) =>
      `- ${check.id} (${check.tone}): ${check.detail}`,
    ),
    'Mandatory repair rules:',
    '- Preserve the existing StoryboardBoardPlan JSON shape and exact panel count.',
    '- Fill directorBrief.referenceMatching by refId for every Step3 reference, including readFor and doNotUseFor.',
    '- Keep selected outfit version consistency; never drift to base outfit/default outfit when an outfit reference exists.',
    '- For no-face outfit/body references, read only clothing/body/material/accessories/equipment and never face identity, facial features, hairstyle, or skin tone.',
    '- For visible characters, make sure the exact character names appear in panel primarySubject, secondarySubjects, mustShow, dialogue, or directorNote; do not leave named characters implied only by pronouns.',
    '- If UI, countdown, task panel, or diegetic数字 exists, directorContract.uiContinuity must define first-clear / later-blur-or-placeholder / no-random-digits strategy and the panel text must echo it.',
    '- In 15-panel shot-plan mode, include directorContract with spatialContract, characterZones, mechanismState, uiContinuity, beatProgression, startFrameContract, endBeatContract, and rejectionRules.',
    '- Make START/S01 and final panel/END BEAT handoffs explicit through blockingContinuity, transitionBridge, continuityIn, and continuityOut.',
  ].join('\n');
}

export function getStoryboardBoardQualityBlockingChecks(
  report: StoryboardBoardQualityReport,
): StoryboardBoardQualityCheck[] {
  return report.checks.filter((check) => check.tone === 'fail');
}

export function summarizeStoryboardBoardQualityWarnings(
  report: StoryboardBoardQualityReport,
  maxItems = 4,
): string | undefined {
  const warnings = report.checks.filter((check) => check.tone === 'warn');
  if (warnings.length === 0) return undefined;
  const suffix = warnings.length > maxItems ? ` / +${warnings.length - maxItems} more` : '';
  return `${warnings.slice(0, maxItems).map((check) => `${check.id}: ${check.detail}`).join(' / ')}${suffix}`;
}

export function summarizeStoryboardBoardQualityIssues(
  report: StoryboardBoardQualityReport,
  maxItems = 4,
): string | undefined {
  const issues = report.checks.filter((check) => check.tone !== 'pass');
  if (issues.length === 0) return undefined;
  const suffix = issues.length > maxItems ? ` / +${issues.length - maxItems} more` : '';
  return `${issues.slice(0, maxItems).map((check) => `${check.id} (${check.tone}): ${check.detail}`).join(' / ')}${suffix}`;
}

export function evaluateStoryboardBoardQuality(
  boardState: StoryboardBoardVariantState | undefined,
  mode: StoryboardBoardMode,
  sequenceContinuityContext?: StoryboardSequenceContinuityContext,
  options: StoryboardBoardQualityOptions = {},
): StoryboardBoardQualityReport {
  const plan = boardState?.plan;
  const panels = plan?.panels ?? [];
  const references = options.references ?? [];
  const expectedPanelCount = getStoryboardBoardExpectedPanelCount(
    mode,
    undefined,
    isShotPlanBoardMode(mode) ? panels.length : undefined,
  );
  const expectedIndexes = Array.from({ length: expectedPanelCount }, (_value, index) => index + 1);
  const actualIndexes = panels.map((panel) => panel.index);
  const hasSequentialPanels = expectedIndexes.every((index) => actualIndexes[index - 1] === index);
  const firstPanel = panels[0];
  const lastPanel = panels[panels.length - 1];
  const longTextPanels = panels.filter((panel) =>
    hasLongPlanningText(panel.directorNote)
    || hasLongPlanningText(panel.dialoguePerformance)
    || hasLongPlanningText(panel.staticMoment),
  );
  const detailedBoardMode = mode === 'nine-landscape' || mode === 'nine-portrait' || isShotPlanBoardMode(mode);
  const needsPreviousHandoff = !!sequenceContinuityContext?.hasPrevious;
  const hasPreviousEnd = !!compact(plan?.blockingContinuity?.previousEnd)
    || !!compact(sequenceContinuityContext?.previousLastFrameInfo);
  const hasFirstPanelContinuityIn = !!compact(firstPanel?.continuityIn);
  const isShotPlanMode = isShotPlanBoardMode(mode);
  const transitionBridge = plan?.transitionBridge;
  const hasTransitionBridge = !!compact(transitionBridge?.transitionType)
    && (!!compact(transitionBridge?.visualBridge)
      || !!compact(transitionBridge?.soundBridge)
      || !!compact(transitionBridge?.cameraBridge)
      || !!compact(transitionBridge?.firstFrameInstruction));
  const planInspectionText = collectPlanInspectionText(plan);
  const directorContractText = collectDirectorContractText(plan);
  const hasDirectorContract = hasCompleteDirectorContract(plan);
  const hasBoundaryOrGate = /门槛|门内|门外|越线|边界|入口|门|gate|door|threshold|boundary|inside|outside|entrance/i.test(planInspectionText);
  const hasUiOrCountdown = /任务面板|系统面板|倒计时|弹幕|直播界面|UI|countdown|timer|panel/i.test(planInspectionText);
  const hasCausalTriggerAction = /踢|砸|撞|拉|按|插|塞|抛|接住|接上|接过|交接|射击|开枪|引爆|通电|咬住|破门|破窗|击中|命中|kick|hit|smash|pull|press|plug|insert|shove|throw|catch|shoot|ignite|electrify|bite|breach/i.test(planInspectionText);
  const hasMechanismContract = !isShotPlanMode || !hasBoundaryOrGate || (
    /门|入口|机关|gate|door|mechanism/i.test(directorContractText)
    && /状态链|初始状态|S01前|S01 前|开场前|半开|敞开|已开|已破|already open|before S01|initial state/i.test(directorContractText)
    && /S0[1-9]|S1[0-5]|panel/i.test(directorContractText)
    && /门槛|破口|门缝|门轴|门扇|玻璃|边界|越线|threshold|breach|gap|hinge|crack/i.test(directorContractText)
    && /S(?:0[1-9]|1[0-5])|END BEAT|最终状态|最终|end state/i.test(directorContractText)
  );
  const hasTriggerContactContract = !isShotPlanMode || !hasCausalTriggerAction || (
    /触发动作|接触帧|可见接触|命中|击中|踢中|插入|塞入|塞进|按下|接上|咬住|impact|contact frame|visible contact|insert|plug|press|bite/i.test(directorContractText)
    && /预备|准备|接触|命中|结果|反馈|火花|爆炸|电弧|倒塌|prepare|contact|result|aftermath|spark|explosion|arc/i.test(directorContractText)
  );
  const hasUiStabilizationTerms = /首次|只允许|虚焦|模糊|红光|tick|占位|后期|随机|乱跳|blur|placeholder|no random|random digits/i.test(directorContractText);
  const hasUiContinuityContract = !isShotPlanMode || !hasUiOrCountdown || (
    /UI|倒计时|数字|面板|countdown|timer|digit/i.test(directorContractText)
    && hasUiStabilizationTerms
  );
  const repeatedPanelRuns = isShotPlanMode ? findRepeatedPanelRuns(panels) : [];
  const readableUiTimers = isShotPlanMode ? extractReadableUiTimers(panels) : [];
  const hasTimerDigitStrategy = !isShotPlanMode || readableUiTimers.length <= 1 || hasUiStabilizationTerms;
  const hasStartEndContract = !isShotPlanMode || (
    /START FRAME|S01|首帧/i.test(directorContractText)
    && /END BEAT|S15|尾帧|落幅/i.test(directorContractText)
  );
  const needsNextHandoff = !!compact(sequenceContinuityContext?.nextContinuityIn);
  const hasLastPanelContinuityOut = !!compact(lastPanel?.continuityOut || lastPanel?.continuity)
    || !!compact(plan?.blockingContinuity?.currentEnd);
  const postureWarnings = sequenceContinuityContext?.warnings ?? [];
  const referenceContractIssues = findReferenceContractIssues(references, plan);
  const panelCharacterCoverageIssues = findPanelCharacterCoverageIssues(references, plan);
  const outfitConsistencyIssues = findOutfitConsistencyIssues(references, plan);
  const noFaceReferenceSafetyIssues = findNoFaceReferenceSafetyIssues(references, plan);
  const missingCuePanels = detailedBoardMode
    ? panels.filter((panel) =>
        !hasStoryboardReadableCue(panel.timeRange || panel.beat)
        || !hasStoryboardReadableCue(panel.shotType || panel.cameraTask)
        || !hasStoryboardReadableCue(panel.motion || panel.staticMoment)
        || !hasStoryboardReadableCue(panel.dialogue)
        || !hasStoryboardReadableCue(panel.sfx)
        || !hasStoryboardReadableCue(panel.audio)
        || !hasStoryboardReadableCue(panel.transition),
      )
    : [];

  const checks: StoryboardBoardQualityCheck[] = [
    buildCheck(
      'plan-ready',
      !!plan,
      false,
      '导演规划',
      '已有结构化导演规划。',
      '还没有可用于视频提交的导演规划。',
    ),
    buildCheck(
      'panel-count',
      !!plan && panels.length === expectedPanelCount,
      false,
      '格数',
      `${expectedPanelCount} 格完整。`,
      `需要 ${expectedPanelCount} 格，当前 ${panels.length || 0} 格。`,
    ),
    buildCheck(
      'panel-order',
      !!plan && hasSequentialPanels,
      false,
      '顺序',
      '分镜顺序连续。',
      '分镜编号不连续，可能导致 Step5 时间线错位。',
    ),
    buildCheck(
      'continuity',
      !!plan && !!compact(firstPanel?.continuityIn) && !!compact(lastPanel?.continuityOut || lastPanel?.continuity),
      false,
      '首尾状态',
      '起点和落幅都已标注。',
      '缺少起点或落幅，续写和下一镜承接会变弱。',
    ),
    buildCheck(
      'locks',
      !!plan && ((plan.characterLocks?.length ?? 0) > 0 || panels.some((panel) => compact(panel.primarySubject))),
      true,
      '角色锁定',
      '角色锁定或主体信息可用。',
      '角色锁定较弱，可能出现身份漂移。',
    ),
    buildCheck(
      'reference-contracts',
      references.length === 0 || (!!plan && referenceContractIssues.length === 0),
      false,
      'Reference contracts',
      references.length > 0
        ? 'Step3 reference reading contracts are covered before storyboard planning.'
        : 'No Step3 reference contracts are required for this board.',
      referenceContractIssues.slice(0, 4).join(' / ') || 'Step3 reference reading contracts are missing or too generic.',
    ),
    buildCheck(
      'panel-character-coverage',
      references.filter(isCharacterReference).length === 0 || (!!plan && panelCharacterCoverageIssues.length === 0),
      true,
      'Character coverage',
      references.filter(isCharacterReference).length > 0
        ? 'Storyboard panels mention the planned non-background character locks.'
        : 'No character reference coverage check is required.',
      panelCharacterCoverageIssues.slice(0, 4).join(' / ') || 'Some planned characters are not visible in the storyboard panel text.',
    ),
    buildCheck(
      'outfit-version-consistency',
      references.filter(isOutfitReference).length === 0 || (!!plan && outfitConsistencyIssues.length === 0),
      false,
      'Outfit version',
      references.filter(isOutfitReference).length > 0
        ? 'Selected outfit version is locked and no base/default outfit drift is detected.'
        : 'No outfit variant reference is used by this board.',
      outfitConsistencyIssues.slice(0, 4).join(' / ') || 'Selected outfit reference exists but the storyboard plan does not lock its version.',
    ),
    buildCheck(
      'no-face-reference-safety',
      references.filter((reference) => reference.isNoFaceCharacterVisual).length === 0
        || (!!plan && noFaceReferenceSafetyIssues.length === 0),
      false,
      'No-face safety',
      references.filter((reference) => reference.isNoFaceCharacterVisual).length > 0
        ? 'No-face outfit/body references stay away from face identity terms.'
        : 'No no-face character reference is used by this board.',
      noFaceReferenceSafetyIssues.slice(0, 4).join(' / ') || 'No-face outfit/body reference leaked face identity terms.',
    ),
    buildCheck(
      'space-camera',
      !!plan && !!compact(plan.worldLock?.sceneName || plan.sceneAnchor) && !!compact(plan.cameraPlan?.cameraRelation || plan.cameraPlan?.lensPlan),
      true,
      '空间与机位',
      '场景锚点和机位信息可用。',
      '空间锚点或机位信息偏弱，可能影响镜头方向。',
    ),
    buildCheck(
      'storyboard-readable-cues',
      !detailedBoardMode || (!!plan && missingCuePanels.length === 0),
      true,
      '故事板信息条',
      detailedBoardMode ? '逐格 TIME/SHOT/CAMERA/ACTION/DIALOGUE/SFX/AUDIO/TRANSITION 信息完整。' : '当前模式不要求完整故事板信息条。',
      `${missingCuePanels.length} 格缺少对白、音效、音频或转场等故事板信息，Step5 读取节奏会变弱。`,
    ),
    buildCheck(
      'storyboard-text-readability',
      !!plan && longTextPanels.length === 0,
      true,
      '故事板可读性',
      '逐格说明保持短句，适合放进故事板信息条。',
      `${longTextPanels.length} 格含过长或不适合故事板的信息，可能导致信息条不可读。`,
    ),
    buildCheck(
      'cross-shot-continuity',
      !needsPreviousHandoff || (!!plan && hasPreviousEnd && hasFirstPanelContinuityIn),
      true,
      'Cross-shot handoff',
      needsPreviousHandoff
        ? `Previous ${isShotPlanMode ? 'S15 / end beat' : 'S09'} handoff is available and S01 declares continuity-in.`
        : 'No previous storyboard handoff is required for this shot.',
      'Previous shot context exists, but this board is missing blockingContinuity.previousEnd or S01 continuityIn; refresh the director plan before regenerating the board.',
    ),
    buildCheck(
      'transition-bridge',
      !isShotPlanMode || !needsPreviousHandoff || (!!plan && hasTransitionBridge),
      true,
      'Transition-in',
      isShotPlanMode && needsPreviousHandoff
        ? '15格导演规划已写明上一镜 end beat 的入场转场方式和 S01 承接。'
        : '当前模式或首镜不强制要求专业入场转场桥。',
      '15格已有上一镜上下文，但缺少 transitionBridge.transitionType 或 visual/sound/camera/firstFrameInstruction；需要让导演规划判断硬切、匹配剪辑、声音桥、蒙太奇等入场方式。',
    ),
    buildCheck(
      'director-contract',
      !isShotPlanMode || (!!plan && hasDirectorContract),
      true,
      'Director contract',
      isShotPlanMode
        ? '15格导演规划已先锁定空间、人物区域、机制状态、UI、节拍和首尾落幅硬合同。'
        : '当前模式不强制 15格 directorContract。',
      '15格缺少 directorContract；必须先锁定空间边界、人物 zone、门/机关状态、UI数字策略、节拍推进、START/S01 与 S15/END BEAT 一致性，不能把这些判断交给视频模型。',
    ),
    buildCheck(
      'mechanism-state',
      !!plan && hasMechanismContract,
      true,
      '门/机关状态',
      hasBoundaryOrGate
        ? '门/入口/边界状态已有 S01前-S15 状态链和可见动作因果约束。'
        : '当前规划未检测到门/入口/边界机制，不需要额外门状态锁。',
      '检测到门、入口、门槛或边界，但缺少明确入口状态链；必须写清 S01前初始状态、哪些 S 格可见变化、门槛/破口/门缝/门轴/门扇方向、S15最终状态。',
    ),
    buildCheck(
      'trigger-contact-frame',
      !!plan && hasTriggerContactContract,
      true,
      '触发动作接触帧',
      hasCausalTriggerAction
        ? '因果触发动作已有可见接触帧合同，避免从准备直接跳到结果。'
        : '当前规划未检测到需要额外接触帧的触发动作。',
      '检测到踢、砸、撞、按、插、塞、通电、咬住或破门等触发动作，但 directorContract 缺少“预备 → 接触/命中 → 结果”的可见接触帧合同。',
    ),
    buildCheck(
      'ui-countdown-contract',
      !!plan && hasUiContinuityContract && hasTimerDigitStrategy,
      true,
      'UI / 倒计时',
      hasUiOrCountdown
        ? 'diegetic UI / 倒计时已有数字策略，避免随机可读数字和倒计时乱跳。'
        : '当前规划未检测到任务面板、倒计时或弹幕 UI。',
      readableUiTimers.length > 1
        ? `检测到多个可读 UI/倒计时数字：${readableUiTimers.join('、')}；15格应只首次清晰显示剧情指定数字，后续用虚焦、红光、tick 或后期占位。`
        : '检测到任务面板、倒计时或 UI，但缺少“首次清晰/后续虚焦或占位/禁止随机数字”的策略。',
    ),
    buildCheck(
      'beat-progression',
      !isShotPlanMode || (!!plan && repeatedPanelRuns.length === 0),
      true,
      '节拍推进',
      isShotPlanMode
        ? '15格未发现连续 3 格以上重复同一主体/景别/机位的无推进构图。'
        : '当前模式不强制 15格逐秒节拍检查。',
      repeatedPanelRuns.length > 0
        ? `以下区间疑似重复同一构图并吞掉剧情节拍：${repeatedPanelRuns.join('、')}；请把 reveal、UI、反应、警告、END BEAT 分配到明确 panel。`
        : '15格节拍推进不明确。',
    ),
    buildCheck(
      'start-end-contract',
      !isShotPlanMode || (!!plan && hasStartEndContract),
      true,
      'START / END 锁定',
      isShotPlanMode
        ? 'START FRAME/S01 与 S15/END BEAT 的一致性已写入导演合同。'
        : '当前模式不强制 START/END 合同。',
      '15格必须写明顶部 START FRAME 与 S01 同机位、同站位、同动作方向，且 S15 与底部 END BEAT 是同一落幅锚点。',
    ),
    buildCheck(
      'next-shot-handoff',
      !needsNextHandoff || (!!plan && hasLastPanelContinuityOut),
      true,
      'Next-shot reserve',
      needsNextHandoff
        ? 'Final panel reserves a usable continuityOut/currentEnd for the next shot.'
        : 'No next-shot reserve is required.',
      'Next storyboard context exists, but the final panel lacks continuityOut/currentEnd; the next shot may restart abruptly.',
    ),
    buildCheck(
      'posture-transition',
      postureWarnings.length === 0,
      true,
      'Posture continuity',
      'No obvious low-posture to standing jump was detected.',
      postureWarnings.join(' / ') || 'Potential posture or prop-state jump detected; S01-S03 should bridge the transition.',
    ),
  ];

  const warningCount = checks.filter((check) => check.tone === 'warn').length;
  const failCount = checks.filter((check) => check.tone === 'fail').length;

  return {
    checks,
    hasHighRisk: failCount > 0 || warningCount > 0,
    warningCount,
    failCount,
  };
}
