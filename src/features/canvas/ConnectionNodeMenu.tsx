import { useState, useEffect, useCallback, useRef } from "react";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { nodeRegistry } from "./domain/nodeRegistry";
import { CANVAS_NODE_TYPES } from "./domain/canvasNodes";

interface MenuState {
  visible: boolean;
  x: number;
  y: number;
  flowX: number;
  flowY: number;
  sourceNodeId: string;
  sourceNodeType: string;
  /** Whether the drag started from a source (output) handle or target (input) handle */
  handleType: "source" | "target" | "";
}

// Which target types can be connected FROM a source type (output handle drag)
// Excludes: upload (上传图片) and exportImage (导出图片) — user already has an image
const CONNECTION_TARGETS: Record<string, { registryKey: string; label: string; icon: string }[]> = {
  [CANVAS_NODE_TYPES.upload]: [
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "AI 图片", icon: "✨" },
    { registryKey: "videoGen", label: "生视频", icon: "🎬" },
    { registryKey: "videoFrame", label: "视频抽帧", icon: "🎞️" },
    { registryKey: CANVAS_NODE_TYPES.storyboardGen, label: "分镜生成", icon: "🎭" },
    { registryKey: CANVAS_NODE_TYPES.panorama360, label: "VR360 全景场景", icon: "🌐" },
    { registryKey: "director3d", label: "3D 导演台", icon: "🎮" },
    { registryKey: "audioNode", label: "音频", icon: "🔊" },
    { registryKey: "poseEditor", label: "姿势编辑器", icon: "🧍" },
  ],
  [CANVAS_NODE_TYPES.imageEdit]: [
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "AI 图片", icon: "✨" },
    { registryKey: "videoGen", label: "生视频", icon: "🎬" },
    { registryKey: "videoFrame", label: "视频抽帧", icon: "🎞️" },
    { registryKey: CANVAS_NODE_TYPES.storyboardGen, label: "分镜生成", icon: "🎭" },
    { registryKey: CANVAS_NODE_TYPES.panorama360, label: "VR360 全景场景", icon: "🌐" },
    { registryKey: "director3d", label: "3D 导演台", icon: "🎮" },
    { registryKey: "audioNode", label: "音频", icon: "🔊" },
    { registryKey: "poseEditor", label: "姿势编辑器", icon: "🧍" },
  ],
  [CANVAS_NODE_TYPES.videoFrame]: [
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "AI 图片", icon: "✨" },
    { registryKey: "videoGen", label: "生视频", icon: "🎬" },
    { registryKey: CANVAS_NODE_TYPES.storyboardGen, label: "分镜生成", icon: "🎭" },
    { registryKey: "director3d", label: "3D 导演台", icon: "🎮" },
    { registryKey: "audioNode", label: "音频", icon: "🔊" },
  ],
  [CANVAS_NODE_TYPES.storyboardGen]: [
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "AI 图片", icon: "✨" },
    { registryKey: CANVAS_NODE_TYPES.storyboardSplit, label: "分镜拆分", icon: "✂️" },
    { registryKey: "videoGen", label: "生视频", icon: "🎬" },
    { registryKey: "director3d", label: "3D 导演台", icon: "🎮" },
    { registryKey: "audioNode", label: "音频", icon: "🔊" },
  ],
  [CANVAS_NODE_TYPES.storyboardSplit]: [
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "AI 图片", icon: "✨" },
    { registryKey: "videoGen", label: "生视频", icon: "🎬" },
    { registryKey: CANVAS_NODE_TYPES.storyboardGen, label: "分镜生成", icon: "🎭" },
    { registryKey: "director3d", label: "3D 导演台", icon: "🎮" },
    { registryKey: "audioNode", label: "音频", icon: "🔊" },
  ],
  [CANVAS_NODE_TYPES.panorama360]: [
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "AI 图片", icon: "✨" },
    { registryKey: "videoGen", label: "生视频", icon: "🎬" },
    { registryKey: "director3d", label: "3D 导演台", icon: "🎮" },
    { registryKey: "audioNode", label: "音频", icon: "🔊" },
  ],
  [CANVAS_NODE_TYPES.video]: [
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "AI 图片", icon: "✨" },
    { registryKey: "videoGen", label: "生视频", icon: "🎬" },
    { registryKey: "videoFrame", label: "视频抽帧", icon: "🎞️" },
    { registryKey: "director3d", label: "3D 导演台", icon: "🎮" },
    { registryKey: "audioNode", label: "音频", icon: "🔊" },
  ],
  [CANVAS_NODE_TYPES.textAnnotation]: [
    { registryKey: CANVAS_NODE_TYPES.storyboardGen, label: "分镜生成", icon: "🎭" },
    { registryKey: "videoGen", label: "生视频", icon: "🎬" },
    { registryKey: "director3d", label: "3D 导演台", icon: "🎮" },
    { registryKey: "audioNode", label: "音频", icon: "🔊" },
  ],
  [CANVAS_NODE_TYPES.script]: [
    { registryKey: CANVAS_NODE_TYPES.storyboardGen, label: "分镜生成", icon: "🎭" },
    { registryKey: "videoGen", label: "生视频", icon: "🎬" },
    { registryKey: "director3d", label: "3D 导演台", icon: "🎮" },
    { registryKey: "audioNode", label: "音频", icon: "🔊" },
  ],
  [CANVAS_NODE_TYPES.director3d]: [
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "AI 图片", icon: "✨" },
    { registryKey: "videoGen", label: "生视频", icon: "🎬" },
    { registryKey: CANVAS_NODE_TYPES.storyboardGen, label: "分镜生成", icon: "🎭" },
    { registryKey: "audioNode", label: "音频", icon: "🔊" },
  ],
  [CANVAS_NODE_TYPES.audio]: [
    { registryKey: "videoGen", label: "生视频", icon: "🎬" },
  ],
  [CANVAS_NODE_TYPES.videoResult]: [
    { registryKey: "videoFrame", label: "视频抽帧", icon: "🎞️" },
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "AI 图片", icon: "✨" },
    { registryKey: "videoGen", label: "生视频", icon: "🎬" },
    { registryKey: CANVAS_NODE_TYPES.storyboardGen, label: "分镜生成", icon: "🎭" },
    { registryKey: "director3d", label: "3D 导演台", icon: "🎮" },
    { registryKey: "audioNode", label: "音频", icon: "🔊" },
  ],
};

// Which source types can feed INTO a target type (input handle drag — insert before)
const INPUT_CONNECTION_SOURCES: Record<string, { registryKey: string; label: string; icon: string }[]> = {
  [CANVAS_NODE_TYPES.imageEdit]: [
    { registryKey: CANVAS_NODE_TYPES.upload, label: "上传图片", icon: "📤" },
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "AI 图片", icon: "✨" },
    { registryKey: "videoFrame", label: "视频抽帧", icon: "🎞️" },
  ],
  [CANVAS_NODE_TYPES.video]: [
    { registryKey: CANVAS_NODE_TYPES.upload, label: "上传图片", icon: "📤" },
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "AI 图片", icon: "✨" },
    { registryKey: CANVAS_NODE_TYPES.audio, label: "音频", icon: "🔊" },
  ],
  [CANVAS_NODE_TYPES.storyboardGen]: [
    { registryKey: CANVAS_NODE_TYPES.upload, label: "上传图片", icon: "📤" },
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "AI 图片", icon: "✨" },
  ],
  [CANVAS_NODE_TYPES.panorama360]: [
    { registryKey: CANVAS_NODE_TYPES.upload, label: "上传图片", icon: "📤" },
  ],
  [CANVAS_NODE_TYPES.exportImage]: [
    { registryKey: CANVAS_NODE_TYPES.upload, label: "上传图片", icon: "📤" },
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "AI 图片", icon: "✨" },
    { registryKey: CANVAS_NODE_TYPES.storyboardGen, label: "分镜生成", icon: "🎭" },
  ],
  [CANVAS_NODE_TYPES.storyboardSplit]: [
    { registryKey: CANVAS_NODE_TYPES.upload, label: "上传图片", icon: "📤" },
    { registryKey: CANVAS_NODE_TYPES.imageEdit, label: "AI 图片", icon: "✨" },
  ],
};

export function ConnectionNodeMenu() {
  const [menu, setMenu] = useState<MenuState>({
    visible: false,
    x: 0,
    y: 0,
    flowX: 0,
    flowY: 0,
    sourceNodeId: "",
    sourceNodeType: "",
    handleType: "",
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const createConnectedNode = useCanvasStore((s) => s.createConnectedNode);
  const createNodeBefore = useCanvasStore((s) => s.createNodeBefore);

  const handleSelect = useCallback(
    (registryKey: string) => {
      if (!menu.sourceNodeId) return;

      if (menu.handleType === "target") {
        // Dragged from input handle — create a new node BEFORE this node
        createNodeBefore(menu.sourceNodeId, registryKey, menu.flowX, menu.flowY);
      } else {
        // Dragged from output handle — create a new node AFTER this node
        createConnectedNode(menu.sourceNodeId, registryKey, menu.flowX, menu.flowY);
      }
      setMenu((prev) => ({ ...prev, visible: false }));
    },
    [menu.sourceNodeId, menu.flowX, menu.flowY, menu.handleType, createConnectedNode, createNodeBefore]
  );

  // Listen for connection-end events from Canvas
  useEffect(() => {
    const handleConnectEnd = (e: CustomEvent) => {
      const { didConnect, clientX, clientY, flowX, flowY, sourceNodeId, sourceNodeType, handleType } = e.detail;
      if (didConnect) return;

      if (!sourceNodeId || !sourceNodeType) return;

      // Pick the right target list based on drag direction
      const targets = handleType === "target"
        ? INPUT_CONNECTION_SOURCES[sourceNodeType]
        : CONNECTION_TARGETS[sourceNodeType];

      if (!targets || targets.length === 0) return;

      setMenu({
        visible: true,
        x: clientX,
        y: clientY,
        flowX: flowX ?? clientX,
        flowY: flowY ?? clientY,
        sourceNodeId,
        sourceNodeType,
        handleType: handleType || "source",
      });
    };

    // Use a flag to prevent the mouseup from immediately closing the menu
    // that was just opened by the connection-end event.
    let justOpened = false;

    const handleClick = (e: MouseEvent) => {
      // Ignore clicks that happen right after opening (the mouseup that triggered onConnectEnd)
      if (justOpened) {
        justOpened = false;
        return;
      }
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    // Listen for the custom event to mark that menu was just opened
    const handleConnectionEndOpen = () => {
      justOpened = true;
      // Reset flag after a tick — the click event fires synchronously after mouseup
      requestAnimationFrame(() => {
        justOpened = false;
      });
    };

    window.addEventListener("connection-end" as never, handleConnectEnd);
    window.addEventListener("connection-end" as never, handleConnectionEndOpen);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("connection-end" as never, handleConnectEnd);
      window.removeEventListener("connection-end" as never, handleConnectionEndOpen);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (!menu.visible) return null;

  const targets = menu.handleType === "target"
    ? INPUT_CONNECTION_SOURCES[menu.sourceNodeType] || []
    : CONNECTION_TARGETS[menu.sourceNodeType] || [];

  const headerText = menu.handleType === "target"
    ? "选择上游节点类型"
    : "选择节点类型";

  return (
    <div
      ref={menuRef}
      className="fixed z-50"
      style={{
        left: menu.x,
        top: menu.y,
        minWidth: "200px",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "16px",
          padding: "8px",
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
            borderBottom: "1px solid var(--border)",
            marginBottom: "4px",
          }}
        >
          {headerText}
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
                gap: "12px",
                padding: "10px 14px",
                fontSize: "14px",
                color: "var(--text-primary)",
                borderRadius: "10px",
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
                  width: "32px",
                  height: "32px",
                  borderRadius: "10px",
                  backgroundColor: "var(--bg-secondary)",
                  fontSize: "16px",
                  flexShrink: 0,
                }}
              >
                {target.icon}
              </span>
              <span style={{ fontWeight: 500 }}>{target.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}



