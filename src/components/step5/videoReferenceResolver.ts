import type { Asset, ImageReference, ScenePositionBoardPoint, ScenePositionBoardState, StoryboardBoardReferencePackItemType } from '@/types';
import { resolveCharacterReferenceAsset } from '@/lib/characterReferenceUtils';
import { isOfficialVirtualHumanAsset } from '@/lib/officialVirtualHumanVideoMode';
import { normalizeFrameRatio } from '@/lib/frameRatio';
import { isSmartShotPlanBoardMode } from '@/components/step4/storyboardBoardMode';
import type { StoryboardBoardVideoReferenceState } from './storyboardBoardVideoReference';

export const VIDEO_REFERENCE_LIMIT = 9;

export interface ResolvedVideoReference {
  ref: ImageReference;
  asset: Asset;
}

export interface StoryboardBoardVideoReferenceItem {
  key: string;
  refId: string;
  name: string;
  type: 'storyboard-board';
  blobKey: string;
  modeLabel: string;
  required?: boolean;
  compressed?: boolean;
  lightweightBytes?: number;
  lightweightOriginalBytes?: number;
  packType?: StoryboardBoardReferencePackItemType | 'full-board';
  points?: ScenePositionBoardPoint[];
  sourceSceneName?: string;
}

export interface ScenePositionBoardVideoReferenceItem {
  key: 'scene-position-board';
  refId: string;
  name: string;
  type: 'scene-position-board';
  blobKey: string;
  points: ScenePositionBoardPoint[];
  sourceSceneName?: string;
}

export type AssetVideoReferenceRole = 'official-identity' | 'visual' | 'standard';

export interface AssetVideoReferenceItem {
  key: string;
  refId: string;
  sourceRefId: string;
  name: string;
  type: ImageReference['type'];
  trackingId?: string;
  asset: Asset;
  budgetRole?: AssetVideoReferenceRole;
}

export type EffectiveVideoReferenceItem =
  | AssetVideoReferenceItem
  | StoryboardBoardVideoReferenceItem
  | ScenePositionBoardVideoReferenceItem;

export type VideoReferenceBudgetOmissionReason =
  | 'character-identity-overflow'
  | 'character-visual-degraded'
  | 'asset-overflow'
  | 'scene-position-board-overflow'
  | 'storyboard-board-overflow';

export interface VideoReferenceBudgetOmission {
  key: string;
  refId: string;
  name: string;
  type: ImageReference['type'] | 'storyboard-board' | 'scene-position-board';
  reason: VideoReferenceBudgetOmissionReason;
  message: string;
}

export interface VideoReferenceBudgetState {
  limit: number;
  originalTotalRefs: number;
  compressed: boolean;
  omittedItems: VideoReferenceBudgetOmission[];
}

export interface VideoReferencePromptSlot {
  number: number;
  name: string;
}

export interface VideoReferencePromptOrderState {
  checked: boolean;
  valid: boolean;
  reordered: boolean;
  message?: string;
  slots: VideoReferencePromptSlot[];
}

export interface VideoPromptReferenceBindingMismatch {
  number: number;
  labelName: string;
  actualName?: string;
}

export interface VideoPromptReferenceBindingValidation {
  valid: boolean;
  message?: string;
  mismatches: VideoPromptReferenceBindingMismatch[];
}

export interface VideoReferenceResolution {
  totalRefs: number;
  rawTotalRefs: number;
  exceedsLimit: boolean;
  resolved: ResolvedVideoReference[];
  missing: ImageReference[];
  effectiveItems: EffectiveVideoReferenceItem[];
  budget: VideoReferenceBudgetState;
  storyboardBoardIncluded: boolean;
  storyboardBoardRefId?: string;
  promptOrder: VideoReferencePromptOrderState;
}

export interface VideoReferenceResolveOptions {
  includeScenePositionBoard?: boolean;
  useStoryboardBoardReferencePack?: boolean;
  finalVideoPrompt?: string;
}

function pickLatestAsset(candidates: readonly Asset[]) {
  if (candidates.length === 0) return undefined;
  return candidates.slice().sort((a, b) =>
    (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0),
  )[0];
}

export function resolveVideoReferenceAsset(
  ref: ImageReference,
  assetLibrary: Asset[],
  frameRatio?: string,
): Asset | undefined {
  const byAssetId = ref.assetId
    ? assetLibrary.find((asset) => asset.id === ref.assetId)
    : undefined;

  if (ref.type === 'character') {
    return resolveCharacterReferenceAsset(assetLibrary, ref);
  }

  if (ref.assetBindingMode === 'manual' && byAssetId?.type === ref.type) return byAssetId;

  if (ref.type === 'prop') {
    return byAssetId ?? assetLibrary.find((asset) => asset.type === 'prop' && (
      (ref.trackingId && asset.identityKey === ref.trackingId)
      || (!ref.trackingId && !asset.identityKey && asset.name === ref.name)
    ));
  }

  if (ref.type === 'scene') {
    const candidates = assetLibrary.filter((asset) => asset.type === 'scene' && asset.name === ref.name);
    const targetFrameRatio = normalizeFrameRatio(frameRatio);
    const preferredConcept = targetFrameRatio === '16:9' ? 'scene_main' : 'scene_vertical';
    const fallbackConcept = targetFrameRatio === '16:9' ? 'scene_vertical' : 'scene_main';
    const hasExplicitFrameRatio = typeof frameRatio === 'string' && frameRatio.trim().length > 0;
    const boundAssetMatchesFrame = byAssetId?.type === 'scene' && byAssetId.concept === preferredConcept;
    const latestPreferredAsset = pickLatestAsset(candidates.filter((asset) => asset.concept === preferredConcept));
    return latestPreferredAsset
      ?? (boundAssetMatchesFrame && byAssetId?.name !== ref.name ? byAssetId : undefined)
      ?? (hasExplicitFrameRatio ? undefined : byAssetId)
      ?? (hasExplicitFrameRatio ? undefined : pickLatestAsset(candidates.filter((asset) => asset.concept === fallbackConcept)))
      ?? (hasExplicitFrameRatio ? undefined : pickLatestAsset(candidates));
  }

  return byAssetId ?? assetLibrary.find((asset) => asset.type === ref.type && asset.name === ref.name);
}

function resolveOfficialVirtualHumanAsset(
  ref: ImageReference,
  assetLibrary: Asset[],
): Asset | undefined {
  if (ref.type !== 'character') return undefined;
  const byAssetId = ref.assetId
    ? assetLibrary.find((asset) => (
        asset.id === ref.assetId
        && asset.type === 'character'
        && asset.source === 'volc_virtual_human'
        && !!asset.externalAssetUri
      ))
    : undefined;
  if (ref.assetBindingMode === 'manual' && byAssetId) return byAssetId;

  const candidates = assetLibrary.filter((asset) =>
    asset.type === 'character'
    && asset.name === ref.name
    && asset.source === 'volc_virtual_human'
    && !!asset.externalAssetUri
  );

  return candidates.slice().sort((a, b) => (
    Number(!!b.isDefault) - Number(!!a.isDefault)
    || (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
  ))[0];
}

function buildEffectiveAssetKey(ref: ImageReference, asset: Asset, role: string) {
  return ref.trackingId
    ? `${ref.refId}:${ref.trackingId}:${asset.id}:${role}`
    : `${ref.refId}:${ref.type}:${ref.name}:${ref.variantKey ?? 'default'}:${asset.id}:${role}`;
}

function pushEffectiveAssetItem(
  effectiveItems: EffectiveVideoReferenceItem[],
  seenKeys: Set<string>,
  ref: ImageReference,
  asset: Asset,
  role: AssetVideoReferenceRole,
  refId: string,
) {
  const key = buildEffectiveAssetKey(ref, asset, role);
  if (seenKeys.has(key)) return;
  seenKeys.add(key);
  effectiveItems.push({
    key,
    refId,
    sourceRefId: ref.refId,
    name: ref.name,
    type: ref.type,
    trackingId: ref.trackingId,
    asset,
    budgetRole: role,
  });
}

function offsetImageReferenceRefId(refId: string, offset: number) {
  if (offset <= 0) return refId;
  return refId.replace(/图片\s*(\d+)/, (_match, value: string) => {
    const nextNumber = Number(value) + offset;
    return `图片${nextNumber}`;
  });
}

function isAssetVideoReferenceItem(
  item: EffectiveVideoReferenceItem,
): item is AssetVideoReferenceItem {
  return 'asset' in item;
}

function isScenePositionBoardAvailable(board: ScenePositionBoardState | undefined, frameRatio?: string) {
  return !!board?.markedBlobKey
    && board.status === 'done'
    && !board.isStale
    && normalizeFrameRatio(board.frameRatio) === normalizeFrameRatio(frameRatio);
}

export function hasOfficialVirtualHumanVideoReferences(
  resolution: Pick<VideoReferenceResolution, 'effectiveItems'>,
): boolean {
  return resolution.effectiveItems.some((item) =>
    isAssetVideoReferenceItem(item) && isOfficialVirtualHumanAsset(item.asset),
  );
}

function normalizeStoryboardBoardRefId(items: EffectiveVideoReferenceItem[]) {
  return items.map((item, index) => (
    item.type === 'storyboard-board'
      ? { ...item, refId: `参考图片${index + 1}` }
      : item
  ));
}

function normalizePromptReferenceName(value: string) {
  return String(value || '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function extractPromptReferenceSlots(prompt?: string): VideoReferencePromptSlot[] {
  const text = String(prompt || '');
  if (!text.trim()) return [];
  const slots: VideoReferencePromptSlot[] = [];
  const seen = new Set<number>();
  const lines = text.split(/\r?\n/);
  const sectionStart = lines.findIndex((line) => /参考(?:图片|图)(?:职责|职能|分配|角色|引用)/.test(line));
  const sectionEndPattern = /^\s*(?:基础规格|读图执行|逐秒执行清单|完整台词|台词与音画同步|声音与表演|空间硬约束|负面规则|画面要求|镜头要求|提交要求)\s*[：:]/;
  const sectionEnd = sectionStart >= 0
    ? lines.findIndex((line, index) => index > sectionStart && sectionEndPattern.test(line))
    : -1;
  const candidateLines = sectionStart >= 0
    ? lines.slice(sectionStart + 1, sectionEnd >= 0 ? sectionEnd : undefined)
    : lines.slice(0, 24);
  const linePattern = /^\s*(?:[-*]\s*)?(.{1,96}?)\s*[\u3010\x5B]\s*@\s*(?:\u56fe\u7247|\u5716\u7247)\s*(\d+)\s*[\u3011\x5D]/;

  for (const line of candidateLines) {
    const match = line.match(linePattern);
    if (!match) continue;
    const number = Number(match[2]);
    const name = match[1]?.trim();
    if (!name || !Number.isFinite(number) || number < 1 || number > VIDEO_REFERENCE_LIMIT || seen.has(number)) continue;
    seen.add(number);
    slots.push({ number, name });
  }

  return slots.sort((left, right) => left.number - right.number);
}

function normalizeSubmitRefId(number: number) {
  return `参考图片${number}`;
}

function isDirectorBoardPromptSlot(slot: VideoReferencePromptSlot) {
  const normalized = normalizePromptReferenceName(slot.name);
  return slot.number === 1
    && (
      normalized.includes('主导演板')
      || normalized.includes('导演板')
      || normalized.includes('故事板')
      || normalized.includes('directorboard')
      || normalized.includes('storyboard')
    );
}

function scorePromptSlotItemMatch(slot: VideoReferencePromptSlot, item: EffectiveVideoReferenceItem): number | null {
  if (item.type === 'storyboard-board') return isDirectorBoardPromptSlot(slot) ? 20000 : null;
  const slotName = normalizePromptReferenceName(slot.name);
  const itemName = normalizePromptReferenceName(item.name);
  if (!slotName || !itemName) return null;
  if (slotName === itemName) return 10000 + itemName.length;
  if (slotName.includes(itemName)) return 5000 + itemName.length;
  return null;
}

function findBestPromptSlotItemMatch(
  slot: VideoReferencePromptSlot,
  items: readonly EffectiveVideoReferenceItem[],
  candidateIndexes: Iterable<number>,
): number | undefined {
  let bestIndex: number | undefined;
  let bestScore = -1;

  for (const itemIndex of candidateIndexes) {
    const score = scorePromptSlotItemMatch(slot, items[itemIndex]);
    if (score === null) continue;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = itemIndex;
    }
  }

  return bestIndex;
}

function normalizePromptReferenceLabelName(value: string) {
  const trimmed = String(value || '').replace(/\s+/g, ' ').trim();
  return trimmed
    .split(/[|｜:：=＝,，;；、]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .pop() ?? trimmed;
}

function findPromptReferenceLabelTarget(
  labelName: string,
  items: readonly EffectiveVideoReferenceItem[],
): EffectiveVideoReferenceItem | undefined {
  const label = normalizePromptReferenceName(labelName);
  if (!label) return undefined;
  if (
    label.includes('主导演板')
    || label.includes('导演板')
    || label.includes('故事板')
    || label.includes('directorboard')
    || label.includes('storyboard')
  ) {
    return items.find((item) => item.type === 'storyboard-board');
  }

  return items.find((item) => {
    if (item.type === 'storyboard-board') return false;
    const itemName = normalizePromptReferenceName(item.name);
    if (!itemName) return false;
    return label === itemName;
  });
}

export function validateVideoPromptReferenceBindings(
  prompt: string,
  items: readonly EffectiveVideoReferenceItem[],
): VideoPromptReferenceBindingValidation {
  const text = String(prompt || '');
  const mismatches: VideoPromptReferenceBindingMismatch[] = [];
  const seen = new Set<string>();
  const pattern = /([^\r\n【】[\]@]{1,64}?)\s*[\u3010\x5B]\s*@\s*(?:\u56fe\u7247|\u5716\u7247)\s*(\d+)\s*[\u3011\x5D]/gu;

  for (const match of text.matchAll(pattern)) {
    const number = Number(match[2]);
    const labelName = normalizePromptReferenceLabelName(match[1] ?? '');
    if (!labelName || !Number.isFinite(number) || number < 1 || number > VIDEO_REFERENCE_LIMIT) continue;

    const actualItem = items[number - 1];
    const intendedItem = findPromptReferenceLabelTarget(labelName, items);
    if (!intendedItem) continue;
    const key = `${number}:${normalizePromptReferenceName(labelName)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!actualItem || intendedItem.key !== actualItem.key) {
      mismatches.push({
        number,
        labelName,
        actualName: actualItem?.name,
      });
    }
  }

  if (mismatches.length === 0) {
    return { valid: true, mismatches };
  }

  const details = mismatches
    .slice(0, 4)
    .map((item) => `图片${item.number} 写成「${item.labelName}」，实际是「${item.actualName ?? '未提交'}」`)
    .join('；');
  const suffix = mismatches.length > 4 ? `；另有 ${mismatches.length - 4} 处` : '';
  return {
    valid: false,
    mismatches,
    message: `Step5 视频提示词里的【@图片x】引用和本次提交参考图不一致：${details}${suffix}。请先修正提示词或刷新参考图后再生成视频。`,
  };
}

function applyFinalPromptReferenceOrder(
  items: EffectiveVideoReferenceItem[],
  finalVideoPrompt?: string,
): { items: EffectiveVideoReferenceItem[]; state: VideoReferencePromptOrderState } {
  const slots = extractPromptReferenceSlots(finalVideoPrompt);
  if (slots.length === 0) {
    return {
      items,
      state: {
        checked: false,
        valid: true,
        reordered: false,
        slots,
      },
    };
  }

  const unmatchedItems = new Set(items.map((_, index) => index));
  const matched: Array<{ slot: VideoReferencePromptSlot; item: EffectiveVideoReferenceItem; originalIndex: number }> = [];
  const unmatchedSlots: VideoReferencePromptSlot[] = [];

  for (const slot of slots) {
    const foundIndex = findBestPromptSlotItemMatch(slot, items, unmatchedItems);
    if (foundIndex === undefined) {
      unmatchedSlots.push(slot);
      continue;
    }
    unmatchedItems.delete(foundIndex);
    matched.push({
      slot,
      item: {
        ...items[foundIndex],
        refId: normalizeSubmitRefId(slot.number),
      },
      originalIndex: foundIndex,
    });
  }

  const matchedIndexes = new Set(matched.map((entry) => entry.originalIndex));
  const notMentionedItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => !matchedIndexes.has(index));
  const relevantUnmatchedSlots = unmatchedSlots.filter((slot) => slot.number <= items.length);
  const valid = relevantUnmatchedSlots.length === 0 && notMentionedItems.length === 0;
  const orderedMatches = matched.sort((left, right) => left.slot.number - right.slot.number);
  const nextItems = valid
    ? orderedMatches.map((entry) => entry.item)
    : [
        ...orderedMatches.map((entry) => entry.item),
        ...notMentionedItems.map(({ item }) => item),
      ];
  const reordered = valid && orderedMatches.some((entry, index) => entry.originalIndex !== index);
  const missingSlotText = relevantUnmatchedSlots
    .map((slot) => `图片${slot.number} ${slot.name}`)
    .join('、');
  const missingItemText = notMentionedItems
    .map(({ item }) => item.name)
    .join('、');
  const message = valid
    ? undefined
    : [
        missingSlotText ? `最终视频词引用了未匹配的参考图：${missingSlotText}` : '',
        missingItemText ? `本次提交参考图未在最终视频词职责区找到编号：${missingItemText}` : '',
      ].filter(Boolean).join('；');

  return {
    items: nextItems,
    state: {
      checked: true,
      valid,
      reordered,
      message,
      slots,
    },
  };
}

export function resolveVideoReferenceAssets(
  imageRefs: ImageReference[],
  assetLibrary: Asset[],
  storyboardBoardReference?: StoryboardBoardVideoReferenceState,
  scenePositionBoard?: ScenePositionBoardState,
  frameRatio?: string,
  options: VideoReferenceResolveOptions = {},
): VideoReferenceResolution {
  const resolved: ResolvedVideoReference[] = [];
  const missing: ImageReference[] = [];
  const rawEffectiveItems: EffectiveVideoReferenceItem[] = [];
  const seenEffectiveKeys = new Set<string>();

  const scenePositionBoardAvailable = options.includeScenePositionBoard === true
    && isScenePositionBoardAvailable(scenePositionBoard, frameRatio);
  let scenePositionBoardUsed = false;

  const shouldIncludeStoryboardBoard = !!storyboardBoardReference?.enabled;
  const storyboardBoardBlobKey = shouldIncludeStoryboardBoard
    && storyboardBoardReference?.available
    ? storyboardBoardReference.blobKey
    : undefined;
  const storyboardBoardImageOffset = storyboardBoardBlobKey ? 1 : 0;

  if (storyboardBoardBlobKey && storyboardBoardReference) {
    rawEffectiveItems.push({
      key: 'storyboard-board',
      refId: '参考图片1',
      name: storyboardBoardReference.selectedMode === 'shot-plan-landscape'
        ? '15格 Shot Sheet 导演参考'
        : isSmartShotPlanBoardMode(storyboardBoardReference.selectedMode)
          ? '智能故事板导演参考'
        : '详细九宫格导演参考',
      type: 'storyboard-board',
      blobKey: storyboardBoardBlobKey,
      modeLabel: storyboardBoardReference.modeLabel,
      required: storyboardBoardReference.required,
      compressed: storyboardBoardReference.compressed,
      lightweightBytes: storyboardBoardReference.lightweightBytes,
      lightweightOriginalBytes: storyboardBoardReference.lightweightOriginalBytes,
      packType: 'full-board',
    });
  }

  for (const ref of imageRefs) {
    const shiftedRefId = offsetImageReferenceRefId(ref.refId, storyboardBoardImageOffset);
    if (ref.type === 'scene' && scenePositionBoardAvailable && scenePositionBoard?.markedBlobKey && !scenePositionBoardUsed) {
      rawEffectiveItems.push({
        key: 'scene-position-board',
        refId: shiftedRefId,
        name: `${ref.name} 场景定位图`,
        type: 'scene-position-board',
        blobKey: scenePositionBoard.markedBlobKey,
        points: scenePositionBoard.points ?? [],
        sourceSceneName: ref.name,
      });
      scenePositionBoardUsed = true;
      continue;
    }

    const asset = resolveVideoReferenceAsset(ref, assetLibrary, frameRatio);
    const officialAsset = resolveOfficialVirtualHumanAsset(ref, assetLibrary);

    if (ref.type === 'character' && officialAsset) {
      resolved.push({ ref, asset: officialAsset });
      pushEffectiveAssetItem(rawEffectiveItems, seenEffectiveKeys, ref, officialAsset, 'official-identity', `${shiftedRefId} 身份`);
    }

    if (asset && !isOfficialVirtualHumanAsset(asset)) {
      resolved.push({ ref, asset });
      pushEffectiveAssetItem(rawEffectiveItems, seenEffectiveKeys, ref, asset, ref.type === 'character' ? 'visual' : 'standard', shiftedRefId);
    } else {
      missing.push(ref);
    }
  }

  const unavailableStoryboardBoardCount = shouldIncludeStoryboardBoard && !storyboardBoardReference?.available ? 1 : 0;
  const rawTotalRefs = rawEffectiveItems.length + missing.length + unavailableStoryboardBoardCount;
  const normalizedEffectiveItems = normalizeStoryboardBoardRefId(rawEffectiveItems);
  const promptOrderResult = applyFinalPromptReferenceOrder(
    normalizedEffectiveItems,
    options.finalVideoPrompt,
  );
  const effectiveItems = promptOrderResult.items;
  const storyboardBoardItem = effectiveItems.find((item) => item.type === 'storyboard-board');
  const totalRefs = effectiveItems.length + missing.length + unavailableStoryboardBoardCount;

  return {
    totalRefs,
    rawTotalRefs,
    exceedsLimit: totalRefs > VIDEO_REFERENCE_LIMIT,
    resolved,
    missing,
    effectiveItems,
    budget: {
      limit: VIDEO_REFERENCE_LIMIT,
      originalTotalRefs: rawTotalRefs,
      compressed: false,
      omittedItems: [],
    },
    storyboardBoardIncluded: !!storyboardBoardItem,
    storyboardBoardRefId: storyboardBoardItem?.refId,
    promptOrder: promptOrderResult.state,
  };
}

function formatReferenceLabel(ref: ImageReference) {
  if (ref.type === 'character' && typeof ref.outfitSeq === 'number') {
    return `角色「${ref.name}」 · 变装${ref.outfitSeq}设定图${ref.refId}`;
  }
  if (ref.type === 'character' && ref.variantKey) {
    return `角色「${ref.name}」 · ${ref.variantKey}设定图${ref.refId}`;
  }
  return `${ref.refId} ${ref.name}`.trim();
}

export function buildVideoReferenceLimitMessage(totalRefs: number): string {
  return `当前分镜共引用 ${totalRefs} 张参考图，但 Seedance 2.0 全能参考模式最多只支持 ${VIDEO_REFERENCE_LIMIT} 张。可在 Step5 的“本次提交参考图”中删除不需要的图片；普通小物件可合并为小道具合集图或改用文字描述，核心角色/场景/剧情道具优先保留。`;
}

export function buildMissingVideoReferenceMessage(missing: ImageReference[]): string {
  const labels = missing.slice(0, 4).map(formatReferenceLabel).join('、');
  const suffix = missing.length > 4 ? ' 等' : '';
  return `请先在 Step3 配置以下参考图：${labels}${suffix}`;
}
