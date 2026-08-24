import type { Dispatch, MutableRefObject } from 'react';
import { normalizeFrameRatio } from '@/lib/frameRatio';
import {
  buildSeedanceClientTaskId,
  findSeedanceTaskByClientTaskId,
} from '@/lib/seedanceTaskClient';
import {
  buildSeedanceFetchInit,
  getSeedanceApiBase,
  getSeedanceCloudLicenseKey,
  getSeedanceTransit9Resolution,
  isSeedanceCloudBackend,
  normalizeSeedanceServiceDuration,
  normalizeSeedanceServiceModel,
} from '@/lib/seedanceApi';
import type { VideoApiConfig } from '@/types';
import type { Action } from '@/stores/projectStore';
import { attachRawVideoApiError, formatVideoHttpError } from './videoErrorFormat';

const SEEDANCE_SUBMIT_TIMEOUT_MS = 10 * 60_000;
const SEEDANCE_DIRECT_UPLOAD_ENDPOINT = '/api/media/seedance-direct-upload-tickets';
const SEEDANCE_DIRECT_UPLOAD_ENABLED = false;
const URL_TEXT_MEDIA_MAX_BYTES = 16 * 1024;

type SeedanceDirectUploadRole = 'image' | 'video' | 'audio' | 'reference_video';

interface SeedanceDirectUploadFile {
  id: string;
  role: SeedanceDirectUploadRole;
  blob: Blob;
  fileName: string;
}

interface SeedanceDirectUploadTicket {
  id: string;
  role: SeedanceDirectUploadRole;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  objectKey: string;
  upload: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
  };
  download: {
    method?: string;
    url: string;
    expiresAt?: string;
  };
}

function parseSeedanceTimestamp(value?: string | null) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

interface SeedanceSubmitOptions {
  async?: boolean;
  duration?: number;
  productionMode?: 'normal' | 'extend';
  continuityGroupId?: string;
  continuityReason?: string;
  sourceVideoBlob?: Blob;
  sourceTaskId?: string;
  sourceStoryboardIndex?: number;
  sourceBlobKey?: string;
  voiceReferenceAudios?: Array<{
    blob?: Blob;
    url?: string;
    characterName: string;
    fileName?: string;
  }>;
  clientTaskId?: string;
}

function getExtensionSourceFileName(sourceStoryboardIndex?: number) {
  const suffix = typeof sourceStoryboardIndex === 'number'
    ? String(sourceStoryboardIndex + 1).padStart(2, '0')
    : 'previous';
  return `source-storyboard-${suffix}.mp4`;
}

function getImageReferenceFileName(blob: Blob, index: number) {
  const extension = blob.type === 'image/webp'
    ? 'webp'
    : blob.type === 'image/jpeg'
      ? 'jpg'
      : 'png';
  return `image-reference-${String(index + 1).padStart(2, '0')}.${extension}`;
}

function sanitizeSeedanceFileNamePart(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'character';
}

function getVoiceReferenceAudioFileName(
  reference: NonNullable<SeedanceSubmitOptions['voiceReferenceAudios']>[number],
  index: number,
) {
  const supplied = reference.fileName?.trim();
  if (supplied && /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(supplied)) return supplied;
  const extension = reference.blob?.type === 'audio/mpeg'
    ? 'mp3'
    : reference.blob?.type === 'audio/mp4'
      ? 'm4a'
      : reference.blob?.type === 'audio/ogg'
        ? 'ogg'
        : 'wav';
  return `voice-reference-${String(index + 1).padStart(2, '0')}-${sanitizeSeedanceFileNamePart(reference.characterName)}.${extension}`;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function getExpectedMediaLabel(role: SeedanceDirectUploadRole) {
  if (role === 'image') return '图片';
  if (role === 'audio') return '音频';
  return '视频';
}

function isLikelyTextBlob(blob: Blob) {
  const type = (blob.type || '').toLowerCase();
  return blob.size > 0
    && blob.size <= URL_TEXT_MEDIA_MAX_BYTES
    && (
      !type
      || type.startsWith('text/')
      || type.includes('json')
      || type.includes('xml')
      || type === 'application/octet-stream'
    );
}

function extractSingleHttpUrl(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/^https?:\/\/\S+$/i);
  return match ? match[0] : '';
}

function assertFetchedMediaType(blob: Blob, role: SeedanceDirectUploadRole, url: string) {
  const type = (blob.type || '').toLowerCase();
  if (!type || type === 'application/octet-stream') return;
  if (role === 'image' && type.startsWith('image/')) return;
  if (role === 'audio' && type.startsWith('audio/')) return;
  if ((role === 'video' || role === 'reference_video') && type.startsWith('video/')) return;
  throw new Error(`${getExpectedMediaLabel(role)}链接返回类型异常：${type}，地址：${url.slice(0, 160)}`);
}

async function resolveUrlTextMediaBlob(
  blob: Blob,
  role: SeedanceDirectUploadRole,
  signal: AbortSignal,
): Promise<Blob> {
  if (!isLikelyTextBlob(blob)) return blob;
  const url = extractSingleHttpUrl(await blob.text().catch(() => ''));
  if (!url) return blob;

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`${getExpectedMediaLabel(role)}链接无法直接下载：HTTP ${response.status}`);
  }
  const fetched = await response.blob();
  assertFetchedMediaType(fetched, role, url);
  if (fetched.size <= 0) {
    throw new Error(`${getExpectedMediaLabel(role)}链接返回空文件：${url.slice(0, 160)}`);
  }
  return fetched;
}

function buildDirectUploadItem(
  ticket: SeedanceDirectUploadTicket,
) {
  return {
    url: ticket.download.url,
    file_name: ticket.fileName,
    content_type: ticket.contentType,
    size_bytes: ticket.sizeBytes,
    object_key: ticket.objectKey,
    source: 'cos',
  };
}

function appendJsonArrayField(formData: FormData, field: string, values: unknown[]) {
  if (values.length > 0) formData.append(field, JSON.stringify(values));
}

function mediaItemsToUrls(items: unknown[]) {
  return items
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (!item || typeof item !== 'object') return '';
      const record = item as Record<string, unknown>;
      const value = record.url || record.downloadUrl || record.download_url;
      return typeof value === 'string' ? value.trim() : '';
    })
    .filter(Boolean);
}

function appendMediaUrlArrayField(formData: FormData, field: string, values: unknown[]) {
  appendJsonArrayField(formData, field, mediaItemsToUrls(values));
}

async function requestSeedanceDirectUploadTickets(
  files: SeedanceDirectUploadFile[],
  videoConfig: VideoApiConfig,
  clientTaskId: string,
  signal: AbortSignal,
): Promise<SeedanceDirectUploadTicket[]> {
  const payload = {
    clientTaskId,
    files: files.map((file) => ({
      id: file.id,
      role: file.role,
      fileName: file.fileName,
      contentType: file.blob.type || 'application/octet-stream',
      sizeBytes: file.blob.size,
    })),
  };
  const resp = await fetch(SEEDANCE_DIRECT_UPLOAD_ENDPOINT, buildSeedanceFetchInit(videoConfig, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  }));
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`COS direct upload ticket failed (${resp.status}): ${text.slice(0, 300)}`);
  }
  const data = await resp.json() as { items?: SeedanceDirectUploadTicket[] };
  const tickets = Array.isArray(data.items) ? data.items : [];
  if (tickets.length !== files.length) throw new Error('COS direct upload ticket count mismatch');
  return tickets;
}

async function uploadSeedanceDirectFile(
  file: SeedanceDirectUploadFile,
  ticket: SeedanceDirectUploadTicket,
  signal: AbortSignal,
) {
  const headers = new Headers(ticket.upload.headers || {});
  if (!headers.has('Content-Type')) headers.set('Content-Type', file.blob.type || 'application/octet-stream');
  const resp = await fetch(ticket.upload.url, {
    method: ticket.upload.method || 'PUT',
    headers,
    body: file.blob,
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`COS direct upload failed (${resp.status}): ${text.slice(0, 300)}`);
  }
}

async function appendSeedanceDirectUploadFields(
  formData: FormData,
  files: SeedanceDirectUploadFile[],
  videoConfig: VideoApiConfig,
  clientTaskId: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (!SEEDANCE_DIRECT_UPLOAD_ENABLED) return false;
  if (!isSeedanceCloudBackend(videoConfig.backend) || files.length === 0) return false;

  try {
    const resolvedFiles = await resolveSeedanceSubmitBlobs(files, signal);
    const tickets = await requestSeedanceDirectUploadTickets(resolvedFiles, videoConfig, clientTaskId, signal);
    const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]));
    await Promise.all(resolvedFiles.map((file) => {
      const ticket = ticketById.get(file.id);
      if (!ticket) throw new Error(`COS direct upload missing ticket: ${file.id}`);
      return uploadSeedanceDirectFile(file, ticket, signal);
    }));

    const byRole: Record<SeedanceDirectUploadRole, ReturnType<typeof buildDirectUploadItem>[]> = {
      image: [],
      video: [],
      audio: [],
      reference_video: [],
    };
    for (const ticket of tickets) {
      byRole[ticket.role].push(buildDirectUploadItem(ticket));
    }

    appendMediaUrlArrayField(formData, 'image_urls', byRole.image);
    appendMediaUrlArrayField(formData, 'video_urls', byRole.video);
    appendMediaUrlArrayField(formData, 'audio_urls', byRole.audio);
    appendMediaUrlArrayField(formData, 'reference_video_urls', byRole.reference_video);
    appendMediaUrlArrayField(formData, 'imitation_video_urls', byRole.reference_video);
    formData.append('remote_media_source', 'cos');
    return true;
  } catch (error) {
    if (isAbortError(error)) throw error;
    console.warn('[seedance] COS direct upload unavailable, falling back to multipart upload', error);
    return false;
  }
}

async function resolveSeedanceSubmitBlobs(
  files: SeedanceDirectUploadFile[],
  signal: AbortSignal,
): Promise<SeedanceDirectUploadFile[]> {
  return await Promise.all(files.map(async (file) => ({
    ...file,
    blob: await resolveUrlTextMediaBlob(file.blob, file.role, signal),
  })));
}

function buildExtensionSubmitError(status: number, body: string) {
  const formattedBody = formatVideoHttpError(status, body, '提交失败');
  return [
    `小云雀视频延长提交失败 (${status})。`,
    '当前请求已按延长模式提交，但本地服务没有接受这些参数；请确认小云雀后端已支持视频延长接口/字段。',
    body ? `后端返回：${formattedBody}` : '',
  ].filter(Boolean).join(' ');
}

export async function submitSeedanceVideo(
  index: number,
  prompt: string,
  blobs: Blob[],
  videoConfig: VideoApiConfig,
  chapterId: string,
  dispatchRef: MutableRefObject<Dispatch<Action>>,
  abortCtrl: AbortController,
  options: SeedanceSubmitOptions = {},
): Promise<void> {
  const isExtend = options.productionMode === 'extend';
  if (isExtend && !options.sourceVideoBlob) {
    throw new Error('视频延长缺少上一镜源视频，已停止提交，避免退回普通生成。');
  }
  if (isSeedanceCloudBackend(videoConfig.backend) && !getSeedanceCloudLicenseKey(videoConfig)) {
    throw new Error('请先在视频模型设置中填写虾客漫SD2卡密。');
  }

  const seedanceBackend = isSeedanceCloudBackend(videoConfig.backend) ? 'seedancecloud' : 'seedance';
  const seedanceApiBase = getSeedanceApiBase(videoConfig);
  const submitMetadata = {
    productionMode: options.productionMode ?? 'normal',
    continuityGroupId: options.continuityGroupId,
    continuityReason: options.continuityReason,
    extendSourceIndex: options.sourceStoryboardIndex,
    extendSourceTaskId: options.sourceTaskId,
    extendSourceBlobKey: options.sourceBlobKey,
    extendSubmittedAsExtend: isExtend ? true : undefined,
  };
  const clientTaskId = options.clientTaskId ?? buildSeedanceClientTaskId(chapterId, index);

  const formData = new FormData();
  formData.append('prompt', prompt);
  const submitDuration = normalizeSeedanceServiceDuration(options.duration ?? videoConfig.videoDuration);
  const submitModel = isSeedanceCloudBackend(videoConfig.backend)
    ? normalizeSeedanceServiceModel(videoConfig.seedanceModel)
    : (videoConfig.seedanceModel || 'fast');

  dispatchRef.current({
    type: 'SUBMIT_VIDEO',
    index,
    taskId: 'seedance-pending',
    clientTaskId,
    chapterId,
    backend: seedanceBackend,
    duration: submitDuration,
    ...submitMetadata,
  });

  formData.append('duration', String(submitDuration));
  formData.append('ratio', normalizeFrameRatio(videoConfig.videoRatio));
  formData.append('model', submitModel);
  const submitResolution = isSeedanceCloudBackend(videoConfig.backend)
    ? getSeedanceTransit9Resolution(submitModel, videoConfig.videoResolution)
    : undefined;
  if (submitResolution) formData.append('resolution', submitResolution);
  formData.append('client_task_id', clientTaskId);
  formData.append('media_numbering', 'independent_by_type');
  formData.append('image_reference_count', String(blobs.length));

  const voiceReferenceAudios = options.voiceReferenceAudios ?? [];
  if (voiceReferenceAudios.length) {
    formData.append('voice_reference_count', String(voiceReferenceAudios.length));
    formData.append('audio_reference_count', String(voiceReferenceAudios.length));
    formData.append('voice_reference_media_type', 'audio');
    formData.append(
      'voice_reference_characters',
      JSON.stringify(voiceReferenceAudios.map((reference) => reference.characterName)),
    );
    formData.append(
      'audio_reference_characters',
      JSON.stringify(voiceReferenceAudios.map((reference) => reference.characterName)),
    );
  }

  const imageDirectUploadFiles: SeedanceDirectUploadFile[] = await resolveSeedanceSubmitBlobs(blobs.map((blob, blobIndex) => ({
    id: `image-${blobIndex}`,
    role: 'image',
    blob,
    fileName: getImageReferenceFileName(blob, blobIndex),
  })), abortCtrl.signal);
  const sourceDirectUploadFiles: SeedanceDirectUploadFile[] = await resolveSeedanceSubmitBlobs(isExtend && options.sourceVideoBlob
    ? [{
      id: 'source-video',
      role: 'reference_video',
      blob: options.sourceVideoBlob,
      fileName: getExtensionSourceFileName(options.sourceStoryboardIndex),
    }]
    : [], abortCtrl.signal);
  const audioDirectUploadFiles: SeedanceDirectUploadFile[] = await resolveSeedanceSubmitBlobs(voiceReferenceAudios
    .filter((reference) => !!reference.blob)
    .map((reference, referenceIndex) => ({
      id: `audio-${referenceIndex}`,
      role: 'audio',
      blob: reference.blob as Blob,
      fileName: getVoiceReferenceAudioFileName(reference, referenceIndex),
    })), abortCtrl.signal);
  const directUploadFiles: SeedanceDirectUploadFile[] = [
    ...imageDirectUploadFiles,
    ...sourceDirectUploadFiles,
    ...audioDirectUploadFiles,
  ];

  const directUploadUsed = await appendSeedanceDirectUploadFields(
    formData,
    directUploadFiles,
    videoConfig,
    clientTaskId,
    abortCtrl.signal,
  );

  if (isExtend && options.sourceVideoBlob) {
    formData.append('mode', 'extend');
    formData.append('generation_mode', 'extend');
    formData.append('production_mode', 'extend');
    formData.append('extend', 'true');
    formData.append('require_extension', 'true');
    if (options.sourceTaskId) formData.append('source_task_id', options.sourceTaskId);
    if (typeof options.sourceStoryboardIndex === 'number') {
      formData.append('source_storyboard_index', String(options.sourceStoryboardIndex));
    }
    if (!directUploadUsed) {
      const sourceFile = sourceDirectUploadFiles[0];
      formData.append(
        'source_video',
        sourceFile?.blob ?? options.sourceVideoBlob,
        getExtensionSourceFileName(options.sourceStoryboardIndex),
      );
    }
  }

  if (!directUploadUsed) {
    if (import.meta.env.DEV && isSeedanceCloudBackend(videoConfig.backend)) {
      console.info('[seedance] submitting reference images as multipart blobs', {
        imageCount: imageDirectUploadFiles.length,
        field: 'images',
        remoteMediaSource: 'multipart',
      });
    }
    imageDirectUploadFiles.forEach((file, blobIndex) => {
      formData.append('images', file.blob, getImageReferenceFileName(file.blob, blobIndex));
    });
  }

  if (voiceReferenceAudios.length) {
    const audioUrls = voiceReferenceAudios
      .map((reference) => reference.url?.trim())
      .filter((url): url is string => !!url);
    if (audioUrls.length > 0) {
      formData.append('voice_reference_audio_urls', JSON.stringify(audioUrls));
      formData.append('audio_reference_urls', JSON.stringify(audioUrls));
      formData.append('audio_urls', JSON.stringify(audioUrls));
    }
    if (!directUploadUsed) {
      audioDirectUploadFiles.forEach((file, referenceIndex) => {
        formData.append('audios', file.blob, file.fileName || `voice-reference-${referenceIndex + 1}.wav`);
      });
    }
  }

  let submitTimedOut = false;
  const submitTimeout = setTimeout(() => {
    submitTimedOut = true;
    abortCtrl.abort();
  }, SEEDANCE_SUBMIT_TIMEOUT_MS);
  try {
    const resp = await fetch(`${seedanceApiBase}/generate-video`, buildSeedanceFetchInit(videoConfig, {
      method: 'POST',
      body: formData,
      signal: abortCtrl.signal,
    }));

    if (!resp.ok) {
      const errText = await resp.text();
      const submitError = new Error(isExtend
        ? buildExtensionSubmitError(resp.status, errText)
        : formatVideoHttpError(resp.status, errText));
      throw attachRawVideoApiError(submitError, errText);
    }

    const result = await resp.json();
    const seedanceTaskId = result.task_id as string;

    if (!seedanceTaskId) {
      throw new Error('后端未返回 task_id，提交失败。');
    }

    dispatchRef.current({
      type: 'SUBMIT_VIDEO',
      index,
      taskId: seedanceTaskId,
      clientTaskId,
      chapterId,
      backend: seedanceBackend,
      duration: submitDuration,
      ...submitMetadata,
    });
  } catch (error) {
    if (
      submitTimedOut
      || (error instanceof DOMException && error.name === 'AbortError' && !abortCtrl.signal.aborted)
    ) {
      const recoveredTask = await findSeedanceTaskByClientTaskId(clientTaskId, { config: videoConfig });
      if (recoveredTask?.task_id) {
        dispatchRef.current({
          type: 'SUBMIT_VIDEO',
          index,
          taskId: recoveredTask.task_id,
          clientTaskId,
          submittedAt: parseSeedanceTimestamp(recoveredTask.created_at),
          chapterId,
          backend: seedanceBackend,
          ...submitMetadata,
        });
        return;
      }
    }
    throw error;
  } finally {
    clearTimeout(submitTimeout);
  }
}
