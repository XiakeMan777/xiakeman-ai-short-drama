import { createJSONStorage, type StateStorage } from "zustand/middleware";

/**
 * Custom Zustand persist storage that saves settings to both localStorage AND
 * a file on disk (via Tauri backend). This ensures settings survive:
 * - WebView2 cache clears (we delete EBWebView during dev)
 * - App reinstalls that might wipe localStorage
 *
 * Strategy:
 * - On save: write to localStorage (fast, synchronous) AND to disk (async, fire-and-forget)
 * - On load: try localStorage first (synchronous), disk is used for restoration at startup
 * - At app startup, `restoreSettingsFromDisk()` injects disk data into localStorage
 *   before Zustand hydrates, so localStorage always has the latest data
 */

const TAURI_KEY = "__TAURI__" as const;

function isTauriAvailable(): boolean {
  try {
    return TAURI_KEY in window || (window as any).isTauri === true;
  } catch {
    return false;
  }
}

async function saveToDisk(json: string): Promise<void> {
  if (!isTauriAvailable()) return;
  try {
    const { invoke } = await import("@/features/canvas/compat/tauriCore");
    await invoke("save_settings_json", { json });
  } catch (e) {
    console.warn("[SettingsStorage] Failed to save settings to disk:", e);
  }
}

async function loadFromDisk(): Promise<string | null> {
  if (!isTauriAvailable()) return null;
  try {
    const { invoke } = await import("@/features/canvas/compat/tauriCore");
    const json = await invoke<string>("load_settings_json");
    return json || null;
  } catch (e) {
    console.warn("[SettingsStorage] Failed to load settings from disk:", e);
    return null;
  }
}

/**
 * A StateStorage implementation that wraps localStorage and also persists to disk.
 * Used with `createJSONStorage()` in the Zustand persist middleware.
 */
const dualStorage: StateStorage = {
  getItem: (name: string): string | null => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },

  setItem: (name: string, value: string): void => {
    try {
      localStorage.setItem(name, value);
    } catch {
      console.warn("[SettingsStorage] Failed to save to localStorage");
    }

    // Also persist to disk (async, fire-and-forget)
    saveToDisk(value);
  },

  removeItem: (name: string): void => {
    try {
      localStorage.removeItem(name);
    } catch {
      console.warn("[SettingsStorage] Failed to remove from localStorage");
    }
    saveToDisk("");
  },
};

/**
 * Create the PersistStorage for Zustand's persist middleware.
 * Uses createJSONStorage to wrap our dualStorage (localStorage + disk).
 */
export const createSettingsPersistStorage = () =>
  createJSONStorage(() => dualStorage);

/**
 * Load settings from disk file and inject into localStorage if missing.
 * Call this early in app initialization (before Zustand hydrates).
 * Returns true if settings were restored from disk.
 */
export async function restoreSettingsFromDisk(): Promise<boolean> {
  if (!isTauriAvailable()) return false;

  try {
    const diskJson = await loadFromDisk();
    if (!diskJson) return false;

    const key = "storyboard-copilot-settings";
    const localValue = localStorage.getItem(key);

    if (!localValue && diskJson) {
      // localStorage is empty but disk has data — restore from disk
      localStorage.setItem(key, diskJson);
      console.log("[SettingsStorage] Restored settings from disk (localStorage was empty)");
      return true;
    }

    return false;
  } catch (e) {
    console.warn("[SettingsStorage] Failed to restore settings from disk:", e);
    return false;
  }
}



