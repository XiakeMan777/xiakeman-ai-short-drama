import type { AppState } from '@/types';
import {
  loadPrimarySnapshot,
  PRIMARY_SNAPSHOT_KEY,
  readMetadata,
  savePrimarySnapshot,
  StaleSnapshotWriteError,
  writeMetadata,
  type AppStateSnapshot,
} from '@/lib/appStateDb';
import {
  API_CONFIG_KEY,
  createInitialState,
  loadState,
  normalizePersistedState,
  sanitizeStateForPersistence,
  setLegacyLocalStorageCompatibilityEnabled,
  STORAGE_KEY,
} from '@/lib/storage';

export const APP_STATE_META_KEY = 'drama-app-state-meta-v1';

const IDB_METADATA_KEY = 'primary-state';

interface LocalBootMeta {
  primaryStore: 'indexeddb';
  lastSaveRevision: number;
  lastSavedAt: string;
  migratedAt?: string;
}

export interface LoadAppStateResult {
  state: AppState;
  source: 'indexeddb' | 'localstorage' | 'default';
  migratedFromLocalStorage: boolean;
  saveRevision: number;
}

export interface SaveAppStateResult {
  ok: boolean;
  saveRevision: number;
  error?: unknown;
}

export interface BrowserStorageEstimate {
  quota?: number;
  usage?: number;
  usageRatio?: number;
  persisted?: boolean;
}

let currentSaveRevision = 0;
let activeSaveChain: Promise<SaveAppStateResult> | null = null;
let pendingSaveState: AppState | null = null;
let pendingSaveResolvers: Array<(result: SaveAppStateResult) => void> = [];
let persistenceScope = 'anonymous';

function sanitizePersistenceScope(scope: string): string {
  return scope.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'anonymous';
}

function snapshotKey(): string {
  return persistenceScope === 'anonymous'
    ? PRIMARY_SNAPSHOT_KEY
    : `${PRIMARY_SNAPSHOT_KEY}:${persistenceScope}`;
}

function metadataKey(): string {
  return persistenceScope === 'anonymous'
    ? IDB_METADATA_KEY
    : `${IDB_METADATA_KEY}:${persistenceScope}`;
}

function localBootMetaKey(): string {
  return persistenceScope === 'anonymous'
    ? APP_STATE_META_KEY
    : `${APP_STATE_META_KEY}:${persistenceScope}`;
}

function shouldUseLegacyLocalStorage(): boolean {
  return persistenceScope === 'anonymous';
}

export function configureAppStatePersistenceScope(scope: string): void {
  const nextScope = sanitizePersistenceScope(scope);
  if (nextScope === persistenceScope) return;

  persistenceScope = nextScope;
  currentSaveRevision = 0;
  activeSaveChain = null;
  pendingSaveState = null;
  pendingSaveResolvers = [];
  setLegacyLocalStorageCompatibilityEnabled(shouldUseLegacyLocalStorage());
}

function nowIso() {
  return new Date().toISOString();
}

function makeSnapshot(state: AppState, saveRevision: number, updatedAt = nowIso()): AppStateSnapshot {
  return {
    key: snapshotKey(),
    schemaVersion: 1,
    saveRevision,
    updatedAt,
    state: sanitizeStateForPersistence(state),
  };
}

function writeLocalBootMeta(meta: LocalBootMeta): void {
  try {
    localStorage.setItem(localBootMetaKey(), JSON.stringify(meta));
  } catch {
    // IndexedDB is the source of truth; local boot metadata is only a small hint.
  }
}

function writeApiConfigCompatibility(state: AppState): void {
  if (!shouldUseLegacyLocalStorage()) return;

  try {
    localStorage.setItem(
      API_CONFIG_KEY,
      JSON.stringify({
        llm: state.apiConfig,
        image: state.imageApiConfig,
        video: state.videoApiConfig,
        tts: state.ttsApiConfig,
        music: state.musicApiConfig,
      }),
    );
  } catch {
    // Keep the app state save successful even if the legacy compatibility key fails.
  }
}

async function persistMetadata(saveRevision: number, updatedAt: string, migratedAt?: string): Promise<void> {
  const meta: LocalBootMeta = {
    primaryStore: 'indexeddb',
    lastSaveRevision: saveRevision,
    lastSavedAt: updatedAt,
    migratedAt,
  };
  await writeMetadata(metadataKey(), meta);
  writeLocalBootMeta(meta);
}

function hasLocalStorageState(): boolean {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

export async function loadAppState(): Promise<LoadAppStateResult> {
  try {
    const snapshot = await loadPrimarySnapshot(snapshotKey());
    if (snapshot) {
      const state = normalizePersistedState(snapshot.state);
      currentSaveRevision = Math.max(currentSaveRevision, snapshot.saveRevision);
      return {
        state,
        source: 'indexeddb',
        migratedFromLocalStorage: false,
        saveRevision: snapshot.saveRevision,
      };
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[storage] IndexedDB load failed, falling back to localStorage', error);
    }
  }

  if (!shouldUseLegacyLocalStorage()) {
    currentSaveRevision = Math.max(currentSaveRevision, 0);
    return {
      state: createInitialState(),
      source: 'default',
      migratedFromLocalStorage: false,
      saveRevision: currentSaveRevision,
    };
  }

  const hadLocalStorageState = hasLocalStorageState();
  const state = loadState();
  if (!hadLocalStorageState || state.projects.length === 0) {
    currentSaveRevision = Math.max(currentSaveRevision, 0);
    return {
      state,
      source: 'default',
      migratedFromLocalStorage: false,
      saveRevision: currentSaveRevision,
    };
  }

  const saveRevision = Math.max(currentSaveRevision + 1, 1);
  const updatedAt = nowIso();
  try {
    await savePrimarySnapshot(makeSnapshot(state, saveRevision, updatedAt));
    const migratedSnapshot = await loadPrimarySnapshot(snapshotKey());
    if (!migratedSnapshot || migratedSnapshot.saveRevision !== saveRevision) {
      throw new Error('IndexedDB migration verification failed');
    }
    currentSaveRevision = saveRevision;
    await persistMetadata(saveRevision, updatedAt, updatedAt);
    writeApiConfigCompatibility(state);
    return {
      state: normalizePersistedState(migratedSnapshot.state),
      source: 'localstorage',
      migratedFromLocalStorage: true,
      saveRevision,
    };
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[storage] localStorage to IndexedDB migration failed', error);
    }
    return {
      state,
      source: 'localstorage',
      migratedFromLocalStorage: false,
      saveRevision: currentSaveRevision,
    };
  }
}

export async function saveAppState(state: AppState): Promise<SaveAppStateResult> {
  const saveRevision = currentSaveRevision + 1;
  const updatedAt = nowIso();
  currentSaveRevision = saveRevision;

  try {
    await savePrimarySnapshot(makeSnapshot(state, saveRevision, updatedAt));
    await persistMetadata(saveRevision, updatedAt);
    writeApiConfigCompatibility(state);
    return { ok: true, saveRevision };
  } catch (error) {
    if (error instanceof StaleSnapshotWriteError) {
      try {
        const snapshot = await loadPrimarySnapshot(snapshotKey());
        if (snapshot) currentSaveRevision = Math.max(currentSaveRevision, snapshot.saveRevision);
      } catch {
        // Preserve the original stale-write error for the caller.
      }
    }
    return { ok: false, saveRevision, error };
  }
}

export function queueSaveAppState(state: AppState): Promise<SaveAppStateResult> {
  if (!activeSaveChain) {
    activeSaveChain = drainLatestSave(state).finally(() => {
      activeSaveChain = null;
    });
    return activeSaveChain;
  }

  pendingSaveState = state;
  return new Promise((resolve) => {
    pendingSaveResolvers.push(resolve);
  });
}

async function drainLatestSave(initialState: AppState): Promise<SaveAppStateResult> {
  let stateToSave: AppState | null = initialState;
  let resolversForCurrentSave: Array<(result: SaveAppStateResult) => void> = [];
  let lastResult: SaveAppStateResult = {
    ok: true,
    saveRevision: currentSaveRevision,
  };

  while (stateToSave) {
    const snapshotState = stateToSave;
    stateToSave = null;
    lastResult = await saveAppState(snapshotState);

    resolversForCurrentSave.forEach((resolve) => resolve(lastResult));
    resolversForCurrentSave = [];

    if (pendingSaveState) {
      stateToSave = pendingSaveState;
      pendingSaveState = null;
      resolversForCurrentSave = pendingSaveResolvers;
      pendingSaveResolvers = [];
    }
  }

  return lastResult;
}

export async function getBrowserStorageEstimate(): Promise<BrowserStorageEstimate> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return {};

  const estimate = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted
    ? await navigator.storage.persisted().catch(() => undefined)
    : undefined;

  return {
    quota: estimate.quota,
    usage: estimate.usage,
    usageRatio: estimate.quota && estimate.usage ? estimate.usage / estimate.quota : undefined,
    persisted,
  };
}

export async function readAppStatePersistenceMetadata(): Promise<LocalBootMeta | null> {
  return readMetadata<LocalBootMeta>(metadataKey());
}

export function resetAppStatePersistenceForTests(): void {
  currentSaveRevision = 0;
  activeSaveChain = null;
  pendingSaveState = null;
  pendingSaveResolvers = [];
}
