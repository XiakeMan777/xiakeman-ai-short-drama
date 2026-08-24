import { useState, useCallback, useRef, useEffect, Suspense, memo } from "react";
import { createPortal } from "react-dom";
import { Canvas } from "@react-three/fiber";
import { type NodeProps, useUpdateNodeInternals, Handle, Position } from "@xyflow/react";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useToastStore } from "@/features/canvas/compat/Toast";
import { useConfirm } from "@/features/canvas/compat/ConfirmDialog";
import type { Director3DNodeData, Director3DCharacter, Director3DProp } from "../domain/canvasNodes";
import { Scene3D } from "./director3d/Scene3D";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";
import {
  CHARACTER_COLORS,
  POSES,
  GENDERS,
  CAMERA_PRESETS,
  SCENE_TEMPLATES,
  PROP_COLORS,
} from "./director3d/constants";
import {
  PROP_CATEGORIES,
  PROP_PRESETS,
  getPropPreset,
} from "./director3d/PropModels";

const SKY_COLORS = ["#141414", "#0a0a0a", "#1a1a1a", "#1e1e1e", "#172554", "#14532d", "#451a03"];

export const Director3DNode = memo(function Director3DNode({ id, data, selected }: NodeProps & { data: Director3DNodeData }) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const updateNodeInternals = useUpdateNodeInternals();
  const addToast = useToastStore((s) => s.addToast);
  const showConfirm = useConfirm();
  const nodeData = data;

  // --- 3D Canvas snapshot cache: show screenshot when not selected/hovered ---
  const [canvasSnapshot, setCanvasSnapshot] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const canvasActive = selected || isHovered;
  const prevCanvasActive = useRef(canvasActive);

  // When canvas becomes inactive, capture a snapshot before hiding the Canvas
  useEffect(() => {
    if (prevCanvasActive.current && !canvasActive) {
      // Canvas is about to be hidden — capture snapshot from the DOM
      const container = document.getElementById(`director3d-node-${id}`);
      const canvas = container?.querySelector('canvas') as HTMLCanvasElement | null;
      if (canvas) {
        try {
          setCanvasSnapshot(canvas.toDataURL('image/jpeg', 0.7));
        } catch { /* ignore */ }
      }
    }
    prevCanvasActive.current = canvasActive;
    // Clear snapshot when canvas becomes active again to free memory
    if (canvasActive && canvasSnapshot) {
      setCanvasSnapshot(null);
    }
  }, [canvasActive, id]);

  const nodeWidth = nodeData.width || 520;
  const nodeHeight = nodeData.height || 520;
  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );
  const nodeRef = useRef<HTMLDivElement>(null);

  // --- Data migration for old nodes (run once via ref guard) ---
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current) return;
    const hasOldSkyColor = nodeData.skyColor === "#1a1a2e";
    const needsMigration =
      !nodeData.skyColor ||
      hasOldSkyColor ||
      nodeData.characters.some((c: any) => c.gender === undefined);
    if (needsMigration) {
      migratedRef.current = true;
      updateNodeData(id, {
        ...nodeData,
        skyColor: hasOldSkyColor ? "#141414" : (nodeData.skyColor ?? "#141414"),
        groundVisible: nodeData.groundVisible ?? true,
        gridVisible: nodeData.gridVisible ?? true,
        panoramaImage: nodeData.panoramaImage ?? null,
        panoramaUrl: nodeData.panoramaUrl ?? null,
        cameras: nodeData.cameras ?? [],
        characters: nodeData.characters.map((c: any) => ({
          name: c.name ?? `角色${c.id}`,
          gender: c.gender ?? "male",
          scale: c.scale ?? 1,
          ...c,
        })),
        props: Array.isArray(nodeData.props) && nodeData.props.length > 0 && typeof nodeData.props[0] === "object"
          ? (nodeData.props as Director3DProp[]).map((p: any) => ({ scale: 1, ...p }))
          : [],
      });
    } else {
      migratedRef.current = true;
    }
  }, [id, nodeData, updateNodeData]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- State ---
  const [characters, setCharacters] = useState<Director3DCharacter[]>(
    () => nodeData.characters.map((c: any) => ({ name: c.name ?? `角色${c.id}`, gender: c.gender ?? "male", scale: c.scale ?? 1, ...c }))
  );
  const [selectedCharId, setSelectedCharId] = useState<number | null>(null);
  const [props, setProps] = useState<Director3DProp[]>(
    () => {
      const raw = nodeData.props;
      if (!Array.isArray(raw)) return [];
      // Handle migration from string[] to Director3DProp[]
      if (raw.length > 0 && typeof raw[0] === "string") return [];
      return (raw as Director3DProp[]).map((p: any) => ({ scale: 1, ...p }));
    }
  );
  const [selectedPropId, setSelectedPropId] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [skyColor, setSkyColor] = useState(nodeData.skyColor ?? "#141414");
  const [groundVisible, setGroundVisible] = useState(nodeData.groundVisible ?? true);
  const [gridVisible, setGridVisible] = useState(nodeData.gridVisible ?? true);
  const [panoramaImage, setPanoramaImage] = useState<string | null>(nodeData.panoramaImage ?? null);
  const [panoramaUrl, setPanoramaUrl] = useState<string | null>(nodeData.panoramaUrl ?? null);
  const [urlInput, setUrlInput] = useState("");
  const [activeTab, setActiveTab] = useState<"background" | "characters" | "props">(nodeData.activeTab ?? "characters");
  const [showPanoramaInput, setShowPanoramaInput] = useState(false);
  const [transformMode, setTransformMode] = useState<"translate" | "rotate">("translate");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["furniture", "basic"]));
  const [showFullscreenPropPicker, setShowFullscreenPropPicker] = useState(false);
  const nextCharId = useRef(
    Math.max(0, ...nodeData.characters.map((c: any) => c.id ?? 0)) + 1
  );
  const nextPropId = useRef(
    Math.max(0, ...(Array.isArray(nodeData.props) && nodeData.props.length > 0 && typeof nodeData.props[0] === "object"
      ? (nodeData.props as Director3DProp[]).map((p: any) => p.id ?? 0)
      : [0])) + 1
  );

  // Force ReactFlow to re-measure this node when content changes
  useEffect(() => {
    const timer = setTimeout(() => updateNodeInternals(id), 100);
    return () => clearTimeout(timer);
  }, [id, updateNodeInternals, activeTab, characters.length, selectedCharId, props.length, selectedPropId]);

  // --- Persist data ---
  // Use a ref for nodeData so persistData always sees the latest value
  const nodeDataRef = useRef(nodeData);
  nodeDataRef.current = nodeData;
  const persistData = useCallback(
    (updates: Partial<Director3DNodeData>) => {
      updateNodeData(id, { ...nodeDataRef.current, ...updates });
    },
    [id, updateNodeData]
  );

  useEffect(() => {
    persistData({
      characters,
      props,
      skyColor,
      groundVisible,
      gridVisible,
      panoramaImage,
      panoramaUrl,
    });
  }, [characters, props, skyColor, groundVisible, gridVisible, panoramaImage, panoramaUrl]);

  // --- Character actions ---
  const addCharacter = useCallback(() => {
    const colorIdx = characters.length % CHARACTER_COLORS.length;
    const newChar: Director3DCharacter = {
      id: nextCharId.current++,
      name: `角色${nextCharId.current - 1}`,
      color: CHARACTER_COLORS[colorIdx],
      gender: "male",
      pose: "站立",
      x: (Math.random() - 0.5) * 4,
      y: 0,
      z: (Math.random() - 0.5) * 4,
      rotationY: Math.random() * 360,
      scale: 1,
    };
    setCharacters((prev) => [...prev, newChar]);
    setSelectedCharId(newChar.id);
    setSelectedPropId(null); // Deselect prop when selecting character
  }, [characters.length]);

  const removeCharacter = useCallback(
    (charId: number) => {
      setCharacters((prev) => prev.filter((c) => c.id !== charId));
      if (selectedCharId === charId) setSelectedCharId(null);
    },
    [selectedCharId]
  );

  const updateCharacter = useCallback((charId: number, updates: Partial<Director3DCharacter>) => {
    setCharacters((prev) =>
      prev.map((c) => (c.id === charId ? { ...c, ...updates } : c))
    );
  }, []);

  const handleDragEnd = useCallback((charId: number, x: number, y: number, z: number) => {
    setCharacters((prev) =>
      prev.map((c) => (c.id === charId ? { ...c, x, y, z } : c))
    );
  }, []);

  const handleRotateEnd = useCallback((charId: number, rotationY: number) => {
    setCharacters((prev) =>
      prev.map((c) => (c.id === charId ? { ...c, rotationY } : c))
    );
  }, []);

  const clearAllCharacters = useCallback(() => {
    showConfirm({
      title: "清空所有人物",
      message: "确定要清空所有人物吗？",
      variant: "danger",
      confirmLabel: "清空",
      onConfirm: () => {
        setCharacters([]);
        setSelectedCharId(null);
      },
    });
  }, [showConfirm]);

  const applySceneTemplate = useCallback(
    (templateIdx: number) => {
      const tpl = SCENE_TEMPLATES[templateIdx];
      if (!tpl) return;
      const newChars: Director3DCharacter[] = tpl.chars.map((tc, i) => ({
        id: nextCharId.current++,
        name: `角色${nextCharId.current - 1}`,
        color: CHARACTER_COLORS[i % CHARACTER_COLORS.length],
        gender: "male" as const,
        pose: tc.pose,
        x: tc.x,
        y: 0,
        z: tc.z,
        rotationY: tc.rotationY,
        scale: 1,
      }));
      setCharacters(newChars);
      setSelectedCharId(null);
    },
    []
  );

  // --- Prop actions ---
  const addProp = useCallback((type: string) => {
    const preset = getPropPreset(type);
    const newProp: Director3DProp = {
      id: nextPropId.current++,
      name: preset?.label ?? type,
      type,
      x: (Math.random() - 0.5) * 4,
      y: 0,
      z: (Math.random() - 0.5) * 4,
      rotationY: Math.random() * 360,
      scale: 1,
      color: preset?.defaultColor ?? "#6b7280",
      customWidth: preset?.defaultWidth,
      customHeight: preset?.defaultHeight,
      customDepth: preset?.defaultDepth,
    };
    setProps((prev) => [...prev, newProp]);
    setSelectedPropId(newProp.id);
    setSelectedCharId(null); // Deselect character when selecting prop
  }, []);

  const removeProp = useCallback(
    (propId: number) => {
      setProps((prev) => prev.filter((p) => p.id !== propId));
      if (selectedPropId === propId) setSelectedPropId(null);
    },
    [selectedPropId]
  );

  const updateProp = useCallback((propId: number, updates: Partial<Director3DProp>) => {
    setProps((prev) =>
      prev.map((p) => (p.id === propId ? { ...p, ...updates } : p))
    );
  }, []);

  const handlePropDragEnd = useCallback((propId: number, x: number, y: number, z: number) => {
    setProps((prev) =>
      prev.map((p) => (p.id === propId ? { ...p, x, y, z } : p))
    );
  }, []);

  const handlePropRotateEnd = useCallback((propId: number, rotationY: number) => {
    setProps((prev) =>
      prev.map((p) => (p.id === propId ? { ...p, rotationY } : p))
    );
  }, []);

  const clearAllProps = useCallback(() => {
    showConfirm({
      title: "清空所有道具",
      message: "确定要清空所有道具吗？",
      variant: "danger",
      confirmLabel: "清空",
      onConfirm: () => {
        setProps([]);
        setSelectedPropId(null);
      },
    });
  }, [showConfirm]);

  const toggleCategory = useCallback((catKey: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catKey)) {
        next.delete(catKey);
      } else {
        next.add(catKey);
      }
      return next;
    });
  }, []);

  // Selection handlers that ensure mutual exclusivity between character and prop
  const handleSelectCharacter = useCallback((charId: number | null) => {
    setSelectedCharId(charId);
    if (charId !== null) setSelectedPropId(null);
  }, []);

  const handleSelectProp = useCallback((propId: number | null) => {
    setSelectedPropId(propId);
    if (propId !== null) setSelectedCharId(null);
  }, []);

  // --- Export current view as a node on the canvas ---
  const exportViewAsNode = useCallback(async () => {
    const canvasEl = document.querySelector(
      isFullscreen ? "#director3d-fullscreen canvas" : `#director3d-node-${id} canvas`
    ) as HTMLCanvasElement;
    if (!canvasEl) return;

    const dataUrl = canvasEl.toDataURL("image/png");

    try {
      // Persist image via Tauri backend
      const { prepareNodeImageSource } = await import("@/features/canvas/compat/commands");
      const result = (await prepareNodeImageSource(dataUrl)) as {
        path: string;
        previewPath: string;
        width: number;
        height: number;
      };

      if (!result) return;

      // Find current node position
      const nodes = useCanvasStore.getState().nodes;
      const currentNode = nodes.find((n) => n.id === id);
      if (!currentNode) return;

      // Create upload node with the screenshot
      const newNodeId = `upload-${crypto.randomUUID()}`;
      const newNode = {
        id: newNodeId,
        type: "uploadNode" as const,
        position: {
          x: currentNode.position.x + 720,
          y: currentNode.position.y + 40,
        },
        data: {
          displayName: "3D视角导出",
          imageUrl: result.path,
          previewImageUrl: result.previewPath,
          aspectRatio: `${result.width}:${result.height}`,
          isSizeManuallyAdjusted: false,
          sourceFileName: `director3d_view_${Date.now()}.png`,
          imageWidth: result.width,
          imageHeight: result.height,
        },
      };

      const newEdge = {
        id: `edge-${id}-${newNodeId}-${crypto.randomUUID()}`,
        source: id,
        target: newNodeId,
        type: "dataFlow" as const,
      };

      useCanvasStore.setState((state) => ({
        nodes: [...state.nodes, newNode],
        edges: [...state.edges, newEdge],
        isDirty: true,
      }));

      addToast("success", "视角已导出到画布");
    } catch (e) {
      console.error("Export view failed:", e);
      // Fallback: download as file
      const link = document.createElement("a");
      link.download = `director3d_view_${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    }
  }, [id, isFullscreen]);

  // --- Panorama URL load ---
  const loadPanoramaFromUrl = useCallback(() => {
    if (!urlInput.trim()) return;
    setPanoramaImage(urlInput.trim());
    setPanoramaUrl(urlInput.trim());
    setUrlInput("");
    setShowPanoramaInput(false);
  }, [urlInput]);

  // --- Keyboard shortcuts (fullscreen only) ---
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKey = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === "Escape") setIsFullscreen(false);
      if (e.key === "Delete") {
        if (selectedCharId !== null) removeCharacter(selectedCharId);
        if (selectedPropId !== null) removeProp(selectedPropId);
      }
      if (e.key === "c" && !e.ctrlKey && !e.metaKey) exportViewAsNode();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isFullscreen, selectedCharId, selectedPropId, removeCharacter, removeProp, exportViewAsNode]);

  const selectedChar = characters.find((c) => c.id === selectedCharId);
  const selectedProp = props.find((p) => p.id === selectedPropId);

  // Whether any entity is selected (for transform controls visibility)
  const hasSelection = selectedCharId !== null || selectedPropId !== null;

  // --- 3D Scene renderer ---
  const render3DScene = (interactive: boolean) => (
    <Suspense fallback={null}>
      <Scene3D
        characters={characters}
        selectedCharacterId={selectedCharId}
        onSelectCharacter={handleSelectCharacter}
        onCharacterDragEnd={handleDragEnd}
        onCharacterRotateEnd={handleRotateEnd}
        panoramaImage={panoramaImage}
        skyColor={skyColor}
        groundVisible={groundVisible}
        gridVisible={gridVisible}
        interactive={interactive}
        transformMode={transformMode}
        props={props}
        selectedPropId={selectedPropId}
        onSelectProp={handleSelectProp}
        onPropDragEnd={handlePropDragEnd}
        onPropRotateEnd={handlePropRotateEnd}
      />
    </Suspense>
  );

  // ==============================
  // NORMAL MODE (Node Card)
  // ==============================
  const normalModeContent = (
    <div style={{ position: 'relative' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
    <div
      ref={nodeRef}
      id={`director3d-node-${id}`}
      className="node-inner"
      style={{
        width: nodeWidth,
        height: nodeHeight,
        background: "var(--bg-node)",
        borderRadius: 'var(--node-radius)',
        boxSizing: "border-box",
        border: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        boxShadow: "var(--shadow-card)",
        /* overflow controlled by CSS: hidden by default, visible when popup is open */
      }}
    >

      {/* Header bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
          <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>3D导演台</span>
          <div style={{ display: "flex", gap: 4 }}>
            <TabButton active={activeTab === "background"} onClick={() => setActiveTab("background")} icon="●" label="背景" />
            <TabButton active={activeTab === "characters"} onClick={() => setActiveTab("characters")} icon="🧍" label={`人物${characters.length}`} />
            <TabButton active={activeTab === "props"} onClick={() => setActiveTab("props")} icon="📦" label={`道具${props.length}`} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {panoramaImage && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>已设背景</span>}
          <button
            onClick={exportViewAsNode}
            className="nodrag"
            style={{
              fontSize: 11,
              padding: "3px 10px",
              borderRadius: 5,
              border: "1px solid var(--border)",
              background: "var(--bg-hover)",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >导出</button>
          <button
            onClick={() => setIsFullscreen(true)}
            className="nodrag"
            style={{
              fontSize: 11,
              padding: "3px 10px",
              borderRadius: 5,
              border: "none",
              background: "var(--accent-btn)",
              color: "#fff",
              cursor: "pointer",
            }}
          >全屏</button>
        </div>
      </div>

      {/* 3D Viewport — shrinkable, min height to keep controls usable */}
      <div
        style={{ flex: "1 1 0", minHeight: 180, position: "relative", width: "100%", background: skyColor }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {canvasActive || !canvasSnapshot ? (
          <Canvas
            camera={{ position: [5, 4, 5], fov: 50, near: 0.1, far: 100 }}
            gl={{ preserveDrawingBuffer: true, antialias: true, alpha: false }}
            resize={{ offsetSize: true }}
            style={{ width: "100%", height: "100%" }}
          >
            {render3DScene(true)}
          </Canvas>
        ) : (
          canvasSnapshot && (
            <img
              src={canvasSnapshot}
              alt="3D scene"
              loading="lazy"
              decoding="async"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          )
        )}

        {/* Controls hint overlay */}
        <div style={{
          position: "absolute",
          bottom: 6,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 6,
          padding: "3px 10px",
          borderRadius: 5,
          background: "var(--glass-bg)",
          fontSize: 10,
          color: "var(--text-muted)",
          pointerEvents: "none",
        }}>
          <span>拖拽旋转</span><span>·</span><span>滚轮缩放</span><span>·</span><span>右键平移</span>
        </div>

        {hasSelection && canvasActive && (
          <div style={{
            position: "absolute",
            top: 6,
            right: 6,
            display: "flex",
            gap: 3,
            padding: "2px 3px",
            borderRadius: 5,
            background: "var(--glass-bg)",
            fontSize: 10,
          }}>
            <button onClick={() => setTransformMode("translate")} className="nodrag" style={{ padding: "2px 6px", borderRadius: 3, border: "none", background: transformMode === "translate" ? "var(--accent-btn)" : "transparent", color: transformMode === "translate" ? "#fff" : "var(--text-muted)", cursor: "pointer", fontSize: 10 }}>⬌ 移动</button>
            <button onClick={() => setTransformMode("rotate")} className="nodrag" style={{ padding: "2px 6px", borderRadius: 3, border: "none", background: transformMode === "rotate" ? "var(--accent-btn)" : "transparent", color: transformMode === "rotate" ? "#fff" : "var(--text-muted)", cursor: "pointer", fontSize: 10 }}>↻ 旋转</button>
          </div>
        )}
      </div>

      {/* Scrollable tab panel — fills remaining space */}
      <div style={{
        flex: "0 1 auto",
        overflowY: "auto",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-secondary)",
        maxHeight: "50%",
      }}>
        {/* Character tab */}
        {activeTab === "characters" && (
          <div style={{ padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>人物</span>
              {characters.length > 0 && (
                <button onClick={clearAllCharacters} className="nodrag" style={{ fontSize: 10, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>清空</button>
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {characters.map((char) => (
                <div key={char.id} onClick={() => handleSelectCharacter(char.id === selectedCharId ? null : char.id)}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6,
                    background: selectedCharId === char.id ? "var(--accent-muted)" : "var(--bg-hover)",
                    border: selectedCharId === char.id ? "1px solid var(--border-hover)" : "1px solid var(--border)",
                    cursor: "pointer", fontSize: 11, color: "var(--text-primary)" }}>
                  <div style={{ width: 12, height: 12, borderRadius: "50%", background: char.color, flexShrink: 0 }} />
                  <span>#{char.id}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 10 }}>{char.pose}</span>
                  <button onClick={(e) => { e.stopPropagation(); removeCharacter(char.id); }} className="nodrag"
                    style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 10, padding: 0 }}>✕</button>
                </div>
              ))}
              <button onClick={addCharacter} className="nodrag" style={{ display: "flex", alignItems: "center", gap: 3, padding: "4px 10px",
                borderRadius: 6, background: "var(--bg-hover)", border: "1px dashed var(--border)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11 }}>
                + 添加
              </button>
            </div>
            {selectedChar && (
              <div style={{ padding: 8, borderRadius: 6, background: "var(--bg-hover)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", width: 36, flexShrink: 0 }}>颜色</span>
                  <div style={{ display: "flex", gap: 3 }}>
                    {CHARACTER_COLORS.map((c) => (
                      <button key={c} onClick={() => updateCharacter(selectedChar.id, { color: c })}
                        style={{ width: 18, height: 18, borderRadius: 3, background: c, border: selectedChar.color === c ? "2px solid #fff" : "1px solid var(--border)", cursor: "pointer" }} />
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", width: 36, flexShrink: 0 }}>体型</span>
                  <div style={{ display: "flex", gap: 3 }}>
                    {GENDERS.map((g) => (
                      <button key={g.value} onClick={() => updateCharacter(selectedChar.id, { gender: g.value })}
                        style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, cursor: "pointer",
                          background: selectedChar.gender === g.value ? "var(--accent-btn)" : "var(--bg-hover)",
                          border: "1px solid var(--border)", color: selectedChar.gender === g.value ? "#fff" : "var(--text-secondary)" }}>
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", width: 36, flexShrink: 0 }}>姿势</span>
                  <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                    {POSES.map((p) => (
                      <button key={p} onClick={() => updateCharacter(selectedChar.id, { pose: p })}
                        style={{ fontSize: 9, padding: "2px 5px", borderRadius: 3, cursor: "pointer",
                          background: selectedChar.pose === p ? "var(--accent-btn)" : "var(--bg-hover)",
                          border: "1px solid var(--border)", color: selectedChar.pose === p ? "#fff" : "var(--text-secondary)" }}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", width: 36, flexShrink: 0 }}>朝向</span>
                  <input type="range" min={0} max={360} value={selectedChar.rotationY}
                    onChange={(e) => updateCharacter(selectedChar.id, { rotationY: Number(e.target.value) })} style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: "var(--text-muted)", width: 32, textAlign: "right" }}>{selectedChar.rotationY}°</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", width: 36, flexShrink: 0 }}>缩放</span>
                  <input type="range" min={0.3} max={3} step={0.05} value={selectedChar.scale ?? 1}
                    onChange={(e) => updateCharacter(selectedChar.id, { scale: Number(e.target.value) })} style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: "var(--text-muted)", width: 32, textAlign: "right" }}>{(selectedChar.scale ?? 1).toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
        )}

      {/* Background tab content */}
      {activeTab === "background" && (
        <div style={{ padding: "10px 12px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>场景设置</div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>360° 全景图</div>
            {panoramaImage ? (
              <div style={{ position: "relative", borderRadius: 6, overflow: "hidden" }}>
                <img src={panoramaImage} loading="lazy" decoding="async" style={{ width: "100%", height: 80, objectFit: "cover", opacity: 0.7 }} />
                <button onClick={() => { setPanoramaImage(null); setPanoramaUrl(null); }} className="nodrag"
                  style={{ position: "absolute", top: 3, right: 3, background: "var(--glass-bg)", border: "none", color: "var(--text-primary)", borderRadius: 3, padding: "1px 5px", fontSize: 9, cursor: "pointer" }}>✕</button>
              </div>
            ) : (
              <div style={{ border: "1px dashed var(--border)", borderRadius: 6, padding: "12px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 18, marginBottom: 2 }}>🌐</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>拖入或上传全景图</div>
                <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                  <button onClick={() => setShowPanoramaInput(!showPanoramaInput)} className="nodrag" style={{ fontSize: 10, padding: "3px 10px", borderRadius: 4, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer" }}>选择</button>
                  <button onClick={() => setShowPanoramaInput(true)} className="nodrag" style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}>URL</button>
                </div>
              </div>
            )}
            {showPanoramaInput && (
              <div style={{ marginTop: 6, display: "flex", gap: 4 }}>
                <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadPanoramaFromUrl()}
                  placeholder="粘贴图片直链（回车加载）"
                  style={{ flex: 1, fontSize: 10, padding: "3px 6px", borderRadius: 3, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }} />
                <button onClick={loadPanoramaFromUrl} className="nodrag" style={{ fontSize: 10, padding: "3px 8px", borderRadius: 3, background: "var(--accent-btn)", border: "none", color: "#fff", cursor: "pointer" }}>使用</button>
              </div>
            )}
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>天空颜色</div>
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {SKY_COLORS.map((c) => (
                <button key={c} onClick={() => setSkyColor(c)}
                  style={{ width: 24, height: 24, borderRadius: 4, background: c, border: skyColor === c ? "2px solid var(--warning)" : "1px solid var(--border)", cursor: "pointer" }} />
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}>
              <input type="checkbox" checked={groundVisible} onChange={(e) => setGroundVisible(e.target.checked)} /> 地面
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}>
              <input type="checkbox" checked={gridVisible} onChange={(e) => setGridVisible(e.target.checked)} /> 网格
            </label>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>场景模板</div>
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {SCENE_TEMPLATES.map((tpl, i) => (
                <button key={i} onClick={() => applySceneTemplate(i)}
                  style={{ fontSize: 10, padding: "3px 8px", borderRadius: 3, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer" }}>
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Props tab content */}
      {activeTab === "props" && (
        <div style={{ padding: "10px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>道具</span>
            {props.length > 0 && (
              <button onClick={clearAllProps} className="nodrag" style={{ fontSize: 10, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>清空</button>
            )}
          </div>
          {PROP_CATEGORIES.map((cat) => {
            const categoryPresets = PROP_PRESETS.filter((p) => p.category === cat.key);
            if (categoryPresets.length === 0) return null;
            const isExpanded = expandedCategories.has(cat.key);
            return (
              <div key={cat.key} style={{ marginBottom: 4 }}>
                <button onClick={() => toggleCategory(cat.key)} className="nodrag"
                  style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600, color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer", padding: "1px 0", width: "100%", textAlign: "left" }}>
                  <span style={{ fontSize: 8 }}>{isExpanded ? "▼" : "▶"}</span>{cat.label}
                </button>
                {isExpanded && (
                  <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 3, marginBottom: 3 }}>
                    {categoryPresets.map((preset) => (
                      <button key={preset.key} onClick={() => addProp(preset.key)} className="nodrag"
                        style={{ fontSize: 10, padding: "3px 6px", borderRadius: 3, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", gap: 2 }}>
                        <span>{preset.icon}</span>{preset.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {props.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>已添加</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {props.map((prop) => {
                  const preset = getPropPreset(prop.type);
                  return (
                    <div key={prop.id} onClick={() => handleSelectProp(prop.id === selectedPropId ? null : prop.id)}
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 7px", borderRadius: 5,
                        background: selectedPropId === prop.id ? "var(--accent-muted)" : "var(--bg-hover)",
                        border: selectedPropId === prop.id ? "1px solid var(--border-hover)" : "1px solid var(--border)",
                        cursor: "pointer", fontSize: 10, color: "var(--text-primary)" }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: prop.color, flexShrink: 0 }} />
                      <span>{preset?.icon ?? "📦"}</span>
                      <span>{prop.name}</span>
                      <button onClick={(e) => { e.stopPropagation(); removeProp(prop.id); }} className="nodrag"
                        style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 10, padding: 0 }}>✕</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {selectedProp && (
            <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: "var(--bg-hover)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)" }}>道具属性</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)", width: 36, flexShrink: 0 }}>颜色</span>
                <div style={{ display: "flex", gap: 3 }}>
                  {PROP_COLORS.map((c) => (
                    <button key={c} onClick={() => updateProp(selectedProp.id, { color: c })}
                      style={{ width: 18, height: 18, borderRadius: 3, background: c, border: selectedProp.color === c ? "2px solid #fff" : "1px solid var(--border)", cursor: "pointer" }} />
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)", width: 36, flexShrink: 0 }}>朝向</span>
                <input type="range" min={0} max={360} value={selectedProp.rotationY}
                  onChange={(e) => updateProp(selectedProp.id, { rotationY: Number(e.target.value) })} style={{ flex: 1 }} />
                <span style={{ fontSize: 10, color: "var(--text-muted)", width: 32, textAlign: "right" }}>{selectedProp.rotationY}°</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)", width: 36, flexShrink: 0 }}>缩放</span>
                <input type="range" min={0.1} max={5} step={0.05} value={selectedProp.scale ?? 1}
                  onChange={(e) => updateProp(selectedProp.id, { scale: Number(e.target.value) })} style={{ flex: 1 }} />
                <span style={{ fontSize: 10, color: "var(--text-muted)", width: 32, textAlign: "right" }}>{(selectedProp.scale ?? 1).toFixed(2)}</span>
              </div>
              {["box", "cylinder", "sphere", "plane"].includes(selectedProp.type) && (
                <>
                  <div style={{ fontSize: 9, color: "var(--text-muted)" }}>自定义尺寸</div>
                  {selectedProp.type !== "sphere" && selectedProp.type !== "cylinder" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10, color: "var(--text-muted)", width: 36, flexShrink: 0 }}>宽度</span>
                      <input type="range" min={0.1} max={10} step={0.05} value={selectedProp.customWidth ?? 1}
                        onChange={(e) => updateProp(selectedProp.id, { customWidth: Number(e.target.value) })} style={{ flex: 1 }} />
                      <span style={{ fontSize: 10, color: "var(--text-muted)", width: 32, textAlign: "right" }}>{(selectedProp.customWidth ?? 1).toFixed(2)}</span>
                    </div>
                  )}
                  {(selectedProp.type === "cylinder" || selectedProp.type === "sphere") && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10, color: "var(--text-muted)", width: 36, flexShrink: 0 }}>半径</span>
                      <input type="range" min={0.05} max={5} step={0.05} value={selectedProp.customWidth ?? 0.5}
                        onChange={(e) => updateProp(selectedProp.id, { customWidth: Number(e.target.value) })} style={{ flex: 1 }} />
                      <span style={{ fontSize: 10, color: "var(--text-muted)", width: 32, textAlign: "right" }}>{(selectedProp.customWidth ?? 0.5).toFixed(2)}</span>
                    </div>
                  )}
                  {selectedProp.type !== "sphere" && selectedProp.type !== "plane" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10, color: "var(--text-muted)", width: 36, flexShrink: 0 }}>高度</span>
                      <input type="range" min={0.1} max={10} step={0.05} value={selectedProp.customHeight ?? 1}
                        onChange={(e) => updateProp(selectedProp.id, { customHeight: Number(e.target.value) })} style={{ flex: 1 }} />
                      <span style={{ fontSize: 10, color: "var(--text-muted)", width: 32, textAlign: "right" }}>{(selectedProp.customHeight ?? 1).toFixed(2)}</span>
                    </div>
                  )}
                  {selectedProp.type !== "cylinder" && selectedProp.type !== "sphere" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10, color: "var(--text-muted)", width: 36, flexShrink: 0 }}>深度</span>
                      <input type="range" min={0.1} max={10} step={0.05} value={selectedProp.customDepth ?? 1}
                        onChange={(e) => updateProp(selectedProp.id, { customDepth: Number(e.target.value) })} style={{ flex: 1 }} />
                      <span style={{ fontSize: 10, color: "var(--text-muted)", width: 32, textAlign: "right" }}>{(selectedProp.customDepth ?? 1).toFixed(2)}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
    <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize} minWidth={520} maxWidth={900} minHeight={520} maxHeight={1400} />
    </div>
  );

  // ==============================
  // FULLSCREEN MODE (Portal to body)
  // ==============================

  /** Renders the props tab content for sidebar (reused in both fullscreen sidebars) */
  const renderPropsTabContent = () => {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Preset categories (collapsible) */}
        {PROP_CATEGORIES.map((cat) => {
          const categoryPresets = PROP_PRESETS.filter((p) => p.category === cat.key);
          if (categoryPresets.length === 0) return null;
          const isExpanded = expandedCategories.has(cat.key);
          return (
            <div key={cat.key}>
              <button
                onClick={() => toggleCategory(cat.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 0",
                  width: "100%",
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: 9 }}>{isExpanded ? "▼" : "▶"}</span>
                {cat.label}
              </button>
              {isExpanded && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4, marginBottom: 4 }}>
                  {categoryPresets.map((preset) => (
                    <button
                      key={preset.key}
                      onClick={() => addProp(preset.key)}
                      style={{
                        fontSize: 11,
                        padding: "3px 8px",
                        borderRadius: 4,
                        background: "var(--bg-hover)",
                        border: "1px solid var(--border)",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                      }}
                    >
                      <span>{preset.icon}</span> {preset.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Added props */}
        {props.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 4 }}>已添加道具</div>
            {props.map((prop) => {
              const preset = getPropPreset(prop.type);
              return (
                <div
                  key={prop.id}
                  onClick={() => handleSelectProp(prop.id)}
                  style={{
                    padding: 6, borderRadius: 6, cursor: "pointer",
                    background: selectedPropId === prop.id ? "var(--accent-muted)" : "var(--bg-hover)",
                    border: selectedPropId === prop.id ? "1px solid var(--border-hover)" : "1px solid transparent",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 14, height: 14, borderRadius: 3, background: prop.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: "var(--text-primary)", flex: 1 }}>
                      {preset?.icon ?? "📦"} {prop.name}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeProp(prop.id); }}
                      style={{ background: "none", border: "none", color: "var(--error)", cursor: "pointer", fontSize: 12 }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* Selected prop properties */}
        {selectedProp && (
          <div style={{ marginTop: 4, padding: 10, borderRadius: 6, background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>道具属性</div>

            {/* Color */}
            <div style={{ marginBottom: 6 }}>
              <label style={{ fontSize: 10, color: "var(--text-secondary)" }}>颜色</label>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                {PROP_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => updateProp(selectedProp.id, { color: c })}
                    style={{
                      width: 20, height: 20, borderRadius: 3, background: c,
                      border: selectedProp.color === c ? "2px solid #fff" : "1px solid var(--border)",
                      cursor: "pointer",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Rotation */}
            <div style={{ marginBottom: 6 }}>
              <label style={{ fontSize: 10, color: "var(--text-secondary)" }}>朝向: {selectedProp.rotationY}°</label>
              <input
                type="range" min={0} max={360} value={selectedProp.rotationY}
                onChange={(e) => updateProp(selectedProp.id, { rotationY: Number(e.target.value) })}
                style={{ width: "100%" }}
              />
            </div>

            {/* Scale */}
            <div style={{ marginBottom: 6 }}>
              <label style={{ fontSize: 10, color: "var(--text-secondary)" }}>缩放: {(selectedProp.scale ?? 1).toFixed(2)}</label>
              <input
                type="range" min={0.1} max={5} step={0.05} value={selectedProp.scale ?? 1}
                onChange={(e) => updateProp(selectedProp.id, { scale: Number(e.target.value) })}
                style={{ width: "100%" }}
              />
            </div>

            {/* Custom dimensions for basic shapes */}
            {["box", "cylinder", "sphere", "plane"].includes(selectedProp.type) && (
              <>
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>自定义尺寸</div>
                {(selectedProp.type === "box" || selectedProp.type === "plane") && (
                  <div style={{ marginBottom: 4 }}>
                    <label style={{ fontSize: 10, color: "var(--text-secondary)" }}>宽度: {(selectedProp.customWidth ?? 1).toFixed(2)}</label>
                    <input
                      type="range" min={0.1} max={10} step={0.05} value={selectedProp.customWidth ?? 1}
                      onChange={(e) => updateProp(selectedProp.id, { customWidth: Number(e.target.value) })}
                      style={{ width: "100%" }}
                    />
                  </div>
                )}
                {(selectedProp.type === "cylinder" || selectedProp.type === "sphere") && (
                  <div style={{ marginBottom: 4 }}>
                    <label style={{ fontSize: 10, color: "var(--text-secondary)" }}>半径: {(selectedProp.customWidth ?? 0.5).toFixed(2)}</label>
                    <input
                      type="range" min={0.05} max={5} step={0.05} value={selectedProp.customWidth ?? 0.5}
                      onChange={(e) => updateProp(selectedProp.id, { customWidth: Number(e.target.value) })}
                      style={{ width: "100%" }}
                    />
                  </div>
                )}
                {selectedProp.type !== "sphere" && selectedProp.type !== "plane" && (
                  <div style={{ marginBottom: 4 }}>
                    <label style={{ fontSize: 10, color: "var(--text-secondary)" }}>高度: {(selectedProp.customHeight ?? 1).toFixed(2)}</label>
                    <input
                      type="range" min={0.1} max={10} step={0.05} value={selectedProp.customHeight ?? 1}
                      onChange={(e) => updateProp(selectedProp.id, { customHeight: Number(e.target.value) })}
                      style={{ width: "100%" }}
                    />
                  </div>
                )}
                {(selectedProp.type === "box" || selectedProp.type === "plane") && (
                  <div>
                    <label style={{ fontSize: 10, color: "var(--text-secondary)" }}>深度: {(selectedProp.customDepth ?? 1).toFixed(2)}</label>
                    <input
                      type="range" min={0.1} max={10} step={0.05} value={selectedProp.customDepth ?? 1}
                      onChange={(e) => updateProp(selectedProp.id, { customDepth: Number(e.target.value) })}
                      style={{ width: "100%" }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const fullscreenContent = (
    <div
      id="director3d-fullscreen"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 999,
        display: "flex",
        background: "var(--bg-primary)",
      }}
    >
      {/* LEFT SIDEBAR */}
      <div style={{ width: 280, background: "var(--bg-secondary)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
          <button
            onClick={() => setActiveTab("background")}
            style={activeTab === "background" ? leftTabActive : leftTabNormal}
          >
            🌄 场景
          </button>
          <button
            onClick={() => setActiveTab("characters")}
            style={activeTab === "characters" ? leftTabActive : leftTabNormal}
          >
            🧍 人物 ({characters.length})
          </button>
          <button
            onClick={() => setActiveTab("props")}
            style={activeTab === "props" ? leftTabActive : leftTabNormal}
          >
            📦 道具 ({props.length})
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
          {activeTab === "background" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Panorama Section */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>360° 全景图</div>
                {panoramaImage ? (
                  <div style={{ position: "relative", borderRadius: 6, overflow: "hidden" }}>
                    <img src={panoramaImage} loading="lazy" decoding="async" style={{ width: "100%", height: 80, objectFit: "cover", opacity: 0.7 }} />
                    <button
                      onClick={() => { setPanoramaImage(null); setPanoramaUrl(null); }}
                      style={{ position: "absolute", top: 4, right: 4, background: "var(--glass-bg)", border: "none", color: "var(--text-primary)", borderRadius: 4, padding: "2px 6px", fontSize: 10, cursor: "pointer" }}
                    >
                      ✕
                    </button>
                    <div style={{ position: "absolute", bottom: 4, left: 4, fontSize: 10, color: "var(--text-muted)" }}>已加载全景</div>
                  </div>
                ) : (
                  <div style={{ border: "1px dashed var(--border)", borderRadius: 6, padding: "20px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 24, marginBottom: 4 }}>🌐</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>拖入或上传一张全景图</div>
                    <button
                      onClick={() => setShowPanoramaInput(!showPanoramaInput)}
                      style={{ fontSize: 11, padding: "4px 12px", borderRadius: 4, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}
                    >
                      选择全景图
                    </button>
                    <button
                      onClick={() => setShowPanoramaInput(true)}
                      style={{ fontSize: 11, padding: "4px 8px", borderRadius: 4, background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", marginLeft: 4 }}
                    >
                      URL
                    </button>
                  </div>
                )}
                {showPanoramaInput && (
                  <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
                    <input
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && loadPanoramaFromUrl()}
                      placeholder="粘贴图片直链（回车加载）"
                      style={{ flex: 1, fontSize: 11, padding: "4px 8px", borderRadius: 4, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
                    />
                    <button
                      onClick={loadPanoramaFromUrl}
                      style={{ fontSize: 11, padding: "4px 8px", borderRadius: 4, background: "var(--accent-btn)", border: "none", color: "#fff", cursor: "pointer" }}
                    >
                      使用
                    </button>
                  </div>
                )}
              </div>

              {/* Sky color */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>天空颜色</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {SKY_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setSkyColor(c)}
                      style={{
                        width: 24, height: 24, borderRadius: 4, background: c,
                        border: skyColor === c ? "2px solid var(--warning)" : "1px solid var(--border)",
                        cursor: "pointer",
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Toggles */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>
                  <input type="checkbox" checked={groundVisible} onChange={(e) => setGroundVisible(e.target.checked)} />
                  显示地面
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>
                  <input type="checkbox" checked={gridVisible} onChange={(e) => setGridVisible(e.target.checked)} />
                  显示网格
                </label>
              </div>

              {/* Scene templates */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>场景模板</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {SCENE_TEMPLATES.map((tpl, i) => (
                    <button
                      key={i}
                      onClick={() => applySceneTemplate(i)}
                      style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : activeTab === "characters" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Add character button */}
              <button
                onClick={addCharacter}
                style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, background: "var(--accent-btn)", border: "none", color: "#fff", cursor: "pointer", width: "100%" }}
              >
                + 添加人物
              </button>

              {/* Character list */}
              {characters.map((char) => (
                <div
                  key={char.id}
                  onClick={() => handleSelectCharacter(char.id)}
                  style={{
                    padding: 8, borderRadius: 6, cursor: "pointer",
                    background: selectedCharId === char.id ? "var(--accent-muted)" : "var(--bg-hover)",
                    border: selectedCharId === char.id ? "1px solid var(--border-hover)" : "1px solid transparent",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 16, height: 16, borderRadius: 3, background: char.color }} />
                    <span style={{ fontSize: 12, color: "var(--text-primary)", flex: 1 }}>
                      {char.name || `角色${char.id}`}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{char.pose}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeCharacter(char.id); }}
                      style={{ background: "none", border: "none", color: "var(--error)", cursor: "pointer", fontSize: 12 }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}

              {/* Selected character properties */}
              {selectedChar && (
                <div style={{ marginTop: 8, padding: 10, borderRadius: 6, background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>属性编辑</div>

                  {/* Name */}
                  <div style={{ marginBottom: 6 }}>
                    <label style={{ fontSize: 10, color: "var(--text-secondary)" }}>名称</label>
                    <input
                      value={selectedChar.name}
                      onChange={(e) => updateCharacter(selectedChar.id, { name: e.target.value })}
                      style={propInputStyle}
                    />
                  </div>

                  {/* Color */}
                  <div style={{ marginBottom: 6 }}>
                    <label style={{ fontSize: 10, color: "var(--text-secondary)" }}>颜色</label>
                    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                      {CHARACTER_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => updateCharacter(selectedChar.id, { color: c })}
                          style={{
                            width: 20, height: 20, borderRadius: 3, background: c,
                            border: selectedChar.color === c ? "2px solid #fff" : "1px solid var(--border)",
                            cursor: "pointer",
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Gender */}
                  <div style={{ marginBottom: 6 }}>
                    <label style={{ fontSize: 10, color: "var(--text-secondary)" }}>性别/体型</label>
                    <div style={{ display: "flex", gap: 4 }}>
                      {GENDERS.map((g) => (
                        <button
                          key={g.value}
                          onClick={() => updateCharacter(selectedChar.id, { gender: g.value })}
                          style={{
                            fontSize: 11, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                            background: selectedChar.gender === g.value ? "var(--accent-btn)" : "var(--bg-hover)",
                            border: "1px solid var(--border)",
                            color: selectedChar.gender === g.value ? "#fff" : "var(--text-muted)",
                          }}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Pose */}
                  <div style={{ marginBottom: 6 }}>
                    <label style={{ fontSize: 10, color: "var(--text-secondary)" }}>姿势</label>
                    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                      {POSES.map((p) => (
                        <button
                          key={p}
                          onClick={() => updateCharacter(selectedChar.id, { pose: p })}
                          style={{
                            fontSize: 10, padding: "2px 6px", borderRadius: 3, cursor: "pointer",
                            background: selectedChar.pose === p ? "var(--accent-btn)" : "var(--bg-hover)",
                            border: "1px solid var(--border)",
                            color: selectedChar.pose === p ? "#fff" : "var(--text-muted)",
                          }}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Rotation */}
                  <div style={{ marginBottom: 6 }}>
                    <label style={{ fontSize: 10, color: "var(--text-secondary)" }}>朝向: {selectedChar.rotationY}°</label>
                    <input
                      type="range" min={0} max={360} value={selectedChar.rotationY}
                      onChange={(e) => updateCharacter(selectedChar.id, { rotationY: Number(e.target.value) })}
                      style={{ width: "100%" }}
                    />
                  </div>

                  {/* Scale */}
                  <div>
                    <label style={{ fontSize: 10, color: "var(--text-secondary)" }}>缩放: {selectedChar.scale?.toFixed(2) ?? "1.00"}</label>
                    <input
                      type="range" min={0.3} max={3} step={0.05} value={selectedChar.scale ?? 1}
                      onChange={(e) => updateCharacter(selectedChar.id, { scale: Number(e.target.value) })}
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Props tab in fullscreen */
            renderPropsTabContent()
          )}
        </div>
      </div>

      {/* CENTER: 3D VIEWPORT */}
      <div style={{ flex: 1, position: "relative", background: skyColor }}>
        <Canvas
          camera={{ position: [5, 4, 5], fov: 50, near: 0.1, far: 100 }}
          gl={{ preserveDrawingBuffer: true, antialias: true, alpha: false }}
          resize={{ offsetSize: true }}
          style={{ width: "100%", height: "100%" }}
        >
          {render3DScene(true)}
        </Canvas>

        {/* Floating toolbar */}
        <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 4, padding: "4px 8px", borderRadius: 8, background: "var(--glass-bg)", backdropFilter: "blur(var(--glass-blur))", border: "1px solid var(--glass-border)" }}>
          <button onClick={addCharacter} style={floatBtnStyle} title="添加人物">🧍+</button>
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowFullscreenPropPicker((v) => !v)} style={floatBtnStyle} title="添加道具">📦+</button>
            {showFullscreenPropPicker && (
              <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: 6, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 8, minWidth: 200, maxHeight: 300, overflowY: "auto", zIndex: 100 }}>
                {PROP_CATEGORIES.map((cat) => {
                  const categoryPresets = PROP_PRESETS.filter((p) => p.category === cat.key);
                  if (categoryPresets.length === 0) return null;
                  return (
                    <div key={cat.key} style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 3 }}>{cat.label}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                        {categoryPresets.map((preset) => (
                          <button
                            key={preset.key}
                            onClick={() => { addProp(preset.key); setShowFullscreenPropPicker(false); }}
                            style={{ fontSize: 10, padding: "2px 6px", background: "var(--secondary)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", cursor: "pointer" }}
                            title={preset.label}
                          >
                            {preset.icon} {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <button onClick={exportViewAsNode} style={floatBtnStyle} title="截图 (C)">📷</button>
          <div style={{ width: 1, background: "var(--border)", margin: "2px 4px" }} />
          <button onClick={() => setGridVisible(!gridVisible)} style={{ ...floatBtnStyle, opacity: gridVisible ? 1 : 0.5 }} title="网格">▦</button>
          <button onClick={() => setGroundVisible(!groundVisible)} style={{ ...floatBtnStyle, opacity: groundVisible ? 1 : 0.5 }} title="地面">▬</button>
          {hasSelection && (
            <>
              <div style={{ width: 1, background: "var(--border)", margin: "2px 4px" }} />
              <button
                onClick={() => setTransformMode("translate")}
                style={{ ...floatBtnStyle, opacity: transformMode === "translate" ? 1 : 0.5 }}
                title="平移模式"
              >
                ⬌
              </button>
              <button
                onClick={() => setTransformMode("rotate")}
                style={{ ...floatBtnStyle, opacity: transformMode === "rotate" ? 1 : 0.5 }}
                title="旋转模式"
              >
                ↻
              </button>
            </>
          )}
        </div>

        {/* Info bar */}
        <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", fontSize: 10, color: "var(--text-muted)", padding: "2px 10px", borderRadius: 4, background: "var(--glass-bg)" }}>
          Alt+左键旋转 · 中键平移 · 滚轮缩放 · 点击选择 · 拖拽移动 · C导出视角 · Del删除 · Esc退出
        </div>
      </div>

      {/* RIGHT SIDEBAR: Camera presets */}
      <div style={{ width: 200, background: "var(--bg-secondary)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
          📷 机位预设
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {CAMERA_PRESETS.map((preset, i) => (
            <button
              key={i}
              onClick={() => {
                window.dispatchEvent(new CustomEvent("director3d-set-camera", { detail: preset }));
              }}
              style={{
                fontSize: 11, padding: "6px 10px", borderRadius: 4, cursor: "pointer",
                background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-primary)",
                textAlign: "left", width: "100%",
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Bottom actions */}
        <div style={{ padding: 8, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 4 }}>
          <button
            onClick={exportViewAsNode}
            style={{ fontSize: 11, padding: "6px 12px", borderRadius: 4, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-primary)", cursor: "pointer", width: "100%" }}
          >
            📷 导出到画布
          </button>
          <button
            onClick={() => setIsFullscreen(false)}
            style={{ fontSize: 11, padding: "6px 12px", borderRadius: 4, background: "var(--accent-btn)", border: "none", color: "#fff", cursor: "pointer", width: "100%" }}
          >
            退出全屏
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {!isFullscreen && <NodeDeleteButton id={id} selected={selected ?? false} />}
        {normalModeContent}
      {isFullscreen && createPortal(fullscreenContent, document.body)}
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

// --- Sub-components ---

function TabButton({ active, onClick, icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="nodrag"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        borderRadius: 6,
        fontSize: 12,
        cursor: "pointer",
        background: active ? "var(--bg-hover)" : "transparent",
        border: active ? "1px solid var(--border)" : "1px solid transparent",
        color: active ? "var(--text-primary)" : "var(--text-muted)",
      }}
    >
      <span style={{ fontSize: 10 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// --- Styles ---
const leftTabActive: React.CSSProperties = {
  flex: 1, padding: "8px 0", fontSize: 12, cursor: "pointer",
  background: "transparent", border: "none", borderBottom: "2px solid var(--border-hover)", color: "var(--text-primary)",
};

const leftTabNormal: React.CSSProperties = {
  flex: 1, padding: "8px 0", fontSize: 12, cursor: "pointer",
  background: "transparent", border: "none", borderBottom: "2px solid transparent", color: "var(--text-secondary)",
};

const propInputStyle: React.CSSProperties = {
  width: "100%", fontSize: 11, padding: "3px 6px", borderRadius: 4,
  background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none",
};

const floatBtnStyle: React.CSSProperties = {
  fontSize: 14, padding: "4px 8px", borderRadius: 4, background: "transparent",
  border: "none", color: "var(--text-primary)", cursor: "pointer",
};



