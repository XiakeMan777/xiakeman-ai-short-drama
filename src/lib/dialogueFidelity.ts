import type { Choreography } from '@/types';

export type DialogueChannel = 'spoken' | 'inner' | 'system' | 'narration' | 'unknown';

export interface DialogueEntry {
  text: string;
  normalizedText: string;
  channel: DialogueChannel;
  context: string;
}

export interface DialogueCountIssue {
  text: string;
  expectedCount: number;
  actualCount: number;
}

export interface DialogueFidelityReport {
  passed: boolean;
  expectedCount: number;
  actualCount: number;
  missing: DialogueCountIssue[];
  added: DialogueCountIssue[];
}

export interface DialogueFidelityOptions {
  allowSubset?: boolean;
  warnOnly?: boolean;
}

const SPEECH_MARKER_PATTERN = /对白|台词|内心OS|内心独白|旁白|系统播报|世界观旁白|开口说话|说话|低声说|轻声说|怒吼|呢喃|喊|叫|道|说[：:]/;
const SPEECH_BLOCK_MARKER_PATTERN = /\*\*(对白|内心OS|内心独白|系统播报|世界观旁白|旁白)(?:[（(]([^）)]+)[）)])?\*\*/;
const NON_SPEECH_BLOCK_PATTERN = /^\s*(?:\*\*)?(?:画面|动作|镜头|场景|道具|音效|音乐|光影|调色|分镜|节奏)(?:\*\*)?\s*[：:]/;
const CHARACTER_QUOTED_LINE_PATTERN = /^\s*(?:[-*]\s*)?(?:[【[][^】\]]+[】\]]\s*)?(?!画面|动作|镜头|场景|道具|音效|音乐|光影|调色|分镜|节奏|修正|原因|问题)([^：:\n]{1,24}(?:[（(][^）)]{1,12}[）)])?)\s*[：:]\s*["“「『'][^"”」』'\n]{1,500}["”」』']/;
const TIME_PREFIX_PATTERN = /^\s*(?:[-*]\s*)?(?:\[[^\]]+\]|【[^】]*】|\d+(?:\.\d+)?\s*[-~–—]\s*\d+(?:\.\d+)?\s*(?:秒|s|S)?)[\s，,、]*/;
const TIME_SEGMENT_LINE_PATTERN = /^\s*(?:[-*]\s*)?\d+(?:\.\d+)?\s*[-~–—]\s*\d+(?:\.\d+)?\s*(?:秒|s|S)?\s*｜/;
const QUOTE_PATTERNS = [
  /"([^"\n]{1,500})"/g,
  /"([^"\n]{1,500})"/g,
  /“([^”\n]{1,500})”/g,
  /「([^」\n]{1,500})」/g,
  /『([^』\n]{1,500})』/g,
];

function inferChannel(text: string, currentChannel?: DialogueChannel | null): DialogueChannel {
  if (/系统播报|系统提示/.test(text)) return 'system';
  if (/内心OS|内心独白|心声/.test(text)) return 'inner';
  if (/世界观旁白|旁白/.test(text)) return 'narration';
  return currentChannel ?? 'spoken';
}

function stripWrapperQuotes(text: string) {
  return text
    .trim()
    .replace(/^["“「『]\s*/, '')
    .replace(/\s*["”」』]$/, '');
}

export function normalizeDialogueText(text: string) {
  return stripWrapperQuotes(text)
    .replace(/^\s*[（(]\s*(?:内心独白|内心OS|心声|OS|旁白|系统播报|系统提示)\s*[）)]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMeaningfulDialogue(text: string) {
  const normalized = normalizeDialogueText(text);
  return !!normalized
    && !/^(无|无台词|没有|空|none|null|undefined|台词内容|台词内容（如果有）|台词（如有）)$/i.test(normalized);
}

function collectQuotedTexts(line: string) {
  const matches: Array<{ index: number; text: string }> = [];

  for (const pattern of QUOTE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      matches.push({ index: match.index, text: match[1] });
    }
  }

  return matches
    .sort((a, b) => a.index - b.index)
    .filter((item, index, arr) => index === 0 || item.index !== arr[index - 1].index || item.text !== arr[index - 1].text)
    .map((item) => item.text);
}

function cleanUnquotedDialogueCandidate(line: string, currentChannel?: DialogueChannel | null) {
  let candidate = line.trim();
  candidate = candidate.replace(SPEECH_BLOCK_MARKER_PATTERN, '').trim();

  const labelMatch = candidate.match(/(?:对白|台词|内心OS|内心独白|旁白|系统播报|世界观旁白)(?:[（(][^）)]+[）)])?\s*[：:]\s*(.+)$/);
  if (labelMatch) {
    candidate = labelMatch[1].trim();
    candidate = candidate.replace(/^[^：:\n]{1,20}[：:]\s*/, '').trim();
  } else if (currentChannel) {
    candidate = candidate
      .replace(TIME_PREFIX_PATTERN, '')
      .replace(/^【[^】]*】\s*/, '')
      .trim();
  } else {
    return '';
  }

  candidate = candidate
    .replace(/^[-*]\s*/, '')
    .replace(/^【[^】]*】\s*/, '')
    .replace(/(?:\s*｜\s*音效[:：].*)$/, '')
    .trim();

  if (!candidate || NON_SPEECH_BLOCK_PATTERN.test(candidate)) return '';
  if (candidate.length > 180) return '';
  return candidate;
}

function makeDialogueEntry(text: string, channel: DialogueChannel, context: string): DialogueEntry | null {
  if (!isMeaningfulDialogue(text)) return null;
  const normalizedText = normalizeDialogueText(text);
  if (!normalizedText) return null;
  return {
    text: stripWrapperQuotes(text),
    normalizedText,
    channel,
    context: context.trim().slice(0, 160),
  };
}

function splitMergedQuotedDialogue(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [];

  const quotedTexts = collectQuotedTexts(normalized);
  if (quotedTexts.length > 1) return quotedTexts;

  const parts = normalized
    .split(/\s*["”」』]\s+["“「『]\s*/g)
    .map((part) => stripWrapperQuotes(part))
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 1 ? parts : [normalized];
}

function getDialogueScanLine(line: string) {
  if (!TIME_SEGMENT_LINE_PATTERN.test(line) || !line.includes('｜')) return line;

  const fields = line.split('｜');
  if (fields.length < 3) return line;

  return fields.slice(0, 3).join('｜');
}

export function splitDialogueField(text: string): string[] {
  return splitMergedQuotedDialogue(text)
    .map((part) => normalizeDialogueText(part))
    .filter(Boolean);
}

export function extractDialogueEntriesFromText(text: string): DialogueEntry[] {
  const entries: DialogueEntry[] = [];
  let currentChannel: DialogueChannel | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const blockMarker = line.match(SPEECH_BLOCK_MARKER_PATTERN);
    if (blockMarker) {
      currentChannel = inferChannel(blockMarker[1]);
    } else if (/^\s*#{1,6}\s/.test(line) || NON_SPEECH_BLOCK_PATTERN.test(line)) {
      currentChannel = null;
    }

    const dialogueScanLine = getDialogueScanLine(line);
    const hasCharacterQuotedDialogue = CHARACTER_QUOTED_LINE_PATTERN.test(dialogueScanLine);
    const hasSpeechMarker = SPEECH_MARKER_PATTERN.test(dialogueScanLine) || !!currentChannel || hasCharacterQuotedDialogue;
    if (!hasSpeechMarker) continue;

    const channel = inferChannel(dialogueScanLine, currentChannel);
    const quotedTexts = collectQuotedTexts(dialogueScanLine);
    if (quotedTexts.length > 0) {
      for (const quotedText of quotedTexts) {
        const entry = makeDialogueEntry(quotedText, channel, dialogueScanLine);
        if (entry) entries.push(entry);
      }
      continue;
    }

    const unquotedCandidate = cleanUnquotedDialogueCandidate(dialogueScanLine, currentChannel);
    const entry = makeDialogueEntry(unquotedCandidate, channel, dialogueScanLine);
    if (entry) entries.push(entry);
  }

  return entries;
}

export function extractDialogueEntriesFromChoreography(choreography: Choreography | null | undefined): DialogueEntry[] {
  if (!choreography) return [];

  const entries: DialogueEntry[] = [];
  for (const segment of choreography.timeSegments ?? []) {
    for (const action of segment.actions ?? []) {
      const dialogue = action.dialogue ?? '';
      const dialogueParts = splitMergedQuotedDialogue(dialogue);
      for (const dialoguePart of dialogueParts) {
        const entry = makeDialogueEntry(
          dialoguePart,
          inferChannel(dialoguePart),
          `${segment.timeRange || '未标注时间'} ${action.character || '未知角色'} ${action.action || ''}`,
        );
        if (entry) entries.push(entry);
      }
    }
  }
  return entries;
}

function buildCountMap(entries: readonly DialogueEntry[]) {
  const map = new Map<string, number>();
  for (const entry of entries) {
    map.set(entry.normalizedText, (map.get(entry.normalizedText) ?? 0) + 1);
  }
  return map;
}

function collectCountIssues(
  expected: Map<string, number>,
  actual: Map<string, number>,
  direction: 'missing' | 'added',
): DialogueCountIssue[] {
  const issues: DialogueCountIssue[] = [];
  for (const [text, count] of expected) {
    const otherCount = actual.get(text) ?? 0;
    if (otherCount < count) {
      issues.push({
        text,
        expectedCount: direction === 'missing' ? count : otherCount,
        actualCount: direction === 'missing' ? otherCount : count,
      });
    }
  }
  return issues;
}

function normalizeDialogueSequence(entries: readonly DialogueEntry[]) {
  return entries
    .map((entry) => entry.normalizedText)
    .join('');
}

export function compareDialogueFidelity(
  expectedEntries: readonly DialogueEntry[],
  actualEntries: readonly DialogueEntry[],
  options: DialogueFidelityOptions = {},
): DialogueFidelityReport {
  const sequenceEquivalent = normalizeDialogueSequence(expectedEntries) === normalizeDialogueSequence(actualEntries);
  const expectedCounts = buildCountMap(expectedEntries);
  const actualCounts = buildCountMap(actualEntries);
  const missing = options.allowSubset || sequenceEquivalent ? [] : collectCountIssues(expectedCounts, actualCounts, 'missing');
  const added = sequenceEquivalent ? [] : collectCountIssues(actualCounts, expectedCounts, 'added');

  return {
    passed: missing.length === 0 && added.length === 0,
    expectedCount: expectedEntries.length,
    actualCount: actualEntries.length,
    missing,
    added,
  };
}

function formatIssue(issue: DialogueCountIssue) {
  const text = issue.text.length > 34 ? `${issue.text.slice(0, 34)}...` : issue.text;
  return `「${text}」(${issue.actualCount}/${issue.expectedCount})`;
}

export function formatDialogueFidelityReport(report: DialogueFidelityReport, stageLabel: string) {
  if (report.passed) {
    return `${stageLabel}台词保真通过：${report.actualCount}/${report.expectedCount} 句。`;
  }

  const parts = [
    `${stageLabel}台词保真校验未通过：源剧本 ${report.expectedCount} 句，当前结果 ${report.actualCount} 句。`,
  ];
  if (report.missing.length > 0) {
    parts.push(`缺失或被改写：${report.missing.map(formatIssue).join('、')}`);
  }
  if (report.added.length > 0) {
    parts.push(`新增或疑似改写：${report.added.map(formatIssue).join('、')}`);
  }
  return parts.join(' ');
}

export function assertDialogueFidelity(
  stageLabel: string,
  sourceText: string,
  actual: string | readonly DialogueEntry[],
  options: DialogueFidelityOptions = {},
) {
  const expectedEntries = extractDialogueEntriesFromText(sourceText);
  const actualEntries = typeof actual === 'string' ? extractDialogueEntriesFromText(actual) : actual;
  const report = compareDialogueFidelity(expectedEntries, actualEntries, options);
  if (expectedEntries.length > 0 && !report.passed) {
    if (options.warnOnly) {
      console.warn(`[Step4] ${formatDialogueFidelityReport(report, stageLabel)} 已降级为质量提示，不再阻断生成。`);
      return report;
    }
    throw new Error(`${formatDialogueFidelityReport(report, stageLabel)} 保真优先，已停止生成；请重试当前分镜。`);
  }
  return report;
}
