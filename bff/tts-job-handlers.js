const {
  createCloudBlobDownloadUrlsForUser,
  putCloudProjectBlobBufferForUser,
} = require('./cloud-store');
const { isHostnameAllowed, isPrivateHostname } = require('./url-policy');

const DEFAULT_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const DEFAULT_TTS_MODEL = 'mimo-v2.5-tts';
const DEFAULT_TTS_VOICE_DESIGN_MODEL = 'mimo-v2.5-tts-voicedesign';
const DEFAULT_TTS_VOICE_CLONE_MODEL = 'mimo-v2.5-tts-voiceclone';
const DEFAULT_TTS_PRESET_VOICE = 'mimo_default';
const TTS_REQUEST_TIMEOUT_MS = 10 * 60_000;
const TTS_BASE_URL_ALLOWLIST = (process.env.TTS_BASE_URL_ALLOWLIST || process.env.LLM_BASE_URL_ALLOWLIST || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTag(value) {
  const trimmed = getText(value);
  if (!trimmed) return '';
  if (
    (trimmed.startsWith('(') && trimmed.endsWith(')'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return trimmed;
  }
  return `(${trimmed})`;
}

function sanitizeSpeakableText(value) {
  return getText(value)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*(Character|Scene|Guidance|角色|场景|导演|提示词|表演要求)\s*[:：].*$/gim, '')
    .replace(/\b(Character|Scene|Guidance)\s*[:：]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAssistantContent(text, styleTag, audioTag) {
  return [
    normalizeTag(styleTag),
    normalizeTag(audioTag),
    sanitizeSpeakableText(text),
  ].filter(Boolean).join(' ').trim();
}

function sanitizeVoiceDesignPrompt(value) {
  return getText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(Character|Scene|Guidance)\s*[:：]/gi, '')
    .slice(0, 800);
}

function resolveTtsModel(requestedModel, mode) {
  const trimmed = getText(requestedModel);
  if (mode === 'voiceDesign') {
    if (!trimmed || trimmed === 'mimo-v2-tts' || trimmed === DEFAULT_TTS_MODEL || trimmed === DEFAULT_TTS_VOICE_CLONE_MODEL) {
      return DEFAULT_TTS_VOICE_DESIGN_MODEL;
    }
    return trimmed;
  }
  if (mode === 'voiceClone') {
    if (!trimmed || trimmed === 'mimo-v2-tts' || trimmed === DEFAULT_TTS_MODEL || trimmed === DEFAULT_TTS_VOICE_DESIGN_MODEL) {
      return DEFAULT_TTS_VOICE_CLONE_MODEL;
    }
    return trimmed;
  }
  if (!trimmed || trimmed === 'mimo-v2-tts') return DEFAULT_TTS_MODEL;
  return trimmed;
}

function isAllowedTtsBaseUrl(parsed) {
  if (TTS_BASE_URL_ALLOWLIST.length === 0) return !IS_PRODUCTION || !isPrivateHostname(parsed.hostname);
  return isHostnameAllowed(parsed.hostname, TTS_BASE_URL_ALLOWLIST);
}

function buildTtsApiUrl(baseUrl) {
  const raw = getText(baseUrl);
  if (!raw) return DEFAULT_API_URL;
  const parsed = new URL(raw);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('tts baseUrl must use http or https');
  if (parsed.username || parsed.password) throw new Error('tts baseUrl must not include credentials');
  if (!isAllowedTtsBaseUrl(parsed)) throw new Error('tts baseUrl is not allowed by BFF policy');
  return `${parsed.toString().replace(/\/+$/, '')}/chat/completions`;
}

async function fetchWithTimeout(url, init, timeoutMs = TTS_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`TTS request timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCloudBuffer(userId, projectId, blobKey) {
  const payload = await createCloudBlobDownloadUrlsForUser(userId, projectId, [blobKey]);
  const item = Array.isArray(payload.blobs) ? payload.blobs[0] : undefined;
  const url = item?.download?.url;
  if (!url) throw new Error(`Cloud blob is missing download url for ${blobKey}`);
  const response = await fetchWithTimeout(url, { method: 'GET' });
  if (!response.ok) throw new Error(`TTS sample download failed: ${response.status}`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'audio/wav',
  };
}

function mediaToDataUrl(media) {
  return `data:${media.contentType || 'audio/wav'};base64,${media.buffer.toString('base64')}`;
}

function getWavDurationMs(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) return 0;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return 0;
  let offset = 12;
  let sampleRate = 0;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    if (chunkId === 'fmt ' && chunkSize >= 16) {
      sampleRate = buffer.readUInt32LE(chunkDataOffset + 4);
      byteRate = buffer.readUInt32LE(chunkDataOffset + 8);
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }
    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }
  if (byteRate > 0 && dataSize > 0) return Math.round((dataSize / byteRate) * 1000);
  if (sampleRate > 0 && dataSize > 0) return Math.round((dataSize / sampleRate) * 1000);
  return 0;
}

async function runTtsJob(backgroundJob) {
  const input = asObject(backgroundJob.input);
  const apiKey = getText(input.apiKey);
  if (!apiKey) throw new Error('tts apiKey is required');
  const mode = getText(input.mode) || (getText(input.cloneSampleBlobKey) ? 'voiceClone' : 'preset');
  const assistantContent = buildAssistantContent(input.text, input.styleTag, input.audioTag);
  if (!assistantContent) throw new Error('tts text is empty');
  if (mode === 'voiceDesign' && !getText(input.voiceDesignPrompt)) throw new Error('voiceDesignPrompt is required');

  let cloneSampleDataUrl = getText(input.cloneSampleDataUrl);
  if (mode === 'voiceClone') {
    if (!cloneSampleDataUrl) {
      const cloneSampleBlobKey = getText(input.cloneSampleBlobKey);
      if (!cloneSampleBlobKey) throw new Error('voiceClone sample is required');
      cloneSampleDataUrl = mediaToDataUrl(await fetchCloudBuffer(backgroundJob.userId, backgroundJob.projectId, cloneSampleBlobKey));
    }
  }

  const messages = [];
  if (mode === 'voiceDesign') {
    messages.push({ role: 'user', content: sanitizeVoiceDesignPrompt(input.voiceDesignPrompt) });
  } else if (getText(input.userMessage)) {
    messages.push({ role: 'user', content: getText(input.userMessage) });
  }
  messages.push({ role: 'assistant', content: assistantContent });

  const audioVoice = mode === 'voiceDesign'
    ? undefined
    : mode === 'voiceClone'
      ? cloneSampleDataUrl
      : getText(input.voice) || DEFAULT_TTS_PRESET_VOICE;
  const audio = { format: 'wav' };
  if (audioVoice) audio.voice = audioVoice;

  const startedAt = Date.now();
  const response = await fetchWithTimeout(buildTtsApiUrl(input.baseUrl), {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: resolveTtsModel(input.model, mode),
      messages,
      audio,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`TTS request failed (${response.status}): ${text.slice(0, 500) || response.statusText}`);
  }

  const data = await response.json();
  const audioBase64 = data?.choices?.[0]?.message?.audio?.data;
  if (typeof audioBase64 !== 'string' || !audioBase64.trim()) throw new Error('TTS response missing audio data');
  const buffer = Buffer.from(audioBase64, 'base64');
  const durationMs = getWavDurationMs(buffer) || Date.now() - startedAt;
  const outputBlobKey = `background-tts/${backgroundJob.id}.wav`;
  const blob = await putCloudProjectBlobBufferForUser(backgroundJob.userId, backgroundJob.projectId, outputBlobKey, buffer, 'audio/wav');

  return {
    status: 'succeeded',
    progress: {
      phase: 'done',
      durationMs,
      sizeBytes: buffer.length,
      updatedAt: new Date().toISOString(),
    },
    output: {
      blobKey: blob.blobKey || outputBlobKey,
      contentType: 'audio/wav',
      durationMs,
      sizeBytes: buffer.length,
    },
    media: {
      audios: [{
        blobKey: blob.blobKey || outputBlobKey,
        contentType: 'audio/wav',
        durationMs,
        sizeBytes: buffer.length,
      }],
    },
    message: 'TTS background request complete',
  };
}

function createTtsJobHandlers() {
  return {
    'step6-tts': runTtsJob,
  };
}

module.exports = {
  createTtsJobHandlers,
};
