import type { ApiConfig } from '@/types';
import {
  chatComplete,
  chatCompleteStream,
  type ChatMessage,
  type ReasoningEffort,
} from '@/lib/api-client';
import {
  cancelBackgroundJob,
  createBackgroundJob,
  getBackgroundJob,
  type BackgroundJob,
} from '@/lib/backgroundJobsClient';
import { buildStep4DirectTemplateMessages, supportsStep4DirectTemplate } from '@/lib/step4LocalPromptTemplates';

const BFF_CHAT_ENDPOINTS = ['/api/chat/completions', '/api/prompt/chat/completions'] as const;
const BACKGROUND_LLM_POLL_INTERVAL_MS = 1000;
const BACKGROUND_LLM_TIMEOUT_MS = 35 * 60_000;
const STEP4_BACKGROUND_LLM_TIMEOUT_MS = 5 * 60_000;
const BACKGROUND_LLM_STREAM_IDLE_TIMEOUT_MS = 300_000;

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripHtml(text: string): string {
  return compactWhitespace(
    text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

export function normalizeBffErrorMessage(status: number, body: string): string {
  let message = body;
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const parsedMessage = typeof parsed.error === 'string'
      ? parsed.error
      : typeof parsed.message === 'string'
        ? parsed.message
        : '';
    if (parsedMessage) message = parsedMessage;
  } catch {
    // Non-JSON upstream errors are normalized below.
  }

  const providerStatus = message.match(/LLM API Error \((\d{3})\)/i)?.[1] ?? String(status);
  const readable = stripHtml(message);

  if (/<html|<\/html>|nginx|Internal Server Error|Bad Gateway|Gateway Timeout/i.test(message)) {
    return `BFF Error (${status}): LLM service temporarily returned ${providerStatus}; please retry.`;
  }

  return `BFF Error (${status}): ${readable.slice(0, 300) || 'Unknown error'}`;
}

function toReadableBffError(error: unknown): Error {
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return new Error('Cannot connect to the prompt proxy service. Please check that the frontend and BFF services are running.');
  }
  return error instanceof Error ? error : new Error(String(error));
}

function shouldTryNextBffEndpoint(response: Response): boolean {
  return response.status === 404 || response.status === 405;
}

async function postBffChatCompletion(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  let lastResponse: Response | undefined;
  let lastBody = '';

  for (const endpoint of BFF_CHAT_ENDPOINTS) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw toReadableBffError(error);
    }

    if (!shouldTryNextBffEndpoint(response)) return response;
    lastResponse = response;
    lastBody = await response.text().catch(() => '');
  }

  if (!lastResponse) throw new Error('Prompt proxy endpoint is unavailable');
  return new Response(lastBody, {
    status: lastResponse.status,
    statusText: lastResponse.statusText,
    headers: lastResponse.headers,
  });
}

function createAbortError(message = 'Request cancelled'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function sanitizeJobSegment(value: unknown): string | undefined {
  const text = getText(value);
  if (!text) return undefined;
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(text) ? text : undefined;
}

function deriveBackgroundProjectId(templateVars: Record<string, unknown> | undefined): string {
  const vars = templateVars ?? {};
  const nestedProject = isRecord(vars.project) ? vars.project.id : undefined;
  return sanitizeJobSegment(vars.projectId)
    ?? sanitizeJobSegment(vars.__projectId)
    ?? sanitizeJobSegment(vars.currentProjectId)
    ?? sanitizeJobSegment(nestedProject)
    ?? 'global';
}

function deriveBackgroundChapterId(templateVars: Record<string, unknown> | undefined): string | undefined {
  const vars = templateVars ?? {};
  return sanitizeJobSegment(vars.chapterId)
    ?? sanitizeJobSegment(vars.__chapterId)
    ?? sanitizeJobSegment(vars.currentChapterId);
}

function deriveBackgroundStoryboardIndex(templateVars: Record<string, unknown> | undefined): number | undefined {
  const value = templateVars?.storyboardIndex ?? templateVars?.__storyboardIndex;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

async function sha256Text(text: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(16).padStart(8, '0');
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw createAbortError();
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function shouldFallbackFromBackgroundJobError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Not authenticated|Unauthorized|Forbidden|Unsupported background job type|Cannot connect|Failed to fetch|NetworkError|Load failed|404|405/i.test(message);
}

function getBackgroundLlmContent(job: BackgroundJob): string {
  const outputContent = job.output?.content;
  if (typeof outputContent === 'string' && outputContent.trim()) return outputContent;
  const progressPreview = job.progress?.preview;
  return typeof progressPreview === 'string' ? progressPreview : '';
}

function getBackgroundLlmPreview(job: BackgroundJob): string {
  const preview = job.progress?.preview;
  if (typeof preview === 'string') return preview;
  const content = job.output?.content;
  return typeof content === 'string' ? content : '';
}

export interface BffChatOptions {
  templateType: string;
  templateVars?: Record<string, unknown>;
  userMessages: ChatMessage[];
  apiConfig: ApiConfig;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  forceFresh?: boolean;
  disableBackgroundJob?: boolean;
  backgroundProgressMode?: 'detailed' | 'stage-only';
}

export interface BffStreamCallbacks {
  onChunk: (delta: string) => void;
  onActivity?: () => void;
  onReplace?: (fullText: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

export type ParsedBffSseEvent =
  | { kind: 'delta'; content: string }
  | { kind: 'activity' }
  | { kind: 'replace'; content: string }
  | { kind: 'error'; message: string }
  | { kind: 'done' };

interface BackgroundLlmResult {
  handled: boolean;
  content: string;
}

function getBackgroundLlmTimeoutMs(templateType: string): number {
  return templateType.startsWith('storyboard') || templateType.includes('seedance')
    ? STEP4_BACKGROUND_LLM_TIMEOUT_MS
    : BACKGROUND_LLM_TIMEOUT_MS;
}

function getBackgroundLlmWaitTimeoutMs(templateType: string): number {
  const requestTimeoutMs = getBackgroundLlmTimeoutMs(templateType);
  return templateType.startsWith('storyboard') || templateType.includes('seedance')
    ? requestTimeoutMs * 3 + 3 * 60_000
    : requestTimeoutMs + 60_000;
}

export function parseBffSseEvent(line: string): ParsedBffSseEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed === 'data: [DONE]') return { kind: 'done' };
  if (!trimmed.startsWith('data: ')) return null;

  try {
    const json = unwrapApiResponseEnvelope(JSON.parse(trimmed.slice(6))) as {
      type?: unknown;
      content?: unknown;
      message?: unknown;
      choices?: Array<{
        delta?: {
          content?: unknown;
          reasoning_content?: unknown;
          reasoning?: unknown;
        };
      }>;
    };
    if (json?.type === 'replace' && typeof json.content === 'string') {
      return { kind: 'replace', content: json.content };
    }
    if (json?.type === 'error' && typeof json.message === 'string') {
      return { kind: 'error', message: json.message };
    }

    const delta = json?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      return { kind: 'delta', content: delta };
    }

    const reasoning = json?.choices?.[0]?.delta?.reasoning_content
      ?? json?.choices?.[0]?.delta?.reasoning;
    if (typeof reasoning === 'string' && reasoning) {
      return { kind: 'activity' };
    }
  } catch {
    return null;
  }

  return null;
}

async function createBackgroundLlmJob(
  opts: BffChatOptions,
  stream: boolean,
): Promise<BackgroundJob> {
  const { templateType, templateVars, userMessages, apiConfig, temperature = 0.7, maxTokens = 8000, reasoningEffort, forceFresh } = opts;
  const progressMode = opts.backgroundProgressMode === 'stage-only' ? 'stage-only' : 'detailed';
  const jobStream = progressMode === 'stage-only' ? false : stream;
  const timeoutMs = getBackgroundLlmTimeoutMs(templateType);
  const idempotencySource = stableJson({
    templateType,
    templateVars,
    userMessages,
    apiConfig: {
      baseUrl: apiConfig.baseUrl,
      model: apiConfig.model,
    },
    options: { temperature, maxTokens, reasoningEffort, stream: jobStream, progressMode },
  });
  const baseKey = `llm:${await sha256Text(idempotencySource)}`;
  const input = {
    templateType,
    templateVars,
    userMessages,
    apiConfig,
    options: { temperature, maxTokens, reasoningEffort, stream: jobStream },
    stream: jobStream,
    progressMode,
    timeoutMs,
    streamIdleTimeoutMs: BACKGROUND_LLM_STREAM_IDLE_TIMEOUT_MS,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const idempotencyKey = forceFresh
      ? `${baseKey}:fresh:${Date.now()}:${Math.random().toString(36).slice(2)}`
      : attempt === 0 ? baseKey : `${baseKey}:retry:${Date.now()}`;
    const { job, reused } = await createBackgroundJob({
      projectId: deriveBackgroundProjectId(templateVars),
      chapterId: deriveBackgroundChapterId(templateVars),
      storyboardIndex: deriveBackgroundStoryboardIndex(templateVars),
      type: 'llm-completions',
      priority: templateType.startsWith('storyboard') || templateType.includes('seedance') ? 30 : 10,
      maxAttempts: templateType.startsWith('storyboard') || templateType.includes('seedance') ? 5 : 3,
      idempotencyKey,
      input,
      progress: {
        phase: 'queued',
        templateType,
        stream: jobStream,
        progressMode,
      },
    });

    if (!reused || (job.status !== 'failed' && job.status !== 'cancelled')) return job;
  }

  throw new Error('Cannot create a fresh background LLM job');
}

async function runBackgroundLlmCompletion(
  opts: BffChatOptions,
  streamCallbacks: BffStreamCallbacks | null,
  signal?: AbortSignal,
): Promise<BackgroundLlmResult> {
  let job: BackgroundJob;
  try {
    job = await createBackgroundLlmJob(opts, !!streamCallbacks);
  } catch (error) {
    if (shouldFallbackFromBackgroundJobError(error)) return { handled: false, content: '' };
    throw error;
  }

  const startedAt = Date.now();
  const waitTimeoutMs = getBackgroundLlmWaitTimeoutMs(opts.templateType);
  let lastPreview = '';

  try {
    while (true) {
      if (signal?.aborted) throw createAbortError();
      if (Date.now() - startedAt > waitTimeoutMs) {
        throw new Error('Background LLM job timed out while waiting for completion.');
      }

      const { job: latest } = await getBackgroundJob(job.id);
      job = latest;

      const stageOnly = opts.backgroundProgressMode === 'stage-only';
      const preview = stageOnly ? '' : getBackgroundLlmPreview(job);
      if (streamCallbacks && preview && preview !== lastPreview) {
        lastPreview = preview;
        streamCallbacks.onReplace?.(preview);
      } else if (streamCallbacks && (job.status === 'queued' || job.status === 'running')) {
        streamCallbacks.onActivity?.();
      }

      if (job.status === 'succeeded') {
        const content = getBackgroundLlmContent(job);
        if (!content.trim()) throw new Error('Background LLM job returned empty content');
        streamCallbacks?.onDone(content);
        return { handled: true, content };
      }

      if (job.status === 'failed') {
        const message = typeof job.error?.message === 'string' ? job.error.message : 'Background LLM job failed';
        throw new Error(message);
      }

      if (job.status === 'cancelled') {
        throw createAbortError('Background LLM job cancelled');
      }

      await sleepWithAbort(BACKGROUND_LLM_POLL_INTERVAL_MS, signal);
    }
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      await cancelBackgroundJob(job.id, 'User cancelled LLM generation').catch(() => undefined);
      throw createAbortError();
    }
    throw error;
  }
}

export async function bffChatComplete(opts: BffChatOptions, signal?: AbortSignal): Promise<string> {
  const { templateType, templateVars, userMessages, apiConfig, temperature = 0.7, maxTokens = 8000, reasoningEffort } = opts;

  if (!opts.disableBackgroundJob) {
    const backgroundResult = await runBackgroundLlmCompletion(opts, null, signal);
    if (backgroundResult.handled) return backgroundResult.content;
  }

  if (supportsStep4DirectTemplate(templateType)) {
    const messages = buildStep4DirectTemplateMessages(templateType, userMessages);
    return chatComplete(
      apiConfig,
      messages,
      { temperature, maxTokens, reasoningEffort, stream: false },
      signal,
    );
  }

  const response = await postBffChatCompletion({
    templateType,
    templateVars,
    userMessages,
    apiConfig,
    options: { temperature, maxTokens, reasoningEffort, stream: false },
  }, signal);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(normalizeBffErrorMessage(response.status, errorBody));
  }

  const data = await response.json();
  const content = extractChatContent(data);

  if (!content) {
    throw new Error('BFF returned empty content');
  }

  return typeof content === 'string' ? content : JSON.stringify(content);
}

export async function bffChatCompleteStream(
  opts: BffChatOptions,
  callbacks: BffStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const { templateType, templateVars, userMessages, apiConfig, temperature = 0.7, maxTokens = 8000, reasoningEffort } = opts;

  try {
    if (!opts.disableBackgroundJob) {
      const backgroundResult = await runBackgroundLlmCompletion(opts, callbacks, signal);
      if (backgroundResult.handled) return;
    }
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    return;
  }

  if (supportsStep4DirectTemplate(templateType)) {
    return chatCompleteStream(
      apiConfig,
      buildStep4DirectTemplateMessages(templateType, userMessages),
      callbacks,
      { temperature, maxTokens, reasoningEffort, stream: true },
      signal,
    );
  }

  try {
    const response = await postBffChatCompletion({
      templateType,
      templateVars,
      userMessages,
      apiConfig,
      options: { temperature, maxTokens, reasoningEffort, stream: true },
    }, signal);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      callbacks.onError(new Error(normalizeBffErrorMessage(response.status, errorBody)));
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
    let serverError: Error | null = null;
    const handleEvent = (event: ParsedBffSseEvent): boolean => {
      if (event.kind === 'done') {
        reader.cancel().catch(() => {});
        if (serverError) {
          callbacks.onError(serverError);
          return true;
        }
        callbacks.onDone(fullText);
        return true;
      }

      if (event.kind === 'delta') {
        fullText += event.content;
        callbacks.onChunk(event.content);
        return false;
      }

      if (event.kind === 'activity') {
        callbacks.onActivity?.();
        return false;
      }

      if (event.kind === 'replace') {
        fullText = event.content;
        callbacks.onReplace?.(fullText);
        return false;
      }

      if (event.kind === 'error') {
        serverError = new Error(event.message);
        reader.cancel().catch(() => {});
        callbacks.onError(serverError);
        return true;
      }

      return false;
    };

    while (true) {
      if (signal?.aborted) {
        reader.cancel().catch(() => {});
        callbacks.onError(createAbortError());
        return;
      }

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
      buffer = lines.pop() || '';

      for (const line of lines) {
        const event = parseBffSseEvent(line);
        if (!event) continue;

        if (handleEvent(event)) {
          return;
        }
      }
    }

    const trailingEvent = parseBffSseEvent(buffer);
    if (trailingEvent && handleEvent(trailingEvent)) {
      return;
    }

    if (serverError) {
      callbacks.onError(serverError);
      return;
    }

    callbacks.onError(new Error('BFF stream ended before completion marker'));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      callbacks.onError(createAbortError());
    } else {
      callbacks.onError(toReadableBffError(error));
    }
  }
}
