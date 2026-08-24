import type { StoryboardBoardMode } from '@/types';
import { parseStoryboardDurationSeconds } from '@/lib/storyboardDuration';

export interface StoryboardBoardModeSpec {
  panelCount: number;
  layout: '3x3' | 'strip';
  modeLabel: string;
}

export const SMART_STORYBOARD_PANEL_COUNTS = [6, 9, 12, 15] as const;
export type SmartStoryboardPanelCount = (typeof SMART_STORYBOARD_PANEL_COUNTS)[number];

export function isFixedShotPlanBoardMode(mode: StoryboardBoardMode): boolean {
  return mode === 'shot-plan-landscape';
}

export function isSmartShotPlanBoardMode(mode: StoryboardBoardMode): boolean {
  return mode === 'smart-shot-plan-landscape';
}

export function isShotPlanBoardMode(mode: StoryboardBoardMode): boolean {
  return isFixedShotPlanBoardMode(mode) || isSmartShotPlanBoardMode(mode);
}

export function resolveSmartStoryboardPanelCount(
  durationText?: string,
  requestedPanelCount?: number,
): SmartStoryboardPanelCount {
  if (SMART_STORYBOARD_PANEL_COUNTS.includes(requestedPanelCount as SmartStoryboardPanelCount)) {
    return requestedPanelCount as SmartStoryboardPanelCount;
  }

  const seconds = parseStoryboardDurationSeconds(durationText);
  if (!seconds || !Number.isFinite(seconds)) return 15;
  if (seconds <= 6) return 6;
  if (seconds <= 9) return 9;
  if (seconds <= 12) return 12;
  return 15;
}

export function getStoryboardBoardExpectedPanelCount(
  mode: StoryboardBoardMode,
  durationText?: string,
  requestedPanelCount?: number,
): number {
  if (isSmartShotPlanBoardMode(mode)) {
    return resolveSmartStoryboardPanelCount(durationText, requestedPanelCount);
  }
  return getStoryboardBoardModeSpec(mode).panelCount;
}

export function formatStoryboardPanelLabel(index: number): string {
  return `S${String(index).padStart(2, '0')}`;
}

export function getStoryboardFinalPanelLabel(
  mode: StoryboardBoardMode,
  panelCount?: number,
): string {
  const count = panelCount ?? getStoryboardBoardModeSpec(mode).panelCount;
  if (isShotPlanBoardMode(mode)) return `${formatStoryboardPanelLabel(count)} / END BEAT`;
  return formatStoryboardPanelLabel(count);
}

export function getSmartStoryboardLayoutRule(panelCount: number): string {
  if (panelCount === 6) return '3 columns x 2 rows，阅读顺序 S01-S03 / S04-S06';
  if (panelCount === 9) return '3 columns x 3 rows，阅读顺序 S01-S03 / S04-S06 / S07-S09';
  if (panelCount === 12) return '4 columns x 3 rows，阅读顺序 S01-S04 / S05-S08 / S09-S12';
  return '5 columns x 3 rows，阅读顺序 S01-S05 / S06-S10 / S11-S15';
}

export function getStoryboardBoardModeSpec(mode: StoryboardBoardMode): StoryboardBoardModeSpec {
  if (mode === 'shot-plan-landscape') {
    return {
      panelCount: 15,
      layout: 'strip',
      modeLabel: '横向 15 秒详细 Shot Sheet（直接生成）',
    };
  }

  if (mode === 'smart-shot-plan-landscape') {
    return {
      panelCount: 15,
      layout: 'strip',
      modeLabel: '智能故事板（自动 6/9/12/15 格）',
    };
  }

  if (mode === 'nine-landscape') {
    return {
      panelCount: 9,
      layout: '3x3',
      modeLabel: '横版 Seedance 详细故事板 16:9',
    };
  }

  return {
    panelCount: 9,
    layout: '3x3',
    modeLabel: '竖版 Seedance 详细故事板 9:16',
  };
}
