import { useState, useCallback, useRef, useEffect } from "react";
import { useAssetStore, type AssetCategory, type AssetMediaType } from "@/features/canvas/stores/assetStore";
import { AssetCard } from "./AssetCard";
import { AssetCategoryDialog, ASSET_EDIT_CATEGORIES } from "./AssetCategoryDialog";
import { useConfirmStore } from "@/features/canvas/compat/ConfirmDialog";
import { useToastStore } from "@/features/canvas/compat/Toast";
import { persistImageSource, prepareNodeImageSource } from "@/features/canvas/compat/commands";
import { open as dialogOpen } from "@/features/canvas/compat/dialog";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { nodeRegistry } from "../domain/nodeRegistry";
import { CANVAS_NODE_TYPES } from "../domain/canvasNodes";
import { insertReferenceToken, buildReferenceToken } from "../application/referenceTokenEditing";
import { buildAssetImagePool } from "../application/referenceImagePool";
import type { AssetRecord } from "@/features/canvas/stores/assetStore";
import type { Node } from "@xyflow/react";

// ---------------------------------------------------------------------------
// Category tabs — U11: Shared CATEGORIES with the dialog (add "全部" here)
// ---------------------------------------------------------------------------

const CATEGORIES: { value: AssetCategory; label: string }[] = [
  { value: "全部", label: "全部" },
  ...ASSET_EDIT_CATEGORIES.map((c) => ({ value: c.value as AssetCategory, label: c.label })),
];

const MEDIA_TYPES: { value: AssetMediaType; label: string }[] = [
  { value: "全部", label: "全部" },
  { value: "图片", label: "图片" },
  { value: "视频", label: "视频" },
];

// ---------------------------------------------------------------------------
// AssetLibraryPanel
// ---------------------------------------------------------------------------

export function AssetLibraryPanel() {
  const assets = useAssetStore((s) => s.assets);
  const selectedCategory = useAssetStore((s) => s.selectedCategory);
  const searchQuery = useAssetStore((s) => s.searchQuery);
  const isPanelOpen = useAssetStore((s) => s.isPanelOpen);
  const isLoading = useAssetStore((s) => s.isLoading);
  const setCategory = useAssetStore((s) => s.setCategory);
  const setMediaType = useAssetStore((s) => s.setMediaType);
  const selectedMediaType = useAssetStore((s) => s.selectedMediaType);
  const setSearchQuery = useAssetStore((s) => s.setSearchQuery);
  const deleteAsset = useAssetStore((s) => s.deleteAsset);
  const clearAssets = useAssetStore((s) => s.clearAssets);
  const closePanel = useAssetStore((s) => s.closePanel);
  const loadAssets = useAssetStore((s) => s.loadAssets);
  const addAsset = useAssetStore((s) => s.addAsset);
  const updateAsset = useAssetStore((s) => s.updateAsset);

  const showConfirm = useConfirmStore((s) => s.showConfirm);
  const addToast = useToastStore((s) => s.addToast);

  const [searchInput, setSearchInput] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Upload dialog state
  const [isUploading, setIsUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<
    { path: string; name: string }[]
  >([]);
  const [pendingFileIndex, setPendingFileIndex] = useState(0);

  // U3: Edit dialog state
  const [editingAsset, setEditingAsset] = useState<AssetRecord | null>(null);

  // U8: Panel visibility animation
  const [isVisible, setIsVisible] = useState(false);

  // U8: Animate in when panel opens
  useEffect(() => {
    if (isPanelOpen) {
      // Trigger animation on next frame
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [isPanelOpen]);

  // Debounced search — local filter is instant, server refresh debounced
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      // Apply local filter immediately (no network request)
      setSearchQuery(value);
      // Debounce the server refresh in case user is typing fast
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
      searchTimerRef.current = setTimeout(() => {
        loadAssets();
      }, 500);
    },
    [setSearchQuery, loadAssets]
  );

  // U9: Clear search
  const handleClearSearch = useCallback(() => {
    setSearchInput("");
    setSearchQuery("");
    loadAssets();
  }, [setSearchQuery, loadAssets]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  // Sync searchInput when searchQuery changes externally
  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  // Handle delete
  const handleDelete = useCallback(
    (id: string) => {
      showConfirm({
        title: "删除素材",
        message: "确定要删除这个素材吗？此操作不可撤销。",
        confirmLabel: "删除",
        variant: "danger",
        onConfirm: async () => {
          try {
            await deleteAsset(id);
            addToast("success", "素材已删除");
          } catch (e) {
            console.error("Failed to delete asset:", e);
            addToast("error", "删除失败");
          }
        },
      });
    },
    [deleteAsset, showConfirm, addToast]
  );

  // U3: Handle edit — opens the edit dialog
  const handleEdit = useCallback((asset: AssetRecord) => {
    setEditingAsset(asset);
  }, []);

  // U3: Handle edit confirm — calls updateAsset
  const handleEditConfirm = useCallback(
    async (params: { name: string; category: string; tags: string }) => {
      if (!editingAsset) return;
      try {
        await updateAsset({
          id: editingAsset.id,
          name: params.name,
          category: params.category,
          tags: params.tags,
        });
        addToast("success", "素材已更新");
      } catch (e) {
        console.error("Failed to update asset:", e);
        addToast("error", "更新失败");
      }
      setEditingAsset(null);
    },
    [editingAsset, updateAsset, addToast]
  );

  // U1: Click on asset card — apply to selected node or create new node
  const handleAssetClick = useCallback(
    async (asset: AssetRecord) => {
      const isVideo = (asset.media_type || "image") === "video";
      const selectedNodeIds = useCanvasStore.getState().selectedNodeIds;
      const nodes = useCanvasStore.getState().nodes;

      // If a node is selected that accepts the same media type, set its content
      if (selectedNodeIds.length > 0) {
        const targetId = selectedNodeIds[0];
        const targetNode = nodes.find((n) => n.id === targetId);
        if (!targetNode) return;

        const nodeData = targetNode.data as Record<string, unknown>;
        if (!isVideo && "imageUrl" in nodeData) {
          try {
            const result = await prepareNodeImageSource(asset.file_path);
            useCanvasStore.getState().updateNodeData(targetId, {
              imageUrl: result.path,
              previewImageUrl: result.previewPath,
              imageWidth: result.width,
              imageHeight: result.height,
            });
            addToast("success", `已将素材"${asset.name}"应用到节点`);
            closePanel();
            return;
          } catch (e) {
            console.error("Failed to apply asset to node:", e);
            addToast("error", "应用素材失败");
            return;
          }
        }
        if (isVideo && "videoUrl" in nodeData) {
          useCanvasStore.getState().updateNodeData(targetId, {
            videoUrl: asset.file_path,
            displayName: asset.name,
          });
          addToast("success", `已将视频"${asset.name}"应用到节点`);
          closePanel();
          return;
        }
      }

      // No suitable selected node — create a new node with the content
      if (isVideo) {
        // Create a Video node with the video file
        const registry = nodeRegistry[CANVAS_NODE_TYPES.video];
        const nodeId = `video-${crypto.randomUUID()}`;
        const newNode: Node = {
          id: nodeId,
          type: CANVAS_NODE_TYPES.video,
          position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
          data: {
            ...registry.createDefaultData(),
            videoUrl: asset.file_path,
            displayName: asset.name,
            prompt: asset.name,
            inputText: asset.name,
          },
        };
        useCanvasStore.getState().addNode(newNode);
        addToast("success", `已创建视频节点: ${asset.name}`);
        closePanel();
      } else {
        // Create an Upload node with the image
        try {
          const result = await prepareNodeImageSource(asset.file_path);
          const registry = nodeRegistry[CANVAS_NODE_TYPES.upload];
          const nodeId = `upload-${crypto.randomUUID()}`;
          const newNode: Node = {
            id: nodeId,
            type: CANVAS_NODE_TYPES.upload,
            position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
            data: {
              ...registry.createDefaultData(),
              imageUrl: result.path,
              previewImageUrl: result.previewPath,
              imageWidth: result.width,
              imageHeight: result.height,
              sourceFileName: asset.name,
              displayName: asset.name,
            },
          };
          useCanvasStore.getState().addNode(newNode);
          addToast("success", `已创建节点: ${asset.name}`);
          closePanel();
        } catch (e) {
          console.error("Failed to create node from asset:", e);
          addToast("error", "创建节点失败");
        }
      }
    },
    [addToast, closePanel]
  );

  // U2: Drag start handler — stores asset info for canvas drop
  const handleAssetDragStart = useCallback(
    (_e: React.DragEvent, asset: AssetRecord) => {
      // We don't need to do anything special here — the AssetCard sets dataTransfer data
      // The Canvas drop handler will check for asset-specific data
      void asset; // suppress unused warning — data is set in AssetCard
    },
    []
  );

  // Insert asset as @图N reference into the currently selected node's prompt
  const handleInsertAsset = useCallback((_asset: AssetRecord) => {
    const { selectedNodeIds, nodes } = useCanvasStore.getState();
    if (selectedNodeIds.length === 0) {
      addToast("info", "请先选中一个节点");
      return;
    }
    const targetId = selectedNodeIds[0];
    const targetNode = nodes.find((n) => n.id === targetId);
    if (!targetNode) return;

    const data = targetNode.data as Record<string, unknown>;
    // Only nodes with inputText can accept reference tokens
    if (typeof data.inputText !== "string") {
      addToast("info", "该节点不支持插入素材引用");
      return;
    }

    // Build reference pool to determine next @图N number
    const allAssets = useAssetStore.getState().assets;
    const pool = buildAssetImagePool(allAssets);
    const entries = pool.entries.filter(
      (e: { sourceNodeId: string | null }) => e.sourceNodeId !== targetId
    );
    const nextNum = entries.length > 0 ? Math.max(...entries.map((e: { number: number }) => e.number)) + 1 : 1;

    const token = buildReferenceToken(nextNum);
    const result = insertReferenceToken(data.inputText, data.inputText.length, token);

    useCanvasStore.getState().updateNodeData(targetId, { inputText: result.text });
    addToast("success", `已插入 ${token} 到节点`);
  }, [addToast]);

  // Handle clear all
  const handleClearAll = useCallback(() => {
    if (assets.length === 0) return;
    showConfirm({
      title: "清空素材库",
      message: "确定要清空所有素材吗？此操作不可撤销。",
      confirmLabel: "清空",
      variant: "danger",
      onConfirm: async () => {
        try {
          await clearAssets();
          addToast("success", "素材库已清空");
        } catch (e) {
          console.error("Failed to clear assets:", e);
          addToast("error", "清空失败");
        }
      },
    });
  }, [assets.length, clearAssets, showConfirm, addToast]);

  // --- Local upload ---
  const handleUploadClick = useCallback(async () => {
    try {
      const selected = await dialogOpen({
        multiple: true,
        filters: [
          {
            name: "图片",
            extensions: [
              "png",
              "jpg",
              "jpeg",
              "webp",
              "bmp",
              "gif",
              "tiff",
              "svg",
            ],
          },
        ],
      });
      if (!selected) return;

      const files = (Array.isArray(selected) ? selected : [selected]).map(
        (p) => {
          const parts = p.replace(/\\/g, "/").split("/");
          const name = parts[parts.length - 1] || "未命名";
          return { path: p, name };
        }
      );

      if (files.length > 0) {
        setPendingFiles(files);
        setPendingFileIndex(0);
      }
    } catch (e) {
      console.error("File dialog error:", e);
      addToast("error", "打开文件对话框失败");
    }
  }, [addToast]);

  // U13: Handle category dialog confirm — supports batch mode with "apply to all"
  const handleCategoryConfirm = useCallback(
    async (params: { name: string; category: string; tags: string }) => {
      if (pendingFiles.length === 0) return;
      const file = pendingFiles[pendingFileIndex];
      if (!file) return;

      try {
        setIsUploading(true);
        // Persist the image to app data directory (content-addressable)
        const persistedPath = (await persistImageSource(file.path)) as string;
        // Add to asset database — U4: pass tags
        await addAsset({
          name: params.name,
          category: params.category,
          tags: params.tags,
          filePath: persistedPath,
          sourceType: "local_upload",
        });
        addToast("success", `已添加素材: ${params.name}`);
      } catch (e) {
        console.error("Failed to upload asset:", e);
        addToast("error", `上传失败: ${file.name}`);
      } finally {
        setIsUploading(false);
        // Move to next file or close dialog
        if (pendingFileIndex + 1 < pendingFiles.length) {
          setPendingFileIndex(pendingFileIndex + 1);
        } else {
          setPendingFiles([]);
          setPendingFileIndex(0);
          loadAssets();
        }
      }
    },
    [
      pendingFiles,
      pendingFileIndex,
      addAsset,
      addToast,
      loadAssets,
    ]
  );

  const handleCategoryCancel = useCallback(() => {
    setPendingFiles([]);
    setPendingFileIndex(0);
  }, []);

  // Escape to close (but not when category dialog or edit dialog is open — fix C2)
  useEffect(() => {
    if (!isPanelOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // If the category dialog or edit dialog is showing, let it handle Escape first
        if (pendingFiles.length > 0 || editingAsset) return;
        e.stopPropagation();
        closePanel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isPanelOpen, closePanel, pendingFiles.length, editingAsset]);

  if (!isPanelOpen) return null;

  const currentPendingFile =
    pendingFiles.length > 0 ? pendingFiles[pendingFileIndex] : null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center"
      style={{
        // C14: Use glass-bg + blur, consistent with ConfirmDialog
        backgroundColor: "var(--glass-bg)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        // U8: Fade-in animation for overlay
        opacity: isVisible ? 1 : 0,
        transition: "opacity 0.2s ease",
      }}
      onClick={(e) => {
        // U15: Only close on backdrop click if not uploading/editing
        if (e.target === e.currentTarget && !isUploading && !editingAsset) {
          closePanel();
        }
      }}
      role="dialog" // U12: Accessibility
      aria-label="素材库"
    >
      <div
        ref={panelRef}
        style={{
          width: "min(85vw, 600px)",
          height: "min(65vh, 450px)",
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "16px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "var(--shadow-panel)",
          // U8: Slide-up + fade animation for panel
          transform: isVisible ? "translateY(0)" : "translateY(20px)",
          opacity: isVisible ? 1 : 0,
          transition: "transform 0.25s ease, opacity 0.2s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h3
            style={{
              fontSize: "16px",
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            素材库
          </h3>
          <button
            onClick={closePanel}
            title="关闭"
            style={{
              width: "30px",
              height: "30px",
              borderRadius: "8px",
              backgroundColor: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background-color 0.15s",
            }}
            onMouseEnter={(e) => {
              // C8: More noticeable hover — change color + bg
              e.currentTarget.style.backgroundColor = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Category tabs + Search + Upload button */}
        <div
          className="flex items-center"
          style={{
            padding: "12px 20px",
            gap: "12px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {/* Category tabs — C1: use accent-muted bg + accent text */}
          <div className="flex" style={{ gap: "4px", flexShrink: 0 }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                style={{
                  padding: "5px 14px",
                  fontSize: "13px",
                  fontWeight: selectedCategory === cat.value ? 600 : 400,
                  color:
                    selectedCategory === cat.value
                      ? "var(--text-primary)"
                      : "var(--text-secondary)",
                  backgroundColor:
                    selectedCategory === cat.value
                      ? "var(--accent-muted)"
                      : "transparent",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (selectedCategory !== cat.value) {
                    e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text-primary)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedCategory !== cat.value) {
                    e.currentTarget.style.backgroundColor = "transparent";
                    e.currentTarget.style.color = "var(--text-secondary)";
                  } else {
                    e.currentTarget.style.backgroundColor = "var(--accent-muted)";
                  }
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Media type tabs (全部/图片/视频) */}
          <div className="flex" style={{ gap: "4px", flexShrink: 0, marginLeft: "4px" }}>
            {MEDIA_TYPES.map((mt) => (
              <button
                key={mt.value}
                onClick={() => setMediaType(mt.value)}
                style={{
                  padding: "5px 10px",
                  fontSize: "12px",
                  fontWeight: selectedMediaType === mt.value ? 600 : 400,
                  color:
                    selectedMediaType === mt.value
                      ? mt.value === "视频" ? "rgba(110, 231, 183, 0.95)"
                      : "var(--text-primary)"
                      : "var(--text-secondary)",
                  backgroundColor:
                    selectedMediaType === mt.value
                      ? mt.value === "视频" ? "rgba(16, 185, 129, 0.15)"
                      : "var(--accent-muted)"
                      : "transparent",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (selectedMediaType !== mt.value) {
                    e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text-primary)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedMediaType !== mt.value) {
                    e.currentTarget.style.backgroundColor = "transparent";
                    e.currentTarget.style.color = "var(--text-secondary)";
                  }
                }}
              >
                {mt.value === "视频" ? "▶ " : ""}{mt.label}
              </button>
            ))}
          </div>

          {/* Upload button — use a distinct blue accent for primary action */}
          <button
            onClick={handleUploadClick}
            disabled={isUploading}
            title="上传本地图片"
            style={{
              padding: "5px 14px",
              fontSize: "13px",
              fontWeight: 500,
              color: isUploading ? "var(--text-muted)" : "#fff",
              backgroundColor: isUploading
                ? "var(--bg-secondary)"
                : "var(--accent-btn)",
              border: "none",
              borderRadius: "8px",
              cursor: isUploading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              transition: "background-color 0.15s",
              opacity: isUploading ? 0.6 : 1,
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!isUploading) {
                e.currentTarget.style.backgroundColor = "var(--accent-btn-hover)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isUploading) {
                e.currentTarget.style.backgroundColor = "var(--accent-btn)";
              }
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {isUploading ? "上传中..." : "上传"}
          </button>

          {/* Search box — U9: with clear button */}
          <div style={{ flex: 1, maxWidth: "280px", marginLeft: "auto" }}>
            <div
              className="flex items-center"
              style={{
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "5px 10px",
                gap: "6px",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--text-muted)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="搜索标题/标签"
                style={{
                  flex: 1,
                  fontSize: "13px",
                  color: "var(--text-primary)",
                  backgroundColor: "transparent",
                  border: "none",
                  outline: "none",
                  boxShadow: "none",
                  appearance: "none",
                  WebkitAppearance: "none",
                  padding: 0,
                  margin: 0,
                  lineHeight: "normal",
                }}
                // C12: Add focus border highlight, consistent with dialog inputs
                onFocus={(e) => {
                  e.currentTarget.parentElement!.style.borderColor = "var(--accent-hover)";
                }}
                onBlur={(e) => {
                  e.currentTarget.parentElement!.style.borderColor = "var(--border)";
                }}
              />
              {/* U9: Clear search button */}
              {searchInput && (
                <button
                  onClick={handleClearSearch}
                  title="清除搜索"
                  style={{
                    width: "18px",
                    height: "18px",
                    borderRadius: "4px",
                    backgroundColor: "transparent",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    padding: 0,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "var(--text-primary)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Grid content */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "16px 20px",
          }}
        >
          {isLoading ? (
            <div
              className="flex items-center justify-center"
              style={{
                height: "100%",
                color: "var(--text-muted)",
                fontSize: "14px",
              }}
            >
              {/* U6: CSS spinner — C13: use accent-btn for better visibility */}
              <div
                style={{
                  width: "24px",
                  height: "24px",
                  border: "2px solid var(--border)",
                  borderTopColor: "var(--accent-btn)",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                  marginRight: "10px",
                }}
              />
              加载中…
            </div>
          ) : assets.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center"
              style={{ height: "100%", color: "var(--text-muted)" }}
            >
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginBottom: "8px" }}
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span style={{ fontSize: "14px" }}>暂无素材</span>
              <span style={{ fontSize: "12px", marginTop: "4px" }}>
                点击"上传"按钮或右键节点图片加入素材库
              </span>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: "12px",
              }}
            >
              {assets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                  onClick={handleAssetClick}
                  onDragStart={handleAssetDragStart}
                  onInsert={handleInsertAsset}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between"
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            共 {assets.length} 个素材 · 点击应用到选中节点或拖拽创建新节点
          </span>
          <div className="flex" style={{ gap: "8px" }}>
            <button
              onClick={closePanel}
              style={{
                padding: "7px 18px",
                fontSize: "13px",
                color: "var(--text-secondary)",
                backgroundColor: "var(--bg-hover)",
                border: "1px solid var(--border-hover)",
                borderRadius: "8px",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--bg-node)";
                e.currentTarget.style.borderColor = "var(--text-muted)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                e.currentTarget.style.borderColor = "var(--border-hover)";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              关闭
            </button>
            <button
              onClick={handleClearAll}
              disabled={assets.length === 0}
              style={{
                padding: "7px 18px",
                fontSize: "13px",
                // C4: Light error bg + error text for AA contrast
                color: assets.length > 0 ? "var(--error)" : "var(--text-muted)",
                backgroundColor: assets.length > 0 ? "rgba(224, 82, 82, 0.10)" : "transparent",
                border:
                  assets.length > 0
                    ? "1px solid rgba(224, 82, 82, 0.30)"
                    : "1px solid var(--border)",
                borderRadius: "8px",
                cursor: assets.length > 0 ? "pointer" : "not-allowed",
                opacity: assets.length > 0 ? 1 : 0.5,
              }}
              // C8-style: hover feedback for danger button
              onMouseEnter={(e) => {
                if (assets.length > 0) {
                  e.currentTarget.style.backgroundColor = "rgba(224, 82, 82, 0.18)";
                  e.currentTarget.style.borderColor = "rgba(224, 82, 82, 0.50)";
                }
              }}
              onMouseLeave={(e) => {
                if (assets.length > 0) {
                  e.currentTarget.style.backgroundColor = "rgba(224, 82, 82, 0.10)";
                  e.currentTarget.style.borderColor = "rgba(224, 82, 82, 0.30)";
                }
              }}
            >
              清空素材库
            </button>
          </div>
        </div>
      </div>

      {/* Category dialog for uploaded files */}
      {currentPendingFile && (
        <AssetCategoryDialog
          defaultName={
            currentPendingFile.name.replace(/\.[^.]+$/, "") ||
            currentPendingFile.name
          }
          onConfirm={handleCategoryConfirm}
          onCancel={handleCategoryCancel}
          // U13: Show progress indicator for batch uploads
          title={pendingFiles.length > 1 ? `加入素材库 (${pendingFileIndex + 1}/${pendingFiles.length})` : "加入素材库"}
        />
      )}

      {/* U3: Edit dialog for existing assets */}
      {editingAsset && (
        <AssetCategoryDialog
          defaultName={editingAsset.name}
          defaultTags={editingAsset.tags}
          defaultCategory={editingAsset.category}
          title="编辑素材"
          confirmLabel="保存"
          onConfirm={handleEditConfirm}
          onCancel={() => setEditingAsset(null)}
        />
      )}
    </div>
  );
}


