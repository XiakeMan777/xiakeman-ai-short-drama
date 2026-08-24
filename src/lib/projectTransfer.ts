// ============================================================
// 项目打包导入/导出
// 将项目数据 + IndexedDB 二进制资源序列化为可下载的 JSON 文件
// ============================================================

import type {
  ApiConfig,
  AppState,
  ImageApiConfig,
  MusicApiConfig,
  Project,
  TtsApiConfig,
  VideoApiConfig,
} from '@/types';
import {
  DEFAULT_API_CONFIG,
  DEFAULT_IMAGE_API_CONFIG,
  DEFAULT_MUSIC_API_CONFIG,
  DEFAULT_TTS_API_CONFIG,
  DEFAULT_VIDEO_API_CONFIG,
  normalizePersistedState,
} from '@/lib/storage';
import { loadBlob, saveBlob } from '@/lib/imageStore';

/** 单项目导出格式版本 */
const EXPORT_VERSION = 1;
/** 当前流程快照导出格式版本 */
const WORKFLOW_SNAPSHOT_VERSION = 2;

export interface ProjectExportFile {
  version: number;
  exportedAt: string;
  project: Project;
  blobs: Record<string, string>;
}

export interface WorkflowSnapshotExportFile {
  version: number;
  kind: 'workflow-snapshot';
  exportedAt: string;
  project: Project;
  currentProjectId: string;
  apiConfig: ApiConfig;
  imageApiConfig: ImageApiConfig;
  videoApiConfig: VideoApiConfig;
  ttsApiConfig: TtsApiConfig;
  musicApiConfig: MusicApiConfig;
  blobs: Record<string, string>;
}

export type TransferImportResult =
  | { kind: 'project'; project: Project }
  | { kind: 'workflow-snapshot'; state: AppState };

export interface TransferImportOptions {
  remapProjectIds?: boolean;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType = 'application/octet-stream'): Blob {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function downloadJsonFile(fileName: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function collectProjectBlobKeys(project: Project): string[] {
  const keys = new Set<string>();

  for (const asset of project.assetLibrary) {
    if (asset.blobKey && asset.source !== 'volc_virtual_human' && !asset.blobKey.startsWith('external:')) {
      keys.add(asset.blobKey);
    }
    if (asset.lightweightBlobKey) {
      keys.add(asset.lightweightBlobKey);
    }
  }

  for (const voiceReference of project.characterVoiceReferences ?? []) {
    if (voiceReference.audioBlobKey) keys.add(voiceReference.audioBlobKey);
    if (voiceReference.blackVideoBlobKey) keys.add(voiceReference.blackVideoBlobKey);
  }

  for (const chapter of project.chapters) {
    for (const master of Object.values(chapter.sceneSpatialMasters ?? {})) {
      if (master.cleanBlobKey) keys.add(master.cleanBlobKey);
    }

    for (const sb of chapter.storyboards) {
      if (sb.videoBlobKey) keys.add(sb.videoBlobKey);

      for (const variant of Object.values(sb.storyboardBoard?.variants ?? {})) {
        if (!variant) continue;
        if (variant.visualBoardBlobKey) keys.add(variant.visualBoardBlobKey);
        if (variant.blobKey) keys.add(variant.blobKey);
        if (variant.lightweightBlobKey) keys.add(variant.lightweightBlobKey);
        for (const item of variant.referencePack ?? []) {
          if (item.blobKey) keys.add(item.blobKey);
          if (item.sourceBlobKey) keys.add(item.sourceBlobKey);
        }
      }

      if (sb.scenePositionBoard?.cleanBlobKey) keys.add(sb.scenePositionBoard.cleanBlobKey);
      if (sb.scenePositionBoard?.markedBlobKey) keys.add(sb.scenePositionBoard.markedBlobKey);

      for (const seg of sb.prompt?.timeSegments ?? []) {
        if (seg.soundEffectBlobKey) keys.add(seg.soundEffectBlobKey);
      }

      if (sb.audioMix) {
        for (const key of sb.audioMix.ttsBlobKeys ?? []) keys.add(key);
        for (const key of sb.audioMix.sfxBlobKeys ?? []) keys.add(key);
        if (sb.audioMix.bgm?.blobKey) keys.add(sb.audioMix.bgm.blobKey);
        if (sb.audioMix.mixBlobKey) keys.add(sb.audioMix.mixBlobKey);
      }
    }

    if (chapter.bgm?.blobKey) keys.add(chapter.bgm.blobKey);
  }

  return [...keys];
}

async function collectBlobMap(blobKeys: string[]): Promise<Record<string, string>> {
  const blobs: Record<string, string> = {};

  for (const key of blobKeys) {
    try {
      const blob = await loadBlob(key);
      if (blob) {
        blobs[key] = await blobToBase64(blob);
      }
    } catch {
      console.warn(`[projectTransfer] Failed to load blob ${key}, skipping`);
    }
  }

  return blobs;
}

async function restoreBlobKeysFromExport(
  blobEntries: Array<[string, string]>,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Map<string, string>> {
  const keyMapping = new Map<string, string>();
  const total = blobEntries.length;
  let loaded = 0;

  for (const [oldKey, base64] of blobEntries) {
    try {
      const blob = base64ToBlob(base64);
      const newKey = await saveBlob(blob);
      keyMapping.set(oldKey, newKey);
    } catch {
      console.warn(`[projectTransfer] Failed to restore blob ${oldKey}, skipping`);
    }
    loaded++;
    onProgress?.(loaded, total);
  }

  return keyMapping;
}

function buildWorkflowSnapshotFile(state: AppState, project: Project, blobs: Record<string, string>): WorkflowSnapshotExportFile {
  return {
    version: WORKFLOW_SNAPSHOT_VERSION,
    kind: 'workflow-snapshot',
    exportedAt: new Date().toISOString(),
    project,
    currentProjectId: project.id,
    apiConfig: state.apiConfig ?? DEFAULT_API_CONFIG,
    imageApiConfig: state.imageApiConfig ?? DEFAULT_IMAGE_API_CONFIG,
    videoApiConfig: state.videoApiConfig ?? DEFAULT_VIDEO_API_CONFIG,
    ttsApiConfig: state.ttsApiConfig ?? DEFAULT_TTS_API_CONFIG,
    musicApiConfig: state.musicApiConfig ?? DEFAULT_MUSIC_API_CONFIG,
    blobs,
  };
}

function isWorkflowSnapshotFile(data: unknown): data is WorkflowSnapshotExportFile {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return obj.kind === 'workflow-snapshot'
    && obj.version === WORKFLOW_SNAPSHOT_VERSION
    && typeof obj.project === 'object'
    && obj.project !== null
    && typeof obj.currentProjectId === 'string';
}

function isProjectExportFile(data: unknown): data is ProjectExportFile {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return obj.version === EXPORT_VERSION
    && typeof obj.project === 'object'
    && obj.project !== null;
}

export async function buildProjectExportFile(project: Project): Promise<ProjectExportFile> {
  const blobKeys = collectProjectBlobKeys(project);
  const blobs = await collectBlobMap(blobKeys);

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    project,
    blobs,
  };
}

export async function buildWorkflowSnapshotExportFile(state: AppState): Promise<WorkflowSnapshotExportFile> {
  const currentProject =
    state.projects.find((project) => project.id === state.currentProjectId)
    ?? state.projects[0];

  if (!currentProject) {
    throw new Error('当前没有可导出的项目');
  }

  const blobKeys = collectProjectBlobKeys(currentProject);
  const blobs = await collectBlobMap(blobKeys);
  return buildWorkflowSnapshotFile(state, currentProject, blobs);
}

/**
 * 将项目导出为可下载的 JSON 文件
 * 包含项目元数据 + 所有二进制资源（base64 编码）
 */
export async function exportProject(project: Project): Promise<void> {
  const exportFile = await buildProjectExportFile(project);
  downloadJsonFile(`${project.name || '项目'}_导出_${new Date().toISOString().slice(0, 10)}.json`, exportFile);
}

/**
 * 导出当前流程快照
 * 只导出当前项目，但会额外携带全局 API 配置，方便在本地浏览器恢复继续跑
 */
export async function exportWorkflowSnapshot(state: AppState): Promise<void> {
  const exportFile = await buildWorkflowSnapshotExportFile(state);
  const currentProject = exportFile.project;

  downloadJsonFile(`${currentProject.name || '项目'}_全流程快照_${new Date().toISOString().slice(0, 10)}.json`, exportFile);
}

/**
 * 从导出文件中读取项目，保留为独立项目导入
 */
export async function importProject(
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Project> {
  const result = await importTransferFile(file, onProgress);
  if (result.kind !== 'project') {
    throw new Error('请导入项目导出文件');
  }
  return result.project;
}

/**
 * 从导出文件中读取当前流程快照
 */
export async function importWorkflowSnapshot(
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<AppState> {
  const result = await importTransferFile(file, onProgress);
  if (result.kind !== 'workflow-snapshot') {
    throw new Error('请导入全流程快照文件');
  }
  return result.state;
}

/**
 * 自动识别导出文件类型并导入
 */
export async function importTransferFile(
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<TransferImportResult> {
  const text = await file.text();
  let data: unknown;

  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error('文件格式错误：无法解析 JSON');
  }

  return importTransferData(data, onProgress);
}

export async function importTransferData(
  data: unknown,
  onProgress?: (loaded: number, total: number) => void,
  options: TransferImportOptions = {},
): Promise<TransferImportResult> {
  if (isWorkflowSnapshotFile(data)) {
    return { kind: 'workflow-snapshot', state: await importWorkflowSnapshotData(data, onProgress) };
  }

  if (!isProjectExportFile(data)) {
    throw new Error('文件内容不完整：缺少项目数据');
  }

  return { kind: 'project', project: await importProjectData(data, onProgress, options) };
}

async function importProjectData(
  data: ProjectExportFile,
  onProgress?: (loaded: number, total: number) => void,
  options: TransferImportOptions = {},
): Promise<Project> {
  const blobEntries = Object.entries(data.blobs || {});
  const keyMapping = await restoreBlobKeysFromExport(blobEntries, onProgress);
  return importProjectStructureWithBlobMapping(data.project, keyMapping, options);
}

export function importProjectStructureWithBlobMapping(
  projectInput: Project,
  keyMapping: Map<string, string>,
  options: TransferImportOptions = {},
): Project {
  const project = replaceBlobKeys(JSON.parse(JSON.stringify(projectInput)) as Project, keyMapping);

  if (options.remapProjectIds !== false) {
    const idMapping = new Map<string, string>();
    project.id = remapId(project.id, idMapping);
    project.currentChapterId = remapId(project.currentChapterId, idMapping);
    for (const chapter of project.chapters) {
      chapter.id = remapId(chapter.id, idMapping);
    }
  }

  const normalized = normalizePersistedState({
    projects: [project],
    currentProjectId: project.id,
  });
  return normalized.projects[0] ?? project;
}

async function importWorkflowSnapshotData(
  data: WorkflowSnapshotExportFile,
  onProgress?: (loaded: number, total: number) => void,
): Promise<AppState> {
  const blobEntries = Object.entries(data.blobs || {});
  const keyMapping = await restoreBlobKeysFromExport(blobEntries, onProgress);
  const project = replaceBlobKeys(data.project, keyMapping);

  return normalizePersistedState({
    projects: [project],
    currentProjectId: project.id,
    apiConfig: { ...DEFAULT_API_CONFIG, ...(data.apiConfig || {}) },
    imageApiConfig: { ...DEFAULT_IMAGE_API_CONFIG, ...(data.imageApiConfig || {}) },
    videoApiConfig: { ...DEFAULT_VIDEO_API_CONFIG, ...(data.videoApiConfig || {}) },
    ttsApiConfig: { ...DEFAULT_TTS_API_CONFIG, ...(data.ttsApiConfig || {}) },
    musicApiConfig: { ...DEFAULT_MUSIC_API_CONFIG, ...(data.musicApiConfig || {}) },
  });
}

/** 替换项目中所有旧 blobKey 为新 blobKey */
function replaceBlobKeys(project: Project, mapping: Map<string, string>): Project {
  const remap = (key: string | undefined) => (key ? (mapping.get(key) ?? key) : key);

  for (const asset of project.assetLibrary) {
    asset.blobKey = remap(asset.blobKey) ?? asset.blobKey;
    asset.lightweightBlobKey = remap(asset.lightweightBlobKey);
  }

  for (const voiceReference of project.characterVoiceReferences ?? []) {
    voiceReference.audioBlobKey = remap(voiceReference.audioBlobKey);
    voiceReference.blackVideoBlobKey = remap(voiceReference.blackVideoBlobKey);
  }

  for (const chapter of project.chapters) {
    for (const master of Object.values(chapter.sceneSpatialMasters ?? {})) {
      master.cleanBlobKey = remap(master.cleanBlobKey);
    }

    for (const sb of chapter.storyboards) {
      sb.videoBlobKey = remap(sb.videoBlobKey);

      for (const variant of Object.values(sb.storyboardBoard?.variants ?? {})) {
        if (!variant) continue;
        variant.visualBoardBlobKey = remap(variant.visualBoardBlobKey);
        variant.blobKey = remap(variant.blobKey);
        variant.lightweightBlobKey = remap(variant.lightweightBlobKey);
        variant.referencePack = variant.referencePack?.map((item) => ({
          ...item,
          blobKey: remap(item.blobKey) ?? item.blobKey,
          sourceBlobKey: remap(item.sourceBlobKey),
        }));
      }

      if (sb.scenePositionBoard) {
        sb.scenePositionBoard.cleanBlobKey = remap(sb.scenePositionBoard.cleanBlobKey);
        sb.scenePositionBoard.markedBlobKey = remap(sb.scenePositionBoard.markedBlobKey);
      }

      for (const seg of sb.prompt?.timeSegments ?? []) {
        seg.soundEffectBlobKey = remap(seg.soundEffectBlobKey);
      }

      if (sb.audioMix) {
        sb.audioMix.ttsBlobKeys = (sb.audioMix.ttsBlobKeys ?? []).map((key) => remap(key) ?? key);
        sb.audioMix.sfxBlobKeys = (sb.audioMix.sfxBlobKeys ?? []).map((key) => remap(key) ?? key);
        if (sb.audioMix.bgm) {
          sb.audioMix.bgm.blobKey = remap(sb.audioMix.bgm.blobKey);
        }
        sb.audioMix.mixBlobKey = remap(sb.audioMix.mixBlobKey);
      }
    }

    if (chapter.bgm) {
      chapter.bgm.blobKey = remap(chapter.bgm.blobKey);
    }
  }

  return project;
}

/** 重新生成 ID 并记录映射 */
function remapId(oldId: string, mapping: Map<string, string>): string {
  if (mapping.has(oldId)) return mapping.get(oldId)!;
  const newId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  mapping.set(oldId, newId);
  return newId;
}

/**
 * 导出整个应用状态（仅 JSON，不含二进制资源）
 * 保留给全量备份场景使用
 */
export function exportAppState(state: AppState): void {
  downloadJsonFile(`虾客漫_全量备份_${new Date().toISOString().slice(0, 10)}.json`, state);
}
