import { create } from "zustand";

export interface AssetRecord {
  id: string;
  name: string;
  category: string;
  tags: string;
  file_path: string;
  thumbnail_path: string | null;
  source_type: string;
  source_node_id: string | null;
  media_type: string | null;
  created_at: number;
}

export type AssetCategory = "全部" | "模特" | "场景" | "道具";
export type AssetMediaType = "全部" | "图片" | "视频";

interface AssetState {
  allAssets: AssetRecord[];
  assets: AssetRecord[];
  selectedCategory: AssetCategory;
  selectedMediaType: AssetMediaType;
  searchQuery: string;
  isPanelOpen: boolean;
  isLoading: boolean;
  loadAssets: () => Promise<void>;
  loadAllAssets: () => Promise<void>;
  refreshAll: () => Promise<void>;
  addAsset: (params: {
    name: string;
    category: string;
    tags: string;
    filePath: string;
    sourceType: string;
    sourceNodeId?: string;
    mediaType?: string;
  }) => Promise<string>;
  deleteAsset: (id: string) => Promise<void>;
  clearAssets: () => Promise<void>;
  updateAsset: (params: {
    id: string;
    name?: string;
    category?: string;
    tags?: string;
  }) => Promise<void>;
  setCategory: (category: AssetCategory) => void;
  setMediaType: (mediaType: AssetMediaType) => void;
  setSearchQuery: (query: string) => void;
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
}

const STORAGE_KEY = "xiakeman-canvas-assets";

function readAssets(): AssetRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAssets(assets: AssetRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(assets));
}

function filterAssets(
  all: AssetRecord[],
  category: AssetCategory,
  mediaType: AssetMediaType,
  search: string,
): AssetRecord[] {
  let result = all;
  if (category !== "全部") {
    result = result.filter((asset) => asset.category === category);
  }
  if (mediaType !== "全部") {
    const value = mediaType === "图片" ? "image" : "video";
    result = result.filter((asset) => (asset.media_type || "image") === value);
  }
  if (search.trim()) {
    const lower = search.trim().toLowerCase();
    result = result.filter(
      (asset) =>
        asset.name.toLowerCase().includes(lower) ||
        asset.tags.toLowerCase().includes(lower),
    );
  }
  return result.sort((a, b) => b.created_at - a.created_at);
}

function syncFiltered(set: (state: Partial<AssetState>) => void, get: () => AssetState) {
  const allAssets = readAssets();
  const { selectedCategory, selectedMediaType, searchQuery } = get();
  set({
    allAssets,
    assets: filterAssets(allAssets, selectedCategory, selectedMediaType, searchQuery),
    isLoading: false,
  });
}

export const useAssetStore = create<AssetState>((set, get) => ({
  allAssets: [],
  assets: [],
  selectedCategory: "全部",
  selectedMediaType: "全部",
  searchQuery: "",
  isPanelOpen: false,
  isLoading: false,

  loadAssets: async () => {
    set({ isLoading: true });
    syncFiltered(set, get);
  },

  loadAllAssets: async () => {
    syncFiltered(set, get);
  },

  refreshAll: async () => {
    syncFiltered(set, get);
  },

  addAsset: async (params) => {
    const id = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const asset: AssetRecord = {
      id,
      name: params.name,
      category: params.category || "道具",
      tags: params.tags || "",
      file_path: params.filePath,
      thumbnail_path: params.filePath,
      source_type: params.sourceType,
      source_node_id: params.sourceNodeId ?? null,
      media_type: params.mediaType ?? "image",
      created_at: Date.now(),
    };
    writeAssets([asset, ...readAssets()]);
    await get().refreshAll();
    return id;
  },

  deleteAsset: async (id) => {
    writeAssets(readAssets().filter((asset) => asset.id !== id));
    await get().refreshAll();
  },

  clearAssets: async () => {
    writeAssets([]);
    await get().refreshAll();
  },

  updateAsset: async (params) => {
    writeAssets(
      readAssets().map((asset) =>
        asset.id === params.id
          ? {
              ...asset,
              name: params.name ?? asset.name,
              category: params.category ?? asset.category,
              tags: params.tags ?? asset.tags,
            }
          : asset,
      ),
    );
    await get().refreshAll();
  },

  setCategory: (selectedCategory) => {
    set({ selectedCategory });
    syncFiltered(set, get);
  },

  setMediaType: (selectedMediaType) => {
    set({ selectedMediaType });
    syncFiltered(set, get);
  },

  setSearchQuery: (searchQuery) => {
    set({ searchQuery });
    syncFiltered(set, get);
  },

  togglePanel: () => {
    const next = !get().isPanelOpen;
    set({ isPanelOpen: next });
    if (next) void get().loadAssets();
  },

  openPanel: () => {
    set({ isPanelOpen: true });
    void get().loadAssets();
  },

  closePanel: () => set({ isPanelOpen: false }),
}));

