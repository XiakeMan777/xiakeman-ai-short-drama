export interface DialogueAudioTimingIssue {
  timeRange: string;
  dialogue: string;
  line: string;
}

export interface DialogueAudioTimingResult {
  text: string;
  addedCount: number;
}

const TIME_RANGE_PATTERN = String.raw`\d+(?:\.\d+)?\s*[-~–—]\s*\d+(?:\.\d+)?\s*(?:秒|s|S)?`;
const TIME_SEGMENT_LINE_PATTERN = new RegExp(`^(\\s*)(${TIME_RANGE_PATTERN})(\\s*[｜|]\\s*)(.+?)(\\s*[｜|]\\s*)(.+?)(\\s*[｜|]\\s*.*)?$`);
const NUMERIC_TIME_RANGE_PATTERN = /(\d+(?:\.\d+)?)\s*[-~–—]\s*(\d+(?:\.\d+)?)/;
const QUOTED_TEXT_PATTERN = /"([^"\n]{1,500})"|“([^”\n]{1,500})”|「([^」\n]{1,500})」|『([^』\n]{1,500})』/g;
const SPEECH_CONTEXT_PATTERN = /嘴唇微张|开口说话|说话|内心独白|内心OS|心声|旁白|系统播报|系统提示|低声说|轻声说|怒吼|呢喃|喊|叫|道|说[：:：\s]*$/;
const AUDIO_TIMING_SUFFIX_PATTERN = /^\s*[（(][^）)]*(?:音轨|语音|配音|声音时间|对白时间|时间轨)[^）)]*\d+(?:\.\d+)?\s*[-~–—]\s*\d+(?:\.\d+)?\s*(?:秒|s|S)?[^）)]*[）)]/;

interface DialogueQuoteMatch {
  start: number;
  end: number;
  text: string;
  label: string;
}

function normalizeDialogueText(text: string) {
  return text
    .replace(/^\s*[（(]\s*(?:内心独白|内心OS|心声|OS|旁白|系统播报|系统提示)\s*[）)]\s*/, '')
    .trim();
}

function isMeaningfulDialogue(text: string) {
  const normalized = normalizeDialogueText(text);
  return !!normalized && !/^(无|无台词|没有|空|none|null|undefined|台词|台词内容|台词内容（如果有）|台词（如有）)$/i.test(normalized);
}

function hasAudioTimingSuffix(text: string, quoteEnd: number) {
  return AUDIO_TIMING_SUFFIX_PATTERN.test(text.slice(quoteEnd, quoteEnd + 72));
}

function inferAudioLabel(context: string, quoteText: string) {
  const combined = `${context} ${quoteText}`;
  if (/系统播报|系统提示/.test(combined)) return '系统播报音轨';
  if (/旁白|世界观旁白/.test(combined)) return '旁白音轨';
  if (/内心OS|内心独白|心声/.test(combined)) return '内心OS音轨';
  return '对白音轨';
}

function collectUntimedDialogueQuotes(actionText: string): DialogueQuoteMatch[] {
  const matches: DialogueQuoteMatch[] = [];
  QUOTED_TEXT_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = QUOTED_TEXT_PATTERN.exec(actionText)) !== null) {
    const quoteText = match[1] || match[2] || match[3] || match[4] || '';
    if (!isMeaningfulDialogue(quoteText)) continue;
    if (hasAudioTimingSuffix(actionText, match.index + match[0].length)) continue;

    const context = actionText.slice(Math.max(0, match.index - 64), match.index);
    if (!SPEECH_CONTEXT_PATTERN.test(context)) continue;

    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: quoteText,
      label: inferAudioLabel(context, quoteText),
    });
  }

  return matches;
}

function formatSecond(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function splitAudioRanges(timeRange: string, count: number) {
  const match = timeRange.match(NUMERIC_TIME_RANGE_PATTERN);
  if (!match || count <= 0) return Array.from({ length: count }, () => timeRange.trim());

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return Array.from({ length: count }, () => timeRange.trim());
  }

  const duration = end - start;
  return Array.from({ length: count }, (_, index) => {
    const rangeStart = start + (duration * index) / count;
    const rangeEnd = index === count - 1 ? end : start + (duration * (index + 1)) / count;
    return `${formatSecond(rangeStart)}–${formatSecond(rangeEnd)}秒`;
  });
}

function annotateActionText(actionText: string, timeRange: string) {
  const matches = collectUntimedDialogueQuotes(actionText);
  if (matches.length === 0) return { text: actionText, addedCount: 0 };

  const audioRanges = splitAudioRanges(timeRange, matches.length);
  let next = '';
  let cursor = 0;

  matches.forEach((match, index) => {
    next += actionText.slice(cursor, match.end);
    next += `（${match.label}：${audioRanges[index]}）`;
    cursor = match.end;
  });
  next += actionText.slice(cursor);

  return { text: next, addedCount: matches.length };
}

export function findDialogueAudioTimingIssues(promptText: string): DialogueAudioTimingIssue[] {
  const issues: DialogueAudioTimingIssue[] = [];

  for (const line of promptText.split(/\r?\n/)) {
    const match = line.match(TIME_SEGMENT_LINE_PATTERN);
    if (!match) continue;

    const timeRange = match[2].trim();
    const actionText = match[6];
    for (const quote of collectUntimedDialogueQuotes(actionText)) {
      issues.push({
        timeRange,
        dialogue: normalizeDialogueText(quote.text),
        line: line.trim().slice(0, 220),
      });
    }
  }

  return issues;
}

export function ensurePromptDialogueAudioTimings(promptText: string): DialogueAudioTimingResult {
  let addedCount = 0;
  const lines = promptText.split(/\r?\n/).map((line) => {
    const match = line.match(TIME_SEGMENT_LINE_PATTERN);
    if (!match) return line;

    const annotation = annotateActionText(match[6], match[2].trim());
    addedCount += annotation.addedCount;

    if (annotation.addedCount === 0) return line;
    return `${match[1]}${match[2]}${match[3]}${match[4]}${match[5]}${annotation.text}${match[7] ?? ''}`;
  });

  return { text: lines.join('\n'), addedCount };
}
