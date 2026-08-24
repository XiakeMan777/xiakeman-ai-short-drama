// ============================================================
// IndexedDB 图片存储
// Blob 独立存储，key = blobKey (UUID)
// ============================================================

const DB_NAME = 'drama-asset-db';
const DB_VERSION = 1;
const STORE_NAME = 'asset-blobs';
const BLOB_STORE_OPERATION_TIMEOUT_MS = 120_000;

// 缓存 IDB 连接，避免每次操作都重新打开
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null; // 打开失败时清除缓存，允许重试
      reject(request.error);
    };
  });

  return dbPromise;
}

/** 保存 Blob，返回 blobKey */
export async function saveBlob(blob: Blob): Promise<string> {
  const blobKey = crypto.randomUUID();
  await saveBlobWithKey(blobKey, blob);
  return blobKey;
}

/** 保存 Blob 到指定 blobKey，用于云端快速导入后的按需本地缓存 */
export async function saveBlobWithKey(blobKey: string, blob: Blob): Promise<string> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      callback();
    };
    const fail = (error: unknown, fallbackMessage: string) => {
      finish(() => reject(error ?? new Error(fallbackMessage)));
    };
    const timeoutId = setTimeout(() => {
      fail(new Error('本地素材库写入超时，请刷新后重试'), '本地素材库写入超时，请刷新后重试');
    }, BLOB_STORE_OPERATION_TIMEOUT_MS);

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const request = tx.objectStore(STORE_NAME).put(blob, blobKey);
    request.onerror = () => fail(request.error ?? tx.error, '本地素材库写入失败');
    tx.oncomplete = () => finish(() => resolve(blobKey));
    tx.onerror = () => fail(tx.error ?? request.error, '本地素材库写入失败');
    tx.onabort = () => fail(tx.error ?? request.error, '本地素材库写入已中断');
  });
}

/** 通过 blobKey 加载 Blob */
export async function loadBlob(blobKey: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(blobKey);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

/** 删除 Blob */
export async function deleteBlob(blobKey: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(blobKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 批量删除 Blob */
export async function deleteBlobs(blobKeys: string[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    blobKeys.forEach((key) => store.delete(key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
