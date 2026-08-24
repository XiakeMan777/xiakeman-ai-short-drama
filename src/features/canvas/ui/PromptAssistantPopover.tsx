import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { chatCompletionStream } from "@/features/canvas/compat/commands";
import { useSettingsStore } from "@/features/canvas/stores/settingsStore";

interface PromptAssistantPopoverProps {
  currentPrompt: string;
  selectedProviderId: string;
  onApply: (newPrompt: string) => void;
  onClose: () => void;
  anchorRect?: DOMRect;
}

const FAVORITES_KEY = "prompt-assistant-favorites";

const STYLE_TAGS = [
  "电影感", "赛博朋克", "水墨风", "复古胶片",
  "极简主义", "幻想插画", "3D渲染", "日系动漫",
];

const CAMERA_TAGS = [
  "特写", "中景", "全景", "航拍",
  "跟拍", "低角度", "鱼眼", "浅景深",
];

const QUALITY_TAGS = [
  "8K超高清", "HDR", "电影级颗粒", "柔光",
  "锐利细节", "体积光", "全局光照",
];

function getSystemPrompt(action: string): string {
  switch (action) {
    case "polish":
      return "你是一个专业的AI提示词优化专家。请将用户提供的简短描述扩展为一段详细、生动的提示词，包含场景细节、光影描述、风格指引和画质要求。直接输出优化后的提示词，不要加任何解释。输出长度控制在200字以内。";
    case "translate":
      return "你是一个专业的翻译助手。请将用户的中文提示词翻译成英文，保持所有细节和风格描述。直接输出英文翻译结果，不要加任何解释。";
    case "negative":
      return "你是一个专业的提示词工程师。请根据用户的正向提示词，生成一段相反或对比的提示词版本——如果原描述是夜景就生成白天版本，如果是温暖的场景就生成寒冷版本。保持长度相近。直接输出结果，不加解释。";
    case "shorten":
      return "你是一个专业的提示词精简专家。请将用户的长描述精简为一个简洁但保留核心元素的短版提示词，控制在50字以内。直接输出结果，不加解释。";
    default:
      return "你是一个专业的AI提示词优化专家。请优化用户的提示词，使其更加详细和生动。直接输出结果，不加解释。";
  }
}

function resolveProvider(providerId: string): { apiKey: string; baseUrl: string; model: string; isCustom: boolean } | null {
  const settings = useSettingsStore.getState();
  const isCustom = providerId.startsWith("custom-");

  if (isCustom) {
    const cp = settings.customProviders.find((p) => p.id === providerId);
    if (cp?.apiKey && cp.baseUrl) {
      return { apiKey: cp.apiKey, baseUrl: cp.baseUrl, model: "gpt-4o-mini", isCustom: true };
    }
    return null;
  }

  // Built-in: find grsai or chat-model provider
  const allProviders = settings.providers;
  let provider = allProviders.find((p) => p.id === providerId && p.apiKey);
  if (!provider) {
    const chatModel = allProviders.find((p) => p.id === "chat-model" && p.apiKey);
    if (chatModel) provider = chatModel;
  }
  if (!provider) {
    provider = allProviders.find((p) => p.id === "grsai" && p.apiKey);
  }
  if (provider?.apiKey && provider.baseUrl) {
    return { apiKey: provider.apiKey, baseUrl: provider.baseUrl, model: provider.modelName || "gpt-4o-mini", isCustom: false };
  }

  // Credits mode: no apiKey needed
  const creditsEnabled = settings.creditsEnabled;
  if (creditsEnabled) {
    provider = allProviders.find((p) => p.id === "chat-model") || allProviders.find((p) => p.id === "grsai");
    return {
      apiKey: provider?.apiKey || "",
      baseUrl: provider?.baseUrl || "",
      model: provider?.modelName || "gpt-4o-mini",
      isCustom: false,
    };
  }

  return null;
}

export function PromptAssistantPopover({
  currentPrompt,
  selectedProviderId,
  onApply,
  onClose,
  anchorRect,
}: PromptAssistantPopoverProps) {
  const [loading, setLoading] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [activeAction, setActiveAction] = useState("");
  const [error, setError] = useState("");
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(FAVORITES_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Close on Esc
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const saveFavorites = useCallback((items: string[]) => {
    setFavorites(items);
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(items)); } catch {}
  }, []);

  const addFavorite = useCallback((text: string) => {
    if (!text.trim() || favorites.includes(text)) return;
    saveFavorites([...favorites, text]);
  }, [favorites, saveFavorites]);

  const removeFavorite = useCallback((text: string) => {
    saveFavorites(favorites.filter((f) => f !== text));
  }, [favorites, saveFavorites]);

  const handleAIAction = async (action: string) => {
    if (!currentPrompt.trim() && action !== "polish") return;
    setActiveAction(action);
    setLoading(true);
    setPreviewText("");
    setError("");

    const providerInfo = resolveProvider(selectedProviderId);
    if (!providerInfo) {
      setError("未找到可用的对话模型配置，请先在设置中配置 API Key");
      setLoading(false);
      return;
    }

    try {
      let fullContent = "";
      const system = getSystemPrompt(action);
      fullContent = await chatCompletionStream(
        {
          baseUrl: providerInfo.baseUrl,
          apiKey: providerInfo.apiKey,
          model: providerInfo.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: currentPrompt || "请帮我生成一个高质量的AI绘图提示词" },
          ],
          temperature: 0.7,
          maxTokens: action === "shorten" ? 200 : 600,
        },
        () => {},
      );

      const cleaned = fullContent.trim();
      if (cleaned) {
        setPreviewText(cleaned);
      } else {
        setError("AI 返回了空内容，请重试");
      }
    } catch (e: any) {
      console.error("[PromptAssistant] AI call failed:", e);
      setError(`AI 调用失败: ${e?.message || String(e)}`);
    }
    setLoading(false);
  };

  const handleApplyPreview = () => {
    if (previewText) {
      onApply(previewText);
      onClose();
    }
  };

  const handleTagClick = (tag: string) => {
    const trimmed = currentPrompt.trim();
    const newPrompt = trimmed ? `${trimmed}，${tag}` : tag;
    onApply(newPrompt);
  };

  // Popover position
  const popStyle: React.CSSProperties = anchorRect
    ? {
        position: "fixed",
        top: anchorRect.bottom + 6,
        left: Math.max(8, anchorRect.right - 370),
        zIndex: 10000,
      }
    : {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 10000,
      };

  return createPortal(
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
        }}
        onClick={onClose}
      />
      <div
        style={{
          ...popStyle,
          width: 360,
          maxHeight: "80vh",
          overflow: "auto",
          background: "#25252a",
          border: "0.5px solid #2e2e34",
          borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "10px 14px",
            fontSize: 13,
            fontWeight: 500,
            color: "#f0f0f5",
            borderBottom: "0.5px solid #2e2e34",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>提示词助手</span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#a0a0a8",
              cursor: "pointer",
              fontSize: 14,
              padding: "2px 4px",
            }}
          >
            ✕
          </button>
        </div>

        {/* AI 快速操作 */}
        <div style={{ padding: "10px 14px", borderBottom: "0.5px solid #2e2e34" }}>
          <div style={{ fontSize: 11, color: "#5a5a62", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
            AI 快速操作
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { key: "polish", label: "AI润色" },
              { key: "translate", label: "中译英" },
              { key: "negative", label: "反向提示词" },
              { key: "shorten", label: "改写短版" },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleAIAction(key)}
                disabled={loading}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: `0.5px solid ${activeAction === key ? "#7ab4f0" : "#2e2e34"}`,
                  background: activeAction === key ? "rgba(122,180,240,0.15)" : "transparent",
                  color: loading ? "#5a5a62" : "#f0f0f5",
                  fontSize: 12,
                  cursor: loading ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {loading && activeAction === key && (
                  <span style={{
                    width: 10, height: 10, borderRadius: "50%",
                    border: "2px solid #7ab4f0", borderTopColor: "transparent",
                    display: "inline-block",
                    animation: "spin 0.6s linear infinite",
                  }} />
                )}
                {label}
              </button>
            ))}
          </div>

          {/* Preview / Error */}
          {error && (
            <div style={{
              marginTop: 8, padding: "6px 10px",
              background: "rgba(226,75,74,0.1)", borderRadius: 6,
              border: "0.5px solid rgba(226,75,74,0.3)",
              fontSize: 12, color: "#e24b4a",
            }}>
              {error}
            </div>
          )}
          {previewText && !loading && (
            <div style={{ marginTop: 8 }}>
              <div style={{
                padding: "8px 10px",
                background: "#1a1a1e", borderRadius: 6,
                fontSize: 12, color: "#f0f0f5", lineHeight: 1.6,
                maxHeight: 100, overflow: "auto",
              }}>
                {previewText}
              </div>
              <button
                onClick={handleApplyPreview}
                style={{
                  marginTop: 6,
                  padding: "4px 12px",
                  borderRadius: 6,
                  border: "none",
                  background: "#7ab4f0",
                  color: "#141416",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                应用此结果
              </button>
            </div>
          )}
        </div>

        {/* 画面风格 */}
        <div style={{ padding: "10px 14px", borderBottom: "0.5px solid #2e2e34" }}>
          <div style={{ fontSize: 11, color: "#5a5a62", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
            画面风格
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {STYLE_TAGS.map((tag) => (
              <button
                key={tag}
                onClick={() => handleTagClick(tag)}
                style={{
                  padding: "3px 8px",
                  borderRadius: 4,
                  border: "0.5px solid #2e2e34",
                  background: "transparent",
                  color: "#a0a0a8",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* 镜头语言 */}
        <div style={{ padding: "10px 14px", borderBottom: "0.5px solid #2e2e34" }}>
          <div style={{ fontSize: 11, color: "#5a5a62", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
            镜头语言
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {CAMERA_TAGS.map((tag) => (
              <button
                key={tag}
                onClick={() => handleTagClick(tag)}
                style={{
                  padding: "3px 8px",
                  borderRadius: 4,
                  border: "0.5px solid #2e2e34",
                  background: "transparent",
                  color: "#a0a0a8",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* 画质修饰 */}
        <div style={{ padding: "10px 14px", borderBottom: "0.5px solid #2e2e34" }}>
          <div style={{ fontSize: 11, color: "#5a5a62", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
            画质修饰
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {QUALITY_TAGS.map((tag) => (
              <button
                key={tag}
                onClick={() => handleTagClick(tag)}
                style={{
                  padding: "3px 8px",
                  borderRadius: 4,
                  border: "0.5px solid #2e2e34",
                  background: "transparent",
                  color: "#a0a0a8",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* 收藏模板 */}
        <div style={{ padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: "#5a5a62", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
            收藏模板（点击应用，右键删除）
          </div>
          {favorites.length === 0 ? (
            <div style={{ fontSize: 12, color: "#5a5a62" }}>
              暂无收藏。长按标签可收藏。
            </div>
          ) : (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {favorites.map((fav) => (
                <button
                  key={fav}
                  onClick={() => onApply(fav)}
                  onContextMenu={(e) => { e.preventDefault(); removeFavorite(fav); }}
                  title="左键应用，右键删除"
                  style={{
                    padding: "3px 8px",
                    borderRadius: 4,
                    border: "0.5px solid #fac775",
                    background: "rgba(250,199,117,0.1)",
                    color: "#fac775",
                    fontSize: 11,
                    cursor: "pointer",
                    maxWidth: 200,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {fav.length > 25 ? fav.slice(0, 25) + "…" : fav}
                </button>
              ))}
            </div>
          )}

          {/* Save current prompt as favorite */}
          {currentPrompt.trim() && !favorites.includes(currentPrompt.trim()) && (
            <button
              onClick={() => addFavorite(currentPrompt.trim())}
              style={{
                marginTop: 8,
                padding: "3px 10px",
                borderRadius: 4,
                border: "0.5px solid #2e2e34",
                background: "transparent",
                color: "#a0a0a8",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              + 收藏当前提示词
            </button>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// PromptAssistantButton — reusable inline button for textarea-based nodes
// ---------------------------------------------------------------------------

interface PromptAssistantButtonProps {
  currentPrompt: string;
  selectedProviderId: string;
  onApply: (newPrompt: string) => void;
  /** Optional custom style overrides for the button */
  style?: React.CSSProperties;
}

export function PromptAssistantButton({
  currentPrompt,
  selectedProviderId,
  onApply,
  style,
}: PromptAssistantButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [showPopover, setShowPopover] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | undefined>();

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="nodrag"
        onClick={() => {
          const btn = btnRef.current;
          if (btn) setAnchorRect(btn.getBoundingClientRect());
          setShowPopover((v) => !v);
        }}
        title="提示词助手 (AI 润色/模板)"
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          backgroundColor: showPopover ? "rgba(122, 180, 240, 0.2)" : "transparent",
          border: `0.5px solid ${showPopover ? "#7ab4f0" : "#2e2e34"}`,
          color: "#7ab4f0",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
          transition: "all 0.15s",
          flexShrink: 0,
          ...style,
        }}
        onMouseEnter={(e) => {
          if (!showPopover) {
            (e.currentTarget as HTMLElement).style.borderColor = "#7ab4f0";
            (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(122, 180, 240, 0.1)";
          }
        }}
        onMouseLeave={(e) => {
          if (!showPopover) {
            (e.currentTarget as HTMLElement).style.borderColor = "#2e2e34";
            (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
          }
        }}
      >
        +
      </button>
      {showPopover && (
        <PromptAssistantPopover
          currentPrompt={currentPrompt}
          selectedProviderId={selectedProviderId}
          onApply={(newPrompt) => {
            onApply(newPrompt);
            setShowPopover(false);
          }}
          onClose={() => setShowPopover(false)}
          anchorRect={anchorRect}
        />
      )}
    </>
  );
}



