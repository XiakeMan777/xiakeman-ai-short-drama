import { useState, useEffect, useCallback, useRef } from "react";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useAssetStore } from "@/features/canvas/stores/assetStore";
import { useToastStore } from "@/features/canvas/compat/Toast";
import { extractDisplayName } from "./application/imageData";
import { AssetCategoryDialog } from "./ui/AssetCategoryDialog";
import { nodeRegistry } from "./domain/nodeRegistry";
import { CANVAS_NODE_TYPES } from "./domain/canvasNodes";

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  nodeId: string;
  nodeType: string;
  hasImage: boolean;
}

/**
 * Which target node types can be generated from a source node.
 * Key = source node type (must have imageUrl), Value = list of registry keys.
 */
const GENERATE_TARGETS: Record<string, { registryKey: string; label: string; icon: string }[]> = {
  // From upload/image nodes → can generate AI images, videos, storyboard
  [CANVAS_NODE_TYPES.upload]: [
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "图片", icon: "✨" },
    { registryKey: "videoGen", label: "视频", icon: "🎬" },
    { registryKey: CANVAS_NODE_TYPES.storyboardGen, label: "分镜", icon: "🎭" },
  ],
  [CANVAS_NODE_TYPES.imageEdit]: [
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "图片", icon: "✨" },
    { registryKey: "videoGen", label: "视频", icon: "🎬" },
    { registryKey: CANVAS_NODE_TYPES.storyboardGen, label: "分镜", icon: "🎭" },
  ],
  [CANVAS_NODE_TYPES.videoFrame]: [
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "图片", icon: "✨" },
    { registryKey: "videoGen", label: "视频", icon: "🎬" },
  ],
  [CANVAS_NODE_TYPES.storyboardGen]: [
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "图片", icon: "✨" },
  ],
  [CANVAS_NODE_TYPES.storyboardSplit]: [
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "图片", icon: "✨" },
    { registryKey: "videoGen", label: "视频", icon: "🎬" },
  ],
  [CANVAS_NODE_TYPES.panorama360]: [
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "图片", icon: "✨" },
  ],
  // Text/script nodes → can generate storyboard, video
  [CANVAS_NODE_TYPES.textAnnotation]: [
    { registryKey: CANVAS_NODE_TYPES.storyboardGen, label: "分镜", icon: "🎭" },
    { registryKey: "videoGen", label: "视频", icon: "🎬" },
  ],
  [CANVAS_NODE_TYPES.script]: [
    { registryKey: CANVAS_NODE_TYPES.storyboardGen, label: "分镜", icon: "🎭" },
    { registryKey: "videoGen", label: "视频", icon: "🎬" },
  ],
  // Director3D → can generate image (screenshot)
  [CANVAS_NODE_TYPES.director3d]: [
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "图片", icon: "✨" },
    { registryKey: "videoGen", label: "视频", icon: "🎬" },
  ],
  // Video node (has imageUrl from thumbnail/cover)
  [CANVAS_NODE_TYPES.video]: [
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "图片", icon: "✨" },
    { registryKey: "videoGen", label: "视频", icon: "🎬" },
  ],
};

/**
 * Node types that have images and can be added to the asset library.
 */
const ASSET_CAPABLE_NODE_TYPES: Set<string> = new Set([
  CANVAS_NODE_TYPES.upload,
  CANVAS_NODE_TYPES.imageEdit,
  CANVAS_NODE_TYPES.videoFrame,
  CANVAS_NODE_TYPES.storyboardGen,
  CANVAS_NODE_TYPES.storyboardSplit,
  CANVAS_NODE_TYPES.panorama360,
  CANVAS_NODE_TYPES.director3d,
  CANVAS_NODE_TYPES.video,
]);

export function NodeContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    nodeId: "",
    nodeType: "",
    hasImage: false,
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const createConnectedNode = useCanvasStore((s) => s.createConnectedNode);
  const addAsset = useAssetStore((s) => s.addAsset);
  const addToast = useToastStore((s) => s.addToast);
  const [showAssetDialog, setShowAssetDialog] = useState(false);
  const [assetDialogDefaultName, setAssetDialogDefaultName] = useState("");

  const handleSelect = useCallback(
    (registryKey: string) => {
      if (!menu.nodeId) return;
      const nodeCount = useCanvasStore.getState().nodes.length;
      const MAX_NODES = 300;
      if (nodeCount >= MAX_NODES) {
        addToast("warning", `已达节点上限（${MAX_NODES}），无法添加更多节点`);
        return;
      }
      createConnectedNode(menu.nodeId, registryKey);
      setMenu((prev) => ({ ...prev, visible: false }));
    },
    [menu.nodeId, createConnectedNode, addToast]
  );

  const handleAddToAssetLibrary = useCallback(() => {
    const nodes = useCanvasStore.getState().nodes;
    const node = nodes.find((n) => n.id === menu.nodeId);
    if (!node) return;
    const nodeData = node.data as Record<string, unknown>;
    const imageUrl = (nodeData.imageUrl || nodeData.panoramaImage) as string | null;
    if (!imageUrl) return;

    const defaultName = extractDisplayName(imageUrl, "素材");
    setAssetDialogDefaultName(defaultName);
    setShowAssetDialog(true);
    setMenu((prev) => ({ ...prev, visible: false }));
  }, [menu.nodeId]);

  const handleAssetDialogConfirm = useCallback(
    async (params: { name: string; category: string }) => {
      const nodes = useCanvasStore.getState().nodes;
      const node = nodes.find((n) => n.id === menu.nodeId);
      if (!node) return;
      const nodeData = node.data as Record<string, unknown>;
      let imageUrl = (nodeData.imageUrl || nodeData.panoramaImage) as string | null;
      if (!imageUrl) return;

      try {
        // If the imageUrl is a data URL or HTTP URL, persist it first
        if (imageUrl.startsWith("data:") || imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
          const { invoke } = await import("@/features/canvas/compat/tauriCore");
          const persistedPath = (await invoke("persist_image_source", {
            source: imageUrl,
          })) as string;
          imageUrl = persistedPath;
        }

        await addAsset({
          name: params.name,
          category: params.category,
          tags: "",
          filePath: imageUrl,
          sourceType: "generated",
          sourceNodeId: menu.nodeId,
        });
        addToast("success", "已加入素材库");
      } catch (e) {
        console.error("Failed to add to asset library:", e);
        addToast("error", "加入素材库失败");
      }

      setShowAssetDialog(false);
    },
    [addAsset, addToast, menu.nodeId]
  );

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Check if right-clicking on a node
      const target = e.target as HTMLElement;
      const nodeEl = target.closest(".react-flow__node");

      if (!nodeEl) {
        setMenu((prev) => ({ ...prev, visible: false }));
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const nodeId = nodeEl.getAttribute("data-id");
      if (!nodeId) {
        setMenu((prev) => ({ ...prev, visible: false }));
        return;
      }

      // Find node in store to determine type
      const nodes = useCanvasStore.getState().nodes;
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) {
        setMenu((prev) => ({ ...prev, visible: false }));
        return;
      }

      const nodeType = node.type || "";
      const nodeData = node.data as Record<string, unknown>;
      const hasImage = !!(nodeData.imageUrl || nodeData.panoramaImage);

      // Only show menu for nodes that have generate targets
      const targets = GENERATE_TARGETS[nodeType];
      if (!targets || targets.length === 0) {
        setMenu((prev) => ({ ...prev, visible: false }));
        return;
      }

      setMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        nodeId,
        nodeType,
        hasImage,
      });
    };

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (!menu.visible && !showAssetDialog) return null;

  const targets = GENERATE_TARGETS[menu.nodeType] || [];
  const canAddToAssetLibrary = menu.hasImage && ASSET_CAPABLE_NODE_TYPES.has(menu.nodeType);

  return (
    <>
      {menu.visible && (
        <div
          ref={menuRef}
          className="fixed z-50"
          style={{
            left: menu.x,
            top: menu.y,
            minWidth: "180px",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: "12px",
              padding: "6px",
              boxShadow: "var(--shadow-panel)",
              overflow: "hidden",
              animation: "fadeIn 0.12s ease",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "6px 10px 8px",
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--text-muted)",
                letterSpacing: "0.3px",
                textTransform: "uppercase",
                marginBottom: "2px",
              }}
            >
              ⚡ 引用生成
            </div>

            {/* Options */}
            {targets.map((target) => {
              const def = nodeRegistry[target.registryKey];
              if (!def) return null;

              return (
                <button
                  key={target.registryKey}
                  onClick={() => handleSelect(target.registryKey)}
                  className="w-full text-left transition-colors flex items-center"
                  style={{
                    gap: "10px",
                    padding: "8px 10px",
                    fontSize: "13px",
                    color: "var(--text-primary)",
                    borderRadius: "8px",
                    backgroundColor: "transparent",
                    border: "none",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "rgba(187, 187, 187, 0.08)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  <span
                    className="flex items-center justify-center"
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "8px",
                      backgroundColor: "var(--bg-hover)",
                      fontSize: "14px",
                      flexShrink: 0,
                    }}
                  >
                    {target.icon}
                  </span>
                  <span style={{ fontWeight: 500, flex: 1 }}>引用生成{target.label}</span>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "auto" }}>
                    {target.registryKey === "imageEdit" ? "✨" : target.registryKey === "videoGen" ? "🎬" : "🎭"}
                  </span>
                </button>
              );
            })}

            {/* ── Canvas Tools: annotate/crop/split ── */}
            {canAddToAssetLibrary && (
              <>
                <div
                  style={{
                    borderTop: "1px solid var(--border)",
                    margin: "4px 0",
                  }}
                />
                <button
                  onClick={handleAddToAssetLibrary}
                  className="w-full text-left transition-colors flex items-center"
                  style={{
                    gap: "10px",
                    padding: "8px 10px",
                    fontSize: "13px",
                    color: "var(--text-primary)",
                    borderRadius: "8px",
                    backgroundColor: "transparent",
                    border: "none",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  <span
                    className="flex items-center justify-center"
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "8px",
                      backgroundColor: "rgba(234, 179, 8, 0.10)",
                      fontSize: "14px",
                      flexShrink: 0,
                    }}
                  >
                    📁
                  </span>
                  <span style={{ fontWeight: 500 }}>加入素材库</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Asset Category Dialog */}
      {showAssetDialog && (
        <AssetCategoryDialog
          defaultName={assetDialogDefaultName}
          onConfirm={handleAssetDialogConfirm}
          onCancel={() => setShowAssetDialog(false)}
        />
      )}
    </>
  );
}



