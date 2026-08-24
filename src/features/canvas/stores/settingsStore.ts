import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSettingsPersistStorage } from "./settingsStorage";

interface ProviderConfig {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  modelName?: string;
  channel?: string;
}

/** Custom API provider — user-defined OpenAI-compatible endpoint */
export interface CustomProviderConfig {
  id: string;           // unique ID, e.g. "custom-1718547200"
  name: string;         // display name, e.g. "我的API"
  baseUrl: string;      // e.g. "https://api.example.com/v1"
  apiKey: string;       // API key
  /** Which node types this custom provider supports */
  capabilities: ("chat" | "image" | "video" | "audio")[];
  /** API format — determines URL construction and request body shape */
  apiFormat?: "openai" | "volcano" | "kling" | "luma" | "runway" | "minimax" | "yunzhi" | "pika" | "vidu" | "veo" | "grok" | "sora" | "zhipu" | "aicost" | "axmgc" | "custom";  // default: "openai"
  /** Custom format overrides (only used when apiFormat=custom) */
  _submit_url_path?: string;   // e.g. "/v1/video/generations"
  _poll_url_path?: string;     // e.g. "/v1/video/generations"
  _status_field?: string;      // e.g. "status" / "state" / "task_status"
  _done_value?: string;        // e.g. "succeeded" / "completed" / "done"
  _video_url_field?: string;   // e.g. "resource_list.0.resource_url" / "video_url"
  _auth_style?: "bearer" | "token" | "x-goog-api-key";  // default: "bearer"
  /** Optional comma-separated model list (for UI model selector) */
  models?: string;
  createdAt: number;    // timestamp
}

interface SettingsState {
  language: string;
  theme: "light" | "dark" | "system";
  providers: ProviderConfig[];
  customProviders: CustomProviderConfig[];
  showGrid: boolean;
  autoSave: boolean;
  storyboardGenAutoInferEmptyFrame: boolean;
  projectSavePath: string | null;
  /** Whether credits system is enabled (loaded from Rust backend at startup) */
  creditsEnabled: boolean;

  setLanguage: (lang: string) => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  addProvider: (provider: ProviderConfig) => void;
  updateProvider: (id: string, data: Partial<ProviderConfig>) => void;
  removeProvider: (id: string) => void;
  addCustomProvider: (provider: CustomProviderConfig) => void;
  updateCustomProvider: (id: string, data: Partial<CustomProviderConfig>) => void;
  removeCustomProvider: (id: string) => void;
  setShowGrid: (show: boolean) => void;
  setAutoSave: (auto: boolean) => void;
  setStoryboardGenAutoInferEmptyFrame: (value: boolean) => void;
  setProjectSavePath: (path: string | null) => void;
  setCreditsEnabled: (enabled: boolean) => void;
}

const XIAKEMAN_SD2_BASE_URL = "https://sd2.xiakeman.com";
const XIAKEMAN_ARTLIST_IMAGE_BASE_URL = "https://sd2.xiakeman.com/api";
const DEFAULT_CHAT_MODEL = "grsai/gpt-5.5";
const DEFAULT_IMAGE_MODEL = "artlist/nano-banana";
const DEFAULT_VIDEO_CHANNEL = "vjimeng";
const DEFAULT_VIDEO_MODEL = "fast";

function migrateLegacyDefaultModel(modelName: string | undefined, legacyDefaults: string[], fallback: string): string {
  const trimmed = modelName?.trim();
  if (!trimmed || legacyDefaults.includes(trimmed)) return fallback;
  return trimmed;
}

function normalizeProviderConfig(provider: ProviderConfig): ProviderConfig {
  if (provider.id === "chat-model") {
    return {
      ...provider,
      name: "对话模型",
      baseUrl: provider.baseUrl && provider.baseUrl !== "https://api.openai.com/v1" ? provider.baseUrl : "https://grsaiapi.com/v1",
      channel: "grsai",
      modelName: migrateLegacyDefaultModel(provider.modelName, ["grsai/gemini-2.5-flash", "gemini-2.5-flash"], DEFAULT_CHAT_MODEL),
      enabled: true,
    };
  }
  if (provider.id === "image-model") {
    const legacyImageDefaults = ["nano-banana-2", "grsai/nano-banana-2", "grsai/gpt-image-2", "gpt-image-2"];
    const shouldMigrateLegacyImageDefault = !provider.modelName || legacyImageDefaults.includes(provider.modelName);
    return {
      ...provider,
      name: "图像模型",
      baseUrl: shouldMigrateLegacyImageDefault
        ? XIAKEMAN_ARTLIST_IMAGE_BASE_URL
        : (provider.baseUrl && provider.baseUrl !== "https://api.openai.com/v1" ? provider.baseUrl : XIAKEMAN_ARTLIST_IMAGE_BASE_URL),
      channel: shouldMigrateLegacyImageDefault ? "artlist" : (provider.channel || "artlist"),
      modelName: shouldMigrateLegacyImageDefault ? DEFAULT_IMAGE_MODEL : provider.modelName,
      enabled: true,
    };
  }
  if (provider.id === "video-model") {
    const rawChannel = provider.channel === "vjimeng" || provider.channel === "vjimeng-sd2" ? provider.channel : DEFAULT_VIDEO_CHANNEL;
    const shouldMigrateLegacyVideoDefault = rawChannel === "vjimeng-sd2" && (!provider.modelName || provider.modelName === "sd2-720p-fast");
    const channel = shouldMigrateLegacyVideoDefault ? DEFAULT_VIDEO_CHANNEL : rawChannel;
    return {
      ...provider,
      name: "视频模型",
      baseUrl: provider.baseUrl && !/siliconflow|vjimeng\.vip|113\.207\.49\.151/i.test(provider.baseUrl) ? provider.baseUrl : XIAKEMAN_SD2_BASE_URL,
      channel,
      modelName: shouldMigrateLegacyVideoDefault
        ? DEFAULT_VIDEO_MODEL
        : migrateLegacyDefaultModel(provider.modelName, ["transit9-mini", "transit9-fast", "sd2-720p-fast"], channel === "vjimeng" ? DEFAULT_VIDEO_MODEL : "sd2-720p-fast"),
      enabled: true,
    };
  }
  if (provider.id === "audio-model") {
    return {
      ...provider,
      name: "音频模型",
      baseUrl: provider.baseUrl || "https://grsaiapi.com/v1",
      channel: "grsai",
      enabled: true,
    };
  }
  if (provider.id === "jimeng-official") {
    return { ...provider, enabled: false };
  }
  const builtinNames: Record<string, string> = {
    grsai: "虾客漫图像",
    yunzhi: "虾客漫图像",
    artlist: "虾客漫自有图片",
    vjimeng: "虾客漫视频",
    "vjimeng-sd2": "虾客漫 SD2",
  };
  const fallbackName = builtinNames[provider.id];
  if (!fallbackName) return provider;
  const shouldUpgradeBaseUrl = (provider.id === "vjimeng-sd2" || provider.id === "vjimeng")
    && (!provider.baseUrl || /vjimeng\.vip|113\.207\.49\.151/i.test(provider.baseUrl));
  return {
    ...provider,
    name: provider.name && !["XioArtTV", "XioArtTV (备用)", "星核"].includes(provider.name) ? provider.name : fallbackName,
    baseUrl: shouldUpgradeBaseUrl ? XIAKEMAN_SD2_BASE_URL : provider.baseUrl,
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: "zh",
      theme: "dark",
      providers: [
        {
          id: "grsai",
          name: "虾客漫图像",
          apiKey: "",
          baseUrl: "https://grsaiapi.com",
          enabled: true,
        },
        {
          id: "yunzhi",
          name: "虾客漫图像",
          apiKey: "",
          baseUrl: "https://aiyunzhi.top",
          enabled: true,
        },
        {
          id: "artlist",
          name: "虾客漫自有图片",
          apiKey: "",
          baseUrl: XIAKEMAN_ARTLIST_IMAGE_BASE_URL,
          enabled: true,
        },
        {
          id: "vjimeng",
          name: "虾客漫视频",
          apiKey: "",
          baseUrl: XIAKEMAN_SD2_BASE_URL,
          enabled: true,
        },
        {
          id: "vjimeng-sd2",
          name: "虾客漫 SD2",
          apiKey: "",
          baseUrl: XIAKEMAN_SD2_BASE_URL,
          enabled: true,
        },
        {
          id: "chat-model",
          name: "对话模型",
          apiKey: "",
          baseUrl: "https://grsaiapi.com/v1",
          enabled: true,
          channel: "grsai",
          modelName: DEFAULT_CHAT_MODEL,
        },
        {
          id: "image-model",
          name: "图像模型",
          apiKey: "",
          baseUrl: XIAKEMAN_ARTLIST_IMAGE_BASE_URL,
          enabled: true,
          channel: "artlist",
          modelName: DEFAULT_IMAGE_MODEL,
        },
        {
          id: "video-model",
          name: "视频模型",
          apiKey: "",
          baseUrl: XIAKEMAN_SD2_BASE_URL,
          enabled: true,
          channel: DEFAULT_VIDEO_CHANNEL,
          modelName: DEFAULT_VIDEO_MODEL,
        },
        {
          id: "audio-model",
          name: "音频模型",
          apiKey: "",
          baseUrl: "https://grsaiapi.com/v1",
          enabled: true,
          channel: "grsai",
        },
      ],
      customProviders: [],
      showGrid: true,
      autoSave: true,
      storyboardGenAutoInferEmptyFrame: false,
      projectSavePath: null as string | null,
      // Community edition is BYOK-only. Managed credits belong in a private,
      // server-side deployment and must never rely on browser-bundled keys.
      creditsEnabled: false,

      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      addProvider: (provider) =>
        set((s) => ({ providers: [...s.providers, provider] })),
      updateProvider: (id, data) =>
        set((s) => {
          const exists = s.providers.some((p) => p.id === id);
          if (exists) {
            return {
              providers: s.providers.map((p) =>
                p.id === id ? { ...p, ...data } : p
              ),
            };
          }
          // Id not found → add new provider entry
          return {
            providers: [
              ...s.providers,
              { id, name: id, apiKey: "", baseUrl: "", enabled: true, ...data },
            ],
          };
        }),
      removeProvider: (id) =>
        set((s) => ({ providers: s.providers.filter((p) => p.id !== id) })),
      addCustomProvider: (provider) =>
        set((s) => ({ customProviders: [...s.customProviders, provider] })),
      updateCustomProvider: (id, data) =>
        set((s) => ({
          customProviders: s.customProviders.map((p) =>
            p.id === id ? { ...p, ...data } : p
          ),
        })),
      removeCustomProvider: (id) =>
        set((s) => ({ customProviders: s.customProviders.filter((p) => p.id !== id) })),
      setShowGrid: (showGrid) => set({ showGrid }),
      setAutoSave: (autoSave) => set({ autoSave }),
      setStoryboardGenAutoInferEmptyFrame: (storyboardGenAutoInferEmptyFrame) =>
        set({ storyboardGenAutoInferEmptyFrame }),
      setProjectSavePath: (projectSavePath) => set({ projectSavePath }),
      setCreditsEnabled: () => set({ creditsEnabled: false }),
    }),
    {
      name: "storyboard-copilot-settings",
      version: 2,
      storage: createSettingsPersistStorage(),
      partialize: (state) => {
        // Don't persist creditsEnabled — it's loaded from Rust backend at startup
        const { creditsEnabled, setCreditsEnabled, ...rest } = state;
        return rest as Partial<SettingsState>;
      },
      merge: (persistedState: any, currentState: SettingsState) => {
        // Preserve user-defined providers while keeping the community build BYOK-only.
        const mergedProviders = new Map<string, ProviderConfig>();
        for (const provider of currentState.providers) {
          mergedProviders.set(provider.id, normalizeProviderConfig(provider));
        }
        for (const provider of ((persistedState as Partial<SettingsState>)?.providers || [])) {
          mergedProviders.set(provider.id, normalizeProviderConfig(provider));
        }
        return {
          ...currentState,
          ...(persistedState as Partial<SettingsState>),
          providers: Array.from(mergedProviders.values()),
          customProviders: Array.isArray(persistedState?.customProviders)
            ? persistedState.customProviders
            : currentState.customProviders,
          creditsEnabled: false,
        } as SettingsState;
      },
      migrate: (persistedState: any) => {
        // v0→v2: strip stale creditsEnabled that was incorrectly persisted
        if (persistedState) {
          delete persistedState.creditsEnabled;
        }
        // Ensure all providers have required fields and correct defaults
        if (persistedState?.providers) {
          persistedState.providers = persistedState.providers.map((p: any) => ({
            ...p,
            enabled: p.id === "openai-compatible" ? true : (p.enabled ?? false),
          })).map(normalizeProviderConfig);
        }
        return persistedState;
      },
    }
  )
);



