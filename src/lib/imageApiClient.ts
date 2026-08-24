// ============================================================
// 图片生成 API 客户端
// 支持：
// - Gemini generateContent 原生格式（文生图 / 图生图 / 多图参考）
// - OpenAI Images `/v1/images/generations` 风格返回格式（当前仅文生图）
// ============================================================

import type { ImageApiConfig, ImageConcept, ImageSize } from '@/types';
import type { VideoApiConfig } from '@/types';
import { chatCompleteStream } from '@/lib/api-client';
import {
  DEFAULT_SEEDANCE_CLOUD_API_BASE,
  getSeedanceCloudLicenseKey,
} from '@/lib/seedanceApi';
import { sanitizeCharacterAssetPromptText, sanitizeLegacyLiveActionPromptText } from '@/lib/characterAssetGuards';
import { inferCharacterGenderHint, type CharacterGenderHint } from '@/lib/characterIdentityHints';
import {
  cancelBackgroundJob,
  createBackgroundJob,
  getBackgroundJob,
  listBackgroundJobs,
  retryBackgroundJob,
  type BackgroundJob,
} from '@/lib/backgroundJobsClient';
import {
  createCloudProjectBlobDownloadUrl,
  uploadCloudProjectBlobViaServer,
} from '@/lib/cloudProjectStore';

type AspectRatio = 'PORTRAIT' | 'LANDSCAPE' | 'SQUARE';

interface GenerateImageOptions {
  prompt: string;
  aspectRatio?: AspectRatio;
  /** 图片分辨率，不传则使用 config.defaultImageSize，再 fallback 2K */
  imageSize?: ImageSize;
  /** 图生图时的源图 Blob */
  sourceBlob?: Blob;
  /** 图生图源图说明，帮助多模态模型绑定图片身份 */
  sourceLabel?: string;
  /** 多图参考生成时的参考图 */
  referenceBlobs?: Blob[];
  /** 多图参考说明，顺序必须与 referenceBlobs 一致 */
  referenceLabels?: string[];
  /** OpenAI Images edits 的可选蒙版 */
  maskBlob?: Blob;
  /** 取消请求 */
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
  onRemoteImageUrl?: (url: string) => void;
  background?: {
    projectId?: string;
    chapterId?: string;
    storyboardIndex?: number;
    namespace?: string;
    enabled?: boolean;
    requireBackend?: boolean;
  };
}

interface GenerateImageResult {
  blob: Blob;
  externalImageUrl?: string;
  externalImageExpiresAt?: number;
  sourceProvider?: 'volc_seedream';
  sourceModel?: string;
}

type ImageApiProtocol = 'gemini' | 'openai-images' | 'apimart-async-images' | 'volc-seedream-images' | 'xiakeman-artlist-images';

const APIMART_TASK_POLL_INTERVAL_MS = 4000;
const APIMART_TASK_TIMEOUT_MS = 20 * 60 * 1000;
const XIAKEMAN_ARTLIST_IMAGE_TASK_POLL_INTERVAL_MS = 4000;
const XIAKEMAN_ARTLIST_IMAGE_TASK_TIMEOUT_MS = 25 * 60 * 1000;
const BACKGROUND_IMAGE_POLL_INTERVAL_MS = 1500;
const BACKGROUND_IMAGE_WAIT_TIMEOUT_MS = 40 * 60 * 1000;
const BACKGROUND_IMAGE_INPUT_READY_RETRY_DELAYS_MS = [300, 800, 1600, 3000, 5000] as const;
const EXTERNAL_IMAGE_URL_TTL_MS = 24 * 60 * 60 * 1000;
const APIMART_GEMINI_MODEL_ID = 'gemini-3.1-flash-image-preview';
const TRANSIENT_FETCH_RETRY_DELAYS_MS = [0, 1200, 3000];
const REFERENCE_UPLOAD_OPTIMIZE_MIN_BYTES = 512 * 1024;
const REFERENCE_UPLOAD_OPTIMIZE_MIN_SAVING_RATIO = 0.98;
const IMAGE_PROMPT_OPTIMIZE_STREAM_IDLE_TIMEOUT_MS = 300_000;
const IMAGE_PROMPT_OPTIMIZE_STREAM_IDLE_TIMEOUT_MESSAGE = '图片 prompt 润色流式生成已超过 300 秒没有模型输出或思考活动，请检查模型连接后重试。';

export const XIAKEMAN_ARTLIST_IMAGE_API_BASE = DEFAULT_SEEDANCE_CLOUD_API_BASE;
export const XIAKEMAN_ARTLIST_IMAGE_MODELS = [
  'nano-banana',
  'nano-banana-pro',
  'seedream-5.0',
  'gpt-image-2',
] as const;

// ---------- Helpers ----------

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBlob(b64: string, mimeType: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/** 将内部 AspectRatio 枚举转换为 Gemini API 的宽高比字符串 */
function toGeminiAspectRatio(ratio?: AspectRatio): string {
  if (ratio === 'SQUARE') return '1:1';
  return ratio === 'LANDSCAPE' ? '16:9' : '9:16';
}

function looksLikeOpenAiImagesModel(model: string): boolean {
  return /^(gpt-image|dall-e|qwen-image|z-image|flux)/i.test(model.trim());
}

function isOpenAiOfficialGptImage2Model(model: string): boolean {
  return /^gpt-image-2(?:-\d{4}-\d{2}-\d{2})?$/i.test(model.trim());
}

function looksLikeVolcSeedreamModel(model: string): boolean {
  return /(^|[-_])seedream[-_]?/i.test(model.trim()) || /doubao[-_]seedream/i.test(model.trim());
}

const VOLC_SEEDREAM_5_MODEL_ID = 'doubao-seedream-5-0-260128';

function normalizeVolcSeedreamModelForRequest(model: string): string {
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

function isVolcSeedream5LiteModel(model: string): boolean {
  const normalized = normalizeVolcSeedreamModelForRequest(model).toLowerCase().replace(/_/g, '-');
  return normalized === VOLC_SEEDREAM_5_MODEL_ID
    || /(^|-)seedream-(5\.0|5-0)-lite($|-)/.test(normalized)
    || /(^|-)seedream5\.0-lite($|-)/.test(normalized)
    || /doubao-seedream-(5\.0|5-0)-lite($|-)/.test(normalized)
    || /doubao-seedream-5-0(?:-lite)?-\d{6}$/.test(normalized);
}

function isApimartGptImage2Model(model: string): boolean {
  return /^gpt-image-2(?:-official)?$/i.test(model.trim());
}

function isApimartGptImage2OfficialModel(model: string): boolean {
  return /^gpt-image-2-official$/i.test(model.trim());
}

function isApimartGemini31FlashImageModel(model: string): boolean {
  return model.trim().toLowerCase() === APIMART_GEMINI_MODEL_ID;
}

function isApimartAsyncImagesModel(baseUrl: string, model: string): boolean {
  if (!/apimart\.ai/i.test(baseUrl)) return false;
  return isApimartGptImage2Model(model) || isApimartGemini31FlashImageModel(model);
}

export function isXiakemanArtlistImageBaseUrl(baseUrl: string | undefined): boolean {
  const normalized = (baseUrl || '').trim();
  return /(?:^|\/\/)sd2\.xiakeman\.com(?:[:/]|$)/i.test(normalized)
    || /(?:^|\/\/)113\.207\.105\.144:8035(?:\/|$)/i.test(normalized)
    || /\/api\/generate-image$/i.test(normalized);
}

export function isXiakemanArtlistImageConfig(config: Pick<ImageApiConfig, 'baseUrl'> | undefined): boolean {
  return isXiakemanArtlistImageBaseUrl(config?.baseUrl);
}

export function getEffectiveImageApiKey(
  config: Pick<ImageApiConfig, 'apiKey' | 'baseUrl'> | undefined,
  videoApiConfig?: Pick<VideoApiConfig, 'seedanceCloudLicenseKey' | 'seedanceCloudUserId'>,
): string {
  const imageKey = (config?.apiKey || '').trim();
  if (imageKey) return imageKey;
  return isXiakemanArtlistImageConfig(config) ? getSeedanceCloudLicenseKey(videoApiConfig) : '';
}

export function hasEffectiveImageApiKey(
  config: Pick<ImageApiConfig, 'apiKey' | 'baseUrl'> | undefined,
  videoApiConfig?: Pick<VideoApiConfig, 'seedanceCloudLicenseKey' | 'seedanceCloudUserId'>,
): boolean {
  return !!getEffectiveImageApiKey(config, videoApiConfig);
}

export function getSupportedImageSizesForConfig(
  config: Pick<ImageApiConfig, 'baseUrl' | 'model'> | undefined,
): ImageSize[] {
  if (!isXiakemanArtlistImageConfig(config)) return ['1K', '2K', '4K'];

  const model = normalizeXiakemanArtlistImageModel(config?.model || 'nano-banana').toLowerCase();
  if (model === 'nano-banana-pro' || model === 'gpt-image-2') return ['1K', '2K'];
  if (model === 'seedream-5.0') return ['2K', '4K'];
  return ['1K', '2K', '4K'];
}

export function normalizeImageSizeForConfig(
  config: Pick<ImageApiConfig, 'baseUrl' | 'model' | 'defaultImageSize'> | undefined,
  imageSize?: ImageSize,
  fallback: ImageSize = '1K',
): ImageSize {
  const supportedSizes = getSupportedImageSizesForConfig(config);
  const preferred = imageSize ?? config?.defaultImageSize ?? fallback;
  if (supportedSizes.includes(preferred)) return preferred;
  if (preferred === '4K') return supportedSizes[supportedSizes.length - 1] ?? fallback;
  if (preferred === '1K') return supportedSizes[0] ?? fallback;
  return supportedSizes.includes('2K') ? '2K' : supportedSizes[0] ?? fallback;
}

function getNormalizedBlobType(blob: Blob): string {
  return blob.type.trim().toLowerCase();
}

function canOptimizeReferenceForUpload(blob: Blob): boolean {
  return getNormalizedBlobType(blob) === 'image/png' && blob.size >= REFERENCE_UPLOAD_OPTIMIZE_MIN_BYTES;
}

function canUseCanvasImageReencode(): boolean {
  return typeof document !== 'undefined'
    && typeof document.createElement === 'function'
    && typeof createImageBitmap === 'function';
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas image export failed'));
    }, type);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

async function maybeOptimizeReferenceImageBlob(blob: Blob, label: string, signal?: AbortSignal): Promise<Blob> {
  if (!canOptimizeReferenceForUpload(blob) || !canUseCanvasImageReencode()) return blob;

  throwIfAborted(signal);
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    throwIfAborted(signal);

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0);

    const optimized = await canvasToBlob(canvas, 'image/png');
    throwIfAborted(signal);

    if (
      optimized.size > 0
      && optimized.size < blob.size
      && optimized.size <= blob.size * REFERENCE_UPLOAD_OPTIMIZE_MIN_SAVING_RATIO
    ) {
      if (import.meta.env.DEV) {
        console.info(`[Image] 参考图体积优化 ${label}: ${formatBytes(blob.size)} -> ${formatBytes(optimized.size)}`);
      }
      return optimized;
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(`[Image] 参考图体积优化跳过 ${label}: ${getErrorMessage(error)}`);
    }
  } finally {
    bitmap?.close();
  }

  return blob;
}

async function prepareReferenceImageBlobsForUpload(
  sourceBlob: Blob | undefined,
  referenceBlobs: Blob[] | undefined,
  signal?: AbortSignal,
): Promise<{ sourceBlob?: Blob; referenceBlobs?: Blob[] }> {
  const optimizedSourceBlob = sourceBlob
    ? await maybeOptimizeReferenceImageBlob(sourceBlob, 'source', signal)
    : undefined;

  if (!referenceBlobs?.length) {
    return { sourceBlob: optimizedSourceBlob, referenceBlobs };
  }

  const optimizedReferenceBlobs: Blob[] = [];
  for (let index = 0; index < referenceBlobs.length; index += 1) {
    optimizedReferenceBlobs.push(
      await maybeOptimizeReferenceImageBlob(referenceBlobs[index], `reference-${index + 1}`, signal),
    );
  }

  return { sourceBlob: optimizedSourceBlob, referenceBlobs: optimizedReferenceBlobs };
}

function resolveImageApiProtocol(config: ImageApiConfig): ImageApiProtocol {
  const baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
  if (isXiakemanArtlistImageBaseUrl(baseUrl)) {
    return 'xiakeman-artlist-images';
  }
  if (looksLikeVolcSeedreamModel(config.model || '') || /ark\.cn-beijing\.volces\.com/i.test(baseUrl)) {
    return 'volc-seedream-images';
  }
  if (isApimartAsyncImagesModel(baseUrl, config.model || '')) return 'apimart-async-images';
  if (/\/images\/generations$/i.test(baseUrl)) return 'openai-images';
  if (/yunwu\.ai/i.test(baseUrl) && looksLikeOpenAiImagesModel(config.model || '')) return 'openai-images';
  if (/\/v1(?:\/)?$/i.test(baseUrl) && looksLikeOpenAiImagesModel(config.model || '')) return 'openai-images';
  if (/api\.openai\.com/i.test(baseUrl) && looksLikeOpenAiImagesModel(config.model || '')) return 'openai-images';
  return 'gemini';
}

function buildOpenAiImagesUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (normalized.endsWith('/images/generations')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/images/generations`;
  return `${normalized}/v1/images/generations`;
}

function buildOpenAiImagesEditsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (normalized.endsWith('/images/generations')) {
    return normalized.replace(/\/images\/generations$/i, '/images/edits');
  }
  if (normalized.endsWith('/images/edits')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/images/edits`;
  return `${normalized}/v1/images/edits`;
}

function buildVolcSeedreamImagesUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (/\/images\/generations$/i.test(normalized)) return normalized;
  if (/\/api\/v3$/i.test(normalized)) return `${normalized}/images/generations`;
  return `${normalized}/api/v3/images/generations`;
}

function buildApimartImagesUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (normalized.endsWith('/images/generations')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/images/generations`;
  return `${normalized}/v1/images/generations`;
}

function buildApimartTaskUrl(baseUrl: string, taskId: string): string {
  const normalized = baseUrl.replace(/\/+$/, '').replace(/\/images\/generations$/i, '');
  const taskBase = normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
  return `${taskBase}/tasks/${taskId}?language=zh`;
}

function normalizeXiakemanArtlistImageApiBaseUrl(baseUrl: string): string {
  const normalized = (baseUrl || XIAKEMAN_ARTLIST_IMAGE_API_BASE).trim().replace(/\/+$/, '');
  if (/\/api\/generate-image$/i.test(normalized)) return normalized.replace(/\/generate-image$/i, '');
  if (/\/api$/i.test(normalized)) return normalized;
  return `${normalized}/api`;
}

function buildXiakemanArtlistImageSubmitUrl(baseUrl: string): string {
  return `${normalizeXiakemanArtlistImageApiBaseUrl(baseUrl)}/generate-image`;
}

function buildXiakemanArtlistImageTaskUrl(baseUrl: string, taskId: string): string {
  return `${normalizeXiakemanArtlistImageApiBaseUrl(baseUrl)}/task/${encodeURIComponent(taskId)}`;
}

function normalizeOpenAiCustomSize(size?: string): string | undefined {
  const normalized = size?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'auto') return 'auto';
  return /^\d{2,5}x\d{2,5}$/.test(normalized) ? normalized : undefined;
}

function toOpenAiGptImage2Size(ratio?: AspectRatio, imageSize?: ImageSize, customSize?: string): string {
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

function toOpenAiImageSize(model: string, ratio?: AspectRatio, imageSize?: ImageSize, customSize?: string): string {
  const normalizedModel = model.trim().toLowerCase();
  if (isOpenAiOfficialGptImage2Model(model)) {
    return toOpenAiGptImage2Size(ratio, imageSize, customSize);
  }
  if (normalizedModel === 'dall-e-3') {
    if (ratio === 'LANDSCAPE') return '1792x1024';
    if (ratio === 'PORTRAIT') return '1024x1792';
    return '1024x1024';
  }
  if (normalizedModel === 'dall-e-2') {
    return '1024x1024';
  }
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

function toOpenAiImageQuality(imageSize?: ImageSize): 'low' | 'medium' | 'high' | 'auto' {
  if (imageSize === '1K') return 'low';
  if (imageSize === '2K') return 'medium';
  if (imageSize === '4K') return 'high';
  return 'auto';
}

function toOpenAiGptImage2Background(config: ImageApiConfig): 'auto' | 'opaque' {
  const configured = config.openaiImageBackground ?? config.apimartBackground;
  return configured === 'opaque' ? 'opaque' : 'auto';
}

function toOpenAiGptImage2OutputFormat(config: ImageApiConfig): 'png' | 'jpeg' | 'webp' {
  const configured = config.openaiImageOutputFormat ?? config.apimartOutputFormat;
  return configured === 'jpeg' || configured === 'webp' ? configured : 'png';
}

function buildOpenAiGptImage2Params(
  config: ImageApiConfig,
  imageSize?: ImageSize,
): Record<string, string | number> {
  const outputFormat = toOpenAiGptImage2OutputFormat(config);
  const params: Record<string, string | number> = {
    quality: config.openaiImageQuality ?? config.apimartQuality ?? toOpenAiImageQuality(imageSize),
    background: toOpenAiGptImage2Background(config),
    moderation: config.openaiImageModeration ?? config.apimartModeration ?? 'auto',
    output_format: outputFormat,
  };

  if (outputFormat === 'jpeg' || outputFormat === 'webp') {
    params.output_compression = clampApimartOutputCompression(
      config.openaiImageOutputCompression ?? config.apimartOutputCompression,
    );
  }

  return params;
}

function appendOpenAiGptImage2Params(formData: FormData, params: Record<string, string | number>): void {
  Object.entries(params).forEach(([key, value]) => {
    formData.append(key, String(value));
  });
}

function toVolcSeedreamImageSize(imageSize?: ImageSize): '2K' | '3K' {
  return imageSize === '4K' ? '3K' : '2K';
}

function toApimartAspectRatio(ratio?: AspectRatio): string {
  if (ratio === 'LANDSCAPE') return '16:9';
  if (ratio === 'PORTRAIT') return '9:16';
  if (ratio === 'SQUARE') return '1:1';
  return 'auto';
}

function toApimartGptImage2Resolution(ratio?: AspectRatio, imageSize?: ImageSize): '1k' | '2k' | '4k' {
  if (imageSize === '1K') return '1k';
  if (imageSize === '4K' && (ratio === 'LANDSCAPE' || ratio === 'PORTRAIT')) return '4k';
  return '2k';
}

function toApimartGeminiResolution(imageSize?: ImageSize): '1K' | '2K' | '4K' {
  if (imageSize === '1K' || imageSize === '4K') return imageSize;
  return '2K';
}

function normalizeXiakemanArtlistImageModel(model: string): string {
  const normalized = model.trim().toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
  if (!normalized) return 'nano-banana';
  const compact = normalized.replace(/-/g, '');
  if (normalized === 'nano-banana-2' || compact === 'nanobanana2' || compact === 'nanobanana') return 'nano-banana';
  if (normalized === 'google-nano-banana-2') return 'nano-banana';
  if (compact === 'nanobananapro' || normalized === 'google-nano-banana-pro') return 'nano-banana-pro';
  if (/^seedream-?5(?:\.0|-0)?$/.test(normalized) || compact === 'seedream50' || compact === 'seedream5') return 'seedream-5.0';
  if (normalized === 'openai-gpt-image-2' || normalized === 'gpt-image2' || compact === 'gptimage2') return 'gpt-image-2';
  return model.trim();
}

function toXiakemanArtlistImageResolution(model: string, imageSize?: ImageSize): '1K' | '2K' | '4K' | 'low' | 'medium' {
  const normalizedModel = normalizeXiakemanArtlistImageModel(model).toLowerCase();
  if (normalizedModel === 'gpt-image-2') {
    return imageSize === '1K' ? 'low' : 'medium';
  }
  if (normalizedModel === 'nano-banana-pro') {
    return imageSize === '1K' ? '1K' : '2K';
  }
  if (normalizedModel === 'seedream-5.0') {
    return imageSize === '4K' ? '4K' : '2K';
  }
  if (imageSize === '1K' || imageSize === '4K') return imageSize;
  return '2K';
}

function createXiakemanClientTaskId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `xkm-img-${crypto.randomUUID()}`;
  }
  return `xkm-img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function toXiakemanImageBase64Object(blob: Blob, index: number) {
  return {
    data: await blobToDataUri(blob),
    filename: `reference-${index + 1}.${getBlobUploadExtension(blob)}`,
    mime_type: blob.type || 'image/png',
  };
}

function getApimartImageUrlLimit(model: string): number {
  return isApimartGemini31FlashImageModel(model) ? 14 : 16;
}

function clampApimartOutputCompression(value?: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 100;
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function fetchImageBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Image download failed: ${response.status} ${errorText.slice(0, 200)}`);
  }
  return response.blob();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransientFetchError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return /Failed to fetch|NetworkError|Load failed|fetch failed|timeout|ECONNRESET|ETIMEDOUT/i.test(message);
}

function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function fetchWithTransientRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= TRANSIENT_FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
    throwIfAborted(signal);
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      if (!isTransientFetchError(error) || attempt >= TRANSIENT_FETCH_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await abortableDelay(TRANSIENT_FETCH_RETRY_DELAYS_MS[attempt], signal);
    }
  }
  throw lastError;
}

function buildImageProxyUrl(url: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.origin === window.location.origin) return null;
    return `/api/proxy/image?url=${encodeURIComponent(url)}`;
  } catch {
    return null;
  }
}

async function fetchImageFromUrl(url: string, signal?: AbortSignal): Promise<Blob> {
  try {
    return await fetchImageBlob(url, signal);
  } catch (directError) {
    const proxyUrl = buildImageProxyUrl(url);
    if (!proxyUrl) throw directError;

    try {
      return await fetchImageBlob(proxyUrl, signal);
    } catch (proxyError) {
      throw new Error(
        `Image download failed: ${getErrorMessage(directError)}; proxy failed: ${getErrorMessage(proxyError)}`,
      );
    }
  }
}

async function blobToDataUri(blob: Blob): Promise<string> {
  const base64 = await blobToBase64(blob);
  return `data:${blob.type || 'image/png'};base64,${base64}`;
}

function getBlobUploadExtension(blob: Blob): 'jpg' | 'png' | 'webp' {
  const type = getNormalizedBlobType(blob);
  if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';
  if (type === 'image/webp') return 'webp';
  return 'png';
}

async function uploadApimartImage(
  baseUrl: string,
  apiKey: string,
  blob: Blob,
  index: number,
  signal?: AbortSignal,
): Promise<string> {
  const normalized = baseUrl.replace(/\/+$/, '').replace(/\/images\/generations$/i, '');
  const uploadBase = normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
  const formData = new FormData();
  const extension = getBlobUploadExtension(blob);

  formData.append('file', blob, `image-${index + 1}.${extension}`);

  const response = await fetchWithTransientRetry(`${uploadBase}/uploads/images`, {
    method: 'POST',
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: formData,
    signal,
  }, signal);

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`APIMart 图片上传失败: ${response.status} ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const imageUrl = data.url ?? data.data?.url;
  if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
    throw new Error('APIMart 图片上传未返回 URL');
  }

  return imageUrl;
}

async function parseGeminiImageResponse(response: Response): Promise<GenerateImageResult> {
  const data = await response.json();

  const candidates = data.candidates;
  if (!candidates?.length) {
    throw new Error('API 未返回 candidates，请检查模型是否支持图片生成');
  }

  const allParts = candidates[0]?.content?.parts ?? [];
  for (const part of allParts) {
    if (part.inlineData?.data) {
      const mimeType = part.inlineData.mimeType || 'image/png';
      return { blob: base64ToBlob(part.inlineData.data, mimeType) };
    }
  }

  const textContent = allParts
    .filter((p: { text?: string }) => p.text)
    .map((p: { text?: string }) => p.text)
    .join('\n');
  if (textContent) {
    throw new Error(`模型未返回图片，返回内容: ${textContent.slice(0, 300)}`);
  }

  throw new Error('返回数据缺少图片 base64 数据，请检查 API 返回格式');
}

function toOpenAiOutputMimeType(format?: string): string {
  const normalized = format?.trim().toLowerCase();
  if (normalized === 'jpeg' || normalized === 'jpg') return 'image/jpeg';
  if (normalized === 'webp') return 'image/webp';
  return 'image/png';
}

async function parseOpenAiImagesResponse(response: Response, signal?: AbortSignal): Promise<GenerateImageResult> {
  const data = await response.json();
  let image = data.data?.[0];

  if (!image) {
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      try {
        const parsed = JSON.parse(content);
        image = parsed.data?.[0] ?? parsed;
      } catch {
        image = content.startsWith('http') ? { url: content } : null;
      }
    }
  }

  if (!image) {
    throw new Error('OpenAI Images API 未返回 data[0]，请检查返回格式');
  }

  if (image.b64_json) {
    return { blob: base64ToBlob(image.b64_json, toOpenAiOutputMimeType(image.output_format ?? data.output_format)) };
  }

  if (image.url) {
    return { blob: await fetchImageFromUrl(image.url, signal) };
  }

  throw new Error('OpenAI Images 返回数据缺少 b64_json 或 url');
}

function getFirstGeneratedImage(data: unknown): { url?: string; b64_json?: string; error?: { message?: string } } | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  const topLevelData = record.data;
  if (Array.isArray(topLevelData)) return topLevelData[0] as { url?: string; b64_json?: string; error?: { message?: string } };
  if (topLevelData && typeof topLevelData === 'object') {
    const nested = topLevelData as Record<string, unknown>;
    if (Array.isArray(nested.data)) return nested.data[0] as { url?: string; b64_json?: string; error?: { message?: string } };
    if (nested.url || nested.b64_json || nested.error) {
      return nested as { url?: string; b64_json?: string; error?: { message?: string } };
    }
  }
  return undefined;
}

async function parseVolcSeedreamImagesResponse(
  response: Response,
  model: string,
  signal?: AbortSignal,
): Promise<GenerateImageResult> {
  const data = await response.json();
  const image = getFirstGeneratedImage(data);

  if (!image) {
    throw new Error('Seedream 图片 API 未返回 data[0]，请检查返回格式');
  }
  if (image.error) {
    throw new Error(`Seedream 图片生成失败: ${image.error.message || JSON.stringify(image.error).slice(0, 200)}`);
  }
  if (image.b64_json) {
    return { blob: base64ToBlob(image.b64_json, 'image/png') };
  }
  if (image.url) {
    const createdAt = Date.now();
    const result: GenerateImageResult = {
      blob: await fetchImageFromUrl(image.url, signal),
      externalImageUrl: image.url,
      externalImageExpiresAt: createdAt + EXTERNAL_IMAGE_URL_TTL_MS,
    };
    if (isVolcSeedream5LiteModel(model)) {
      result.sourceProvider = 'volc_seedream';
      result.sourceModel = model;
    }
    return result;
  }

  throw new Error('Seedream 图片 API 返回数据缺少 b64_json 或 url');
}

function getApimartCompletedImageUrl(image: unknown): string | undefined {
  if (typeof image === 'string') return image;
  if (!image || typeof image !== 'object') return undefined;
  const url = (image as { url?: unknown }).url;
  if (typeof url === 'string') return url;
  if (Array.isArray(url) && typeof url[0] === 'string') return url[0];
  return undefined;
}

async function pollApimartImageTask(
  baseUrl: string,
  apiKey: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<GenerateImageResult> {
  const taskUrl = buildApimartTaskUrl(baseUrl, taskId);
  const startedAt = Date.now();

  while (true) {
    throwIfAborted(signal);
    const response = await fetchWithTransientRetry(taskUrl, {
      method: 'GET',
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal,
    }, signal);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      if (isTransientHttpStatus(response.status) && Date.now() - startedAt < APIMART_TASK_TIMEOUT_MS) {
        console.warn(`[Image] APIMart task polling returned ${response.status}; keep polling instead of failing the submitted task.`);
        await abortableDelay(APIMART_TASK_POLL_INTERVAL_MS, signal);
        continue;
      }
      throw new Error(`APIMart 任务查询失败: ${response.status} ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const task = data.data;
    const status = String(task?.status ?? '').toLowerCase();

    if (status === 'completed') {
      const imageUrl = getApimartCompletedImageUrl(task?.result?.images?.[0]);
      if (!imageUrl || typeof imageUrl !== 'string') {
        throw new Error('APIMart 任务已完成，但未返回图片 URL');
      }
      return { blob: await fetchImageFromUrl(imageUrl, signal) };
    }

    if (status === 'failed') {
      const errorMessage = task?.error?.message || '任务失败';
      throw new Error(`APIMart 图像生成失败: ${errorMessage}`);
    }

    if (status === 'cancelled') {
      throw new Error('APIMart 图像生成任务已取消');
    }

    if (Date.now() - startedAt >= APIMART_TASK_TIMEOUT_MS) {
      throw new Error('APIMart 图像生成超过 20 分钟未完成，请稍后重试；gpt-image-2 多参考图长任务可能非常慢，请勿过早中断');
    }

    await abortableDelay(APIMART_TASK_POLL_INTERVAL_MS, signal);
  }
}

async function parseApimartAsyncImagesResponse(
  response: Response,
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<GenerateImageResult> {
  const data = await response.json();
  const taskId = data.data?.[0]?.task_id ?? data.data?.task_id;

  if (!taskId || typeof taskId !== 'string') {
    throw new Error('APIMart 未返回 task_id，请检查返回格式');
  }

  return pollApimartImageTask(baseUrl, apiKey, taskId, signal);
}

function getStringFromRecord(record: unknown, keys: string[]): string | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const data = record as Record<string, unknown>;
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function getXiakemanArtlistTaskRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const record = payload as Record<string, unknown>;
  const task = record.task;
  if (task && typeof task === 'object' && !Array.isArray(task)) {
    return { ...record, ...(task as Record<string, unknown>) };
  }
  const data = record.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return { ...record, ...(data as Record<string, unknown>) };
  }
  return record;
}

function getXiakemanArtlistTaskId(payload: unknown): string | undefined {
  const task = getXiakemanArtlistTaskRecord(payload);
  return getStringFromRecord(task, ['task_id', 'taskId', 'id']);
}

function getXiakemanArtlistTaskStatus(payload: unknown): string {
  const task = getXiakemanArtlistTaskRecord(payload);
  return (getStringFromRecord(task, ['status', 'task_status', 'state', 'phase']) || '').toLowerCase();
}

function getXiakemanArtlistTaskError(payload: unknown): string {
  const task = getXiakemanArtlistTaskRecord(payload);
  const nestedError = task.error && typeof task.error === 'object' ? task.error : undefined;
  return getStringFromRecord(task, ['error_message', 'message', 'error'])
    || getStringFromRecord(nestedError, ['message', 'error_message', 'detail'])
    || '图片生成失败';
}

function getXiakemanArtlistImageUrl(payload: unknown): string | undefined {
  const task = getXiakemanArtlistTaskRecord(payload);
  return getStringFromRecord(task, ['image_url', 'output_url', 'stable_image_url', 'official_image_url', 'url'])
    || getStringFromRecord(task.output, ['image_url', 'output_url', 'url'])
    || getStringFromRecord(task.result, ['image_url', 'output_url', 'url']);
}

async function pollXiakemanArtlistImageTask(
  baseUrl: string,
  apiKey: string,
  taskId: string,
  options: Pick<GenerateImageOptions, 'signal' | 'onStatus' | 'onRemoteImageUrl'>,
): Promise<GenerateImageResult> {
  const taskUrl = buildXiakemanArtlistImageTaskUrl(baseUrl, taskId);
  const startedAt = Date.now();

  while (true) {
    throwIfAborted(options.signal);
    const response = await fetchWithTransientRetry(taskUrl, {
      method: 'GET',
      headers: {
        ...(apiKey ? { 'X-License-Key': apiKey } : {}),
      },
      signal: options.signal,
    }, options.signal);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      if (isTransientHttpStatus(response.status) && Date.now() - startedAt < XIAKEMAN_ARTLIST_IMAGE_TASK_TIMEOUT_MS) {
        options.onStatus?.(`虾客漫图片任务查询暂时不可用，${Math.round(XIAKEMAN_ARTLIST_IMAGE_TASK_POLL_INTERVAL_MS / 1000)} 秒后重试...`);
        await abortableDelay(XIAKEMAN_ARTLIST_IMAGE_TASK_POLL_INTERVAL_MS, options.signal);
        continue;
      }
      throw new Error(`虾客漫图片任务查询失败: ${response.status} ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const status = getXiakemanArtlistTaskStatus(data);
    const progress = getXiakemanArtlistTaskRecord(data).progress;
    const progressText = typeof progress === 'number' && Number.isFinite(progress) ? ` ${Math.round(progress)}%` : '';
    const imageUrl = getXiakemanArtlistImageUrl(data);

    if (imageUrl && (!status || ['success', 'succeeded', 'completed', 'complete', 'done'].includes(status))) {
      options.onRemoteImageUrl?.(imageUrl);
      return {
        blob: await fetchImageFromUrl(imageUrl, options.signal),
        externalImageUrl: imageUrl,
        externalImageExpiresAt: Date.now() + EXTERNAL_IMAGE_URL_TTL_MS,
      };
    }

    if (['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(status)) {
      throw new Error(`虾客漫图片生成失败: ${getXiakemanArtlistTaskError(data)}`);
    }

    if (Date.now() - startedAt >= XIAKEMAN_ARTLIST_IMAGE_TASK_TIMEOUT_MS) {
      throw new Error('虾客漫图片生成超过 25 分钟未完成，请稍后在任务历史中查看或重试');
    }

    options.onStatus?.(`虾客漫图片生成中${progressText}...`);
    await abortableDelay(XIAKEMAN_ARTLIST_IMAGE_TASK_POLL_INTERVAL_MS, options.signal);
  }
}

function createAbortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function stableBackgroundJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableBackgroundJson(item)).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableBackgroundJson((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

async function sha256Text(text: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeBackgroundSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'image';
}

async function uploadBackgroundImageInput(
  projectId: string,
  namespace: string,
  blob: Blob | undefined,
  label: string,
): Promise<string | undefined> {
  if (!blob) return undefined;
  const digest = await sha256Text(await blobToBase64(blob));
  const extension = blob.type.includes('webp') ? 'webp' : blob.type.includes('jpeg') || blob.type.includes('jpg') ? 'jpg' : 'png';
  const blobKey = `background-image-inputs/${digest}-${sanitizeBackgroundSegment(namespace)}-${sanitizeBackgroundSegment(label)}.${extension}`;
  await uploadCloudProjectBlobViaServer(projectId, blobKey, blob);
  for (let attempt = 0; attempt <= BACKGROUND_IMAGE_INPUT_READY_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await createCloudProjectBlobDownloadUrl(projectId, blobKey);
      return blobKey;
    } catch (error) {
      if (attempt >= BACKGROUND_IMAGE_INPUT_READY_RETRY_DELAYS_MS.length) throw error;
      await abortableDelay(BACKGROUND_IMAGE_INPUT_READY_RETRY_DELAYS_MS[attempt], undefined);
    }
  }
  return blobKey;
}

async function waitForBackgroundImageJob(
  jobId: string,
  options: GenerateImageOptions,
): Promise<GenerateImageResult> {
  const startedAt = Date.now();
  let job: BackgroundJob | undefined;
  try {
    while (true) {
      throwIfAborted(options.signal);
      if (Date.now() - startedAt > BACKGROUND_IMAGE_WAIT_TIMEOUT_MS) {
        throw new Error('Background image generation timed out while waiting for completion.');
      }
      const response = await getBackgroundJob(jobId);
      job = response.job;
      const phase = typeof job.progress?.phase === 'string' ? job.progress.phase : job.status;
      options.onStatus?.(`Background image: ${phase}`);
      if (job.status === 'succeeded') {
        const blobKey = typeof job.output?.blobKey === 'string' ? job.output.blobKey : '';
        if (!blobKey) throw new Error('Background image job completed without blobKey');
        const url = await createCloudProjectBlobDownloadUrl(job.projectId, blobKey);
        const blob = await fetchImageFromUrl(url, options.signal);
        const externalImageUrl = typeof job.output?.externalImageUrl === 'string' ? job.output.externalImageUrl : undefined;
        if (externalImageUrl) options.onRemoteImageUrl?.(externalImageUrl);
        return {
          blob,
          externalImageUrl,
          externalImageExpiresAt: typeof job.output?.externalImageExpiresAt === 'number' ? job.output.externalImageExpiresAt : undefined,
          sourceProvider: job.output?.sourceProvider === 'volc_seedream' ? 'volc_seedream' : undefined,
          sourceModel: typeof job.output?.sourceModel === 'string' ? job.output.sourceModel : undefined,
        };
      }
      if (job.status === 'failed') {
        throw new Error(typeof job.error?.message === 'string' ? job.error.message : 'Background image job failed');
      }
      if (job.status === 'cancelled') throw createAbortError();
      await abortableDelay(BACKGROUND_IMAGE_POLL_INTERVAL_MS, options.signal);
    }
  } catch (error) {
    if (options.signal?.aborted && job) {
      await cancelBackgroundJob(job.id, 'User cancelled image generation').catch(() => undefined);
    }
    throw error;
  }
}

async function tryReuseSucceededStep4ImageJob(
  projectId: string,
  options: GenerateImageOptions,
): Promise<GenerateImageResult | null> {
  const namespace = options.background?.namespace || '';
  const chapterId = options.background?.chapterId;
  const storyboardIndex = options.background?.storyboardIndex;
  if (!namespace.startsWith('step4-board-') || !chapterId || storyboardIndex === undefined) return null;
  try {
    const { jobs } = await listBackgroundJobs({
      projectId,
      chapterId,
      type: 'image-generations',
      status: 'succeeded',
      limit: 80,
    });
    const reusableJob = jobs.find((job) =>
      job.storyboardIndex === storyboardIndex
      && typeof job.progress?.namespace === 'string'
      && job.progress.namespace === namespace
      && typeof job.output?.blobKey === 'string'
      && job.output.blobKey.trim(),
    );
    if (!reusableJob) return null;
    options.onStatus?.('Reused completed background storyboard image');
    return await waitForBackgroundImageJob(reusableJob.id, options);
  } catch {
    return null;
  }
}

async function maybeGenerateImageInBackground(
  config: ImageApiConfig,
  options: GenerateImageOptions,
): Promise<GenerateImageResult | null> {
  const projectId = options.background?.requireBackend === true
    ? options.background.projectId
    : undefined;
  if (!projectId) return null;

  try {
    const reusable = await tryReuseSucceededStep4ImageJob(projectId, options);
    if (reusable) return reusable;

    options.onStatus?.('Submitting background image task');
    const namespace = options.background?.namespace || 'general';
    const [sourceBlobKey, maskBlobKey, referenceBlobKeys] = await Promise.all([
      uploadBackgroundImageInput(projectId, namespace, options.sourceBlob, 'source'),
      uploadBackgroundImageInput(projectId, namespace, options.maskBlob, 'mask'),
      Promise.all((options.referenceBlobs ?? []).map((blob, index) =>
        uploadBackgroundImageInput(projectId, namespace, blob, `reference-${index + 1}`),
      )),
    ]);
    const cleanReferenceBlobKeys = referenceBlobKeys.filter((key): key is string => !!key);
    const input = {
      prompt: options.prompt,
      aspectRatio: options.aspectRatio,
      imageSize: options.imageSize,
      sourceBlobKey,
      maskBlobKey,
      referenceBlobKeys: cleanReferenceBlobKeys,
      referenceLabels: options.referenceLabels,
      sourceLabel: options.sourceLabel,
      config,
    };
    const idempotencyKey = `image:${await sha256Text(stableBackgroundJson({
      namespace,
      chapterId: options.background?.chapterId,
      storyboardIndex: options.background?.storyboardIndex,
      input,
    }))}`;
    const { job } = await createBackgroundJob({
      projectId,
      chapterId: options.background?.chapterId,
      storyboardIndex: options.background?.storyboardIndex,
      type: 'image-generations',
      priority: namespace.startsWith('step4-board-') ? 30 : 20,
      maxAttempts: namespace.startsWith('step4-board-') ? 5 : 3,
      idempotencyKey,
      input,
      progress: { phase: 'queued', namespace },
    });
    const runnableJob = (job.status === 'failed' || job.status === 'cancelled')
      ? (await retryBackgroundJob(job.id, 'Step4 后台图片输入已重新确认，自动断点重试')).job
      : job;
    return await waitForBackgroundImageJob(runnableJob.id, options);
  } catch (error) {
    if (options.background?.requireBackend) throw error;
    options.onStatus?.('Background image unavailable, using frontend image generation');
    return null;
  }
}

// ---------- 公开 API ----------

/**
 * 调用图片生成 API
 * - Gemini 模型：POST /v1beta/models/{model}:generateContent
 * - OpenAI Images：POST /v1/images/generations
 * - APIMart GPT-Image-2：POST /v1/images/generations -> 轮询 /v1/tasks/{task_id}
 */
export async function generateImage(
  config: ImageApiConfig,
  options: GenerateImageOptions,
  videoApiConfig?: VideoApiConfig,
  _context?: unknown,
): Promise<GenerateImageResult> {
  void _context;
  throwIfAborted(options.signal);
  const effectiveApiKey = getEffectiveImageApiKey(config, videoApiConfig);
  const effectiveConfig = effectiveApiKey !== (config.apiKey || '').trim()
    ? { ...config, apiKey: effectiveApiKey }
    : config;
  const backgroundResult = await maybeGenerateImageInBackground(effectiveConfig, options);
  if (backgroundResult) return backgroundResult;
  const baseUrl = (effectiveConfig.baseUrl || 'https://yunwu.ai').replace(/\/$/, '');
  const model = effectiveConfig.model || 'gemini-3.1-flash-image-preview';
  const protocol = resolveImageApiProtocol(effectiveConfig);
  const normalizedImageSize = normalizeImageSizeForConfig(
    effectiveConfig,
    options.imageSize ?? effectiveConfig.defaultImageSize,
    effectiveConfig.defaultImageSize ?? '1K',
  );
  const uploadBlobs = await prepareReferenceImageBlobsForUpload(
    options.sourceBlob,
    options.referenceBlobs,
    options.signal,
  );
  const sourceBlob = uploadBlobs.sourceBlob;
  const referenceBlobs = uploadBlobs.referenceBlobs;
  const isOpenAiEditsRequest = !!(sourceBlob || referenceBlobs?.length || options.maskBlob);

  let url = '';
  let body: BodyInit;
  let responseSourceModel = model;

  if (protocol === 'xiakeman-artlist-images') {
    url = buildXiakemanArtlistImageSubmitUrl(baseUrl);
    const requestModel = normalizeXiakemanArtlistImageModel(model);
    responseSourceModel = requestModel;
    const requestedImageSize = normalizedImageSize;
    const promptParts = [options.prompt];

    if (options.sourceLabel?.trim()) {
      promptParts.unshift(formatSourceReferencePromptPart('主参考图说明', options.sourceLabel));
    }
    if (options.referenceLabels?.length) {
      const referenceLines = options.referenceLabels
        .slice(0, 13)
        .map((label, index) => formatAdditionalReferencePromptPart(index, label))
        .filter(Boolean);
      if (referenceLines.length > 0) {
        promptParts.push(referenceLines.join('\n'));
      }
    }

    const imageBlobs: Blob[] = [];
    if (sourceBlob) imageBlobs.push(sourceBlob);
    if (referenceBlobs?.length) imageBlobs.push(...referenceBlobs);
    const cappedImageBlobs = imageBlobs.slice(0, 14);
    const imagesBase64 = [];
    for (let index = 0; index < cappedImageBlobs.length; index += 1) {
      imagesBase64.push(await toXiakemanImageBase64Object(cappedImageBlobs[index], index));
    }

    body = JSON.stringify({
      client_task_id: createXiakemanClientTaskId(),
      prompt: promptParts.join('\n\n'),
      model: requestModel,
      resolution: toXiakemanArtlistImageResolution(requestModel, requestedImageSize),
      ratio: toGeminiAspectRatio(options.aspectRatio),
      ...(imagesBase64.length > 0 ? { images_base64: imagesBase64 } : {}),
    });
  } else if (protocol === 'volc-seedream-images') {
    url = buildVolcSeedreamImagesUrl(baseUrl);
    const requestModel = normalizeVolcSeedreamModelForRequest(model);
    responseSourceModel = requestModel;
    const promptParts = [options.prompt];

    if (options.sourceLabel?.trim()) {
      promptParts.unshift(formatSourceReferencePromptPart('主参考图说明', options.sourceLabel));
    }
    if (options.referenceLabels?.length) {
      const referenceLines = options.referenceLabels
        .map((label, index) => formatAdditionalReferencePromptPart(index, label))
        .filter(Boolean);
      if (referenceLines.length > 0) {
        promptParts.push(referenceLines.join('\n'));
      }
    }

    const imageInputs: string[] = [];
    if (sourceBlob) {
      imageInputs.push(await blobToDataUri(sourceBlob));
    }
    if (referenceBlobs?.length) {
      for (const referenceBlob of referenceBlobs) {
        imageInputs.push(await blobToDataUri(referenceBlob));
      }
    }

    body = JSON.stringify({
      model: requestModel,
      prompt: promptParts.join('\n\n'),
      size: toVolcSeedreamImageSize(normalizedImageSize),
      response_format: 'b64_json',
      watermark: false,
      sequential_image_generation: 'disabled',
      ...(isVolcSeedream5LiteModel(requestModel) ? { output_format: 'png' } : {}),
      ...(imageInputs.length === 1 ? { image: imageInputs[0] } : {}),
      ...(imageInputs.length > 1 ? { image: imageInputs } : {}),
    });
  } else if (protocol === 'apimart-async-images') {
    url = buildApimartImagesUrl(baseUrl);
    const promptParts = [options.prompt];

    if (options.sourceLabel?.trim()) {
      promptParts.unshift(formatSourceReferencePromptPart('主参考图说明', options.sourceLabel));
    }
    const imageBlobs: Blob[] = [];
    if (sourceBlob) {
      imageBlobs.push(sourceBlob);
    }
    if (referenceBlobs?.length) {
      for (const referenceBlob of referenceBlobs) {
        imageBlobs.push(referenceBlob);
      }
    }

    const cappedImageBlobs = imageBlobs.slice(0, getApimartImageUrlLimit(model));
    const cappedReferenceLabelCount = Math.max(0, cappedImageBlobs.length - (sourceBlob ? 1 : 0));
    if (options.referenceLabels?.length) {
      const referenceLines = options.referenceLabels
        .slice(0, cappedReferenceLabelCount)
        .map((label, index) => formatAdditionalReferencePromptPart(index, label))
        .filter(Boolean);
      if (referenceLines.length > 0) {
        promptParts.push(referenceLines.join('\n'));
      }
    }

    const imageUrls: string[] = [];
    for (let index = 0; index < cappedImageBlobs.length; index += 1) {
      imageUrls.push(await uploadApimartImage(baseUrl, config.apiKey, cappedImageBlobs[index], index, options.signal));
    }
    const requestedImageSize = normalizedImageSize;
    const apimartBody: Record<string, unknown> = {
      model,
      prompt: promptParts.join('\n\n'),
      n: 1,
      size: toApimartAspectRatio(options.aspectRatio),
      resolution: isApimartGemini31FlashImageModel(model)
        ? toApimartGeminiResolution(requestedImageSize)
        : toApimartGptImage2Resolution(options.aspectRatio, requestedImageSize),
      ...(imageUrls.length > 0 ? { image_urls: imageUrls } : {}),
    };

    if (isApimartGptImage2OfficialModel(model)) {
      apimartBody.quality = config.apimartQuality ?? 'auto';
      apimartBody.background = config.apimartBackground ?? 'auto';
      apimartBody.moderation = config.apimartModeration ?? 'auto';
      apimartBody.output_format = config.apimartOutputFormat ?? 'png';
      apimartBody.output_compression = clampApimartOutputCompression(config.apimartOutputCompression);
      if (config.apimartMaskUrl?.trim()) {
        apimartBody.mask_url = config.apimartMaskUrl.trim();
      }
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

    body = JSON.stringify({
      ...apimartBody,
    });
  } else if (protocol === 'openai-images') {
    const requestedImageSize = normalizedImageSize;
    const isOfficialGptImage2 = isOpenAiOfficialGptImage2Model(model);
    const openAiImageSize = toOpenAiImageSize(model, options.aspectRatio, requestedImageSize, config.openaiImageSize);
    const officialGptImage2Params = isOfficialGptImage2
      ? buildOpenAiGptImage2Params(config, requestedImageSize)
      : undefined;

    if (isOpenAiEditsRequest) {
      const formData = new FormData();
      const promptParts = [options.prompt];
      const imageFieldName = isOfficialGptImage2 ? 'image[]' : 'image';

      if (options.sourceLabel?.trim()) {
        promptParts.unshift(formatSourceReferencePromptPart('主图参考说明', options.sourceLabel));
      }
      if (options.referenceLabels?.length) {
        const referenceLines = options.referenceLabels
          .map((label, index) => formatAdditionalReferencePromptPart(index, label))
          .filter(Boolean);
        if (referenceLines.length > 0) {
          promptParts.push(referenceLines.join('\n'));
        }
      }

      if (sourceBlob) {
        formData.append(imageFieldName, sourceBlob, `image-1.${getBlobUploadExtension(sourceBlob)}`);
      }
      if (referenceBlobs?.length) {
        referenceBlobs.forEach((blob, index) => {
          formData.append(imageFieldName, blob, `image-${index + 2}.${getBlobUploadExtension(blob)}`);
        });
      }
      if (options.maskBlob) {
        formData.append('mask', options.maskBlob, `mask.${getBlobUploadExtension(options.maskBlob)}`);
      }

      formData.append('prompt', promptParts.join('\n\n'));
      formData.append('model', model);
      formData.append('n', '1');
      formData.append('size', openAiImageSize);
      if (officialGptImage2Params) {
        appendOpenAiGptImage2Params(formData, officialGptImage2Params);
      } else {
        formData.append('quality', toOpenAiImageQuality(requestedImageSize));
      }

      url = buildOpenAiImagesEditsUrl(baseUrl);
      body = formData;
    } else {
      url = buildOpenAiImagesUrl(baseUrl);
      body = JSON.stringify({
        model,
        prompt: options.prompt,
        size: openAiImageSize,
        ...(officialGptImage2Params ?? { quality: toOpenAiImageQuality(requestedImageSize) }),
        n: 1,
        ...(model.trim().toLowerCase().startsWith('dall-e') ? { response_format: 'b64_json' } : {}),
      });
    }
  } else {
    const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [
      { text: options.prompt },
    ];

    if (sourceBlob) {
      const base64 = await blobToBase64(sourceBlob);
      if (options.sourceLabel?.trim()) {
        parts.push({ text: formatSourceReferencePromptPart('主参考图说明', options.sourceLabel) });
      }
      parts.push({
        inlineData: {
          mimeType: sourceBlob.type || 'image/jpeg',
          data: base64,
        },
      });
    }

    if (referenceBlobs?.length) {
      for (const [index, referenceBlob] of referenceBlobs.entries()) {
        const base64 = await blobToBase64(referenceBlob);
        const referenceLabel = options.referenceLabels?.[index]?.trim();
        parts.push({ text: formatAdditionalReferencePromptPart(index, referenceLabel) || `参考图片${index + 1}` });
        parts.push({
          inlineData: {
            mimeType: referenceBlob.type || 'image/jpeg',
            data: base64,
          },
        });
      }
    }

    body = JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: toGeminiAspectRatio(options.aspectRatio),
          imageSize: normalizedImageSize,
        },
      },
    });
    url = `${baseUrl}/v1beta/models/${model}:generateContent`;
  }

  // 带指数退避的重试逻辑（429 限频）
  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    throwIfAborted(options.signal);
    const headers: HeadersInit = protocol === 'xiakeman-artlist-images'
      ? {
          'Content-Type': 'application/json',
          ...(effectiveConfig.apiKey ? { 'X-License-Key': effectiveConfig.apiKey } : {}),
        }
      : {
          ...(protocol === 'openai-images' && isOpenAiEditsRequest ? {} : { 'Content-Type': 'application/json' }),
          ...(effectiveConfig.apiKey ? { Authorization: `Bearer ${effectiveConfig.apiKey}` } : {}),
        };
    const requestInit: RequestInit = {
      method: 'POST',
      headers,
      body,
      signal: options.signal,
    };
    const res = await fetchWithTransientRetry(url, requestInit, options.signal);

    if (res.ok) {
      if (protocol === 'xiakeman-artlist-images') {
        const payload = await res.json();
        const taskId = getXiakemanArtlistTaskId(payload);
        const imageUrl = getXiakemanArtlistImageUrl(payload);
        const status = getXiakemanArtlistTaskStatus(payload);
        if (imageUrl && ['success', 'succeeded', 'completed', 'complete', 'done'].includes(status)) {
          options.onRemoteImageUrl?.(imageUrl);
          return {
            blob: await fetchImageFromUrl(imageUrl, options.signal),
            externalImageUrl: imageUrl,
            externalImageExpiresAt: Date.now() + EXTERNAL_IMAGE_URL_TTL_MS,
          };
        }
        if (!taskId) {
          throw new Error('虾客漫图片 API 未返回 task_id，请检查返回格式');
        }
        options.onStatus?.('虾客漫图片任务已提交，正在生成...');
        return pollXiakemanArtlistImageTask(baseUrl, effectiveConfig.apiKey, taskId, options);
      }
      if (protocol === 'apimart-async-images') {
        return parseApimartAsyncImagesResponse(res, baseUrl, effectiveConfig.apiKey, options.signal);
      }
      if (protocol === 'volc-seedream-images') {
        return parseVolcSeedreamImagesResponse(res, responseSourceModel, options.signal);
      }
      return protocol === 'openai-images'
        ? parseOpenAiImagesResponse(res, options.signal)
        : parseGeminiImageResponse(res);
    }

    // 请求失败
    const errorText = await res.text().catch(() => '');
    lastError = new Error(`图片生成失败: ${res.status} ${errorText.slice(0, 200)}`);

    // 429 限频：指数退避重试
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const delay = Math.pow(2, attempt) * 3000 + Math.random() * 2000; // 3s, 6s, 12s + 随机抖动
      console.warn(`[Image] 429 限频，${(delay / 1000).toFixed(1)}s 后重试 (${attempt + 1}/${MAX_RETRIES})`);
      await abortableDelay(delay, options.signal);
      continue;
    }

    // 非限频错误或重试次数用尽，直接抛出
    throw lastError;
  }

  throw lastError;
}

/**
 * 通过 LLM 优化图片 prompt
 * 调用 OpenAI 兼容的对话 API
 */
export async function optimizeImagePrompt(
  apiConfig: { baseUrl: string; apiKey: string; model: string },
  description: string,
  styleConfig: string,
  type: 'character' | 'scene' | 'prop',
  context?: string,
  concept?: ImageConcept,
  characterFocus: 'lead' | 'key' | 'support' = 'support',
  signal?: AbortSignal,
  genderHint?: CharacterGenderHint,
): Promise<string> {
  const prompt = buildLLMPrompt(description, styleConfig, type, context, concept, characterFocus, genderHint);
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: buildImagePromptOptimizerSystemPrompt(type) },
    { role: 'user', content: prompt },
  ];

  const raw = await new Promise<string>((resolve, reject) => {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let streamedText = '';

    const cleanup = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onExternalAbort);
    };

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const resetTimeout = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (settled) return;
        controller.abort();
        settle(() => reject(new Error(IMAGE_PROMPT_OPTIMIZE_STREAM_IDLE_TIMEOUT_MESSAGE)));
      }, IMAGE_PROMPT_OPTIMIZE_STREAM_IDLE_TIMEOUT_MS);
    };

    const onExternalAbort = () => {
      controller.abort();
      settle(() => reject(new DOMException('The user aborted a request.', 'AbortError')));
    };

    if (signal?.aborted) {
      onExternalAbort();
      return;
    }
    signal?.addEventListener('abort', onExternalAbort, { once: true });
    resetTimeout();

    chatCompleteStream(
      apiConfig,
      messages,
      {
        onActivity: resetTimeout,
        onChunk: (delta) => {
          streamedText += delta;
          resetTimeout();
        },
        onDone: (fullText) => {
          settle(() => resolve((fullText || streamedText).trim()));
        },
        onError: (error) => {
          settle(() => reject(error));
        },
      },
      { temperature: 0.3, maxTokens: 800, stream: true },
      controller.signal,
    );
  });

  const optimized = parseLLMResponse(raw);
  return finalizeOptimizedPrompt(description, optimized, styleConfig, type, concept, characterFocus, genderHint);
}

// ---------- 内部工具 ----------

function buildImagePromptOptimizerSystemPrompt(type: 'character' | 'scene' | 'prop') {
  const typeLabel = type === 'character' ? '角色' : type === 'scene' ? '场景' : '物品/道具';
  return `你是一个非破坏性的${typeLabel}图片提示词润色器。

你的任务不是重写原描述，而是在保留所有明确视觉事实的前提下，补充镜头、光影、构图和质感语言。

硬性规则：
1. 不得删除、改写或弱化输入描述里已经明确给出的年龄感、气质、颜色、材质、大小、结构、布局、时间、天气、光线、服装、配饰等信息。
2. 不得把具体描述改写成空泛词，例如“精致”“唯美”“神秘”之类不能替代原有细节。
3. 如果输入描述已经足够完整，你只做轻量润色，不要大幅重写。
4. 输出只给最终中文 prompt，不解释，不分点。`;
}

function normalizePromptSegment(value: string) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[，,]+/g, '，')
    .replace(/[；;]+/g, '；')
    .replace(/[。]+/g, '。');
}

function splitPromptSegments(value: string) {
  const protectedValue = value.replace(/(专属物品设定：[^。]*?)(?:；)(?=(?:不得遮挡|不得变成|作为角色设定板|非专属|共享|转手|状态会变化|需要特写))/g, '$1，');
  return protectedValue
    .split(/[\n；;]+/)
    .map((segment) => normalizePromptSegment(segment))
    .filter(Boolean);
}

function normalizeForFactCheck(value: string) {
  return value
    .replace(/[\s，,。；;：:“”"'‘’`、【】（）()-]/g, '')
    .replaceAll('[', '')
    .replaceAll(']', '');
}

function extractCriticalFacts(description: string) {
  return splitPromptSegments(description).filter((segment) => {
    if (segment.length <= 2) return false;
    if (/[：:]/.test(segment)) return true;
    return segment.length <= 18;
  });
}

function countRetainedFacts(prompt: string, facts: string[]) {
  const normalizedPrompt = normalizeForFactCheck(prompt);
  if (!normalizedPrompt) return 0;

  return facts.filter((fact) => {
    const [label, rawValue = ''] = fact.split(/[:：]/, 2);
    const normalizedFact = normalizeForFactCheck(fact);
    const normalizedValue = normalizeForFactCheck(rawValue);
    const normalizedLabel = normalizeForFactCheck(label);

    if (normalizedValue && normalizedPrompt.includes(normalizedValue)) return true;
    if (normalizedValue.length >= 8) {
      const prefix = normalizedValue.slice(0, 8);
      const suffix = normalizedValue.slice(-6);
      if (normalizedPrompt.includes(prefix) && normalizedPrompt.includes(suffix)) return true;
    }
    if (!normalizedValue && normalizedPrompt.includes(normalizedFact)) return true;
    if (normalizedLabel && normalizedValue && normalizedPrompt.includes(normalizedLabel + normalizedValue.slice(0, Math.min(8, normalizedValue.length)))) {
      return true;
    }
    return false;
  }).length;
}

interface ImagePromptProfile {
  purpose: string;
  referenceRole: string;
  composition: string;
  camera: string;
  texture: string;
  lighting: string;
  continuity: string;
  negative: string;
  output: string;
}

function formatSourceReferencePromptPart(prefix: string, label?: string) {
  const trimmed = label?.trim();
  if (!trimmed) return '';
  return [
    `${prefix}：${trimmed}`,
    '参考角色：主参考图负责身份/主体形态/构图基准，除非提示词明确要求变体，不得改写核心外观；如果标签声明为身份参考、服装参考、场景参考、道具参考或构图参考，只继承该职责范围内的信息。',
  ].join('\n');
}

function formatAdditionalReferencePromptPart(index: number, label?: string) {
  const trimmed = label?.trim();
  if (!trimmed) return '';
  return [
    `附加参考图${index + 1}：${trimmed}`,
    `参考角色：附加参考图${index + 1}只承担其标签声明的身份、服装、场景、道具或构图作用，不得互相串用；不得把场景图当角色、把角色图当道具、把道具图当场景。`,
  ].join('\n');
}

function isThreeDAnimeStyleConfig(styleConfig: string) {
  const normalized = styleConfig.trim();
  if (!normalized) return false;
  const has3DSignal = /3d|cg|三维|pbr|游戏级/i.test(normalized);
  const hasAnimeSignal = /动漫|国漫|二次元|角色设定|玄机/i.test(normalized);
  return has3DSignal && hasAnimeSignal;
}

function buildThreeDAnimeImageStyleLock(
  styleConfig: string,
  type: 'character' | 'scene' | 'prop',
  concept?: ImageConcept,
  characterFocus: 'lead' | 'key' | 'support' = 'support',
  genderHint?: CharacterGenderHint,
) {
  if (type !== 'character' || !isThreeDAnimeStyleConfig(styleConfig)) return '';
  const focusLock = characterFocus === 'lead'
    ? '主角必须有主角感：清晰剪影、签名色块、标志性发型/眼神/服装轮廓、精致但风格化的3D国漫五官，不能像普通真人证件照或网红自拍。'
    : characterFocus === 'key'
      ? '重要角色/反派必须有明确辨识：权力符号、冷峻轮廓、非对称细节、专属纹章或装备锚点，不能是无特点制服或普通帅脸。'
      : '配角也保持3D国漫CG统一风格，避免真人摄影感。';
  const genderLock = genderHint === 'female'
    ? '女性主角识别锁：必须读成女性，不要因为短发、冷感或战斗气质而像男性。'
    : genderHint === 'male'
      ? '男性角色识别锁：保持明确男性读法，不要中性化成女性。'
      : '';
  const sheetLock = concept === 'landscape_turnaround' || concept === 'landscape_outfit_turnaround'
    ? '角色设定板不能变成单张大头照或头像相册；右侧 FRONT VIEW / BACK VIEW 必须是足够大的全身面板，人物高度占面板80%-90%，从头到脚比例清楚。'
    : '竖屏头像仍必须是3D国漫CG身份锁定图，不是真人照片、证件照、棚拍写真或AI真人脸。';
  const referenceRestyleLock = '3D anime restyle lock: even if any source/reference image looks photoreal, redraw it as stylized 3D guoman anime CG, toon-shaded face, anime face proportions, clean simplified skin, no real skin pores, no photographic lens, no cosplay photo, no live-action actor face.';
  return [
    '3D国漫CG风格硬锁：风格化3D动画电影角色、游戏CG渲染、PBR材质、干净轮廓光、非真人照片、非真人棚拍、非写实演员、非皮肤毛孔级真人写实。',
    referenceRestyleLock,
    focusLock,
    genderLock,
    sheetLock,
  ].join(' ');
}

function buildImagePromptProfile(
  type: 'character' | 'scene' | 'prop',
  concept?: ImageConcept,
  characterFocus: 'lead' | 'key' | 'support' = 'support',
  genderHint?: CharacterGenderHint,
): ImagePromptProfile {
  if (type === 'scene') {
    const isVerticalScene = concept === 'scene_vertical';
    return {
      purpose: isVerticalScene
        ? '图片用途：Seedance 2.0 竖屏 WORLD LOCK 场景导演板，专供9:16竖屏短剧/漫剧分镜视频锁定真实可拍空间与定位走位。'
        : '图片用途：Seedance 2.0 横屏 WORLD LOCK 场景导演板，专供16:9横屏短剧/漫剧分镜视频锁定真实可拍空间与定位走位。',
      referenceRole: isVerticalScene
        ? '参考图角色：竖屏场景导演板独立锁定9:16视频空间；主环境图负责竖屏真实空间质感，FLOOR PLAN / TOP-DOWN BLOCKING MAP 负责入口/出口、路径、障碍物、核心锚点、人物入画安全区和机位轴线；主环境图不能出现文字，制作板标题条和俯视图标签必须大且清晰，标题条只能放在分隔栏/边框上。'
        : '参考图角色：横屏场景导演板独立锁定16:9视频空间；主环境图负责横屏真实空间质感，FLOOR PLAN / TOP-DOWN BLOCKING MAP 负责入口/出口、路径、障碍物、核心锚点、人物入画安全区和机位轴线；主环境图不能出现文字，制作板标题条和俯视图标签必须大且清晰，标题条只能放在分隔栏/边框上。',
      composition: isVerticalScene
        ? '构图布局：竖屏9:16制作板。顶部约58%-62%是一张干净、无人、可直接拍摄的竖屏 ENVIRONMENT / SET DESIGN 主环境图，保留前景/中景/远景、上下安全留白、人物入画空间和镜头运动余量；底部约34%-38%是 FLOOR PLAN / TOP-DOWN BLOCKING MAP，必须是简洁高对比图纸/蓝图/浅灰底矢量式俯视图，不要照片质感、电影阴影或暗色氛围图，显示入口/出口、核心锚点、可行动路线、障碍物、角色入画安全区、CAMERA 1-6 机位与运动箭头；竖屏底部俯视图必须占底部区域至少78%宽度，LEGEND 只能做右侧窄条且不得超过底部区域宽度18%，不要额外 SIDE ELEVATION 小窗挤压地图。'
        : '构图布局：横屏16:9制作板。顶部约55%-60%是一张干净、宽幅、无人、可直接拍摄的 ENVIRONMENT / SET DESIGN 主环境图；底部约40%-45%是 FLOOR PLAN / TOP-DOWN BLOCKING MAP，必须是简洁高对比图纸/蓝图/浅灰底矢量式俯视图，不要照片质感、电影阴影或暗色氛围图，显示入口/出口、核心锚点、可行动路线、障碍物、角色入画安全区、CAMERA 1-6 机位与运动箭头；横屏底部俯视图必须占底部区域至少76%宽度，LEGEND 只能做右侧窄条且不得超过底部区域宽度18%。',
      camera: isVerticalScene
        ? '镜头语言：主环境图使用稳定广角/中广角竖屏视角，透视关系干净，明确近景遮挡、中景行动区、远景目标点；底部俯视图用清晰图纸感表达 CAMERA 路径、DOLLY-IN、TRACK、STATIC、ARC 等机位运动；CAMERA 1-6 编号和图例短标签要比普通文字放大1.5-2倍，缩略图下仍可读。'
        : '镜头语言：主环境图使用稳定广角/中广角视角，透视关系干净；底部俯视图用清晰图纸感表达 CAMERA 路径、DOLLY-IN、TRACK、STATIC、ARC 等机位运动；CAMERA 1-6 编号和图例短标签要比普通文字放大1.5-2倍，缩略图下仍可读。',
      texture: '材质质感：建筑/自然元素/陈设材质可辨，纹理、磨损、雾气、反光和空气颗粒真实。',
      lighting: '光影色彩：明确时间段、主光源方向、辅光、明暗关系和主色调，避免色彩漂移。',
      continuity: isVerticalScene
        ? '连续性锁定：与同名横屏场景导演板共享同一地点、同一关键锚点和同一光线逻辑，但这是独立生成的竖屏视频参考，不裁切、不复制横屏构图；至少5个空间锚点必须在主环境图和俯视图中一一对应，锚点优先为 ENTRY DOOR / EXIT DOOR / CENTRAL COLUMN / RIGHT MACHINE / SAFE ACTION ZONE / HANGING CHAIN，主环境里要真实画出这些物体，俯视图用短英文标签标出这些锚点；普通陈设优先烘焙在场景导演板里，不额外占用 Seedance 9 图参考预算。'
        : '连续性锁定：与同名竖屏场景导演板共享同一地点、同一关键锚点和同一光线逻辑，但这是独立生成的横屏视频参考；至少5个空间锚点必须在主环境图和俯视图中一一对应，锚点优先为 ENTRY DOOR / EXIT DOOR / CENTRAL COLUMN / RIGHT MACHINE / SAFE ACTION ZONE / HANGING CHAIN，主环境里要真实画出这些物体，俯视图用短英文标签标出这些锚点；底部俯视定位图服务 Step4 MODULE C / BLOCKING MAP；普通陈设优先烘焙在场景导演板里，不额外占用 Seedance 9 图参考预算。',
      negative: '负面约束：无人物，无人影，无人形，无Logo，无水印，不生成剧情截图或角色动作；主环境图无文字，但制作板模块标题条和俯视图短标签必须清晰可读。',
      output: isVerticalScene
        ? '输出规格：竖屏9:16，高清 ENVIRONMENT / SET DESIGN 制作板，主环境图真实可拍，底部竖屏俯视定位清晰可读，必须出现黑底白字或深灰底白字的大号模块标题条 MAIN ENVIRONMENT、TOP-DOWN BLOCKING MAP、CAMERA 1-6、LEGEND，供竖屏视频空间和走位参考。'
        : '输出规格：横屏16:9，高清 ENVIRONMENT / SET DESIGN 制作板，主环境图真实可拍，底部横屏俯视定位清晰可读，必须出现黑底白字或深灰底白字的大号模块标题条 MAIN ENVIRONMENT、TOP-DOWN BLOCKING MAP、CAMERA 1-6、LEGEND，供横屏视频空间和走位参考。',
    };
  }

  if (type === 'prop') {
    return {
      purpose: '图片用途：Seedance 2.0 道具工业锁定板 / PROP REFERENCE SHEET，供后续分镜视频锁定同一件核心剧情道具的外观、尺寸、材质、状态版本和使用方式；普通小物件可在确认为合集目标时合并成 SMALL PROPS KIT。',
      referenceRole: '参考图角色：道具参考只锁定道具本体形状、尺寸、材质、颜色、结构比例、纹理、磨损、状态版本和可识别交互方式；持有人、画面位置和剧情动作由 Step4/Step5 另行指定。',
      composition: '构图布局：横屏16:9工业制作板。顶部小标题栏写 PROP REFERENCE | 道具名；主图区 HERO VIEW 单个核心道具完整居中；旁边或下方必须有 ORTHOGRAPHIC VIEWS 多角度小窗，至少包含 FRONT VIEW、SIDE VIEW、TOP VIEW 或 DETAIL CUTAWAY；底部信息条包含 SCALE / HAND CONTACT、MATERIAL / TEXTURE、STATE A-B-C、USE DETAIL、PALETTE 小窗。若描述明确是一组小物件/配件/桌面零散物，可排成 SMALL PROPS KIT 合集板，每个物件独立留白、轮廓清楚、不可互相遮挡。',
      camera: '镜头语言：工业道具参考表视角稳定，主视图边缘轮廓清楚，多角度视图同一尺度；SCALE / HAND CONTACT 只允许中性手部剪影、手套手或比例尺辅助锁尺寸，USE DETAIL 只做干净局部示意，不做完整人物持拿镜头。',
      texture: '材质质感：重点写清反光、透明度、金属/玉石/布料/纸张/皮革/玻璃等材质、纹饰刻痕、锈迹、裂纹、磨损、污渍、边缘倒角和使用痕迹。',
      lighting: '光影色彩：柔和棚拍或电影级静物光，轮廓光帮助识别形状，颜色不漂移。',
      continuity: '连续性锁定：同一追踪道具跨分镜不得换形、换材质、换颜色、换状态版本或变成同类替代物；STATE A-B-C 只展示基础描述明确或状态追踪需要的版本；进入 Seedance 2.0 全能参考模式前优先保留核心剧情道具，普通小物件可用文字或合集图节省最多 9 张参考图预算。',
      negative: '负面约束：无清晰人物、无角色脸、无完整人物动作、无复杂场景背景、无剧情截图、无漫画分镜、无自由贴纸拼贴、无Logo水印；除固定英文模块标签外，无长段说明文字、价格牌、随机编号或展示台文字。',
      output: '输出规格：横屏16:9，高清 PROP REFERENCE SHEET / SMALL PROPS KIT，固定英文模块标签清晰，便于后续视频引用和参考图预算管理。',
    };
  }

  const isTurnaround = concept === 'landscape_turnaround' || concept === 'landscape_outfit_turnaround';
  const isOutfit = concept === 'portrait_outfit' || concept === 'landscape_outfit_turnaround';
  const focusLine = characterFocus === 'lead'
    ? '主角级辨识度：五官立体、眼神有戏、轮廓清晰、服装层次高级，镜头吸引力强；必须有签名色块、标志性发型/眼神/服装轮廓，不能只是普通漂亮脸。'
    : characterFocus === 'key'
      ? '重要角色辨识度：形象利落、特征明确、镜头表现高于普通配角；若是反派或对手，必须强化权力符号、冷峻剪影、非对称细节或专属纹章，不能只是普通帅脸。'
      : '普通角色定位：自然可信、准确清楚，不抢主角视觉中心。';
  const genderLine = genderHint === 'female'
    ? '女性角色补强：必须保留女性化轮廓、眉眼与发型层次，避免中性化或男性化误判。'
    : genderHint === 'male'
      ? '男性角色补强：必须保留明确男性轮廓与气质，避免中性化。'
      : '';

  return {
    purpose: isOutfit
      ? '图片用途：Seedance 2.0 角色变装设定资产，供后续 MODULE A / CHARACTER LOCK 锁定当前服装版本。'
      : isTurnaround
        ? '图片用途：Seedance 2.0 MODULE A / CHARACTER LOCK 工业角色参考表，供后续分镜视频优先锁定同一角色脸部身份，并兼顾服装、体态和材质。'
        : '图片用途：Seedance 2.0 角色身份设定资产，供后续 MODULE A / CHARACTER LOCK 锁定角色脸部、发型、服装和气质。',
    referenceRole: isOutfit
      ? '参考图角色：身份参考锁定同一角色脸部与年龄感，当前服装参考锁定服饰、材质、配饰和体态轮廓。'
      : isTurnaround
        ? '参考图角色：角色参考负责身份一致性；左侧三分之一 FACE HERO CLOSE-UP 作为固定脸部身份锚定，右侧 FRONT/BACK 锁定全身体态比例，FACE DETAIL CLOSE-UP 补充局部身份细节，MATERIAL 区锁定服装材质，专属物品小窗只锁定长期专属且外观稳定的签名物。'
        : '参考图角色：角色参考负责身份一致性，锁定五官、脸型、发型、服装、配饰和标志性视觉锚点。',
    composition: isTurnaround
      ? '构图布局：横屏16:9 CHARACTER REFERENCE SHEET；顶部标题栏写 CHARACTER REFERENCE | 角色名；主体区采用固定左三分之一脸部竖栏版式并显示英文模块标签：FACE HERO CLOSE-UP、FRONT VIEW、BACK VIEW、FACE DETAIL CLOSE-UP、COSTUME / SUIT DETAIL VIEW；FACE HERO CLOSE-UP 必须独占画布左侧固定三分之一宽度，约33%-35%画布宽，从标题栏下沿一直延伸到主体底部，且必须是纯人脸大特写：脸部占左侧竖栏画面90%以上，只允许脸、五官、耳朵、发际线和少量头发，严禁肩颈、胸口、衣领、上半身和半身构图；右侧三分之二区域才放正背全身、脸部细节、服装细节和 MATERIAL & TEXTURE NOTES；FRONT VIEW 与 BACK VIEW 两个全身人物必须足够大，人物高度占各自面板80%-90%，从头到脚比例清楚，服装轮廓可读，整张图不能变成单张大头照或头像相册；取消色板区和调色块模块，不做横跨全画幅的底部材质栏；细浅灰分割线、规整留白、技术参考表排版。'
      : isOutfit
        ? '构图布局：竖屏9:16单人变装定妆照，从头到脚或至少到膝盖完整展示当前服装，不出现具体场景。'
        : '构图布局：竖屏9:16单人人脸大特写，正面或轻微3/4正面，脸部占画面85%-90%，只允许脸、五官、耳朵、发际线和少量头发；严禁肩颈、胸口、衣领、上半身和半身构图，背景简洁。',
    camera: `镜头语言：3D动画角色身份设定照 / stylized CG character design reference，视角稳定，面部和服装关键细节清晰；不是演员定妆照、真人证件照、写真棚拍、cosplay照片或AI真人头像。${focusLine}${genderLine ? ` ${genderLine}` : ''}`,
    texture: '材质质感：3D国漫CG材质，toon-shaded stylized skin，干净简化皮肤和PBR服装材质；不出现真人毛孔、摄影棚皮肤质感、真实演员五官或真人镜头虚化。',
    lighting: '光影色彩：柔和主光加轮廓光，脸部结构清楚，色调服务角色气质且不覆盖原始设定颜色。',
    continuity: isOutfit
      ? '连续性锁定：这是当前变装版本，不得回退基础服装；同一角色脸部身份保持一致。'
      : isTurnaround
        ? '连续性锁定：FACE HERO CLOSE-UP、FRONT VIEW、BACK VIEW 必须是同一角色、同一服装版本、同一身高比例、同一灯光和同一尺度；后续视频必须能继承同一张脸、同一发型、同一服饰配饰、体态比例、配色、材质和已合入的角色专属物品；这张图服务 Step4 开发板与 Seedance 2.0 最多9张参考图预算。'
        : '连续性锁定：后续视频必须能继承同一张脸、同一发型、同一服饰配饰和视觉锚点。',
    negative: isTurnaround
      ? '负面约束：只出现同一名角色，无第二个人、无群像、无互动、无剧情动作、无血腥伤害、无具体室内外场景；除固定英文模块标签外无长段文字、无Logo、无水印；不要海报构图、漫画分镜、随机贴纸拼贴、复杂背景或自由排版；不要单张大头照、头像拼贴、证件照相册、小人全身面板；不要设置侧身全身面板，不要把正背全身面板画成不同角色或不同服装版本；不得加入非专属、共享、转手、状态会变化或需要独立特写的道具。'
      : '负面约束：只出现一名角色，无第二个人、无群像、无互动、无剧情动作、无武器、无手持道具、无血腥伤害、无具体室内外场景、无文字Logo水印；避免普通真人证件照、网红自拍脸、廉价影楼头像。',
    output: isTurnaround
      ? '输出规格：横屏16:9工业角色参考表，纯白或浅灰技术背景，固定英文模块标签清晰，4K细节密度，优先兼顾超大脸部身份、正背全身、服装细节、材质与专属物品识别。'
      : '输出规格：竖屏9:16角色设定图，背景纯净，便于后续图生图和视频引用。',
  };
}

function formatImagePromptProfile(profile: ImagePromptProfile) {
  return [
    profile.purpose,
    profile.referenceRole,
    profile.composition,
    profile.camera,
    profile.texture,
    profile.lighting,
    profile.continuity,
    profile.negative,
    profile.output,
  ].join('；');
}

function getConceptFallbackHint(
  type: 'character' | 'scene' | 'prop',
  concept?: ImageConcept,
) {
  if (type === 'scene') {
    if (concept === 'scene_vertical') {
      return '竖屏9:16，ENVIRONMENT / SET DESIGN 场景导演板，上方竖屏主环境图，下方高对比图纸化 FLOOR PLAN / TOP-DOWN BLOCKING MAP，锁定入口/出口、路径、障碍物、核心锚点、人物入画安全区和 CAMERA 1-6 机位；大号标题 MAIN ENVIRONMENT、TOP-DOWN BLOCKING MAP、LEGEND；固定图例 ENTRY / EXIT / SAFE ACTION ZONE / OBSTACLE / COLUMN / CAMERA POSITION / CAMERA MOVE';
    }
    return '横屏16:9，ENVIRONMENT / SET DESIGN 场景导演板，上方横屏主环境图，下方高对比图纸化 FLOOR PLAN / TOP-DOWN BLOCKING MAP，锁定入口/出口、路径、障碍物、核心锚点、人物入画安全区和 CAMERA 1-6 机位；大号标题 MAIN ENVIRONMENT、TOP-DOWN BLOCKING MAP、LEGEND；固定图例 ENTRY / EXIT / SAFE ACTION ZONE / OBSTACLE / COLUMN / CAMERA POSITION / CAMERA MOVE';
  }
  if (type === 'prop') {
    return '横屏16:9，PROP REFERENCE SHEET 道具工业锁定板，顶部 PROP REFERENCE 标题栏，HERO VIEW 主视图，FRONT / SIDE / TOP 多角度结构小窗，SCALE / HAND CONTACT 尺寸比例小窗，MATERIAL / TEXTURE 材质近景，STATE A-B-C 状态版本，USE DETAIL 使用方式局部示意；无角色脸，无完整人物动作，无复杂场景';
  }

  switch (concept) {
    case 'portrait_closeup':
      return '竖屏9:16，单人角色定妆大特写，正面或3/4侧，纯净背景或极简渐变背景，不出现具体场景';
    case 'portrait_outfit':
      return '竖屏9:16，单人角色变装定妆照，完整展示变装造型，背景简洁纯净，不出现具体场景';
    case 'landscape_turnaround':
      return '横屏16:9，CHARACTER REFERENCE SHEET，顶部标题栏，左侧固定三分之一 FACE HERO CLOSE-UP 超大脸部身份锚定，右侧 FRONT VIEW / BACK VIEW 正背全身，FACE DETAIL CLOSE-UP，COSTUME DETAIL，MATERIAL & TEXTURE NOTES 小材质区，纯白或浅灰技术背景';
    case 'landscape_outfit_turnaround':
      return '横屏16:9，变装版 CHARACTER REFERENCE SHEET，顶部标题栏，左侧固定三分之一 FACE HERO CLOSE-UP 超大脸部身份锚定，右侧 FRONT VIEW / BACK VIEW 正背全身，FACE DETAIL CLOSE-UP，COSTUME DETAIL，MATERIAL & TEXTURE NOTES 小材质区，纯白或浅灰技术背景';
    default:
      return undefined;
  }
}

function getCharacterSettingSheetGuard(concept?: ImageConcept) {
  const baseGuard = 'Seedance 角色锁定资产硬约束：只出现一名角色，不能出现第二个人、双人同框、群像、互动、背刺、打斗、受伤、穿胸、血腥动作、剧情剧照、具体室内外场景；画面职责是身份/服装/体态锁定，不承担剧情动作';
  const noPropGuard = '不能出现武器、刀剑、枪械、弓箭、法器、手持道具或佩戴在身上的武器，武器道具必须单独在道具资产中生成';
  if (concept === 'portrait_outfit') {
    return `${baseGuard}；${noPropGuard}；变装定妆照必须突出与基础服装不同的颜色、材质、版型或层次，若没有实质服装变化则不应作为变装资产`;
  }
  if (concept === 'landscape_turnaround' || concept === 'landscape_outfit_turnaround') {
    return `${baseGuard}；角色设定板必须是16:9工业角色参考表 / CHARACTER REFERENCE SHEET，顶部标题栏，主体固定左三分之一脸部竖栏版式：左侧固定三分之一 FACE HERO CLOSE-UP，右侧 FRONT VIEW、BACK VIEW、FACE DETAIL CLOSE-UP、COSTUME / SUIT DETAIL VIEW、MATERIAL & TEXTURE NOTES；允许出现这些固定英文模块标签，但不得生成长段说明文字、Logo 或水印；禁止色板区和调色块模块；FACE HERO CLOSE-UP 必须独占画布左侧固定三分之一宽度，约33%-35%画布宽，从标题栏下沿一直延伸到主体底部，左侧竖栏下方不得再横跨 MATERIAL、服装细节、专属物品或任何信息条；FACE HERO CLOSE-UP 必须是纯人脸大特写，脸部占左侧竖栏画面90%以上，只允许脸、五官、耳朵、发际线和少量头发，严禁肩颈、胸口、衣领、上半身、手部和半身构图；取消侧身全身面板；FRONT VIEW 与 BACK VIEW 必须是同一角色、同一服装版本、同一身高比例、同一灯光和同一尺度，两个全身人物必须足够大，人物高度占各自面板80%-90%，从头到脚完整且服装轮廓清楚；整张图不能变成单张大头照、头像拼贴或证件照相册；不允许自由排版、海报构图、漫画分镜或随机贴纸拼贴；允许角色长期专属且外观稳定的签名武器、法器或随身物以右侧 SIGNATURE PROP / EQUIPMENT DETAIL 小窗展示；非专属、共享、转手、状态会变化或需要特写锁材质的道具必须单独生成，不得合入本图`;
  }
  return `${baseGuard}；${noPropGuard}；画面应是角色身份锁定参考图，采用稳定正面脸部大特写与清晰服装锚点，不是剧情截图、演员定妆照、真人证件照或写真棚拍`;
}

export function enforceImagePromptGuards(
  prompt: string,
  type: 'character' | 'scene' | 'prop',
  concept?: ImageConcept,
  _options: { nonHumanSystem?: boolean } = {},
) {
  void _options;
  if (type === 'character') {
    const allowSignatureProps = concept === 'landscape_turnaround' || concept === 'landscape_outfit_turnaround';
    return mergePromptParts([
      sanitizeCharacterAssetPromptText(sanitizeLegacyLiveActionPromptText(prompt), { allowSignatureProps }),
      getCharacterSettingSheetGuard(concept),
    ]);
  }
  if (type === 'scene') {
    return mergePromptParts([
      prompt,
      concept === 'scene_vertical'
        ? 'Seedance WORLD LOCK 竖屏场景导演板硬约束：输出9:16 ENVIRONMENT / SET DESIGN 制作板，上方约58%-62%竖屏主环境图、下方约34%-38%高对比图纸化 FLOOR PLAN / TOP-DOWN BLOCKING MAP；独立服务竖屏视频，不依赖横屏图生图；只锁定空间结构、关键陈设、材质、光线、色调、入口/出口、障碍物、机位轴线和可行动区域；主环境图里不得出现文字，但制作板必须有黑底白字或深灰底白字的大号模块标题条 MAIN ENVIRONMENT、TOP-DOWN BLOCKING MAP、CAMERA 1-6、LEGEND，标题条只能放在分隔栏/边框上；竖屏底部俯视图必须占底部区域至少78%宽度，LEGEND 右侧窄条不得超过18%宽度；CAMERA 1-6 编号和图例短标签放大1.5-2倍；固定图例颜色：ENTRY 蓝色箭头，EXIT 红色箭头，SAFE ACTION ZONE 绿色矩形，OBSTACLE / MACHINE 灰色块，STRUCTURAL COLUMN 橙棕色方块，CAMERA POSITION 蓝色编号圆点，CAMERA MOVE 蓝色虚线箭头；至少5个空间锚点在主环境图和俯视图中一一对应：ENTRY DOOR / EXIT DOOR / CENTRAL COLUMN / RIGHT MACHINE / SAFE ACTION ZONE / HANGING CHAIN；无人物、无人影、无人形、无对白字幕、无剧情动作瞬间'
        : 'Seedance WORLD LOCK 横屏场景导演板硬约束：输出16:9 ENVIRONMENT / SET DESIGN 制作板，上方横屏主环境图、下方高对比图纸化 FLOOR PLAN / TOP-DOWN BLOCKING MAP；独立服务横屏视频；只锁定空间结构、关键陈设、材质、光线、色调、入口/出口、障碍物、机位轴线和可行动区域；主环境图里不得出现文字，但制作板必须有黑底白字或深灰底白字的大号模块标题条 MAIN ENVIRONMENT、TOP-DOWN BLOCKING MAP、CAMERA 1-6、LEGEND，标题条只能放在分隔栏/边框上；横屏底部俯视图必须占底部区域至少76%宽度，LEGEND 右侧窄条不得超过18%宽度；CAMERA 1-6 编号和图例短标签放大1.5-2倍；固定图例颜色：ENTRY 蓝色箭头，EXIT 红色箭头，SAFE ACTION ZONE 绿色矩形，OBSTACLE / MACHINE 灰色块，STRUCTURAL COLUMN 橙棕色方块，CAMERA POSITION 蓝色编号圆点，CAMERA MOVE 蓝色虚线箭头；至少5个空间锚点在主环境图和俯视图中一一对应：ENTRY DOOR / EXIT DOOR / CENTRAL COLUMN / RIGHT MACHINE / SAFE ACTION ZONE / HANGING CHAIN；无人物、无人影、无人形、无对白字幕、无剧情动作瞬间',
    ]);
  }
  if (type === 'prop') {
    return mergePromptParts([
      prompt,
      'Seedance 道具工业板硬约束：输出16:9 PROP REFERENCE SHEET；核心剧情道具必须单独成板，主图区 HERO VIEW 只画单个道具本体；必须包含 FRONT / SIDE / TOP 或 DETAIL CUTAWAY 多角度结构小窗、SCALE / HAND CONTACT 尺寸比例小窗、MATERIAL / TEXTURE 材质近景、STATE A-B-C 状态版本和 USE DETAIL 使用方式局部示意；同一追踪道具不得换形、换色、换材质、换状态版本或变成同类替代物；SCALE / HAND CONTACT 只允许中性手部剪影、手套手或比例尺，不得出现角色脸、完整人物动作或剧情截图；小物件合集图只在目标明确是一组零散物时使用，每件物品独立完整可辨识；除固定英文模块标签外不得生成长段说明文字、Logo或水印',
    ]);
  }
  return prompt;
}

function mergePromptParts(parts: Array<string | undefined>) {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const part of parts) {
    for (const segment of splitPromptSegments(part ?? '')) {
      const key = normalizeForFactCheck(segment);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(segment);
    }
  }

  return merged.join('；');
}

export function buildDirectImagePrompt(
  description: string,
  styleConfig: string,
  type: 'character' | 'scene' | 'prop',
  concept?: ImageConcept,
  characterFocus: 'lead' | 'key' | 'support' = 'support',
  genderHint?: CharacterGenderHint,
) {
  const focusHint = type !== 'character'
    ? undefined
    : characterFocus === 'lead'
      ? '主角级镜头表现，高辨识度，电影海报感，五官和服装层次清晰'
      : characterFocus === 'key'
        ? '重要角色镜头表现，形象利落，辨识度明确'
        : undefined;

  const allowSignatureProps = concept === 'landscape_turnaround' || concept === 'landscape_outfit_turnaround';
  const safeDescription = type === 'character'
    ? sanitizeCharacterAssetPromptText(description, { allowSignatureProps })
    : description;
  const resolvedGenderHint = genderHint ?? inferCharacterGenderHint(description, safeDescription, styleConfig);
  const genderFocusHint = type === 'character' && resolvedGenderHint === 'female'
    ? '女性主角识别锁：必须读成女性，不要因为短发、冷感或战斗气质而像男性。'
    : type === 'character' && resolvedGenderHint === 'male'
      ? '男性角色识别锁：保持明确男性读法，不要中性化成女性。'
      : '';
  const profile = buildImagePromptProfile(type, concept, characterFocus, resolvedGenderHint);
  const threeDAnimeStyleLock = buildThreeDAnimeImageStyleLock(styleConfig, type, concept, characterFocus, resolvedGenderHint);

  return enforceImagePromptGuards(mergePromptParts([
    styleConfig,
    threeDAnimeStyleLock,
    formatImagePromptProfile(profile),
    getConceptFallbackHint(type, concept),
    focusHint,
    genderFocusHint,
    normalizePromptSegment(safeDescription),
  ]), type, concept);
}

function finalizeOptimizedPrompt(
  description: string,
  optimizedPrompt: string,
  styleConfig: string,
  type: 'character' | 'scene' | 'prop',
  concept?: ImageConcept,
  characterFocus: 'lead' | 'key' | 'support' = 'support',
  genderHint?: CharacterGenderHint,
) {
  const cleanDescription = normalizePromptSegment(
    type === 'character'
      ? sanitizeCharacterAssetPromptText(description, {
        allowSignatureProps: concept === 'landscape_turnaround' || concept === 'landscape_outfit_turnaround',
      })
      : description,
  );
  const cleanOptimized = normalizePromptSegment(optimizedPrompt);
  const basePrompt = buildDirectImagePrompt(cleanDescription, styleConfig, type, concept, characterFocus, genderHint);

  if (!cleanOptimized) return basePrompt;

  const facts = extractCriticalFacts(cleanDescription);
  const retainedFacts = countRetainedFacts(cleanOptimized, facts);
  const minimumRetainedFacts = facts.length === 0 ? 0 : Math.max(2, Math.ceil(facts.length * 0.45));
  const shouldPreserveBase =
    cleanOptimized.length < Math.max(48, Math.floor(cleanDescription.length * 0.65))
    || retainedFacts < minimumRetainedFacts;

  if (!shouldPreserveBase) {
    if (type === 'scene' && !/无人物|无人影|无人形/.test(cleanOptimized)) {
      return mergePromptParts([cleanOptimized, '无人物，无人影，无人形']);
    }
    if (type === 'character') {
      return mergePromptParts([cleanOptimized, getCharacterSettingSheetGuard(concept)]);
    }
    return cleanOptimized;
  }

  return mergePromptParts([
    basePrompt,
    cleanOptimized,
  ]);
}

function buildLLMPrompt(
  description: string,
  styleConfig: string,
  type: 'character' | 'scene' | 'prop',
  context?: string,
  concept?: ImageConcept,
  characterFocus: 'lead' | 'key' | 'support' = 'support',
  genderHint?: CharacterGenderHint,
): string {
  const allowSignatureProps = concept === 'landscape_turnaround' || concept === 'landscape_outfit_turnaround';
  const safeDescription = type === 'character'
    ? sanitizeCharacterAssetPromptText(description, { allowSignatureProps })
    : description;
  const resolvedGenderHint = genderHint ?? inferCharacterGenderHint(description, context, safeDescription, styleConfig);
  const genderGuidance = type === 'character' && resolvedGenderHint === 'female'
    ? '女性角色补充：必须读成女性主角，不要因为短发、冷感或战斗气质而像男性。'
    : type === 'character' && resolvedGenderHint === 'male'
      ? '男性角色补充：保持明确男性读法，不要中性化成女性。'
      : '';
  const profile = buildImagePromptProfile(type, concept, characterFocus, resolvedGenderHint);
  const profileGuidance = formatImagePromptProfile(profile);
  const threeDAnimeStyleLock = buildThreeDAnimeImageStyleLock(styleConfig, type, concept, characterFocus, resolvedGenderHint);
  const contextBlock = context
    ? `\n\n补充上下文（仅用于补充镜头和一致性，优先级低于“基础描述”，不要用它覆盖基础描述里的明确视觉事实）：\n---\n${context.slice(0, 1200)}\n---`
    : '';

  if (type === 'character') {
    let conceptGuidance = '';
    switch (concept) {
      case 'portrait_closeup':
        conceptGuidance = `这是一张竖屏（9:16）角色正面大特写。
要求：
- 只允许出现一个角色本人，不能出现第二个人、双人互动、群像或剧情剧照
- 竖屏构图必须是纯人脸大特写，脸部占画面85%-90%，只允许脸、五官、耳朵、发际线和少量头发
- 重点描写五官、脸型、眼神、嘴形、发际线、发型边缘、痣/疤/眼镜/发饰等身份锚点
- 正面或3/4侧面角度，展现角色最标志性的一面
- 严禁出现肩颈、胸口、衣领、上半身、手部或半身构图，不能生成半身定妆照
- 背景简洁纯净（纯色或简单渐变），不分散注意力
- 光线柔和有质感，突出角色轮廓和五官
- 不要加入可识别的具体场景、建筑、街道、室内陈设或剧情动作
- 不要出现武器、刀剑、枪械、弓箭、法器、手持道具或佩戴在身上的武器`;
        break;
      case 'landscape_turnaround':
        conceptGuidance = `16:9横版构图，工业角色参考表 / CHARACTER REFERENCE SHEET，角色严格按照参考图片保持同一张脸、同一发型、同一基础服装版本和体态比例。版式必须稳定：顶部浅灰技术标题栏，写入 CHARACTER REFERENCE | 角色名；主体区采用固定左三分之一脸部竖栏版式，必须显示清晰英文模块标签：FACE HERO CLOSE-UP、FRONT VIEW、BACK VIEW、FACE DETAIL CLOSE-UP、COSTUME / SUIT DETAIL VIEW。FACE HERO CLOSE-UP 必须独占画布左侧固定三分之一宽度，约33%-35%画布宽，从标题栏下沿一直延伸到主体底部；左侧竖栏下方不得再横跨 MATERIAL、服装细节、专属物品、色板或任何信息条。FACE HERO CLOSE-UP 内必须是纯人脸大特写，不是头像半身照；脸部必须占左侧竖栏画面90%以上，画面只允许脸、五官、耳朵、发际线和少量头发，额头到下巴清晰完整，眼睛、鼻梁、嘴形、脸型、发际线、疤痕、眼镜、发饰等身份锚点必须锐利；严禁出现肩颈、胸口、衣领、上半身、手部或半身构图。右侧三分之二区域才放 FRONT VIEW、BACK VIEW、FACE DETAIL CLOSE-UP、COSTUME / SUIT DETAIL VIEW 和 MATERIAL & TEXTURE NOTES；取消侧身全身面板。FRONT VIEW 与 BACK VIEW 两个全身面板必须是同一角色、同一服装版本、同一身高比例、同一灯光和同一尺度；正面、背面站姿稳定，手臂自然下垂或微微离身，从头到脚完整展示服装轮廓、身高比例和体态重心。FACE DETAIL CLOSE-UP 面板只补充眼部、嘴形、发饰、妆容或局部身份细节，必须和左侧 FACE HERO CLOSE-UP 是同一张脸。COSTUME / SUIT DETAIL VIEW 与 MATERIAL & TEXTURE NOTES 只能在右侧三分之二区域内展示衣领、袖口、腰带、鞋靴、配饰、边缘轮廓、金属/布料/皮革/绷带等材质细节。取消色板区和调色块模块；不得生成横跨全画幅的底部材质栏。若基础描述包含“专属物品设定”，只在右侧 SIGNATURE PROP / EQUIPMENT DETAIL 小窗或材质区附近的干净陈列格展示，用来节省 Seedance 2.0 参考图位；不要出现第二个人、打斗动作或剧情剧照；不要海报构图、漫画分镜、随机贴纸拼贴或自由排版；除固定模块标签外不要长段说明文字、Logo或水印。超高清，4K细节密度，电影级工业角色参考表。`;
        break;
      case 'portrait_outfit':
        conceptGuidance = `这是一张竖屏（9:16）角色变装定妆照。
要求：
- 只允许出现一个角色本人，不能出现第二个人、双人互动、群像或剧情剧照
- 竖屏构图，与正面大特写构图类似但从头到脚/膝盖
- 展现变装后的完整服装造型
- 同一角色但穿着不同的服装/造型
- 保持面部特征与正面大特写一致（五官、发型可变但人脸一致）
- 使用静态定妆站姿或轻微自然站姿，充分展示服装，不要加入剧情动作
- 不要出现武器、刀剑、枪械、弓箭、法器、手持道具或佩戴在身上的武器
- 背景简洁纯净，不要加入可识别的具体场景、建筑、街道或复杂陈设`;
        break;
      case 'landscape_outfit_turnaround':
        conceptGuidance = `16:9横版构图，变装版工业角色参考表 / CHARACTER REFERENCE SHEET，变装后角色严格按照参考图片保持同一张脸、发型可控变化、当前变装服装版本和体态比例。版式必须稳定：顶部浅灰技术标题栏，写入 CHARACTER REFERENCE | OUTFIT VERSION | 角色名；主体区采用固定左三分之一脸部竖栏版式，必须显示清晰英文模块标签：FACE HERO CLOSE-UP、FRONT VIEW、BACK VIEW、FACE DETAIL CLOSE-UP、COSTUME / SUIT DETAIL VIEW。FACE HERO CLOSE-UP 必须独占画布左侧固定三分之一宽度，约33%-35%画布宽，从标题栏下沿一直延伸到主体底部；左侧竖栏下方不得再横跨 MATERIAL、服装细节、专属物品、色板或任何信息条。FACE HERO CLOSE-UP 内必须是纯人脸大特写，不是头像半身照；脸部必须占左侧竖栏画面90%以上，画面只允许脸、五官、耳朵、发际线和少量头发，额头到下巴清晰完整，锁定同一张脸和可控发型变化；严禁出现肩颈、胸口、衣领、上半身、手部或半身构图。右侧三分之二区域才放 FRONT VIEW、BACK VIEW、FACE DETAIL CLOSE-UP、COSTUME / SUIT DETAIL VIEW 和 MATERIAL & TEXTURE NOTES；取消侧身全身面板。FRONT VIEW 与 BACK VIEW 两个全身面板必须是同一角色、同一变装服装版本、同一身高比例、同一灯光和同一尺度；稳定站姿，从头到脚完整展示当前服装轮廓、材质和层次。FACE DETAIL CLOSE-UP 面板只补充眼部、嘴形、发饰、妆容或局部身份细节，必须和左侧 FACE HERO CLOSE-UP 是同一张脸。COSTUME / SUIT DETAIL VIEW 与 MATERIAL & TEXTURE NOTES 只能在右侧三分之二区域内展示当前变装服装的衣领、袖口、腰带、鞋靴、配饰、边缘轮廓、材质纹理。取消色板区和调色块模块；不得生成横跨全画幅的底部材质栏。若基础描述包含“专属物品设定”，只在右侧 SIGNATURE PROP / EQUIPMENT DETAIL 小窗或材质区附近的干净陈列格展示；不要出现第二个人、打斗动作或剧情剧照；不要海报构图、漫画分镜、随机贴纸拼贴或自由排版；除固定模块标签外不要长段说明文字、Logo或水印。超高清，4K细节密度，电影级工业角色参考表。`;
        break;
      default:
        conceptGuidance = `详细描写这个角色的外貌、服装、姿态、光线和色调氛围。`;
    }

    const focusGuidance = characterFocus === 'lead'
      ? `角色定位：这是作品核心主角。
必须强化主角感：高颜值、主视觉中心、强辨识度、电影海报级打光、五官精致立体、眼神有戏、轮廓清晰、服装质感高级、镜头气场强。
避免普通路人脸、寡淡表情、群演感、网红自拍感、廉价影楼感。`
      : characterFocus === 'key'
        ? `角色定位：这是重要角色。
需要明显高于普通配角的辨识度和镜头表现力，人物形象要好看、利落、可信，有清晰的角色魅力和电影感。`
        : `角色定位：这是普通角色/配角。
保证人物自然、准确、可信即可，不要写成主视觉海报级夸张主角镜头。`;

    return `你是一个电影级别AI图片提示词专家。

基础描述（这是最终 prompt 的事实基底，里面明确写到的视觉信息必须保留）：
${safeDescription}
${contextBlock}
项目风格：${styleConfig}
${threeDAnimeStyleLock ? `\n风格硬约束：${threeDAnimeStyleLock}\n` : ''}

内部提示词画像（必须吸收进最终 prompt，但不要逐字照搬成标题）：
${profileGuidance}

请在不丢失基础描述具体细节的前提下，生成一段适合AI图片生成的中文提示词。
${conceptGuidance}
${focusGuidance}
${genderGuidance ? `${genderGuidance}\n` : ''}

通用要求：
1. 使用中文输出
2. 绝对保留基础描述里已经明确写出的年龄感、气质、发型、面部特征、服装、配饰、颜色、材质等具体信息；竖屏定妆照不能加入武器或手持道具；横屏角色设定板仅允许基础描述明确标为“专属物品设定”的长期专属稳定物品进入小窗/陈列区，刺杀/受伤/打斗等剧情动作不能进入角色资产
3. 你可以补充镜头、光影方向、色调倾向、画面氛围，但不能把具体描述改写成空泛形容词
4. 如果原文未描述某方面，可基于角色身份和风格做保守推断，但不要覆盖已有信息
5. 如果是主角，请明显提升主角镜头质感、审美完成度和视觉吸引力，但不要脱离人物设定
6. 这类图是角色设定资产，不是剧情截图；不要补出具体场景、建筑、街道、室内陈设或剧情动作
7. 若补充上下文或原始描述里出现武器、刀剑、背刺、穿胸、双人互动，只能理解为剧情背景；除“专属物品设定”明确列出的稳定签名物外，不要输出到角色定妆/角色设定图 prompt
8. 如果基础描述已经很完整，请轻量润色，不要大幅重写

输出格式：
PROMPT: <中文提示词>`;
  }

  if (type === 'prop') {
    return `你是一个电影级别AI图片生成提示词专家。

基础描述（这是最终 prompt 的事实基底，里面明确写到的视觉信息必须保留）：
${description}
${contextBlock}
项目风格：${styleConfig}

内部提示词画像（必须吸收进最终 prompt，但不要逐字照搬成标题）：
${profileGuidance}

请在不丢失基础描述具体细节的前提下，生成一段适合AI图片生成的中文提示词，描写这个物品/道具的外观细节。
要求：
1. 使用中文输出
2. 绝对保留基础描述里的外观、大小、材质、结构、颜色、质感、状态、视觉锚点等具体信息
3. 重点补充多角度结构、尺寸比例、材质质感、光影反射、纹饰/刻痕、状态版本和使用方式局部示意，但不能替代已有细节
4. 如果物品有发光、悬浮等特殊效果，请明确描写
5. 这是 PROP REFERENCE SHEET 道具工业锁定板或 SMALL PROPS KIT 小道具合集板，不是剧情截图；核心剧情道具必须单件成板，小物件合集只在基础描述明确是一组配件/零散陈设时使用
6. 横屏构图（16:9），固定制作板结构：PROP REFERENCE 标题栏、HERO VIEW 主视图、FRONT/SIDE/TOP 多角度结构小窗、SCALE / HAND CONTACT 尺寸比例小窗、MATERIAL / TEXTURE 材质近景、STATE A-B-C 状态版本、USE DETAIL 使用方式局部示意、PALETTE 色块；合集图中每个小物件都要留白分隔、轮廓清楚、材质可辨，不互相遮挡
7. SCALE / HAND CONTACT 只允许中性手部剪影、手套手或比例尺辅助锁尺寸；USE DETAIL 只做插入、按压、打开、掉落朝向、佩挂点、锁孔接触等干净局部示意，不要完整人物持拿动作
8. 输出要服务 Seedance 2.0 全能参考模式最多9张图：关键情节道具优先单独成图，普通小物件可合集或交给场景导演板/文字描述，不要把无关杂物混进核心道具图
9. 不要出现角色脸、清晰人物、完整人物动作、佩戴动作、复杂场景背景、剧情截图、漫画分镜、长段说明文字、随机编号、Logo或水印；只允许固定英文模块标签
10. 如果基础描述已经足够完整，请只做轻量润色，不要改写成更空泛的版本

输出格式：
PROMPT: <中文提示词>`;
  }

  const sceneOutputRatio = concept === 'scene_vertical' ? '竖屏9:16' : '横屏16:9';
  const sceneConceptLine = concept === 'scene_vertical'
    ? '这是竖屏 ENVIRONMENT / SET DESIGN 场景导演板，不是横屏母版的图生图裁切，也不是某个分镜截图。必须包含上方竖屏主环境图和下方 FLOOR PLAN / TOP-DOWN BLOCKING MAP，用来同时锁定9:16真实空间与定位走位。'
    : '这是横屏 ENVIRONMENT / SET DESIGN 场景导演板，不是某个分镜截图。必须包含上方横屏主环境图和下方 FLOOR PLAN / TOP-DOWN BLOCKING MAP，用来同时锁定16:9真实空间与定位走位。';
  const sceneBoardLegendLine = '俯视图必须是简洁高对比图纸/蓝图/浅灰底矢量式，不要照片质感、电影阴影或暗色氛围图；制作板必须有黑底白字或深灰底白字的大号模块标题条 MAIN ENVIRONMENT、TOP-DOWN BLOCKING MAP、CAMERA 1-6、LEGEND，标题条只能放在画面分隔栏/边框上，不能画进主环境图；模块标题高度约为画布高度3%-5%；CAMERA 1-6 编号和图例短标签要比普通文字放大1.5-2倍，缩略图下仍可读；固定图例颜色：ENTRY 蓝色箭头，EXIT 红色箭头，SAFE ACTION ZONE 绿色矩形，OBSTACLE / MACHINE 灰色块，STRUCTURAL COLUMN 橙棕色方块，CAMERA POSITION 蓝色编号圆点，CAMERA MOVE 蓝色虚线箭头。';

  return `你是一个电影级别AI图片生成提示词专家。

基础描述（这是最终 prompt 的事实基底，里面明确写到的视觉信息必须保留）：
${description}
${contextBlock}
项目风格：${styleConfig}

内部提示词画像（必须吸收进最终 prompt，但不要逐字照搬成标题）：
${profileGuidance}

请在不丢失基础描述具体细节的前提下，生成一段适合AI图片生成的中文提示词，描写这个场景资产的环境、光线、色调、空间结构和定位关系。
要求：
1. 使用中文输出
2. 绝对保留基础描述里的环境、空间布局、关键陈设、灯光、天气、色调、氛围、时间等具体信息
3. ${sceneConceptLine}禁止出现人物、人形、人影，也不要写入具体动作瞬间
4. 如果是横屏场景导演板：明确写出“顶部约55%-60%主环境图、底部约40%-45% FLOOR PLAN / TOP-DOWN BLOCKING MAP”的版式；底部俯视图必须占底部区域至少76%宽度，LEGEND 只能做右侧窄条且不得超过底部区域宽度18%；俯视图里要有入口/出口、核心锚点、可行动路线、障碍物、角色入画安全区、CAMERA 1-6 机位和运动箭头；主环境图必须保持干净真实，不出现文字
5. 如果是竖屏场景导演板：明确写出“顶部约58%-62%竖屏主环境图、底部约34%-38% FLOOR PLAN / TOP-DOWN BLOCKING MAP”的版式；底部俯视图必须占底部区域至少78%宽度，LEGEND 只能做右侧窄条且不得超过底部区域宽度18%，不要额外 SIDE ELEVATION 小窗挤压地图；俯视图里要按9:16视频运动设计入口/出口、核心锚点、可行动路线、障碍物、角色入画安全区、CAMERA 1-6 机位和运动箭头；主环境图必须保持干净真实，不出现文字
6. ${sceneBoardLegendLine}
7. 至少写出5个空间锚点在主环境图和俯视图中一一对应，锚点优先使用 ENTRY DOOR / EXIT DOOR / CENTRAL COLUMN / RIGHT MACHINE / SAFE ACTION ZONE / HANGING CHAIN；主环境图里真实画出这些物体，俯视图用短英文标签标出这些锚点；不要让底部俯视图变成另一张氛围图
8. 优先补充整体空间布局、关键陈设、前中后景层次、建筑结构/自然景观、天空地面关系、入口出口关系、目标点/障碍物位置和稳定光线，不要把它写成单一镜头特写
9. 如果基础描述已经足够完整，请只做轻量润色，不要改写成更空泛的版本
10. 输出画幅必须是${sceneOutputRatio}；在提示词末尾明确添加"无人物，无人影，无人形"

输出格式：
PROMPT: <中文提示词>`;
}

function stripCodeFence(text: string): string {
  const match = text.trim().match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1].trim() : text.trim();
}

function tryExtractJsonPrompt(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { prompt?: unknown; PROMPT?: unknown };
    const prompt = parsed.prompt ?? parsed.PROMPT;
    return typeof prompt === 'string' ? prompt.trim() : null;
  } catch {
    return null;
  }
}

export function parseLLMResponse(text: string): string {
  const normalized = stripCodeFence(text);
  const jsonPrompt = tryExtractJsonPrompt(normalized);
  if (jsonPrompt) return jsonPrompt;

  const promptMatch = normalized.match(/PROMPT\s*[:：]\s*([\s\S]*)$/i);
  const candidate = stripCodeFence(promptMatch ? promptMatch[1] : normalized)
    .replace(/^["'“”`]+|["'“”`]+$/g, '')
    .trim();

  return candidate;
}
