import type { StoryboardBoardGenerationTiming } from '@/types';

function elapsedMs(startedAt: number | undefined, completedAt: number): number | undefined {
  if (typeof startedAt !== 'number') return undefined;
  return Math.max(0, completedAt - startedAt);
}

function clearFailure(previous: StoryboardBoardGenerationTiming | undefined): StoryboardBoardGenerationTiming {
  const rest = { ...(previous ?? {}) };
  delete rest.failedAt;
  delete rest.failureReason;
  delete rest.timeoutAt;
  return rest;
}

export function beginStoryboardBoardPlanTiming(
  previous: StoryboardBoardGenerationTiming | undefined,
  startedAt = Date.now(),
): StoryboardBoardGenerationTiming {
  return {
    ...clearFailure(previous),
    planStartedAt: startedAt,
    planCompletedAt: undefined,
    planElapsedMs: undefined,
  };
}

export function completeStoryboardBoardPlanTiming(
  previous: StoryboardBoardGenerationTiming | undefined,
  completedAt = Date.now(),
): StoryboardBoardGenerationTiming {
  return {
    ...clearFailure(previous),
    planCompletedAt: completedAt,
    planElapsedMs: elapsedMs(previous?.planStartedAt, completedAt),
  };
}

export function failStoryboardBoardPlanTiming(
  previous: StoryboardBoardGenerationTiming | undefined,
  reason: string,
  failedAt = Date.now(),
  timeout = false,
): StoryboardBoardGenerationTiming {
  return {
    ...previous,
    planCompletedAt: failedAt,
    planElapsedMs: elapsedMs(previous?.planStartedAt, failedAt),
    failedAt,
    failureReason: reason,
    timeoutAt: timeout ? failedAt : previous?.timeoutAt,
  };
}

export function beginStoryboardBoardImageTiming(
  previous: StoryboardBoardGenerationTiming | undefined,
  startedAt = Date.now(),
): StoryboardBoardGenerationTiming {
  const previousAttemptStarted = previous?.imageStartedAt ?? previous?.lastAttemptStartedAt;
  const isRetry = !!previousAttemptStarted && !!previous?.failedAt;
  return {
    ...clearFailure(previous),
    imageStartedAt: startedAt,
    imageCompletedAt: undefined,
    imageElapsedMs: undefined,
    lastAttemptStartedAt: startedAt,
    retryCount: isRetry ? (previous?.retryCount ?? 0) + 1 : (previous?.retryCount ?? 0),
  };
}

export function completeStoryboardBoardImageTiming(
  previous: StoryboardBoardGenerationTiming | undefined,
  completedAt = Date.now(),
  fallbackStartedAt?: number,
): StoryboardBoardGenerationTiming {
  const startedAt = previous?.imageStartedAt ?? fallbackStartedAt;
  return {
    ...clearFailure(previous),
    imageCompletedAt: completedAt,
    imageElapsedMs: elapsedMs(startedAt, completedAt),
  };
}

export function failStoryboardBoardImageTiming(
  previous: StoryboardBoardGenerationTiming | undefined,
  reason: string,
  failedAt = Date.now(),
  timeout = false,
  fallbackStartedAt?: number,
): StoryboardBoardGenerationTiming {
  const startedAt = previous?.imageStartedAt ?? fallbackStartedAt;
  return {
    ...previous,
    imageElapsedMs: elapsedMs(startedAt, failedAt),
    failedAt,
    failureReason: reason,
    timeoutAt: timeout ? failedAt : previous?.timeoutAt,
  };
}

export function beginStoryboardBoardSeedanceTiming(
  previous: StoryboardBoardGenerationTiming | undefined,
  startedAt = Date.now(),
): StoryboardBoardGenerationTiming {
  return {
    ...clearFailure(previous),
    seedancePromptStartedAt: startedAt,
    seedancePromptCompletedAt: undefined,
    seedancePromptElapsedMs: undefined,
  };
}

export function completeStoryboardBoardSeedanceTiming(
  previous: StoryboardBoardGenerationTiming | undefined,
  completedAt = Date.now(),
): StoryboardBoardGenerationTiming {
  return {
    ...clearFailure(previous),
    seedancePromptCompletedAt: completedAt,
    seedancePromptElapsedMs: elapsedMs(previous?.seedancePromptStartedAt, completedAt),
  };
}

export function failStoryboardBoardSeedanceTiming(
  previous: StoryboardBoardGenerationTiming | undefined,
  reason: string,
  failedAt = Date.now(),
  timeout = false,
): StoryboardBoardGenerationTiming {
  return {
    ...previous,
    seedancePromptCompletedAt: failedAt,
    seedancePromptElapsedMs: elapsedMs(previous?.seedancePromptStartedAt, failedAt),
    failedAt,
    failureReason: reason,
    timeoutAt: timeout ? failedAt : previous?.timeoutAt,
  };
}
