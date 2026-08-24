import { useCallback, useMemo, useEffect, useState, useRef, memo } from "react";
import {
  ReactFlow,
  Background,
  ReactFlowProvider,
  BackgroundVariant,
  SelectionMode,
  MiniMap,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type EdgeTypes,
  type OnMoveEnd,
  type OnSelectionChangeFunc,
  type OnConnectStart,
  useReactFlow,
  ConnectionLineType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useAssetStore } from "@/features/canvas/stores/assetStore";
import { useProjectStore } from "@/features/canvas/stores/projectStore";
import { useSettingsStore } from "@/features/canvas/stores/settingsStore";
import { CanvasToolbar } from "./CanvasToolbar";
import { CanvasProjectBridgeBar } from "./CanvasProjectBridgeBar";
import { NodeSelectionMenu } from "./NodeSelectionMenu";
import { NodeContextMenu } from "./NodeContextMenu";
import { ConnectionNodeMenu } from "./ConnectionNodeMenu";
import { UploadNode } from "./nodes/UploadNode";
import { ImageEditNode } from "./nodes/ImageEditNode";
import { ExportImageNode } from "./nodes/ExportImageNode";
import { TextAnnotationNode } from "./nodes/TextAnnotationNode";
import { ScriptNode } from "./nodes/ScriptNode";
import { ScriptResultNode } from "./nodes/ScriptResultNode";
import { GroupNode } from "./nodes/GroupNode";
import { StoryboardSplitNode } from "./nodes/StoryboardSplitNode";
import { StoryboardGenNode } from "./nodes/StoryboardGenNode";
import { VideoNode } from "./nodes/VideoNode";
import { VideoResultNode } from "./nodes/VideoResultNode";
import { VideoFrameNode } from "./nodes/VideoFrameNode";
import { Director3DNode } from "./nodes/Director3DNode";
import { Panorama360Node } from "./nodes/Panorama360Node";
import { AudioNode } from "./nodes/AudioNode";
import { CutResultNode } from "./nodes/CutResultNode";
import { VideoCompositionNode } from "./nodes/VideoCompositionNode";
import { CharacterNode } from "./nodes/CharacterNode";
import { SceneNode } from "./nodes/SceneNode";
import { PropNode } from "./nodes/PropNode";
import { NovelNode } from "./nodes/NovelNode";
import { NovelChapterNode } from "./nodes/NovelChapterNode";
import { AssetGenNode } from "./nodes/AssetGenNode";
import { DataFlowEdge } from "./edges/DataFlowEdge";
import { AssetLibraryPanel } from "./ui/AssetLibraryPanel";
import { ChatPanel } from "./ui/ChatPanel";
import { useAutoSave, useCanvasKeyboard } from "./hooks";
import { CANVAS_NODE_TYPES } from "./domain/canvasNodes";
import { nodeRegistry } from "./domain/nodeRegistry";
import { useToastStore } from "@/features/canvas/compat/Toast";
import { prepareNodeImageFromFile } from "./application/imageData";
import { persistVideoBinary } from "@/features/canvas/compat/commands";

const nodeTypes: NodeTypes = {
  uploadNode: memo(UploadNode),
  imageNode: memo(ImageEditNode),
  videoNode: memo(VideoNode),
  videoResultNode: memo(VideoResultNode),
  videoFrameNode: memo(VideoFrameNode),
  director3dNode: memo(Director3DNode),
  panorama360Node: memo(Panorama360Node),
  exportImageNode: memo(ExportImageNode),
  textAnnotationNode: memo(TextAnnotationNode),
  scriptNode: memo(ScriptNode),
  scriptResultNode: memo(ScriptResultNode),
  groupNode: memo(GroupNode),
  storyboardNode: memo(StoryboardSplitNode),
  storyboardGenNode: memo(StoryboardGenNode),
  audioNode: memo(AudioNode),
  cutResultNode: memo(CutResultNode),
  videoCompositionNode: memo(VideoCompositionNode),
  characterNode: memo(CharacterNode),
  sceneNode: memo(SceneNode),
  propNode: memo(PropNode),
  novelNode: memo(NovelNode),
  novelChapterNode: memo(NovelChapterNode),
  assetGenNode: memo(AssetGenNode),
};

const edgeTypes: EdgeTypes = {
  dataFlow: DataFlowEdge,
};

function CanvasInner() {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const setViewport = useCanvasStore((s) => s.setViewport);
  const setSelectedNodes = useCanvasStore((s) => s.setSelectedNodes);
  const setSelectedEdges = useCanvasStore((s) => s.setSelectedEdges);
  const loadState = useCanvasStore((s) => s.loadState);
  const isValidConnection = useCanvasStore((s) => s.isValidConnection);
  const showGrid = useSettingsStore((s) => s.showGrid);
  const currentProject = useProjectStore((s) => s.currentProject);
  const [showTutorial, setShowTutorial] = useState(() => {
    try { return localStorage.getItem("canvas-tutorial-dismissed") !== "1"; }
    catch { return true; }
  });
  const connectingRef = useRef<{ nodeId: string; nodeType: string | undefined; handleType: "source" | "target" | null; didConnect: boolean } | null>(null);
  const { screenToFlowPosition } = useReactFlow();
  const addToast = useToastStore((s) => s.addToast);
  const [isDragOver, setIsDragOver] = useState(false);

  // Hooks
  useAutoSave();
  const { isPanMode } = useCanvasKeyboard();

  // Load assets once at canvas level — all nodes share the same store
  useEffect(() => {
    useAssetStore.getState().loadAllAssets();
  }, []);

  const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tiff", "avif"];
  const VIDEO_EXTENSIONS = ["mp4", "avi", "mov", "mkv", "webm", "flv", "wmv"];

  const getFileType = (fileName: string): "image" | "video" | null => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    if (IMAGE_EXTENSIONS.includes(ext)) return "image";
    if (VIDEO_EXTENSIONS.includes(ext)) return "video";
    return null;
  };

  // HTML5 drag handlers for canvas-level file import
  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleCanvasDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const name = files[0].name.toLowerCase();
      const isMedia = IMAGE_EXTENSIONS.some((ext) => name.endsWith(`.${ext}`))
        || VIDEO_EXTENSIONS.some((ext) => name.endsWith(`.${ext}`));
      if (isMedia) setIsDragOver(true);
    } else {
      // May not have file info on dragenter in some browsers, show overlay anyway
      setIsDragOver(true);
    }
  }, []);

  const handleCanvasDragLeave = useCallback((e: React.DragEvent) => {
    // Only hide overlay when leaving the canvas container itself
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
      setIsDragOver(false);
    }
  }, []);

  const handleCanvasDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    const file = files[0];
    const fileName = file.name;
    const fileType = getFileType(fileName);

    if (!fileType) {
      addToast("warning", "不支持的文件类型，请拖入图片或视频文件");
      return;
    }

    // Convert drop position to canvas flow coordinates
    const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });

    if (fileType === "image") {
      const nodeType = CANVAS_NODE_TYPES.upload;
      const registry = nodeRegistry[nodeType];
      const nodeId = `upload-${Date.now()}`;

      const newNode: Node = {
        id: nodeId,
        type: nodeType,
        position: flowPos,
        data: {
          ...registry.createDefaultData(),
          sourceFileName: fileName,
        },
      };

      const store = useCanvasStore.getState();
      store.addNode(newNode);

      // Process image file asynchronously (persist + generate preview)
      try {
        const result = await prepareNodeImageFromFile(file);
        if (result) {
          store.updateNodeData(nodeId, {
            imageUrl: result.path,
            previewImageUrl: result.previewPath,
            sourceFileName: fileName,
            imageWidth: result.width,
            imageHeight: result.height,
          });
        }
        addToast("success", `已导入图片: ${fileName}`);
      } catch (err) {
        console.error("Failed to process dropped image:", err);
        addToast("error", `导入图片失败: ${err}`);
      }
    } else if (fileType === "video") {
      const nodeType = CANVAS_NODE_TYPES.videoFrame;
      const registry = nodeRegistry[nodeType];
      const nodeId = `videoFrame-${Date.now()}`;

      // Create node immediately with optimistic UI
      const newNode: Node = {
        id: nodeId,
        type: nodeType,
        position: flowPos,
        data: {
          ...registry.createDefaultData(),
          sourceFileName: fileName,
        },
      };

      const store = useCanvasStore.getState();
      store.addNode(newNode);
      addToast("info", `正在导入视频: ${fileName}`);

      // Persist video file asynchronously using binary transfer (no base64 overhead)
      try {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = Array.from(new Uint8Array(arrayBuffer));
        const ext = fileName.split(".").pop()?.toLowerCase() || "mp4";

        const persistedPath = await persistVideoBinary(bytes, ext);
        store.updateNodeData(nodeId, {
          videoPath: String(persistedPath),
          sourceFileName: fileName,
        });
        addToast("success", `已导入视频: ${fileName}`);
      } catch (err) {
        console.error("Failed to persist dropped video:", err);
        addToast("error", `导入视频失败: ${err}`);
      }
    }
  }, [screenToFlowPosition, addToast]);

  // Load project data into canvas when project changes
  useEffect(() => {
    if (currentProject) {
      try {
        const loadedNodes = currentProject.nodesJson
          ? JSON.parse(currentProject.nodesJson).map((n: any) => {
              // Strip saved width/height so ReactFlow re-measures nodes
              // (allows component layout changes to take effect)
              const { width, height, measured, style, ...rest } = n;
              const cleanedStyle = style ? { ...style } : {};
              delete cleanedStyle.width;
              delete cleanedStyle.height;
              delete cleanedStyle.maxWidth;
              delete cleanedStyle.minWidth;
              delete cleanedStyle.maxHeight;
              delete cleanedStyle.minHeight;
              return { ...rest, style: cleanedStyle };
            })
          : [];
        const loadedEdges = currentProject.edgesJson
          ? JSON.parse(currentProject.edgesJson)
          : [];
        const loadedViewport = currentProject.viewportJson
          ? JSON.parse(currentProject.viewportJson)
          : { x: 0, y: 0, zoom: 1 };

        // Only load if different from current state (fast reference check)
        const currentNodes = useCanvasStore.getState().nodes;
        const currentEdges = useCanvasStore.getState().edges;
        if (loadedNodes.length !== currentNodes.length || loadedEdges.length !== currentEdges.length) {
          loadState(loadedNodes, loadedEdges, loadedViewport);
        }
      } catch (e) {
        console.error("Failed to load project data:", e);
        addToast("error", "项目数据加载失败，请尝试重新打开或检查文件完整性");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id]);

  const handleMoveEnd: OnMoveEnd = useCallback(
    (_event, viewport) => {
      setViewport(viewport);
    },
    [setViewport]
  );

  const handleSelectionChange: OnSelectionChangeFunc = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }) => {
      const selectedNodeIds = new Set(selectedNodes.map((n) => n.id));
      setSelectedNodes([...selectedNodeIds]);

      // When nodes are selected via box selection, also select edges between them
      // (ReactFlow box selection only selects nodes, not edges)
      if (selectedNodes.length > 0) {
        const allEdges = useCanvasStore.getState().edges;
        const connectedEdgeIds = allEdges
          .filter((e) => selectedNodeIds.has(e.source) && selectedNodeIds.has(e.target))
          .map((e) => e.id);
        setSelectedEdges(connectedEdgeIds);
      } else {
        // If no nodes selected (e.g., clicked an edge), use the reported edges
        setSelectedEdges(selectedEdges.map((e) => e.id));
      }
    },
    [setSelectedNodes, setSelectedEdges]
  );

  // Edge deletion is now handled in useCanvasKeyboard (Delete/Backspace)
  // along with node deletion, with proper input-field guard.

  const handleConnectStart: OnConnectStart = useCallback(
    (_event, params) => {
      if (params.nodeId) {
        // Use getState() instead of subscribing to full nodes array
        const node = useCanvasStore.getState().nodes.find((n) => n.id === params.nodeId);
        const nodeType: string = node?.type ?? "";
        if (nodeType && params.handleType) {
          connectingRef.current = {
            nodeId: params.nodeId,
            nodeType,
            handleType: params.handleType,
            didConnect: false,
          };
        }
      }
    },
    []
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      // Mark that a connection was successfully made
      if (connectingRef.current) {
        connectingRef.current.didConnect = true;
      }
      onConnect(connection);
    },
    [onConnect]
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const ref = connectingRef.current;
      if (!ref) return;

      // If connection was not made, show the node selection menu
      if (!ref.didConnect) {
        const clientX = "clientX" in event ? event.clientX : 0;
        const clientY = "clientY" in event ? event.clientY : 0;
        // Convert screen coordinates to flow/canvas coordinates for accurate node placement
        const flowPosition = screenToFlowPosition({ x: clientX, y: clientY });

        window.dispatchEvent(
          new CustomEvent("connection-end", {
            detail: {
              didConnect: false,
              clientX,
              clientY,
              flowX: flowPosition.x,
              flowY: flowPosition.y,
              sourceNodeId: ref.nodeId,
              sourceNodeType: ref.nodeType,
              handleType: ref.handleType,
            },
          })
        );
      }

      connectingRef.current = null;
    },
    [screenToFlowPosition]
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      type: "dataFlow" as const,
      animated: false,
    }),
    []
  );

  return (
    <div
      className="w-full h-full relative"
      onDragOver={handleCanvasDragOver}
      onDragEnter={handleCanvasDragEnter}
      onDragLeave={handleCanvasDragLeave}
      onDrop={handleCanvasDrop}
      data-debug="CanvasInner-rendered"
    >
      {/* Drag overlay for canvas-level file drops */}
      {isDragOver && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 100,
            backgroundColor: "rgba(75, 127, 212, 0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div style={{
            padding: "20px 36px",
            borderRadius: "16px",
            backgroundColor: "rgba(0,0,0,0.75)",
            color: "#fff",
            fontSize: "16px",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: "12px",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.15)",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            松开以导入文件到画布
          </div>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onMoveEnd={handleMoveEnd}
        onSelectionChange={handleSelectionChange}
        isValidConnection={(connection: Connection | Edge) => {
          return isValidConnection(connection as Connection);
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        connectionLineStyle={{
          stroke: "#ff8a3d",
          strokeWidth: 3.5,
          strokeDasharray: "8 6",
          filter: "drop-shadow(0 0 10px rgba(255, 138, 61, 0.55))",
        }}
        connectionLineType={ConnectionLineType.Bezier}
        deleteKeyCode={null}
        multiSelectionKeyCode="Shift"
        selectionOnDrag={false}
        selectionMode={SelectionMode.Partial}
        panOnDrag={[0, 1]}
        noWheelClassName="nowheel"
        style={{ backgroundColor: "var(--bg-primary)" }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={4}
        nodeDragThreshold={3}
        onlyRenderVisibleElements
        elevateNodesOnSelect={false}
        nodesDraggable
        nodesFocusable={false}
        elementsSelectable
      >
        {showGrid && (
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="var(--border-hover)"
          />
        )}
        <MiniMap
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            width: 120,
            height: 80,
          }}
          nodeColor={(node) => {
            if (node.selected) return "var(--accent)";
            return "var(--bg-hover)";
          }}
          maskColor="rgba(0,0,0,0.6)"
          pannable
          zoomable
        />
      </ReactFlow>

      {/* Tutorial Card */}
      {showTutorial && nodes.length === 0 && (
        <div
          className="absolute z-10"
          style={{
            top: '60px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '420px',
            backgroundColor: '#25252a',
            border: '0.5px solid #2e2e34',
            borderRadius: '12px',
            padding: '20px 24px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
          }}
        >
          <div className="flex items-center justify-between" style={{ marginBottom: '14px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 500, color: '#f0f0f5' }}>
              快速上手
            </h3>
            <button
              onClick={() => {
                setShowTutorial(false);
                try { localStorage.setItem("canvas-tutorial-dismissed", "1"); } catch {}
              }}
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '6px',
                color: '#5a5a62',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ fontSize: '13px', color: '#a0a0a8', lineHeight: 2 }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(122,180,240,0.12)', color: '#7ab4f0', fontSize: 12, fontWeight: 500, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 4 }}>1</span>
              <span>点击左侧工具栏 <b style={{ color: '#f0f0f5' }}>+</b> 或右键画布，创建场景、角色、图片、视频等节点</span>
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(122,180,240,0.12)', color: '#7ab4f0', fontSize: 12, fontWeight: 500, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 4 }}>2</span>
              <span>在节点中输入画面描述，选择 <b style={{ color: '#f0f0f5' }}>AI模型</b> 和参数，点击 <b style={{ color: '#7ab4f0' }}>生成</b></span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(122,180,240,0.12)', color: '#7ab4f0', fontSize: 12, fontWeight: 500, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 4 }}>3</span>
              <span>节点之间连线，数据自动传递 — 上图连下图实现 <b style={{ color: '#f0f0f5' }}>图生图/图生视频</b></span>
            </div>
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '0.5px solid #2e2e34', fontSize: 11, color: '#5a5a62' }}>
            提示：拖拽图片到画布可快速导入 / 按 <code style={{ background: '#1a1a1e', padding: '1px 4px', borderRadius: 3 }}>?</code> 查看快捷键
          </div>
        </div>
      )}

      {/* Center hint when empty */}
      {nodes.length === 0 && !showTutorial && (
        <div
          className="absolute z-10 flex flex-col items-center"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none'
          }}
        >
          <div style={{
            width: 64, height: 64, borderRadius: 16,
            background: 'rgba(122,180,240,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7ab4f0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <h2
            style={{
              fontSize: '20px',
              fontWeight: 500,
              color: '#f0f0f5',
              marginBottom: '8px',
              textAlign: 'center',
              opacity: 0.6,
            }}
          >
            右键画布或点击左侧 + 创建节点
          </h2>
          <p style={{ fontSize: '13px', color: '#5a5a62', textAlign: 'center', opacity: 0.6 }}>
            拖拽图片文件到画布快速导入
          </p>
        </div>
      )}

      <CanvasProjectBridgeBar />
      <CanvasToolbar />
      <NodeSelectionMenu />
      <NodeContextMenu />
      <ConnectionNodeMenu />
      <AssetLibraryPanel />
      <ChatPanel />
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}



