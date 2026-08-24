import { useState, useCallback, useRef, useEffect, useMemo, memo } from "react";
import { type NodeProps, Handle, Position } from "@xyflow/react";
import { resolveImageDisplayUrl } from "../application/imageData";
import { useTranslation } from "react-i18next";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useSettingsStore } from "@/features/canvas/stores/settingsStore";
import { useErrorStore } from "@/features/canvas/compat/ErrorDialog";
import { useToastStore } from "@/features/canvas/compat/Toast";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";
import type { AudioNodeData } from "../domain/canvasNodes";
import { persistAudioSource, generateTts } from "@/features/canvas/compat/commands";

/**
 * Resolve a local file path to a URL playable by <audio>.
 * Delegates to resolveImageDisplayUrl which caches convertFileSrc results.
 */
function resolveAudioUrl(source: string | null): string {
  return resolveImageDisplayUrl(source);
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const TTS_MODELS = [
  { value: "minimax-speech-2.8-hd", label: "Minimax-speech-2.8-hd" },
  { value: "minimax-speech-2.0", label: "Minimax-speech-2.0" },
  { value: "openai-tts-1", label: "OpenAI TTS-1" },
  { value: "openai-tts-1-hd", label: "OpenAI TTS-1-HD" },
];

const MAX_TTS_CHARS = 5000;

/** Editable dropdown for TTS model selection — supports custom model names */
function TtsModelDropdown({ value, models, onChange }: { value: string; models: typeof TTS_MODELS; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const isPreset = models.some((m) => m.value === value);
  const displayText = isPreset ? (models.find((m) => m.value === value)?.label || value) : value;

  return (
    <div ref={ref} className="flex items-center gap-1 relative nodrag" style={{ position: "relative" }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
      <input
        value={value}
        onChange={(e) => { setCustom(e.target.value); onChange(e.target.value); }}
        onFocus={() => setOpen(true)}
        placeholder="输入模型名..."
        className="nodrag"
        style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: 500, background: "transparent", border: "none", outline: "none", width: "140px", padding: "2px 0", cursor: "text" }}
        title={displayText}
      />
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ cursor: "pointer", flexShrink: 0 }} onClick={() => setOpen((p) => !p)}>
        <polyline points="6 9 12 15 18 9" />
      </svg>
      {open && (
        <div className="nodrag" style={{ position: "absolute", bottom: "100%", left: 0, marginBottom: "4px", backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "8px", boxShadow: "0 4px 12px rgba(0,0,0,0.3)", padding: "4px", zIndex: 50, minWidth: "200px" }} onClick={(e) => e.stopPropagation()}>
          {models.map((m) => (
            <button key={m.value} onClick={() => { onChange(m.value); setOpen(false); }} style={{ display: "block", width: "100%", padding: "6px 10px", border: "none", borderRadius: "4px", backgroundColor: value === m.value ? "var(--bg-hover)" : "transparent", color: value === m.value ? "var(--accent)" : "var(--text-primary)", fontSize: "12px", cursor: "pointer", textAlign: "left" }}>{m.label}</button>
          ))}
          <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />
          <div style={{ fontSize: "10px", color: "var(--text-muted)", padding: "2px 10px" }}>支持任何 OpenAI 兼容的 TTS 模型，直接输入即可</div>
        </div>
      )}
    </div>
  );
}


export const AudioNode = memo(function AudioNode({ data, id, selected }: NodeProps) {
  const { t } = useTranslation();
  const nodeData = data as unknown as AudioNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const showError = useErrorStore((s) => s.showError);
  const addToast = useToastStore((s) => s.addToast);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(nodeData.duration ?? 0);
  const [showExampleModal, setShowExampleModal] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const audioUrl = resolveAudioUrl(nodeData.audioPath);
  const ttsText = nodeData.ttsText ?? "";
  const ttsModel = nodeData.ttsModel ?? TTS_MODELS[0].value;
  const ttsProvider = nodeData.ttsProvider ?? "audio-model";
  const isGenerating = nodeData.isGenerating ?? false;

  // Website build uses only the built-in XiaKeMan audio provider.
  const settingsProviders = useSettingsStore((s) => s.providers);
  const availableTtsProviders = useMemo(() => {
    const audioModel = settingsProviders.find(p => p.id === "audio-model");
    return audioModel ? [{ id: "audio-model", label: "虾客漫音频" }] : [];
  }, [settingsProviders]);


  // Sync duration from node data
  useEffect(() => {
    if (nodeData.duration && nodeData.duration > 0) {
      setDuration(nodeData.duration);
    }
  }, [nodeData.duration]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const handleUpload = useCallback(async () => {
    try {
      const { open } = await import("@/features/canvas/compat/dialog");
      const selectedFile = await open({
        multiple: false,
        filters: [
          {
            name: "Audio",
            extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac"],
          },
        ],
      });
      if (selectedFile) {
        const filePath = selectedFile as string;
        const fileName = filePath.split(/[/\\]/).pop() || "audio.mp3";
        try {
          const persistedPath = await persistAudioSource(filePath);
          updateNodeData(id, {
            audioPath: persistedPath,
            sourceFileName: fileName,
            duration: null,
          });
          addToast("success", `音频已上传 ${fileName}`);
        } catch (e) {
          showError(`音频上传失败: ${e}`);
        }
      }
    } catch (e) {
      showError(`文件对话框打开失败: ${e}`);
    }
  }, [id, updateNodeData, showError, addToast]);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (!file.type.startsWith("audio/")) {
          addToast("error", "请上传音频文件(MP3/WAV/OGG/FLAC/M4A)");
          return;
        }
        try {
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
          const persistedPath = await persistAudioSource(dataUrl);
          updateNodeData(id, {
            audioPath: persistedPath,
            sourceFileName: file.name,
            duration: null,
          });
          addToast("success", `音频已上传 ${file.name}`);
        } catch (e) {
          showError(`音频上传失败: ${e}`);
        }
      }
    },
    [id, updateNodeData, showError, addToast]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) {
      if (!audioUrl) return;
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.addEventListener("timeupdate", () => setCurrentTime(audio.currentTime));
      audio.addEventListener("loadedmetadata", () => {
        setDuration(audio.duration);
        updateNodeData(id, { duration: audio.duration });
      });
      audio.addEventListener("ended", () => {
        setIsPlaying(false);
        setCurrentTime(0);
      });
      audio.play();
      setIsPlaying(true);
    } else if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  }, [audioUrl, isPlaying, id, updateNodeData]);

  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!audioRef.current || !progressRef.current || duration <= 0) return;
      const rect = progressRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const time = ratio * duration;
      setCurrentTime(time);
      audioRef.current.currentTime = time;
    },
    [duration]
  );

  const handleDelete = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    updateNodeData(id, {
      audioPath: null,
      sourceFileName: null,
      duration: null,
    });
  }, [id, updateNodeData]);

  const handleTtsTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      if (text.length <= MAX_TTS_CHARS) {
        updateNodeData(id, { ttsText: text });
      }
    },
    [id, updateNodeData]
  );

  const handleTtsModelChange = useCallback(
    (modelId: string) => {
      updateNodeData(id, { ttsModel: modelId });
    },
    [id, updateNodeData]
  );

  const handleTtsProviderChange = useCallback(
    (providerId: string) => {
      updateNodeData(id, { ttsProvider: providerId });
    },
    [id, updateNodeData]
  );

  const handleInsertPause = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = ttsText;
    const newText = text.slice(0, start) + "<#>" + text.slice(end);
    updateNodeData(id, { ttsText: newText });
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = start + 3;
        textareaRef.current.selectionEnd = start + 3;
        textareaRef.current.focus();
      }
    });
  }, [ttsText, id, updateNodeData]);

  const handleGenerateTTS = useCallback(async () => {
    if (!ttsText.trim()) {
      addToast("error", "请输入要合成的文本");
      return;
    }
    if (nodeData.isGenerating) return;
    updateNodeData(id, { isGenerating: true });
    try {
      const localPath = await generateTts({
        model: ttsModel,
        input: ttsText.trim(),
        voice: "alloy",
        speed: 1.0,
        provider: ttsProvider,
      });
      updateNodeData(id, {
        isGenerating: false,
        generatedAudioPath: localPath,
        generatedFileName: "TTS生成.mp3",
        audioPath: localPath,
        duration: null,
      });
      addToast("success", "TTS 音频已生成");
    } catch (e: any) {
      updateNodeData(id, { isGenerating: false });
      addToast("error", `TTS 生成失败: ${e?.toString?.() || String(e)}`);
    }
  }, [ttsText, ttsModel, ttsProvider, id, updateNodeData, addToast]);

  const ttsCharCount = ttsText.length;
  const toneWordCount = (ttsText.match(/[,。!?、;:\u201c\u201d\u2018\u2019\uff08\uff09\u3010\u3011]/g) || []).length;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  /* ── shared tokens ── */
  const GLOW_SM = "0 0 8px 1px rgba(187,187,187,0.15)";
  const GLOW_MD = "0 0 16px 3px rgba(187,187,187,0.25)";

  const nodeWidth = nodeData.width || 400;
  const nodeHeight = nodeData.height || 400;
  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );

  return (
    <>
      <NodeDeleteButton id={id} selected={selected ?? false} />
    <div style={{ position: 'relative' }}>
    <div
      className="node-inner"
      style={{
        width: nodeWidth,
        height: nodeHeight,
        overflow: 'hidden',
        position: "relative",
        display: "flex",
        flexDirection: "column",
        borderRadius: "var(--node-radius)",
        background: "var(--bg-node)",
        backdropFilter: "blur(16px)",
        border: "1px solid var(--border)",
        boxSizing: "border-box",
        boxShadow: "0 2px 12px rgba(0,0,0,.3)",
      }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Header */}
      <div className="flex items-center justify-between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          </svg>
          <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "160px" }} title={nodeData.displayName || t("canvas.audioNode")}>
            {nodeData.displayName || t("canvas.audioNode")}
          </span>
        </div>
      </div>

      {/* ── Audio player / upload (flex: 0, no shrink) ── */}
      <div style={{ flexShrink: 0, padding: "16px", gap: "12px", display: "flex", flexDirection: "column" }}>
        {audioUrl ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {/* Play + progress row */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <button
                onClick={togglePlay}
                className="nodrag"
                title={isPlaying ? "暂停" : "播放"}
                style={{
                  width: "38px", height: "38px", borderRadius: "50%", border: "none",
                  background: "var(--accent-btn)", color: "#fff", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  boxShadow: isPlaying ? GLOW_MD : GLOW_SM, transition: "all .25s ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-btn-hover)"; e.currentTarget.style.boxShadow = GLOW_MD; e.currentTarget.style.transform = "scale(1.06)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent-btn)"; e.currentTarget.style.boxShadow = isPlaying ? GLOW_MD : GLOW_SM; e.currentTarget.style.transform = "scale(1)"; }}
              >
                {isPlaying ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg>
                )}
              </button>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "3px" }}>
                <div ref={progressRef} onClick={handleSeek} className="nodrag"
                  style={{ width: "100%", height: "5px", borderRadius: "3px", background: "var(--border)", cursor: "pointer", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${progress}%`, borderRadius: "3px", background: "var(--accent-btn)", transition: "width .15s linear" }} />
                  <div style={{ position: "absolute", top: "50%", left: `${progress}%`, transform: "translate(-50%,-50%)", width: "10px", height: "10px", borderRadius: "50%", background: "#fff", transition: "left .15s linear", pointerEvents: "none" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--text-muted)", fontFamily: "monospace", letterSpacing: ".5px" }}>
                  <span>{formatDuration(currentTime)}</span>
                  <span>{duration > 0 ? formatDuration(duration) : "--:--"}</span>
                </div>
              </div>
              <button onClick={handleDelete} className="nodrag" title="删除音频"
                style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px", display: "flex", alignItems: "center", transition: "all .2s" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--error)"; e.currentTarget.style.transform = "scale(1.15)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.transform = "scale(1)"; }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "5px 10px", borderRadius: "6px", background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
              <span style={{ fontSize: "11px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{nodeData.sourceFileName || "音频文件"}</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 cursor-pointer nodrag"
            style={{ minHeight: "60px", border: isDragOver ? "1.5px solid var(--accent)" : "1.5px dashed var(--border)", borderRadius: "10px", transition: "all .3s ease", padding: "14px", background: isDragOver ? "var(--accent-dim)" : "transparent" }}
            onClick={handleUpload}
            onMouseEnter={(e) => { const el = e.currentTarget; el.style.borderColor = "var(--accent)"; el.style.borderStyle = "solid"; el.style.background = "var(--accent-dim)"; }}
            onMouseLeave={(e) => { const el = e.currentTarget; el.style.borderColor = "var(--border)"; el.style.borderStyle = "dashed"; el.style.background = "transparent"; }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", letterSpacing: ".3px" }}>点击上传或拖拽音频文件</span>
          </div>
        )}
      </div>

      {/* ── TTS Section (flex: 1, fills remaining, scrollable) ── */}
      <div style={{ flex: "1 1 0", display: "flex", flexDirection: "column", padding: "0 16px 16px", gap: "12px", overflow: "hidden", minHeight: 0 }}>
        {/* Textarea — scrollable */}
        <textarea
          ref={textareaRef}
          value={ttsText}
          onChange={handleTtsTextChange}
          placeholder={t("canvas.ttsPlaceholder")}
          className="nodrag unified-input"
          style={{ flex: "1 1 0", width: "100%", minHeight: "60px", resize: "none", borderRadius: "8px", padding: "8px 12px", fontSize: "12px", lineHeight: "1.5", fontFamily: "inherit", overflowY: "auto" }}
        />

        {/* Bottom toolbar — same layout as ImageEditNode */}
        <div className="flex items-center justify-between" style={{ flexShrink: 0 }}>
          <div className="flex items-center gap-3">
            {/* TTS Model dropdown */}
            <TtsModelDropdown value={ttsModel} models={TTS_MODELS} onChange={handleTtsModelChange} />

            {/* TTS Provider dropdown */}
            {availableTtsProviders.length > 1 && (
              <TtsModelDropdown value={ttsProvider} models={availableTtsProviders.map(p => ({ value: p.id, label: p.label }))} onChange={handleTtsProviderChange} />
            )}

            {/* Pause insert + tone count */}
            <button onClick={handleInsertPause} className="nodrag"
              style={{ display: "flex", alignItems: "center", gap: "2px", padding: "0", borderRadius: "4px", border: "none", background: "transparent", color: "var(--text-secondary)", fontSize: "12px", cursor: "pointer", transition: "all .2s", whiteSpace: "nowrap" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}>
              <span style={{ fontFamily: "monospace", fontSize: "10px", opacity: 0.7 }}>&lt;#&gt;</span>{t("canvas.ttsPause")}
            </button>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
              <span style={{ fontWeight: 600, color: "var(--accent)" }}>{toneWordCount}</span>{t("canvas.ttsTone")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: "11px", fontFamily: "monospace", color: ttsCharCount > MAX_TTS_CHARS * 0.9 ? "var(--error)" : "rgba(148,163,184,.45)", letterSpacing: ".5px" }}>{ttsCharCount}/{MAX_TTS_CHARS}</span>
            <div style={{ position: "relative" }}>
              <button onClick={handleGenerateTTS} className="nodrag" disabled={isGenerating || !ttsText.trim()}
                style={{ width: "32px", height: "32px", borderRadius: "8px", border: "none", background: ttsText.trim() && !isGenerating ? "var(--accent-btn)" : "var(--bg-hover)", color: ttsText.trim() && !isGenerating ? "#fff" : "var(--text-muted)", cursor: ttsText.trim() && !isGenerating ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", opacity: 0.5 }}>
                {isGenerating ? (
                  <div style={{ width: "14px", height: "14px", border: "2px solid var(--border)", borderTopColor: "var(--text-primary)", borderRadius: "50%" }} />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                )}
              </button>
              <span style={{ position: "absolute", top: "-6px", right: "-6px", fontSize: "8px", padding: "1px 4px", borderRadius: "4px", backgroundColor: "var(--bg-hover)", color: "var(--text-muted)", border: "1px solid var(--border)", whiteSpace: "nowrap", pointerEvents: "none" }}>Beta</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Example Usage Modal ── */}
      {showExampleModal && (
        <div className="nodrag"
          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,.65)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}
          onClick={() => setShowExampleModal(false)}>
          <div style={{ background: "var(--bg-node)", backdropFilter: "blur(20px)", borderRadius: "18px", border: "1px solid var(--border)", padding: "24px", width: "460px", maxWidth: "90vw", display: "flex", flexDirection: "column", gap: "18px", boxShadow: "var(--shadow-float)" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>使用示例</span>
              <button onClick={() => setShowExampleModal(false)}
                style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px", display: "flex", alignItems: "center", transition: "all .2s" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: "12px", padding: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "18px" }}>🔊</span>
                  <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>音频节点</span>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <span style={{ fontSize: "11px", padding: "4px 10px", borderRadius: "6px", background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>本地上传</span>
                  <span style={{ fontSize: "11px", padding: "4px 10px", borderRadius: "6px", background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>AI 语音合成</span>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "center", color: "var(--text-muted)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
              </div>
              <div style={{ background: "var(--accent-dim)", border: "1px solid var(--border)", borderRadius: "12px", padding: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "18px" }}>🎬</span>
                  <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>视频生成节点</span>
                </div>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>连接音频节点作为生成参数——音频驱动视频生成</span>
              </div>
            </div>
            <button onClick={() => setShowExampleModal(false)} className="nodrag"
              style={{ width: "100%", padding: "10px", borderRadius: "10px", border: "none", background: "var(--accent-btn)", color: "#fff", fontSize: "13px", fontWeight: 500, cursor: "pointer", transition: "all .25s" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-btn-hover)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent-btn)"; e.currentTarget.style.transform = "translateY(0)"; }}>知道了</button>
          </div>
        </div>
      )}
    </div>
    <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize} minWidth={400} maxWidth={900} minHeight={300} maxHeight={1200} />
    </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[var(--accent-secondary)] !w-6 !h-6 !border-2 !border-[var(--bg-node)]"
      />
    </>
  );
});



