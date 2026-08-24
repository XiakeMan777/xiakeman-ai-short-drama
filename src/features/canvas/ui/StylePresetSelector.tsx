import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StylePreset {
  id: string;
  name: string;
  providerId: string;
  modelId: string;
  aspectRatio?: string;
  imageSize?: string;
  nodeType: "image" | "video";
  createdAt: number;
}

interface StylePresetSelectorProps {
  currentPreset: Omit<StylePreset, "id" | "name" | "createdAt">;
  onApply: (preset: StylePreset) => void;
  nodeType: "image" | "video";
  /** Custom style for the container */
  style?: React.CSSProperties;
}

const PRESETS_KEY = "style-presets-v1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadPresets(): StylePreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePresets(presets: StylePreset[]) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch {}
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StylePresetSelector({
  currentPreset,
  onApply,
  nodeType,
  style,
}: StylePresetSelectorProps) {
  const [presets, setPresets] = useState<StylePreset[]>(loadPresets);
  const [open, setOpen] = useState(false);

  // Filter presets by node type
  const filteredPresets = presets.filter((p) => p.nodeType === nodeType);

  const handleSave = useCallback(() => {
    const name = window.prompt("预设名称:", "我的预设");
    if (!name?.trim()) return;
    const newPreset: StylePreset = {
      id: `preset-${Date.now()}`,
      name: name.trim(),
      providerId: currentPreset.providerId,
      modelId: currentPreset.modelId,
      aspectRatio: currentPreset.aspectRatio,
      imageSize: currentPreset.imageSize,
      nodeType,
      createdAt: Date.now(),
    };
    const updated = [newPreset, ...presets].slice(0, 30); // max 30 presets
    setPresets(updated);
    savePresets(updated);
    setOpen(false);
  }, [currentPreset, nodeType, presets]);

  const handleDelete = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = presets.filter((p) => p.id !== id);
    setPresets(updated);
    savePresets(updated);
  }, [presets]);

  const handleApply = useCallback((preset: StylePreset) => {
    onApply(preset);
    setOpen(false);
  }, [onApply]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-preset-selector]")) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div data-preset-selector style={{ position: "relative", ...style }}>
      <button
        type="button"
        className="nodrag"
        onClick={() => setOpen((v) => !v)}
        title="风格预设"
        style={{
          padding: "3px 8px",
          borderRadius: 6,
          border: `0.5px solid ${open ? "#7ab4f0" : "#2e2e34"}`,
          background: open ? "rgba(122,180,240,0.1)" : "transparent",
          color: "#a0a0a8",
          fontSize: 11,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
          transition: "all 0.15s",
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 20V10M18 20V4M6 20v-4" />
        </svg>
        预设
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            zIndex: 1000,
            width: 240,
            background: "#25252a",
            border: "0.5px solid #2e2e34",
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            overflow: "hidden",
          }}
        >
          {/* Save current */}
          <div
            onClick={handleSave}
            style={{
              padding: "8px 12px",
              fontSize: 12,
              color: "#7ab4f0",
              cursor: "pointer",
              borderBottom: "0.5px solid #2e2e34",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            + 保存当前配置为预设
          </div>

          {/* Preset list */}
          <div style={{ maxHeight: 200, overflow: "auto" }}>
            {filteredPresets.length === 0 ? (
              <div style={{ padding: "12px", fontSize: 11, color: "#5a5a62", textAlign: "center" }}>
                暂无预设，点击上方保存
              </div>
            ) : (
              filteredPresets.map((preset) => (
                <div
                  key={preset.id}
                  onClick={() => handleApply(preset)}
                  style={{
                    padding: "8px 12px",
                    fontSize: 12,
                    color: "#f0f0f5",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderBottom: "0.5px solid #2e2e34",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {preset.name}
                    </div>
                    <div style={{ fontSize: 10, color: "#5a5a62", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {preset.modelId}
                      {preset.aspectRatio ? ` · ${preset.aspectRatio}` : ""}
                      {preset.imageSize ? ` · ${preset.imageSize}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="nodrag"
                    onClick={(e) => handleDelete(preset.id, e)}
                    title="删除预设"
                    style={{
                      background: "none",
                      border: "none",
                      color: "#5a5a62",
                      fontSize: 14,
                      cursor: "pointer",
                      padding: "2px 4px",
                      flexShrink: 0,
                      marginLeft: 8,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}



