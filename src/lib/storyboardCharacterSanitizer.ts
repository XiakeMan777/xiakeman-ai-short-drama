import type { StoryboardInfo } from '@/types';
import { isGloballyInvalidVisualCharacterName, shouldUseVisualCharacterName } from './characterAssetGuards';

interface SanitizeStoryboardCharactersOptions {
  allowedNames?: Iterable<string | undefined | null>;
  allowUnknownVisualNames?: boolean;
}

function buildAllowedNameSet(allowedNames?: Iterable<string | undefined | null>) {
  const allowedSet = new Set<string>();
  for (const rawName of allowedNames ?? []) {
    const name = (rawName ?? '').trim();
    if (name) allowedSet.add(name);
  }
  return allowedSet;
}

function isLikelyContainedAlias(shortName: string, longName: string): boolean {
  if (shortName === longName) return false;
  if (shortName.length < 2 || !longName.includes(shortName)) return false;
  const suffix = longName.replace(shortName, '');
  return /^(守备队员|守卫|守军|士兵|杂役|护工|伤员|同门|队员|弟子|修士|男人|女人|青年|老者)$/.test(suffix);
}

function removeContainedAliases(names: string[]) {
  return names.filter((name) =>
    !names.some((otherName) => isLikelyContainedAlias(name, otherName)),
  );
}

export function sanitizeStoryboardCharacters(
  characters: readonly (string | undefined | null)[] | undefined,
  options: SanitizeStoryboardCharactersOptions = {},
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const allowedSet = buildAllowedNameSet(options.allowedNames);

  for (const rawName of characters ?? []) {
    const name = (rawName ?? '').trim();
    if (isGloballyInvalidVisualCharacterName(name)) continue;
    const isAllowedProjectCharacter = allowedSet.has(name);
    if (!name || seen.has(name)) continue;
    if (!isAllowedProjectCharacter && options.allowUnknownVisualNames === false) continue;
    if (!isAllowedProjectCharacter && !shouldUseVisualCharacterName(name)) continue;
    seen.add(name);
    result.push(name);
  }

  return removeContainedAliases(result);
}

export function sanitizeStoryboardInfo<T extends Pick<StoryboardInfo, 'characters'>>(
  storyboard: T,
  options: SanitizeStoryboardCharactersOptions = {},
): T {
  const characters = sanitizeStoryboardCharacters(storyboard.characters, options);
  if (characters.length === storyboard.characters.length && characters.every((name, index) => name === storyboard.characters[index])) {
    return storyboard;
  }
  return {
    ...storyboard,
    characters,
  };
}
