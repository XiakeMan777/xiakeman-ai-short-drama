import type {
  EpisodeShotSheetSegment,
  StoryboardBoardMode,
  StoryboardBoardPlanPanel,
  StoryboardSequenceContinuityContext,
  StoryboardState,
} from '@/types';
import {
  getStoryboardBoardSelectedMode,
  getStoryboardBoardVariant,
  normalizeStoryboardBoardState,
} from '@/lib/storyboardBoardState';

function compactText(value: string | undefined, maxLength = 220): string {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function compactList(values: Array<string | undefined>, maxItems = 6): string[] {
  return values
    .map((value) => compactText(value, 180))
    .filter(Boolean)
    .slice(0, maxItems);
}

function pickPreviousFinalPanel(panel: StoryboardBoardPlanPanel | undefined) {
  if (!panel) return undefined;
  return {
    index: panel.index,
    beat: compactText(panel.beat),
    staticMoment: compactText(panel.staticMoment),
    blocking: compactText(panel.blocking || panel.composition),
    motion: compactText(panel.motion),
    continuityOut: compactText(panel.continuityOut || panel.continuity),
    dialogue: compactText(panel.dialogue, 120),
    sfx: compactText(panel.sfx, 120),
    audio: compactText(panel.audio, 120),
  };
}

function getPreviousPlanPanel(
  previousStoryboard: StoryboardState | undefined,
  mode?: StoryboardBoardMode,
): StoryboardBoardPlanPanel | undefined {
  const normalizedBoard = normalizeStoryboardBoardState(previousStoryboard?.storyboardBoard);
  if (!normalizedBoard) return undefined;
  const selectedMode = getStoryboardBoardSelectedMode(normalizedBoard);
  const requestedVariant = mode ? getStoryboardBoardVariant(normalizedBoard, mode) : undefined;
  const selectedVariant = getStoryboardBoardVariant(normalizedBoard, selectedMode);
  return requestedVariant?.plan?.panels?.at(-1) ?? selectedVariant?.plan?.panels?.at(-1);
}

function getPreviousFinalPanelLabel(mode: StoryboardBoardMode | undefined, previousPanel?: StoryboardBoardPlanPanel) {
  if (mode === 'shot-plan-landscape') return 'S15 / END BEAT';
  if (mode === 'smart-shot-plan-landscape') {
    const finalIndex = previousPanel?.index;
    return finalIndex ? `S${String(finalIndex).padStart(2, '0')} / END BEAT` : 'final S / END BEAT';
  }
  return 'S09';
}

function hasLowPosture(value: string) {
  return /趴|爬|跪|半跪|蹲|倒地|摔倒|撑地|低位|地面|prone|crawl|crawling|kneel|kneeling|crouch|crouching|ground|floor/i.test(value);
}

function hasStandingJump(value: string) {
  return /站起|起身|站立|直立|站到|standing|stand up|upright/i.test(value);
}

export function buildStoryboardSequenceContinuityContext(
  storyboards: readonly StoryboardState[],
  currentIndex: number,
  episodeShotSheetSegment?: EpisodeShotSheetSegment,
  mode?: StoryboardBoardMode,
  nextEpisodeShotSheetSegment?: EpisodeShotSheetSegment,
): StoryboardSequenceContinuityContext {
  const currentStoryboard = storyboards[currentIndex];
  const previousStoryboard = currentIndex > 0 ? storyboards[currentIndex - 1] : undefined;
  const previousPanel = getPreviousPlanPanel(previousStoryboard, mode);
  const previousFinalPanelLabel = getPreviousFinalPanelLabel(mode, previousPanel);
  const previousFinalPanel = pickPreviousFinalPanel(previousPanel);
  const previousLastFrameInfo = compactText(
    previousStoryboard?.continuityOutput?.lastFrameInfo
      || previousStoryboard?.lastFrameInfo
      || currentStoryboard?.continuityInput?.lastFrameInfo,
    320,
  );
  const currentContinuityIn = compactText(
    currentStoryboard?.continuityInput?.lastFrameInfo
      || episodeShotSheetSegment?.continuityIn,
    260,
  );
  const currentContinuityOut = compactText(
    episodeShotSheetSegment?.continuityOut
      || currentStoryboard?.lastFrameInfo
      || currentStoryboard?.continuityOutput?.lastFrameInfo,
    260,
  );
  const nextContinuityIn = compactText(
    nextEpisodeShotSheetSegment?.continuityIn
      || storyboards[currentIndex + 1]?.continuityInput?.lastFrameInfo,
    260,
  );

  const previousText = [
    previousLastFrameInfo,
    previousFinalPanel?.staticMoment,
    previousFinalPanel?.blocking,
    previousFinalPanel?.motion,
    previousFinalPanel?.continuityOut,
  ].join(' ');
  const currentText = [
    currentContinuityIn,
    currentStoryboard?.storyboard.name,
    currentStoryboard?.correctedScript,
    currentStoryboard?.lastFrameInfo,
  ].join(' ');
  const warnings = compactList([
    hasLowPosture(previousText) && hasStandingJump(currentText)
      ? '上一镜落幅为低位/倒地/跪地状态，本镜开头疑似直接站立；S01-S03 必须先完成低位承接和起身过渡。'
      : '',
    previousStoryboard && !previousFinalPanel
      ? `上一镜缺少 ${previousFinalPanelLabel} 导演规划，已降级使用上一镜落幅和 Shot Sheet 入点。`
      : '',
  ]);

  const visualLocks = compactList([
    previousLastFrameInfo ? `上一镜落幅：${previousLastFrameInfo}` : '',
    previousFinalPanel?.staticMoment ? `上一镜${previousFinalPanelLabel}画面：${previousFinalPanel.staticMoment}` : '',
    previousFinalPanel?.blocking ? `上一镜${previousFinalPanelLabel}站位：${previousFinalPanel.blocking}` : '',
    previousFinalPanel?.motion ? `上一镜${previousFinalPanelLabel}动作：${previousFinalPanel.motion}` : '',
    currentContinuityIn ? `本镜入点：${currentContinuityIn}` : '',
    currentContinuityOut ? `本镜落幅：${currentContinuityOut}` : '',
    nextContinuityIn ? `下一镜预留：${nextContinuityIn}` : '',
  ]);

  const hardRules = compactList([
    previousStoryboard
      ? `S01 must visually inherit previous shot ${previousFinalPanelLabel}; do not restart staging from the current script alone.`
      : 'S01 may establish a fresh opening because there is no previous storyboard.',
    previousStoryboard
      ? 'If a character changes from prone/kneeling/crouching/grounded to standing, spend S01-S03 on the transition; no instant posture jump.'
      : '',
    previousStoryboard
      ? 'Carry over prop ownership and prop location exactly, especially phone-in-hand versus phone-on-ground.'
      : '',
    'Keep the same world axis, door/threshold boundary, danger direction, and character side assignment unless the plan explains a camera-only angle change.',
    'The final panel must reserve a clear handoff for the next storyboard, not a closed unrelated tableau.',
  ], 8);

  const sourcePayload = {
    currentIndex,
    mode,
    previousStoryboardNumber: previousStoryboard?.storyboard.number,
    previousStoryboardName: previousStoryboard?.storyboard.name,
    previousLastFrameInfo,
    previousFinalPanel,
    currentContinuityIn,
    currentContinuityOut,
    nextContinuityIn,
    warnings,
  };

  return {
    sourceSignature: JSON.stringify(sourcePayload),
    hasPrevious: !!previousStoryboard || !!previousLastFrameInfo,
    previousStoryboardNumber: previousStoryboard?.storyboard.number,
    previousStoryboardName: previousStoryboard?.storyboard.name,
    previousLastFrameInfo,
    previousFinalPanel,
    currentContinuityIn,
    currentContinuityOut,
    nextContinuityIn,
    visualLocks,
    hardRules,
    warnings,
  };
}
