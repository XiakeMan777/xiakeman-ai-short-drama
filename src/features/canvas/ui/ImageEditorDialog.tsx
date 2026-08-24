import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { resolveImageDisplayUrl } from "../application/imageData";

// ─── Constants ──────────────────────────────────────────────────────────────

const TOOLBAR_HEIGHT = 60; // approximate toolbar + margin
const TIP_HEIGHT = 30; // bottom tip text
const OVERHEAD = TOOLBAR_HEIGHT + TIP_HEIGHT + 20;
const MAX_W_PCT = 0.92;
const MAX_H_PCT = 0.78;

// ─── Types ──────────────────────────────────────────────────────────────────

interface ImageEditorDialogProps {
  imageUrl: string;
  onSave: (editedImageUrl: string) => void;
  onClose: () => void;
}

type Tool = "pen" | "eraser" | "text";

// ─── Component ──────────────────────────────────────────────────────────────

export function ImageEditorDialog({ imageUrl, onSave, onClose }: ImageEditorDialogProps) {
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#ff0000");
  const [lineWidth, setLineWidth] = useState(3);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
  const [textInput, setTextInput] = useState<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });
  const [textValue, setTextValue] = useState("");
  const textInputRef = useRef<HTMLInputElement>(null);
  const undoStackRef = useRef<ImageData[]>([]);
  const [saving, setSaving] = useState(false);

  // Convert URL for display
  const displayUrl = useMemo(() => resolveImageDisplayUrl(imageUrl), [imageUrl]);

  // Load background image and compute canvas size that ALWAYS fits viewport
  useEffect(() => {
    setReady(false);
    const img = new Image();
    if (displayUrl.startsWith("http://") || displayUrl.startsWith("https://")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      const viewW = window.innerWidth;
      const viewH = window.innerHeight;
      const maxAvailableW = viewW * MAX_W_PCT;
      const maxAvailableH = (viewH * MAX_H_PCT) - OVERHEAD;

      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;

      // Always scale to fit within available viewport space
      const scaleW = maxAvailableW / imgW;
      const scaleH = maxAvailableH / imgH;
      const scale = Math.min(scaleW, scaleH, 1); // never upscale (avoid blur)
      const w = Math.round(imgW * scale);
      const h = Math.round(imgH * scale);

      setCanvasSize({ w: Math.max(w, 100), h: Math.max(h, 100) });
      bgImageRef.current = img;
      setReady(true);
    };
    img.onerror = () => {
      setCanvasSize({ w: 800, h: 600 });
      bgImageRef.current = null;
      setReady(true);
    };
    img.src = displayUrl;
  }, [displayUrl]);

  // Resize handler — recalculate on window resize
  useEffect(() => {
    const handleResize = () => {
      if (!bgImageRef.current) return;
      const imgW = bgImageRef.current.naturalWidth;
      const imgH = bgImageRef.current.naturalHeight;
      const viewW = window.innerWidth;
      const viewH = window.innerHeight;
      const maxAvailableW = viewW * MAX_W_PCT;
      const maxAvailableH = (viewH * MAX_H_PCT) - OVERHEAD;
      const scaleW = maxAvailableW / imgW;
      const scaleH = maxAvailableH / imgH;
      const scale = Math.min(scaleW, scaleH, 1);
      const w = Math.round(imgW * scale);
      const h = Math.round(imgH * scale);
      setCanvasSize({ w: Math.max(w, 100), h: Math.max(h, 100) });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Draw background onto bgCanvas once ready
  useEffect(() => {
    if (!ready) return;
    const bgCanvas = bgCanvasRef.current;
    if (!bgCanvas) return;
    bgCanvas.width = canvasSize.w;
    bgCanvas.height = canvasSize.h;
    const ctx = bgCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvasSize.w, canvasSize.h);
    if (bgImageRef.current) {
      ctx.drawImage(bgImageRef.current, 0, 0, canvasSize.w, canvasSize.h);
    }
    // Also resize draw canvas
    const drawCanvas = drawCanvasRef.current;
    if (drawCanvas) {
      drawCanvas.width = canvasSize.w;
      drawCanvas.height = canvasSize.h;
      drawCanvas.getContext("2d")!.clearRect(0, 0, canvasSize.w, canvasSize.h);
    }
    // Clear undo stack when canvas resizes
    undoStackRef.current = [];
  }, [ready, canvasSize]);

  // ── Undo ──────────────────────────────────────────────────────────────────

  const pushUndo = useCallback(() => {
    const drawCanvas = drawCanvasRef.current;
    if (!drawCanvas) return;
    const ctx = drawCanvas.getContext("2d")!;
    const data = ctx.getImageData(0, 0, canvasSize.w, canvasSize.h);
    undoStackRef.current.push(data);
    if (undoStackRef.current.length > 30) {
      undoStackRef.current.shift();
    }
  }, [canvasSize]);

  const undo = useCallback(() => {
    const drawCanvas = drawCanvasRef.current;
    if (!drawCanvas || undoStackRef.current.length === 0) return;
    const ctx = drawCanvas.getContext("2d")!;
    const prev = undoStackRef.current.pop()!;
    ctx.putImageData(prev, 0, 0);
  }, []);

  const clearDrawings = useCallback(() => {
    pushUndo();
    const drawCanvas = drawCanvasRef.current;
    if (!drawCanvas) return;
    const ctx = drawCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvasSize.w, canvasSize.h);
  }, [pushUndo, canvasSize]);

  // ── Coordinate helper — canvas internals match CSS px exactly ──────────

  const getPos = (e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = drawCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  // ── Drawing handlers (incremental) ──────────────────────────────────────

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === "pen" || tool === "eraser") {
      e.stopPropagation();
      e.preventDefault();
      pushUndo();
      isDrawingRef.current = true;
      const pos = getPos(e);
      lastPosRef.current = pos;
      const ctx = drawCanvasRef.current!.getContext("2d")!;
      ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = tool === "eraser" ? "rgba(0,0,0,1)" : color;
      ctx.lineWidth = tool === "eraser" ? lineWidth * 4 : lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(pos.x + 0.1, pos.y + 0.1);
      ctx.stroke();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !lastPosRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const pos = getPos(e);
    const ctx = drawCanvasRef.current!.getContext("2d")!;
    ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = tool === "eraser" ? "rgba(0,0,0,1)" : color;
    ctx.lineWidth = tool === "eraser" ? lineWidth * 4 : lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPosRef.current = pos;
  };

  const handlePointerUp = () => {
    isDrawingRef.current = false;
    lastPosRef.current = null;
    if (drawCanvasRef.current) {
      drawCanvasRef.current.getContext("2d")!.globalCompositeOperation = "source-over";
    }
  };

  useEffect(() => {
    const handler = () => handlePointerUp();
    window.addEventListener("pointerup", handler);
    return () => window.removeEventListener("pointerup", handler);
  }, []);

  // ── Text ────────────────────────────────────────────────────────────────

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== "text") return;
    e.stopPropagation();
    const pos = getPos(e);
    setTextInput({ x: pos.x, y: pos.y, visible: true });
    setTextValue("");
    setTimeout(() => textInputRef.current?.focus(), 50);
  };

  const commitText = () => {
    if (!textValue.trim() || !drawCanvasRef.current) {
      setTextInput((t) => ({ ...t, visible: false }));
      return;
    }
    pushUndo();
    const ctx = drawCanvasRef.current.getContext("2d")!;
    const fontSize = Math.max(16, lineWidth * 6);
    ctx.globalCompositeOperation = "source-over";
    ctx.font = `bold ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = color;
    ctx.textBaseline = "bottom";
    ctx.fillText(textValue, textInput.x, textInput.y);
    setTextInput((t) => ({ ...t, visible: false }));
    setTextValue("");
  };

  const handleTextKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); commitText(); }
    if (e.key === "Escape") setTextInput((t) => ({ ...t, visible: false }));
  };

  // ── Save ────────────────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    setSaving(true);
    try {
      const w = canvasSize.w;
      const h = canvasSize.h;
      const merged = document.createElement("canvas");
      merged.width = w;
      merged.height = h;
      const mctx = merged.getContext("2d")!;

      if (bgCanvasRef.current) {
        mctx.drawImage(bgCanvasRef.current, 0, 0);
      }
      if (drawCanvasRef.current) {
        mctx.drawImage(drawCanvasRef.current, 0, 0);
      }

      const dataUrl = merged.toDataURL("image/png");
      onSave(dataUrl);
    } catch (err) {
      console.error("[ImageEditor] Save failed:", err);
      try {
        if (drawCanvasRef.current) {
          const dataUrl = drawCanvasRef.current.toDataURL("image/png");
          onSave(dataUrl);
        }
      } catch (err2) {
        console.error("[ImageEditor] Fallback save also failed:", err2);
      }
    } finally {
      setSaving(false);
    }
  }, [canvasSize, onSave]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "z") { e.preventDefault(); undo(); }
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, onClose]);

  // ── Tool button helper ──────────────────────────────────────────────────

  const ToolBtn = ({ t, icon, label }: { t: Tool; icon: string; label: string }) => (
    <button className="nodrag" onClick={() => setTool(t)}
      style={{
        padding: "8px 14px", borderRadius: "8px",
        border: tool === t ? "2px solid var(--accent, #7ab4f0)" : "1px solid var(--border, #2e2e34)",
        background: tool === t ? "rgba(122,180,240,0.15)" : "var(--bg-surface, #25252a)",
        color: tool === t ? "var(--accent, #7ab4f0)" : "var(--text-secondary, #a0a0a8)",
        fontSize: "13px", fontWeight: 600, cursor: "pointer",
        display: "flex", alignItems: "center", gap: "5px", transition: "all 0.15s",
      }}
    ><span style={{ fontSize: "16px" }}>{icon}</span> {label}</button>
  );

  // Text input position — map canvas coords to screen coords
  const getTextInputPos = () => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return { left: "50%", top: "50%" };
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvasSize.w;
    const scaleY = rect.height / canvasSize.h;
    return {
      left: (rect.left + textInput.x * scaleX) + "px",
      top: (rect.top + textInput.y * scaleY) + "px",
    };
  };

  if (!ready) {
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 999,
        background: "rgba(0,0,0,0.85)", display: "flex",
        alignItems: "center", justifyContent: "center",
        color: "#fff", fontSize: "16px",
      }}>
        加载中...
      </div>
    );
  }

  return (
    <div className="nodrag"
      style={{
        position: "fixed", inset: 0, zIndex: 999,
        background: "rgba(0,0,0,0.85)", display: "flex",
        flexDirection: "column", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Toolbar */}
      <div className="nodrag" style={toolbarStyle}>
        <ToolBtn t="pen" icon="✏️" label="画笔" />
        <ToolBtn t="eraser" icon="🧹" label="橡皮" />
        <ToolBtn t="text" icon="🔤" label="文字" />
        <div style={dividerStyle} />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="nodrag"
          style={{ width: "32px", height: "32px", border: "1px solid var(--border)", borderRadius: "6px", cursor: "pointer", background: "transparent" }} />
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "11px", color: "var(--text-muted, #666)" }}>粗细</span>
          <input type="range" className="nodrag" min={1} max={20} value={lineWidth}
            onChange={(e) => setLineWidth(Number(e.target.value))}
            style={{ width: "60px", accentColor: "var(--accent, #7ab4f0)" }} />
          <span style={{ fontSize: "11px", color: "var(--text-secondary)", width: "20px" }}>{lineWidth}</span>
        </div>
        <div style={dividerStyle} />
        <button className="nodrag" onClick={undo} style={actionBtnStyle}>↩ 撤销</button>
        <button className="nodrag" onClick={clearDrawings} style={actionBtnStyle}>🗑 清除</button>
        <div style={dividerStyle} />
        <button className="nodrag" onClick={handleSave} disabled={saving}
          style={{ ...actionBtnStyle, background: "var(--accent, #7ab4f0)", color: "#fff", border: "none", fontWeight: 700, opacity: saving ? 0.6 : 1 }}>
          {saving ? "⏳ 保存中" : "✅ 保存"}
        </button>
        <button className="nodrag" onClick={onClose} style={actionBtnStyle}>✕ 取消</button>
      </div>

      {/* Canvas container — explicit pixel dimensions, NO clipping */}
      <div className="nodrag"
        style={{
          position: "relative",
          width: canvasSize.w,
          height: canvasSize.h,
          border: "1px solid var(--border, #2e2e34)",
          borderRadius: "8px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          background: "#111",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {/* Background layer — image only */}
        <canvas
          ref={bgCanvasRef}
          style={{
            display: "block",
            width: canvasSize.w,
            height: canvasSize.h,
          }}
        />
        {/* Drawing layer — transparent, on top of bg */}
        <canvas
          ref={drawCanvasRef}
          className="nodrag"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: canvasSize.w,
            height: canvasSize.h,
            cursor: tool === "text" ? "text" : "crosshair",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onClick={handleCanvasClick}
        />
      </div>

      {/* Text input overlay */}
      {textInput.visible && (
        <div className="nodrag" style={{
          position: "fixed",
          ...getTextInputPos(),
          zIndex: 1001,
        }}>
          <input ref={textInputRef} className="nodrag" type="text"
            value={textValue} onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={handleTextKeyDown} onBlur={commitText}
            placeholder="输入文字后按 Enter..."
            style={{
              padding: "6px 10px", background: "rgba(0,0,0,0.9)",
              border: `2px solid ${color}`, borderRadius: "4px", color: "#fff",
              fontSize: Math.max(14, lineWidth * 4) + "px",
              fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
              outline: "none", minWidth: "200px",
              transform: "translateY(-100%)",
            }}
          />
        </div>
      )}

      <div style={{ marginTop: "10px", fontSize: "11px", color: "var(--text-muted, #666)", flexShrink: 0 }}>
        提示：Ctrl+Z 撤销 | Esc 关闭 | 选择文字工具后点击画布放置文字
      </div>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const toolbarStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "10px",
  padding: "10px 16px", background: "var(--bg-node, #2a2a2e)",
  border: "1px solid var(--border, #2e2e34)", borderRadius: "12px",
  marginBottom: "10px", flexWrap: "wrap", justifyContent: "center",
  maxWidth: "94vw",
  flexShrink: 0,
};

const dividerStyle: React.CSSProperties = {
  width: "1px", height: "24px", background: "var(--border, #2e2e34)", margin: "0 4px",
};

const actionBtnStyle: React.CSSProperties = {
  padding: "8px 14px", borderRadius: "8px",
  border: "1px solid var(--border, #2e2e34)",
  background: "var(--bg-surface, #25252a)",
  color: "var(--text-secondary, #a0a0a8)",
  fontSize: "13px", fontWeight: 600,
  cursor: "pointer", transition: "all 0.15s",
};



