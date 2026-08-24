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
  type NovelNodeData,
  type NovelCharacterProfile,
  type NovelOutlineEntry,
} from "../domain/canvasNodes";
import { chatCompletionStream } from "@/features/canvas/compat/commands";

// ─── System prompts ────────────────────────────────────────────────────────

const SETTING_SYSTEM_PROMPT = `你是一位资深小说策划师和世界观设计师。请根据用户提供的一句话描述，生成一份完整的小说策划文档。

要求按以下结构输出，每个部分用【】标记：

【设定】
世界观、时代背景、社会结构、力量体系/科技水平

【角色】
每个角色用以下格式，角色之间空一行：
姓名|角色类型|外貌|性格|动机|秘密|与他人的关系

【目录】
每个章节用以下格式，章节之间空一行：
章节号|标题|视角|冲突|关键事件|伏笔|预计字数

注意：
- 角色至少3人（主角+配角+反派）
- 章节数根据故事规模合理设定（默认20章左右）
- 伏笔要有长线（跨全书）和短线（3-5章内回收）
- 严格按照上述格式输出，方便程序解析`;

// ─── Parse helpers ──────────────────────────────────────────────────────────

function parseCharacters(text: string): NovelCharacterProfile[] {
  const characters: NovelCharacterProfile[] = [];
  const lines = text.trim().split("\n").filter((l) => l.trim());
  for (const line of lines) {
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length >= 7) {
      characters.push({
        name: parts[0],
        role: parts[1],
        appearance: parts[2],
        personality: parts[3],
        motivation: parts[4],
        secret: parts[5],
        relationships: parts[6],
      });
    }
  }
  return characters;
}

function parseOutline(text: string): NovelOutlineEntry[] {
  const outline: NovelOutlineEntry[] = [];
  const lines = text.trim().split("\n").filter((l) => l.trim());
  for (const line of lines) {
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length >= 7) {
      outline.push({
        chapterNo: parseInt(parts[0]) || outline.length + 1,
        title: parts[1],
        perspective: parts[2],
        conflict: parts[3],
        keyEvents: parts[4],
        foreshadowing: parts[5],
        wordCount: parseInt(parts[6]) || 3000,
      });
    }
  }
  return outline;
}

function parseGeneratedContent(fullText: string): {
  settings: string;
  characters: NovelCharacterProfile[];
  outline: NovelOutlineEntry[];
} {
  let settings = "";
  let characters: NovelCharacterProfile[] = [];
  let outline: NovelOutlineEntry[] = [];

  const settingMatch = fullText.match(/【设定】\s*([\s\S]*?)(?=【角色】|$)/);
  const characterMatch = fullText.match(/【角色】\s*([\s\S]*?)(?=【目录】|$)/);
  const outlineMatch = fullText.match(/【目录】\s*([\s\S]*?)$/);

  if (settingMatch) settings = settingMatch[1].trim();
  if (characterMatch) characters = parseCharacters(characterMatch[1]);
  if (outlineMatch) outline = parseOutline(outlineMatch[1]);

  // Fallback: if parsing failed, keep raw text as settings
  if (!settings && !characters.length && !outline.length) {
    settings = fullText;
  }

  return { settings, characters, outline };
}

// ─── Component ─────────────────────────────────────────────────────────────

export const NovelNode = memo(function NovelNode({
  data,
  id,
  selected,
}: NodeProps) {
  const nodeData = data as unknown as NovelNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const { addToast } = useToastStore();

  // ── State ──
  const [premise, setPremise] = useState(nodeData.premise || "");
  const [generatedSettings, setGeneratedSettings] = useState(
    nodeData.generatedSettings || ""
  );
  const [characters, setCharacters] = useState<NovelCharacterProfile[]>(
    nodeData.characters || []
  );
  const [outline, setOutline] = useState<NovelOutlineEntry[]>(
    nodeData.outline || []
  );
  const [isGenerating, setIsGenerating] = useState(nodeData.isGenerating || false);
  const [activeTab, setActiveTab] = useState<"settings" | "characters" | "outline">("settings");

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

  // ── Sync to node data ──
  useEffect(() => {
    updateNodeData(id, {
      premise,
      generatedSettings,
      characters,
      outline,
      isGenerating,
      providerId: selectedProviderId,
      model: selectedModel,
    });
  }, [
    premise, generatedSettings, characters, outline, isGenerating,
    id, updateNodeData,
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

  // ── Generate everything ──
  const handleGenerate = useCallback(async () => {
    const providerConfig = getProviderConfig();
    const creditsEnabled = useSettingsStore.getState().creditsEnabled;
    if (!creditsEnabled && (!providerConfig?.apiKey || !providerConfig?.baseUrl)) {
      addToast("warning", "请先在设置中配置对话模型 API");
      return;
    }

    setIsGenerating(true);
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const userMessage = premise.trim()
        ? `请根据以下描述生成小说策划：\n${premise}`
        : "请为我生成一个小说策划，题材和风格自由发挥。";

      let fullContent = "";
      await chatCompletionStream(
        {
          baseUrl: providerConfig?.baseUrl || "",
          apiKey: providerConfig?.apiKey || "",
          model: selectedModel,
          messages: [
            { role: "system", content: SETTING_SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          temperature: 0.8,
          maxTokens: 8192,
        },
        (delta) => {
          fullContent += delta;
          // Live update settings text
          const parsed = parseGeneratedContent(fullContent);
          if (parsed.settings) setGeneratedSettings(parsed.settings);
          if (parsed.characters.length) setCharacters(parsed.characters);
          if (parsed.outline.length) setOutline(parsed.outline);
        },
        ac.signal
      );

      // Final parse
      const parsed = parseGeneratedContent(fullContent);
      if (parsed.settings) setGeneratedSettings(parsed.settings);
      if (parsed.characters.length) setCharacters(parsed.characters);
      if (parsed.outline.length) setOutline(parsed.outline);

      addToast("success", `小说策划已生成：${parsed.characters.length}个角色，${parsed.outline.length}章目录`);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        addToast("error", `生成失败: ${err?.message || err}`);
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [premise, selectedModel, getProviderConfig, addToast]);

  // ── Cancel ──
  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsGenerating(false);
  }, []);

  const nodeWidth = nodeData.width || 440;
  const hasContent = generatedSettings || characters.length > 0 || outline.length > 0;

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
            <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>
              📖 小说
            </span>
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

          {/* Premise input */}
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
              一句话描述你的小说
            </div>
            <textarea
              className="nodrag nowheel"
              value={premise}
              onChange={(e) => setPremise(e.target.value)}
              placeholder="如：玄幻少年被家族驱逐后觉醒神脉，踏上复仇之路..."
              rows={3}
              style={{
                width: "100%",
                backgroundColor: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "8px",
                color: "var(--text-primary)",
                fontSize: 12,
                lineHeight: 1.6,
                resize: "none",
                outline: "none",
              }}
            />
          </div>

          {/* Tab navigation (only show when has content) */}
          {hasContent && (
            <div
              className="shrink-0"
              style={{
                display: "flex",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {[
                { key: "settings" as const, label: "设定", icon: "📋" },
                { key: "characters" as const, label: `角色(${characters.length})`, icon: "👥" },
                { key: "outline" as const, label: `目录(${outline.length}章)`, icon: "📑" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  className="nodrag"
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    flex: 1,
                    padding: "6px 0",
                    border: "none",
                    borderBottom: activeTab === tab.key
                      ? "2px solid var(--accent-btn)"
                      : "2px solid transparent",
                    background: "transparent",
                    color: activeTab === tab.key ? "var(--text-primary)" : "var(--text-muted)",
                    fontSize: 11,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>
          )}

          {/* Tab content */}
          {hasContent && (
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              {/* Settings tab */}
              {activeTab === "settings" && generatedSettings && (
                <div
                  style={{
                    padding: "10px 14px",
                    fontSize: 12,
                    lineHeight: 1.7,
                    whiteSpace: "pre-wrap",
                    color: "var(--text-secondary)",
                  }}
                >
                  {generatedSettings}
                </div>
              )}

              {/* Characters tab */}
              {activeTab === "characters" && characters.length > 0 && (
                <div style={{ padding: "10px 14px" }}>
                  {characters.map((c, i) => (
                    <div
                      key={i}
                      style={{
                        marginBottom: 8,
                        padding: "8px",
                        backgroundColor: "var(--bg-surface)",
                        borderRadius: 6,
                        borderLeft: `3px solid ${c.role === "主角" ? "var(--accent-btn)" : c.role === "反派" ? "#ef4444" : "var(--text-muted)"}`,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
                          {c.name}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: c.role === "主角" ? "var(--accent-btn)" : c.role === "反派" ? "#ef4444" : "var(--bg-surface)",
                            color: c.role === "主角" || c.role === "反派" ? "#fff" : "var(--text-muted)",
                            border: c.role !== "主角" && c.role !== "反派" ? "1px solid var(--border)" : "none",
                          }}
                        >
                          {c.role}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
                        {c.personality && <div>性格：{c.personality}</div>}
                        {c.motivation && <div>动机：{c.motivation}</div>}
                        {c.appearance && <div>外貌：{c.appearance}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Outline tab */}
              {activeTab === "outline" && outline.length > 0 && (
                <div style={{ padding: "10px 14px" }}>
                  {outline.map((entry, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        gap: 8,
                        padding: "6px 8px",
                        marginBottom: 4,
                        backgroundColor: i % 2 === 0 ? "var(--bg-surface)" : "transparent",
                        borderRadius: 4,
                        fontSize: 11,
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          color: "var(--accent-btn)",
                          fontWeight: 500,
                          minWidth: 28,
                          textAlign: "right",
                        }}
                      >
                        {entry.chapterNo}
                      </span>
                      <span style={{ color: "var(--text-primary)", fontWeight: 500, flex: 1 }}>
                        {entry.title}
                      </span>
                      <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                        {entry.wordCount}字
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Generate button */}
          <div
            className="shrink-0"
            style={{
              padding: "10px 14px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              gap: 8,
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
              {isGenerating ? "生成中..." : (hasContent ? "重新生成" : "一键生成")}
            </button>
            {isGenerating && (
              <button
                className="nodrag"
                onClick={handleCancel}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-muted)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                取消
              </button>
            )}
          </div>
        </div>
      </div>
      <NodeResizeHandle
        width={nodeWidth}
        height={nodeData.height || 480}
        onResize={(r) => updateNodeData(id, { width: r.width, height: r.height })}
        minWidth={380}
        maxWidth={600}
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



