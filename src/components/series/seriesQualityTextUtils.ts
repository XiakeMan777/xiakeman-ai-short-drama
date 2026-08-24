export interface SatisfactionPatterns {
  abstractRe: RegExp;
  concreteRe: RegExp;
  mechanismRe: RegExp;
}

export interface DuplicatedPropLocationRule {
  prop: string;
  firstLocation: RegExp;
  secondLocation: RegExp;
  transfer: RegExp;
}

export function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

export function hasUsableListItem(value: unknown, placeholderRe: RegExp): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((item) => {
    const text = String(item ?? '').trim();
    return text.length > 0 && !placeholderRe.test(text);
  });
}

export function hasWeakSatisfactionBeat(value: string, patterns: SatisfactionPatterns): boolean {
  const text = value.trim();
  if (!text) return true;
  if (patterns.abstractRe.test(text) && !patterns.concreteRe.test(text) && !patterns.mechanismRe.test(text)) {
    return true;
  }
  return text.length < 8;
}

export function countMatches(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return Array.from(text.matchAll(new RegExp(pattern.source, flags))).length;
}

export function countHollowPerformanceActions(
  text: string,
  hollowPerformanceActionRe: RegExp,
  stateLinkedActionRe: RegExp,
): number {
  return Array.from(text.matchAll(hollowPerformanceActionRe))
    .filter((match) => !stateLinkedActionRe.test(match[0]))
    .length;
}

export function countOverloadedDialogue(lines: string[], splitRe: RegExp): number {
  return lines.filter((line) => (
    line.length > 30
    && Array.from(line.matchAll(splitRe)).length >= 2
  )).length;
}

export function hasDenseSweetOccupationVoice(lines: string[], occupationWordRe: RegExp): boolean {
  if (lines.length < 4) return false;
  let consecutive = 0;
  let total = 0;
  for (const line of lines) {
    if (occupationWordRe.test(line)) {
      consecutive += 1;
      total += 1;
      if (consecutive >= 4) return true;
    } else {
      consecutive = 0;
    }
  }
  return total >= Math.max(5, Math.ceil(lines.length * 0.7));
}

export function findOverloadedStoryboardIndexes(blocks: string[], beatLoadPatterns: RegExp[]): number[] {
  return blocks
    .map((block, index) => ({
      index: index + 1,
      score: beatLoadPatterns.reduce((sum, pattern) => (
        sum + (pattern.test(block) ? 1 : 0)
      ), 0),
    }))
    .filter((block) => block.score >= 5)
    .map((block) => block.index);
}

export function findDuplicatedPropLocationIssues(
  blocks: string[],
  rules: readonly DuplicatedPropLocationRule[],
): { index: number; props: string[] }[] {
  return blocks
    .map((block, index) => ({
      index: index + 1,
      props: rules
        .filter((rule) => (
          rule.firstLocation.test(block)
          && rule.secondLocation.test(block)
          && !rule.transfer.test(block)
        ))
        .map((rule) => rule.prop),
    }))
    .filter((item) => item.props.length > 0);
}

export function countNextRelayBeatLoad(line: string, beatPatterns: RegExp[]): number {
  return beatPatterns.reduce((sum, pattern) => (
    sum + (pattern.test(line) ? 1 : 0)
  ), 0);
}

export function countEmotionlessFunctionalDialogue(
  lines: string[],
  abstractFunctionWordRe: RegExp,
  emotionSourceRe: RegExp,
): number {
  return lines.filter((line) => (
    abstractFunctionWordRe.test(line) && !emotionSourceRe.test(line)
  )).length;
}
