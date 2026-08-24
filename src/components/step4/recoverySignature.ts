import type { StoryboardState } from '@/types';

export const STEP4_INTERRUPTED_RECOVERY_GRACE_MS = 30 * 60 * 1000;

export function isStep4BusyStatus(status: StoryboardState['status']) {
  return status === 'checking'
    || status === 'correcting'
    || status === 'choreographing'
    || status === 'choreo-checking'
    || status === 'generating'
    || status === 'self-checking';
}

function isWithinRecoveryGrace(storyboard: StoryboardState, now: number, graceMs: number) {
  return typeof storyboard.step4StartedAt === 'number'
    && Number.isFinite(storyboard.step4StartedAt)
    && now - storyboard.step4StartedAt < graceMs;
}

export function isRecoverableInterruptedStoryboard(
  storyboard: StoryboardState,
  options: { now?: number; graceMs?: number; hasLiveGeneration?: boolean } = {},
) {
  if (!isStep4BusyStatus(storyboard.status)) return false;
  const now = options.now ?? Date.now();
  const graceMs = options.graceMs ?? STEP4_INTERRUPTED_RECOVERY_GRACE_MS;
  const hasLiveGeneration = options.hasLiveGeneration ?? false;
  return !(hasLiveGeneration && isWithinRecoveryGrace(storyboard, now, graceMs));
}

export function buildInterruptedStoryboardSignature(
  storyboards: StoryboardState[],
  options: { now?: number; graceMs?: number } = {},
) {
  const now = options.now ?? Date.now();
  const graceMs = options.graceMs ?? STEP4_INTERRUPTED_RECOVERY_GRACE_MS;
  const interrupted = storyboards
    .map((storyboard, index) => ({ storyboard, index }))
    .filter(({ storyboard }) =>
      isRecoverableInterruptedStoryboard(storyboard, { now, graceMs, hasLiveGeneration: true }),
    )
    .map(({ storyboard, index }) => `${index}:${storyboard.status}`);

  return interrupted.length > 0 ? interrupted.join('|') : null;
}
