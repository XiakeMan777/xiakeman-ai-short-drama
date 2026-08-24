export type UiMode = 'next' | 'classic';

function readUiModeFromQuery(): UiMode | null {
  if (typeof window === 'undefined') return null;

  const ui = new URLSearchParams(window.location.search).get('ui')?.toLowerCase();
  if (!ui) return null;

  if (ui === 'next' || ui === 'new' || ui === 'preview') return 'next';
  if (ui === 'classic' || ui === 'old' || ui === 'legacy') return 'classic';
  return null;
}

function readUiModeFromEnv(): UiMode | null {
  const value = import.meta.env.VITE_XIAKEMAN_NEXT_UI;

  if (value === '1' || value === 'true' || value === 'next') return 'next';
  if (value === '0' || value === 'false' || value === 'classic') return 'classic';

  return null;
}

export function resolveUiMode(): UiMode {
  return readUiModeFromQuery() ?? readUiModeFromEnv() ?? 'next';
}

export const ENABLE_NEXT_UI_PREVIEW = resolveUiMode() === 'next';
