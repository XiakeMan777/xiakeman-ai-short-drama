import { getErrorMessage, isTransientApiError } from '@/lib/transientApiError';

export const STORYBOARD_BOARD_IMAGE_RETRY_DELAYS_MS = [15_000, 45_000, 90_000] as const;

export class StoryboardBoardImageRetryExhaustedError extends Error {
  retryCount: number;
  originalError: unknown;

  constructor(error: unknown, retryCount: number) {
    super(getErrorMessage(error));
    this.name = 'StoryboardBoardImageRetryExhaustedError';
    this.retryCount = retryCount;
    this.originalError = error;
  }
}

export interface StoryboardBoardImageRetryEvent {
  attempt: number;
  nextAttempt: number;
  totalAttempts: number;
  maxRetries: number;
  error: string;
  nextDelayMs: number;
}

function waitForRetryDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function formatStoryboardBoardImageRetryNotice(event: StoryboardBoardImageRetryEvent): string {
  return `图片接口短暂失败，导演规划已保留，正在重试图片生成（${event.nextAttempt}/${event.totalAttempts}）。上次错误：${event.error}`;
}

export function getStoryboardBoardImageRetryCount(error: unknown): number | undefined {
  return error instanceof StoryboardBoardImageRetryExhaustedError ? error.retryCount : undefined;
}

export function isRetryableStoryboardBoardImageError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return isTransientApiError(error)
    || /详细故事板生成超过\s*20\s*分钟未返回|故事板15格图片生成\s*timeout after|APIMart\s*图像生成超过\s*20\s*分钟未完成|图像生成超过\s*20\s*分钟|20\s*分钟.*(?:未返回|未完成)|图片.*(?:超时|timeout|timed out|未返回)/i.test(message);
}

export function formatStoryboardBoardImageRecoverableFailure(
  error: unknown,
  options: { retryCount?: number } = {},
): string {
  const message = getErrorMessage(error);
  if (message.includes('导演规划已保留')) return message;
  const retryText = typeof options.retryCount === 'number' && options.retryCount > 0
    ? `已自动重试 ${options.retryCount} 次仍失败。`
    : '';
  return `图片生成失败：${retryText}${message}\n导演规划已保留，可直接重试图片生成，不会重新跑导演阐述/故事板规划。`;
}

export async function runStoryboardBoardImageWithRetry<T>(
  run: (attempt: number) => Promise<T>,
  options: {
    delaysMs?: readonly number[];
    isAborted?: () => boolean;
    onRetry?: (event: StoryboardBoardImageRetryEvent) => void;
  } = {},
): Promise<T> {
  const delaysMs = options.delaysMs ?? STORYBOARD_BOARD_IMAGE_RETRY_DELAYS_MS;
  const maxRetries = delaysMs.length;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (options.isAborted?.()) {
      throw new DOMException('The user aborted a request.', 'AbortError');
    }

    try {
      return await run(attempt);
    } catch (error) {
      const retryable = isRetryableStoryboardBoardImageError(error);
      if (options.isAborted?.() || !retryable) {
        throw error;
      }
      if (attempt >= maxRetries) {
        throw new StoryboardBoardImageRetryExhaustedError(error, maxRetries);
      }

      const event: StoryboardBoardImageRetryEvent = {
        attempt: attempt + 1,
        nextAttempt: attempt + 2,
        totalAttempts: maxRetries + 1,
        maxRetries,
        error: getErrorMessage(error),
        nextDelayMs: delaysMs[attempt] ?? 0,
      };
      options.onRetry?.(event);
      await waitForRetryDelay(event.nextDelayMs);
    }
  }

  throw new Error('Storyboard board image generation failed without an error');
}
