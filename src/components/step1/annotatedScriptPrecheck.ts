const STORYBOARD_HEADER_PATTERN = /^(?:#{1,3}\s*)?(?:分镜|shot|scene)\s*([0-9０-９]+(?:\s*[-－—–]\s*[0-9０-９]+)*)([^\n]*)$/gim;
const NEXT_STORYBOARD_HEADER_PATTERN = /^(?:#{1,3}\s*)?(?:分镜|shot|scene)\s*[0-9０-９]+(?:\s*[-－—–]\s*[0-9０-９]+)*/im;
const DURATION_PATTERN = /([0-9０-９]+(?:[.．][0-9０-９]+)?)\s*(?:秒|seconds?|secs?|s)(?=$|[\s)）\]】,，.。;；:：、|｜])/i;
const TIMECODE_RANGE_PATTERN = /(\d{1,2}):(\d{2})\s*[-－—–]\s*(\d{1,2}):(\d{2})/;
const MIN_STORYBOARD_DURATION = 4;
const MAX_STORYBOARD_DURATION = 60;

function normalizeDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function normalizeStoryboardLabel(value: string): string {
  const normalized = normalizeDigits(value)
    .replace(/[－—–]/g, '-')
    .replace(/\s+/g, '');
  const parts = normalized
    .split('-')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));

  return parts.map(String).join('-') || normalized;
}

function formatStoryboardLabel(label: string): string {
  const parts = label.split('-');
  return parts.length === 1 ? parts[0].padStart(2, '0') : parts.join('-');
}

function compareStoryboardLabels(a: string, b: string): number {
  const aParts = a.split('-').map((part) => Number.parseInt(part, 10));
  const bParts = b.split('-').map((part) => Number.parseInt(part, 10));
  const maxLength = Math.max(aParts.length, bParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const aPart = aParts[index];
    const bPart = bParts[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart !== bPart) return aPart - bPart;
  }

  return 0;
}

function getTimecodeSeconds(minutes: string, seconds: string): number {
  return Number.parseInt(minutes, 10) * 60 + Number.parseInt(seconds, 10);
}

function parseDurationNumber(value: string): number {
  return Number(normalizeDigits(value).replace('．', '.'));
}

function extractDurationSeconds(text: string): number | null {
  const secondMatch = text.match(DURATION_PATTERN);
  if (secondMatch) {
    const seconds = parseDurationNumber(secondMatch[1]);
    return Number.isFinite(seconds) ? seconds : null;
  }

  const timecodeMatch = text.match(TIMECODE_RANGE_PATTERN);
  if (!timecodeMatch) return null;

  const start = getTimecodeSeconds(timecodeMatch[1], timecodeMatch[2]);
  const end = getTimecodeSeconds(timecodeMatch[3], timecodeMatch[4]);
  const duration = end - start;
  return duration > 0 ? duration : null;
}

function findStoryboardDurationSeconds(scriptText: string, match: RegExpMatchArray): number | null {
  const headerLine = match[0];
  const inlineDuration = extractDurationSeconds(headerLine);
  if (inlineDuration !== null) return inlineDuration;

  const headerIndex = match.index ?? 0;
  const blockText = scriptText.slice(headerIndex + headerLine.length);
  const nextHeaderIndex = blockText.search(NEXT_STORYBOARD_HEADER_PATTERN);
  const currentBlockIntro = nextHeaderIndex >= 0 ? blockText.slice(0, nextHeaderIndex) : blockText;
  const nextMeaningfulLine = currentBlockIntro
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return nextMeaningfulLine ? extractDurationSeconds(nextMeaningfulLine) : null;
}

export function validateAnnotatedScriptInput(scriptText: string): string | null {
  const matches = [...scriptText.matchAll(STORYBOARD_HEADER_PATTERN)];
  if (matches.length === 0) {
    return '当前剧本未识别到任何分镜标题，请按“分镜01（15秒）”“分镜01｜时长：15秒”或“## 分镜01”这样的格式输入。';
  }

  const seenStoryboardLabels = new Set<string>();
  let missingDurationCount = 0;
  let previousStoryboardLabel: string | null = null;

  for (const match of matches) {
    const storyboardLabel = normalizeStoryboardLabel(match[1]);
    const displayLabel = formatStoryboardLabel(storyboardLabel);
    if (seenStoryboardLabels.has(storyboardLabel)) {
      return `分镜编号「${displayLabel}」重复，请先整理后再分析。`;
    }
    if (previousStoryboardLabel && compareStoryboardLabels(previousStoryboardLabel, storyboardLabel) >= 0) {
      return `分镜编号顺序有误：分镜「${displayLabel}」出现在更大的编号之后，请先按从小到大整理。`;
    }
    seenStoryboardLabels.add(storyboardLabel);
    previousStoryboardLabel = storyboardLabel;

    const durationSeconds = findStoryboardDurationSeconds(scriptText, match);
    if (durationSeconds === null) {
      missingDurationCount += 1;
      continue;
    }

    if (!Number.isFinite(durationSeconds) || durationSeconds < MIN_STORYBOARD_DURATION || durationSeconds > MAX_STORYBOARD_DURATION) {
      return `分镜「${displayLabel}」的单镜时长不合理，请调整到 ${MIN_STORYBOARD_DURATION}~${MAX_STORYBOARD_DURATION} 秒之间。`;
    }
  }

  if (missingDurationCount === matches.length) {
    return '当前剧本里的分镜标题缺少单镜时长，请写成“分镜01（15秒）”“分镜01｜时长：15秒”或“分镜1-1 0:00-0:15”这类格式后再分析。';
  }

  if (missingDurationCount > 0) {
    return `有 ${missingDurationCount} 个分镜标题缺少单镜时长，请补齐后再分析。`;
  }

  return null;
}
