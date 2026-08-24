import type { StoryboardInfo, StoryboardState } from '@/types';

export const MIN_VIDEO_SUBMIT_DURATION_SEC = 4;
export const MAX_VIDEO_SUBMIT_DURATION_SEC = 15;
export const DEFAULT_VIDEO_SUBMIT_DURATION_SEC = 15;

function clampDuration(duration: number, min: number, max: number) {
  return Math.max(min, Math.min(max, duration));
}

function normalizeDurationDigits(value: string) {
  return value
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.');
}

export function normalizeWholeSecondVideoDuration(
  value: number | string | undefined | null,
  fallback: number | string | undefined | null = DEFAULT_VIDEO_SUBMIT_DURATION_SEC,
  min = MIN_VIDEO_SUBMIT_DURATION_SEC,
  max = MAX_VIDEO_SUBMIT_DURATION_SEC,
) {
  const raw = Number(value);
  const fallbackValue = Number(fallback);
  const duration = Number.isFinite(raw) ? raw : fallbackValue;
  if (!Number.isFinite(duration)) return DEFAULT_VIDEO_SUBMIT_DURATION_SEC;
  return clampDuration(Math.ceil(duration), min, max);
}

export function parseStoryboardDurationSeconds(durationText: string | undefined | null): number | undefined {
  const text = normalizeDurationDigits(durationText?.trim() ?? '');
  if (!text) return undefined;

  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:分钟|分|min(?:ute)?s?)/i);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    if (Number.isFinite(minutes) && minutes > 0) return minutes * 60;
  }

  const rangeMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:秒|s|sec(?:ond)?s?)?\s*(?:[-~～—至到]\s*(\d+(?:\.\d+)?))\s*(?:秒|s|sec(?:ond)?s?)?/i);
  if (rangeMatch) {
    const left = Number(rangeMatch[1]);
    const right = Number(rangeMatch[2]);
    const upper = Math.max(
      Number.isFinite(left) ? left : 0,
      Number.isFinite(right) ? right : 0,
    );
    return upper > 0 ? upper : undefined;
  }

  const secondMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:秒|s|sec(?:ond)?s?)/i);
  if (!secondMatch) {
    const plainSeconds = Number(text);
    return Number.isFinite(plainSeconds) && plainSeconds > 0 ? plainSeconds : undefined;
  }
  const seconds = Number(secondMatch[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

export function resolveStoryboardVideoDuration(
  storyboard: Pick<StoryboardInfo, 'duration'> | StoryboardState | undefined,
  fallback: number | string | undefined | null,
) {
  if (storyboard && 'storyboard' in storyboard) {
    const step4Duration = getStoryboardStep4VideoDurationSeconds(storyboard);
    if (typeof step4Duration === 'number') return step4Duration;
  }
  const durationText = storyboard && 'storyboard' in storyboard
    ? storyboard.storyboard.duration
    : storyboard?.duration;
  return normalizeWholeSecondVideoDuration(parseStoryboardDurationSeconds(durationText), fallback);
}

export function getStoryboardSmartVideoDurationSeconds(
  storyboard: StoryboardState | undefined,
): number | undefined {
  const value = storyboard?.smartVideoDurationSeconds;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return normalizeWholeSecondVideoDuration(
    value,
    undefined,
    MIN_VIDEO_SUBMIT_DURATION_SEC,
    MAX_VIDEO_SUBMIT_DURATION_SEC,
  );
}

export function parseSeedanceFinalPromptDurationSeconds(prompt: string | undefined | null): number | undefined {
  const text = prompt?.trim();
  if (!text) return undefined;

  const explicitDuration =
    text.match(/(?:时长|duration)\s*[:：]\s*(\d+(?:\.\d+)?)\s*(?:秒|s|sec(?:ond)?s?)/i)
    ?? text.match(/(?:时长|duration)\s*[｜|]\s*(\d+(?:\.\d+)?)\s*(?:秒|s|sec(?:ond)?s?)/i);
  if (!explicitDuration) return undefined;

  const seconds = Number(explicitDuration[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return normalizeWholeSecondVideoDuration(
    seconds,
    undefined,
    MIN_VIDEO_SUBMIT_DURATION_SEC,
    MAX_VIDEO_SUBMIT_DURATION_SEC,
  );
}

export function getStoryboardStep4VideoDurationSeconds(
  storyboard: StoryboardState | undefined,
): number | undefined {
  const smartDuration = getStoryboardSmartVideoDurationSeconds(storyboard);
  if (typeof smartDuration === 'number') return smartDuration;
  return parseSeedanceFinalPromptDurationSeconds(storyboard?.seedanceFinalVideoPrompt);
}

export function formatStoryboardDurationSeconds(seconds: number | undefined): string | undefined {
  return typeof seconds === 'number' && Number.isFinite(seconds) ? `${seconds}秒` : undefined;
}
