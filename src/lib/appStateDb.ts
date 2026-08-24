import type { AppState } from '@/types';

export const APP_STATE_DB_NAME = 'drama-app-state-db';
export const APP_STATE_DB_VERSION = 1;

const SNAPSHOTS_STORE = 'state-snapshots';
const METADATA_STORE = 'metadata';
export const PRIMARY_SNAPSHOT_KEY = 'primary';

export interface AppStateSnapshot {
  key: string;
  schemaVersion: 1;
  saveRevision: number;
  updatedAt: string;
  state: AppState;
}

interface MetadataRecord {
  key: string;
  value: unknown;
}

export class StaleSnapshotWriteError extends Error {
  constructor() {
    super('Refusing to overwrite a newer app state snapshot');
    this.name = 'StaleSnapshotWriteError';
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;
let dbInstance: IDBDatabase | null = null;

function openAppStateDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(APP_STATE_DB_NAME, APP_STATE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        db.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        db.createObjectStore(METADATA_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
        dbPromise = null;
      };
      resolve(request.result);
    };

    request.onerror = () => {
      dbInstance = null;
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

export async function loadPrimarySnapshot(key = PRIMARY_SNAPSHOT_KEY): Promise<AppStateSnapshot | null> {
  const db = await openAppStateDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOTS_STORE, 'readonly');
    const request = tx.objectStore(SNAPSHOTS_STORE).get(key);
    request.onsuccess = () => resolve((request.result as AppStateSnapshot | undefined) ?? null);
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function savePrimarySnapshot(snapshot: AppStateSnapshot): Promise<void> {
  const db = await openAppStateDb();
  return new Promise((resolve, reject) => {
    let staleError: StaleSnapshotWriteError | null = null;
    const tx = db.transaction(SNAPSHOTS_STORE, 'readwrite');
    const store = tx.objectStore(SNAPSHOTS_STORE);
    const request = store.get(snapshot.key);

    request.onsuccess = () => {
      const current = request.result as AppStateSnapshot | undefined;
      if (current && current.saveRevision > snapshot.saveRevision) {
        staleError = new StaleSnapshotWriteError();
        tx.abort();
        return;
      }
      store.put(snapshot);
    };

    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(staleError ?? tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function readMetadata<T = unknown>(key: string): Promise<T | null> {
  const db = await openAppStateDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(METADATA_STORE, 'readonly');
    const request = tx.objectStore(METADATA_STORE).get(key);
    request.onsuccess = () => {
      const record = request.result as MetadataRecord | undefined;
      resolve(record ? (record.value as T) : null);
    };
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function writeMetadata(key: string, value: unknown): Promise<void> {
  const db = await openAppStateDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(METADATA_STORE, 'readwrite');
    tx.objectStore(METADATA_STORE).put({ key, value } satisfies MetadataRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function closeAppStateDbConnectionForTests(): void {
  dbInstance?.close();
  dbInstance = null;
  dbPromise = null;
}
