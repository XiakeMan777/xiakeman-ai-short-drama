import { useCallback, useState, memo } from "react";
import { type NodeProps, Handle, Position } from "@xyflow/react";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { ImageEditorDialog } from "../ui/ImageEditorDialog";
import { useErrorStore } from "@/features/canvas/compat/ErrorDialog";
import {
  saveImageToDownloads,
  copyImageToClipboard,
  copyImageSourceToClipboard,
  exportProjectToFile,
  importProjectFromFile,
  persistImageSource,
} from "@/features/canvas/compat/commands";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useProjectStore } from "@/features/canvas/stores/projectStore";
import { useToastStore } from "@/features/canvas/compat/Toast";
import type { ExportImageNodeData } from "../domain/canvasNodes";
import {
  useCachedImage,
} from "../hooks/useCachedImage";
import { ImageViewerModal } from "../ui/ImageViewerModal";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";

/**
 * Export Image Node — saves the canvas state as a project file, plus image operations.
 *
 * Supports:
 * - Save project file (canvas state: nodes + edges + viewport) — can be reopened later
 * - Open project file — restores full canvas layout
 * - Save source image to custom path / downloads
 * - Copy source image to clipboard
 * - Copy Data URL to clipboard
 */
export const ExportImageNode = memo(function ExportImageNode({ data, id, selected }: NodeProps) {
  const nodeData = data as unknown as ExportImageNodeData;
  const showError = useErrorStore((s) => s.showError);
  const addToast = useToastStore((s) => s.addToast);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isSavingImage, setIsSavingImage] = useState(false);
  const [isOpeningProject, setIsOpeningProject] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [showImageEditor, setShowImageEditor] = useState(false);

  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const nodeWidth = nodeData.width || 220;
  const nodeHeight = nodeData.height || 400;
  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );

  // PERFORMANCE: Always use preview/thumbnail for node display.
  // Only load the full-resolution original in the modal viewer.
  const { loaded, displayUrl } = useCachedImage(nodeData.previewImageUrl || nodeData.imageUrl);

  const isDataUrl = nodeData.imageUrl?.startsWith("data:");

  // ── Save project to file ──
  const handleSaveProjectFile = useCallback(async () => {
    setIsSavingProject(true);
    try {
      const currentProject = useProjectStore.getState().currentProject;
      if (!currentProject) {
        showError("没有打开的项目");
        return;
      }

      // First, trigger a save of current canvas state to DB
      const { nodes, edges, history, markClean } = useCanvasStore.getState();
      const nodesJson = JSON.stringify(nodes);
      const edgesJson = JSON.stringify(edges);
      const historyJson = JSON.stringify(history);
      await useProjectStore.getState().saveProject({
        nodesJson,
        edgesJson,
        historyJson,
        nodeCount: nodes.length,
      });
      markClean();

      // Now export to file
      const { save } = await import("@/features/canvas/compat/dialog");
      const filePath = await save({
        defaultPath: `${currentProject.name || 'storyboard'}.sbcopilot`,
        filters: [
          { name: "Storyboard Project", extensions: ["sbcopilot"] },
          { name: "JSON", extensions: ["json"] },
        ],
      });
      if (!filePath) return;

      await exportProjectToFile(currentProject.id, filePath);
      addToast("success", "项目文件已保存");
    } catch (e) {
      showError(`保存项目文件失败: ${e}`);
    } finally {
      setIsSavingProject(false);
    }
  }, [showError, addToast]);

  // ── Open project from file ──
  const handleOpenProjectFile = useCallback(async () => {
    setIsOpeningProject(true);
    try {
      const { open } = await import("@/features/canvas/compat/dialog");
      const filePath = await open({
        filters: [
          { name: "Storyboard Project", extensions: ["sbcopilot"] },
          { name: "JSON", extensions: ["json"] },
        ],
        multiple: false,
      });
      if (!filePath) return;

      const newProjectId = await importProjectFromFile(filePath as string);

      // Open the newly imported project
      await useProjectStore.getState().openProject(newProjectId);
      await useProjectStore.getState().loadProjects();
      addToast("success", "项目文件已打开");
    } catch (e) {
      showError(`打开项目文件失败: ${e}`);
    } finally {
      setIsOpeningProject(false);
    }
  }, [showError, addToast]);


  // ── Save source image to downloads ──
  const handleSaveImageToDownloads = useCallback(async () => {
    if (!nodeData.imageUrl) return;
    setIsSavingImage(true);
    try {
      await saveImageToDownloads(nodeData.imageUrl, `image-${Date.now()}.png`);
      addToast("success", "图片已保存到下载目录");
    } catch (e) {
      showError(`保存图片失败: ${e}`);
    } finally {
      setIsSavingImage(false);
    }
  }, [nodeData.imageUrl, showError, addToast]);

  const handleCopyImage = useCallback(async () => {
    if (!nodeData.imageUrl) return;
    setIsCopying(true);
    try {
      if (isDataUrl) {
        await copyImageToClipboard(nodeData.imageUrl);
      } else {
        await copyImageSourceToClipboard(nodeData.imageUrl);
      }
      addToast("success", "已复制到剪贴板");
    } catch (e) {
      showError(`复制失败: ${e}`);
    } finally {
      setIsCopying(false);
    }
  }, [nodeData.imageUrl, isDataUrl, showError, addToast]);

  return (
    <>
    <NodeDeleteButton id={id} selected={selected ?? false}>
      {nodeData.imageUrl && (
        <button
          className="nodrag"
          onClick={() => setShowImageEditor(true)}
          style={{
            display: "flex", alignItems: "center", gap: "6px",
            padding: "6px 14px", borderRadius: "10px",
            backgroundColor: "var(--bg-node)", border: "1px solid var(--border)",
            color: "var(--text-primary)", fontSize: "12px", fontWeight: 500,
            cursor: "pointer", backdropFilter: "blur(8px)",
            transition: "all 0.2s ease", boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
          }}
          title="编辑图片"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span>编辑</span>
        </button>
      )}
    </NodeDeleteButton>
    {/* Image editor dialog */}
    {showImageEditor && nodeData.imageUrl && (
      <ImageEditorDialog
        imageUrl={nodeData.imageUrl}
        onSave={async (editedUrl) => {
          if (editedUrl) {
            try {
              const persistedPath = (await persistImageSource(editedUrl)) as string;
              updateNodeData(id, { imageUrl: persistedPath });
            } catch {
              updateNodeData(id, { imageUrl: editedUrl });
            }
          }
          setShowImageEditor(false);
        }}
        onClose={() => setShowImageEditor(false)}
      />
    )}
    <div style={{ position: 'relative' }}>
    <div className="bg-[var(--bg-node)] border border-[var(--border)] rounded-[var(--node-radius)] min-w-[220px] node-inner" style={{ width: nodeWidth, height: nodeHeight, boxSizing: 'border-box', boxShadow: "0 2px 12px rgba(0,0,0,.3)" }}>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "160px" }} title={nodeData.displayName || "导出图片"}>
            {nodeData.displayName || "导出图片"}
          </span>
        </div>
      </div>
      <div className="p-3 space-y-2">

        {nodeData.imageUrl ? (
          <>
            {/* Image preview with zoom switching */}
            <div
              className="relative group cursor-zoom-in"
              onDoubleClick={() => { if (nodeData.imageUrl) setViewerOpen(true); }}
            >
              <img
                src={displayUrl}
                alt=""
                loading="lazy"
                decoding="async"
                style={{
                  width: '100%',
                  height: '180px',
                  objectFit: 'contain',
                  opacity: loaded ? 1 : 0,
                  transition: 'opacity 0.3s ease',
                }}
                onDoubleClick={() => { if (nodeData.imageUrl) setViewerOpen(true); }}
              />
              {(isSavingProject || isSavingImage || isOpeningProject || isCopying) && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center rounded">
                  <div style={{ width: "16px", height: "16px", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                </div>
              )}
            </div>

            {/* Image info */}
            {nodeData.imageWidth != null && nodeData.imageHeight != null && (
              <div className="text-[10px] text-[var(--text-secondary)] text-center">
                {String(nodeData.imageWidth)}×{String(nodeData.imageHeight)}
              </div>
            )}

            {/* Canvas save + open */}
            <div className="flex gap-1.5">
              {!!window.__TAURI__ && (
                <button
                  onClick={handleSaveProjectFile}
                  disabled={isSavingProject}
                  className="flex-1 py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors nodrag"
                  title="保存画布内容到本地文件（可再次打开恢复）"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle", marginRight: "4px" }}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  {isSavingProject ? "保存中..." : "保存画布"}
                </button>
              )}
              <button
                onClick={handleSaveImageToDownloads}
                disabled={isSavingImage}
                className="flex-1 py-1.5 text-xs bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border)] rounded hover:bg-[var(--border)] transition-colors nodrag"
                title="保存源图片到下载目录"
              >
                📥 保存图片
              </button>
            </div>
            {!!window.__TAURI__ && (
              <div className="flex gap-1.5">
                <button
                  onClick={handleOpenProjectFile}
                  disabled={isOpeningProject}
                  className="flex-1 py-1.5 text-xs bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border)] rounded hover:bg-[var(--border)] transition-colors nodrag"
                  title="打开之前保存的画布文件"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle", marginRight: "4px" }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                  {isOpeningProject ? "打开中..." : "打开画布"}
                </button>
                <button
                  onClick={handleCopyImage}
                  disabled={isCopying}
                  className="flex-1 py-1.5 text-xs bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border)] rounded hover:bg-[var(--border)] transition-colors nodrag disabled:opacity-50"
                  title="复制源图片"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle", marginRight: "4px" }}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  {isCopying ? "复制中..." : "复制图片"}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="h-[60px] border-2 border-dashed border-[var(--border)] rounded flex flex-col items-center justify-center text-[var(--text-secondary)] text-sm gap-1">
            <span>连接图片节点导出</span>
          </div>
        )}
      </div>
      {/* Fullscreen image viewer */}
      {viewerOpen && nodeData.imageUrl && (
        <ImageViewerModal
          images={[nodeData.imageUrl]}
          onClose={() => setViewerOpen(false)}
        />
      )}
      </div>
    <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize} minWidth={220} maxWidth={900} minHeight={300} maxHeight={1200} />
      </div>
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[var(--accent-secondary)] !w-6 !h-6 !border-2 !border-[var(--bg-node)]"
      />
    </>
  );
});



