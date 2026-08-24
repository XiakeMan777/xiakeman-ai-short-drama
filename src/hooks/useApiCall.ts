// ============================================================
// API 调用 Hook - 封装 loading/error/retry 状态 + AbortController
// 支持 BFF 代理模式（提示词模板保护）和直连模式（向后兼容）
// ============================================================

import { useState, useCallback, useRef } from 'react';
import type { ApiConfig } from '@/types';
import { chatCompleteStream, chatComplete } from '@/lib/api-client';
import type { ChatCompleteOptions, ChatMessage, ChatStreamUpdateEvent } from '@/lib/api-client';
import { bffChatCompleteStream, bffChatComplete, type BffChatOptions } from '@/lib/bff-client';

const BFF_RETRY_DELAYS_MS = [1200, 2800];
const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 300_000;
const DEFAULT_LLM_FIRST_TEXT_TIMEOUT_MS = 600_000;

type RequestTimeoutMode = 'total' | 'stream-idle' | 'first-text';

interface RequestTimeoutHandle {
  clear: () => void;
  refresh: () => void;
}

interface UseApiCallOptions {
  stream?: boolean;
  allowConcurrent?: boolean;
}

/** BFF 代理调用所需的额外参数 */
export interface BffProxyParams {
  templateType: string;
  templateVars?: Record<string, unknown>;
}

function isAbortLikeError(err: unknown): boolean {
  return (err instanceof DOMException && err.name === 'AbortError')
    || (err instanceof Error && (err.name === 'AbortError' || err.message === '请求已取消'));
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRetryableBffError(err: unknown): boolean {
  const message = getErrorMessage(err);
  if (/(?:API|BFF|LLM)\s+stream\s+ended\s+before\s+completion\s+marker|stream\s+ended\s+before\s+completion\s+marker|completion\s+marker|fetch\s+failed|network\s+error|ERR_NETWORK/i.test(message)) {
    return true;
  }
  return /BFF Error \((?:429|5\d\d)\)|LLM API Error \((?:429|5\d\d)\)|BFF stream error|Failed to fetch|NetworkError|Load failed|timeout|timed out|Internal Server Error|Bad Gateway|Gateway Timeout|temporarily|error decoding response body|response\.completed|non[-\s]?json|非\s*JSON|解析上游|读取上游.*失败|上游.*响应.*失败|暂时|稍后重试/i.test(message);
}

function toReadableApiError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function createTimeoutError(mode: RequestTimeoutMode = 'total'): Error {
  const error = new Error(mode === 'stream-idle'
    ? '流式生成超过 300 秒没有收到模型输出或思考活动，请检查模型连接后重试。'
    : mode === 'first-text'
    ? '流式生成超过 600 秒没有返回可见正文内容，已停止本次等待，请稍后重试。'
    : '请求超过 300 秒仍未返回，请检查模型是否仍在生成，或稍后重试。');
  error.name = 'TimeoutError';
  return error;
}

function getTimeoutError(signal: AbortSignal): Error | null {
  const reason = signal.reason;
  if (reason instanceof Error && reason.name === 'TimeoutError') {
    return reason;
  }
  return null;
}

function startRequestTimeout(
  controller: AbortController,
  mode: RequestTimeoutMode = 'total',
): RequestTimeoutHandle {
  let timeoutId: number | null = null;

  const clear = () => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const refresh = () => {
    clear();
    timeoutId = window.setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort(createTimeoutError(mode));
      }
    }, mode === 'first-text' ? DEFAULT_LLM_FIRST_TEXT_TIMEOUT_MS : DEFAULT_LLM_REQUEST_TIMEOUT_MS);
  };

  refresh();
  return { clear, refresh };
}

function bindExternalAbortSignal(
  controller: AbortController,
  signal: AbortSignal | undefined,
): (() => void) | null {
  if (!signal) return null;
  const abortFromExternalSignal = () => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason ?? new DOMException('The user aborted a request.', 'AbortError'));
    }
  };
  if (signal.aborted) {
    abortFromExternalSignal();
    return null;
  }
  signal.addEventListener('abort', abortFromExternalSignal, { once: true });
  return () => signal.removeEventListener('abort', abortFromExternalSignal);
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(getTimeoutError(signal) ?? new DOMException('The user aborted a request.', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(getTimeoutError(signal) ?? new DOMException('The user aborted a request.', 'AbortError'));
    }, { once: true });
  });
}

function notifyStreamUpdate(
  options: ChatCompleteOptions | undefined,
  fullText: string,
  delta: string,
  event: ChatStreamUpdateEvent,
) {
  try {
    options?.onStreamUpdate?.(fullText, delta, event);
  } catch {
    // UI observers must never break the actual API request.
  }
}

export function useApiCall(options: UseApiCallOptions = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamText, setStreamText] = useState('');

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeControllersRef = useRef<Set<AbortController>>(new Set());
  const activeRequestCountRef = useRef(0);
  const displayRequestIdRef = useRef(0);
  const allowConcurrent = options.allowConcurrent ?? false;

  const beginRequest = useCallback((displayUpdates = true) => {
    if (!allowConcurrent) {
      activeControllersRef.current.forEach((controller) => controller.abort());
      activeControllersRef.current.clear();
      activeRequestCountRef.current = 0;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    activeControllersRef.current.add(controller);
    activeRequestCountRef.current += 1;
    if (displayUpdates) {
      displayRequestIdRef.current += 1;
    }

    return { controller, requestId: displayRequestIdRef.current };
  }, [allowConcurrent]);

  const finishRequest = useCallback((controller: AbortController) => {
    if (activeControllersRef.current.delete(controller)) {
      activeRequestCountRef.current = Math.max(0, activeRequestCountRef.current - 1);
    }
    if (abortControllerRef.current === controller) {
      abortControllerRef.current = null;
    }
    if (activeRequestCountRef.current === 0) {
      setLoading(false);
    }
  }, []);

  /**
   * 直连模式调用（向后兼容，不经过 BFF）
   * 适用于用户自行配置 API 的场景
   */
  const callApi = useCallback(
    async (
      config: ApiConfig,
      messages: ChatMessage[],
      apiOptions?: ChatCompleteOptions,
    ): Promise<string> => {
      const suppressDisplayUpdates = apiOptions?.suppressDisplayUpdates === true;
      const { controller, requestId } = beginRequest(!suppressDisplayUpdates);
      const isDisplayRequest = () => !suppressDisplayUpdates && displayRequestIdRef.current === requestId;
      const shouldStream = apiOptions?.stream ?? options.stream;
      const unbindExternalAbortSignal = bindExternalAbortSignal(controller, apiOptions?.signal);
      const requestTimeout = startRequestTimeout(controller, shouldStream ? 'stream-idle' : 'total');
      const firstTextTimeout = shouldStream ? startRequestTimeout(controller, 'first-text') : null;

      if (!suppressDisplayUpdates) {
        setLoading(true);
        setError(null);
        setStreamText('');
      }

      try {
        if (shouldStream) {
          let requestStreamText = '';
          return await new Promise<string>((resolve, reject) => {
            chatCompleteStream(
              config,
              messages,
              {
                onChunk: (delta) => {
                  requestTimeout.refresh();
                  firstTextTimeout?.clear();
                  requestStreamText += delta;
                  notifyStreamUpdate(apiOptions, requestStreamText, delta, 'chunk');
                  if (isDisplayRequest()) setStreamText((prev) => prev + delta);
                },
                onActivity: () => {
                  requestTimeout.refresh();
                  firstTextTimeout?.refresh();
                  notifyStreamUpdate(apiOptions, requestStreamText, '', 'activity');
                },
                onDone: (fullText) => {
                  requestTimeout.clear();
                  firstTextTimeout?.clear();
                  notifyStreamUpdate(apiOptions, fullText || requestStreamText, '', 'done');
                  resolve(fullText);
                },
                onError: (err) => {
                  if (isDisplayRequest()) setError(err.message);
                  reject(err);
                },
              },
              apiOptions,
              controller.signal,
            );
          });
        } else {
          const result = await chatComplete(config, messages, apiOptions, controller.signal);
          notifyStreamUpdate(apiOptions, result, '', 'result');
          if (isDisplayRequest()) setStreamText(result);
          return result;
        }
      } catch (err) {
        const timeoutError = getTimeoutError(controller.signal);
        if (timeoutError) {
          if (isDisplayRequest()) setError(timeoutError.message);
          throw timeoutError;
        }
        if (isAbortLikeError(err)) {
          if (isDisplayRequest()) setError(null);
          throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        if (isDisplayRequest()) setError(message);
        throw err;
      } finally {
        unbindExternalAbortSignal?.();
        requestTimeout.clear();
        firstTextTimeout?.clear();
        finishRequest(controller);
      }
    },
    [beginRequest, finishRequest, options.stream],
  );

  /**
   * BFF 代理模式调用（提示词模板保护）
   * system prompt 在服务端注入，前端只发送 user 消息
   */
  const callApiViaBff = useCallback(
    async (
      config: ApiConfig,
      userMessages: ChatMessage[],
      bffParams: BffProxyParams,
      apiOptions?: ChatCompleteOptions,
    ): Promise<string> => {
      const suppressDisplayUpdates = apiOptions?.suppressDisplayUpdates === true;
      const { controller, requestId } = beginRequest(!suppressDisplayUpdates);
      const isDisplayRequest = () => !suppressDisplayUpdates && displayRequestIdRef.current === requestId;
      const shouldStream = apiOptions?.stream ?? options.stream;
      const unbindExternalAbortSignal = bindExternalAbortSignal(controller, apiOptions?.signal);
      const requestTimeout = startRequestTimeout(controller, shouldStream ? 'stream-idle' : 'total');
      const firstTextTimeout = shouldStream ? startRequestTimeout(controller, 'first-text') : null;

      if (!suppressDisplayUpdates) {
        setLoading(true);
        setError(null);
        setStreamText('');
      }

      const bffOpts: BffChatOptions = {
        templateType: bffParams.templateType,
        templateVars: bffParams.templateVars,
        userMessages,
        apiConfig: config,
        temperature: apiOptions?.temperature,
        maxTokens: apiOptions?.maxTokens,
        reasoningEffort: apiOptions?.reasoningEffort,
        forceFresh: apiOptions?.forceFresh,
        disableBackgroundJob: apiOptions?.disableBackgroundJob,
        backgroundProgressMode: apiOptions?.backgroundProgressMode,
      };

      const invokeOnce = async (): Promise<string> => {
        if (shouldStream) {
          let requestStreamText = '';
          return new Promise<string>((resolve, reject) => {
            bffChatCompleteStream(
              bffOpts,
              {
                onChunk: (delta) => {
                  requestTimeout.refresh();
                  firstTextTimeout?.clear();
                  requestStreamText += delta;
                  notifyStreamUpdate(apiOptions, requestStreamText, delta, 'chunk');
                  if (isDisplayRequest()) setStreamText((prev) => prev + delta);
                },
                onActivity: () => {
                  requestTimeout.refresh();
                  firstTextTimeout?.refresh();
                  notifyStreamUpdate(apiOptions, requestStreamText, '', 'activity');
                },
                onReplace: (fullText: string) => {
                  requestTimeout.refresh();
                  firstTextTimeout?.clear();
                  requestStreamText = fullText;
                  notifyStreamUpdate(apiOptions, fullText, '', 'replace');
                  if (isDisplayRequest()) setStreamText(fullText);
                },
                onDone: (fullText) => {
                  requestTimeout.clear();
                  firstTextTimeout?.clear();
                  notifyStreamUpdate(apiOptions, fullText || requestStreamText, '', 'done');
                  resolve(fullText);
                },
                onError: (err) => {
                  reject(err);
                },
              },
              controller.signal,
            );
          });
        } else {
          const result = await bffChatComplete(bffOpts, controller.signal);
          notifyStreamUpdate(apiOptions, result, '', 'result');
          if (isDisplayRequest()) setStreamText(result);
          return result;
        }
      };

      try {
        let lastError: unknown = null;
        for (let attempt = 0; attempt <= BFF_RETRY_DELAYS_MS.length; attempt++) {
          if (attempt > 0) {
            const retryDelay = BFF_RETRY_DELAYS_MS[attempt - 1] ?? 0;
            const retryText = `上一次 LLM 请求临时失败，正在自动重试 ${attempt}/${BFF_RETRY_DELAYS_MS.length}...`;
            notifyStreamUpdate(apiOptions, retryText, '', 'retry');
            if (!suppressDisplayUpdates) setStreamText(retryText);
            await waitForRetry(retryDelay, controller.signal);
            notifyStreamUpdate(apiOptions, '', '', 'retry');
            if (!suppressDisplayUpdates) setStreamText('');
          }

          try {
            const result = await invokeOnce();
            if (isDisplayRequest()) setError(null);
            return result;
          } catch (err) {
            if (isAbortLikeError(err)) throw err;
            lastError = err;
            if (attempt < BFF_RETRY_DELAYS_MS.length && isRetryableBffError(err)) {
              continue;
            }
            throw err;
          }
        }

        throw lastError ?? new Error('BFF returned no result');
      } catch (err) {
        const timeoutError = getTimeoutError(controller.signal);
        if (timeoutError) {
          if (isDisplayRequest()) setError(timeoutError.message);
          throw timeoutError;
        }
        if (isAbortLikeError(err)) {
          if (isDisplayRequest()) setError(null);
          throw err;
        }
        const readableError = toReadableApiError(err);
        const message = readableError.message;
        if (isDisplayRequest()) setError(message);
        throw readableError;
      } finally {
        unbindExternalAbortSignal?.();
        requestTimeout.clear();
        firstTextTimeout?.clear();
        finishRequest(controller);
      }
    },
    [beginRequest, finishRequest, options.stream],
  );

  /** 中止当前正在进行的 API 请求 */
  const abort = useCallback(() => {
    activeControllersRef.current.forEach((controller) => controller.abort());
    activeControllersRef.current.clear();
    activeRequestCountRef.current = 0;
    abortControllerRef.current = null;
    setLoading(false);
    setError(null);
    setStreamText('');
  }, []);

  const reset = useCallback(() => {
    activeControllersRef.current.forEach((controller) => controller.abort());
    activeControllersRef.current.clear();
    activeRequestCountRef.current = 0;
    abortControllerRef.current = null;
    setLoading(false);
    setError(null);
    setStreamText('');
  }, []);

  return { loading, error, streamText, callApi, callApiViaBff, abort, reset };
}
