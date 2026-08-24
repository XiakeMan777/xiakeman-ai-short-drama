import { normalizeFrameRatio } from '@/lib/frameRatio';
import type { ImageReference, ImageSize, StoryboardBoardMode, StoryboardBoardState, StoryboardBoardVariantState } from '@/types';

type StoryboardBoardStaleReason = NonNullable<StoryboardBoardVariantState['staleReason']>;

interface StoryboardBoardFreshnessOptions {
  allowStoredReferenceSuperset?: boolean;
  ignoreSoftReferenceAssetChanges?: boolean;
  allowLegacySoftStale?: boolean;
}

function isHardStoryboardBoardStaleReason(reason: StoryboardBoardStaleReason | undefined): boolean {
  return reason === 'scene-asset' || reason === 'source-change';
}

export function getStoryboardSceneReferenceAssetIds(
  imageRefs: readonly Pick<ImageReference, 'type' | 'assetId'>[] | undefined,
): string[] {
  return Array.from(new Set(
    (imageRefs ?? [])
      .filter((ref) => ref.type === 'scene' && !!ref.assetId)
      .map((ref) => ref.assetId as string),
  ));
}

export function storyboardBoardCoversSceneReferences(
  variant: StoryboardBoardVariantState | undefined,
  imageRefs: readonly Pick<ImageReference, 'type' | 'assetId'>[] | undefined,
): boolean {
  const currentSceneAssetIds = getStoryboardSceneReferenceAssetIds(imageRefs);
  if (currentSceneAssetIds.length === 0) return true;
  const storedAssetIds = new Set([
    ...(variant?.referenceAssetIds ?? []),
    ...(variant?.directorBriefReferenceAssetIds ?? []),
    ...(variant?.planReferenceAssetIds ?? []),
  ]);
  return currentSceneAssetIds.every((assetId) => storedAssetIds.has(assetId));
}

export function isStoryboardBoardStaleBlocking(
  variant: StoryboardBoardVariantState | undefined,
  imageRefs: readonly Pick<ImageReference, 'type' | 'assetId'>[] | undefined,
): boolean {
  if (!variant?.isStale) return false;
  if (isHardStoryboardBoardStaleReason(variant.staleReason)) return true;
  return !storyboardBoardCoversSceneReferences(variant, imageRefs);
}

export const DEFAULT_STORYBOARD_BOARD_MODE: StoryboardBoardMode = 'smart-shot-plan-landscape';
export const DEFAULT_STORYBOARD_BOARD_IMAGE_SIZE: ImageSize = '2K';
export const STORYBOARD_BOARD_MODES: StoryboardBoardMode[] = [
  'nine-portrait',
  'nine-landscape',
  'shot-plan-landscape',
  'smart-shot-plan-landscape',
];

function getDefaultStoryboardBoardLayout(mode: StoryboardBoardMode): '3x3' | 'strip' {
  return mode === 'shot-plan-landscape' || mode === 'smart-shot-plan-landscape' ? 'strip' : '3x3';
}

type LegacyStoryboardBoardState = Partial<StoryboardBoardVariantState> & {
  mode?: StoryboardBoardMode;
  selectedMode?: StoryboardBoardMode;
  variants?: Partial<Record<StoryboardBoardMode, Partial<StoryboardBoardVariantState>>>;
};

export function createEmptyStoryboardBoardVariant(mode: StoryboardBoardMode): StoryboardBoardVariantState {
  return {
    status: 'idle',
    isStale: false,
    planStatus: 'idle',
    planIsStale: false,
    layout: getDefaultStoryboardBoardLayout(mode),
    imageSize: DEFAULT_STORYBOARD_BOARD_IMAGE_SIZE,
  };
}

function normalizeStoryboardBoardVariant(
  variant?: Partial<StoryboardBoardVariantState>,
  mode: StoryboardBoardMode = DEFAULT_STORYBOARD_BOARD_MODE,
): StoryboardBoardVariantState {
  const status = variant?.status ?? 'idle';
  const frameRatio = typeof variant?.frameRatio === 'string'
    ? normalizeFrameRatio(variant.frameRatio)
    : undefined;
  return {
    status,
    boardStyle: variant?.boardStyle,
    generatedForOutputMode: variant?.generatedForOutputMode,
    frameRatio,
    visualBoardBlobKey: variant?.visualBoardBlobKey,
    blobKey: variant?.blobKey,
    lightweightBlobKey: variant?.lightweightBlobKey,
    lightweightMimeType: variant?.lightweightMimeType,
    lightweightQuality: variant?.lightweightQuality,
    lightweightOriginalBytes: variant?.lightweightOriginalBytes,
    lightweightBytes: variant?.lightweightBytes,
    lightweightWidth: variant?.lightweightWidth,
    lightweightHeight: variant?.lightweightHeight,
    lightweightCreatedAt: variant?.lightweightCreatedAt,
    referencePack: variant?.referencePack ?? [],
    startedAt: variant?.startedAt ?? (status === 'generating' ? Date.now() : undefined),
    generatedAt: variant?.generatedAt,
    error: variant?.error,
    isStale: variant?.isStale ?? false,
    staleReason: variant?.staleReason,
    promptSnapshot: variant?.promptSnapshot,
    referenceAssetIds: variant?.referenceAssetIds ?? [],
    directorBriefStatus: variant?.directorBriefStatus ?? (variant?.directorBrief ? 'done' : 'idle'),
    directorBrief: variant?.directorBrief,
    directorBriefError: variant?.directorBriefError,
    directorBriefGeneratedAt: variant?.directorBriefGeneratedAt,
    directorBriefPromptSnapshot: variant?.directorBriefPromptSnapshot,
    directorBriefReferenceAssetIds: variant?.directorBriefReferenceAssetIds ?? [],
    planStatus: variant?.planStatus ?? (variant?.plan ? 'done' : 'idle'),
    plan: variant?.plan,
    planError: variant?.planError,
    planGeneratedAt: variant?.planGeneratedAt,
    planIsStale: variant?.planIsStale ?? false,
    planStaleReason: variant?.planStaleReason,
    planPromptSnapshot: variant?.planPromptSnapshot,
    planReferenceAssetIds: variant?.planReferenceAssetIds ?? [],
    layout: variant?.layout ?? getDefaultStoryboardBoardLayout(mode),
    imageSize: variant?.imageSize ?? DEFAULT_STORYBOARD_BOARD_IMAGE_SIZE,
    generationTiming: variant?.generationTiming,
  };
}

export function normalizeStoryboardBoardState(
  boardState?: StoryboardBoardState | LegacyStoryboardBoardState,
): StoryboardBoardState | undefined {
  if (!boardState) return undefined;

  const legacyBoardState = boardState as LegacyStoryboardBoardState;
  const selectedMode: StoryboardBoardMode =
    boardState.selectedMode ?? legacyBoardState.mode ?? DEFAULT_STORYBOARD_BOARD_MODE;
  const normalizedVariants: Partial<Record<StoryboardBoardMode, StoryboardBoardVariantState>> = {};
  const rawVariants = boardState.variants ?? {};

  STORYBOARD_BOARD_MODES.forEach((mode) => {
    const rawVariant = rawVariants[mode];
    if (rawVariant) {
      normalizedVariants[mode] = normalizeStoryboardBoardVariant(rawVariant, mode);
    }
  });

  const hasLegacyTopLevelPayload =
    legacyBoardState.status !== undefined
    || legacyBoardState.boardStyle !== undefined
    || legacyBoardState.generatedForOutputMode !== undefined
    || legacyBoardState.frameRatio !== undefined
    || legacyBoardState.visualBoardBlobKey !== undefined
    || legacyBoardState.blobKey !== undefined
    || legacyBoardState.referencePack !== undefined
    || legacyBoardState.startedAt !== undefined
    || legacyBoardState.generatedAt !== undefined
    || legacyBoardState.error !== undefined
    || legacyBoardState.isStale !== undefined
    || legacyBoardState.staleReason !== undefined
    || legacyBoardState.promptSnapshot !== undefined
    || legacyBoardState.referenceAssetIds !== undefined
    || legacyBoardState.directorBriefStatus !== undefined
    || legacyBoardState.directorBrief !== undefined
    || legacyBoardState.directorBriefError !== undefined
    || legacyBoardState.directorBriefGeneratedAt !== undefined
    || legacyBoardState.directorBriefPromptSnapshot !== undefined
    || legacyBoardState.directorBriefReferenceAssetIds !== undefined
    || legacyBoardState.planStatus !== undefined
    || legacyBoardState.plan !== undefined
    || legacyBoardState.planError !== undefined
    || legacyBoardState.planGeneratedAt !== undefined
    || legacyBoardState.planIsStale !== undefined
    || legacyBoardState.planStaleReason !== undefined
    || legacyBoardState.planPromptSnapshot !== undefined
    || legacyBoardState.planReferenceAssetIds !== undefined
    || legacyBoardState.layout !== undefined
    || legacyBoardState.imageSize !== undefined;

  if (hasLegacyTopLevelPayload) {
    normalizedVariants[selectedMode] = normalizeStoryboardBoardVariant({
      ...normalizedVariants[selectedMode],
      status: legacyBoardState.status,
      boardStyle: legacyBoardState.boardStyle,
      generatedForOutputMode: legacyBoardState.generatedForOutputMode,
      frameRatio: legacyBoardState.frameRatio,
      visualBoardBlobKey: legacyBoardState.visualBoardBlobKey,
      blobKey: legacyBoardState.blobKey,
      referencePack: legacyBoardState.referencePack,
      generatedAt: legacyBoardState.generatedAt,
      error: legacyBoardState.error,
      isStale: legacyBoardState.isStale,
      staleReason: legacyBoardState.staleReason,
      promptSnapshot: legacyBoardState.promptSnapshot,
      referenceAssetIds: legacyBoardState.referenceAssetIds,
      directorBriefStatus: legacyBoardState.directorBriefStatus,
      directorBrief: legacyBoardState.directorBrief,
      directorBriefError: legacyBoardState.directorBriefError,
      directorBriefGeneratedAt: legacyBoardState.directorBriefGeneratedAt,
      directorBriefPromptSnapshot: legacyBoardState.directorBriefPromptSnapshot,
      directorBriefReferenceAssetIds: legacyBoardState.directorBriefReferenceAssetIds,
      planStatus: legacyBoardState.planStatus,
      plan: legacyBoardState.plan,
      planError: legacyBoardState.planError,
      planGeneratedAt: legacyBoardState.planGeneratedAt,
      planIsStale: legacyBoardState.planIsStale,
      planStaleReason: legacyBoardState.planStaleReason,
      planPromptSnapshot: legacyBoardState.planPromptSnapshot,
      planReferenceAssetIds: legacyBoardState.planReferenceAssetIds,
      layout: legacyBoardState.layout,
      imageSize: legacyBoardState.imageSize,
    }, selectedMode);
  }

  return {
    selectedMode,
    variants: normalizedVariants,
  };
}

export function getStoryboardBoardSelectedMode(boardState?: StoryboardBoardState): StoryboardBoardMode {
  return normalizeStoryboardBoardState(boardState)?.selectedMode ?? DEFAULT_STORYBOARD_BOARD_MODE;
}

export function getStoryboardBoardVariant(
  boardState: StoryboardBoardState | undefined,
  mode?: StoryboardBoardMode,
): StoryboardBoardVariantState | undefined {
  const normalized = normalizeStoryboardBoardState(boardState);
  if (!normalized) return undefined;
  const targetMode = mode ?? normalized.selectedMode ?? DEFAULT_STORYBOARD_BOARD_MODE;
  return normalized.variants?.[targetMode] ?? createEmptyStoryboardBoardVariant(targetMode);
}

export function setStoryboardBoardSelectedMode(
  boardState: StoryboardBoardState | undefined,
  mode: StoryboardBoardMode,
): StoryboardBoardState {
  const normalized = normalizeStoryboardBoardState(boardState) ?? { selectedMode: mode, variants: {} };
  return {
    selectedMode: mode,
    variants: {
      ...normalized.variants,
      [mode]: normalized.variants?.[mode] ?? createEmptyStoryboardBoardVariant(mode),
    },
  };
}

export function replaceStoryboardBoardVariant(
  boardState: StoryboardBoardState | undefined,
  mode: StoryboardBoardMode,
  variant: Partial<StoryboardBoardVariantState>,
): StoryboardBoardState {
  const normalized = normalizeStoryboardBoardState(boardState) ?? { selectedMode: mode, variants: {} };
  return {
    selectedMode: mode,
    variants: {
      ...normalized.variants,
      [mode]: normalizeStoryboardBoardVariant(variant, mode),
    },
  };
}

export function mergeStoryboardBoardVariant(
  boardState: StoryboardBoardState | undefined,
  mode: StoryboardBoardMode,
  updates: Partial<StoryboardBoardVariantState>,
): StoryboardBoardState {
  const normalized = normalizeStoryboardBoardState(boardState) ?? { selectedMode: mode, variants: {} };
  const currentVariant = normalized.variants?.[mode] ?? createEmptyStoryboardBoardVariant(mode);
  return {
    selectedMode: mode,
    variants: {
      ...normalized.variants,
      [mode]: normalizeStoryboardBoardVariant({
        ...currentVariant,
        ...updates,
      }, mode),
    },
  };
}

export function markStoryboardBoardStale(
  boardState: StoryboardBoardState | undefined,
  reason?: StoryboardBoardStaleReason,
): StoryboardBoardState | undefined {
  const normalized = normalizeStoryboardBoardState(boardState);
  if (!normalized) return undefined;

  const variants = Object.fromEntries(
    Object.entries(normalized.variants ?? {}).map(([mode, variant]) => [
      mode,
      normalizeStoryboardBoardVariant({
        ...variant,
        isStale: true,
        staleReason: reason,
        directorBriefStatus: variant?.directorBrief ? 'done' : 'idle',
        planIsStale: true,
        planStaleReason: reason,
      }, mode as StoryboardBoardMode),
    ]),
  ) as Partial<Record<StoryboardBoardMode, StoryboardBoardVariantState>>;

  return {
    selectedMode: normalized.selectedMode ?? DEFAULT_STORYBOARD_BOARD_MODE,
    variants,
  };
}

export function storyboardBoardUsesAsset(
  boardState: StoryboardBoardState | undefined,
  assetId: string,
): boolean {
  const normalized = normalizeStoryboardBoardState(boardState);
  if (!normalized) return false;
  return Object.values(normalized.variants ?? {}).some((variant) =>
    variant?.referenceAssetIds?.includes(assetId)
    || variant?.directorBriefReferenceAssetIds?.includes(assetId)
    || variant?.planReferenceAssetIds?.includes(assetId),
  );
}

function normalizeReferenceAssetIds(referenceAssetIds: string[] | undefined): string[] {
  return Array.from(new Set((referenceAssetIds ?? []).filter(Boolean))).sort();
}

function matchesReferenceAssetIds(
  current: string[] | undefined,
  next: string[] | undefined,
  options: StoryboardBoardFreshnessOptions = {},
): boolean {
  const currentIds = normalizeReferenceAssetIds(current);
  const nextIds = normalizeReferenceAssetIds(next);
  if (currentIds.length === nextIds.length && currentIds.every((assetId, index) => assetId === nextIds[index])) {
    return true;
  }
  if (options.allowStoredReferenceSuperset) {
    return nextIds.every((assetId) => currentIds.includes(assetId));
  }
  return false;
}

function normalizeSequenceContinuitySourceSignature(signature: unknown): unknown {
  if (typeof signature !== 'string' || !signature) return signature;
  try {
    const parsed = JSON.parse(signature) as Record<string, unknown>;
    delete parsed.currentContinuityOut;
    delete parsed.nextContinuityIn;
    delete parsed.warnings;
    return JSON.stringify(parsed);
  } catch {
    return signature;
  }
}

function normalizeStoryboardBoardPromptSnapshot(
  snapshot: string | undefined,
  options: StoryboardBoardFreshnessOptions = {},
): string {
  if (!snapshot) return '';
  try {
    const parsed = JSON.parse(snapshot) as Record<string, unknown>;
    parsed.sequenceContinuitySourceSignature = normalizeSequenceContinuitySourceSignature(
      parsed.sequenceContinuitySourceSignature,
    );
    if (options.ignoreSoftReferenceAssetChanges && Array.isArray(parsed.imageRefs)) {
      parsed.imageRefs = parsed.imageRefs.map((ref) => {
        if (!ref || typeof ref !== 'object') return ref;
        const normalizedRef = { ...(ref as Record<string, unknown>) };
        if (normalizedRef.type !== 'scene') {
          delete normalizedRef.assetId;
          delete normalizedRef.assetBindingMode;
        }
        return normalizedRef;
      });
    }
    return JSON.stringify(parsed);
  } catch {
    return snapshot;
  }
}

function matchesStoryboardBoardPromptSnapshot(
  current: string | undefined,
  next: string | undefined,
  options: StoryboardBoardFreshnessOptions = {},
): boolean {
  return normalizeStoryboardBoardPromptSnapshot(current, options) === normalizeStoryboardBoardPromptSnapshot(next, options);
}

export function isStoryboardBoardPlanFresh(
  variant: StoryboardBoardVariantState | undefined,
  promptSnapshot: string | undefined,
  referenceAssetIds: string[] | undefined,
  options: StoryboardBoardFreshnessOptions = {},
): boolean {
  if (!variant?.plan || variant.planStatus !== 'done') return false;
  if (variant.planIsStale && (!options.allowLegacySoftStale || isHardStoryboardBoardStaleReason(variant.planStaleReason))) return false;
  if (!matchesStoryboardBoardPromptSnapshot(variant.planPromptSnapshot, promptSnapshot, options)) return false;
  return matchesReferenceAssetIds(variant.planReferenceAssetIds, referenceAssetIds, options);
}

export function isStoryboardBoardActionDirectorPlanFresh(
  variant: StoryboardBoardVariantState | undefined,
  promptSnapshot: string | undefined,
  referenceAssetIds: string[] | undefined,
  options: StoryboardBoardFreshnessOptions = {},
): boolean {
  if (!variant?.plan || (variant.planStatus !== 'optimizing' && variant.planStatus !== 'failed')) return false;
  if (variant.planIsStale && (!options.allowLegacySoftStale || isHardStoryboardBoardStaleReason(variant.planStaleReason))) return false;
  if (!matchesStoryboardBoardPromptSnapshot(variant.planPromptSnapshot, promptSnapshot, options)) return false;
  return matchesReferenceAssetIds(variant.planReferenceAssetIds, referenceAssetIds, options);
}

export function isStoryboardBoardDirectorBriefFresh(
  variant: StoryboardBoardVariantState | undefined,
  promptSnapshot: string | undefined,
  referenceAssetIds: string[] | undefined,
  options: StoryboardBoardFreshnessOptions = {},
): boolean {
  if (!variant?.directorBrief || variant.directorBriefStatus !== 'done') return false;
  if (variant.planIsStale && (!options.allowLegacySoftStale || isHardStoryboardBoardStaleReason(variant.planStaleReason))) return false;
  if (!matchesStoryboardBoardPromptSnapshot(variant.directorBriefPromptSnapshot, promptSnapshot, options)) return false;
  return matchesReferenceAssetIds(variant.directorBriefReferenceAssetIds, referenceAssetIds, options);
}

export function isStoryboardBoardImageFresh(
  variant: StoryboardBoardVariantState | undefined,
  promptSnapshot: string | undefined,
  referenceAssetIds: string[] | undefined,
  options: StoryboardBoardFreshnessOptions = {},
): boolean {
  if (!variant?.blobKey || variant.status !== 'done') return false;
  if (variant.isStale && (!options.allowLegacySoftStale || isHardStoryboardBoardStaleReason(variant.staleReason))) return false;
  if (!matchesStoryboardBoardPromptSnapshot(variant.promptSnapshot, promptSnapshot, options)) return false;
  return matchesReferenceAssetIds(variant.referenceAssetIds, referenceAssetIds, options);
}
