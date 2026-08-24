import { create } from "zustand";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  hint?: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: "danger" | "warning" | "default";
  onConfirm: (() => void | Promise<void>) | null;
  onCancel: (() => void) | null;
}

interface ConfirmActions {
  showConfirm: (options: {
    title?: string;
    message: string;
    hint?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: "danger" | "warning" | "default";
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
  }) => void;
  closeConfirm: () => void;
}

export const useConfirmStore = create<ConfirmState & ConfirmActions>((set) => ({
  isOpen: false,
  title: "",
  message: "",
  hint: undefined,
  confirmLabel: "",
  cancelLabel: "",
  variant: "default",
  onConfirm: null,
  onCancel: null,

  showConfirm: (options) =>
    set({
      isOpen: true,
      title: options.title || "",
      message: options.message,
      hint: options.hint,
      confirmLabel: options.confirmLabel || "",
      cancelLabel: options.cancelLabel || "",
      variant: options.variant || "default",
      onConfirm: options.onConfirm,
      onCancel: options.onCancel || null,
    }),

  closeConfirm: () =>
    set({
      isOpen: false,
      title: "",
      message: "",
      hint: undefined,
      confirmLabel: "",
      cancelLabel: "",
      variant: "default",
      onConfirm: null,
      onCancel: null,
    }),
}));

// ---------------------------------------------------------------------------
// Convenience hook
// ---------------------------------------------------------------------------

export function useConfirm() {
  const showConfirm = useConfirmStore((s) => s.showConfirm);
  return showConfirm;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function DangerIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfirmDialog() {
  const { t } = useTranslation();
  const state = useConfirmStore();
  const { isOpen, title, message, hint, confirmLabel, cancelLabel, variant, onConfirm, onCancel, closeConfirm } = state;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    try {
      await onConfirm?.();
    } catch {
      // onConfirm handles errors internally; this is a safety net
    }
    closeConfirm();
  };

  const handleCancel = () => {
    onCancel?.();
    closeConfirm();
  };

  const variantConfig = {
    danger: {
      iconBg: "color-mix(in srgb, var(--error) 12%, transparent)",
      iconColor: "var(--error)",
      icon: <DangerIcon />,
      btnBg: "var(--error)",
      btnHover: "var(--error)",
      btnText: "var(--text-primary)",
      btnShadow: "var(--shadow-card)",
    },
    warning: {
      iconBg: "color-mix(in srgb, var(--warning) 12%, transparent)",
      iconColor: "var(--warning)",
      icon: <WarningIcon />,
      btnBg: "var(--warning)",
      btnHover: "var(--warning)",
      btnText: "var(--text-primary)",
      btnShadow: "var(--shadow-card)",
    },
    default: {
      iconBg: "var(--accent-dim)",
      iconColor: "var(--accent)",
      icon: <InfoIcon />,
      btnBg: "var(--accent-btn)",
      btnHover: "var(--accent-btn-hover)",
      btnText: "var(--text-primary)",
      btnShadow: "var(--shadow-card)",
    },
  };

  const config = variantConfig[variant] || variantConfig.default;

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
          className="flex flex-col items-center text-center"
          style={{ padding: "32px 28px 24px" }}
        >
          {/* Icon */}
          <div
            className="flex items-center justify-center"
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "16px",
              backgroundColor: config.iconBg,
              color: config.iconColor,
              marginBottom: "16px",
              flexShrink: 0,
            }}
          >
            {config.icon}
          </div>

          {/* Title */}
          {title && (
            <h3
              style={{
                fontSize: "17px",
                fontWeight: 600,
                color: "var(--text-primary)",
                marginBottom: "8px",
                lineHeight: 1.4,
              }}
            >
              {title}
            </h3>
          )}

          {/* Message */}
          <p
            style={{
              fontSize: "14px",
              lineHeight: 1.6,
              color: "var(--text-secondary)",
              maxWidth: "320px",
            }}
          >
            {message}
          </p>

          {/* Hint */}
          {hint && (
            <p
              style={{
                fontSize: "12px",
                lineHeight: 1.5,
                color: "var(--text-muted)",
                marginTop: "10px",
                maxWidth: "320px",
              }}
            >
              {hint}
            </p>
          )}
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
            {cancelLabel || t("common.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            style={{
              padding: "9px 20px",
              fontSize: "14px",
              fontWeight: 500,
              color: config.btnText,
              backgroundColor: config.btnBg,
              border: "none",
              borderRadius: "12px",
              cursor: "pointer",
              boxShadow: config.btnShadow,
              transition: "all 0.15s ease",
              minWidth: "90px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = config.btnHover;
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = config.btnShadow.replace("0 1px", "0 3px");
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = config.btnBg;
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = config.btnShadow;
            }}
          >
            {confirmLabel || t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

