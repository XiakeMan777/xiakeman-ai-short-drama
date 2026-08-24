import type { PropConsistency } from '@/types';

export const PROP_DEFAULT_POLICY_VERSION = 2;

function normalizeIdentityPart(value: string | undefined): string {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]/g, '')
    .slice(0, 40);
  return normalized || 'na';
}

function buildBasePropTrackingId(prop: PropConsistency, index: number): string {
  return [
    'prop',
    normalizeIdentityPart(prop.propName),
    normalizeIdentityPart(prop.storyboardRange),
    normalizeIdentityPart(prop.holder),
    normalizeIdentityPart(prop.appearanceDesc),
    String(index + 1),
  ].join('__');
}

export function ensurePropTrackingIds(propTracking: PropConsistency[] | undefined): PropConsistency[] {
  if (!propTracking?.length) return [];

  const usedIds = new Set<string>();

  return propTracking.map((prop, index) => {
    const baseId = prop.trackingId?.trim() || buildBasePropTrackingId(prop, index);
    let nextId = baseId;
    let suffix = 2;
    while (usedIds.has(nextId)) {
      nextId = `${baseId}__${suffix}`;
      suffix += 1;
    }
    usedIds.add(nextId);

    return {
      ...prop,
      trackingId: nextId,
      needsTracking: prop.needsTracking ?? true,
    };
  });
}

export function getStoryboardNumbersFromRange(storyboardRange: string | undefined): number[] {
  const normalizedRange = (storyboardRange ?? '').trim();
  if (!normalizedRange) return [];

  const storyboardNumbers = new Set<number>();
  const rangePattern = /(?:分镜)?\s*0*(\d+)\s*(?:[-–—~～到至]\s*0*(\d+))?/g;
  let match: RegExpExecArray | null;

  while ((match = rangePattern.exec(normalizedRange)) !== null) {
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : start;
    if (!Number.isInteger(start) || start <= 0 || !Number.isInteger(end) || end <= 0) continue;

    const rangeStart = Math.min(start, end);
    const rangeEnd = Math.max(start, end);
    const cappedRangeEnd = Math.min(rangeEnd, rangeStart + 199);
    for (let number = rangeStart; number <= cappedRangeEnd; number += 1) {
      storyboardNumbers.add(number);
    }
  }

  return [...storyboardNumbers].sort((a, b) => a - b);
}

export function propAppearsInMultipleStoryboards(storyboardRange: string | undefined): boolean {
  return getStoryboardNumbersFromRange(storyboardRange).length > 1;
}

export function getPropDefaultAssetFlags(storyboardRange: string | undefined) {
  const shouldEnable = propAppearsInMultipleStoryboards(storyboardRange);
  return {
    needsTracking: shouldEnable,
    needsImage: shouldEnable,
  };
}

export function applyPropDefaultAssetFlags<T extends Pick<PropConsistency, 'storyboardRange'>>(
  prop: T,
): T & Pick<PropConsistency, 'needsTracking' | 'needsImage'> {
  return {
    ...prop,
    ...getPropDefaultAssetFlags(prop.storyboardRange),
  };
}

export function normalizeGeneratedPropTrackingDefaults(
  propTracking: PropConsistency[] | undefined,
): PropConsistency[] {
  return ensurePropTrackingIds(propTracking).map((prop) => applyPropDefaultAssetFlags(prop));
}

export function getPropIdentityKey(prop: Pick<PropConsistency, 'trackingId' | 'propName' | 'storyboardRange' | 'holder' | 'appearanceDesc'>): string {
  return prop.trackingId?.trim() || buildBasePropTrackingId({
    ...prop,
    stateChanges: '',
    needsTracking: true,
    needsImage: false,
  }, 0);
}
