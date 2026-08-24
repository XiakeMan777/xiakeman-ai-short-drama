import { useState, useCallback, useEffect, useRef, useMemo, memo } from "react";
import { createPortal } from "react-dom";
import { Canvas } from "@react-three/fiber";
import type { RootState as FiberRootState } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { type NodeProps, Handle, Position } from "@xyflow/react";
import * as THREE from "three";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useToastStore } from "@/features/canvas/compat/Toast";
import type { Panorama360NodeData } from "../domain/canvasNodes";
import {
  prepareNodeImageFromFile,
  resolveImageDisplayUrl,
} from "../application/imageData";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";

type PreviewMode = "single" | "grid4" | "grid12";

export const Panorama360Node = memo(function Panorama360Node({ id, data, selected, positionAbsoluteX, positionAbsoluteY }: NodeProps & { data: Panorama360NodeData }) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const addNode = useCanvasStore((s) => s.addNode);
  const addEdge = useCanvasStore((s) => s.addEdge);
  const nodeData = data;

  // --- Data migration ---
  useEffect(() => {
    if (nodeData.panoramaImage === undefined) {
      updateNodeData(id, {
        ...nodeData,
        panoramaImage: null,
        panoramaUrl: null,
        isPreviewMode: false,
      });
    }
  }, []);

  // --- State ---
  const [panoramaImage, setPanoramaImage] = useState<string | null>(nodeData.panoramaImage ?? null);
  const [panoramaUrl, setPanoramaUrl] = useState(nodeData.panoramaUrl ?? "");
  const [urlInput, setUrlInput] = useState("");
  const [isPreviewMode, setIsPreviewMode] = useState(nodeData.isPreviewMode ?? false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("single");
  const [fov, setFov] = useState(75);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isExportingSnapshot, setIsExportingSnapshot] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  // --- Canvas size observer ---
  // --- Persist ---
  useEffect(() => {
    if (panoramaImage && panoramaImage.startsWith("blob:")) return;
    updateNodeData(id, {
      ...nodeData,
      panoramaImage,
      panoramaUrl,
      isPreviewMode,
    });
  }, [panoramaImage, panoramaUrl, isPreviewMode]);

  // --- File upload (with Tauri persistence) ---
  const processFile = useCallback(
    async (file: File) => {
      setIsUploading(true);
      let tempBlobUrl: string | null = null;
      try {
        tempBlobUrl = URL.createObjectURL(file);
        setPanoramaImage(tempBlobUrl);
        setPanoramaUrl("");

        const result = await prepareNodeImageFromFile(file);
        if (result) {
          setPanoramaImage(result.path);
          addToast("success", `全景图已上传: ${file.name}`);
        } else {
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
          setPanoramaImage(dataUrl);
          addToast("warning", "后端持久化失败，使用数据预览");
        }
      } catch (e) {
        addToast("error", `上传失败: ${e}`);
      } finally {
        if (tempBlobUrl) URL.revokeObjectURL(tempBlobUrl);
        setIsUploading(false);
      }
    },
    [addToast]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      processFile(file);
    },
    [processFile]
  );

  // --- URL load ---
  const loadFromUrl = useCallback(() => {
    if (!urlInput.trim()) return;
    setPanoramaImage(urlInput.trim());
    setPanoramaUrl(urlInput.trim());
    setUrlInput("");
  }, [urlInput]);

  // --- Drag & drop ---
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) {
        processFile(file);
      }
    },
    [processFile]
  );

  // --- Export: capture current view → create linked UploadNode ---
  const handleExport = useCallback(async () => {
    if (!panoramaImage) return;
    setIsExportingSnapshot(true);
    try {
      const canvas = glCanvasRef.current;
      if (!canvas) {
        addToast("error", "无法获取渲染画面，请稍后重试");
        return;
      }
      const dataUrl = canvas.toDataURL("image/png");

      const { persistImageSource } = await import("@/features/canvas/compat/commands");
      const persistedPath = (await persistImageSource(dataUrl)) as string;

      const newNodeId = `uploadNode-${crypto.randomUUID()}`;
      const { nodeRegistry } = await import("../domain/nodeRegistry");
      const uploadDef = nodeRegistry["uploadNode"];
      const defaultData = uploadDef ? uploadDef.createDefaultData() : { displayName: "VR360 截图" };

      addNode({
        id: newNodeId,
        type: "uploadNode",
        position: {
          x: (positionAbsoluteX ?? 0) + 500,
          y: positionAbsoluteY ?? 0,
        },
        data: {
          ...defaultData,
          imageUrl: persistedPath,
          previewImageUrl: persistedPath,
          sourceFileName: `vr360_snapshot_${Date.now()}.png`,
          displayName: "VR360 截图",
        },
      });

      addEdge({
        id: `edge-${id}-${newNodeId}`,
        source: id,
        target: newNodeId,
        type: "dataFlow",
      });

      addToast("success", "已截取当前视角并创建图片节点 →");
    } catch (e) {
      addToast("error", `截图导出失败: ${e}`);
    } finally {
      setIsExportingSnapshot(false);
    }
  }, [panoramaImage, id, positionAbsoluteX, positionAbsoluteY, addNode, addEdge, addToast]);

  // --- Clear ---
  const handleClear = useCallback(() => {
    setPanoramaImage(null);
    setPanoramaUrl("");
    setIsPreviewMode(false);
  }, []);

  // --- Open preview ---
  const openPreview = useCallback(() => {
    setIsPreviewMode(true);
    setPreviewMode("single");
  }, []);

  const closePreview = useCallback(() => {
    setIsPreviewMode(false);
  }, []);

  const hasImage = !!panoramaImage;

  const nodeWidth = nodeData.width || 520;
  const nodeHeight = nodeData.height || 400;
  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );

  return (
    <>
    <NodeDeleteButton id={id} selected={!!selected} />
    <div style={{ position: 'relative' }}>
    <div
      id={`panorama-node-${id}`}
      className="node-inner"
      style={{
        width: nodeWidth,
        height: nodeHeight,
        background: "var(--bg-node)",
        borderRadius: 'var(--node-radius)',
        border: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>VR360 全景</span>
        </div>
        {hasImage && (
          <div style={{ display: "flex", gap: 4 }}>
            <button
              className="nodrag"
              onClick={openPreview}
              title="360°全屏预览"
              style={{
                padding: "3px 8px",
                borderRadius: 4,
                border: "none",
                background: "var(--accent-btn)",
                color: "#fff",
                fontSize: 11,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
              </svg>
              预览
            </button>
            <button
              className="nodrag"
              onClick={handleExport}
              disabled={isExportingSnapshot}
              title="导出当前视角截图"
              style={{
                padding: "3px 8px",
                borderRadius: 4,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-secondary)",
                fontSize: 11,
                cursor: isExportingSnapshot ? "not-allowed" : "pointer",
                opacity: isExportingSnapshot ? 0.5 : 1,
                display: "flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              {isExportingSnapshot ? (
                <div style={{ width: "12px", height: "12px", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              )}
              {isExportingSnapshot ? "导出中..." : "截图"}
            </button>
          </div>
        )}
      </div>

      {/* Main content area — fills remaining space */}
      {hasImage ? (
        <div style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0 }}>
          <Canvas
            camera={{ position: [0, 0, 0.1], fov: 75 }}
            gl={{ preserveDrawingBuffer: true, antialias: true }}
            onCreated={(state: FiberRootState) => {
              glCanvasRef.current = state.gl.domElement;
            }}
            style={{ width: "100%", height: "100%", display: "block" }}
          >
              <PanoramaSphere imageUrl={resolveImageDisplayUrl(panoramaImage)} />
              <OrbitControls
                enableZoom={true}
                enablePan={false}
                rotateSpeed={-0.5}
                minDistance={0.1}
                maxDistance={0.1}
              />
            </Canvas>

          {/* Bottom hint */}
          <div style={{
            position: "absolute",
            bottom: 8,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 10,
            color: "var(--text-secondary)",
            padding: "2px 10px",
            borderRadius: 4,
            background: "var(--glass-bg)",
            pointerEvents: "none",
          }}>
            拖拽旋转 · 滚轮缩放
          </div>

          {/* Change image button — small overlay at bottom-right */}
          <button
            className="nodrag"
            onClick={handleClear}
            style={{
              position: "absolute",
              bottom: 8,
              right: 8,
              padding: "3px 8px",
              borderRadius: 4,
              border: "1px solid var(--border-glow)",
              background: "var(--glass-bg)",
              color: "var(--text-secondary)",
              fontSize: 10,
              cursor: "pointer",
              backdropFilter: "blur(4px)",
              transition: "background-color 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--glass-bg)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
          >
            更换
          </button>
        </div>
      ) : (
        /* Upload placeholder — compact */
        <div
          className="nodrag"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isUploading && fileInputRef.current?.click()}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            border: isDragging ? "2px dashed var(--accent)" : "2px dashed var(--border)",
            borderRadius: 8,
            margin: 12,
            background: isDragging ? "var(--accent-dim)" : "transparent",
            transition: "all 0.2s",
            cursor: isUploading ? "not-allowed" : "pointer",
            opacity: isUploading ? 0.6 : 1,
            minHeight: 0,
          }}
        >
          {isUploading ? (
            <>
              <div className="animate-spin" style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>
                上传中...
              </div>
            </>
          ) : (
            <>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginTop: 8 }}>
                拖入或点击上传全景图
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                也支持从上游节点输入
              </div>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            style={{ display: "none" }}
          />
        </div>
      )}

      {/* URL input — compact bar at bottom when no image */}
      {!hasImage && (
        <div style={{
          display: "flex",
          gap: 6,
          padding: "0 12px 12px",
          alignItems: "center",
          flexShrink: 0,
        }}>
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadFromUrl()}
            placeholder="粘贴图片URL，回车加载"
            style={{
              flex: 1,
              fontSize: 11,
              padding: "5px 10px",
              borderRadius: 4,
              background: "var(--bg-primary)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              outline: "none",
            }}
          />
          <button
            className="nodrag"
            onClick={loadFromUrl}
            disabled={!urlInput.trim()}
            style={{
              fontSize: 11,
              padding: "5px 10px",
              borderRadius: 4,
              border: "none",
              background: urlInput.trim() ? "var(--accent-btn)" : "var(--bg-primary)",
              color: urlInput.trim() ? "#fff" : "var(--text-muted)",
              cursor: urlInput.trim() ? "pointer" : "not-allowed",
              flexShrink: 0,
            }}
          >
            加载
          </button>
        </div>
      )}

      {/* Fullscreen Preview Mode */}
      {isPreviewMode && createPortal(
        <PanoramaPreview
          imageUrl={resolveImageDisplayUrl(panoramaImage!)}
          previewMode={previewMode}
          setPreviewMode={setPreviewMode}
          fov={fov}
          setFov={setFov}
          onClose={closePreview}
          onExport={handleExport}
        />,
        document.body
      )}
    </div>
    <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize} minWidth={400} maxWidth={900} minHeight={300} maxHeight={1200} />
    </div>
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[var(--accent-secondary)] !w-6 !h-6 !border-2 !border-[var(--bg-node)]"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[var(--accent-secondary)] !w-6 !h-6 !border-2 !border-[var(--bg-node)]"
      />
    </>
  );
});

// --- Fullscreen Panorama Preview ---
function PanoramaPreview({
  imageUrl,
  previewMode,
  setPreviewMode,
  fov,
  setFov,
  onClose,
  onExport,
}: {
  imageUrl: string;
  previewMode: PreviewMode;
  setPreviewMode: (m: PreviewMode) => void;
  fov: number;
  setFov: (v: number) => void;
  onClose: () => void;
  onExport: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 999,
        background: "#000",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top toolbar */}
      <div style={{
        position: "absolute",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        gap: 8,
        zIndex: 10,
      }}>
        <button
          onClick={() => setPreviewMode("single")}
          style={{
            padding: "8px 20px",
            borderRadius: 20,
            border: "none",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            background: previewMode === "single" ? "var(--accent)" : "var(--accent-dim)",
            color: "var(--text-primary)",
            backdropFilter: "blur(10px)",
            transition: "background 0.2s, opacity 0.2s",
            opacity: 0.8,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.8"; }}
        >
          当前视角
        </button>
        <button
          onClick={() => setPreviewMode("grid4")}
          style={{
            padding: "8px 20px",
            borderRadius: 20,
            border: "none",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            background: previewMode === "grid4" ? "var(--warning)" : "var(--accent-dim)",
            color: "var(--text-primary)",
            backdropFilter: "blur(10px)",
            transition: "background 0.2s, opacity 0.2s",
            opacity: 0.8,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.8"; }}
        >
          4宫格参考
        </button>
        <button
          onClick={() => setPreviewMode("grid12")}
          style={{
            padding: "8px 20px",
            borderRadius: 20,
            border: "none",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            background: previewMode === "grid12" ? "var(--info)" : "var(--accent-dim)",
            color: "var(--text-primary)",
            backdropFilter: "blur(10px)",
            transition: "background 0.2s, opacity 0.2s",
            opacity: 0.8,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.8"; }}
        >
          12宫格参考
        </button>
        <button
          onClick={onExport}
          style={{
            padding: "8px 20px",
            borderRadius: 20,
            border: "none",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            background: "var(--accent-dim)",
            color: "var(--text-primary)",
            backdropFilter: "blur(10px)",
            transition: "background 0.2s, opacity 0.2s",
            opacity: 0.8,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.8"; }}
        >
          导出
        </button>
        <button
          onClick={onClose}
          style={{
            padding: "8px 20px",
            borderRadius: 20,
            border: "none",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            background: "var(--accent-dim)",
            color: "var(--text-primary)",
            backdropFilter: "blur(10px)",
            transition: "background 0.2s, opacity 0.2s",
            opacity: 0.8,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.8"; }}
        >
          关闭
        </button>
      </div>

      {/* Main viewer area */}
      <div style={{ flex: 1, position: "relative" }}>
        {previewMode === "single" && (
          <SinglePanoramaView imageUrl={imageUrl} fov={fov} />
        )}
        {previewMode === "grid4" && (
          <GridPanoramaView imageUrl={imageUrl} cols={2} rows={2} fov={fov} />
        )}
        {previewMode === "grid12" && (
          <GridPanoramaView imageUrl={imageUrl} cols={4} rows={3} fov={fov} />
        )}
      </div>

      {/* Bottom zoom slider */}
      <div style={{
        position: "absolute",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        width: 320,
        padding: "12px 20px",
        borderRadius: 12,
        background: "var(--glass-bg)",
        backdropFilter: "blur(10px)",
        zIndex: 10,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-primary)" }}>缩放</span>
          <span style={{ fontSize: 12, color: "var(--text-primary)" }}>{fov}°</span>
        </div>
        <input
          type="range"
          min={30}
          max={120}
          value={fov}
          onChange={(e) => setFov(Number(e.target.value))}
          style={{
            width: "100%",
            height: 4,
            borderRadius: 2,
            appearance: "none",
            background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${((fov - 30) / (120 - 30)) * 100}%, var(--border) ${((fov - 30) / (120 - 30)) * 100}%)`,
            outline: "none",
            cursor: "pointer",
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>放大</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>缩小</span>
        </div>
      </div>
    </div>
  );
}

// --- Single Panorama View ---
function SinglePanoramaView({ imageUrl, fov }: { imageUrl: string; fov: number }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 0.1], fov }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      style={{ width: "100%", height: "100%" }}
    >
      <PanoramaSphere imageUrl={imageUrl} />
      <OrbitControls
        enableZoom={false}
        enablePan={false}
        rotateSpeed={-0.5}
        minDistance={0.1}
        maxDistance={0.1}
      />
    </Canvas>
  );
}

// --- Grid Panorama View ---
function GridPanoramaView({
  imageUrl,
  cols,
  rows,
  fov,
}: {
  imageUrl: string;
  cols: number;
  rows: number;
  fov: number;
}) {
  const total = cols * rows;
  const rotations = useMemo(() => {
    const rots: { azimuth: number; polar: number }[] = [];
    for (let i = 0; i < total; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      rots.push({
        azimuth: ((col / (cols - 1)) - 0.5) * Math.PI * 1.5,
        polar: ((row / (rows - 1)) - 0.5) * Math.PI * 0.8 + Math.PI / 2,
      });
    }
    return rots;
  }, [cols, rows, total]);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gridTemplateRows: `repeat(${rows}, 1fr)`,
      width: "100%",
      height: "100%",
      gap: 2,
    }}>
      {rotations.map((rot, i) => (
        <div key={i} style={{ position: "relative", overflow: "hidden" }}>
          <Canvas
            camera={{ position: [0, 0, 0.1], fov }}
            gl={{ preserveDrawingBuffer: true, antialias: true }}
            style={{ width: "100%", height: "100%" }}
          >
            <PanoramaSphere imageUrl={imageUrl} />
            <FixedOrbitControls azimuth={rot.azimuth} polar={rot.polar} />
          </Canvas>
          <div style={{
            position: "absolute",
            top: 4,
            left: 4,
            fontSize: 10,
            color: "var(--text-primary)",
            background: "var(--glass-bg)",
            padding: "1px 6px",
            borderRadius: 4,
          }}>
            {i + 1}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Fixed Orbit Controls (non-interactive, fixed angle) ---
function FixedOrbitControls({ azimuth, polar }: { azimuth: number; polar: number }) {
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.setAzimuthalAngle(azimuth);
      controlsRef.current.setPolarAngle(polar);
      controlsRef.current.update();
    }
  }, [azimuth, polar]);

  return (
    <OrbitControls
      ref={controlsRef}
      enableZoom={false}
      enablePan={false}
      enableRotate={false}
      minDistance={0.1}
      maxDistance={0.1}
    />
  );
}

// --- Panorama Sphere Component ---
function PanoramaSphere({ imageUrl }: { imageUrl: string }) {
  const displayUrl = resolveImageDisplayUrl(imageUrl);
  const texture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(displayUrl);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [displayUrl]);

  return (
    <mesh scale={[-1, 1, 1]} rotation={[0, Math.PI, 0]}>
      <sphereGeometry args={[50, 64, 32]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} />
    </mesh>
  );
}



