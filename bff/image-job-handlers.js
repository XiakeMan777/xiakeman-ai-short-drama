const {
  createCloudBlobDownloadUrlsForUser,
  getCloudProjectBlobBufferForUser,
  putCloudProjectBlobBufferForUser,
} = require('./cloud-store');
const { updateJob } = require('./background-jobs');
const { isHostnameAllowed, isPrivateHostname } = require('./url-policy');

const IMAGE_JOB_TIMEOUT_MS = Number(process.env.IMAGE_JOB_TIMEOUT_MS || 12 * 60_000);
const IMAGE_HTTP_TIMEOUT_MS = Number(process.env.IMAGE_HTTP_TIMEOUT_MS || 10 * 60_000);
const IMAGE_DOWNLOAD_TIMEOUT_MS = Number(process.env.IMAGE_DOWNLOAD_TIMEOUT_MS || 10 * 60_000);
const IMAGE_UPLOAD_TIMEOUT_MS = Number(process.env.IMAGE_UPLOAD_TIMEOUT_MS || 4 * 60_000);
const APIMART_TASK_POLL_INTERVAL_MS = 4000;
const APIMART_TASK_TIMEOUT_MS = 25 * 60_000;
const XIAKEMAN_ARTLIST_IMAGE_TASK_POLL_INTERVAL_MS = 4000;
const XIAKEMAN_ARTLIST_IMAGE_TASK_TIMEOUT_MS = 25 * 60_000;
const APIMART_COMPLETED_URL_GRACE_MS = 10 * 60_000;
const BACKGROUND_INPUT_READY_RETRY_DELAYS_MS = [500, 1200, 2500, 5000, 8000];
const APIMART_GEMINI_MODEL_ID = 'gemini-3.1-flash-image-preview';
const VOLC_SEEDREAM_5_MODEL_ID = 'doubao-seedream-5-0-260128';
const XIAKEMAN_ARTLIST_IMAGE_API_BASE = 'https://sd2.xiakeman.com/api';
const EXTERNAL_IMAGE_URL_TTL_MS = 24 * 60 * 60 * 1000;
const IMAGE_BASE_URL_ALLOWLIST = (process.env.IMAGE_BASE_URL_ALLOWLIST || process.env.LLM_BASE_URL_ALLOWLIST || '')
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

function getNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
  const limit = Number(timeoutMs);
  if (!Number.isFinite(limit) || limit <= 0) return promise;

  let timer;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), limit);
    }),
  ]);
}

function isAllowedImageBaseUrl(parsed) {
  if (IMAGE_BASE_URL_ALLOWLIST.length === 0) return !IS_PRODUCTION || !isPrivateHostname(parsed.hostname);
  return isHostnameAllowed(parsed.hostname, IMAGE_BASE_URL_ALLOWLIST);
}

function normalizeImageBaseUrl(value) {
  const raw = getText(value) || 'https://api.xiakeman.com/v1';
  const parsed = new URL(raw);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('image api baseUrl must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('image api baseUrl must not include credentials');
  }
  if (!isAllowedImageBaseUrl(parsed)) {
    throw new Error('image api baseUrl is not allowed by BFF policy');
  }
  return parsed.toString().replace(/\/$/, '');
}

function looksLikeOpenAiImagesModel(model) {
  return /^(gpt-image|dall-e|qwen-image|z-image|flux)/i.test(model.trim());
}

function isOpenAiOfficialGptImage2Model(model) {
  return /^gpt-image-2(?:-\d{4}-\d{2}-\d{2})?$/i.test(model.trim());
}

function looksLikeVolcSeedreamModel(model) {
  return /(^|[-_])seedream[-_]?/i.test(model.trim()) || /doubao[-_]seedream/i.test(model.trim());
}

function normalizeVolcSeedreamModelForRequest(model) {
  const trimmed = model.trim();
  const normalized = trimmed.toLowerCase().replace(/_/g, '-');
  const legacyAliases = new Set([
    'doubao-seedream-5.0-lite',
    'doubao-seedream-5-0-lite',
    'doubao-seedream-5-0-lite-260128',
    'seedream-5.0-lite',
    'seedream-5-0-lite',
    'seedream-5-0-lite-260128',
  ]);
  return legacyAliases.has(normalized) ? VOLC_SEEDREAM_5_MODEL_ID : trimmed;
}

function isVolcSeedream5LiteModel(model) {
  const normalized = normalizeVolcSeedreamModelForRequest(model).toLowerCase().replace(/_/g, '-');
  return normalized === VOLC_SEEDREAM_5_MODEL_ID
    || /(^|-)seedream-(5\.0|5-0)-lite($|-)/.test(normalized)
    || /(^|-)seedream5\.0-lite($|-)/.test(normalized)
    || /doubao-seedream-(5\.0|5-0)-lite($|-)/.test(normalized)
    || /doubao-seedream-5-0(?:-lite)?-\d{6}$/.test(normalized);
}

function isApimartGptImage2Model(model) {
  return /^gpt-image-2(?:-official)?$/i.test(model.trim());
}

function isApimartGptImage2OfficialModel(model) {
  return /^gpt-image-2-official$/i.test(model.trim());
}

function isApimartGemini31FlashImageModel(model) {
  return model.trim().toLowerCase() === APIMART_GEMINI_MODEL_ID;
}

function isApimartAsyncImagesModel(baseUrl, model) {
  return /apimart\.ai/i.test(baseUrl) && (isApimartGptImage2Model(model) || isApimartGemini31FlashImageModel(model));
}

function isXiakemanArtlistImageBaseUrl(baseUrl) {
  const normalized = getText(baseUrl);
  return /(?:^|\/\/)sd2\.xiakeman\.com(?:[:/]|$)/i.test(normalized)
    || /(?:^|\/\/)113\.207\.105\.144:8035(?:\/|$)/i.test(normalized)
    || /\/api\/generate-image$/i.test(normalized);
}

function resolveImageApiProtocol(config) {
  const baseUrl = normalizeImageBaseUrl(config.baseUrl);
  const model = getText(config.model);
  if (isXiakemanArtlistImageBaseUrl(baseUrl)) return 'xiakeman-artlist-images';
  if (looksLikeVolcSeedreamModel(model) || /ark\.cn-beijing\.volces\.com/i.test(baseUrl)) return 'volc-seedream-images';
  if (isApimartAsyncImagesModel(baseUrl, model)) return 'apimart-async-images';
  if (/\/images\/generations$/i.test(baseUrl)) return 'openai-images';
  if (/yunwu\.ai/i.test(baseUrl) && looksLikeOpenAiImagesModel(model)) return 'openai-images';
  if (/\/v1(?:\/)?$/i.test(baseUrl) && looksLikeOpenAiImagesModel(model)) return 'openai-images';
  if (/api\.openai\.com/i.test(baseUrl) && looksLikeOpenAiImagesModel(model)) return 'openai-images';
  return 'gemini';
}

function buildOpenAiImagesUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (normalized.endsWith('/images/generations')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/images/generations`;
  return `${normalized}/v1/images/generations`;
}

function buildOpenAiImagesEditsUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (normalized.endsWith('/images/generations')) return normalized.replace(/\/images\/generations$/i, '/images/edits');
  if (normalized.endsWith('/images/edits')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/images/edits`;
  return `${normalized}/v1/images/edits`;
}

function buildVolcSeedreamImagesUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (/\/images\/generations$/i.test(normalized)) return normalized;
  if (/\/api\/v3$/i.test(normalized)) return `${normalized}/images/generations`;
  return `${normalized}/api/v3/images/generations`;
}

function buildApimartImagesUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (normalized.endsWith('/images/generations')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/images/generations`;
  return `${normalized}/v1/images/generations`;
}

function buildApimartTaskUrl(baseUrl, taskId) {
  const normalized = baseUrl.replace(/\/+$/, '').replace(/\/images\/generations$/i, '');
  const taskBase = normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
  return `${taskBase}/tasks/${encodeURIComponent(taskId)}?language=zh`;
}

function normalizeXiakemanArtlistImageApiBaseUrl(baseUrl) {
  const normalized = (getText(baseUrl) || XIAKEMAN_ARTLIST_IMAGE_API_BASE).replace(/\/+$/, '');
  if (/\/api\/generate-image$/i.test(normalized)) return normalized.replace(/\/generate-image$/i, '');
  if (/\/api$/i.test(normalized)) return normalized;
  return `${normalized}/api`;
}

function buildXiakemanArtlistImageSubmitUrl(baseUrl) {
  return `${normalizeXiakemanArtlistImageApiBaseUrl(baseUrl)}/generate-image`;
}

function buildXiakemanArtlistImageTaskUrl(baseUrl, taskId) {
  return `${normalizeXiakemanArtlistImageApiBaseUrl(baseUrl)}/task/${encodeURIComponent(taskId)}`;
}

function normalizeOpenAiCustomSize(size) {
  const normalized = getText(size).toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'auto') return 'auto';
  return /^\d{2,5}x\d{2,5}$/.test(normalized) ? normalized : undefined;
}

function toOpenAiGptImage2Size(ratio, imageSize, customSize) {
  const normalizedCustomSize = normalizeOpenAiCustomSize(customSize);
  if (normalizedCustomSize) return normalizedCustomSize;
  if (imageSize === '4K') {
    if (ratio === 'LANDSCAPE') return '3840x2160';
    if (ratio === 'PORTRAIT') return '2160x3840';
    return '2880x2880';
  }
  if (imageSize === '1K') {
    if (ratio === 'LANDSCAPE') return '1536x1024';
    if (ratio === 'PORTRAIT') return '1024x1536';
    return '1024x1024';
  }
  if (ratio === 'LANDSCAPE') return '2048x1152';
  if (ratio === 'PORTRAIT') return '1152x2048';
  return '2048x2048';
}

function toOpenAiImageSize(model, ratio, imageSize, customSize) {
  const normalizedModel = model.trim().toLowerCase();
  if (isOpenAiOfficialGptImage2Model(model)) return toOpenAiGptImage2Size(ratio, imageSize, customSize);
  if (normalizedModel === 'dall-e-3') {
    if (ratio === 'LANDSCAPE') return '1792x1024';
    if (ratio === 'PORTRAIT') return '1024x1792';
    return '1024x1024';
  }
  if (normalizedModel === 'dall-e-2') return '1024x1024';
  if (normalizedModel.startsWith('qwen-image')) {
    if (ratio === 'LANDSCAPE') return '1664x928';
    if (ratio === 'PORTRAIT') return '928x1664';
    return '1328x1328';
  }
  if (normalizedModel.startsWith('z-image')) {
    if (ratio === 'LANDSCAPE') return '1280x720';
    if (ratio === 'PORTRAIT') return '720x1280';
    return '1024x1024';
  }
  if (normalizedModel.startsWith('flux')) {
    if (ratio === 'LANDSCAPE') return '1536x1024';
    if (ratio === 'PORTRAIT') return '1024x1536';
    return '1024x1024';
  }
  if (ratio === 'LANDSCAPE') return '1536x1024';
  if (ratio === 'PORTRAIT') return '1024x1536';
  return '1024x1024';
}

function toOpenAiImageQuality(imageSize) {
  if (imageSize === '1K') return 'low';
  if (imageSize === '2K') return 'medium';
  if (imageSize === '4K') return 'high';
  return 'auto';
}

function clampOutputCompression(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 100;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function toOpenAiGptImage2Params(config, imageSize) {
  const outputFormat = ['jpeg', 'webp'].includes(config.openaiImageOutputFormat || config.apimartOutputFormat)
    ? (config.openaiImageOutputFormat || config.apimartOutputFormat)
    : 'png';
  const params = {
    quality: config.openaiImageQuality || config.apimartQuality || toOpenAiImageQuality(imageSize),
    background: config.openaiImageBackground || config.apimartBackground || 'auto',
    moderation: config.openaiImageModeration || config.apimartModeration || 'auto',
    output_format: outputFormat,
  };
  if (outputFormat === 'jpeg' || outputFormat === 'webp') {
    params.output_compression = clampOutputCompression(config.openaiImageOutputCompression ?? config.apimartOutputCompression);
  }
  return params;
}

function toVolcSeedreamImageSize(imageSize) {
  return imageSize === '4K' ? '3K' : '2K';
}

function toApimartAspectRatio(ratio) {
  if (ratio === 'LANDSCAPE') return '16:9';
  if (ratio === 'PORTRAIT') return '9:16';
  if (ratio === 'SQUARE') return '1:1';
  return 'auto';
}

function toApimartGptImage2Resolution(ratio, imageSize) {
  if (imageSize === '1K') return '1k';
  if (imageSize === '4K' && (ratio === 'LANDSCAPE' || ratio === 'PORTRAIT')) return '4k';
  return '2k';
}

function toApimartGeminiResolution(imageSize) {
  if (imageSize === '1K' || imageSize === '4K') return imageSize;
  return '2K';
}

function toGeminiAspectRatio(ratio) {
  if (ratio === 'SQUARE') return '1:1';
  return ratio === 'LANDSCAPE' ? '16:9' : '9:16';
}

function normalizeXiakemanArtlistImageModel(model) {
  const normalized = getText(model).toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
  if (!normalized) return 'nano-banana';
  const compact = normalized.replace(/-/g, '');
  if (normalized === 'nano-banana-2' || compact === 'nanobanana2' || compact === 'nanobanana') return 'nano-banana';
  if (normalized === 'google-nano-banana-2') return 'nano-banana';
  if (compact === 'nanobananapro' || normalized === 'google-nano-banana-pro') return 'nano-banana-pro';
  if (/^seedream-?5(?:\.0|-0)?$/.test(normalized) || compact === 'seedream50' || compact === 'seedream5') return 'seedream-5.0';
  if (normalized === 'openai-gpt-image-2' || normalized === 'gpt-image2' || compact === 'gptimage2') return 'gpt-image-2';
  return getText(model);
}

function toXiakemanArtlistImageResolution(model, imageSize) {
  const normalizedModel = normalizeXiakemanArtlistImageModel(model).toLowerCase();
  if (normalizedModel === 'gpt-image-2') return imageSize === '1K' ? 'low' : 'medium';
  if (normalizedModel === 'nano-banana-pro') return imageSize === '1K' ? '1K' : '2K';
  if (normalizedModel === 'seedream-5.0') return imageSize === '4K' ? '4K' : '2K';
  if (imageSize === '1K' || imageSize === '4K') return imageSize;
  return '2K';
}

function getSupportedXiakemanArtlistImageSizes(model) {
  const normalizedModel = normalizeXiakemanArtlistImageModel(model).toLowerCase();
  if (normalizedModel === 'gpt-image-2' || normalizedModel === 'nano-banana-pro') return ['1K', '2K'];
  if (normalizedModel === 'seedream-5.0') return ['2K', '4K'];
  return ['1K', '2K', '4K'];
}

function normalizeImageSizeForXiakemanArtlistModel(model, imageSize) {
  const requested = getText(imageSize) || '1K';
  const supportedSizes = getSupportedXiakemanArtlistImageSizes(model);
  if (supportedSizes.includes(requested)) return requested;
  if (requested === '4K') return supportedSizes[supportedSizes.length - 1] || '2K';
  if (requested === '1K') return supportedSizes[0] || '1K';
  return supportedSizes.includes('2K') ? '2K' : supportedSizes[0] || '1K';
}

function createXiakemanClientTaskId() {
  if (globalThis.crypto?.randomUUID) return `xkm-img-${globalThis.crypto.randomUUID()}`;
  return `xkm-img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toOpenAiOutputMimeType(format) {
  const normalized = getText(format).toLowerCase();
  if (normalized === 'jpeg' || normalized === 'jpg') return 'image/jpeg';
  if (normalized === 'webp') return 'image/webp';
  return 'image/png';
}

function getExtension(contentType) {
  const normalized = getText(contentType).toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('webp')) return 'webp';
  return 'png';
}

function getBlobUploadExtension(media) {
  const type = getText(media.contentType).toLowerCase();
  if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';
  if (type === 'image/webp') return 'webp';
  return 'png';
}

function formatSourceReferencePromptPart(title, label) {
  const text = getText(label);
  return text ? `${title}: ${text}` : '';
}

function formatAdditionalReferencePromptPart(index, label) {
  const text = getText(label);
  return text ? `Reference image ${index + 1}: ${text}` : '';
}

function isTransientFetchError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch|NetworkError|Load failed|fetch failed|timeout|ECONNRESET|ETIMEDOUT/i.test(message);
}

function isTransientHttpStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isRetryableImageGenerationError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /(^|\D)429(\D|$)|too many requests|rate limit|rate-limit|temporar(?:y|ily)|overloaded|try again|upstream|5\d{2}/i.test(message);
}

function parseRetryAfterMs(headers) {
  const value = headers?.get?.('retry-after');
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(180_000, seconds * 1000);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.min(180_000, Math.max(0, dateMs - Date.now()));
  return 0;
}

function getImageHttpRetryDelayMs(response, attempt) {
  const retryAfterMs = parseRetryAfterMs(response.headers);
  if (retryAfterMs > 0) return retryAfterMs;
  if (response.status === 429) {
    return Math.min(180_000, (2 ** attempt) * 8000 + Math.random() * 3000);
  }
  if (response.status >= 500 && response.status < 600) {
    return Math.min(180_000, (2 ** attempt) * 12_000 + Math.random() * 5000);
  }
  return Math.min(45_000, (attempt + 1) * 3000);
}

function abortableDelay(ms, signal) {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason || new Error('Aborted'));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(signal.reason || new Error('Aborted'));
    }, { once: true });
  });
}

async function fetchWithTimeout(input, init = {}, timeoutMs = IMAGE_HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithTransientRetry(input, init, timeoutMs = IMAGE_HTTP_TIMEOUT_MS) {
  const delays = [0, 1200, 3000];
  let lastError;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      if (attempt > 0) await abortableDelay(delays[attempt - 1]);
      return await fetchWithTimeout(input, init, timeoutMs);
    } catch (error) {
      lastError = error;
      if (!isTransientFetchError(error) || attempt >= delays.length) throw error;
    }
  }
  throw lastError;
}

async function fetchBufferFromUrl(url, timeoutMs = IMAGE_DOWNLOAD_TIMEOUT_MS) {
  const response = await fetchWithTransientRetry(url, { method: 'GET' }, timeoutMs);
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Image download failed: ${response.status} ${errorText.slice(0, 200)}`);
  }
  const contentType = response.headers.get('content-type') || 'image/png';
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType,
  };
}

async function loadCloudMedia(userId, projectId, blobKey) {
  let payload;
  for (let attempt = 0; attempt <= BACKGROUND_INPUT_READY_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      payload = await createCloudBlobDownloadUrlsForUser(userId, projectId, [blobKey]);
      break;
    } catch (error) {
      const isBackgroundInput = /^background-image-inputs\//.test(String(blobKey || ''));
      const isNotReady = /Cloud blob not found/i.test(String(error?.message || error));
      const needsInternalRead = /Direct (cloud transfer|download) requires Tencent COS object storage/i.test(String(error?.message || error));
      if (needsInternalRead) {
        const media = await getCloudProjectBlobBufferForUser(userId, projectId, blobKey);
        return {
          buffer: media.buffer,
          contentType: media.contentType || 'image/png',
          blobKey,
        };
      }
      if (!isBackgroundInput || !isNotReady || attempt >= BACKGROUND_INPUT_READY_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await sleep(BACKGROUND_INPUT_READY_RETRY_DELAYS_MS[attempt]);
    }
  }
  const item = asArray(payload.blobs)[0];
  const url = item?.download?.url;
  if (!url) throw new Error(`Cloud blob is missing download url for ${blobKey}`);
  const media = await fetchBufferFromUrl(url);
  return {
    ...media,
    blobKey,
  };
}

async function loadInputMedia(backgroundJob) {
  const input = asObject(backgroundJob.input);
  const projectId = backgroundJob.projectId;
  const sourceBlobKey = getText(input.sourceBlobKey);
  const maskBlobKey = getText(input.maskBlobKey);
  const referenceBlobKeys = asArray(input.referenceBlobKeys).map(getText).filter(Boolean);

  const source = sourceBlobKey ? await loadCloudMedia(backgroundJob.userId, projectId, sourceBlobKey) : undefined;
  const mask = maskBlobKey ? await loadCloudMedia(backgroundJob.userId, projectId, maskBlobKey) : undefined;
  const references = [];
  for (const blobKey of referenceBlobKeys) {
    references.push(await loadCloudMedia(backgroundJob.userId, projectId, blobKey));
  }
  return { source, mask, references };
}

function mediaToBlob(media) {
  return new Blob([media.buffer], { type: media.contentType || 'image/png' });
}

function mediaToDataUri(media) {
  return `data:${media.contentType || 'image/png'};base64,${media.buffer.toString('base64')}`;
}

function mediaToXiakemanBase64Object(media, index) {
  return {
    data: mediaToDataUri(media),
    filename: `reference-${index + 1}.${getBlobUploadExtension(media)}`,
    mime_type: media.contentType || 'image/png',
  };
}

function mergeJobProgress(backgroundJob, progress) {
  return {
    ...asObject(backgroundJob.progress),
    ...progress,
  };
}

async function parseOpenAiImagesPayload(payload) {
  let image = payload?.data?.[0];
  if (!image) {
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      try {
        const parsed = JSON.parse(content);
        image = parsed?.data?.[0] ?? parsed;
      } catch {
        image = content.startsWith('http') ? { url: content } : null;
      }
    }
  }
  if (!image) throw new Error('OpenAI Images API returned no image data');
  if (image.b64_json) {
    return {
      buffer: Buffer.from(image.b64_json, 'base64'),
      contentType: toOpenAiOutputMimeType(image.output_format ?? payload.output_format),
    };
  }
  if (image.url) {
    const downloaded = await fetchBufferFromUrl(image.url);
    return {
      ...downloaded,
      externalImageUrl: image.url,
      externalImageExpiresAt: Date.now() + EXTERNAL_IMAGE_URL_TTL_MS,
    };
  }
  throw new Error('OpenAI Images response missing b64_json or url');
}

function getFirstGeneratedImage(payload) {
  if (!payload || typeof payload !== 'object') return undefined;
  const topLevelData = payload.data;
  if (Array.isArray(topLevelData)) return topLevelData[0];
  if (topLevelData && typeof topLevelData === 'object') {
    if (Array.isArray(topLevelData.data)) return topLevelData.data[0];
    if (topLevelData.url || topLevelData.b64_json || topLevelData.error) return topLevelData;
  }
  return undefined;
}

async function parseVolcSeedreamPayload(payload, model) {
  const image = getFirstGeneratedImage(payload);
  if (!image) throw new Error('Seedream image API returned no image data');
  if (image.error) throw new Error(`Seedream image generation failed: ${image.error.message || JSON.stringify(image.error).slice(0, 200)}`);
  if (image.b64_json) {
    return {
      buffer: Buffer.from(image.b64_json, 'base64'),
      contentType: 'image/png',
      sourceProvider: isVolcSeedream5LiteModel(model) ? 'volc_seedream' : undefined,
      sourceModel: isVolcSeedream5LiteModel(model) ? model : undefined,
    };
  }
  if (image.url) {
    const downloaded = await fetchBufferFromUrl(image.url);
    return {
      ...downloaded,
      externalImageUrl: image.url,
      externalImageExpiresAt: Date.now() + EXTERNAL_IMAGE_URL_TTL_MS,
      sourceProvider: isVolcSeedream5LiteModel(model) ? 'volc_seedream' : undefined,
      sourceModel: isVolcSeedream5LiteModel(model) ? model : undefined,
    };
  }
  throw new Error('Seedream image response missing b64_json or url');
}

function parseGeminiImagePayload(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part?.inlineData?.data) {
      return {
        buffer: Buffer.from(part.inlineData.data, 'base64'),
        contentType: part.inlineData.mimeType || 'image/png',
      };
    }
  }
  const textContent = parts.filter((part) => part?.text).map((part) => part.text).join('\n');
  if (textContent) throw new Error(`Image model returned text instead of image: ${textContent.slice(0, 300)}`);
  throw new Error('Gemini image response missing inline image data');
}

function getStringField(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function getNestedRecord(record, key) {
  const value = record?.[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function getApimartTaskRecord(data) {
  if (!data || typeof data !== 'object') return {};
  const payload = data.data;
  if (Array.isArray(payload)) return payload[0] && typeof payload[0] === 'object' ? payload[0] : {};
  if (payload && typeof payload === 'object') return payload;
  return data;
}

function getApimartTaskStatus(task) {
  return (getStringField(task, ['status', 'task_status', 'state', 'phase']) || '').toLowerCase();
}

function getFirstUrlFromUnknown(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = getFirstUrlFromUnknown(item);
      if (url) return url;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  return getStringField(value, ['url', 'image_url', 'imageUrl'])
    || getFirstUrlFromUnknown(value.urls)
    || getFirstUrlFromUnknown(value.images)
    || getFirstUrlFromUnknown(value.image_urls)
    || getFirstUrlFromUnknown(value.output);
}

function getApimartCompletedTaskImageUrl(task) {
  const result = getNestedRecord(task, 'result');
  const output = getNestedRecord(task, 'output');
  return getFirstUrlFromUnknown(task.images)
    || getFirstUrlFromUnknown(task.image_urls)
    || getFirstUrlFromUnknown(task.url)
    || getFirstUrlFromUnknown(task.image_url)
    || getFirstUrlFromUnknown(result?.images)
    || getFirstUrlFromUnknown(result?.image_urls)
    || getFirstUrlFromUnknown(result?.url)
    || getFirstUrlFromUnknown(result?.image_url)
    || getFirstUrlFromUnknown(output?.images)
    || getFirstUrlFromUnknown(output?.image_urls)
    || getFirstUrlFromUnknown(output?.url)
    || getFirstUrlFromUnknown(output?.image_url);
}

function isApimartCompletedStatus(status) {
  return ['completed', 'succeeded', 'success', 'done', 'finished'].includes(status);
}

function isApimartFailedStatus(status) {
  return ['failed', 'failure', 'error'].includes(status);
}

function isApimartCancelledStatus(status) {
  return ['cancelled', 'canceled', 'cancel'].includes(status);
}

function getApimartTaskErrorMessage(task) {
  const nestedError = getNestedRecord(task, 'error');
  return getStringField(task, ['error', 'error_message', 'message'])
    || (nestedError ? getStringField(nestedError, ['message', 'error', 'error_message']) : undefined)
    || 'task failed';
}

async function pollApimartImageTask(baseUrl, apiKey, taskId, backgroundJob, context) {
  const taskUrl = buildApimartTaskUrl(baseUrl, taskId);
  const startedAt = Date.now();
  let completedWithoutUrlSince = 0;

  while (true) {
    const response = await fetchWithTransientRetry(taskUrl, {
      method: 'GET',
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    }, IMAGE_HTTP_TIMEOUT_MS);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      if (isTransientHttpStatus(response.status) && Date.now() - startedAt < APIMART_TASK_TIMEOUT_MS) {
        await abortableDelay(APIMART_TASK_POLL_INTERVAL_MS);
        continue;
      }
      throw new Error(`APIMart image task polling failed: ${response.status} ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const task = getApimartTaskRecord(data);
    const status = getApimartTaskStatus(task);
    const imageUrl = getApimartCompletedTaskImageUrl(task);

    await updateJob(backgroundJob.userId, backgroundJob.id, {
      status: 'running',
      progress: mergeJobProgress(backgroundJob, {
        phase: 'remote-polling',
        taskId,
        status: status || 'running',
        updatedAt: new Date().toISOString(),
      }),
    }).catch(() => undefined);
    await context.heartbeat?.().catch(() => undefined);

    if (imageUrl && (!status || isApimartCompletedStatus(status))) {
      const downloaded = await fetchBufferFromUrl(imageUrl);
      return {
        ...downloaded,
        externalImageUrl: imageUrl,
        externalImageExpiresAt: Date.now() + EXTERNAL_IMAGE_URL_TTL_MS,
      };
    }

    if (isApimartCompletedStatus(status)) {
      completedWithoutUrlSince ||= Date.now();
      if (Date.now() - completedWithoutUrlSince >= APIMART_COMPLETED_URL_GRACE_MS) {
        throw new Error('APIMart task completed but did not return an image URL in time');
      }
      await abortableDelay(APIMART_TASK_POLL_INTERVAL_MS);
      continue;
    }

    if (isApimartFailedStatus(status)) throw new Error(`APIMart image generation failed: ${getApimartTaskErrorMessage(task)}`);
    if (isApimartCancelledStatus(status)) throw new Error('APIMart image generation task was cancelled');
    if (Date.now() - startedAt >= APIMART_TASK_TIMEOUT_MS) throw new Error('APIMart image generation exceeded 25 minutes');

    await abortableDelay(APIMART_TASK_POLL_INTERVAL_MS);
  }
}

function getXiakemanArtlistTaskRecord(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const task = payload.task;
  if (task && typeof task === 'object' && !Array.isArray(task)) return { ...payload, ...task };
  const data = payload.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) return { ...payload, ...data };
  return payload;
}

function getXiakemanArtlistTaskId(payload) {
  const task = getXiakemanArtlistTaskRecord(payload);
  return getStringField(task, ['task_id', 'taskId', 'id']);
}

function getXiakemanArtlistTaskStatus(payload) {
  const task = getXiakemanArtlistTaskRecord(payload);
  return (getStringField(task, ['status', 'task_status', 'state', 'phase']) || '').toLowerCase();
}

function getXiakemanArtlistTaskError(payload) {
  const task = getXiakemanArtlistTaskRecord(payload);
  const nestedError = getNestedRecord(task, 'error');
  return getStringField(task, ['error_message', 'message', 'error'])
    || (nestedError ? getStringField(nestedError, ['message', 'error_message', 'detail']) : undefined)
    || '图片生成失败';
}

function getXiakemanArtlistImageUrl(payload) {
  const task = getXiakemanArtlistTaskRecord(payload);
  const output = getNestedRecord(task, 'output');
  const result = getNestedRecord(task, 'result');
  return getStringField(task, ['image_url', 'output_url', 'stable_image_url', 'official_image_url', 'url'])
    || (output ? getStringField(output, ['image_url', 'output_url', 'url']) : undefined)
    || (result ? getStringField(result, ['image_url', 'output_url', 'url']) : undefined);
}

async function pollXiakemanArtlistImageTask(baseUrl, apiKey, taskId, backgroundJob, context) {
  const taskUrl = buildXiakemanArtlistImageTaskUrl(baseUrl, taskId);
  const startedAt = Date.now();

  while (true) {
    const response = await fetchWithTransientRetry(taskUrl, {
      method: 'GET',
      headers: {
        ...(apiKey ? { 'X-License-Key': apiKey } : {}),
      },
    }, IMAGE_HTTP_TIMEOUT_MS);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      if (isTransientHttpStatus(response.status) && Date.now() - startedAt < XIAKEMAN_ARTLIST_IMAGE_TASK_TIMEOUT_MS) {
        await abortableDelay(XIAKEMAN_ARTLIST_IMAGE_TASK_POLL_INTERVAL_MS);
        continue;
      }
      throw new Error(`XiaKeMan image task polling failed: ${response.status} ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const task = getXiakemanArtlistTaskRecord(data);
    const status = getXiakemanArtlistTaskStatus(data);
    const imageUrl = getXiakemanArtlistImageUrl(data);
    const progress = getNumber(task.progress, 0);

    await updateJob(backgroundJob.userId, backgroundJob.id, {
      status: 'running',
      progress: mergeJobProgress(backgroundJob, {
        phase: 'remote-polling',
        protocol: 'xiakeman-artlist-images',
        taskId,
        status: status || 'running',
        progress,
        updatedAt: new Date().toISOString(),
      }),
    }).catch(() => undefined);
    await context.heartbeat?.().catch(() => undefined);

    if (imageUrl && (!status || ['success', 'succeeded', 'completed', 'complete', 'done'].includes(status))) {
      const downloaded = await fetchBufferFromUrl(imageUrl);
      return {
        ...downloaded,
        externalImageUrl: imageUrl,
        externalImageExpiresAt: Date.now() + EXTERNAL_IMAGE_URL_TTL_MS,
      };
    }

    if (['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(status)) {
      throw new Error(`XiaKeMan image generation failed: ${getXiakemanArtlistTaskError(data)}`);
    }
    if (Date.now() - startedAt >= XIAKEMAN_ARTLIST_IMAGE_TASK_TIMEOUT_MS) {
      throw new Error('XiaKeMan image generation exceeded 25 minutes');
    }

    await abortableDelay(XIAKEMAN_ARTLIST_IMAGE_TASK_POLL_INTERVAL_MS);
  }
}

async function uploadApimartImage(baseUrl, apiKey, media, index) {
  const normalized = baseUrl.replace(/\/+$/, '').replace(/\/images\/generations$/i, '');
  const uploadBase = normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
  const formData = new FormData();
  formData.append('file', mediaToBlob(media), `image-${index + 1}.${getBlobUploadExtension(media)}`);
  const response = await fetchWithTransientRetry(`${uploadBase}/uploads/images`, {
    method: 'POST',
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: formData,
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`APIMart image upload failed: ${response.status} ${errorText.slice(0, 200)}`);
  }
  const data = await response.json();
  const imageUrl = data.url || data.data?.url;
  if (typeof imageUrl !== 'string' || !imageUrl.trim()) throw new Error('APIMart image upload returned no URL');
  return imageUrl;
}

async function executeImageRequest(backgroundJob, context) {
  const input = asObject(backgroundJob.input);
  const config = asObject(input.config);
  const apiKey = getText(config.apiKey);
  if (!apiKey) throw new Error('image apiConfig.apiKey is required');
  const baseUrl = normalizeImageBaseUrl(config.baseUrl);
  const model = getText(config.model) || 'gpt-image-2';
  const protocol = resolveImageApiProtocol(config);
  const prompt = getText(input.prompt);
  if (!prompt) throw new Error('image prompt is required');
  const aspectRatio = getText(input.aspectRatio);
  const imageSize = getText(input.imageSize || config.defaultImageSize) || '1K';
  const media = await loadInputMedia(backgroundJob);
  const source = media.source;
  const references = media.references;
  const mask = media.mask;
  const referenceLabels = asArray(input.referenceLabels).map(getText);
  const sourceLabel = getText(input.sourceLabel);

  await updateJob(backgroundJob.userId, backgroundJob.id, {
    status: 'running',
    progress: mergeJobProgress(backgroundJob, {
      phase: 'submitting',
      protocol,
      referenceCount: references.length + (source ? 1 : 0),
      updatedAt: new Date().toISOString(),
    }),
  }).catch(() => undefined);

  let url = '';
  let body;
  let headers = {};
  let responseSourceModel = model;

  if (protocol === 'xiakeman-artlist-images') {
    url = buildXiakemanArtlistImageSubmitUrl(baseUrl);
    const requestModel = normalizeXiakemanArtlistImageModel(model);
    const requestImageSize = normalizeImageSizeForXiakemanArtlistModel(requestModel, imageSize);
    responseSourceModel = requestModel;
    const promptParts = [prompt];
    if (sourceLabel) promptParts.unshift(formatSourceReferencePromptPart('Primary reference image note', sourceLabel));
    const referenceLines = referenceLabels
      .slice(0, 13)
      .map((label, index) => formatAdditionalReferencePromptPart(index, label))
      .filter(Boolean);
    if (referenceLines.length) promptParts.push(referenceLines.join('\n'));
    const imageMedia = [...(source ? [source] : []), ...references].slice(0, 14);
    body = JSON.stringify({
      client_task_id: createXiakemanClientTaskId(),
      prompt: promptParts.join('\n\n'),
      model: requestModel,
      resolution: toXiakemanArtlistImageResolution(requestModel, requestImageSize),
      ratio: toGeminiAspectRatio(aspectRatio),
      ...(imageMedia.length ? { images_base64: imageMedia.map(mediaToXiakemanBase64Object) } : {}),
    });
    headers = { 'Content-Type': 'application/json' };
  } else if (protocol === 'volc-seedream-images') {
    url = buildVolcSeedreamImagesUrl(baseUrl);
    const requestModel = normalizeVolcSeedreamModelForRequest(model);
    responseSourceModel = requestModel;
    const promptParts = [prompt];
    if (sourceLabel) promptParts.unshift(formatSourceReferencePromptPart('Primary reference image note', sourceLabel));
    const referenceLines = referenceLabels
      .map((label, index) => formatAdditionalReferencePromptPart(index, label))
      .filter(Boolean);
    if (referenceLines.length) promptParts.push(referenceLines.join('\n'));
    const imageInputs = [];
    if (source) imageInputs.push(mediaToDataUri(source));
    for (const reference of references) imageInputs.push(mediaToDataUri(reference));
    body = JSON.stringify({
      model: requestModel,
      prompt: promptParts.join('\n\n'),
      size: toVolcSeedreamImageSize(imageSize),
      response_format: 'b64_json',
      watermark: false,
      sequential_image_generation: 'disabled',
      ...(isVolcSeedream5LiteModel(requestModel) ? { output_format: 'png' } : {}),
      ...(imageInputs.length === 1 ? { image: imageInputs[0] } : {}),
      ...(imageInputs.length > 1 ? { image: imageInputs } : {}),
    });
    headers = { 'Content-Type': 'application/json' };
  } else if (protocol === 'apimart-async-images') {
    url = buildApimartImagesUrl(baseUrl);
    const promptParts = [prompt];
    if (sourceLabel) promptParts.unshift(formatSourceReferencePromptPart('Primary reference image note', sourceLabel));
    const imageMedia = [...(source ? [source] : []), ...references].slice(0, isApimartGemini31FlashImageModel(model) ? 14 : 16);
    const cappedReferenceLabelCount = Math.max(0, imageMedia.length - (source ? 1 : 0));
    const referenceLines = referenceLabels
      .slice(0, cappedReferenceLabelCount)
      .map((label, index) => formatAdditionalReferencePromptPart(index, label))
      .filter(Boolean);
    if (referenceLines.length) promptParts.push(referenceLines.join('\n'));
    const imageUrls = [];
    for (let index = 0; index < imageMedia.length; index += 1) {
      imageUrls.push(await uploadApimartImage(baseUrl, apiKey, imageMedia[index], index));
    }
    const apimartBody = {
      model,
      prompt: promptParts.join('\n\n'),
      n: 1,
      size: toApimartAspectRatio(aspectRatio),
      resolution: isApimartGemini31FlashImageModel(model)
        ? toApimartGeminiResolution(imageSize)
        : toApimartGptImage2Resolution(aspectRatio, imageSize),
      ...(imageUrls.length ? { image_urls: imageUrls } : {}),
    };
    if (isApimartGptImage2OfficialModel(model)) {
      apimartBody.quality = config.apimartQuality || 'auto';
      apimartBody.background = config.apimartBackground || 'auto';
      apimartBody.moderation = config.apimartModeration || 'auto';
      apimartBody.output_format = config.apimartOutputFormat || 'png';
      apimartBody.output_compression = clampOutputCompression(config.apimartOutputCompression);
      if (getText(config.apimartMaskUrl)) apimartBody.mask_url = getText(config.apimartMaskUrl);
    }
    if (isApimartGemini31FlashImageModel(model)) {
      apimartBody.model = APIMART_GEMINI_MODEL_ID;
      if (typeof config.apimartGoogleSearch === 'boolean' || config.apimartGoogleImageSearch) {
        apimartBody.google_search = config.apimartGoogleSearch || !!config.apimartGoogleImageSearch;
      }
      if (typeof config.apimartGoogleImageSearch === 'boolean') {
        apimartBody.google_image_search = config.apimartGoogleImageSearch;
      }
    }
    body = JSON.stringify(apimartBody);
    headers = { 'Content-Type': 'application/json' };
  } else if (protocol === 'openai-images') {
    const isEditsRequest = !!(source || references.length || mask);
    const requestedImageSize = imageSize || config.defaultImageSize;
    const isOfficialGptImage2 = isOpenAiOfficialGptImage2Model(model);
    const openAiImageSize = toOpenAiImageSize(model, aspectRatio, requestedImageSize, config.openaiImageSize);
    const officialGptImage2Params = isOfficialGptImage2 ? toOpenAiGptImage2Params(config, requestedImageSize) : undefined;
    if (isEditsRequest) {
      const formData = new FormData();
      const promptParts = [prompt];
      const imageFieldName = isOfficialGptImage2 ? 'image[]' : 'image';
      if (sourceLabel) promptParts.unshift(formatSourceReferencePromptPart('Primary image reference note', sourceLabel));
      const referenceLines = referenceLabels.map((label, index) => formatAdditionalReferencePromptPart(index, label)).filter(Boolean);
      if (referenceLines.length) promptParts.push(referenceLines.join('\n'));
      if (source) formData.append(imageFieldName, mediaToBlob(source), `image-1.${getBlobUploadExtension(source)}`);
      references.forEach((reference, index) => {
        formData.append(imageFieldName, mediaToBlob(reference), `image-${index + 2}.${getBlobUploadExtension(reference)}`);
      });
      if (mask) formData.append('mask', mediaToBlob(mask), `mask.${getBlobUploadExtension(mask)}`);
      formData.append('prompt', promptParts.join('\n\n'));
      formData.append('model', model);
      formData.append('n', '1');
      formData.append('size', openAiImageSize);
      if (officialGptImage2Params) {
        Object.entries(officialGptImage2Params).forEach(([key, value]) => formData.append(key, String(value)));
      } else {
        formData.append('quality', toOpenAiImageQuality(requestedImageSize));
      }
      url = buildOpenAiImagesEditsUrl(baseUrl);
      body = formData;
    } else {
      url = buildOpenAiImagesUrl(baseUrl);
      body = JSON.stringify({
        model,
        prompt,
        size: openAiImageSize,
        ...(officialGptImage2Params || { quality: toOpenAiImageQuality(requestedImageSize) }),
        n: 1,
        ...(model.trim().toLowerCase().startsWith('dall-e') ? { response_format: 'b64_json' } : {}),
      });
      headers = { 'Content-Type': 'application/json' };
    }
  } else {
    const parts = [{ text: prompt }];
    if (source) {
      if (sourceLabel) parts.push({ text: formatSourceReferencePromptPart('Primary reference image note', sourceLabel) });
      parts.push({ inlineData: { mimeType: source.contentType || 'image/jpeg', data: source.buffer.toString('base64') } });
    }
    references.forEach((reference, index) => {
      parts.push({ text: formatAdditionalReferencePromptPart(index, referenceLabels[index]) || `Reference image ${index + 1}` });
      parts.push({ inlineData: { mimeType: reference.contentType || 'image/jpeg', data: reference.buffer.toString('base64') } });
    });
    body = JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: toGeminiAspectRatio(aspectRatio),
          imageSize,
        },
      },
    });
    url = `${baseUrl}/v1beta/models/${model}:generateContent`;
    headers = { 'Content-Type': 'application/json' };
  }

  const maxRetries = 5;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetchWithTransientRetry(url, {
      method: 'POST',
      headers: {
        ...headers,
        ...(protocol === 'xiakeman-artlist-images'
          ? (apiKey ? { 'X-License-Key': apiKey } : {})
          : (apiKey ? { Authorization: `Bearer ${apiKey}` } : {})),
      },
      body,
    }, IMAGE_JOB_TIMEOUT_MS);
    if (response.ok) {
      try {
        if (protocol === 'xiakeman-artlist-images') {
          const payload = await response.json();
          const taskId = getXiakemanArtlistTaskId(payload);
          const imageUrl = getXiakemanArtlistImageUrl(payload);
          const status = getXiakemanArtlistTaskStatus(payload);
          if (imageUrl && ['success', 'succeeded', 'completed', 'complete', 'done'].includes(status)) {
            const downloaded = await fetchBufferFromUrl(imageUrl);
            return {
              ...downloaded,
              externalImageUrl: imageUrl,
              externalImageExpiresAt: Date.now() + EXTERNAL_IMAGE_URL_TTL_MS,
            };
          }
          if (!taskId) throw new Error('XiaKeMan image API returned no task_id');
          return await pollXiakemanArtlistImageTask(baseUrl, apiKey, taskId, backgroundJob, context);
        }
        if (protocol === 'apimart-async-images') {
          const data = await response.json();
          const taskId = data?.data?.[0]?.task_id || data?.data?.task_id;
          if (!taskId || typeof taskId !== 'string') throw new Error('APIMart returned no task_id');
          return await pollApimartImageTask(baseUrl, apiKey, taskId, backgroundJob, context);
        }
        const payload = await response.json();
        if (protocol === 'volc-seedream-images') return parseVolcSeedreamPayload(payload, responseSourceModel);
        if (protocol === 'openai-images') return parseOpenAiImagesPayload(payload);
        return parseGeminiImagePayload(payload);
      } catch (error) {
        lastError = error;
        if (isRetryableImageGenerationError(error) && attempt < maxRetries) {
          await context.event?.({
            level: 'retry',
            phase: 'image-upstream-retry',
            message: '图片上游繁忙或限流，后台已保留任务并退避重试',
            data: { attempt: attempt + 1, maxRetries, error: error instanceof Error ? error.message : String(error) },
          }).catch(() => undefined);
          await abortableDelay(getImageHttpRetryDelayMs({ status: /429|too many requests|rate limit/i.test(String(error?.message || error)) ? 429 : 503, headers: new Headers() }, attempt));
          continue;
        }
        throw error;
      }
    }
    const errorText = await response.text().catch(() => '');
    lastError = new Error(`Image generation failed: ${response.status} ${errorText.slice(0, 500)}`);
    if (isTransientHttpStatus(response.status) && attempt < maxRetries) {
      await context.event?.({
        level: 'retry',
        phase: response.status === 429 ? 'image-rate-limit' : 'image-http-retry',
        message: response.status === 429
          ? '图片上游限流，后台正在等待后重试'
          : `图片上游返回 ${response.status}，后台正在重试`,
        data: { status: response.status, attempt: attempt + 1, maxRetries },
      }).catch(() => undefined);
      await abortableDelay(getImageHttpRetryDelayMs(response, attempt));
      continue;
    }
    throw lastError;
  }
  throw lastError;
}

async function runImageGenerationJob(backgroundJob, context = {}) {
  const startedAt = Date.now();
  const result = await executeImageRequest(backgroundJob, context);
  const contentType = result.contentType || 'image/png';
  const extension = getExtension(contentType);
  const outputBlobKey = `background-images/${backgroundJob.id}.${extension}`;

  await updateJob(backgroundJob.userId, backgroundJob.id, {
    status: 'running',
    progress: mergeJobProgress(backgroundJob, {
      phase: 'uploading',
      contentType,
      sizeBytes: result.buffer.length,
      updatedAt: new Date().toISOString(),
    }),
  }).catch(() => undefined);

  const blob = await withTimeout(
    putCloudProjectBlobBufferForUser(
      backgroundJob.userId,
      backgroundJob.projectId,
      outputBlobKey,
      result.buffer,
      contentType,
    ),
    IMAGE_UPLOAD_TIMEOUT_MS,
    `Image upload timed out after ${Math.round(IMAGE_UPLOAD_TIMEOUT_MS / 1000)} seconds`,
  );

  return {
    status: 'succeeded',
    progress: mergeJobProgress(backgroundJob, {
      phase: 'done',
      contentType,
      sizeBytes: result.buffer.length,
      durationMs: Date.now() - startedAt,
      updatedAt: new Date().toISOString(),
    }),
    output: {
      blobKey: blob.blobKey || outputBlobKey,
      contentType,
      sizeBytes: result.buffer.length,
      externalImageUrl: result.externalImageUrl,
      externalImageExpiresAt: result.externalImageExpiresAt,
      sourceProvider: result.sourceProvider,
      sourceModel: result.sourceModel,
    },
    media: {
      images: [{
        blobKey: blob.blobKey || outputBlobKey,
        contentType,
        sizeBytes: result.buffer.length,
      }],
    },
    message: 'Image background request complete',
  };
}

function createImageJobHandlers() {
  return {
    'image-generations': runImageGenerationJob,
  };
}

module.exports = {
  createImageJobHandlers,
  runImageGenerationJob,
};
