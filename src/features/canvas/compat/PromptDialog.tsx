import { create } from "zustand";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface PromptField {
  key: string;
  label: string;
  defaultValue: string;
}

interface PromptState {
  isOpen: boolean;
  title: string;
  fields: PromptField[];
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: ((values: Record<string, string>) => void | Promise<void>) | null;
  onCancel: (() => void) | null;
}

interface PromptActions {
  showPrompt: (options: {
    title: string;
    fields: PromptField[];
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: (values: Record<string, string>) => void | Promise<void>;
    onCancel?: () => void;
  }) => void;
  closePrompt: () => void;
}

export const usePromptStore = create<PromptState & PromptActions>((set) => ({
  isOpen: false,
  title: "",
  fields: [],
  confirmLabel: "",
  cancelLabel: "",
  onConfirm: null,
  onCancel: null,

  showPrompt: (options) =>
    set({
      isOpen: true,
      title: options.title,
      fields: options.fields,
      confirmLabel: options.confirmLabel || "",
      cancelLabel: options.cancelLabel || "",
      onConfirm: options.onConfirm,
      onCancel: options.onCancel || null,
    }),

  closePrompt: () =>
    set({
      isOpen: false,
      title: "",
      fields: [],
      confirmLabel: "",
      cancelLabel: "",
      onConfirm: null,
      onCancel: null,
    }),
}));

// ---------------------------------------------------------------------------
// Convenience hook — returns a function like prompt() but async & themed
// ---------------------------------------------------------------------------

export function usePrompt() {
  const showPrompt = usePromptStore((s) => s.showPrompt);
  /**
   * Show a themed input dialog with one or more fields.
   * Returns a Promise that resolves with the entered values (key→string),
   * or undefined if the user cancelled.
   */
  return (options: {
    title: string;
    fields: PromptField[];
    confirmLabel?: string;
    cancelLabel?: string;
  }): Promise<Record<string, string> | undefined> => {
    return new Promise((resolve) => {
      showPrompt({
        ...options,
        onConfirm: (values) => resolve(values),
        onCancel: () => resolve(undefined),
      });
    });
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PromptDialog() {
  const state = usePromptStore();
  const { isOpen, title, fields, confirmLabel, cancelLabel, onConfirm, onCancel, closePrompt } = state;
  const [visible, setVisible] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  // Initialize values when dialog opens
  useEffect(() => {
    if (isOpen) {
      const init: Record<string, string> = {};
      for (const f of fields) {
        init[f.key] = f.defaultValue;
      }
      setValues(init);
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [isOpen, fields]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    try {
      await onConfirm?.(values);
    } catch {
      // onConfirm handles errors internally
    }
    closePrompt();
  };

  const handleCancel = () => {
    onCancel?.();
    closePrompt();
  };

  const handleFieldChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center"
      style={{
        backgroundColor: visible ? "var(--glass-bg)" : "transparent",
        backdropFilter: "blur(4px)",
        transition: "background-color 0.25s ease",
      }}
      onClick={handleCancel}
    >
      <div
        className="relative w-full mx-4 overflow-hidden"
        style={{
          maxWidth: "400px",
          backgroundColor: "var(--bg-surface)",
          borderRadius: "20px",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-float)",
          transform: visible ? "scale(1) translateY(0)" : "scale(0.92) translateY(8px)",
          opacity: visible ? 1 : 0,
          transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={handleCancel}
          className="absolute top-4 right-4 flex items-center justify-center"
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "8px",
            backgroundColor: "transparent",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            transition: "all 0.15s ease",
            zIndex: 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
            e.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Content */}
        <div
          className="flex flex-col"
          style={{ padding: "28px 28px 20px" }}
        >
          {/* Title */}
          {title && (
            <h3
              style={{
                fontSize: "17px",
                fontWeight: 600,
                color: "var(--text-primary)",
                marginBottom: "20px",
                lineHeight: 1.4,
              }}
            >
              {title}
            </h3>
          )}

          {/* Input fields */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {fields.map((f) => (
              <div key={f.key}>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    marginBottom: "6px",
                    fontWeight: 500,
                  }}
                >
                  {f.label}
                </label>
                <input
                  type="text"
                  value={values[f.key] ?? f.defaultValue}
                  onChange={(e) => handleFieldChange(f.key, e.target.value)}
                  className="nodrag"
                  autoFocus={fields[0]?.key === f.key}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirm();
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--bg-primary)",
                    color: "var(--text-primary)",
                    fontSize: "14px",
                    outline: "none",
                    boxSizing: "border-box",
                    transition: "border-color 0.15s ease",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-center"
          style={{
            gap: "10px",
            padding: "0 28px 28px",
          }}
        >
          <button
            onClick={handleCancel}
            style={{
              padding: "9px 20px",
              fontSize: "14px",
              fontWeight: 500,
              color: "var(--text-secondary)",
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "12px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              minWidth: "90px",
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
            {cancelLabel || "取消"}
          </button>
          <button
            onClick={handleConfirm}
            style={{
              padding: "9px 20px",
              fontSize: "14px",
              fontWeight: 500,
              color: "var(--text-primary)",
              backgroundColor: "var(--accent-btn)",
              border: "none",
              borderRadius: "12px",
              cursor: "pointer",
              boxShadow: "var(--shadow-card)",
              transition: "all 0.15s ease",
              minWidth: "90px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--accent-btn-hover)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--accent-btn)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            {confirmLabel || "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}

