import { useState, useCallback, useEffect, useRef, memo } from "react";
import { type NodeProps, Handle, Position } from "@xyflow/react";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useSettingsStore } from "@/features/canvas/stores/settingsStore";
import { useChannelModelSelector } from "../hooks/useChannelModelSelector";
import { ChannelModelSelector } from "../ui/ChannelModelSelector";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";
import { useToastStore } from "@/features/canvas/compat/Toast";
import {
  CANVAS_NODE_TYPES,
  type NovelChapterNodeData,
  type NovelGlobalState,
  type NovelOutlineEntry,
} from "../domain/canvasNodes";
import { chatCompletionStream } from "@/features/canvas/compat/commands";

// ─── System prompts ────────────────────────────────────────────────────────

const ANALYZE_SYSTEM_PROMPT = `你是一位资深小说创作顾问。请根据提供的前文摘要、角色状态和本章大纲，进行写前分析。

要求输出：
1. 本章必须推进的情节点
2. 需要埋设或回收的伏笔
3. 角色在本章中的状态变化
4. 本章结尾必须留下的悬念钩子类型和内容
5. 与前后章节的衔接要点

用简洁的要点格式输出。`;

const WRITE_SYSTEM_PROMPT = `你是一位才华横溢的中文小说家。请根据写前分析和大纲，撰写本章正文。

核心法则：
1. 展示而非讲述——用动作和对话表现，不要直接陈述情感
2. 冲突驱动——每段必须有张力或转折
3. 每章结尾必须留下钩子——未解之谜、危机、反转、承诺至少选一
4. 开头即抓人——第一段必须吸引读者

去AI味规则（写作时直接遵守）：
- 删除重复用词和套话（"不禁"、"竟然"、"居然"等每章最多1次）
- 增加生活化细节和小动作
- 对话更口语化，减少书面语
- 增加感官描写（视觉/听觉/触觉/嗅觉）
- 长句拆短，短句有力

写作要求：
- 字数：3000-5000字
- 对话要有个性，每个角色说话方式不同
- 场景描写要有画面感
- 动作戏要有节奏感
- 内心独白要真实有层次

直接输出润色后的小说正文，不要输出任何分析或标注。`;

const UPDATE_STATE_SYSTEM_PROMPT = `你是一位小说状态追踪员。请根据已完成的章节内容，更新小说的全局状态。

输出JSON格式：
{
  "globalSummary": "全书摘要（包含最新章节的进展）",
  "characterState": "所有角色当前状态（位置、心理、关系变化）",
  "plotArcs": "情节线进展追踪",
  "foreshadowing": "伏笔追踪（列出已埋/已收/未收的伏笔）"
}

只输出JSON，不要输出其他内容。`;

// ─── Phase labels ──────────────────────────────────────────────────────────

const PHASE_LABELS: Record<string, string> = {
  idle: "",
  analyzing: "写前分析...",
  writing: "撰写正文...",
  done: "生成完成",
};

// ─── Component ─────────────────────────────────────────────────────────────

export const NovelChapterNode = memo(function NovelChapterNode({
  data,
  id,
  selected,
}: NodeProps) {
  const nodeData = data as unknown as NovelChapterNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const { addToast } = useToastStore();

  const [chapterNo, setChapterNo] = useState(nodeData.chapterNo || 1);
  const [chapterTitle, setChapterTitle] = useState(nodeData.chapterTitle || "");
  const [writingGuide, setWritingGuide] = useState(nodeData.writingGuide || "");
  const [content, setContent] = useState(nodeData.content || "");
  const [isFinalized, setIsFinalized] = useState(nodeData.isFinalized || false);
  const [globalState, setGlobalState] = useState<NovelGlobalState | null>(
    nodeData.globalState || null
  );
  const [isGenerating, setIsGenerating] = useState(nodeData.isGenerating || false);
  const [generationPhase, setGenerationPhase] = useState(
    nodeData.generationPhase || "idle"
  );
  const [editMode, setEditMode] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // ── Chat channel state ──
  const chatModelProvider = useSettingsStore((s) =>
    s.providers.find((p) => p.id === "chat-model")
  );
  const chatChannelId = chatModelProvider?.channel || "";
  const [selectedProviderId, setSelectedProviderId] = useState(
    nodeData.providerId || chatChannelId || ""
  );
  const [selectedModel, setSelectedModel] = useState(nodeData.model || "");

  const { availableProviders, availableModels, getDefaultModel } =
    useChannelModelSelector("chat", selectedProviderId);

  // 积分价格显示
  const handleProviderChange = useCallback(
    (providerId: string) => {
      setSelectedProviderId(providerId);
      const defaultModel = getDefaultModel(providerId);
      if (defaultModel) setSelectedModel(defaultModel);
      updateNodeData(id, { providerId, provider: providerId, model: defaultModel });
    },
    [id, updateNodeData, getDefaultModel]
  );

  const handleModelChange = useCallback(
    (modelId: string) => {
      setSelectedModel(modelId);
      updateNodeData(id, { model: modelId, providerId: selectedProviderId });
    },
    [id, updateNodeData, selectedProviderId]
  );

  // ── Get outline from novel node ──
  const getOutline = useCallback((): NovelOutlineEntry[] => {
    const canvasState = useCanvasStore.getState();
    const novelNode = canvasState.nodes.find(
      (n) => n.type === CANVAS_NODE_TYPES.novel
    );
    return (novelNode?.data as any)?.outline || [];
  }, []);

  // ── Get settings from novel node ──
  const getSettings = useCallback((): {
    premise: string;
    generatedSettings: string;
    characters: any[];
  } => {
    const canvasState = useCanvasStore.getState();
    const novelNode = canvasState.nodes.find(
      (n) => n.type === CANVAS_NODE_TYPES.novel
    );
    const d = (novelNode?.data as any) || {};
    return {
      premise: d.premise || "",
      generatedSettings: d.generatedSettings || "",
      characters: d.characters || [],
    };
  }, []);

  // ── Sync ──
  useEffect(() => {
    updateNodeData(id, {
      chapterNo,
      chapterTitle,
      writingGuide,
      content,
      isFinalized,
      globalState,
      isGenerating,
      generationPhase,
      providerId: selectedProviderId,
      model: selectedModel,
    });
  }, [
    chapterNo, chapterTitle, writingGuide, content, isFinalized,
    globalState, isGenerating, generationPhase, id, updateNodeData,
  ]);

  // ── Provider lookup ──
  const getProviderConfig = useCallback(() => {
    const settings = useSettingsStore.getState();
    const allProviders = settings.providers;
    const effectiveProviderId = selectedProviderId || "grsai";
    let providerConfig = allProviders.find(
      (p) => p.id === effectiveProviderId && p.apiKey
    );
    if (!providerConfig) {
      const chatModel = allProviders.find((p) => p.id === "chat-model");
      if (
        chatModel?.apiKey &&
        (chatModel.channel === effectiveProviderId || !chatModel.channel)
      ) {
        providerConfig = chatModel;
      }
    }
    // Fallback: check custom providers
    if (!providerConfig?.apiKey) {
      const cp = settings.customProviders.find((p) => p.id === effectiveProviderId);
      if (cp?.apiKey) {
        providerConfig = { id: cp.id, apiKey: cp.apiKey, baseUrl: cp.baseUrl, modelName: "" } as any;
      }
    }
    if (!providerConfig) {
      providerConfig = allProviders.find((p) => p.id === effectiveProviderId);
    }
    if (!providerConfig) {
      providerConfig = allProviders.find((p) => p.id === "chat-model");
    }
    return providerConfig;
  }, [selectedProviderId]);

  // ── Get previous global state ──
  const getPrevGlobalState = useCallback((): NovelGlobalState | null => {
    const canvasState = useCanvasStore.getState();
    let prevGlobalState: NovelGlobalState | null = null;
    let prevChapterNo = 0;
    canvasState.nodes.forEach((n) => {
      if (n.type === CANVAS_NODE_TYPES.novelChapter && n.id !== id) {
        const nd = n.data as any;
        if (nd.globalState && nd.isFinalized && typeof nd.chapterNo === "number") {
          if (nd.chapterNo < chapterNo && nd.chapterNo >= prevChapterNo) {
            prevGlobalState = nd.globalState as NovelGlobalState;
            prevChapterNo = nd.chapterNo;
          }
        }
      }
    });
    return prevGlobalState;
  }, [chapterNo, id]);

  // ── Chapter selection handler ──
  const handleChapterSelect = useCallback(
    (no: number) => {
      setChapterNo(no);
      const outline = getOutline();
      const entry = outline.find((e) => e.chapterNo === no);
      if (entry) {
        setChapterTitle(entry.title);
      }
      setIsFinalized(false);
      setContent("");
    },
    [getOutline]
  );

  // ── Step 1: Analyze ──
  const doAnalyze = useCallback(
    async (providerConfig: any) => {
      setGenerationPhase("analyzing");

      const settings = getSettings();
      const prevGlobalState = getPrevGlobalState();
      const outline = getOutline();
      const chapterOutline = outline.find((e) => e.chapterNo === chapterNo);

      const parts: string[] = [];
      if (settings.premise) parts.push(`【小说概述】\n${settings.premise}`);
      if (settings.generatedSettings) {
        parts.push(`【设定摘要】\n${settings.generatedSettings.substring(0, 2000)}`);
      }
      if (settings.characters.length > 0) {
        parts.push(
          `【角色】\n${settings.characters
            .map((c: any) => `${c.name}(${c.role}): ${c.personality}`)
            .join("\n")}`
        );
      }
      if (prevGlobalState) {
        parts.push(`【前文摘要】\n${prevGlobalState.globalSummary}`);
        parts.push(`【角色状态】\n${prevGlobalState.characterState}`);
        parts.push(`【伏笔追踪】\n${prevGlobalState.foreshadowing}`);
      }
      if (chapterOutline) {
        parts.push(
          `【本章大纲】\n标题：${chapterOutline.title}\n冲突：${chapterOutline.conflict}\n关键事件：${chapterOutline.keyEvents}\n伏笔：${chapterOutline.foreshadowing}\n视角：${chapterOutline.perspective}`
        );
      }
      if (writingGuide) {
        parts.push(`【写作指导】\n${writingGuide}`);
      }

      let result = "";
      await chatCompletionStream(
        {
          baseUrl: providerConfig.baseUrl,
          apiKey: providerConfig.apiKey,
          model: selectedModel,
          messages: [
            { role: "system", content: ANALYZE_SYSTEM_PROMPT },
            { role: "user", content: parts.join("\n\n") },
          ],
          temperature: 0.5,
          maxTokens: 2048,
        },
        (delta) => {
          result += delta;
        },
        abortRef.current!.signal
      );

      return result;
    },
    [chapterNo, selectedModel, writingGuide, getSettings, getPrevGlobalState, getOutline]
  );

  // ── Step 2: Write ──
  const doWrite = useCallback(
    async (providerConfig: any, analysis: string) => {
      setGenerationPhase("writing");

      const settings = getSettings();
      const outline = getOutline();
      const chapterOutline = outline.find((e) => e.chapterNo === chapterNo);

      const parts: string[] = [];
      if (settings.generatedSettings) {
        parts.push(`【小说设定摘要】\n${settings.generatedSettings.substring(0, 2000)}`);
      }
      if (settings.characters.length > 0) {
        parts.push(
          `【角色】\n${settings.characters
            .map((c: any) => `${c.name}(${c.role}): ${c.personality}`)
            .join("\n")}`
        );
      }
      parts.push(`【写前分析】\n${analysis}`);
      if (chapterOutline) {
        parts.push(`【本章大纲】${chapterOutline.title} — ${chapterOutline.conflict} — ${chapterOutline.keyEvents}`);
      }
      if (writingGuide) {
        parts.push(`【额外指导】${writingGuide}`);
      }

      let chapterContent = "";
      await chatCompletionStream(
        {
          baseUrl: providerConfig.baseUrl,
          apiKey: providerConfig.apiKey,
          model: selectedModel,
          messages: [
            { role: "system", content: WRITE_SYSTEM_PROMPT },
            { role: "user", content: parts.join("\n\n") },
          ],
          temperature: 0.85,
          maxTokens: 8192,
        },
        (delta) => {
          chapterContent += delta;
          setContent(chapterContent);
        },
        abortRef.current!.signal
      );

      return chapterContent;
    },
    [chapterNo, selectedModel, writingGuide, getSettings, getOutline]
  );

  // ── Full generation pipeline (2 steps) ──
  const handleGenerate = useCallback(async () => {
    const providerConfig = getProviderConfig();
    const creditsEnabled = useSettingsStore.getState().creditsEnabled;
    if (!creditsEnabled && (!providerConfig?.apiKey || !providerConfig?.baseUrl)) {
      addToast("warning", "请先在设置中配置对话模型 API");
      return;
    }

    const outline = getOutline();
    if (outline.length === 0) {
      addToast("warning", "请先在小说节点中生成目录");
      return;
    }

    setIsGenerating(true);
    setIsFinalized(false);
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      // Step 1: Analyze
      const analysis = await doAnalyze(providerConfig);

      // Step 2: Write (includes polish rules in prompt)
      const finalContent = await doWrite(providerConfig, analysis);

      // Auto-update global state
      await updateGlobalState(providerConfig, finalContent);

      setGenerationPhase("done");
      addToast("success", `第${chapterNo}章生成完成`);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        addToast("error", `生成失败: ${err?.message || err}`);
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [chapterNo, getProviderConfig, getOutline, doAnalyze, doWrite, addToast]);

  // ── Auto-update global state after generation ──
  const updateGlobalState = useCallback(
    async (providerConfig: any, finalContent: string) => {
      if (!finalContent.trim()) return;

      const prevGlobalState = getPrevGlobalState();
      const prevSummary = prevGlobalState?.globalSummary || "（这是第一章）";

      try {
        let result = "";
        await chatCompletionStream(
          {
            baseUrl: providerConfig.baseUrl,
            apiKey: providerConfig.apiKey,
            model: selectedModel,
            messages: [
              { role: "system", content: UPDATE_STATE_SYSTEM_PROMPT },
              {
                role: "user",
                content: `前文摘要：${prevSummary}\n\n最新章节（第${chapterNo}章 ${chapterTitle}）：\n${finalContent.substring(0, 3000)}`,
              },
            ],
            temperature: 0.3,
            maxTokens: 2048,
          },
          (delta) => {
            result += delta;
          },
          undefined
        );

        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const newState: NovelGlobalState = {
            globalSummary: parsed.globalSummary || "",
            characterState: parsed.characterState || "",
            plotArcs: parsed.plotArcs || "",
            foreshadowing: parsed.foreshadowing || "",
          };
          setGlobalState(newState);
        }

        setIsFinalized(true);
      } catch {
        // Silently fail — global state update is not critical
      }
    },
    [chapterNo, chapterTitle, selectedModel, getPrevGlobalState]
  );

  // ── Cancel ──
  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsGenerating(false);
    setGenerationPhase("idle");
  }, []);

  const nodeWidth = nodeData.width || 480;
  const wordCount = content.length;
  const outline = getOutline();

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
                ✍️ 第{chapterNo}章 {chapterTitle || "—"}
              </span>
              {isFinalized && (
                <span
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "#60d090",
                    color: "#fff",
                  }}
                >
                  已完成
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <ChannelModelSelector
                availableProviders={availableProviders}
                availableModels={availableModels}
                selectedProviderId={selectedProviderId}
                selectedModelId={selectedModel}
                onProviderChange={handleProviderChange}
                onModelChange={handleModelChange}
              />
            </div>
          </div>

          {/* Chapter selection dropdown */}
          <div
            style={{
              padding: "8px 14px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>选择章节</span>
            <select
              className="nodrag"
              value={chapterNo}
              onChange={(e) => handleChapterSelect(parseInt(e.target.value))}
              style={{
                flex: 1,
                backgroundColor: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "4px 8px",
                color: "var(--text-primary)",
                fontSize: 12,
                outline: "none",
              }}
            >
              {outline.length > 0 ? (
                outline.map((entry) => (
                  <option key={entry.chapterNo} value={entry.chapterNo}>
                    第{entry.chapterNo}章 {entry.title}
                  </option>
                ))
              ) : (
                <option value={1}>请先在小说节点生成目录</option>
              )}
            </select>
          </div>

          {/* Writing guide */}
          <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>
              写作指导（可选）
            </div>
            <textarea
              className="nodrag nowheel"
              value={writingGuide}
              onChange={(e) => setWritingGuide(e.target.value)}
              placeholder="如：本章侧重心理描写，节奏放缓，结尾留反转..."
              rows={2}
              style={{
                width: "100%",
                backgroundColor: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "6px 8px",
                color: "var(--text-primary)",
                fontSize: 12,
                resize: "none",
                outline: "none",
              }}
            />
          </div>

          {/* Generation phase indicator */}
          {isGenerating && (
            <div
              className="shrink-0"
              style={{
                padding: "6px 14px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--accent-btn)",
                  animation: "pulse 1s ease-in-out infinite",
                }}
              />
              <span style={{ fontSize: 11, color: "var(--accent-btn)" }}>
                {PHASE_LABELS[generationPhase] || "处理中..."}
              </span>
              <button
                className="nodrag"
                onClick={handleCancel}
                style={{
                  marginLeft: "auto",
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-muted)",
                  fontSize: 10,
                  cursor: "pointer",
                }}
              >
                取消
              </button>
            </div>
          )}

          {/* Chapter content */}
          {content && (
            <div
              style={{
                padding: "8px 14px",
                borderBottom: "1px solid var(--border)",
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 500 }}>正文</span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  {wordCount} 字
                  {wordCount < 3000 && " (建议>=3000字)"}
                </span>
                <button
                  className="nodrag"
                  onClick={() => setEditMode(!editMode)}
                  style={{
                    marginLeft: "auto",
                    padding: "2px 8px",
                    borderRadius: 4,
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--text-muted)",
                    fontSize: 10,
                    cursor: "pointer",
                  }}
                >
                  {editMode ? "完成" : "编辑"}
                </button>
              </div>
              {editMode ? (
                <textarea
                  className="nodrag nowheel"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={15}
                  style={{
                    width: "100%",
                    backgroundColor: "var(--bg-surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "8px",
                    color: "var(--text-primary)",
                    fontSize: 12,
                    lineHeight: 1.8,
                    resize: "vertical",
                    outline: "none",
                    flex: 1,
                  }}
                />
              ) : (
                <div
                  style={{
                    flex: 1,
                    overflowY: "auto",
                    backgroundColor: "var(--bg-surface)",
                    borderRadius: 6,
                    padding: "8px",
                    fontSize: 12,
                    lineHeight: 1.8,
                    whiteSpace: "pre-wrap",
                    minHeight: 0,
                  }}
                >
                  {content}
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div
            className="shrink-0"
            style={{
              padding: "10px 14px",
              display: "flex",
              gap: 8,
              borderTop: "1px solid var(--border)",
            }}
          >
            <button
              className="nodrag"
              onClick={handleGenerate}
              disabled={isGenerating}
              style={{
                flex: 1,
                padding: "8px 0",
                borderRadius: 8,
                border: "none",
                background: isGenerating ? "var(--bg-surface)" : "var(--accent-btn)",
                color: isGenerating ? "var(--text-muted)" : "#fff",
                fontSize: 13,
                fontWeight: 500,
                cursor: isGenerating ? "not-allowed" : "pointer",
              }}
            >
              {isGenerating
                ? PHASE_LABELS[generationPhase]
                : (content ? "重新生成" : "生成章节")}
            </button>
          </div>
        </div>
      </div>
      <NodeResizeHandle
        width={nodeWidth}
        height={nodeData.height || 560}
        onResize={(r) => updateNodeData(id, { width: r.width, height: r.height })}
        minWidth={420}
        maxWidth={700}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        className="!bg-[var(--accent-secondary)] !w-5 !h-5 !border-2 !border-[var(--bg-node)]"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!bg-[var(--accent-secondary)] !w-5 !h-5 !border-2 !border-[var(--bg-node)]"
      />
    </>
  );
});



