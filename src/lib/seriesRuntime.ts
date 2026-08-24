import type {
  SeriesCharacterContinuity,
  SeriesEpisodeCard,
  SeriesEpisodeSummary,
  SeriesHookLedgerItem,
  SeriesHookStatus,
  SeriesPlan,
  SeriesPropLedgerItem,
  SeriesRuntimeState,
} from '@/types';

const HOOK_STATUSES: SeriesHookStatus[] = ['active', 'advanced', 'resolved', 'dropped'];

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

function toPositiveNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return /^(true|yes|是|带入|继续)$/i.test(value.trim());
  return false;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function createEmptySeriesRuntime(currentFocus = ''): SeriesRuntimeState {
  return {
    currentFocus,
    episodeSummaries: [],
    hookLedger: [],
    characterContinuity: [],
    propLedger: [],
    updatedAt: Date.now(),
  };
}

function normalizeEpisodeSummary(rawValue: unknown, index: number): SeriesEpisodeSummary {
  const raw = asRecord(rawValue);
  const episodeNumber = toPositiveNumber(raw.episodeNumber ?? raw.episode, index + 1);
  return {
    episodeId: String(raw.episodeId ?? raw.id ?? `ep-${episodeNumber}`),
    episodeNumber,
    title: String(raw.title ?? `第${episodeNumber}集`),
    keyEvents: toStringArray(raw.keyEvents ?? raw.events),
    stateChanges: toStringArray(raw.stateChanges),
    relationshipChanges: toStringArray(raw.relationshipChanges),
    hookActivity: toStringArray(raw.hookActivity ?? raw.hooks),
    settledAt: toPositiveNumber(raw.settledAt, Date.now()),
  };
}

function normalizeHook(rawValue: unknown, index: number): SeriesHookLedgerItem {
  const raw = asRecord(rawValue);
  const status = String(raw.status ?? 'active');
  const normalizedStatus = HOOK_STATUSES.includes(status as SeriesHookStatus)
    ? status as SeriesHookStatus
    : 'active';
  const startEpisode = toPositiveNumber(raw.startEpisode ?? raw.start, 1);
  return {
    hookId: String(raw.hookId ?? raw.id ?? `H${String(index + 1).padStart(3, '0')}`),
    description: String(raw.description ?? raw.seed ?? raw.promise ?? ''),
    status: normalizedStatus,
    startEpisode,
    lastAdvancedEpisode: toPositiveNumber(raw.lastAdvancedEpisode ?? raw.lastAdvanced ?? raw.lastSeenEpisode, startEpisode),
    expectedPayoff: String(raw.expectedPayoff ?? raw.payoff ?? ''),
    notes: String(raw.notes ?? ''),
  };
}

function normalizeCharacter(rawValue: unknown): SeriesCharacterContinuity {
  const raw = asRecord(rawValue);
  return {
    characterId: typeof raw.characterId === 'string' ? raw.characterId : typeof raw.id === 'string' ? raw.id : undefined,
    name: String(raw.name ?? ''),
    currentState: String(raw.currentState ?? raw.state ?? ''),
    knownInfo: toStringArray(raw.knownInfo ?? raw.infoBoundary),
    relationshipChanges: toStringArray(raw.relationshipChanges ?? raw.relationships),
    voiceRisk: String(raw.voiceRisk ?? raw.risk ?? ''),
  };
}

function normalizeProp(rawValue: unknown, index: number): SeriesPropLedgerItem {
  const raw = asRecord(rawValue);
  const name = String(raw.name ?? raw.propName ?? `道具${index + 1}`);
  return {
    propId: String(raw.propId ?? raw.id ?? `prop-${index + 1}`),
    name,
    owner: String(raw.owner ?? raw.holder ?? ''),
    status: String(raw.status ?? ''),
    lastSeenEpisode: toPositiveNumber(raw.lastSeenEpisode ?? raw.episodeNumber, 1),
    carriedForward: toBoolean(raw.carriedForward ?? raw.forward),
    notes: String(raw.notes ?? ''),
  };
}

export function normalizeSeriesRuntime(rawInput: unknown, fallback?: SeriesRuntimeState): SeriesRuntimeState {
  const wrapped = asRecord(rawInput);
  const raw = asRecord(wrapped.seriesRuntime ?? wrapped.runtime ?? rawInput);
  const base = fallback ?? createEmptySeriesRuntime();
  return {
    currentFocus: String(raw.currentFocus ?? base.currentFocus ?? ''),
    episodeSummaries: Array.isArray(raw.episodeSummaries)
      ? raw.episodeSummaries.map(normalizeEpisodeSummary)
      : base.episodeSummaries,
    hookLedger: Array.isArray(raw.hookLedger)
      ? raw.hookLedger.map(normalizeHook)
      : base.hookLedger,
    characterContinuity: Array.isArray(raw.characterContinuity)
      ? raw.characterContinuity.map(normalizeCharacter).filter((item) => item.name.trim())
      : base.characterContinuity,
    propLedger: Array.isArray(raw.propLedger)
      ? raw.propLedger.map(normalizeProp).filter((item) => item.name.trim())
      : base.propLedger,
    updatedAt: toPositiveNumber(raw.updatedAt, Date.now()),
  };
}

function includesEpisodeText(episodeText: string, candidate: string): boolean {
  const text = candidate.trim().toLowerCase();
  return text.length > 0 && episodeText.includes(text.toLowerCase());
}

function textContainsCandidate(sourceText: string, candidate: string): boolean {
  const text = candidate.trim().toLowerCase();
  return text.length > 0 && sourceText.includes(text);
}

export function buildSeriesRuntimeContext(
  seriesPlan: SeriesPlan,
  runtime: SeriesRuntimeState | undefined,
  episode: SeriesEpisodeCard,
) {
  const normalizedRuntime = runtime ? normalizeSeriesRuntime(runtime) : createEmptySeriesRuntime();
  const episodeNumber = episode.episodeNumber;
  const episodeText = JSON.stringify(episode).toLowerCase();
  const currentFocusText = normalizedRuntime.currentFocus.toLowerCase();
  const activeHooks = normalizedRuntime.hookLedger
    .filter((hook) => hook.status !== 'resolved' && hook.status !== 'dropped')
    .map((hook) => {
      const hookText = [hook.hookId, hook.description, hook.expectedPayoff, hook.notes]
        .filter(Boolean)
        .join(' ');
      const matchesEpisode = includesEpisodeText(episodeText, hook.description)
        || includesEpisodeText(episodeText, hook.expectedPayoff)
        || includesEpisodeText(episodeText, hook.notes);
      const matchesFocus = textContainsCandidate(currentFocusText, hook.description)
        || textContainsCandidate(currentFocusText, hook.expectedPayoff)
        || textContainsCandidate(currentFocusText, hook.hookId);
      const recentlyAdvanced = hook.lastAdvancedEpisode >= episodeNumber - 3;
      const score = (matchesEpisode ? 4 : 0)
        + (matchesFocus ? 3 : 0)
        + (recentlyAdvanced ? 2 : 0)
        + (hook.startEpisode === episodeNumber ? 1 : 0);
      return { hook, hookText, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.hook.lastAdvancedEpisode - a.hook.lastAdvancedEpisode || a.hookText.localeCompare(b.hookText))
    .map((item) => item.hook)
    .slice(0, 8);
  const relevantCharacters = normalizedRuntime.characterContinuity
    .filter((character) => includesEpisodeText(episodeText, character.name))
    .concat(normalizedRuntime.characterContinuity.filter((character) => !includesEpisodeText(episodeText, character.name)))
    .slice(0, 8);
  const relevantProps = normalizedRuntime.propLedger
    .filter((prop) => prop.carriedForward || prop.lastSeenEpisode >= episodeNumber - 3 || includesEpisodeText(episodeText, prop.name))
    .slice(0, 8);

  return {
    currentFocus: normalizedRuntime.currentFocus,
    recentEpisodeSummaries: normalizedRuntime.episodeSummaries
      .filter((summary) => summary.episodeNumber < episodeNumber && summary.episodeNumber >= episodeNumber - 3)
      .slice(-3),
    activeHooks,
    relevantCharacters,
    relevantProps,
    planSnapshot: {
      styleConfig: seriesPlan.styleConfig,
      recurringProps: seriesPlan.recurringProps,
      longRunningSecrets: seriesPlan.longRunningSecrets,
    },
  };
}
