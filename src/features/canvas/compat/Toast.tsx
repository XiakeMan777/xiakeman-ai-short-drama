import { create } from "zustand";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastType = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastState {
  toasts: ToastItem[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let toastCounter = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (type, message, duration = 3000) => {
    const id = `toast-${++toastCounter}`;
    set((state) => ({
      toasts: [...state.toasts, { id, type, message, duration }],
    }));

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, duration);
    }
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));

// ---------------------------------------------------------------------------
// Convenience hook
// ---------------------------------------------------------------------------

export function useToast() {
  const addToast = useToastStore((s) => s.addToast);
  return {
    success: (msg: string, duration?: number) => addToast("success", msg, duration),
    error: (msg: string, duration?: number) => addToast("error", msg, duration ?? 5000),
    info: (msg: string, duration?: number) => addToast("info", msg, duration),
    warning: (msg: string, duration?: number) => addToast("warning", msg, duration ?? 5000),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const typeConfig: Record<ToastType, { icon: string; bg: string; border: string; text: string }> = {
  success: { icon: "✓", bg: "rgba(46, 189, 127, 0.12)", border: "rgba(46, 189, 127, 0.3)", text: "#2ebd7f" },
  error: { icon: "✕", bg: "rgba(224, 82, 82, 0.12)", border: "rgba(224, 82, 82, 0.3)", text: "#e05252" },
  info: { icon: "ℹ", bg: "rgba(255, 255, 255, 0.04)", border: "rgba(255, 255, 255, 0.08)", text: "#9ca3af" },
  warning: { icon: "⚠", bg: "rgba(212, 162, 78, 0.12)", border: "rgba(212, 162, 78, 0.3)", text: "#d4a24e" },
};

function ToastItemComponent({ toast }: { toast: ToastItem }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const [visible, setVisible] = useState(false);
  const config = typeConfig[toast.type];

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  return (
    <div
      className={`flex items-center gap-2 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-sm transform transition-all duration-300 ${
        visible ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
      }`}
      style={{
        background: config.bg,
        borderColor: config.border,
        backdropFilter: 'blur(12px)',
      }}
    >
      <span className="text-base font-bold shrink-0" style={{ color: config.text }}>{config.icon}</span>
      <span className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>{toast.message}</span>
      <button
        onClick={() => removeToast(toast.id)}
        className="shrink-0 transition-colors ml-2"
        style={{ color: 'rgba(255,255,255,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
      >
        ✕
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-12 right-4 z-[110] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItemComponent key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

