import { useCallback, useMemo, useState } from "react";
import { useReactFlow, type Node } from "@xyflow/react";
import { useCurrentProject } from "@/stores/projectStore";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useToastStore } from "@/features/canvas/compat/Toast";
import { useConfirm } from "@/features/canvas/compat/ConfirmDialog";
import { loadBlob } from "@/lib/imageStore";
import {
  XIAKEMAN_PROJECT_SOURCE_KIND,
  buildCanvasFromXiakemanProject,
  frameToStoryboardInfo,
  getImportedNodeData,
  type ImportedCanvasNodeData,
} from "./application/xiakemanProjectBridge";
import { CANVAS_NODE_TYPES, type ScriptFrame } from "./domain/canvasNodes";

function isImportedFromCurrentProject(data: ImportedCanvasNodeData, projectId: string): boolean {
  return data.sourceKind === XIAKEMAN_PROJECT_SOURCE_KIND && data.sourceProjectId === projectId;
}

function getText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

async function createObjectUrlFromBlobKey(blobKey: unknown): Promise<string | null> {
  const key = getText(blobKey);
  if (!key) return null;
  const blob = await loadBlob(key).catch(() => null);
  return blob ? URL.createObjectURL(blob) : null;
}

async function hydrateImportedProjectMedia(nodes: Node[]): Promise<Node[]> {
  return Promise.all(nodes.map(async (node) => {
    const data = { ...(node.data ?? {}) } as ImportedCanvasNodeData & {
      imageUrl?: string | null;
      videoUrl?: string | null;
      items?: Array<Record<string, unknown>>;
    };
    let changed = false;

    if (!data.imageUrl && data.sourceAssetBlobKey) {
      const objectUrl = await createObjectUrlFromBlobKey(data.sourceAssetBlobKey);
      if (objectUrl) {
        data.imageUrl = objectUrl;
        changed = true;
      }
    }

    if (!data.imageUrl && data.sourceStoryboardBoardBlobKey) {
      const objectUrl = await createObjectUrlFromBlobKey(data.sourceStoryboardBoardBlobKey);
      if (objectUrl) {
        data.imageUrl = objectUrl;
        changed = true;
      }
    }

    if (!data.videoUrl && data.sourceVideoBlobKey) {
      const objectUrl = await createObjectUrlFromBlobKey(data.sourceVideoBlobKey);
      if (objectUrl) {
        data.videoUrl = objectUrl;
        changed = true;
      }
    }

    if (Array.isArray(data.items)) {
      const hydratedItems = await Promise.all(data.items.map(async (item) => {
        if (item.imageUrl || !item.sourceAssetBlobKey) return item;
        const objectUrl = await createObjectUrlFromBlobKey(item.sourceAssetBlobKey);
        return objectUrl ? { ...item, imageUrl: objectUrl } : item;
      }));
      if (hydratedItems.some((item, index) => item !== data.items?.[index])) {
        data.items = hydratedItems;
        changed = true;
      }
    }

    return changed ? { ...node, data } : node;
  }));
}

export function CanvasProjectBridgeBar() {
  const { state, currentProject, dispatch, flushState } = useCurrentProject();
  const nodes = useCanvasStore((state) => state.nodes);
  const setNodes = useCanvasStore((state) => state.setNodes);
  const setEdges = useCanvasStore((state) => state.setEdges);
  const setCanvasViewport = useCanvasStore((state) => state.setViewport);
  const addToast = useToastStore((state) => state.addToast);
  const showConfirm = useConfirm();
  const reactFlow = useReactFlow();
  const [isWorking, setIsWorking] = useState(false);

  const importedSummary = useMemo(() => {
    if (!currentProject) return { importedNodeCount: 0, importedChapterCount: 0 };
    const chapterIds = new Set<string>();
    let importedNodeCount = 0;
    for (const node of nodes) {
      const data = getImportedNodeData(node);
      if (!isImportedFromCurrentProject(data, currentProject.id)) continue;
      importedNodeCount += 1;
      if (data.sourceChapterId) chapterIds.add(data.sourceChapterId);
    }
    return { importedNodeCount, importedChapterCount: chapterIds.size };
  }, [currentProject, nodes]);

  const performImportCurrentProject = useCallback(async () => {
    if (!currentProject) {
      addToast("warning", "当前没有可导入的网站项目");
      return;
    }

    setIsWorking(true);
    try {
      const built = buildCanvasFromXiakemanProject(currentProject, {
        imageApiConfig: state.imageApiConfig,
        videoApiConfig: state.videoApiConfig,
      });
      const hydratedNodes = await hydrateImportedProjectMedia(built.nodes);
      setNodes(hydratedNodes);
      setEdges(built.edges);
      const viewport = { x: 40, y: 40, zoom: 0.72 };
      setCanvasViewport(viewport);
      void reactFlow.setViewport(viewport, { duration: 250 });
      window.requestAnimationFrame(() => {
        void reactFlow.fitView({ padding: 0.12, duration: 350 });
      });
      addToast(
        "success",
        `已导入 ${built.chapterCount} 章、${built.storyboardCount} 条分镜、${built.assetCount} 个素材、${built.videoCount} 个视频节点`,
      );
    } catch (error) {
      console.error("[CanvasProjectBridgeBar] import failed:", error);
      addToast("error", "导入网站项目失败，请检查项目数据");
    } finally {
      setIsWorking(false);
    }
  }, [addToast, currentProject, reactFlow, setCanvasViewport, setEdges, setNodes, state.imageApiConfig, state.videoApiConfig]);

  const handleImportCurrentProject = useCallback(() => {
    if (!currentProject) {
      addToast("warning", "当前没有可导入的网站项目");
      return;
    }
    if (nodes.length === 0) {
      void performImportCurrentProject();
      return;
    }
    showConfirm({
      title: "导入网站项目",
      message: "导入后会用当前网站项目重新生成画布节点，并替换画布里已有节点。",
      hint: "不会消耗 API，也不会修改网站项目内容。",
      confirmLabel: "导入",
      cancelLabel: "取消",
      variant: "warning",
      onConfirm: () => { void performImportCurrentProject(); },
    });
  }, [addToast, currentProject, nodes.length, performImportCurrentProject, showConfirm]);

  const performSyncBackToProject = useCallback(() => {
    if (!currentProject) {
      addToast("warning", "当前没有可同步的网站项目");
      return;
    }

    const importedNodes = nodes.filter((node) => {
      const data = getImportedNodeData(node);
      return isImportedFromCurrentProject(data, currentProject.id);
    });

    if (importedNodes.length === 0) {
      addToast("warning", "当前画布没有从网站项目导入的节点");
      return;
    }

    setIsWorking(true);
    let scriptSyncCount = 0;
    let storyboardSyncCount = 0;
    let assetPromptSyncCount = 0;
    let step4PromptSyncCount = 0;
    let videoSyncCount = 0;
    let skippedStoryboardCount = 0;

    try {
      for (const node of importedNodes) {
        const data = getImportedNodeData(node);
        const chapterId = data.sourceChapterId;
        if (!chapterId) continue;
        const chapter = currentProject.chapters.find((item) => item.id === chapterId);
        if (!chapter) continue;

        if (node.type === CANVAS_NODE_TYPES.script && typeof data.scriptText === "string") {
          if (data.sourceScriptField === "adaptedScript") {
            dispatch({
              type: "SET_ADAPTED_SCRIPT",
              projectId: currentProject.id,
              chapterId,
              script: data.scriptText,
            });
          } else {
            dispatch({
              type: "SET_RAW_SCRIPT",
              projectId: currentProject.id,
              chapterId,
              script: data.scriptText,
            });
          }
          scriptSyncCount += 1;
          continue;
        }

        if (node.type === CANVAS_NODE_TYPES.scriptResult && Array.isArray(data.frames)) {
          const frames = data.frames as ScriptFrame[];
          const maxCount = Math.min(frames.length, chapter.storyboards.length);
          for (let index = 0; index < maxCount; index += 1) {
            const existing = chapter.storyboards[index];
            dispatch({
              type: "UPDATE_STORYBOARD",
              projectId: currentProject.id,
              chapterId,
              index,
              updates: {
                storyboard: frameToStoryboardInfo(frames[index], existing?.storyboard, index),
                isStale: true,
              },
            });
            storyboardSyncCount += 1;
          }
          if (frames.length !== chapter.storyboards.length) {
            skippedStoryboardCount += Math.abs(frames.length - chapter.storyboards.length);
          }
          continue;
        }

        if (
          (node.type === CANVAS_NODE_TYPES.character || node.type === CANVAS_NODE_TYPES.scene || node.type === CANVAS_NODE_TYPES.prop)
          && Array.isArray((node.data as { items?: unknown[] }).items)
        ) {
          const items = (node.data as { items?: Array<Record<string, unknown>> }).items ?? [];
          for (const item of items) {
            const assetId = getText(item.sourceAssetId);
            const rawText = getText(item.rawText);
            if (!assetId || !rawText) continue;
            dispatch({
              type: "UPDATE_ASSET",
              projectId: currentProject.id,
              assetId,
              updates: {
                optimizedPrompt: rawText,
                updatedAt: Date.now(),
              },
            });
            assetPromptSyncCount += 1;
          }
          continue;
        }

        if (node.type === CANVAS_NODE_TYPES.storyboardGen && Array.isArray(data.frames)) {
          const frames = data.frames as ScriptFrame[];
          const maxCount = Math.min(frames.length, chapter.storyboards.length);
          for (let index = 0; index < maxCount; index += 1) {
            const frame = frames[index] as ScriptFrame & { description?: string };
            const prompt = getText(frame.description);
            if (!prompt) continue;
            dispatch({
              type: "UPDATE_STORYBOARD",
              projectId: currentProject.id,
              chapterId,
              index,
              updates: {
                seedanceFinalVideoPrompt: prompt,
                seedanceFinalVideoPromptStatus: "done",
                seedanceFinalVideoPromptUpdatedAt: Date.now(),
                isStale: false,
              },
            });
            step4PromptSyncCount += 1;
          }
          continue;
        }

        if (node.type === CANVAS_NODE_TYPES.video && typeof data.sourceStoryboardIndex === "number") {
          const index = data.sourceStoryboardIndex;
          if (!chapter.storyboards[index]) continue;
          const nodeData = node.data as Record<string, unknown>;
          const prompt = getText(nodeData.prompt);
          const videoUrl = getText(nodeData.videoUrl);
          const extraParams = (nodeData.extraParams && typeof nodeData.extraParams === "object")
            ? nodeData.extraParams as Record<string, unknown>
            : {};
          const duration = getNumber(extraParams.duration);
          const updates: Record<string, unknown> = {};
          if (prompt) {
            updates.videoSubmitPromptOverride = prompt;
            updates.videoSubmitPromptOverrideSourcePrompt = "canvas";
            updates.videoSubmitPromptOverrideUpdatedAt = Date.now();
          }
          if (typeof duration === "number") {
            updates.videoSubmitDuration = duration;
          }
          if (videoUrl) {
            updates.videoUrl = videoUrl;
            updates.videoStatus = "done";
            updates.videoProgress = 100;
            updates.videoCompletedAt = Date.now();
          }
          if (Object.keys(updates).length > 0) {
            dispatch({
              type: "UPDATE_STORYBOARD",
              projectId: currentProject.id,
              chapterId,
              index,
              updates,
            });
            videoSyncCount += 1;
          }
        }
      }

      window.setTimeout(() => {
        void flushState();
      }, 0);

      const skippedText = skippedStoryboardCount > 0 ? `，${skippedStoryboardCount} 条因数量不一致未同步` : "";
      addToast(
        "success",
        `已同步 ${scriptSyncCount} 个剧本、${storyboardSyncCount} 条分镜、${assetPromptSyncCount} 个素材提示词、${step4PromptSyncCount} 条Step4提示词、${videoSyncCount} 个视频节点${skippedText}`,
      );
    } catch (error) {
      console.error("[CanvasProjectBridgeBar] sync failed:", error);
      addToast("error", "同步回网站项目失败");
    } finally {
      setIsWorking(false);
    }
  }, [addToast, currentProject, dispatch, flushState, nodes]);

  const handleSyncBackToProject = useCallback(() => {
    if (!currentProject) {
      addToast("warning", "当前没有可同步的网站项目");
      return;
    }
    showConfirm({
      title: "同步回网站项目",
      message: "将画布中修改过的剧本文本和分镜表同步回当前网站项目。",
      hint: "会同步剧本、分镜、素材提示词、Step4提示词、Step5视频提交词和视频URL；不会强行覆盖网站资产图片文件。",
      confirmLabel: "同步",
      cancelLabel: "取消",
      variant: "default",
      onConfirm: performSyncBackToProject,
    });
  }, [addToast, currentProject, performSyncBackToProject, showConfirm]);

  return (
    <div
      className="absolute z-10"
      style={{
        top: 12,
        left: 58,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 12,
        backgroundColor: "var(--glass-bg)",
        border: "1px solid var(--glass-border)",
        boxShadow: "var(--shadow-card)",
        backdropFilter: "blur(var(--glass-blur))",
        WebkitBackdropFilter: "blur(var(--glass-blur))",
      }}
    >
      <div
        style={{
          maxWidth: 260,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--text-secondary)",
          fontSize: 12,
        }}
        title={currentProject?.name || "无当前网站项目"}
      >
        {currentProject ? `网站项目：${currentProject.name}` : "未打开网站项目"}
      </div>
      <BridgeButton disabled={isWorking || !currentProject} onClick={handleImportCurrentProject}>
        一键导入全链路
      </BridgeButton>
      <BridgeButton
        disabled={isWorking || !currentProject || importedSummary.importedNodeCount === 0}
        onClick={handleSyncBackToProject}
        variant="primary"
      >
        同步修改回项目
      </BridgeButton>
      {importedSummary.importedChapterCount > 0 && (
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
          已导入 {importedSummary.importedChapterCount} 章
        </span>
      )}
    </div>
  );
}

function BridgeButton({
  children,
  disabled,
  onClick,
  variant = "secondary",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  variant?: "primary" | "secondary";
}) {
  const isPrimary = variant === "primary";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        height: 30,
        padding: "0 12px",
        borderRadius: 8,
        border: isPrimary ? "1px solid rgba(122,180,240,0.42)" : "1px solid var(--border)",
        backgroundColor: isPrimary ? "rgba(122,180,240,0.16)" : "rgba(255,255,255,0.04)",
        color: isPrimary ? "var(--accent)" : "var(--text-primary)",
        fontSize: 12,
        fontWeight: 500,
        whiteSpace: "nowrap",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.48 : 1,
      }}
    >
      {children}
    </button>
  );
}
