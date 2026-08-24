import { useState, useCallback } from "react";
import type { AssetCategory } from "@/features/canvas/stores/assetStore";

// ---------------------------------------------------------------------------
// AssetCategoryDialog — dialog for picking category, name, and tags
// U11: Import shared CATEGORIES from assetStore instead of duplicating
// U4:  Add tags input field
// ---------------------------------------------------------------------------

/** Categories without "全部" — used for picking a specific category */
export const ASSET_EDIT_CATEGORIES: { value: Exclude<AssetCategory, "全部">; label: string }[] = [
  { value: "场景", label: "场景" },
  { value: "模特", label: "模特" },
  { value: "道具", label: "道具" },
];

interface AssetCategoryDialogProps {
  /** Default name to pre-fill (e.g. from node image filename). */
  defaultName?: string;
  /** Default tags to pre-fill (for edit mode). */
  defaultTags?: string;
  /** Default category to pre-fill (for edit mode). */
  defaultCategory?: string;
  /** Dialog title. */
  title?: string;
  /** Confirm button label. */
  confirmLabel?: string;
  /** Called when user confirms. */
  onConfirm: (params: { name: string; category: string; tags: string }) => void;
  /** Called when user cancels. */
  onCancel: () => void;
}

export function AssetCategoryDialog({
  defaultName = "",
  defaultTags = "",
  defaultCategory = "场景",
  title = "加入素材库",
  confirmLabel = "确定",
  onConfirm,
  onCancel,
}: AssetCategoryDialogProps) {
  const [name, setName] = useState(defaultName);
  const [category, setCategory] = useState<string>(defaultCategory);
  const [tags, setTags] = useState(defaultTags); // U4: Tags input

  const handleConfirm = useCallback(() => {
    if (!name.trim()) return;
    onConfirm({ name: name.trim(), category, tags: tags.trim() });
  }, [name, category, tags, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleConfirm();
      } else if (e.key === "Escape") {
        e.stopPropagation(); // Fix C2: prevent parent panel from also closing
        onCancel();
      }
    },
    [handleConfirm, onCancel]
  );

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center"
      role="dialog" // U12: Accessibility
      aria-label={title}
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onCancel}
    >
      <div
        style={{
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "14px",
          padding: "20px",
          width: "380px", // slightly wider for tags
          boxShadow: "var(--shadow-panel)",
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Title */}
        <h3
          style={{
            fontSize: "15px",
            fontWeight: 600,
            color: "var(--text-primary)",
            marginBottom: "16px",
          }}
        >
          {title}
        </h3>

        {/* Name input */}
        <div style={{ marginBottom: "14px" }}>
          <label
            style={{
              display: "block",
              fontSize: "12px",
              color: "var(--text-secondary)",
              marginBottom: "6px",
            }}
          >
            名称
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入素材名称"
            autoFocus
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: "13px",
              color: "var(--text-primary)",
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              outline: "none",
              boxSizing: "border-box",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
            }}
          />
        </div>

        {/* Category selector */}
        <div style={{ marginBottom: "14px" }}>
          <label
            style={{
              display: "block",
              fontSize: "12px",
              color: "var(--text-secondary)",
              marginBottom: "6px",
            }}
          >
            分类
          </label>
          <div className="flex" style={{ gap: "8px" }}>
            {ASSET_EDIT_CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                style={{
                  flex: 1,
                  padding: "7px 0",
                  fontSize: "13px",
                  fontWeight: 500,
                  color:
                    category === cat.value
                      ? "var(--text-primary)"
                      : "var(--text-secondary)",
                  backgroundColor:
                    category === cat.value
                      ? "var(--accent-muted)"
                      : "var(--bg-secondary)",
                  border:
                    category === cat.value
                      ? "1px solid var(--accent-light)"
                      : "1px solid var(--border)",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                // U10: Add hover feedback for unselected buttons
                onMouseEnter={(e) => {
                  if (category !== cat.value) {
                    e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text-primary)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (category !== cat.value) {
                    e.currentTarget.style.backgroundColor = "var(--bg-secondary)";
                    e.currentTarget.style.color = "var(--text-secondary)";
                  }
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tags input — U4 */}
        <div style={{ marginBottom: "18px" }}>
          <label
            style={{
              display: "block",
              fontSize: "12px",
              color: "var(--text-secondary)",
              marginBottom: "6px",
            }}
          >
            标签 <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>（逗号分隔）</span>
          </label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="如：人物, 红裙, 城市"
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: "13px",
              color: "var(--text-primary)",
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              outline: "none",
              boxSizing: "border-box",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
            }}
          />
        </div>

        {/* Buttons */}
        <div className="flex justify-end" style={{ gap: "8px" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "7px 16px",
              fontSize: "13px",
              color: "var(--text-secondary)",
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!name.trim()}
            style={{
              padding: "7px 16px",
              fontSize: "13px",
              fontWeight: 500,
              color: name.trim() ? "#fff" : "var(--text-muted)",
              backgroundColor: name.trim() ? "var(--accent-btn)" : "var(--bg-secondary)",
              border: "none",
              borderRadius: "8px",
              cursor: name.trim() ? "pointer" : "not-allowed",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}


