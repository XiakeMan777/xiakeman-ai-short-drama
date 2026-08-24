import { create } from "zustand";
import { persist } from "zustand/middleware";
import { chatCompletionStream } from "@/features/canvas/compat/commands";
import { useSettingsStore } from "./settingsStore";
import { getRandomGrsaiKey, GRSAI_BUILTIN_CHAT_BASE_URL } from "@/features/canvas/shared/grsaiKeys";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  providerId: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ChatState {
  isPanelOpen: boolean;
  conversations: ChatConversation[];
  activeConversationId: string | null;
  isStreaming: boolean;
  abortController: AbortController | null;

  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;

  createConversation: (providerId: string, modelId: string) => string;
  deleteConversation: (id: string) => void;
  setActiveConversation: (id: string) => void;

  sendMessage: (content: string) => Promise<void>;
  stopGeneration: () => void;
  clearConversations: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      isPanelOpen: false,
      conversations: [],
      activeConversationId: null,
      isStreaming: false,
      abortController: null,

      openPanel: () => set({ isPanelOpen: true }),
      closePanel: () => set({ isPanelOpen: false }),
      togglePanel: () => set((s) => ({ isPanelOpen: !s.isPanelOpen })),

      createConversation: (providerId: string, modelId: string) => {
        const id = `chat-${Date.now()}`;
        const conv: ChatConversation = {
          id,
          title: "新对话",
          messages: [],
          providerId,
          modelId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({
          conversations: [conv, ...s.conversations],
          activeConversationId: id,
        }));
        return id;
      },

      deleteConversation: (id: string) => {
        set((s) => {
          const filtered = s.conversations.filter((c) => c.id !== id);
          return {
            conversations: filtered,
            activeConversationId:
              s.activeConversationId === id
                ? filtered[0]?.id ?? null
                : s.activeConversationId,
          };
        });
      },

      setActiveConversation: (id: string) => {
        set({ activeConversationId: id });
      },

      sendMessage: async (content: string) => {
        const { conversations, activeConversationId } = get();
        const conv = conversations.find((c) => c.id === activeConversationId);
        if (!conv) return;

        // ── Resolve apiKey + baseUrl ──
        let apiKey = "";
        let baseUrl = "";

        const creditsEnabled = useSettingsStore.getState().creditsEnabled;

        // 1. Check custom providers first (moved before credit check)
        const customProviders = useSettingsStore.getState().customProviders;
        const customP = customProviders.find((cp) => cp.id === conv.providerId);
        const isCustom = !!customP;

        // ── 对话直接发送，不扣积分 ──

        if (customP) {
          apiKey = customP.apiKey || "";
          baseUrl = customP.baseUrl || "";
          if (!apiKey && !creditsEnabled) {
            const userMsg: ChatMessage = { id: `msg-${Date.now()}`, role: "user", content, timestamp: Date.now() };
            const errMsg: ChatMessage = { id: `msg-${Date.now() + 1}`, role: "assistant", content: `请先在设置中为自定义API「${customP.name}」配置 API Key。`, timestamp: Date.now() };
            set((s) => ({
              conversations: s.conversations.map((c) =>
                c.id === activeConversationId ? { ...c, messages: [...c.messages, userMsg, errMsg], updatedAt: Date.now() } : c
              ),
            }));
            return;
          }
        } else {
          // 2. Fallback to built-in chat-model → channel flow
          const providers = useSettingsStore.getState().providers;

          // First try: direct lookup by conv.providerId (covers built-in channels like "geeknow")
          let directProvider = providers.find((p) => p.id === conv.providerId);

          // Second try: chat-model → channel indirection
          const chatProvider = providers.find((p) => p.id === "chat-model");
          if (!directProvider?.apiKey && chatProvider?.channel) {
            directProvider = providers.find((p) => p.id === chatProvider.channel);
          }
          // Final fallback: chat-model itself
          const effectiveProvider = directProvider || chatProvider;
          apiKey = effectiveProvider?.apiKey || "";
          baseUrl = effectiveProvider?.baseUrl || chatProvider?.baseUrl || "";

          // ── Credits mode fallback: use random key from grsai key pool when user hasn't configured one ──
          // In credits mode, the app uses built-in API keys; if the user's settings store
          // has no key for grsai, we randomly pick one from the key pool for load distribution.
          if (!apiKey && creditsEnabled) {
            apiKey = getRandomGrsaiKey();
          }
          if (!baseUrl && creditsEnabled) {
            baseUrl = GRSAI_BUILTIN_CHAT_BASE_URL;
          }

          if (!apiKey && !creditsEnabled) {
            const userMsg: ChatMessage = { id: `msg-${Date.now()}`, role: "user", content, timestamp: Date.now() };
            const errMsg: ChatMessage = { id: `msg-${Date.now() + 1}`, role: "assistant", content: "请先在画布设置中配置虾客漫对话模型的 API Key。", timestamp: Date.now() };
            set((s) => ({
              conversations: s.conversations.map((c) =>
                c.id === activeConversationId ? { ...c, messages: [...c.messages, userMsg, errMsg], updatedAt: Date.now() } : c
              ),
            }));
            return;
          }
        }

        // ── Add user message ──
        const userMsg: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: "user",
          content,
          timestamp: Date.now(),
        };

        // Add empty assistant message (will be filled streamingly)
        const assistantMsgId = `msg-${Date.now() + 1}`;
        const assistantMsg: ChatMessage = {
          id: assistantMsgId,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
        };

        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === activeConversationId
              ? {
                  ...c,
                  messages: [...c.messages, userMsg, assistantMsg],
                  title: c.messages.length === 0 ? content.slice(0, 30) : c.title,
                  updatedAt: Date.now(),
                }
              : c
          ),
        }));

        // Build messages array for API (exclude empty assistant message)
        const updatedConv = get().conversations.find((c) => c.id === activeConversationId);
        if (!updatedConv) return;

        const allMessages = updatedConv.messages
          .filter((m) => m.id !== assistantMsgId)
          .map((m) => ({ role: m.role, content: m.content }));

        // ── Truncate messages to avoid exceeding model context window ──
        // Strategy: keep system messages + last N rounds of conversation
        // Each "round" = 1 user message + 1 assistant message
        const MAX_CONTEXT_CHARS = 60000; // Conservative limit (~30k tokens for most models)
        const MIN_ROUNDS_TO_KEEP = 6;    // Always keep at least 6 recent rounds

        const systemMsgs = allMessages.filter((m) => m.role === "system");
        const conversationMsgs = allMessages.filter((m) => m.role !== "system");

        // Estimate total character count
        let totalChars = allMessages.reduce((sum, m) => sum + m.content.length, 0);

        let truncatedMsgs = [...systemMsgs, ...conversationMsgs];

        if (totalChars > MAX_CONTEXT_CHARS && conversationMsgs.length > MIN_ROUNDS_TO_KEEP * 2) {
          // Remove oldest conversation messages until we're under the limit
          // But always keep MIN_ROUNDS_TO_KEEP rounds from the end
          const minKeepCount = MIN_ROUNDS_TO_KEEP * 2;
          let removeCount = conversationMsgs.length - minKeepCount;

          while (removeCount > 0) {
            const withoutOldest = conversationMsgs.slice(removeCount);
            totalChars = systemMsgs.reduce((s, m) => s + m.content.length, 0) +
                         withoutOldest.reduce((s, m) => s + m.content.length, 0);
            if (totalChars <= MAX_CONTEXT_CHARS) break;
            removeCount++;
            if (conversationMsgs.length - removeCount < minKeepCount) {
              removeCount = conversationMsgs.length - minKeepCount;
              break;
            }
          }

          const keptConversation = conversationMsgs.slice(removeCount);
          truncatedMsgs = [...systemMsgs, ...keptConversation];
          // removedCount > 0 means older messages were dropped to stay within limit
        }

        const apiMessages = truncatedMsgs;

        set({ isStreaming: true });
        const abortController = new AbortController();
        set({ abortController });

        try {
          const fullContent = await chatCompletionStream(
            {
              baseUrl,
              apiKey,
              model: conv.modelId,
              messages: apiMessages,
              temperature: 0.7,
              // Custom providers: smart auth detection (frontend will auto-detect based on baseUrl)
              ...(isCustom ? { _auth_header_style: undefined as string | undefined } : {}),
            },
            (delta) => {
              // Update assistant message content incrementally
              set((s) => ({
                conversations: s.conversations.map((c) =>
                  c.id === activeConversationId
                    ? {
                        ...c,
                        messages: c.messages.map((m) =>
                          m.id === assistantMsgId ? { ...m, content: m.content + delta } : m
                        ),
                      }
                    : c
                ),
              }));
            },
            abortController.signal,
          );

          // Final update to ensure content is complete
          set((s) => ({
            isStreaming: false,
            abortController: null,
            conversations: s.conversations.map((c) =>
              c.id === activeConversationId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantMsgId ? { ...m, content: fullContent } : m
                    ),
                    updatedAt: Date.now(),
                  }
                : c
            ),
          }));
        } catch (e) {
          if ((e as Error).name === "AbortError") {
            // User cancelled — keep whatever content we have so far
            set({ isStreaming: false, abortController: null });
            return;
          }
          // Friendly error messages for common API errors
          let errMsgContent: string;
          const errStr = e instanceof Error ? e.message : String(e);
          if (errStr.includes("400") || errStr.includes("上下文过长") || errStr.includes("context_length") || errStr.includes("token limit") || errStr.includes("maximum context length")) {
            errMsgContent = "对话上下文过长，已超出模型限制。建议新建对话继续聊天。";
          } else if (errStr.includes("401") || errStr.includes("Unauthorized") || errStr.includes("Invalid API key")) {
            errMsgContent = "API Key 无效或未配置，请在设置中检查 API Key。";
          } else if (errStr.includes("429") || errStr.includes("rate limit") || errStr.includes("Rate limit")) {
            errMsgContent = "请求过于频繁，请稍后重试。";
          } else if (errStr.includes("500") || errStr.includes("502") || errStr.includes("503")) {
            errMsgContent = "服务器暂时不可用，请稍后重试。";
          } else {
            errMsgContent = `请求失败: ${errStr}`;
          }
          set((s) => ({
            isStreaming: false,
            abortController: null,
            conversations: s.conversations.map((c) =>
              c.id === activeConversationId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantMsgId ? { ...m, content: errMsgContent } : m
                    ),
                    updatedAt: Date.now(),
                  }
                : c
            ),
          }));
        }
      },

      stopGeneration: () => {
        const { abortController } = get();
        if (abortController) {
          abortController.abort();
          set({ isStreaming: false, abortController: null });
        }
      },

      clearConversations: () => {
        set({ conversations: [], activeConversationId: null });
      },
    }),
    {
      name: "chat-store",
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
      }),
    }
  )
);



