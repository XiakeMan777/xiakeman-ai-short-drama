import { isTransientApiError } from '@/lib/transientApiError';
import type { ReasoningEffort } from '@/lib/api-client';

export const STORYBOARD_PLANNING_STREAM_NO_OUTPUT_TIMEOUT_MS = 300_000;
export const STORYBOARD_PLANNING_STREAM_NO_OUTPUT_TIMEOUT_MESSAGE = '导演规划流式生成已超过 300 秒没有模型输出或思考活动，请检查模型连接后重试。';
export const STORYBOARD_PLANNING_STREAM_FIRST_TEXT_TIMEOUT_MS = 0;
export const STORYBOARD_PLANNING_STREAM_FIRST_TEXT_TIMEOUT_MESSAGE = '导演规划流式生成长时间没有返回正文内容，已停止等待，请稍后重试。';
const STORYBOARD_PLANNING_STREAM_RETRY_DELAYS_MS = [1200, 2800];

export interface StoryboardPlanningStreamCallbacks {
  onChunk: (delta: string) => void;
  onActivity?: () => void;
  onReplace?: (fullText: string) => void;
}

export interface StoryboardPlanningStreamRequestOptions {
  temperature: number;
  maxTokens: number;
  reasoningEffort?: ReasoningEffort;
  signal: AbortSignal;
}

export type StoryboardPlanningStreamRequester = (
  requestPayload: string,
  options: StoryboardPlanningStreamRequestOptions,
  callbacks: StoryboardPlanningStreamCallbacks,
) => Promise<string>;

export interface StoryboardPlanningStreamProgressCallbacks {
  onProgress?: (fullText: string, delta: string) => void;
}

export async function withStoryboardPlanningStreamNoOutputTimeout<T>(
  request: (signal: AbortSignal, markOutput: () => void, markTextOutput: () => void) => Promise<T>,
  timeoutMs = STORYBOARD_PLANNING_STREAM_NO_OUTPUT_TIMEOUT_MS,
  firstTextTimeoutMs = STORYBOARD_PLANNING_STREAM_FIRST_TEXT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let hasTextOutput = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstTextTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (firstTextTimer) clearTimeout(firstTextTimer);
      callback();
    };

    const resetTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (settled) return;
        controller.abort();
        settle(() => reject(new Error(STORYBOARD_PLANNING_STREAM_NO_OUTPUT_TIMEOUT_MESSAGE)));
      }, timeoutMs);
    };

    const markTextOutput = () => {
      hasTextOutput = true;
      if (firstTextTimer) clearTimeout(firstTextTimer);
      resetTimer();
    };

    resetTimer();
    if (firstTextTimeoutMs > 0) {
      firstTextTimer = setTimeout(() => {
        if (settled || hasTextOutput) return;
        controller.abort();
        settle(() => reject(new Error(STORYBOARD_PLANNING_STREAM_FIRST_TEXT_TIMEOUT_MESSAGE)));
      }, firstTextTimeoutMs);
    }

    try {
      request(controller.signal, resetTimer, markTextOutput).then(
        (value) => settle(() => resolve(value)),
        (error) => settle(() => reject(error)),
      );
    } catch (error) {
      settle(() => reject(error));
    }
  });
}

export async function requestStoryboardPlanningTextStream(
  requestPayload: string,
  request: StoryboardPlanningStreamRequester,
  requestOptions: Omit<StoryboardPlanningStreamRequestOptions, 'signal'>,
  progressCallbacks: StoryboardPlanningStreamProgressCallbacks = {},
  noOutputTimeoutMs = STORYBOARD_PLANNING_STREAM_NO_OUTPUT_TIMEOUT_MS,
): Promise<string> {
  const invokeOnce = () => withStoryboardPlanningStreamNoOutputTimeout(async (signal, markOutput, markTextOutput) => {
    let streamedText = '';

    const result = await request(
      requestPayload,
      {
        ...requestOptions,
        signal,
      },
      {
        onActivity: () => {
          markOutput();
        },
        onChunk: (delta) => {
          streamedText += delta;
          markTextOutput();
          progressCallbacks.onProgress?.(streamedText, delta);
        },
        onReplace: (fullText) => {
          streamedText = fullText;
          markTextOutput();
          progressCallbacks.onProgress?.(streamedText, '');
        },
      },
    );

    const finalText = result.trim() || streamedText.trim();
    if (finalText) {
      markTextOutput();
      progressCallbacks.onProgress?.(finalText, '');
    }
    return finalText;
  }, noOutputTimeoutMs);

  let lastError: unknown;
  for (let attempt = 0; attempt <= STORYBOARD_PLANNING_STREAM_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await invokeOnce();
    } catch (error) {
      lastError = error;
      if (attempt >= STORYBOARD_PLANNING_STREAM_RETRY_DELAYS_MS.length || !isTransientApiError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, STORYBOARD_PLANNING_STREAM_RETRY_DELAYS_MS[attempt]));
    }
  }

  throw lastError ?? new Error('导演规划流式生成失败。');
}
