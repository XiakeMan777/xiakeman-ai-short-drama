import type { Project } from '@/types';
import {
  buildProjectExportFile,
  collectProjectBlobKeys,
  importProjectStructureWithBlobMapping,
  importTransferData,
  type TransferImportResult,
} from '@/lib/projectTransfer';
import { loadBlob, saveBlob } from '@/lib/imageStore';

const CLOUD_API_BASE = '/api/cloud';

export interface CloudProjectMetadata {
  storeVersion: number;
  projectId: string;
  name: string;
  updatedAt: string;
  exportedAt: string | null;
  chapterCount: number;
  blobCount: number;
  sizeBytes: number;
}

interface CloudHealth {
  ok: boolean;
  storage: 'file' | 'postgres';
  objectStorage?: {
    driver: string;
    source?: string;
    bucket?: string;
    region?: string;
    prefix?: string;
  };
  directTransfer?: {
    enabled: boolean;
    driver: string;
    signedUrlTtlSeconds?: number;
  };
}

interface CloudProjectBlobManifest {
  blobKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  updatedAt: string;
}

interface CloudProjectStructureSnapshot {
  version: number;
  exportedAt: string;
  project: Project;
  blobs?: Record<string, never>;
}

interface SignedObjectRequest {
  method: 'GET' | 'PUT';
  url: string;
  headers?: Record<string, string>;
  expiresAt: string;
}

interface DirectUploadBlob {
  blobKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  upload?: SignedObjectRequest;
  reused?: boolean;
  reusedFromBlobKey?: string;
  objectKey?: string;
}

interface DirectDownloadBlob extends CloudProjectBlobManifest {
  download: SignedObjectRequest;
}

interface CloudBlobUploadResult {
  reused: boolean;
}

export interface CloudUploadProgress {
  phase: 'structure' | 'blob' | 'finalize';
  uploaded: number;
  total: number;
  reused: number;
  missing: number;
  bytesUploaded: number;
  currentBlobKey?: string;
}

export interface CloudUploadOptions {
  failOnMissingBlobs?: boolean;
  requiredBlobKeys?: readonly string[];
}

async function readCloudError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === 'string') return payload.error;
  } catch {
    // Fall through to text fallback.
  }

  try {
    const text = await response.text();
    return text.slice(0, 300) || response.statusText;
  } catch {
    return response.statusText;
  }
}

async function cloudRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);

  const response = await fetch(`${CLOUD_API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(await readCloudError(response));
  }

  return await response.json() as T;
}

export async function listCloudProjects(): Promise<CloudProjectMetadata[]> {
  const payload = await cloudRequest<{ projects: CloudProjectMetadata[] }>('/projects');
  return payload.projects;
}

export async function getCloudHealth(): Promise<CloudHealth> {
  return await cloudRequest<CloudHealth>('/health');
}

async function getCloudProjectManifest(projectId: string): Promise<CloudProjectBlobManifest[]> {
  const payload = await cloudRequest<{ blobs: CloudProjectBlobManifest[] }>(
    `/projects/${encodeURIComponent(projectId)}/manifest`,
  );
  return payload.blobs;
}

async function cloudBlobRequest<T>(path: string, blob: Blob): Promise<T> {
  const response = await fetch(`${CLOUD_API_BASE}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': blob.type || 'application/octet-stream',
    },
    body: blob,
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(await readCloudError(response));
  }

  return await response.json() as T;
}

async function sha256Blob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatUploadError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableUploadError(error: unknown): boolean {
  const message = formatUploadError(error);
  return /Cloud store request failed|Failed to fetch|NetworkError|timeout|timed out|ECONNRESET|ETIMEDOUT|502|503|504/i
    .test(message);
}

async function cloudRequestWithRetry<T>(
  path: string,
  init: RequestInit = {},
  options: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = Math.max(100, options.baseDelayMs ?? 800);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await cloudRequest<T>(path, init);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableUploadError(error)) break;
      await sleep(baseDelayMs * attempt);
    }
  }

  throw lastError;
}

async function uploadBlobWithRetry(projectId: string, blobKey: string, blob: Blob): Promise<CloudBlobUploadResult> {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const payload = await cloudBlobRequest<{ blob: { blobKey: string; reused?: boolean } }>(
        `/projects/${encodeURIComponent(projectId)}/blobs?blobKey=${encodeURIComponent(blobKey)}`,
        blob,
      );
      return { reused: payload.blob.reused === true };
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableUploadError(error)) throw error;
      await sleep(1_000 * attempt);
    }
  }
  return { reused: false };
}

async function uploadBlobDirectlyWithRetry(
  projectId: string,
  blobKey: string,
  blob: Blob,
  sha256: string,
): Promise<CloudBlobUploadResult> {
  const contentType = blob.type || 'application/octet-stream';
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const payload = await cloudRequest<{ blob: DirectUploadBlob }>(
        `/projects/${encodeURIComponent(projectId)}/blobs/direct-upload`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            blobKey,
            contentType,
            sizeBytes: blob.size,
            sha256,
          }),
        },
      );

      if (payload.blob.reused && !payload.blob.upload) {
        return { reused: true };
      }
      if (!payload.blob.upload) {
        throw new Error('Cloud direct upload did not return an upload ticket');
      }

      const uploadResponse = await fetch(payload.blob.upload.url, {
        method: payload.blob.upload.method,
        headers: payload.blob.upload.headers || { 'Content-Type': contentType },
        body: blob,
      });
      if (!uploadResponse.ok) {
        const text = await uploadResponse.text().catch(() => '');
        throw new Error(text.slice(0, 300) || uploadResponse.statusText || `HTTP ${uploadResponse.status}`);
      }

      const completePayload = await cloudRequest<{ blob: CloudProjectBlobManifest & { reused?: boolean } }>(
        `/projects/${encodeURIComponent(projectId)}/blobs/direct-complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            blobKey,
            contentType,
            sizeBytes: blob.size,
            sha256,
          }),
        },
      );
      return { reused: completePayload.blob.reused === true };
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableUploadError(error)) throw error;
      await sleep(1_000 * attempt);
    }
  }
  return { reused: false };
}

async function uploadBlobPreferDirect(
  projectId: string,
  blobKey: string,
  blob: Blob,
  directEnabled: boolean,
): Promise<CloudBlobUploadResult> {
  if (!directEnabled) {
    return await uploadBlobWithRetry(projectId, blobKey, blob);
  }

  try {
    const digest = await sha256Blob(blob);
    return await uploadBlobDirectlyWithRetry(projectId, blobKey, blob, digest);
  } catch (directError) {
    try {
      return await uploadBlobWithRetry(projectId, blobKey, blob);
    } catch (serverError) {
      throw new Error(`直连 COS 失败：${formatUploadError(directError)}；服务器兜底也失败：${formatUploadError(serverError)}`);
    }
  }
}

export async function uploadCloudProjectBlob(
  projectId: string,
  blobKey: string,
  blob: Blob,
): Promise<void> {
  const health = await getCloudHealth();
  const directEnabled = health.storage === 'postgres' && health.directTransfer?.enabled === true;
  await uploadBlobPreferDirect(projectId, blobKey, blob, directEnabled);
}

export async function uploadCloudProjectBlobViaServer(
  projectId: string,
  blobKey: string,
  blob: Blob,
): Promise<void> {
  await uploadBlobWithRetry(projectId, blobKey, blob);
}

export async function uploadProjectStructureToCloud(project: Project): Promise<CloudProjectMetadata> {
  const exportedAt = new Date().toISOString();
  const payload = await cloudRequestWithRetry<{ project: CloudProjectMetadata }>(
    `/projects/${encodeURIComponent(project.id)}/structure`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        exportedAt,
        project,
      }),
    },
    { attempts: 3, baseDelayMs: 900 },
  );
  return payload.project;
}

export async function uploadProjectToCloud(
  project: Project,
  onProgress?: (progress: CloudUploadProgress) => void,
  options: CloudUploadOptions = {},
): Promise<CloudProjectMetadata> {
  const health = await getCloudHealth();
  if (health.storage === 'postgres') {
    const directEnabled = health.directTransfer?.enabled === true;
    const blobKeys = collectProjectBlobKeys(project);
    onProgress?.({
      phase: 'structure',
      uploaded: 0,
      total: blobKeys.length,
      reused: 0,
      missing: 0,
      bytesUploaded: 0,
    });

    try {
      await uploadProjectStructureToCloud(project);
    } catch (error) {
      throw new Error(`云端项目结构保存失败：${formatUploadError(error)}`);
    }

    let existingBlobKeys = new Set<string>();
    try {
      existingBlobKeys = new Set((await getCloudProjectManifest(project.id)).map((blob) => blob.blobKey));
    } catch {
      existingBlobKeys = new Set<string>();
    }

    const uploadedBlobKeys: string[] = [];
    let bytesUploaded = 0;
    let reused = 0;
    let missing = 0;
    const missingBlobKeys: string[] = [];
    for (const [index, blobKey] of blobKeys.entries()) {
      if (existingBlobKeys.has(blobKey)) {
        uploadedBlobKeys.push(blobKey);
        reused += 1;
        onProgress?.({
          phase: 'blob',
          uploaded: uploadedBlobKeys.length,
          total: blobKeys.length,
          reused,
          missing,
          bytesUploaded,
          currentBlobKey: blobKey,
        });
        continue;
      }

      let blob: Blob | null = null;
      try {
        blob = await loadBlob(blobKey);
      } catch (error) {
        throw new Error(`读取本地资源失败 ${index + 1}/${blobKeys.length}：${formatUploadError(error)}`);
      }

      if (!blob) {
        missing += 1;
        missingBlobKeys.push(blobKey);
        onProgress?.({
          phase: 'blob',
          uploaded: uploadedBlobKeys.length,
          total: blobKeys.length,
          reused,
          missing,
          bytesUploaded,
          currentBlobKey: blobKey,
        });
        continue;
      }

      try {
        const uploadResult = await uploadBlobPreferDirect(project.id, blobKey, blob, directEnabled);
        if (uploadResult.reused) {
          reused += 1;
        } else {
          bytesUploaded += blob.size;
        }
      } catch (error) {
        throw new Error(
          `资源上传失败 ${index + 1}/${blobKeys.length}（${blobKey.slice(0, 8)}，${formatBytes(blob.size)}）：${formatUploadError(error)}`,
        );
      }

      uploadedBlobKeys.push(blobKey);
      onProgress?.({
        phase: 'blob',
        uploaded: uploadedBlobKeys.length,
        total: blobKeys.length,
        reused,
        missing,
        bytesUploaded,
        currentBlobKey: blobKey,
      });
    }

    onProgress?.({
      phase: 'finalize',
      uploaded: uploadedBlobKeys.length,
      total: blobKeys.length,
      reused,
      missing,
      bytesUploaded,
    });

    if (options.failOnMissingBlobs && missing > 0) {
      const requiredBlobKeys = new Set((options.requiredBlobKeys ?? blobKeys).map((key) => key.trim()).filter(Boolean));
      const requiredMissing = missingBlobKeys.filter((key) => requiredBlobKeys.has(key));
      if (requiredMissing.length > 0) {
        throw new Error(`云端同步缺少 ${requiredMissing.length} 个本次提交资源，请刷新项目或重新同步素材后再提交后台任务。`);
      }
    }

    let payload: { project: CloudProjectMetadata };
    try {
      payload = await cloudRequest<{ project: CloudProjectMetadata }>(
        `/projects/${encodeURIComponent(project.id)}/finalize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blobKeys: uploadedBlobKeys }),
        },
      );
    } catch (error) {
      throw new Error(`云端上传收尾失败：${formatUploadError(error)}`);
    }
    return payload.project;
  }

  const snapshot = await buildProjectExportFile(project);
  const payload = await cloudRequest<{ project: CloudProjectMetadata }>(
    `/projects/${encodeURIComponent(project.id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    },
  );
  return payload.project;
}

async function downloadCloudBlobDirectly(projectId: string, item: CloudProjectBlobManifest): Promise<Blob> {
  const payload = await cloudRequest<{ blobs: DirectDownloadBlob[] }>(
    `/projects/${encodeURIComponent(projectId)}/blobs/download-urls`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blobKeys: [item.blobKey] }),
    },
  );
  const signed = payload.blobs[0]?.download;
  if (!signed) throw new Error(`缺少云端资源下载链接：${item.blobKey}`);

  const response = await fetch(signed.url, { method: signed.method });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text.slice(0, 300) || response.statusText || `HTTP ${response.status}`);
  }

  const blob = await response.blob();
  if (blob.type || !item.contentType) return blob;
  return new Blob([await blob.arrayBuffer()], { type: item.contentType });
}

export async function importCloudProject(
  projectId: string,
  onProgress?: (loaded: number, total: number) => void,
  options: { preserveProjectId?: boolean; downloadBlobs?: boolean } = {},
): Promise<TransferImportResult> {
  try {
    const structure = await cloudRequest<CloudProjectStructureSnapshot>(
      `/projects/${encodeURIComponent(projectId)}/structure`,
    );
    if (options.downloadBlobs !== true) {
      onProgress?.(0, 0);
      return {
        kind: 'project',
        project: importProjectStructureWithBlobMapping(structure.project, new Map(), {
          remapProjectIds: options.preserveProjectId !== true,
        }),
      };
    }
  } catch (structureError) {
    console.warn('[cloudProjectStore] Structure import failed, falling back to legacy import', structureError);
  }

  const health = await getCloudHealth();
  if (health.storage === 'postgres' && health.directTransfer?.enabled === true) {
    try {
      const structure = await cloudRequest<CloudProjectStructureSnapshot>(
        `/projects/${encodeURIComponent(projectId)}/structure`,
      );
      if (options.downloadBlobs !== true) {
        onProgress?.(0, 0);
        return {
          kind: 'project',
          project: importProjectStructureWithBlobMapping(structure.project, new Map(), {
            remapProjectIds: options.preserveProjectId !== true,
          }),
        };
      }

      const manifest = await getCloudProjectManifest(projectId);
      const keyMapping = new Map<string, string>();
      let loaded = 0;

      for (const item of manifest) {
        const blob = await downloadCloudBlobDirectly(projectId, item);
        const newKey = await saveBlob(blob);
        keyMapping.set(item.blobKey, newKey);
        loaded += 1;
        onProgress?.(loaded, manifest.length);
      }

      return {
        kind: 'project',
        project: importProjectStructureWithBlobMapping(structure.project, keyMapping, {
          remapProjectIds: options.preserveProjectId !== true,
        }),
      };
    } catch (directError) {
      console.warn('[cloudProjectStore] Direct COS import failed, falling back to server import', directError);
    }
  }

  const snapshot = await cloudRequest<unknown>(`/projects/${encodeURIComponent(projectId)}`);
  return importTransferData(snapshot, onProgress, { remapProjectIds: options.preserveProjectId !== true });
}

export async function deleteCloudProject(projectId: string): Promise<void> {
  await cloudRequest<{ ok: true }>(`/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
}

export async function createCloudProjectBlobDownloadUrl(
  projectId: string,
  blobKey: string,
): Promise<string> {
  const payload = await cloudRequest<{ blobs: DirectDownloadBlob[] }>(
    `/projects/${encodeURIComponent(projectId)}/blobs/download-urls`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blobKeys: [blobKey] }),
    },
  );
  const signed = payload.blobs[0]?.download;
  if (!signed?.url) throw new Error(`云端资源下载链接生成失败：${blobKey}`);
  return signed.url;
}

export async function ensureCloudProjectBlobsAvailable(
  projectId: string,
  blobKeys: readonly string[],
): Promise<void> {
  const uniqueBlobKeys = [...new Set(blobKeys.map((key) => key.trim()).filter(Boolean))];
  if (uniqueBlobKeys.length === 0) return;
  await cloudRequest<{ blobs: DirectDownloadBlob[] }>(
    `/projects/${encodeURIComponent(projectId)}/blobs/download-urls`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blobKeys: uniqueBlobKeys }),
    },
  );
}
