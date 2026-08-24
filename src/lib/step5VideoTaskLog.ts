import type { VideoBackendType, VideoProductionMode } from '@/types';

export type Step5VideoTaskLogStatus =
  | 'submitting'
  | 'submitted'
  | 'polling'
  | 'poll_interrupted'
  | 'succeeded_remote'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface Step5VideoTaskLogEvent {
  at: number;
  status: Step5VideoTaskLogStatus;
  label: string;
  detail?: string;
  taskId?: string;
  videoUrl?: string;
}

export interface Step5VideoTaskLogEntry {
  id: string;
  projectId: string;
  projectName?: string;
  chapterId: string;
  chapterTitle?: string;
  storyboardIndex: number;
  storyboardNumber?: number;
  storyboardName?: string;
  backend?: VideoBackendType;
  productionMode?: VideoProductionMode;
  providerTaskId?: string;
  pendingTaskId?: string;
  clientTaskId?: string;
  status: Step5VideoTaskLogStatus;
  progress?: number;
  statusDetail?: string;
  duration?: number;
  promptHash?: string;
  promptPreview?: string;
  referenceHash?: string;
  continuityGroupId?: string;
  continuityReason?: string;
  extendSourceIndex?: number;
  extendSourceTaskId?: string;
  extendSourceBlobKey?: string;
  extendSubmittedAsExtend?: boolean;
  error?: string;
  videoUrl?: string;
  blobKey?: string;
  submittedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
  events: Step5VideoTaskLogEvent[];
}

export interface Step5VideoTaskLogSnapshot extends Omit<Step5VideoTaskLogEntry, 'createdAt' | 'updatedAt' | 'events'> {
  eventLabel: string;
  eventDetail?: string;
}

const DB_NAME = 'xiakeman-step5-task-history';
const DB_VERSION = 1;
const STORE_NAME = 'video-task-logs';
const MAX_EVENTS_PER_ENTRY = 50;
const MAX_LOG_ENTRIES = 1000;

let dbPromise: Promise<IDBDatabase> | null = null;
let dbInstance: IDBDatabase | null = null;

function openStep5TaskLogDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('projectId', 'projectId');
        store.createIndex('chapterId', 'chapterId');
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('providerTaskId', 'providerTaskId');
        store.createIndex('clientTaskId', 'clientTaskId');
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

function compactEvents(
  previous: Step5VideoTaskLogEvent[] | undefined,
  nextEvent: Step5VideoTaskLogEvent,
) {
  const events = previous ?? [];
  const lastEvent = events[events.length - 1];
  const duplicated = lastEvent
    && lastEvent.status === nextEvent.status
    && lastEvent.detail === nextEvent.detail
    && lastEvent.taskId === nextEvent.taskId
    && lastEvent.videoUrl === nextEvent.videoUrl;
  return duplicated
    ? events
    : [...events, nextEvent].slice(-MAX_EVENTS_PER_ENTRY);
}

function readAllEntries(db: IDBDatabase): Promise<Step5VideoTaskLogEntry[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as Step5VideoTaskLogEntry[] | undefined) ?? []);
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
  });
}

async function pruneOldEntries(db: IDBDatabase) {
  const entries = await readAllEntries(db);
  if (entries.length <= MAX_LOG_ENTRIES) return;
  const idsToDelete = entries
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    .slice(MAX_LOG_ENTRIES)
    .map((entry) => entry.id);
  if (idsToDelete.length === 0) return;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    idsToDelete.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveStep5VideoTaskLogSnapshot(
  snapshot: Step5VideoTaskLogSnapshot,
): Promise<Step5VideoTaskLogEntry> {
  const db = await openStep5TaskLogDb();
  const now = Date.now();

  const entry = await new Promise<Step5VideoTaskLogEntry>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(snapshot.id);

    request.onsuccess = () => {
      const previous = request.result as Step5VideoTaskLogEntry | undefined;
      const nextEvent: Step5VideoTaskLogEvent = {
        at: now,
        status: snapshot.status,
        label: snapshot.eventLabel,
        detail: snapshot.eventDetail,
        taskId: snapshot.providerTaskId ?? snapshot.pendingTaskId,
        videoUrl: snapshot.videoUrl,
      };
      const nextEntry: Step5VideoTaskLogEntry = {
        ...previous,
        ...snapshot,
        createdAt: previous?.createdAt ?? snapshot.submittedAt ?? now,
        updatedAt: now,
        events: compactEvents(previous?.events, nextEvent),
      };
      store.put(nextEntry);
      resolve(nextEntry);
    };

    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  pruneOldEntries(db).catch(() => undefined);
  return entry;
}

export async function listStep5VideoTaskLogs(options?: {
  projectId?: string;
  chapterId?: string;
  limit?: number;
}): Promise<Step5VideoTaskLogEntry[]> {
  const db = await openStep5TaskLogDb();
  const entries = await readAllEntries(db);
  const limit = options?.limit ?? 200;
  return entries
    .filter((entry) => !options?.projectId || entry.projectId === options.projectId)
    .filter((entry) => !options?.chapterId || entry.chapterId === options.chapterId)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    .slice(0, limit);
}

export async function clearStep5VideoTaskLogs(options?: {
  projectId?: string;
  chapterId?: string;
}): Promise<void> {
  const db = await openStep5TaskLogDb();
  const entries = await readAllEntries(db);
  const ids = entries
    .filter((entry) => !options?.projectId || entry.projectId === options.projectId)
    .filter((entry) => !options?.chapterId || entry.chapterId === options.chapterId)
    .map((entry) => entry.id);
  if (ids.length === 0) return;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    ids.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function closeStep5VideoTaskLogDbForTests(): void {
  dbInstance?.close();
  dbInstance = null;
  dbPromise = null;
}
