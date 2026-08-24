// ============================================================
// API 客户端 - OpenAI 兼容接口封装
// 支持 OpenAI / DeepSeek / 其他兼容服务
// ============================================================

import type { ApiConfig } from '@/types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ReasoningEffort = 'low' | 'medium' | 'high';
export type ChatStreamUpdateEvent = 'chunk' | 'activity' | 'replace' | 'done' | 'retry' | 'result';

export interface ChatCompleteOptions {
  /** 温度参数，默认 0.7。结构化提取建议用 0.3 */
  temperature?: number;
  /** 最大 token 数，默认 8000 */
  maxTokens?: number;
  /** Optional reasoning effort for compatible reasoning models/gateways. */
  reasoningEffort?: ReasoningEffort;
  /** 覆盖当前 Hook 默认的流式设置 */
  stream?: boolean;
  /** Optional upstream cancellation signal used by task-level orchestration. */
  signal?: AbortSignal;
  /** Optional per-request stream observer used by global task UI. */
  onStreamUpdate?: (fullText: string, delta: string, event: ChatStreamUpdateEvent) => void;
  /** Keep background/global requests from driving the hook's visible stream state on every chunk. */
  suppressDisplayUpdates?: boolean;
  /** Force BFF background LLM orchestration to create a fresh job instead of reusing a completed idempotent job. */
  forceFresh?: boolean;
  /** Skip BFF background LLM orchestration and use the live stream/request path directly. */
  disableBackgroundJob?: boolean;
  /** For background LLM orchestration, keep progress lightweight and return final text only when done. */
  backgroundProgressMode?: 'detailed' | 'stage-only';
}

export interface ApiStreamCallbacks {
  onChunk: (delta: string) => void;
  onActivity?: () => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

function unwrapApiResponseEnvelope(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('data' in value)) return value;
  const data = (value as { data?: unknown }).data;
  return data && typeof data === 'object' ? data : value;
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text;
      if (part && typeof part === 'object' && 'content' in part && typeof part.content === 'string') return part.content;
      return '';
    })
    .join('');
}

function extractChatContent(value: unknown): string {
  const data = unwrapApiResponseEnvelope(value) as {
    choices?: Array<{
      message?: { content?: unknown };
      text?: unknown;
    }>;
  };
  const messageContent = extractTextContent(data.choices?.[0]?.message?.content);
  if (messageContent) return messageContent;
  return typeof data.choices?.[0]?.text === 'string' ? data.choices[0].text : '';
}

function getStreamingDelta(value: unknown): { content: string; reasoning: string } {
  const data = unwrapApiResponseEnvelope(value) as {
    choices?: Array<{
      delta?: {
        content?: unknown;
        reasoning_content?: unknown;
        reasoning?: unknown;
      };
    }>;
  };
  const delta = data.choices?.[0]?.delta;
  return {
    content: typeof delta?.content === 'string' ? delta.content : '',
    reasoning: typeof delta?.reasoning_content === 'string'
      ? delta.reasoning_content
      : typeof delta?.reasoning === 'string'
        ? delta.reasoning
        : '',
  };
}

/**
 * 调用聊天完成接口（非流式）
 */
export async function chatComplete(
  config: ApiConfig,
  messages: ChatMessage[],
  options?: ChatCompleteOptions,
  signal?: AbortSignal,
): Promise<string> {
  const { temperature = 0.7, maxTokens = 8000, reasoningEffort } = options || {};
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

  if (import.meta.env.DEV) {
    console.log('[API] chatComplete 调用:', {
      baseUrl: config.baseUrl.replace(/\/+$/, ''),
      model: config.model,
      messageCount: messages.length,
      temperature,
      maxTokens,
      reasoningEffort,
    });
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `API Error (${response.status}): ${errorBody.slice(0, 500)}`,
    );
  }

  const data = await response.json();

  // 兼容不同 API 返回格式
  const content = extractChatContent(data);

  if (!content) {
    throw new Error('API returned empty content');
  }

  return typeof content === 'string' ? content : JSON.stringify(content);
}

/**
 * 调用聊天完成接口（流式）
 */
export async function chatCompleteStream(
  config: ApiConfig,
  messages: ChatMessage[],
  callbacks: ApiStreamCallbacks,
  options?: ChatCompleteOptions,
  signal?: AbortSignal,
): Promise<void> {
  const { temperature = 0.7, maxTokens = 8000, reasoningEffort } = options || {};
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

  if (import.meta.env.DEV) {
    console.log('[API] chatCompleteStream 调用:', {
      baseUrl: config.baseUrl.replace(/\/+$/, ''),
      model: config.model,
      messageCount: messages.length,
      temperature,
      maxTokens,
      reasoningEffort,
    });
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      }),
      signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      callbacks.onError(
        new Error(`API Error (${response.status}): ${errorBody.slice(0, 500)}`),
      );
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError(new Error('No response body reader available'));
      return;
    }

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';
    let doneReceived = false;

    while (true) {
      if (signal?.aborted) {
        reader.cancel().catch(() => {});
        callbacks.onError(new Error('请求已取消'));
        return;
      }
      // 使用 Promise.race 让 reader.read() 可被 abort 中断
      let onAbort: (() => void) | null = null;
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          if (signal) {
            onAbort = () => reject(new DOMException('The user aborted a request.', 'AbortError'));
            signal.addEventListener('abort', onAbort, { once: true });
          }
        }),
      ]).finally(() => {
        if (onAbort && signal) {
          signal.removeEventListener('abort', onAbort);
        }
      });
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 保留不完整的行

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed === 'data: [DONE]') {
          doneReceived = true;
          reader.cancel().catch(() => {});
          callbacks.onDone(fullText);
          return;
        }

        if (trimmed.startsWith('data: ')) {
          try {
            const { content: delta, reasoning } = getStreamingDelta(JSON.parse(trimmed.slice(6)));
            if (delta) {
              fullText += delta;
              callbacks.onChunk(delta);
            }
            if (reasoning) {
              callbacks.onActivity?.();
            }
          } catch {
            // 忽略解析错误的行
          }
        }
      }
    }

    const trailingLine = buffer.trim();
    if (trailingLine === 'data: [DONE]') {
      doneReceived = true;
      callbacks.onDone(fullText);
      return;
    }

    if (!doneReceived) {
      callbacks.onError(new Error('API stream ended before completion marker'));
      return;
    }

    callbacks.onDone(fullText);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      callbacks.onError(new Error('请求已取消'));
    } else {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

/**
 * 测试 API 连接
 */
export async function testApiConnection(
  config: ApiConfig,
): Promise<{ success: boolean; message: string }> {
  try {
    const result = await chatComplete(config, [
      { role: 'user', content: '请回复"连接成功"' },
    ]);
    return {
      success: true,
      message: `连接成功！模型回复：${result.slice(0, 100)}`,
    };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : '未知错误',
    };
  }
}
