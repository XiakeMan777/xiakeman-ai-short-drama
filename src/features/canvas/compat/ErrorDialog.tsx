import { create } from "zustand";

interface ErrorState {
  message: string | null;
  showError: (msg: string) => void;
  clearError: () => void;
}

export const useErrorStore = create<ErrorState>((set) => ({
  message: null,
  showError: (msg) => set({ message: msg }),
  clearError: () => set({ message: null }),
}));

export function ErrorDialog() {
  const message = useErrorStore((s) => s.message);
  const clearError = useErrorStore((s) => s.clearError);

  if (!message) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50">
      <div
        className="bg-[var(--bg-surface)] rounded-[var(--ui-radius-lg)] p-6 max-w-md w-full mx-4 shadow-xl"
      >
        <h3 className="text-lg font-semibold text-[var(--accent)] mb-2">
          ⚠️ 错误
        </h3>
        <p className="text-[var(--text-primary)] mb-4">{message}</p>
        <button
          onClick={clearError}
          className="px-4 py-2 bg-[var(--accent)] text-white rounded-[var(--ui-radius)] hover:bg-[var(--accent-hover)] transition-colors"
        >
          确定
        </button>
      </div>
    </div>
  );
}

