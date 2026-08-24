import { useState, useCallback, useRef, useEffect } from "react";
import { useChatStore, type ChatMessage } from "@/features/canvas/stores/chatStore";
import { useSettingsStore } from "@/features/canvas/stores/settingsStore";
import { useChannelModelSelector } from "../hooks/useChannelModelSelector";
import { ChannelModelSelector } from "./ChannelModelSelector";

// ---------------------------------------------------------------------------
// ChatPanel — full-screen overlay chat panel with model selection
// ---------------------------------------------------------------------------

export function ChatPanel() {
  const isPanelOpen = useChatStore((s) => s.isPanelOpen);
  const closePanel = useChatStore((s) => s.closePanel);
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const createConversation = useChatStore((s) => s.createConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopGeneration = useChatStore((s) => s.stopGeneration);

  const [inputValue, setInputValue] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>();
  const [selectedModelId, setSelectedModelId] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { availableProviders, availableModels, getDefaultModel } =
    useChannelModelSelector("chat", selectedProviderId);

  // Get chat-model provider from settings
  const providers = useSettingsStore((s) => s.providers);
  const chatProvider = providers.find((p) => p.id === "chat-model");
  const effectiveChannel = chatProvider?.channel || chatProvider?.id || "openai-compatible";

  // Initialize selected provider from settings
  useEffect(() => {
    if (!selectedProviderId) {
      setSelectedProviderId(effectiveChannel);
    }
  }, [effectiveChannel, selectedProviderId]);

  // Initialize selected model from settings
  useEffect(() => {
    if (!selectedModelId && selectedProviderId) {
      const defaultModel = getDefaultModel(selectedProviderId);
      if (defaultModel) setSelectedModelId(defaultModel);
    }
  }, [selectedProviderId, selectedModelId, getDefaultModel]);

  // Auto-scroll to bottom when messages change
  const activeConv = conversations.find((c) => c.id === activeConversationId);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConv?.messages.length]);

  // Escape to close
  useEffect(() => {
    if (!isPanelOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isPanelOpen, closePanel]);

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming) return;

    // Ensure we have an active conversation
    let convId = activeConversationId;
    if (!convId) {
      convId = createConversation(selectedProviderId || effectiveChannel, selectedModelId);
    }

    setInputValue("");
    sendMessage(trimmed);
  }, [inputValue, isStreaming, activeConversationId, selectedProviderId, selectedModelId, effectiveChannel, createConversation, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleNewChat = useCallback(() => {
    createConversation(selectedProviderId || effectiveChannel, selectedModelId);
  }, [selectedProviderId, selectedModelId, effectiveChannel, createConversation]);

  if (!isPanelOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 0,
        top: "40px",
        bottom: 0,
        width: "520px",
        maxWidth: "100vw",
        backgroundColor: "var(--bg-surface)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.3)",
        zIndex: 50,
        animation: "slideInRight 0.2s ease",
      }}
    >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>
            AI 对话
          </h3>
          <div className="flex items-center" style={{ gap: 4 }}>
            <button
              onClick={handleNewChat}
              title="新对话"
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                backgroundColor: "transparent",
                border: "none",
                color: "var(--text-secondary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button
              onClick={closePanel}
              title="关闭"
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-primary)";
                e.currentTarget.style.borderColor = "var(--text-muted)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "var(--bg-secondary)";
                e.currentTarget.style.color = "var(--text-secondary)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Model selector */}
        <div
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <ChannelModelSelector
            selectedProviderId={selectedProviderId}
            selectedModelId={selectedModelId}
            availableProviders={availableProviders}
            availableModels={availableModels}
            onProviderChange={(id) => {
              setSelectedProviderId(id);
              const defaultModel = getDefaultModel(id);
              if (defaultModel) setSelectedModelId(defaultModel);
            }}
            onModelChange={setSelectedModelId}
          />
        </div>

        {/* Conversation list (when multiple) */}
        {conversations.length > 1 && (
          <div
            style={{
              padding: "8px 16px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
              display: "flex",
              gap: 4,
              overflowX: "auto",
            }}
          >
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setActiveConversation(conv.id)}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  color: conv.id === activeConversationId ? "var(--accent)" : "var(--text-secondary)",
                  backgroundColor: conv.id === activeConversationId ? "var(--accent-muted)" : "var(--bg-secondary)",
                  border: "1px solid " + (conv.id === activeConversationId ? "var(--accent)" : "var(--border)"),
                  borderRadius: 6,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span style={{ maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {conv.title}
                </span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(conv.id);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    fontSize: 10,
                    opacity: 0.5,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Messages area */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {(!activeConv || activeConv.messages.length === 0) && (
            <div
              className="flex flex-col items-center justify-center"
              style={{ flex: 1, color: "var(--text-muted)" }}
            >
              <span style={{ fontSize: 32, marginBottom: 8 }}>💬</span>
              <span style={{ fontSize: 14 }}>选择模型，开始对话</span>
              <span style={{ fontSize: 12, marginTop: 4, opacity: 0.6 }}>
                支持 GPT-4o、Claude、DeepSeek 等模型
              </span>
            </div>
          )}
          {activeConv?.messages.map((msg: ChatMessage) => (
            <div
              key={msg.id}
              style={{
                display: "flex",
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "85%",
                  padding: "10px 14px",
                  borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                  backgroundColor: msg.role === "user" ? "var(--accent)" : "var(--bg-secondary)",
                  color: msg.role === "user" ? "#fff" : "var(--text-primary)",
                  fontSize: 13,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {isStreaming && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <button
                onClick={stopGeneration}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  color: "var(--text-secondary)",
                  fontSize: 12,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--bg-secondary)";
                  e.currentTarget.style.color = "var(--text-secondary)";
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2"/>
                </svg>
                停止生成
              </button>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 8,
            }}
          >
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              rows={1}
              style={{
                flex: 1,
                fontSize: 14,
                color: "var(--text-primary)",
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                outline: "none",
                resize: "none",
                minHeight: 36,
                maxHeight: 200,
                lineHeight: 1.5,
                padding: "8px 12px",
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = Math.min(target.scrollHeight, 200) + "px";
              }}
            />
            <button
              onClick={handleSend}
              disabled={!inputValue.trim() || isStreaming}
              title="发送"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: inputValue.trim() && !isStreaming ? "var(--accent)" : "var(--bg-secondary)",
                border: "none",
                color: inputValue.trim() && !isStreaming ? "#fff" : "var(--text-muted)",
                cursor: inputValue.trim() && !isStreaming ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "all 0.15s",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
        </div>
      </div>
    </div>
  );
}



