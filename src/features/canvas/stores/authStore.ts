import { create } from "zustand";
import {
  authLogin,
  authRegister,
  authLogout,
  getAuthState,
} from "@/features/canvas/compat/commands";

/** User profile returned by the backend. */
export interface AuthUser {
  id: number;
  email: string;
  username?: string;
  status: string;
  avatar?: string;
  [key: string]: unknown;
}

/** State shape for the auth store. */
interface AuthState {
  /** Whether the user is currently authenticated. */
  isAuthenticated: boolean;
  /** The logged-in user profile, or null. */
  user: AuthUser | null;
  /** Whether an auth operation is in progress. */
  loading: boolean;
  /** Last error message (cleared on next action). */
  error: string | null;

  // Actions
  /** Login with email & password. */
  login: (email: string, password: string) => Promise<void>;
  /** Register a new account with email & password. */
  register: (email: string, password: string) => Promise<void>;
  /** Logout the current user. */
  logout: () => Promise<void>;
  /** Check stored token validity; call on app startup. */
  checkAuth: () => Promise<void>;
  /** Clear the current error. */
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  isAuthenticated: false,
  user: null,
  loading: false,
  error: null,

  login: async (email: string, password: string) => {
    set({ loading: true, error: null });
    try {
      const user = await authLogin(email, password);
      set({
        isAuthenticated: true,
        user: user as unknown as AuthUser,
        loading: false,
        error: null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ isAuthenticated: false, user: null, loading: false, error: message });
      throw err;
    }
  },

  register: async (email: string, password: string) => {
    set({ loading: true, error: null });
    try {
      const user = await authRegister(email, password);
      set({
        isAuthenticated: true,
        user: user as unknown as AuthUser,
        loading: false,
        error: null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ isAuthenticated: false, user: null, loading: false, error: message });
      throw err;
    }
  },

  logout: async () => {
    set({ loading: true, error: null });
    try {
      await authLogout();
    } catch {
      // Best-effort; even if server logout fails, clear local state
    }
    set({ isAuthenticated: false, user: null, loading: false, error: null });
  },

  checkAuth: async () => {
    set({ loading: true, error: null });
    try {
      const state = await getAuthState();
      if (state.authenticated && state.user) {
        set({
          isAuthenticated: true,
          user: state.user as unknown as AuthUser,
          loading: false,
          error: null,
        });
      } else {
        const reason = state.reason ?? null;
        set({
          isAuthenticated: false,
          user: null,
          loading: false,
          error: reason,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ isAuthenticated: false, user: null, loading: false, error: message });
    }
  },

  clearError: () => set({ error: null }),
}));



