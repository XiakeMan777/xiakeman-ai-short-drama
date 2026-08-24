const DEFAULT_SEEDANCE_POLL_INTERVAL_MS = 30_000;
const DEFAULT_SEEDANCE_TIMEOUT_MS = 120 * 60_000;
const DEFAULT_SEEDANCE_SUBMIT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_SEEDANCE_TASK_RECOVERY_TIMEOUT_MS = 60_000;
const DEFAULT_SEEDANCE_CLOUD_API_BASE = String(
  process.env.SEEDANCE_CLOUD_API_BASE || 'http://127.0.0.1:8034/api',
).trim().replace(/\/+$/, '');
const SEEDANCE_CLOUD_BASE_ALIASES = new Map([
  ['/api/seedance-cloud', DEFAULT_SEEDANCE_CLOUD_API_BASE],
  ['http://127.0.0.1:8034', DEFAULT_SEEDANCE_CLOUD_API_BASE],
  ['http://127.0.0.1:8034/api', DEFAULT_SEEDANCE_CLOUD_API_BASE],
  ['http://localhost:8034', DEFAULT_SEEDANCE_CLOUD_API_BASE],
  ['http://localhost:8034/api', DEFAULT_SEEDANCE_CLOUD_API_BASE],
]);
const URL_TEXT_MEDIA_MAX_BYTES = 16 * 1024;
const SD2_PUBLIC_MEDIA_OBJECT_STORAGE_OVERRIDE = { prefix: '', publicRead: true };
const SD2_PUBLIC_MEDIA_FALLBACK_OBJECT_STORAGE_OVERRIDE = { publicRead: true };

const {
  createCloudBlobDownloadUrlsForUser,
} = require('./cloud-store');
const {
  createPublicObjectUrl,
  getObjectBuffer,
  putObjectBuffer,
  sha256,
} = require('./object-storage');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function extractSingleHttpUrl(text) {
  const trimmed = getText(text);
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : '';
}

function normalizeMediaRole(role) {
  const text = getText(role).replace(/-/g, '_');
  if (text === 'audio') return 'audio';
  if (text === 'video' || text === 'reference_video' || text === 'source_video') return 'video';
  return 'image';
}

function getExpectedMediaPrefix(role) {
  const normalized = normalizeMediaRole(role);
  if (normalized === 'audio') return 'audio/';
  if (normalized === 'video') return 'video/';
  return 'image/';
}

function getMediaExtension(item, role) {
  const contentType = getText(item?.content_type || item?.contentType).toLowerCase();
  const fileName = getText(item?.file_name || item?.fileName);
  const fileExt = (() => {
    const match = fileName.match(/\.([a-z0-9]{2,5})(?:$|\?)/i);
    return match ? `.${match[1].toLowerCase()}` : '';
  })();
  if (role === 'image') {
    if (contentType === 'image/jpeg' || contentType === 'image/jpg') return '.jpg';
    if (contentType === 'image/png') return '.png';
    if (contentType === 'image/webp') return '.webp';
    if (fileExt) return fileExt;
    return '.png';
  }
  if (role === 'audio') {
    if (contentType === 'audio/mpeg') return '.mp3';
    if (contentType === 'audio/wav' || contentType === 'audio/x-wav') return '.wav';
    if (contentType === 'audio/mp4') return '.m4a';
    if (fileExt) return fileExt;
    return '.mp3';
  }
  if (contentType === 'video/webm') return '.webm';
  if (contentType === 'video/quicktime') return '.mov';
  if (fileExt) return fileExt;
  return '.mp4';
}

function getSd2MediaKind(role) {
  if (role === 'audio') return 'audio';
  if (role === 'video' || role === 'reference_video') return 'video';
  return 'image';
}

async function mirrorCosItemToSd2PublicUrl(item, role) {
  const objectKey = getText(item?.object_key || item?.objectKey || item?.key);
  if (!objectKey) {
    console.warn('[step5-video-job] skip sd2 public media mirror: missing COS object key', {
      role,
      source: item?.source,
      fileName: item?.file_name || item?.fileName,
      hasUrl: !!item?.url,
    });
    return item;
  }
  const buffer = await getObjectBuffer(objectKey);
  const digest = sha256(buffer);
  const kind = getSd2MediaKind(role);
  const ext = getMediaExtension(item, kind);
  const publicObjectKey = `sd2-media/${kind}/${digest.slice(0, 2)}/${digest}${ext}`;
  const contentType = getText(item?.content_type || item?.contentType) || 'application/octet-stream';
  let publicUrl;
  let publicObjectKeyPrefix = 'root';
  try {
    await putObjectBuffer(publicObjectKey, buffer, contentType, SD2_PUBLIC_MEDIA_OBJECT_STORAGE_OVERRIDE);
    publicUrl = await createPublicObjectUrl(publicObjectKey, SD2_PUBLIC_MEDIA_OBJECT_STORAGE_OVERRIDE);
  } catch (error) {
    console.warn('[step5-video-job] root sd2 public media mirror failed, fallback to configured COS prefix', {
      publicObjectKey,
      error: error instanceof Error ? error.message : String(error),
    });
    publicObjectKeyPrefix = 'configured';
    await putObjectBuffer(publicObjectKey, buffer, contentType, SD2_PUBLIC_MEDIA_FALLBACK_OBJECT_STORAGE_OVERRIDE);
    publicUrl = await createPublicObjectUrl(publicObjectKey, SD2_PUBLIC_MEDIA_FALLBACK_OBJECT_STORAGE_OVERRIDE);
  }
  return {
    ...item,
    url: publicUrl,
    public_object_key: publicObjectKey,
    public_object_key_prefix: publicObjectKeyPrefix,
    source: 'cos-public',
  };
}

async function mirrorMediaToSd2PublicUrls(media) {
  return {
    ...media,
    images: await Promise.all(media.images.map((item) => mirrorCosItemToSd2PublicUrl(item, 'image'))),
    audios: await Promise.all(media.audios.map((item) => mirrorCosItemToSd2PublicUrl(item, 'audio'))),
    sourceVideo: media.sourceVideo
      ? await mirrorCosItemToSd2PublicUrl(media.sourceVideo, 'reference_video')
      : null,
  };
}

function isLikelyTextUrlMedia(contentType, sizeBytes) {
  const type = getText(contentType).toLowerCase();
  const size = Number(sizeBytes || 0);
  return type.startsWith('text/')
    || type.includes('json')
    || type.includes('xml')
    || ((type === 'application/octet-stream' || !type) && size > 0 && size <= URL_TEXT_MEDIA_MAX_BYTES);
}

function isClearlyTextResponse(contentType) {
  const type = getText(contentType).toLowerCase();
  return type.startsWith('text/')
    || type.includes('json')
    || type.includes('xml')
    || type.includes('html');
}

async function fetchSmallText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Remote media text url cannot be read: HTTP ${response.status}`);
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > URL_TEXT_MEDIA_MAX_BYTES) return '';
  const text = await response.text();
  return text.length <= URL_TEXT_MEDIA_MAX_BYTES ? text : '';
}

function bufferLooksLikeText(buffer) {
  if (!buffer || buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 512));
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 0x80) {
      printable += 1;
    }
  }
  return printable / sample.length > 0.9;
}

async function inspectRemoteMediaByRange(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: `bytes=0-${URL_TEXT_MEDIA_MAX_BYTES - 1}` },
    });
    if (!response.ok && response.status !== 206) {
      return { ok: false, status: response.status };
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = getText(response.headers.get('content-type'));
    const contentLength = Number(response.headers.get('content-length') || 0) || undefined;
    const textPreview = bufferLooksLikeText(buffer)
      ? buffer.toString('utf8').trim().slice(0, URL_TEXT_MEDIA_MAX_BYTES)
      : '';
    return {
      ok: true,
      status: response.status,
      contentType,
      contentLength,
      byteLength: buffer.length,
      textPreview,
      singleUrl: extractSingleHttpUrl(textPreview),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function validateResolvedMediaUrl(url, role) {
  const expectedPrefix = getExpectedMediaPrefix(role);
  const inspected = await inspectRemoteMediaByRange(url);
  if (!inspected.ok) return;
  if (inspected.singleUrl) {
    throw new Error(`Remote media URL still returns a text URL instead of ${expectedPrefix}*: ${url.slice(0, 180)} -> ${inspected.singleUrl.slice(0, 180)}`);
  }
  const contentType = getText(inspected.contentType).toLowerCase();
  if (!contentType || contentType === 'application/octet-stream') return;
  if (contentType.startsWith(expectedPrefix)) return;
  if (isClearlyTextResponse(contentType)) {
    throw new Error(`Remote media URL still returns text instead of ${expectedPrefix}*: ${url.slice(0, 180)}`);
  }
}

async function inspectRemoteMediaUrl(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) return { ok: false, status: response.status };
    return {
      ok: true,
      status: response.status,
      contentType: getText(response.headers.get('content-type')),
      contentLength: Number(response.headers.get('content-length') || 0) || undefined,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function resolveUrlTextMediaItem(item, role, depth = 0) {
  if (!item?.url || depth > 2) {
    return item;
  }

  const expectedPrefix = getExpectedMediaPrefix(role);
  const metadataContentType = item.content_type || item.contentType;
  const metadataSizeBytes = item.size_bytes || item.sizeBytes;
  const rangeInspection = await inspectRemoteMediaByRange(item.url);
  if (rangeInspection.ok && rangeInspection.singleUrl && rangeInspection.singleUrl !== item.url) {
    const resolved = {
      ...item,
      url: rangeInspection.singleUrl,
      source: item.source === 'cos' ? 'resolved-url-text' : item.source,
      original_url: item.url,
    };
    console.info('[step5-video-job] resolved range-detected url-text media item', {
      role,
      source: item.source,
      metadataContentType,
      rangeContentType: rangeInspection.contentType,
      originalUrl: item.url,
      resolvedUrl: rangeInspection.singleUrl,
    });
    return resolveUrlTextMediaItem(resolved, role, depth + 1);
  }

  let shouldReadAsText = isLikelyTextUrlMedia(metadataContentType, metadataSizeBytes);
  let inspected;

  if (!shouldReadAsText) {
    inspected = rangeInspection.ok ? rangeInspection : await inspectRemoteMediaUrl(item.url);
    const inspectedType = getText(inspected.contentType).toLowerCase();
    if (inspected.ok && inspectedType.startsWith(expectedPrefix)) {
      return {
        ...item,
        content_type: item.content_type || item.contentType || inspected.contentType,
        size_bytes: item.size_bytes || item.sizeBytes || inspected.contentLength,
      };
    }
    shouldReadAsText = inspected.ok && (
      isClearlyTextResponse(inspectedType)
      || ((inspectedType === 'application/octet-stream' || !inspectedType)
        && Number(inspected.contentLength || 0) > 0
        && Number(inspected.contentLength || 0) <= URL_TEXT_MEDIA_MAX_BYTES)
    );
  }

  if (!shouldReadAsText) {
    if (inspected?.ok && inspected.contentType && !getText(inspected.contentType).toLowerCase().startsWith(expectedPrefix)) {
      console.warn('[step5-video-job] remote media content type is not expected media', {
        role,
        contentType: inspected.contentType,
        url: item.url,
        textPreview: inspected.textPreview?.slice(0, 240),
      });
    }
    return item;
  }

  const text = await fetchSmallText(item.url);
  const resolvedUrl = extractSingleHttpUrl(text);
  if (!resolvedUrl || resolvedUrl === item.url) {
    console.warn('[step5-video-job] remote media url returned text but no direct url was found', {
      role,
      contentType: metadataContentType,
      sizeBytes: metadataSizeBytes,
      url: item.url.slice(0, 180),
      textPreview: text.slice(0, 180),
    });
    return item;
  }

  await validateResolvedMediaUrl(resolvedUrl, role);
  const resolved = {
    ...item,
    url: resolvedUrl,
    source: item.source === 'cos' ? 'resolved-url-text' : item.source,
    original_url: item.url,
  };
  console.info('[step5-video-job] resolved url-text media item', {
    role,
    source: item.source,
    originalUrl: item.url.slice(0, 180),
    resolvedUrl: resolvedUrl.slice(0, 180),
  });
  return resolveUrlTextMediaItem(resolved, role, depth + 1);
}

async function buildMediaDiagnostic(item, role, index) {
  const inspected = item?.url ? await inspectRemoteMediaByRange(item.url) : { ok: false, error: 'missing url' };
  return {
    index,
    role,
    fileName: item?.file_name || item?.fileName,
    source: item?.source,
    objectKey: item?.object_key || item?.objectKey,
    contentType: item?.content_type || item?.contentType,
    sizeBytes: item?.size_bytes || item?.sizeBytes,
    url: item?.url,
    originalUrl: item?.original_url || item?.originalUrl,
    range: inspected.ok
      ? {
          status: inspected.status,
          contentType: inspected.contentType,
          contentLength: inspected.contentLength,
          byteLength: inspected.byteLength,
          singleUrl: inspected.singleUrl,
          textPreview: inspected.textPreview ? inspected.textPreview.slice(0, 240) : undefined,
        }
      : inspected,
  };
}

async function logSeedanceSubmitMediaDiagnostics(media, context) {
  try {
    const images = await Promise.all(media.images.map((item, index) => buildMediaDiagnostic(item, 'image', index)));
    const audios = await Promise.all(media.audios.map((item, index) => buildMediaDiagnostic(item, 'audio', index)));
    const sourceVideo = media.sourceVideo
      ? await buildMediaDiagnostic(media.sourceVideo, 'reference_video', 0)
      : null;
    console.info('[step5-video-job] seedance submit media diagnostics', JSON.stringify({
      ...context,
      imageCount: media.images.length,
      audioCount: media.audios.length,
      hasSourceVideo: !!media.sourceVideo,
      images,
      audios,
      sourceVideo,
    }, null, 2));
  } catch (error) {
    console.warn('[step5-video-job] seedance submit media diagnostics failed', {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function normalizeFrameRatio(value) {
  const text = getText(value);
  if (text === '16:9' || text === '9:16' || text === '1:1') return text;
  return '16:9';
}

function getTransit9Resolution(model, resolution) {
  const normalizedModel = getText(model);
  const normalizedResolution = getText(resolution).toLowerCase();
  const requested = ['480p', '720p', '1080p', '4k'].includes(normalizedResolution)
    ? normalizedResolution
    : '720p';
  if (normalizedModel === 'mini' || normalizedModel === 'fast') {
    return requested === '480p' ? '480p' : '720p';
  }
  if (normalizedModel === '2.0') {
    return ['480p', '720p', '1080p', '4k'].includes(requested) ? requested : '720p';
  }
  if (normalizedModel === 'transit9-fast') return '720p';
  if (normalizedModel === 'transit9-2.0') return requested === '1080p' ? '1080p' : '720p';
  return '';
}

function getInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function normalizeBaseUrl(value) {
  const text = getText(value).replace(/\/+$/, '');
  if (!text) return '';
  const parsed = new URL(text);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Step5 video apiBase must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Step5 video apiBase must not include credentials');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function normalizeSeedanceCloudApiBase(value) {
  const raw = getText(value).replace(/\/+$/, '');
  return SEEDANCE_CLOUD_BASE_ALIASES.get(raw) || raw || DEFAULT_SEEDANCE_CLOUD_API_BASE;
}

function getSeedanceLicenseKey(input) {
  return getText(process.env.SEEDANCE_CLOUD_LICENSE_KEY)
    || getText(process.env.SEEDANCE_LICENSE_KEY)
    || getText(input.seedanceCloudLicenseKey);
}

function getSeedanceApiBase(input) {
  return normalizeBaseUrl(normalizeSeedanceCloudApiBase(
    input.seedanceApiBase
    || process.env.SEEDANCE_CLOUD_API_BASE
    || process.env.SEEDANCE_API_BASE
    || DEFAULT_SEEDANCE_CLOUD_API_BASE,
  ));
}

async function fetchSeedanceJson(url, licenseKey) {
  const headers = {};
  if (licenseKey) headers['X-License-Key'] = licenseKey;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text.slice(0, 300) || `Seedance HTTP ${response.status}`);
  }
  return await response.json();
}

async function postSeedanceCancel(apiBase, licenseKey, taskId) {
  const response = await fetch(`${apiBase}/task/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST',
    headers: buildSeedanceHeaders(licenseKey),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text().catch(() => '');
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    const message = getText(payload?.message || payload?.error?.message) || text || `Seedance cancel HTTP ${response.status}`;
    return { success: false, taskId, status: response.status, message };
  }
  return {
    success: payload?.cancelled !== false && payload?.status !== 'error',
    taskId,
    status: response.status,
    message: getText(payload?.message || payload?.error?.message) || 'Seedance remote task cancel requested',
    payload,
  };
}

function buildSeedanceHeaders(licenseKey) {
  const headers = {};
  if (licenseKey) headers['X-License-Key'] = licenseKey;
  return headers;
}

function appendJsonArrayField(formData, field, values) {
  if (values.length > 0) formData.append(field, JSON.stringify(values));
}

function mediaItemsToUrls(items) {
  return asArray(items)
    .map((item) => getText(item?.url || item?.downloadUrl || item?.download_url || item))
    .filter(Boolean);
}

function appendMediaUrlArrayField(formData, field, values) {
  appendJsonArrayField(formData, field, mediaItemsToUrls(values));
}

function getSeedanceTaskIdFromPayload(payload) {
  return getText(payload?.task_id)
    || getText(payload?.taskId)
    || getText(payload?.id)
    || getText(payload?.data?.task_id)
    || getText(payload?.data?.taskId);
}

function appendSeedanceAuthQuery(url, licenseKey) {
  const normalizedUrl = getText(url);
  const normalizedLicenseKey = getText(licenseKey);
  if (!normalizedUrl || !normalizedLicenseKey) return normalizedUrl;
  try {
    const parsed = new URL(normalizedUrl);
    if (!parsed.searchParams.get('license_key')) {
      parsed.searchParams.set('license_key', normalizedLicenseKey);
    }
    return parsed.toString();
  } catch {
    return normalizedUrl;
  }
}

function resolveSeedanceUrl(url, apiBase, licenseKey) {
  const value = getText(url);
  if (!value) return '';
  let resolved = value;
  try {
    resolved = new URL(value, apiBase).toString();
  } catch {
    return value;
  }
  const pathname = (() => {
    try {
      return new URL(resolved).pathname;
    } catch {
      return '';
    }
  })();
  return pathname.startsWith('/api/video/') || pathname.startsWith('/video/')
    ? appendSeedanceAuthQuery(resolved, licenseKey)
    : resolved;
}

function buildSeedanceVideoUrl(apiBase, taskId, licenseKey) {
  const url = `${apiBase}/video/${encodeURIComponent(taskId)}`;
  return appendSeedanceAuthQuery(url, licenseKey);
}

function getSeedanceVideoUrlFromPayload(payload, apiBase = '', licenseKey = '') {
  const rawUrl = getText(payload?.video_url)
    || getText(payload?.videoUrl)
    || getText(payload?.official_video_url)
    || getText(payload?.officialVideoUrl)
    || getText(payload?.stable_video_url)
    || getText(payload?.stableVideoUrl)
    || getText(payload?.local_video_url)
    || getText(payload?.localVideoUrl)
    || getText(payload?.mp4_url)
    || getText(payload?.mp4Url)
    || getText(payload?.data?.video_url)
    || getText(payload?.data?.videoUrl)
    || getText(payload?.data?.official_video_url)
    || getText(payload?.data?.stable_video_url)
    || getText(payload?.data?.mp4_url);
  return apiBase ? resolveSeedanceUrl(rawUrl, apiBase, licenseKey) : rawUrl;
}

function normalizeSeedanceStatus(value) {
  const status = getText(value).toLowerCase();
  if (['success', 'succeeded', 'completed', 'done', 'finish', 'finished'].includes(status)) return 'success';
  if (['failed', 'error', 'cancelled', 'canceled', 'timeout'].includes(status)) return 'failed';
  return status || 'unknown';
}

function getImageFileName(media, index) {
  const supplied = getText(media.fileName || media.file_name);
  if (supplied) return supplied;
  const contentType = getText(media.contentType || media.content_type).toLowerCase();
  const extension = contentType === 'image/webp'
    ? 'webp'
    : contentType === 'image/jpeg'
      ? 'jpg'
      : 'png';
  return `image-reference-${String(index + 1).padStart(2, '0')}.${extension}`;
}

function getAudioFileName(media, index) {
  const supplied = getText(media.fileName || media.file_name);
  if (supplied) return supplied;
  const character = getText(media.characterName || media.character_name || 'character')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'character';
  return `voice-reference-${String(index + 1).padStart(2, '0')}-${character}.wav`;
}

function getSourceVideoFileName(media, storyboardIndex) {
  const supplied = getText(media.fileName || media.file_name);
  if (supplied) return supplied;
  const suffix = Number.isFinite(Number(storyboardIndex))
    ? String(Number(storyboardIndex) + 1).padStart(2, '0')
    : 'previous';
  return `source-storyboard-${suffix}.mp4`;
}

function normalizeMediaManifest(rawMedia) {
  const media = asObject(rawMedia);
  const flat = asArray(rawMedia);
  const images = [
    ...asArray(media.images),
    ...flat.filter((item) => getText(item?.role).replace(/-/g, '_') === 'image'),
  ].map(asObject);
  const audios = [
    ...asArray(media.audios),
    ...asArray(media.audio),
    ...flat.filter((item) => getText(item?.role).replace(/-/g, '_') === 'audio'),
  ].map(asObject);
  const referenceVideos = [
    ...asArray(media.referenceVideos),
    ...asArray(media.reference_videos),
    ...flat.filter((item) => {
      const role = getText(item?.role).replace(/-/g, '_');
      return role === 'reference_video' || role === 'video';
    }),
  ].map(asObject);
  const sourceVideo = asObject(media.sourceVideo || media.source_video || referenceVideos[0]);
  return { images, audios, referenceVideos, sourceVideo };
}

async function resolveCloudMediaUrls(job, item, input) {
  const projectId = getText(item.projectId || input.projectId || job.projectId);
  if (!projectId) throw new Error('Step5 backend video job requires projectId for COS media');

  const manifest = normalizeMediaManifest(item.media || input.media || {});
  const blobKeys = [
    ...manifest.images.map((media) => getText(media.blobKey || media.blob_key)),
    ...manifest.audios.map((media) => getText(media.blobKey || media.blob_key)),
    getText(manifest.sourceVideo.blobKey || manifest.sourceVideo.blob_key),
  ].filter(Boolean);

  const uniqueBlobKeys = [...new Set(blobKeys)];
  const blobByKey = new Map();
  if (uniqueBlobKeys.length > 0) {
    const payload = await createCloudBlobDownloadUrlsForUser(job.userId, projectId, uniqueBlobKeys);
    for (const blob of asArray(payload.blobs)) {
      blobByKey.set(blob.blobKey, blob);
    }
  }

  function directItem(media, fallbackFileName) {
    const url = getText(media.url || media.downloadUrl || media.download_url);
    if (url) {
      return {
        url,
        file_name: getText(media.fileName || media.file_name) || fallbackFileName,
        content_type: getText(media.contentType || media.content_type) || 'application/octet-stream',
        size_bytes: Number(media.sizeBytes || media.size_bytes || 0) || undefined,
        source: getText(media.source) || 'url',
      };
    }

    const blobKey = getText(media.blobKey || media.blob_key);
    const blob = blobByKey.get(blobKey);
    if (!blob?.download?.url) throw new Error(`Cloud media is missing signed url for blobKey ${blobKey || '(empty)'}`);
    return {
      url: blob.download.url,
      file_name: getText(media.fileName || media.file_name) || fallbackFileName,
      content_type: blob.contentType || getText(media.contentType || media.content_type) || 'application/octet-stream',
      size_bytes: Number(blob.sizeBytes || media.sizeBytes || media.size_bytes || 0) || undefined,
      object_key: blob.objectKey,
      source: 'cos',
    };
  }

  async function resolvedDirectItem(media, fallbackFileName, role) {
    return resolveUrlTextMediaItem(directItem(media, fallbackFileName), role);
  }

  const images = await Promise.all(manifest.images.map((media, index) =>
    resolvedDirectItem(media, getImageFileName(media, index), 'image'),
  ));
  const audios = await Promise.all(manifest.audios.map((media, index) =>
    resolvedDirectItem(media, getAudioFileName(media, index), 'audio'),
  ));
  const hasSourceVideo = getText(manifest.sourceVideo.blobKey || manifest.sourceVideo.blob_key)
    || getText(manifest.sourceVideo.url || manifest.sourceVideo.downloadUrl || manifest.sourceVideo.download_url);
  const sourceVideo = hasSourceVideo
    ? await resolvedDirectItem(manifest.sourceVideo, getSourceVideoFileName(manifest.sourceVideo, item.sourceStoryboardIndex), 'video')
    : null;

  return {
    projectId,
    images,
    audios,
    sourceVideo,
  };
}

async function findSeedanceTaskByClientTaskId(apiBase, licenseKey, clientTaskId, timeoutMs = DEFAULT_SEEDANCE_TASK_RECOVERY_TIMEOUT_MS) {
  const normalizedClientTaskId = getText(clientTaskId);
  if (!normalizedClientTaskId) return null;
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const payload = await fetchSeedanceJson(`${apiBase}/tasks?limit=50`, licenseKey);
    const tasks = asArray(payload.tasks);
    const matched = tasks.find((task) => getText(task?.client_task_id) === normalizedClientTaskId);
    if (matched) return matched;
    await sleep(3000);
  }
  return null;
}

async function submitSeedanceVideo(item, input, context) {
  const apiBase = getSeedanceApiBase({ ...input, ...item });
  if (!apiBase) throw new Error('Step5 Seedance backend job requires absolute seedanceApiBase');
  const licenseKey = getSeedanceLicenseKey({ ...input, ...item });
  const clientTaskId = getText(item.clientTaskId || item.client_task_id)
    || `job-${context.workerId || 'worker'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const prompt = getText(item.prompt || input.prompt);
  if (!prompt) throw new Error('Step5 Seedance backend job item is missing prompt');

  const media = await mirrorMediaToSd2PublicUrls(await resolveCloudMediaUrls(context.job, item, input));
  if (media.images.length === 0 && !media.sourceVideo) {
    throw new Error('Step5 Seedance backend job requires at least one COS image or source video');
  }
  await logSeedanceSubmitMediaDiagnostics(media, {
    jobId: context.job?.id,
    userId: context.job?.userId,
    projectId: media.projectId,
    storyboardIndex: item.storyboardIndex,
    clientTaskId,
    apiBase,
  });

  const formData = new FormData();
  const productionMode = getText(item.productionMode || item.production_mode || 'normal') === 'extend' ? 'extend' : 'normal';
  const duration = getInteger(item.duration || input.duration, 15, 1, 60);
  const model = getText(item.model || input.model) || 'fast';
  const resolution = getTransit9Resolution(model, item.resolution || input.resolution);
  formData.append('prompt', prompt);
  formData.append('duration', String(duration));
  formData.append('ratio', normalizeFrameRatio(item.ratio || input.ratio));
  formData.append('model', model);
  if (resolution) formData.append('resolution', resolution);
  formData.append('client_task_id', clientTaskId);
  formData.append('media_numbering', 'independent_by_type');
  formData.append('image_reference_count', String(media.images.length));

  appendMediaUrlArrayField(formData, 'image_urls', media.images);
  if (media.audios.length > 0) {
    formData.append('voice_reference_count', String(media.audios.length));
    formData.append('audio_reference_count', String(media.audios.length));
    formData.append('voice_reference_media_type', 'audio');
    appendMediaUrlArrayField(formData, 'audio_urls', media.audios);
    appendMediaUrlArrayField(formData, 'voice_reference_audio_urls', media.audios);
    appendMediaUrlArrayField(formData, 'audio_reference_urls', media.audios);
    const characters = asArray(item.voiceReferenceCharacters || item.voice_reference_characters)
      .map(getText)
      .filter(Boolean);
    if (characters.length > 0) {
      formData.append('voice_reference_characters', JSON.stringify(characters));
      formData.append('audio_reference_characters', JSON.stringify(characters));
    }
  }

  if (productionMode === 'extend') {
    if (!media.sourceVideo) throw new Error('Step5 Seedance extension job is missing source video media');
    formData.append('mode', 'extend');
    formData.append('generation_mode', 'extend');
    formData.append('production_mode', 'extend');
    formData.append('extend', 'true');
    formData.append('require_extension', 'true');
    appendMediaUrlArrayField(formData, 'reference_video_urls', [media.sourceVideo]);
    appendMediaUrlArrayField(formData, 'imitation_video_urls', [media.sourceVideo]);
    if (item.sourceTaskId) formData.append('source_task_id', String(item.sourceTaskId));
    if (Number.isFinite(Number(item.sourceStoryboardIndex))) {
      formData.append('source_storyboard_index', String(Number(item.sourceStoryboardIndex)));
    }
  }

  formData.append('remote_media_source', 'cos');

  const submitTimeoutMs = Math.max(60_000, Number(item.submitTimeoutMs || input.submitTimeoutMs || DEFAULT_SEEDANCE_SUBMIT_TIMEOUT_MS));
  let response;
  try {
    response = await fetch(`${apiBase}/generate-video`, {
      method: 'POST',
      headers: buildSeedanceHeaders(licenseKey),
      body: formData,
      signal: AbortSignal.timeout(submitTimeoutMs),
    });
  } catch (error) {
    const recovered = await findSeedanceTaskByClientTaskId(apiBase, licenseKey, clientTaskId).catch(() => null);
    if (recovered?.task_id) {
      return {
        taskId: recovered.task_id,
        clientTaskId,
        recovered: true,
      };
    }
    throw error;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text.slice(0, 500) || `Seedance submit HTTP ${response.status}`);
  }

  const payload = await response.json();
  const taskId = getSeedanceTaskIdFromPayload(payload);
  if (!taskId) {
    const recovered = await findSeedanceTaskByClientTaskId(apiBase, licenseKey, clientTaskId).catch(() => null);
    if (recovered?.task_id) {
      return {
        taskId: recovered.task_id,
        clientTaskId,
        recovered: true,
      };
    }
    throw new Error('Seedance submit did not return task_id');
  }
  return {
    taskId,
    clientTaskId,
    videoUrl: getSeedanceVideoUrlFromPayload(payload, apiBase, licenseKey),
  };
}

function createCompletedVideoLinkOnly(item, videoUrl) {
  const outputBlobKey = getText(item.outputBlobKey || item.output_blob_key);
  return {
    videoUrl,
    outputBlobKey: outputBlobKey || undefined,
    cachedToCloud: false,
    linkOnly: true,
  };
}

async function pollSeedanceExistingTask(item, input, context) {
  const taskId = getText(item.providerTaskId || item.taskId);
  if (!taskId) throw new Error('Step5 Seedance poll item is missing providerTaskId');

  const apiBase = getSeedanceApiBase({ ...input, ...item });
  if (!apiBase) throw new Error('Step5 Seedance backend job requires absolute seedanceApiBase');

  const licenseKey = getSeedanceLicenseKey({ ...input, ...item });
  const timeoutMs = Math.max(60_000, Number(item.timeoutMs || input.timeoutMs || DEFAULT_SEEDANCE_TIMEOUT_MS));
  const pollIntervalMs = Math.max(5000, Number(item.pollIntervalMs || input.pollIntervalMs || DEFAULT_SEEDANCE_POLL_INTERVAL_MS));
  const startedAt = Date.now();
  let lastStatus = '';

  while (Date.now() - startedAt <= timeoutMs) {
    const heartbeat = await context.heartbeat();
    if (!heartbeat || heartbeat.status === 'cancelled') {
      const cancelled = await postSeedanceCancel(apiBase, licenseKey, taskId).catch((error) => ({
        success: false,
        taskId,
        message: error instanceof Error ? error.message : String(error),
      }));
      await context.event({
        level: cancelled.success ? 'success' : 'warning',
        phase: 'remote-cancel',
        message: cancelled.success ? `Seedance remote task cancelled ${taskId}` : `Seedance remote cancel failed ${taskId}: ${cancelled.message}`,
        data: cancelled,
      }).catch(() => undefined);
      return {
        ...item,
        status: 'cancelled',
        providerTaskId: taskId,
        error: cancelled.success ? '用户取消任务，已请求取消远端生成。' : `用户取消任务；远端取消失败：${cancelled.message}`,
        rawStatus: 'cancelled',
      };
    }
    const payload = await fetchSeedanceJson(`${apiBase}/task/${encodeURIComponent(taskId)}`, licenseKey);
    const status = normalizeSeedanceStatus(payload.status);
    const progress = Number(payload.progress || 0);
    lastStatus = status || lastStatus;
    await context.event({
      level: 'info',
      phase: 'step5-poll',
      message: `Seedance 轮询：${status || 'unknown'} ${Number.isFinite(progress) ? progress : 0}%`,
      data: {
        taskId,
        status,
        progress: Number.isFinite(progress) ? progress : 0,
        storyboardIndex: item.storyboardIndex,
      },
    });

    if (status === 'success') {
      const returnedVideoUrl = getSeedanceVideoUrlFromPayload(payload, apiBase, licenseKey);
      const fallbackVideoUrl = buildSeedanceVideoUrl(apiBase, taskId, licenseKey);
      const videoLink = createCompletedVideoLinkOnly(item, returnedVideoUrl || fallbackVideoUrl);
      return {
        ...item,
        status: 'succeeded',
        videoUrl: videoLink.videoUrl,
        videoBlobKey: undefined,
        outputBlobKey: videoLink.outputBlobKey,
        cachedToCloud: false,
        linkOnly: true,
        progress: 100,
        rawStatus: status,
        providerTaskId: taskId,
        clientTaskId: getText(item.clientTaskId || item.client_task_id) || undefined,
      };
    }

    if (status === 'failed') {
      return {
        ...item,
        status: 'failed',
        error: getText(payload.error_message) || 'Seedance 视频生成失败',
        rawStatus: status,
      };
    }

    await sleep(pollIntervalMs);
  }

  return {
    ...item,
    status: 'failed',
    error: `Seedance 视频生成超时，最后状态：${lastStatus || 'unknown'}`,
    rawStatus: lastStatus,
  };
}

function collectSeedanceProviderTasks(job) {
  const output = asObject(job.output);
  const progress = asObject(job.progress);
  const input = asObject(job.input);
  const candidates = [
    ...asArray(output.providerTasks),
    ...asArray(output.items),
    ...asArray(progress.providerTasks),
    ...asArray(input.items),
  ];
  const tasks = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const item = asObject(candidate);
    const taskId = getText(item.providerTaskId || item.taskId);
    if (!taskId || taskId.startsWith('background:') || taskId.endsWith('-pending') || seen.has(taskId)) continue;
    seen.add(taskId);
    tasks.push({
      ...item,
      taskId,
      providerTaskId: taskId,
    });
  }
  return tasks;
}

async function cancelStep5VideoJob(job, options = {}) {
  const input = asObject(job.input);
  const tasks = collectSeedanceProviderTasks(job)
    .filter((item) => {
      const backend = getText(item.backend || input.backend);
      return backend === 'seedance' || backend === 'seedancecloud';
    });
  if (tasks.length === 0) {
    return { success: true, skipped: true, message: 'No submitted Seedance provider task found for this job.' };
  }

  const results = [];
  for (const item of tasks) {
    const apiBase = getSeedanceApiBase({ ...input, ...item });
    const licenseKey = getSeedanceLicenseKey({ ...input, ...item });
    if (!apiBase) {
      results.push({ success: false, taskId: item.taskId, message: 'Seedance apiBase is missing' });
      continue;
    }
    const result = await postSeedanceCancel(apiBase, licenseKey, item.taskId);
    results.push(result);
  }
  const success = results.some((item) => item.success);
  return {
    success,
    message: success ? 'Seedance remote cancel requested.' : 'Seedance remote cancel failed or no task accepted cancel.',
    reason: getText(options.reason),
    results,
  };
}

async function runStep5VideoJob(job, context) {
  const input = asObject(job.input);
  const items = asArray(input.items);
  if (items.length === 0) {
    throw new Error('Step5 backend video job requires input.items');
  }

  const results = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = asObject(items[index]);
    const backend = getText(item.backend || input.backend);
    if (!backend) throw new Error(`Step5 item ${index + 1} is missing backend`);

    await context.event({
      level: 'info',
      phase: 'step5-item',
      message: `开始处理 Step5 视频任务 ${index + 1}/${items.length}`,
      data: { backend, storyboardIndex: item.storyboardIndex },
    });

    if (backend === 'seedance' || backend === 'seedancecloud') {
      let seedanceItem = item;
      if (!getText(item.providerTaskId || item.taskId)) {
        const submitted = await submitSeedanceVideo(item, input, {
          ...context,
          job,
        });
        seedanceItem = {
          ...item,
          providerTaskId: submitted.taskId,
          taskId: submitted.taskId,
          clientTaskId: submitted.clientTaskId,
          submittedRecovered: submitted.recovered,
        };
        await context.update({
          progress: {
            ...(asObject(job.progress)),
            phase: 'submitted',
            providerTasks: [
              ...asArray(asObject(job.progress).providerTasks),
              {
                backend,
                taskId: submitted.taskId,
                providerTaskId: submitted.taskId,
                clientTaskId: submitted.clientTaskId,
                storyboardIndex: item.storyboardIndex,
                submittedAt: new Date().toISOString(),
              },
            ],
          },
          output: {
            ...(asObject(job.output)),
            providerTasks: [
              ...asArray(asObject(job.output).providerTasks),
              {
                backend,
                taskId: submitted.taskId,
                providerTaskId: submitted.taskId,
                clientTaskId: submitted.clientTaskId,
                storyboardIndex: item.storyboardIndex,
                submittedAt: new Date().toISOString(),
              },
            ],
          },
        }).catch(() => undefined);
        await context.event({
          level: 'info',
          phase: 'step5-submit',
          message: `Seedance submitted task ${submitted.taskId}`,
          data: {
            taskId: submitted.taskId,
            clientTaskId: submitted.clientTaskId,
            storyboardIndex: item.storyboardIndex,
            recovered: submitted.recovered === true,
          },
        });
      }
      results.push(await pollSeedanceExistingTask(seedanceItem, input, {
        ...context,
        job,
      }));
      continue;
    }

    if (!asArray(item.media).length && !asArray(input.media).length) {
      throw new Error('Step5 backend video submission requires COS media manifest before provider submit can run');
    }

    throw new Error(`Step5 backend submit handler for ${backend} is not connected yet`);
  }

  const failed = results.filter((item) => item.status === 'failed');
  const existingOutput = asObject(job.output);
  const existingProgress = asObject(job.progress);
  return {
    status: failed.length > 0 ? 'failed' : 'succeeded',
    output: {
      ...existingOutput,
      items: results,
      succeeded: results.length - failed.length,
      failed: failed.length,
    },
    progress: {
      ...existingProgress,
      done: results.length,
      total: items.length,
    },
    message: failed.length > 0 ? 'Step5 视频任务有失败项' : 'Step5 视频任务完成',
  };
}

function createVideoJobHandlers() {
  return {
    'step5-videos': runStep5VideoJob,
  };
}

module.exports = {
  cancelStep5VideoJob,
  createVideoJobHandlers,
  runStep5VideoJob,
};
