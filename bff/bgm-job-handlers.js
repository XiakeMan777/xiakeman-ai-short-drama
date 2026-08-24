const { putCloudProjectBlobBufferForUser } = require('./cloud-store');
const { isHostnameAllowed, isPrivateHostname } = require('./url-policy');

const DEFAULT_MUSIC_BASE_URL = 'https://api.minimaxi.com';
const BGM_REQUEST_TIMEOUT_MS = 20 * 60_000;
const MUSIC_BASE_URL_ALLOWLIST = (process.env.MUSIC_BASE_URL_ALLOWLIST || process.env.LLM_BASE_URL_ALLOWLIST || '')
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

function isAllowedMusicBaseUrl(parsed) {
  if (MUSIC_BASE_URL_ALLOWLIST.length === 0) return !IS_PRODUCTION || !isPrivateHostname(parsed.hostname);
  return isHostnameAllowed(parsed.hostname, MUSIC_BASE_URL_ALLOWLIST);
}

function normalizeMusicBaseUrl(value) {
  const raw = getText(value) || DEFAULT_MUSIC_BASE_URL;
  const parsed = new URL(raw);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('music baseUrl must use http or https');
  if (parsed.username || parsed.password) throw new Error('music baseUrl must not include credentials');
  if (!isAllowedMusicBaseUrl(parsed)) throw new Error('music baseUrl is not allowed by BFF policy');
  return parsed.toString().replace(/\/+$/, '');
}

async function fetchWithTimeout(url, init = {}, timeoutMs = BGM_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Music request timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function hexToBuffer(hex) {
  const clean = getText(hex);
  if (!/^[a-fA-F0-9]+$/.test(clean)) throw new Error('Invalid hex audio payload');
  return Buffer.from(clean, 'hex');
}

async function downloadAudio(url) {
  const response = await fetchWithTimeout(url, { method: 'GET' });
  if (!response.ok) throw new Error(`Failed to download BGM audio: ${response.status}`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'audio/mpeg',
  };
}

async function runBgmJob(backgroundJob) {
  const input = asObject(backgroundJob.input);
  const musicApiConfig = asObject(input.musicApiConfig);
  const bgmAnalysis = asObject(input.bgmAnalysis);
  const apiKey = getText(musicApiConfig.apiKey);
  if (!apiKey) throw new Error('music apiKey is required');
  const prompt = getText(bgmAnalysis.prompt || input.prompt);
  if (!prompt) throw new Error('BGM prompt is required');

  const outputFormat = getText(input.outputFormat) || 'url';
  const response = await fetchWithTimeout(`${normalizeMusicBaseUrl(musicApiConfig.baseUrl)}/v1/music_generation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getText(musicApiConfig.model) || 'music-2.6-free',
      prompt,
      is_instrumental: input.isInstrumental !== false,
      output_format: outputFormat,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Music generation failed (${response.status}): ${text.slice(0, 500) || response.statusText}`);
  }

  const data = await response.json();
  if (data.base_resp?.status_code !== 0) {
    throw new Error(`Music generation API error: ${data.base_resp?.status_msg || JSON.stringify(data).slice(0, 500)}`);
  }
  if (data.data?.status !== 2) {
    throw new Error(`Music generation returned unfinished status: ${JSON.stringify(data).slice(0, 500)}`);
  }

  const audioUrl = data.data.audio_url || data.data.audio;
  if (!audioUrl) throw new Error('Music generation succeeded but no audio URL found');
  const media = outputFormat === 'hex' && typeof audioUrl === 'string'
    ? { buffer: hexToBuffer(audioUrl), contentType: 'audio/mpeg' }
    : await downloadAudio(String(audioUrl));
  const durationMs = Number(data.extra_info?.music_duration || 0);
  const outputBlobKey = `background-bgm/${backgroundJob.id}.mp3`;
  const blob = await putCloudProjectBlobBufferForUser(
    backgroundJob.userId,
    backgroundJob.projectId,
    outputBlobKey,
    media.buffer,
    media.contentType,
  );

  return {
    status: 'succeeded',
    progress: {
      phase: 'done',
      durationMs,
      sizeBytes: media.buffer.length,
      updatedAt: new Date().toISOString(),
    },
    output: {
      blobKey: blob.blobKey || outputBlobKey,
      contentType: media.contentType,
      durationMs,
      taskId: data.trace_id || backgroundJob.id,
      title: getText(bgmAnalysis.title) || 'BGM',
      style: getText(bgmAnalysis.style),
    },
    media: {
      audios: [{
        blobKey: blob.blobKey || outputBlobKey,
        contentType: media.contentType,
        durationMs,
        sizeBytes: media.buffer.length,
      }],
    },
    message: 'BGM background request complete',
  };
}

function createBgmJobHandlers() {
  return {
    'step6-bgm': runBgmJob,
  };
}

module.exports = {
  createBgmJobHandlers,
};
