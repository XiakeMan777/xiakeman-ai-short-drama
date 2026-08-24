import { useState, useCallback, memo, useEffect, useRef } from "react";
import { type NodeProps, Handle, Position, type Node } from "@xyflow/react";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useSettingsStore } from "@/features/canvas/stores/settingsStore";
import { useChannelModelSelector } from "../hooks/useChannelModelSelector";
import { ChannelModelSelector } from "../ui/ChannelModelSelector";
import { IMAGE_CREDIT_PRICES } from "../application/creditPricing";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";
import { PromptAssistantButton } from "../ui/PromptAssistantPopover";
import { StylePresetSelector } from "../ui/StylePresetSelector";
import { useToastStore } from "@/features/canvas/compat/Toast";
import {
  CANVAS_NODE_TYPES,
  type PropNodeData,
  type PropItem,
  type StoryboardStyleType,
  STORYBOARD_STYLE_LABELS,
} from "../domain/canvasNodes";
import { tauriAiGateway } from "../infrastructure/tauriAiGateway";
import type { ImageSize } from "../models/image/types";
import { getDefaultModelForProvider } from "../models/providers/capabilities";
import { useCreditsStore } from "@/features/canvas/stores/creditsStore";
import { persistImageSource, prepareNodeImageSource } from "@/features/canvas/compat/commands";

// ─── Constants ────────────────────────────────────────────────────────────

const MIN_NODE_WIDTH = 360;
const MAX_NODE_WIDTH = 680;
const MIN_NODE_HEIGHT = 400;
const MAX_NODE_HEIGHT = 900;
const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 600;

const POLL_INTERVAL = 2000;
const MAX_POLL_TIME = 15 * 60 * 1000;

const STYLE_KEYS: StoryboardStyleType[] = ["2d-anime", "3d-cg", "live-action"];

const PROP_APPEND_PROMPT = "白色背景，纯白底";

/** Style prefixes shown in the edit textarea */
const STYLE_PREFIX: Record<StoryboardStyleType, string> = {
  "2d-anime": "2D动漫风格，，细腻线条",
  "3d-cg": "3D国漫CG风格，高精度数字建模，次世代PBR材质，影视级渲染，8K超高清",
  "live-action": "真人实拍风格，电影摄影，自然光影，真实质感，实拍画面",
};

const ALL_ASPECT_RATIOS = [
  { value: "auto", label: "自适应", icon: "□" },
  { value: "1:1", label: "1:1", icon: "□" },
  { value: "9:16", label: "9:16", icon: "▯" },
  { value: "16:9", label: "16:9", icon: "▭" },
  { value: "3:4", label: "3:4", icon: "▯" },
  { value: "4:3", label: "4:3", icon: "▭" },
  { value: "3:2", label: "3:2", icon: "▭" },
  { value: "2:3", label: "2:3", icon: "▯" },
];

const SIZE_OPTIONS = [
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

const FIELD_LABELS: Record<string, string> = {
  appearance: "外观",
  material: "材质",
  details: "细节",
};

const FIELD_KEYS = ["appearance", "material", "details"] as const;

/** Serialize a prop item to editable text format (includes style prefix & append prompt) */
function serializeProp(item: PropItem): string {
  const lines: string[] = [];
  lines.push(`风格：${STYLE_PREFIX[item.styleType]}`);
  lines.push(`名称：${item.name}`);
  for (const key of FIELD_KEYS) {
    const label = FIELD_LABELS[key];
    const value = ((item as unknown) as Record<string, string>)[key] || "";
    lines.push(`${label}：${value}`);
  }
  lines.push(PROP_APPEND_PROMPT);
  return lines.join("\n");
}

/** Parse editable text back to prop item fields */
function parsePropText(text: string): Partial<PropItem> {
  const result: Partial<PropItem> = {};
  const lines = text.split("\n");
  const reverseLabels: Record<string, string> = {};
  for (const [k, v] of Object.entries(FIELD_LABELS)) {
    reverseLabels[v] = k;
  }
  const reverseStyle: Record<string, StoryboardStyleType> = {};
  for (const [sk, prefix] of Object.entries(STYLE_PREFIX)) {
    reverseStyle[prefix] = sk as StoryboardStyleType;
  }
  for (const line of lines) {
    const match = line.match(/^(.+?)：(.*)$/);
    if (match) {
      const label = match[1];
      const value = match[2].trim();
      if (label === "名称") {
        result.name = value;
      } else if (label === "风格") {
        const matchedStyle = reverseStyle[value];
        if (matchedStyle) result.styleType = matchedStyle;
      } else if (reverseLabels[label]) {
        (result as Record<string, string>)[reverseLabels[label]] = value;
      }
    }
  }
  return result;
}

/** Build image generation prompt for a prop item */
function buildPropPrompt(item: PropItem): string {
  const styleWord = STYLE_PREFIX[item.styleType];
  const descParts: string[] = [];
  if (item.appearance) descParts.push(item.appearance);
  if (item.material) descParts.push(item.material);
  if (item.details) descParts.push(item.details);

  return `${styleWord}，${descParts.join("，")}，${PROP_APPEND_PROMPT}`;
}

// ─── PropNode Component ────────────────────────────────────────────────

export const PropNode = memo(function PropNode({ id, data, selected }: NodeProps) {
  const nodeData = data as PropNodeData;
  const addToast = useToastStore((s) => s.addToast);
  const store = useCanvasStore();

  const [nodeWidth, setNodeWidth] = useState(nodeData.width || DEFAULT_WIDTH);
  const [nodeHeight, setNodeHeight] = useState(nodeData.height || DEFAULT_HEIGHT);
  const [showParamsPanel, setShowParamsPanel] = useState(false);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState(nodeData.requestAspectRatio || "1:1");
  const [selectedSize, setSelectedSize] = useState(nodeData.size || "2K");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingStyleType, setEditingStyleType] = useState<StoryboardStyleType>("2d-anime");
  const [editDraft, setEditDraft] = useState("");
  const generateCount = nodeData.generateCount || 1;

  const selectedProviderId = nodeData.providerId || "";
  const selectedModel = nodeData.model || "";
  const { availableProviders, availableModels } = useChannelModelSelector("image", selectedProviderId);

  const updateData = useCallback(
    (patch: Partial<PropNodeData>) => {
      store.updateNodeData(id, patch);
    },
    [id, store]
  );

  const handleProviderChange = useCallback(
    (newProviderId: string) => {
      const defaultModel = getDefaultModelForProvider(newProviderId, "image");
      updateData({ providerId: newProviderId, model: defaultModel || "" });
    },
    [updateData]
  );

  const handleModelChange = useCallback(
    (newModelId: string) => {
      updateData({ model: newModelId });
    },
    [updateData]
  );

  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      setNodeWidth(result.width);
      setNodeHeight(result.height);
      updateData({ width: result.width, height: result.height });
    },
    [updateData]
  );

  const updateItem = useCallback(
    (itemId: string, patch: Partial<PropItem>) => {
      const items = [...(nodeData.items || [])];
      const idx = items.findIndex((i) => i.id === itemId);
      if (idx >= 0) {
        items[idx] = { ...items[idx], ...patch };
        updateData({ items });
      }
    },
    [nodeData.items, updateData]
  );

  // ── Polling infrastructure (same pattern as ImageEditNode) ──────────
  // ── Polling infrastructure — Promise-based for serial generation ──
  const activeJobsRef = useRef<Map<string, { timer: ReturnType<typeof setInterval>; outputNodeId: string; pollStart: number; itemId: string; itemName: string; shouldUseCredits: boolean; providerId: string }>>(new Map());

  const pollJobUntilDone = useCallback((jobId: string, outputNodeId: string, expectedDurationMs: number, ctx: {
    itemId: string; itemName: string; shouldUseCredits: boolean; providerId: string;
  }): Promise<void> => {
    return new Promise<void>((resolve) => {
      const pollStart = Date.now();
      let pollErrors = 0;
      const forceTimeout = Math.max(expectedDurationMs * 3, 3 * 60 * 1000);
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;

      const poll = async () => {
        if (stopped) return;
        try {
          if (Date.now() - pollStart > forceTimeout) {
            stopped = true; activeJobsRef.current.delete(jobId);
            useCanvasStore.getState().updateNodeData(outputNodeId, { isGenerating: false, generationError: "图片生成超时" });
            updateItem(ctx.itemId, { isGenerating: false }); addToast("error", "图片生成超时，请重试");
            if (ctx.shouldUseCredits) tauriAiGateway.refundImageCredits(jobId, ctx.providerId); resolve(); return;
          }
          if (Date.now() - pollStart > MAX_POLL_TIME) {
            stopped = true; activeJobsRef.current.delete(jobId);
            useCanvasStore.getState().updateNodeData(outputNodeId, { isGenerating: false, generationError: "图片生成超时（15分钟）" });
            updateItem(ctx.itemId, { isGenerating: false }); addToast("error", "图片生成超时（15分钟），请重试");
            if (ctx.shouldUseCredits) tauriAiGateway.refundImageCredits(jobId, ctx.providerId); resolve(); return;
          }
          const status = await tauriAiGateway.getGenerateImageJob(jobId);
          pollErrors = 0;

          if (status.progress !== undefined && status.progress >= 0) {
            updateItem(ctx.itemId, { progressPercent: Math.round(status.progress) } as any);
            useCanvasStore.getState().updateNodeData(outputNodeId, { progressPercent: Math.round(status.progress) } as any);
          }

          if (status.result) {
            stopped = true; activeJobsRef.current.delete(jobId);
            updateItem(ctx.itemId, { imageUrl: status.result, isGenerating: false, progressPercent: 0 } as any);
            const cs = useCanvasStore.getState();
            cs.updateNodeData(outputNodeId, { imageUrl: status.result, displayName: ctx.itemName, isGenerating: false, generationError: undefined });
            (async () => { try { let p = status.result!; if (p.startsWith("data:") || p.startsWith("http")) { try { const lp = await persistImageSource(p) as string; if (lp && lp !== p) { updateItem(ctx.itemId, { imageUrl: lp } as any); cs.updateNodeData(outputNodeId, { imageUrl: lp }); p = lp; } } catch (e) { console.error("[道具节点] 图片持久化失败:", e); } } try { const prep = await prepareNodeImageSource(p, 0) as any; cs.updateNodeData(outputNodeId, { imageWidth: prep.width, imageHeight: prep.height }); } catch (e) { console.error("[道具节点] 预览尺寸解析失败:", e); } } catch (e) { console.error("[道具节点] 结果回调失败:", e); } })();
            resolve(); return;
          }

          if (status.status === "succeeded") {
            stopped = true; activeJobsRef.current.delete(jobId);
            updateItem(ctx.itemId, { isGenerating: false });
            useCanvasStore.getState().updateNodeData(outputNodeId, { isGenerating: false, generationError: "后端返回空结果" });
            addToast("error", "生成失败：后端返回空结果");
            if (ctx.shouldUseCredits) tauriAiGateway.refundImageCredits(jobId, ctx.providerId); resolve();
          } else if (status.status === "failed") {
            stopped = true; activeJobsRef.current.delete(jobId);
            updateItem(ctx.itemId, { isGenerating: false });
            const errorMsg = status.error || "未知错误";
            useCanvasStore.getState().updateNodeData(outputNodeId, { isGenerating: false, generationError: errorMsg });
            addToast("error", `生成失败: ${errorMsg}`);
            if (ctx.shouldUseCredits) tauriAiGateway.refundImageCredits(jobId, ctx.providerId); resolve();
          } else {
            if (!stopped) timeoutId = setTimeout(poll, POLL_INTERVAL);
          }
        } catch (e) {
          pollErrors++;
          if (pollErrors >= 5) {
            stopped = true; activeJobsRef.current.delete(jobId);
            updateItem(ctx.itemId, { isGenerating: false });
            const errMsg = e instanceof Error ? e.message : String(e);
            useCanvasStore.getState().updateNodeData(outputNodeId, { isGenerating: false, generationError: errMsg || "轮询出错过多，已停止" });
            if (ctx.shouldUseCredits) tauriAiGateway.refundImageCredits(jobId, ctx.providerId); resolve();
          } else {
            if (!stopped) timeoutId = setTimeout(poll, POLL_INTERVAL);
          }
        }
      };
      timeoutId = setTimeout(poll, 0);
      activeJobsRef.current.set(jobId, { timer: timeoutId as any, outputNodeId, pollStart, ...ctx });
    });
  }, [updateItem, addToast]);

  useEffect(() => {
    return () => { activeJobsRef.current.forEach((j) => clearTimeout(j.timer)); activeJobsRef.current.clear(); };
  }, []);

  // ── Listen for real-time progress events from Rust ──
  useEffect(() => {
    let unlisten1: (() => void) | undefined;
    let unlisten2: (() => void) | undefined;
    import("@/features/canvas/compat/event").then(({ listen }) => {
      listen<{ jobId: string; progress: number }>("generation-progress", (event) => {
        const { jobId, progress } = event.payload;
        const jobEntry = activeJobsRef.current.get(jobId);
        if (jobEntry && progress >= 0) {
          updateItem(jobEntry.itemId, { progressPercent: Math.round(progress) } as any);
          const cs = useCanvasStore.getState();
          cs.updateNodeData(jobEntry.outputNodeId, { progressPercent: Math.round(progress) } as any);
        }
      }).then((fn) => { unlisten1 = fn; });

      listen<{ percent: number; stage: string; message: string }>("jimeng-browser-progress", (event) => {
        const { percent } = event.payload;
        const items = nodeData.items || [];
        items.forEach((item) => {
          if (item.isGenerating && percent >= 0) {
            updateItem(item.id, { progressPercent: Math.round(percent) } as any);
          }
        });
      }).then((fn) => { unlisten2 = fn; });
    });
    return () => { unlisten1?.(); unlisten2?.(); };
  }, [updateItem, nodeData.items]);

  const deleteItem = useCallback(
    (itemId: string) => {
      updateData({ items: (nodeData.items || []).filter((i) => i.id !== itemId) });
    },
    [nodeData.items, updateData]
  );

  const addItem = useCallback(() => {
    const newItem: PropItem = {
      id: crypto.randomUUID(),
      name: "新道具",
      appearance: "",
      material: "",
      details: "",
      styleType: "2d-anime",
      imageUrl: null,
      isGenerating: false,
    };
    updateData({ items: [...(nodeData.items || []), newItem] });
  }, [nodeData.items, updateData]);

  const startEdit = useCallback((item: PropItem) => {
    setEditingStyleType(item.styleType);
    // Use rawText if available (preserves user formatting), otherwise serialize
    setEditDraft(item.rawText || serializeProp(item));
    setEditingItemId(item.id);
  }, []);

  /** Handle style button click while editing — replace style prefix line in textarea */
  const handleStyleChangeInEdit = useCallback((newStyle: StoryboardStyleType) => {
    setEditingStyleType(newStyle);
    setEditDraft((prev) => {
      const newPrefix = STYLE_PREFIX[newStyle];
      return prev.replace(/^风格：.*$/m, `风格：${newPrefix}`);
    });
  }, []);

  const commitEdit = useCallback(() => {
    if (editingItemId) {
      const parsed = parsePropText(editDraft);
      parsed.styleType = editingStyleType;
      // Preserve the raw text so next edit keeps user formatting
      parsed.rawText = editDraft;
      updateItem(editingItemId, parsed);
    }
    setEditingItemId(null);
    setEditDraft("");
  }, [editingItemId, editDraft, editingStyleType, updateItem]);

  const cancelEdit = useCallback(() => {
    setEditingItemId(null);
    setEditDraft("");
  }, []);

  const handleGenerateSingle = useCallback(
    async (item: PropItem) => {
      if (item.isGenerating) return;

      // Find provider credentials — look up the channel provider directly (grsai)
      const settings = useSettingsStore.getState();
      const effectiveProviderId = selectedProviderId || "grsai";
      // Direct lookup: find the provider whose id matches the channel (e.g. "grsai")
      let providerConfig = settings.providers.find((p) => p.id === effectiveProviderId && p.apiKey);
      // Fallback: check if image-model virtual provider has the channel configured
      if (!providerConfig) {
        const imageModel = settings.providers.find((p) => p.id === "image-model");
        if (imageModel?.apiKey && (imageModel.channel === effectiveProviderId || !imageModel.channel)) {
          providerConfig = imageModel;
        }
      }
      // Fallback: check custom providers
      if (!providerConfig?.apiKey) {
        const cp = settings.customProviders.find((p) => p.id === effectiveProviderId);
        if (cp?.apiKey) {
          providerConfig = { id: cp.id, apiKey: cp.apiKey, baseUrl: cp.baseUrl, modelName: "" } as any;
        }
      }
      const creditsEnabled = settings.creditsEnabled;
      if (!providerConfig?.apiKey && !creditsEnabled) {
        addToast("warning", "请先在画布设置中配置虾客漫图片模型 API 密钥");
        return;
      }

      // Strip provider prefix from model if present (moved before credit check)
      const rawModel = selectedModel || providerConfig?.modelName || "gpt-image-2";
      const effectiveModel = rawModel.includes("/") ? rawModel.split("/").pop()! : rawModel;

      // 积分扣费已在 tauriAiGateway.submitGenerateImageJob 中统一处理
      // 退费也统一用 tauriAiGateway.refundImageCredits
      const isCustomProvider = effectiveProviderId.startsWith("custom-");
      const shouldUseCredits = creditsEnabled && !isCustomProvider;

      const aspectRatio = selectedAspectRatio === "auto" ? "1:1" : selectedAspectRatio;
      const prompt = buildPropPrompt(item);

      updateItem(item.id, { isGenerating: true, imageUrl: null });

      // Create output node FIRST (like ImageEditNode) — shows "生成中…" immediately
      const canvasStore = useCanvasStore.getState();
      const currentNode = canvasStore.nodes.find((n) => n.id === id);
      const nodeX = currentNode?.position.x ?? 0;
      const nodeY = currentNode?.position.y ?? 0;
      const outputNodeId = `uploadNode-${crypto.randomUUID()}`;
      const outputNode: Node = {
        id: outputNodeId,
        type: CANVAS_NODE_TYPES.upload,
        position: { x: nodeX + nodeWidth + 40, y: nodeY },
        data: {
          displayName: `${item.name || "道具图"} — 生成中…`,
          imageUrl: null,
          previewImageUrl: null,
          aspectRatio,
          isSizeManuallyAdjusted: false,
          sourceFileName: null,
          isGenerating: true,
          generationStartedAt: Date.now(),
          expectedDurationMs: 90000,
        },
      };
      canvasStore.addNode(outputNode);
      canvasStore.addEdge({
        id: `edge-${id}-${outputNodeId}`,
        source: id,
        target: outputNodeId,
        type: "dataFlow",
      });

      try {
        // ── Submit as async job (same as ImageEditNode) ──
        const jobId = await tauriAiGateway.submitGenerateImageJob({
          model: `${effectiveProviderId}/${effectiveModel}`,
          prompt,
          size: selectedSize as ImageSize,
          aspectRatio,
          extraParams: { aspectRatio, imageSize: selectedSize },
        });

        // Wait for job to complete (serial mode for handleGenerateAll)
        await pollJobUntilDone(jobId, outputNodeId, 90000, {
          itemId: item.id,
          itemName: item.name || "道具图",
          shouldUseCredits,
          providerId: effectiveProviderId,
        });
      } catch (err) {
        updateItem(item.id, { isGenerating: false });
        canvasStore.updateNodeData(outputNodeId, { isGenerating: false, generationError: `提交失败: ${err}` });
        addToast("error", `图片生成提交失败: ${err}`);
      }
    },
    [selectedProviderId, selectedModel, selectedAspectRatio, selectedSize, updateItem, addToast, pollJobUntilDone]
  );

  const handleGenerateAll = useCallback(async () => {
    const items = nodeData.items || [];
    const toGenerate = items.filter((item: any) => !item.isGenerating && !item.imageUrl);
    if (toGenerate.length === 0) return;
    // Batch submissions (3 at a time) to avoid API rate limits
    const BATCH_SIZE = 3;
    for (let i = 0; i < toGenerate.length; i += BATCH_SIZE) {
      const batch = toGenerate.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((item: any) => handleGenerateSingle(item)));
    }
  }, [nodeData.items, handleGenerateSingle]);

  // Reset stuck isGenerating items on mount (in case previous session crashed mid-generation)
  useEffect(() => {
    const items = nodeData.items || [];
    items.forEach((item) => {
      if (item.isGenerating) {
        updateItem(item.id, { isGenerating: false });
      }
    });
  }, []);

  const items = nodeData.items || [];

  return (
    <>
      <NodeDeleteButton id={id} selected={selected ?? false} />
      <div style={{ position: "relative" }}>
        <div
          className="node-inner"
          style={{
            backgroundColor: "var(--bg-node)",
            border: "1px solid var(--border)",
            borderRadius: "var(--node-radius)",
            width: nodeWidth,
            height: nodeHeight,
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
            maxHeight: "75vh",
            boxShadow: "0 2px 12px rgba(0,0,0,.3)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between shrink-0"
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div className="flex items-center gap-2">
              <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>
                🎒 道具要素
              </span>
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--text-muted)",
                  backgroundColor: "var(--bg-surface)",
                  padding: "1px 6px",
                  borderRadius: "4px",
                }}
              >
                {items.length} 道具
              </span>
            </div>
          </div>

          {/* Card list */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "8px 10px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              minHeight: 0,
            }}
          >
            {items.map((item) => (
              <div
                key={item.id}
                style={{
                  backgroundColor: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "10px 12px",
                }}
              >
                {editingItemId === item.id ? (
                  // ─── Edit Mode ───
                  <div>
                    {/* Style buttons in edit mode */}
                    <div className="flex items-center gap-1 nodrag" style={{ marginBottom: "6px" }}>
                      {STYLE_KEYS.map((sk) => (
                        <button
                          key={sk}
                          onClick={() => handleStyleChangeInEdit(sk)}
                          style={{
                            padding: "2px 8px",
                            borderRadius: "4px",
                            border: editingStyleType === sk ? "2px solid var(--accent-btn)" : "1px solid var(--border)",
                            backgroundColor: editingStyleType === sk ? "var(--bg-hover)" : "transparent",
                            color: editingStyleType === sk ? "var(--accent-btn)" : "var(--text-muted)",
                            fontSize: "11px",
                            cursor: "pointer",
                            transition: "all 0.15s",
                            fontWeight: editingStyleType === sk ? 600 : 400,
                          }}
                        >
                          {STORYBOARD_STYLE_LABELS[sk]}
                        </button>
                      ))}
                    </div>
                    <textarea
                      className="nodrag nowheel"
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      autoFocus
                      style={{
                        width: "100%",
                        minHeight: "100px",
                        backgroundColor: "var(--bg-node)",
                        border: "1px solid var(--accent-btn)",
                        borderRadius: "6px",
                        padding: "8px 10px",
                        fontSize: "12px",
                        color: "var(--text-primary)",
                        outline: "none",
                        resize: "vertical",
                        lineHeight: "1.6",
                        boxSizing: "border-box",
                        fontFamily: "inherit",
                      }}
                    />
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 4 }}>
                      <PromptAssistantButton
                        currentPrompt={editDraft}
                        selectedProviderId={selectedProviderId}
                        onApply={(v) => setEditDraft(v)}
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2" style={{ marginTop: "8px" }}>
                      <button
                        className="nodrag"
                        onClick={cancelEdit}
                        style={{
                          padding: "4px 12px",
                          borderRadius: "4px",
                          border: "1px solid var(--border)",
                          backgroundColor: "transparent",
                          color: "var(--text-muted)",
                          fontSize: "11px",
                          cursor: "pointer",
                        }}
                      >
                        取消
                      </button>
                      <button
                        className="nodrag"
                        onClick={commitEdit}
                        style={{
                          padding: "4px 12px",
                          borderRadius: "4px",
                          border: "none",
                          backgroundColor: "var(--accent-btn)",
                          color: "#fff",
                          fontSize: "11px",
                          cursor: "pointer",
                        }}
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  // ─── View Mode ───
                  <>
                    {/* Card header: name + 白底 tag + style */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <div className="flex items-center gap-2" style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>
                          {item.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 nodrag" style={{ flexShrink: 0 }}>
                        {STYLE_KEYS.map((sk) => (
                          <button
                            key={sk}
                            onClick={() => {
                              const patch: Partial<PropItem> = { styleType: sk };
                              if (item.rawText) {
                                patch.rawText = item.rawText.replace(/^风格：.*$/m, `风格：${STYLE_PREFIX[sk]}`);
                              }
                              updateItem(item.id, patch);
                            }}
                            style={{
                              padding: "2px 6px",
                              borderRadius: "4px",
                              border: item.styleType === sk ? "1px solid var(--accent-btn)" : "1px solid var(--border)",
                              backgroundColor: item.styleType === sk ? "var(--bg-hover)" : "transparent",
                              color: item.styleType === sk ? "var(--accent-btn)" : "var(--text-muted)",
                              fontSize: "10px",
                              cursor: "pointer",
                              transition: "all 0.15s",
                            }}
                          >
                            {STORYBOARD_STYLE_LABELS[sk]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Description fields (read-only display) */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                      {FIELD_KEYS.map((key) => {
                        const value = ((item as unknown) as Record<string, string>)[key];
                        if (!value) return null;
                        return (
                          <div key={key} style={{ display: "flex", gap: "6px", alignItems: "flex-start" }}>
                            <span style={{ color: "var(--text-muted)", fontSize: "11px", minWidth: "32px", flexShrink: 0 }}>
                              {FIELD_LABELS[key]}
                            </span>
                            <span style={{ fontSize: "11px", color: "var(--text-primary)", lineHeight: "1.4", flex: 1 }}>
                              {value}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Action bar */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px", marginTop: "8px" }}>
                      <button
                        className="nodrag"
                        onClick={() => startEdit(item)}
                        style={{
                          padding: "3px 10px",
                          borderRadius: "4px",
                          border: "1px solid var(--border)",
                          backgroundColor: "transparent",
                          color: "var(--text-secondary)",
                          fontSize: "11px",
                          cursor: "pointer",
                          transition: "all 0.15s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent-btn)"; e.currentTarget.style.color = "var(--accent-btn)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                      >
                        编辑
                      </button>
                      <button
                        className="nodrag"
                        onClick={() => handleGenerateSingle(item)}
                        style={{
                          padding: "4px 12px",
                          borderRadius: "6px",
                          backgroundColor: item.isGenerating ? "var(--bg-hover)" : "var(--accent-btn)",
                          color: item.isGenerating ? "var(--text-muted)" : "#fff",
                          border: "none",
                          fontSize: "11px",
                          cursor: "pointer",
                          transition: "all 0.15s",
                        }}
                      >
                        {item.isGenerating ? ((item.progressPercent ?? 0) > 0 ? `生成中 ${item.progressPercent}%` : "生成中…") : "生图"}
                      </button>
                      <button
                        className="nodrag"
                        onClick={() => deleteItem(item.id)}
                        style={{
                          padding: "4px 6px",
                          borderRadius: "4px",
                          border: "none",
                          backgroundColor: "transparent",
                          color: "var(--text-muted)",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-text-danger, #f44)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
                      >
                        x
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}

            {/* Add button */}
            <button
              className="nodrag"
              onClick={addItem}
              style={{
                padding: "8px",
                borderRadius: "8px",
                border: "1px dashed var(--accent-btn)",
                backgroundColor: "transparent",
                color: "var(--accent-btn)",
                fontSize: "12px",
                cursor: "pointer",
                transition: "background-color 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              + 添加道具
            </button>
          </div>

          {/* Bottom toolbar */}
          <div
            className="shrink-0"
            style={{
              padding: "8px 12px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div className="flex items-center gap-3" style={{ flex: 1, minWidth: 0 }}>
              <ChannelModelSelector
                selectedProviderId={selectedProviderId}
                selectedModelId={selectedModel}
                availableProviders={availableProviders}
                availableModels={availableModels.map((m) => ({ id: m.id, label: m.label || m.id, providerId: m.providerId }))}
                onProviderChange={handleProviderChange}
                onModelChange={handleModelChange}
              />
              {/* ── 云智通道价格标签 ── */}
              {selectedProviderId === "yunzhi" && (() => {
                const modelShort = selectedModel.includes("/") ? selectedModel.split("/")[1] : selectedModel;
                const pricePerImage = IMAGE_CREDIT_PRICES[modelShort] || 30;
                const priceYuan = (pricePerImage / 100).toFixed(1);
                return <span className="nodrag" style={{ fontSize: '11px', color: '#7ab4f0', fontWeight: 500, flexShrink: 0, whiteSpace: 'nowrap' }}>{priceYuan}元/张</span>;
              })()}
              <StylePresetSelector
                currentPreset={{
                  providerId: selectedProviderId,
                  modelId: selectedModel,
                  aspectRatio: selectedAspectRatio,
                  imageSize: selectedSize,
                  nodeType: "image",
                }}
                onApply={(preset) => {
                  handleProviderChange(preset.providerId);
                  handleModelChange(preset.modelId);
                  if (preset.aspectRatio) setSelectedAspectRatio(preset.aspectRatio);
                  if (preset.imageSize) setSelectedSize(preset.imageSize as any);
                }}
                nodeType="image"
              />
              <div
                className="flex items-center gap-1 relative nodrag"
                style={{ color: "var(--text-secondary)", fontSize: "12px", cursor: "pointer" }}
                onClick={() => setShowParamsPanel(!showParamsPanel)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                </svg>
                <span>{selectedAspectRatio} · {selectedSize}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="flex items-center gap-1 relative nodrag"
                style={{ color: "var(--text-muted)", fontSize: "12px", cursor: "pointer" }}
              >
                <span>{generateCount}张</span>
              </div>
              <button
                className="nodrag"
                onClick={handleGenerateAll}
                disabled={items.length === 0}
                style={{
                  padding: "4px 12px",
                  borderRadius: "6px",
                  backgroundColor: items.length > 0 ? "var(--accent-btn)" : "var(--bg-hover)",
                  color: items.length > 0 ? "#fff" : "var(--text-muted)",
                  border: "none",
                  fontSize: "11px",
                  cursor: items.length > 0 ? "pointer" : "not-allowed",
                  transition: "all 0.15s",
                }}
              >
                全部生图
              </button>
            </div>
          </div>
        </div>

        {/* Params panel */}
        {showParamsPanel && (
          <div
            className="nodrag"
            style={{
              position: "absolute",
              bottom: 52,
              left: 140,
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              padding: "10px",
              zIndex: 50,
              width: "260px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ marginBottom: "10px" }}>
              <div style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: 500, marginBottom: "6px" }}>分辨率</div>
              <div style={{ display: "flex", gap: "4px" }}>
                {SIZE_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => { setSelectedSize(s.value); updateData({ size: s.value }); setShowParamsPanel(false); }}
                    style={{
                      flex: 1,
                      padding: "5px 8px",
                      borderRadius: "6px",
                      border: selectedSize === s.value ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                      backgroundColor: selectedSize === s.value ? "var(--bg-hover)" : "transparent",
                      color: selectedSize === s.value ? "var(--accent)" : "var(--text-secondary)",
                      fontSize: "11px",
                      cursor: "pointer",
                      transition: "all 0.2s",
                      fontWeight: selectedSize === s.value ? 500 : 400,
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: 500, marginBottom: "6px" }}>比例</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4px" }}>
                {ALL_ASPECT_RATIOS.map((ratio) => (
                  <button
                    key={ratio.value}
                    onClick={() => { setSelectedAspectRatio(ratio.value); updateData({ requestAspectRatio: ratio.value }); setShowParamsPanel(false); }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "2px",
                      padding: "5px 2px",
                      borderRadius: "6px",
                      border: selectedAspectRatio === ratio.value ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                      backgroundColor: selectedAspectRatio === ratio.value ? "var(--bg-hover)" : "transparent",
                      color: selectedAspectRatio === ratio.value ? "var(--accent)" : "var(--text-secondary)",
                      fontSize: "10px",
                      cursor: "pointer",
                      transition: "all 0.2s",
                      minHeight: "36px",
                    }}
                  >
                    <span style={{ fontSize: "12px", lineHeight: 1 }}>{ratio.icon}</span>
                    <span>{ratio.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize} minWidth={MIN_NODE_WIDTH} maxWidth={MAX_NODE_WIDTH} minHeight={MIN_NODE_HEIGHT} maxHeight={MAX_NODE_HEIGHT} />
      </div>

      <Handle type="target" position={Position.Left} className="!bg-[var(--accent-secondary)] !w-5 !h-5 !border-2 !border-[var(--bg-node)]" />
      <Handle type="source" position={Position.Right} className="!bg-[var(--accent-secondary)] !w-5 !h-5 !border-2 !border-[var(--bg-node)]" />
    </>
  );
});



