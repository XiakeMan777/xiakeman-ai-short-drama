import type {
  SeriesAudienceChannel,
  SeriesConceptAnalysis,
  SeriesEpisodeCard,
  SeriesPlan,
  SeriesProductionAsset,
  SeriesRuntimeState,
  SeriesStep0QualityReport,
} from '@/types';

export type SeriesStep0QualityStage = 'bible' | 'cards' | 'final';

export interface SeriesStep0RepairScope {
  stage?: SeriesStep0QualityStage;
  episodeRange?: { start: number; end: number };
  issueTypes?: string[];
  focus?: string;
}

type JsonRecord = Record<string, unknown>;

const GENERATED_FIELDS = new Set(['generatedScript', 'generatedAt', 'step0QualityReport']);

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function stripGeneratedFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripGeneratedFields(item)) as T;
  }
  if (!value || typeof value !== 'object') return value;

  const cleaned: JsonRecord = {};
  for (const [key, nested] of Object.entries(value as JsonRecord)) {
    if (GENERATED_FIELDS.has(key)) continue;
    cleaned[key] = stripGeneratedFields(nested);
  }
  return cleaned as T;
}

function pickFields(value: unknown, keys: string[]): JsonRecord {
  const source = asRecord(stripGeneratedFields(value));
  const picked: JsonRecord = {};
  for (const key of keys) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return picked;
}

function compactConceptAnalysis(conceptAnalysis?: SeriesConceptAnalysis): JsonRecord | undefined {
  if (!conceptAnalysis) return undefined;
  return pickFields(conceptAnalysis, [
    'conceptLogline',
    'coreStoryEngine',
    'audiencePromise',
    'viewpointEntry',
    'protagonistFantasy',
    'playRules',
    'episodeEnginePattern',
    'characterVoiceRules',
    'visualSatisfactionRules',
    'driftGuardrails',
    'worldRules',
    'mustKeepFacts',
    'mustKeepCharacters',
    'mustKeepMechanisms',
    'episodeFormula',
    'forbiddenDrift',
    'recommendedGenreMode',
    'toneKeywords',
  ]);
}

function compactEpisodeCard(card: SeriesEpisodeCard): JsonRecord {
  return pickFields(card, [
    'id',
    'episodeNumber',
    'episodeType',
    'title',
    'mainQuestion',
    'coreConflictAction',
    'openingHook',
    'pressureBeats',
    'satisfactionType',
    'satisfactionBeat',
    'visiblePayoffAction',
    'cliffhanger',
    'nextHookRequirement',
    'continuityIn',
    'continuityOut',
    'visualReuse',
    'assetPlan',
    'adHocAssets',
  ]);
}

function compactEpisodeCardSummary(card: SeriesEpisodeCard): JsonRecord {
  return pickFields(card, [
    'episodeNumber',
    'episodeType',
    'title',
    'mainQuestion',
    'openingHook',
    'satisfactionBeat',
    'cliffhanger',
    'nextHookRequirement',
    'continuityIn',
    'continuityOut',
    'visualReuse',
    'assetPlan',
  ]);
}

function textIncludesTerm(text: string, term: string | undefined): boolean {
  return !!term && term.length >= 2 && text.includes(term);
}

function clipText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const headSize = Math.ceil(maxChars * 0.68);
  const tailSize = Math.max(0, maxChars - headSize);
  return [
    trimmed.slice(0, headSize),
    `\n\n[中间 ${trimmed.length - maxChars} 字已省略，仅保留开头与结尾用于连续性沉淀]\n\n`,
    trimmed.slice(-tailSize),
  ].join('');
}

function compactCharacters(seriesPlan: SeriesPlan, textBlob = '', limit = 8): JsonRecord[] {
  const characters = seriesPlan.characters ?? [];
  const related = characters.filter((character) => (
    textIncludesTerm(textBlob, character.id)
    || textIncludesTerm(textBlob, character.name)
    || textIncludesTerm(textBlob, character.role)
  ));
  const selected = related.length > 0 ? related : characters.slice(0, limit);
  return selected.slice(0, limit).map((character) => pickFields(character, [
    'id',
    'name',
    'role',
    'relationshipToLead',
    'goal',
    'secret',
    'actionStyle',
    'voiceStyle',
    'visualAnchor',
    'recurringProps',
    'continuityNotes',
  ]));
}

function compactProductionAssets(seriesPlan: SeriesPlan, textBlob = '', limit = 10): JsonRecord[] {
  const assets = seriesPlan.productionAssets ?? [];
  const related = assets.filter((asset: SeriesProductionAsset) => (
    textIncludesTerm(textBlob, asset.id)
    || textIncludesTerm(textBlob, asset.name)
    || textIncludesTerm(textBlob, asset.storyFunction)
    || textIncludesTerm(textBlob, asset.visualAnchor)
  ));
  const selected = related.length > 0 ? related : assets.slice(0, limit);
  return selected.slice(0, limit).map((asset) => pickFields(asset, [
    'id',
    'name',
    'category',
    'genreUse',
    'episodeRange',
    'visualAnchor',
    'storyFunction',
    'conflictRule',
    'assetNeed',
    'reuseLevel',
    'status',
  ]));
}

function compactSeriesPlanBase(seriesPlan: SeriesPlan, textBlob = ''): JsonRecord {
  return {
    premise: seriesPlan.premise,
    sourcePremise: seriesPlan.sourcePremise,
    genreMode: seriesPlan.genreMode,
    audienceChannel: seriesPlan.audienceChannel,
    tone: seriesPlan.tone,
    styleConfig: seriesPlan.styleConfig,
    episodeCount: seriesPlan.episodeCount,
    episodeDuration: seriesPlan.episodeDuration,
    conceptAnalysis: compactConceptAnalysis(seriesPlan.conceptAnalysis),
    characters: compactCharacters(seriesPlan, textBlob),
    longRunningSecrets: (seriesPlan.longRunningSecrets ?? []).slice(0, 8),
    recurringProps: (seriesPlan.recurringProps ?? []).slice(0, 12),
    productionAssets: compactProductionAssets(seriesPlan, textBlob),
  };
}

function cardsInRange(cards: SeriesEpisodeCard[], start: number, end: number): SeriesEpisodeCard[] {
  return cards
    .filter((card) => card.episodeNumber >= start && card.episodeNumber <= end)
    .sort((a, b) => a.episodeNumber - b.episodeNumber);
}

function rhythmInRange(seriesPlan: SeriesPlan, start: number, end: number): JsonRecord[] {
  return (seriesPlan.seasonRhythm ?? [])
    .filter((beat) => beat.episodeNumber >= start && beat.episodeNumber <= end)
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .map((beat) => pickFields(beat, [
      'episodeNumber',
      'episodeType',
      'role',
      'requiredAsset',
      'coreTurn',
      'payoffPromise',
      'nextHook',
    ]));
}

function compactSeriesPlanForCards(
  seriesPlan: SeriesPlan,
  targetRange?: { start: number; end: number },
  targetEpisode?: SeriesEpisodeCard,
): JsonRecord {
  const start = targetEpisode?.episodeNumber ?? targetRange?.start ?? 1;
  const end = targetEpisode?.episodeNumber ?? targetRange?.end ?? start + 3;
  const priorCards = seriesPlan.episodeCards
    .filter((card) => card.episodeNumber < start)
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .slice(-4)
    .map(compactEpisodeCardSummary);
  const existingTargets = targetEpisode
    ? [compactEpisodeCard(targetEpisode)]
    : cardsInRange(seriesPlan.episodeCards, start, end).map(compactEpisodeCardSummary);

  return {
    ...compactSeriesPlanBase(seriesPlan),
    seasonRhythm: rhythmInRange(seriesPlan, Math.max(1, start - 4), end),
    episodeCards: [...priorCards, ...existingTargets],
    promptContext: {
      purpose: 'episode-cards',
      targetRange: { start, end },
      note: 'Only generate or revise the target range. Keep previous cards as continuity summary.',
    },
  };
}

function compactSeriesPlanForEpisode(seriesPlan: SeriesPlan, episodeCard: SeriesEpisodeCard): JsonRecord {
  const episodeNumber = episodeCard.episodeNumber;
  const nearbyCards = cardsInRange(seriesPlan.episodeCards, Math.max(1, episodeNumber - 2), episodeNumber + 2);
  const textBlob = JSON.stringify([episodeCard, ...nearbyCards]);
  return {
    ...compactSeriesPlanBase(seriesPlan, textBlob),
    seasonRhythm: rhythmInRange(seriesPlan, Math.max(1, episodeNumber - 2), episodeNumber + 2),
    episodeCards: nearbyCards.map((card) => (
      card.episodeNumber === episodeNumber ? compactEpisodeCard(card) : compactEpisodeCardSummary(card)
    )),
    promptContext: {
      purpose: 'episode-script',
      targetEpisode: episodeNumber,
      note: 'Write only the target episode. Adjacent cards are for hook continuity, not for retelling.',
    },
  };
}

function compactSeriesPlanForSettle(seriesPlan: SeriesPlan, episodeCard: SeriesEpisodeCard, scriptText: string): JsonRecord {
  const episodeNumber = episodeCard.episodeNumber;
  const nearbyCards = cardsInRange(seriesPlan.episodeCards, Math.max(1, episodeNumber - 1), episodeNumber + 1);
  const textBlob = clipText(JSON.stringify([episodeCard, scriptText]), 16000);
  return {
    ...compactSeriesPlanBase(seriesPlan, textBlob),
    characters: compactCharacters(seriesPlan, textBlob, 6),
    longRunningSecrets: (seriesPlan.longRunningSecrets ?? []).slice(0, 6),
    recurringProps: (seriesPlan.recurringProps ?? []).slice(0, 8),
    productionAssets: compactProductionAssets(seriesPlan, textBlob, 8),
    seasonRhythm: rhythmInRange(seriesPlan, Math.max(1, episodeNumber - 1), episodeNumber + 1),
    episodeCards: nearbyCards.map((card) => (
      card.episodeNumber === episodeNumber ? compactEpisodeCard(card) : compactEpisodeCardSummary(card)
    )),
    promptContext: {
      purpose: 'episode-runtime-settle',
      targetEpisode: episodeNumber,
      note: 'Use scriptText as the source of truth. Adjacent cards are only hook context.',
    },
  };
}

function compactSeriesPlanForQuality(seriesPlan: SeriesPlan, stage: SeriesStep0QualityStage): JsonRecord {
  if (stage === 'bible') {
    return {
      ...compactSeriesPlanBase(seriesPlan),
      seasonRhythm: [],
      episodeCards: [],
      promptContext: {
        qualityStage: stage,
        expectedMissing: ['seasonRhythm', 'episodeCards'],
      },
    };
  }

  return {
    ...compactSeriesPlanBase(seriesPlan),
    seasonRhythm: rhythmInRange(seriesPlan, 1, seriesPlan.episodeCount ?? seriesPlan.episodeCards.length),
    episodeCards: [...seriesPlan.episodeCards]
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .map(compactEpisodeCardSummary),
    promptContext: { qualityStage: stage },
  };
}

function compactSeriesPlanForRepair(seriesPlan: SeriesPlan, repairScope?: SeriesStep0RepairScope): JsonRecord {
  const start = repairScope?.episodeRange?.start ?? 1;
  const end = repairScope?.episodeRange?.end ?? Math.min(seriesPlan.episodeCards.length || 4, 4);
  const cards = cardsInRange(seriesPlan.episodeCards, Math.max(1, start - 1), end + 1);
  const textBlob = JSON.stringify(cards);

  return {
    ...compactSeriesPlanBase(seriesPlan, textBlob),
    seasonRhythm: rhythmInRange(seriesPlan, Math.max(1, start - 1), end + 1),
    episodeCards: cards.map((card) => (
      card.episodeNumber >= start && card.episodeNumber <= end
        ? compactEpisodeCard(card)
        : compactEpisodeCardSummary(card)
    )),
    promptContext: {
      purpose: 'step0-quality-repair',
      repairScope,
      note: 'Return a partial patch for the scoped issues only. Do not rewrite unrelated episodes.',
    },
  };
}

function compactSeriesRuntime(runtime?: SeriesRuntimeState, episodeNumber?: number): JsonRecord | undefined {
  if (!runtime) return undefined;
  const nearbySummaryStart = Math.max(1, (episodeNumber ?? 1) - 3);
  return {
    currentFocus: runtime.currentFocus,
    episodeSummaries: runtime.episodeSummaries
      .filter((summary) => !episodeNumber || summary.episodeNumber >= nearbySummaryStart)
      .slice(-4)
      .map((summary) => pickFields(summary, [
        'episodeId',
        'episodeNumber',
        'title',
        'keyEvents',
        'stateChanges',
        'relationshipChanges',
        'hookActivity',
      ])),
    hookLedger: runtime.hookLedger
      .filter((hook) => hook.status !== 'dropped')
      .slice(-8)
      .map((hook) => pickFields(hook, [
        'hookId',
        'description',
        'status',
        'startEpisode',
        'lastAdvancedEpisode',
        'expectedPayoff',
        'notes',
      ])),
    characterContinuity: runtime.characterContinuity.slice(0, 6),
    propLedger: runtime.propLedger
      .filter((prop) => !episodeNumber || prop.carriedForward || prop.lastSeenEpisode >= nearbySummaryStart)
      .slice(-8),
  };
}

export function buildSeriesConceptAnalyzeUserPrompt(input: {
  premise: string;
  genreMode: string;
  audienceChannel?: SeriesAudienceChannel;
  episodeCount: number;
  notes?: string;
}) {
  return JSON.stringify(input);
}

export function buildSeriesConceptAlignmentCheckUserPrompt(input: {
  premise: string;
  conceptAnalysis: SeriesConceptAnalysis;
  target: unknown;
  targetType: 'bible' | 'cards';
}) {
  return JSON.stringify({
    ...input,
    conceptAnalysis: compactConceptAnalysis(input.conceptAnalysis),
    target: stripGeneratedFields(input.target),
  });
}

export function buildSeriesStep0QualityCheckUserPrompt(input: {
  premise: string;
  seriesPlan: SeriesPlan;
  episodeCount: number;
  stage: SeriesStep0QualityStage;
}) {
  return JSON.stringify({
    premise: input.premise,
    episodeCount: input.episodeCount,
    stage: input.stage,
    seriesPlan: compactSeriesPlanForQuality(input.seriesPlan, input.stage),
  });
}

export function buildSeriesStep0QualityRepairUserPrompt(input: {
  seriesPlan: SeriesPlan;
  qualityReport: SeriesStep0QualityReport;
  repairScope?: SeriesStep0RepairScope;
}) {
  return JSON.stringify({
    seriesPlan: compactSeriesPlanForRepair(input.seriesPlan, input.repairScope),
    qualityReport: stripGeneratedFields(input.qualityReport),
    repairScope: input.repairScope,
  });
}

export function buildSeriesBibleUserPrompt(input: {
  premise: string;
  genreMode: string;
  audienceChannel?: SeriesAudienceChannel;
  episodeCount: number;
  conceptAnalysis?: SeriesConceptAnalysis;
  notes?: string;
}) {
  return JSON.stringify({
    ...input,
    conceptAnalysis: compactConceptAnalysis(input.conceptAnalysis),
  });
}

export function buildSeriesPremisePolishUserPrompt(input: {
  premise: string;
  genreMode: string;
  audienceChannel?: SeriesAudienceChannel;
}) {
  return JSON.stringify(input);
}

export function buildSeriesEpisodeCardsUserPrompt(input: {
  seriesPlan: SeriesPlan;
  episodeCount: number;
  targetRange?: { start: number; end: number };
  targetEpisode?: SeriesEpisodeCard;
}) {
  return JSON.stringify({
    episodeCount: input.episodeCount,
    targetRange: input.targetRange,
    targetEpisode: input.targetEpisode ? compactEpisodeCard(input.targetEpisode) : undefined,
    seriesPlan: compactSeriesPlanForCards(input.seriesPlan, input.targetRange, input.targetEpisode),
  });
}

export function buildSeriesEpisodeScriptUserPrompt(input: {
  seriesPlan: SeriesPlan;
  episodeCard: SeriesEpisodeCard;
  episodeDuration: number;
}) {
  return JSON.stringify({
    seriesPlan: compactSeriesPlanForEpisode(input.seriesPlan, input.episodeCard),
    episodeCard: compactEpisodeCard(input.episodeCard),
    episodeDuration: input.episodeDuration,
  });
}

export function buildSeriesEpisodeScriptRepairUserPrompt(input: {
  seriesPlan: SeriesPlan;
  episodeCard: SeriesEpisodeCard;
  episodeDuration: number;
  scriptText: string;
  qualityIssues: Array<{ id: string; label: string; suggestion: string }>;
}) {
  return JSON.stringify({
    seriesPlan: compactSeriesPlanForEpisode(input.seriesPlan, input.episodeCard),
    episodeCard: compactEpisodeCard(input.episodeCard),
    episodeDuration: input.episodeDuration,
    scriptText: input.scriptText,
    qualityIssues: input.qualityIssues,
  });
}

export function buildSeriesEpisodeSettleUserPrompt(input: {
  seriesPlan: SeriesPlan;
  seriesRuntime?: SeriesRuntimeState;
  episodeCard: SeriesEpisodeCard;
  scriptText: string;
}) {
  return JSON.stringify({
    seriesPlan: compactSeriesPlanForSettle(input.seriesPlan, input.episodeCard, input.scriptText),
    seriesRuntime: compactSeriesRuntime(input.seriesRuntime, input.episodeCard.episodeNumber),
    episodeCard: compactEpisodeCard(input.episodeCard),
    scriptText: clipText(input.scriptText, 12000),
  });
}
