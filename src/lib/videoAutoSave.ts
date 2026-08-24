// ============================================================
// 视频自动保存 - File System Access API
// 支持选择本地目录后自动保存生成的视频文件
// ============================================================

import { resolveVideoBlob, sanitizeVideoFileName, writeBlobToDirectory } from '@/lib/videoFileUtils';
import { validateVideoBlob } from '@/lib/videoBlobUtils';

const FS_DB_NAME = 'drama-fs-access';
const FS_DB_VERSION = 2;  // v2: 新增 saved-keys store
const FS_STORE_NAME = 'dir-handles';
const SAVED_KEYS_STORE = 'saved-keys';

/**
 * File System Access API 的类型声明扩展
 * Chrome/Edge 86+ 支持
 */
declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
      startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
    }) => Promise<FileSystemDirectoryHandle>;
  }

  interface FileSystemDirectoryHandle {
    queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  }
}

/** 检测浏览器是否支持 File System Access API */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && !!window.showDirectoryPicker;
}

// ---------- IndexedDB 存储目录句柄 ----------

let dbPromise: Promise<IDBDatabase> | null = null;

function openFsDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(FS_DB_NAME, FS_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FS_STORE_NAME)) {
        db.createObjectStore(FS_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(SAVED_KEYS_STORE)) {
        db.createObjectStore(SAVED_KEYS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

/** 保存目录句柄到 IndexedDB */
async function saveDirHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openFsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FS_STORE_NAME, 'readwrite');
    tx.objectStore(FS_STORE_NAME).put(handle, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 从 IndexedDB 读取目录句柄 */
async function loadDirHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
  const db = await openFsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FS_STORE_NAME, 'readonly');
    const request = tx.objectStore(FS_STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

/** 删除目录句柄 */
async function deleteDirHandle(key: string): Promise<void> {
  const db = await openFsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FS_STORE_NAME, 'readwrite');
    tx.objectStore(FS_STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- 已保存 key 持久化（IndexedDB） ----------

const SAVED_KEYS_IDB_KEY = 'all-saved-keys';

/** 从 IndexedDB 加载已保存的 key 集合 */
export async function loadSavedKeys(): Promise<Set<string>> {
  try {
    const db = await openFsDB();
    return new Promise((resolve) => {
      const tx = db.transaction(SAVED_KEYS_STORE, 'readonly');
      const request = tx.objectStore(SAVED_KEYS_STORE).get(SAVED_KEYS_IDB_KEY);
      request.onsuccess = () => {
        const data = request.result;
        resolve(data ? new Set(data as string[]) : new Set());
      };
      request.onerror = () => resolve(new Set());
    });
  } catch {
    return new Set();
  }
}

/** 保存已保存的 key 集合到 IndexedDB */
export async function persistSavedKeys(keys: Set<string>): Promise<void> {
  try {
    const db = await openFsDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SAVED_KEYS_STORE, 'readwrite');
      tx.objectStore(SAVED_KEYS_STORE).put(Array.from(keys), SAVED_KEYS_IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 持久化失败不影响主流程
  }
}

/** 清除已保存的 key 集合 */
export async function clearSavedKeys(): Promise<void> {
  try {
    const db = await openFsDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SAVED_KEYS_STORE, 'readwrite');
      tx.objectStore(SAVED_KEYS_STORE).delete(SAVED_KEYS_IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 清除失败不影响主流程
  }
}

// ---------- 公共 API ----------

const DEFAULT_DIR_KEY = 'video-output-dir';

/**
 * 让用户选择输出目录
 * @returns 选择成功返回 true，取消或失败返回 false
 */
export async function pickOutputDirectory(): Promise<boolean> {
  if (!isFileSystemAccessSupported()) {
    console.warn('[videoAutoSave] 浏览器不支持 File System Access API');
    return false;
  }

  try {
    const dirHandle = await window.showDirectoryPicker!({
      id: 'video-output',
      mode: 'readwrite',
      startIn: 'videos',
    });

    // 验证权限
    const permStatus = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (permStatus !== 'granted') {
      const reqStatus = await dirHandle.requestPermission({ mode: 'readwrite' });
      if (reqStatus !== 'granted') {
        console.warn('[videoAutoSave] 用户未授予目录写入权限');
        return false;
      }
    }

    await saveDirHandle(DEFAULT_DIR_KEY, dirHandle);
    return true;
  } catch (err) {
    // 用户取消选择会抛出 DOMException
    if ((err as DOMException).name !== 'AbortError') {
      console.error('[videoAutoSave] 选择目录失败:', err);
    }
    return false;
  }
}

/**
 * 请求已保存目录的持久权限
 * @returns true 表示权限有效
 */
export async function verifyDirPermission(): Promise<boolean> {
  const dirHandle = await loadDirHandle(DEFAULT_DIR_KEY);
  if (!dirHandle) return false;

  try {
    const permStatus = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (permStatus === 'granted') return true;

    // 尝试请求权限
    const reqStatus = await dirHandle.requestPermission({ mode: 'readwrite' });
    return reqStatus === 'granted';
  } catch {
    return false;
  }
}

/**
 * 获取当前保存的目录名（用于 UI 展示）
 */
export async function getOutputDirName(): Promise<string | null> {
  const dirHandle = await loadDirHandle(DEFAULT_DIR_KEY);
  return dirHandle?.name ?? null;
}

/**
 * 清除保存的目录句柄
 */
export async function clearOutputDirectory(): Promise<void> {
  await deleteDirHandle(DEFAULT_DIR_KEY);
}

/**
 * 确保子目录存在并返回其句柄
 */
async function ensureSubDir(
  parentHandle: FileSystemDirectoryHandle,
  dirName: string,
): Promise<FileSystemDirectoryHandle> {
  return await parentHandle.getDirectoryHandle(sanitizeVideoFileName(dirName), { create: true });
}

async function getExistingSubDir(
  parentHandle: FileSystemDirectoryHandle,
  dirName: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parentHandle.getDirectoryHandle(sanitizeVideoFileName(dirName), { create: false });
  } catch {
    return null;
  }
}

/**
 * Read a video that was previously written by autoSaveVideo.
 * Path: selected output dir / projectName / chapterName / fileName.mp4
 */
export async function getAutoSavedVideoBlob(
  projectName: string | undefined,
  chapterName: string | undefined,
  fileName: string | undefined,
): Promise<Blob | null> {
  if (!projectName || !chapterName || !fileName) return null;

  const dirHandle = await loadDirHandle(DEFAULT_DIR_KEY);
  if (!dirHandle) return null;

  try {
    let permStatus = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (permStatus !== 'granted') {
      permStatus = await dirHandle.requestPermission({ mode: 'readwrite' });
    }
    if (permStatus !== 'granted') return null;

    const projectDir = await getExistingSubDir(dirHandle, projectName);
    if (!projectDir) return null;

    const chapterDir = await getExistingSubDir(projectDir, chapterName);
    if (!chapterDir) return null;

    const fileHandle = await chapterDir.getFileHandle(
      `${sanitizeVideoFileName(fileName.replace(/\.mp4$/i, ''))}.mp4`,
      { create: false },
    );
    const file = await fileHandle.getFile();
    const validation = await validateVideoBlob(file);
    return validation.valid ? file : null;
  } catch {
    return null;
  }
}

/**
 * 自动保存视频到本地目录
 * 目录结构: 输出目录/项目名/章节名/分镜01_名称.mp4
 *
 * @param videoUrl - 视频的 URL（同源，可直接 fetch）
 * @param projectName - 项目名称
 * @param chapterName - 章节名称
 * @param fileName - 文件名（不含 .mp4 后缀）
 * @returns 保存成功返回 true，失败返回 false
 */
export async function autoSaveVideo(
  videoUrl: string | undefined,
  projectName: string,
  chapterName: string,
  fileName: string,
  videoBlobKey?: string,
): Promise<{ success: boolean; path: string; error?: string; skipped?: boolean }> {
  // 参数校验
  if (!videoUrl && !videoBlobKey) return { success: false, path: '', error: '视频数据为空' };
  if (!projectName) return { success: false, path: '', error: '项目名称为空' };
  if (!chapterName) return { success: false, path: '', error: '章节名称为空' };
  if (!fileName) return { success: false, path: '', error: '文件名为空' };

  const dirHandle = await loadDirHandle(DEFAULT_DIR_KEY);
  if (!dirHandle) {
    return { success: false, path: '', error: '未设置输出目录' };
  }

  try {
    // 验证权限
    const hasPermission = await verifyDirPermission();
    if (!hasPermission) {
      return { success: false, path: '', error: '目录写入权限已过期，请重新选择' };
    }

    // 创建子目录结构
    const projectDir = await ensureSubDir(dirHandle, projectName);
    const chapterDir = await ensureSubDir(projectDir, chapterName);

    const blob = await resolveVideoBlob(videoUrl, videoBlobKey);
    if (!blob) {
      return { success: false, path: '', error: '下载视频失败：无法获取视频内容' };
    }

    await writeBlobToDirectory(chapterDir, fileName, blob);

    const fullPath = `${dirHandle.name}/${sanitizeVideoFileName(projectName)}/${sanitizeVideoFileName(chapterName)}/${sanitizeVideoFileName(fileName)}.mp4`;
    return { success: true, path: fullPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[videoAutoSave] 保存失败:', msg);
    return { success: false, path: '', error: msg };
  }
}
