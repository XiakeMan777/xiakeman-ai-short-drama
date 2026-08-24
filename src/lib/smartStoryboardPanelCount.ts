import type { SmartStoryboardPanelCountPreference } from '@/types';

export const DEFAULT_SMART_STORYBOARD_PANEL_COUNT_PREFERENCE: SmartStoryboardPanelCountPreference = 'auto';

export const MANUAL_SMART_STORYBOARD_PANEL_COUNTS = [6, 9, 12] as const;

export type ManualSmartStoryboardPanelCount = (typeof MANUAL_SMART_STORYBOARD_PANEL_COUNTS)[number];

export function normalizeSmartStoryboardPanelCountPreference(
  value: unknown,
): SmartStoryboardPanelCountPreference {
  if (value === 6 || value === 9 || value === 12) return value;
  if (value === '6' || value === '9' || value === '12') {
    return Number(value) as ManualSmartStoryboardPanelCount;
  }
  return DEFAULT_SMART_STORYBOARD_PANEL_COUNT_PREFERENCE;
}

export function getLockedSmartStoryboardPanelCount(
  value: SmartStoryboardPanelCountPreference | undefined,
): ManualSmartStoryboardPanelCount | undefined {
  return value === 6 || value === 9 || value === 12 ? value : undefined;
}

export function formatSmartStoryboardPanelCountPreference(
  value: SmartStoryboardPanelCountPreference | undefined,
): string {
  const normalized = normalizeSmartStoryboardPanelCountPreference(value);
  return normalized === 'auto' ? '自动' : `${normalized}格`;
}
