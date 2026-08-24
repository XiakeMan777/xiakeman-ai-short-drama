const templates = require('./templates');
const { isHostnameAllowed, isPrivateHostname } = require('./url-policy');
const { updateJob } = require('./background-jobs');

const DEFAULT_LLM_JOB_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_LLM_STREAM_IDLE_TIMEOUT_MS = 300_000;
const LLM_PROGRESS_INTERVAL_MS = 1200;
const ALLOWED_REASONING_EFFORTS = new Set(['low', 'medium', 'high']);
const LLM_BASE_URL_ALLOWLIST = (process.env.LLM_BASE_URL_ALLOWLIST || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function isAllowedLlmBaseUrl(parsed) {
  if (LLM_BASE_URL_ALLOWLIST.length === 0) return !IS_PRODUCTION || !isPrivateHostname(parsed.hostname);
  return isHostnameAllowed(parsed.hostname, LLM_BASE_URL_ALLOWLIST);
}

function normalizeLlmBaseUrl(value) {
  const raw = getText(value);
  if (!raw) throw new Error('apiConfig.baseUrl is required');
  const parsed = new URL(raw);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('apiConfig.baseUrl must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('apiConfig.baseUrl must not include credentials');
  }
  if (!isAllowedLlmBaseUrl(parsed)) {
    throw new Error('apiConfig.baseUrl is not allowed by BFF policy');
  }
  return parsed.toString().replace(/\/$/, '');
}

function buildChatUrl(baseUrl) {
  const normalized = normalizeLlmBaseUrl(baseUrl);
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

function shouldUseStructuredJson(templateType) {
  return templateType === 'step1' || templateType === 'analysis_autofill';
}

function normalizeReasoningEffort(value) {
  const effort = getText(value);
  return ALLOWED_REASONING_EFFORTS.has(effort) ? effort : undefined;
}

function buildMessages(templateType, templateVars, userMessages) {
  const systemPrompt = templates.buildSystemPrompt(templateType, templateVars);
  if (!systemPrompt) throw new Error(`Unknown templateType: ${templateType}`);

  const messages = [{ role: 'system', content: systemPrompt }];
  for (const message of userMessages) {
    const role = message?.role === 'assistant' ? 'assistant' : 'user';
    const rawContent = typeof message?.content === 'string' ? message.content : String(message?.content || '');
    const content = role === 'user'
      ? templates.buildUserPrompt(templateType, rawContent, templateVars)
      : rawContent;
    messages.push({ role, content });
  }
  return messages;
}

function buildRequestBody(input, stream) {
  const apiConfig = asObject(input.apiConfig);
  const options = asObject(input.options);
  const templateType = getText(input.templateType);
  const templateVars = asObject(input.templateVars);
  const userMessages = asArray(input.userMessages);
  const body = {
    model: getText(apiConfig.model),
    messages: buildMessages(templateType, templateVars, userMessages),
    temperature: clampNumber(options.temperature, 0.7, 0, 2),
    max_tokens: Math.round(clampNumber(options.maxTokens, 8000, 256, 200000)),
    stream,
  };

  if (!body.model) throw new Error('apiConfig.model is required');
  const reasoningEffort = normalizeReasoningEffort(options.reasoningEffort);
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  if (shouldUseStructuredJson(templateType)) body.response_format = { type: 'json_object' };
  return body;
}

function shouldRetryWithoutResponseFormat(status, errorBody) {
  if (!errorBody) return false;
  const mentionsStructuredFormat = /response[_ ]format|json[_ ]object|json schema|unsupported|not support|不支持/i.test(errorBody);
  if (status === 400) return mentionsStructuredFormat;
  return status >= 500 && status < 600 && (mentionsStructuredFormat || /<html|<\/html>|nginx|Internal Server Error|Bad Gateway|Gateway Timeout/i.test(errorBody));
}

async function postJsonChat(url, apiKey, body, timeoutMs) {
  const doRequest = async (requestBody) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text().catch(() => '');
    return { response, text };
  };

  let result = await doRequest(body);
  if (!result.response.ok && body.response_format && shouldRetryWithoutResponseFormat(result.response.status, result.text)) {
    const fallbackBody = { ...body };
    delete fallbackBody.response_format;
    result = await doRequest(fallbackBody);
  }
  if (!result.response.ok) {
    throw new Error(`LLM API Error (${result.response.status}): ${result.text.slice(0, 500)}`);
  }

  const payload = JSON.parse(result.text);
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text;
  if (typeof content !== 'string' || !content.trim()) throw new Error('LLM returned empty content');
  return content;
}

function extractStreamDelta(payload) {
  const delta = payload?.choices?.[0]?.delta;
  const content = delta?.content;
  if (typeof content === 'string' && content) return { type: 'content', text: content };
  const reasoning = delta?.reasoning_content ?? delta?.reasoning;
  if (typeof reasoning === 'string' && reasoning) return { type: 'activity', text: '' };
  return null;
}

async function openStream(url, apiKey, body, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const refresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort(new Error(`LLM stream timeout: no upstream content or reasoning activity for ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  };
  refresh();

  const doFetch = (requestBody) => fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: controller.signal,
  });

  try {
    let response = await doFetch(body);
    if (!response.ok && body.response_format) {
      const errorBody = await response.text().catch(() => '');
      if (shouldRetryWithoutResponseFormat(response.status, errorBody)) {
        const fallbackBody = { ...body };
        delete fallbackBody.response_format;
        refresh();
        response = await doFetch(fallbackBody);
      } else {
        throw new Error(`LLM API Error (${response.status}): ${errorBody.slice(0, 500)}`);
      }
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`LLM API Error (${response.status}): ${text.slice(0, 500)}`);
    }
    return { response, refresh, clear: () => timer && clearTimeout(timer) };
  } catch (error) {
    if (timer) clearTimeout(timer);
    throw error;
  }
}

async function streamChat(url, apiKey, body, input, backgroundJob, context) {
  const idleTimeoutMs = Math.max(30_000, Number(input.streamIdleTimeoutMs || DEFAULT_LLM_STREAM_IDLE_TIMEOUT_MS));
  const progressMode = getText(input.progressMode) === 'stage-only' ? 'stage-only' : 'detailed';
  const { response, refresh, clear } = await openStream(url, apiKey, body, idleTimeoutMs);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('LLM stream response body is empty');

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let doneReceived = false;
  let lastProgressAt = 0;
  let lastProgressLength = 0;

  const pushProgress = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < LLM_PROGRESS_INTERVAL_MS && content.length === lastProgressLength) return;
    lastProgressAt = now;
    lastProgressLength = content.length;
    await updateJob(backgroundJob.userId, backgroundJob.id, {
      status: 'running',
      progress: {
        phase: 'streaming',
        textLength: content.length,
        ...(progressMode === 'stage-only' ? {} : { preview: content.slice(-4000) }),
        updatedAt: new Date().toISOString(),
      },
    }).catch(() => undefined);
    await context.heartbeat?.().catch(() => undefined);
  };

  const consumeLine = async (line) => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') {
      doneReceived = true;
      return;
    }
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    const delta = extractStreamDelta(payload);
    if (!delta) return;
    refresh();
    if (delta.type === 'content') content += delta.text;
    await pushProgress();
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) await consumeLine(line);
    }
    if (buffer) await consumeLine(buffer);
    if (!doneReceived) throw new Error('LLM stream ended before completion marker');
    if (!content.trim()) throw new Error('LLM returned empty content');
    await pushProgress(true);
    return content;
  } finally {
    clear();
  }
}

async function runLlmCompletionJob(backgroundJob, context = {}) {
  const input = asObject(backgroundJob.input);
  const apiConfig = asObject(input.apiConfig);
  const apiKey = getText(apiConfig.apiKey);
  if (!apiKey) throw new Error('apiConfig.apiKey is required');
  const url = buildChatUrl(apiConfig.baseUrl);
  const timeoutMs = Math.max(60_000, Number(input.timeoutMs || DEFAULT_LLM_JOB_TIMEOUT_MS));
  const stream = input.stream !== false;
  const progressMode = getText(input.progressMode) === 'stage-only' ? 'stage-only' : 'detailed';
  const body = buildRequestBody(input, stream);

  await context.event?.({
    level: 'info',
    phase: 'llm',
    message: stream ? 'LLM background stream started' : 'LLM background request started',
    data: {
      templateType: getText(input.templateType),
      model: body.model,
      maxTokens: body.max_tokens,
    },
  });

  const content = stream
    ? await streamChat(url, apiKey, body, input, backgroundJob, context)
    : await postJsonChat(url, apiKey, body, timeoutMs);

  return {
    status: 'succeeded',
    progress: {
      phase: 'done',
      textLength: content.length,
      ...(progressMode === 'stage-only' ? {} : { preview: content.slice(-4000) }),
      updatedAt: new Date().toISOString(),
    },
    output: {
      content,
      textLength: content.length,
      templateType: getText(input.templateType),
      model: body.model,
    },
    message: 'LLM background request complete',
  };
}

function createLlmJobHandlers() {
  return {
    'llm-completions': runLlmCompletionJob,
  };
}

module.exports = {
  createLlmJobHandlers,
  runLlmCompletionJob,
};
