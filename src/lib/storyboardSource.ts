import type { ScriptType, StoryboardInfo } from '@/types';

export interface StoryboardSourceContext {
  sourceExcerpt: string;
  sourceExcerptSummary: string;
  nextStoryboardSummary: string;
}

export function resolveStoryboardSourceScriptText({
  scriptType,
  rawScript,
  adaptedScript,
  analysisSourceText,
}: {
  scriptType: ScriptType;
  rawScript?: string;
  adaptedScript?: string;
  analysisSourceText?: string;
}) {
  const normalizedRawScript = rawScript?.trim() ?? '';
  const normalizedAdaptedScript = adaptedScript?.trim() ?? '';
  const normalizedAnalysisSourceText = analysisSourceText?.trim() ?? '';

  if (normalizedAnalysisSourceText) {
    return normalizedAnalysisSourceText;
  }

  if (scriptType === 'novel') {
    return normalizedAdaptedScript || normalizedRawScript;
  }

  return normalizedRawScript || normalizedAdaptedScript;
}

interface ParsedStoryboardSection {
  number?: number;
  title: string;
  content: string;
}

function normalizeDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function parseSimpleStoryboardNumber(value: string): number | undefined {
  const normalized = normalizeDigits(value).replace(/\s+/g, '');
  if (/[－—–-]/.test(normalized)) return undefined;

  const number = Number.parseInt(normalized, 10);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeTitle(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function summarizeExcerpt(text: string): string {
  return text
    .replace(/^(?:#{1,4}\s*)?(?:分镜|镜头|shot|scene)\s*[0-9０-９]+(?:\s*[-－—–]\s*[0-9０-９]+)*.*$/gim, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function extractStoryboardTitleFromHeadingTail(tail: string | undefined): string {
  const normalized = (tail ?? '')
    .replace(/^[\s｜|:：\-－—–]+/, '')
    .replace(/\*\*/g, '')
    .trim();
  return normalized;
}

function parseStoryboardSections(scriptText: string): ParsedStoryboardSection[] {
  if (!scriptText.trim()) return [];

  const headingRegex = /^(?:#{1,4}\s*)?(?:分镜|镜头|shot|scene)\s*([0-9０-９]+(?:\s*[-－—–]\s*[0-9０-９]+)*)([^\n]*)$/gim;
  const matches = Array.from(scriptText.matchAll(headingRegex));
  if (matches.length === 0) return [];

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = index < matches.length - 1 ? (matches[index + 1].index ?? scriptText.length) : scriptText.length;
    const explicitNumber = parseSimpleStoryboardNumber(match[1] ?? '');
    return {
      number: explicitNumber ?? index + 1,
      title: extractStoryboardTitleFromHeadingTail(match[2]),
      content: scriptText.slice(start, end).trim(),
    } satisfies ParsedStoryboardSection;
  });
}

function resolveSectionForStoryboard(
  sections: ParsedStoryboardSection[],
  storyboard: StoryboardInfo,
  storyboardIndex: number,
  usedSectionIndices: Set<number>,
): ParsedStoryboardSection | null {
  const normalizedTitle = normalizeTitle(storyboard.name);

  const candidates = sections.map((section, index) => ({ section, index })).filter(({ index }) => !usedSectionIndices.has(index));

  const byNumber = candidates.find(({ section }) => section.number === storyboard.number);
  if (byNumber) {
    usedSectionIndices.add(byNumber.index);
    return byNumber.section;
  }

  const byTitle = candidates.find(({ section }) => normalizeTitle(section.title) === normalizedTitle);
  if (byTitle) {
    usedSectionIndices.add(byTitle.index);
    return byTitle.section;
  }

  const sequential = candidates.find(({ index }) => index === storyboardIndex) ?? candidates[0];
  if (sequential) {
    usedSectionIndices.add(sequential.index);
    return sequential.section;
  }

  return null;
}

export function buildStoryboardSourceContexts(
  scriptText: string,
  storyboards: StoryboardInfo[],
): StoryboardSourceContext[] {
  const sections = parseStoryboardSections(scriptText);
  const usedSectionIndices = new Set<number>();

  const resolvedSections = storyboards.map((storyboard, index) =>
    resolveSectionForStoryboard(sections, storyboard, index, usedSectionIndices),
  );

  return storyboards.map((_, index) => {
    const currentSection = resolvedSections[index];
    const nextSection = resolvedSections[index + 1];
    return {
      sourceExcerpt: currentSection?.content ?? '',
      sourceExcerptSummary: summarizeExcerpt(currentSection?.content ?? ''),
      nextStoryboardSummary: summarizeExcerpt(nextSection?.content ?? ''),
    };
  });
}
