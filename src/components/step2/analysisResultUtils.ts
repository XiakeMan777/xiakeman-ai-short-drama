import { getPropDefaultAssetFlags } from '@/lib/propTracking';
import type {
  CharacterOutfit,
  PropConsistency,
} from '@/types';

export function normalizeName(value: string): string {
  return value.trim();
}

export function normalizeOptionalText(value: string | undefined): string {
  return value?.trim() ?? '';
}

export function buildUniqueName(baseName: string, existingNames: string[]): string {
  const normalizedBaseName = normalizeName(baseName) || '未命名';
  const existing = new Set(existingNames.map(normalizeName));
  if (!existing.has(normalizedBaseName)) return normalizedBaseName;

  let suffix = 2;
  while (existing.has(`${normalizedBaseName}${suffix}`)) {
    suffix += 1;
  }
  return `${normalizedBaseName}${suffix}`;
}

export function hasDuplicateName(names: string[], index: number, nextName: string): boolean {
  const normalizedNextName = normalizeName(nextName);
  return names.some((name, currentIndex) => currentIndex !== index && normalizeName(name) === normalizedNextName);
}

export function replaceName(items: string[], oldName: string, nextName: string): string[] {
  return items.map((item) => (item === oldName ? nextName : item));
}

export function toUniqueNames(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const normalizedItem = normalizeName(item);
    if (!normalizedItem || seen.has(normalizedItem)) continue;
    seen.add(normalizedItem);
    result.push(normalizedItem);
  }

  return result;
}

export function getNextOutfitSeqForCharacter(outfits: CharacterOutfit[], characterName: string) {
  return outfits
    .filter((outfit) => outfit.characterName === characterName)
    .reduce((max, outfit) => Math.max(max, outfit.outfitSeq), 0) + 1;
}

function padStoryboardNumber(number: number): string {
  return String(number).padStart(2, '0');
}

export function shiftStoryboardRange(range: string, removedNumber: number): string {
  const rangeMatch = range.match(/分镜\s*(\d+)\s*[-—到至]\s*(\d+)/);
  if (rangeMatch) {
    let start = parseInt(rangeMatch[1], 10);
    let end = parseInt(rangeMatch[2], 10);

    if (removedNumber < start) {
      start -= 1;
      end -= 1;
    } else if (removedNumber <= end) {
      end -= 1;
    }

    if (start > end) return '';
    return start === end
      ? `分镜${padStoryboardNumber(start)}`
      : `分镜${padStoryboardNumber(start)}-${padStoryboardNumber(end)}`;
  }

  const singleMatch = range.match(/分镜\s*(\d+)/);
  if (!singleMatch) return range;

  const storyboardNumber = parseInt(singleMatch[1], 10);
  if (storyboardNumber === removedNumber) return '';
  const nextNumber = storyboardNumber > removedNumber ? storyboardNumber - 1 : storyboardNumber;
  return `分镜${padStoryboardNumber(nextNumber)}`;
}

export function withPropRangeDefaultsIfFollowingCurrentDefault(
  prop: PropConsistency,
  storyboardRange: string,
): PropConsistency {
  const currentDefaults = getPropDefaultAssetFlags(prop.storyboardRange);
  const followsCurrentDefault = prop.needsTracking === currentDefaults.needsTracking
    && prop.needsImage === currentDefaults.needsImage;
  const nextProp = { ...prop, storyboardRange };
  return followsCurrentDefault
    ? { ...nextProp, ...getPropDefaultAssetFlags(storyboardRange) }
    : nextProp;
}

export function limitTextForAiAutofill(value: string, maxLength = 16000) {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.floor(maxLength * 0.65))}\n\n……中间内容省略……\n\n${normalized.slice(-Math.floor(maxLength * 0.35))}`;
}
