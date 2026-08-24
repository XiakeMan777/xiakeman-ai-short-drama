import type { ImageReference, StoryboardBoardPlanPanel, StoryboardState } from '@/types';
import { sanitizeMisboundImageReferenceLabels } from '@/lib/promptImageRefValidation';
import {
  compareDialogueFidelity,
  extractDialogueEntriesFromText,
  formatDialogueFidelityReport,
} from '@/lib/dialogueFidelity';
import { formatScenePositionPoint, formatShortDramaLayout } from '@/components/step4/scenePositionBoard';
import { getFrameDisplayLabel, normalizeFrameRatio } from '@/lib/frameRatio';
import { resolveStoryboardVideoDuration } from '@/lib/storyboardDuration';
import type { EffectiveVideoReferenceItem, VideoReferenceBudgetOmission } from './videoReferenceResolver';
import { getStoryboardBoardSelectedMode, getStoryboardBoardVariant } from '@/lib/storyboardBoardState';
import { isStoryboardDirectorMode } from './storyboardBoardVideoReference';
import { isShotPlanBoardMode } from '@/components/step4/storyboardBoardMode';

export type CompactVideoPromptStatus = 'idle' | 'optimizing' | 'done' | 'failed';
export type CompactVideoPromptMode = 'compact' | 'desensitized';
export const DEFAULT_COMPACT_VIDEO_PROMPT_RATIO = 0.55;
export const DEFAULT_COMPACT_VIDEO_PROMPT_MAX_CHARS = 1950;
export const ACCEPTABLE_COMPACT_VIDEO_PROMPT_MAX_CHARS = 2400;
export const MIN_ACCEPTABLE_COMPACT_VIDEO_PROMPT_SAVED_RATIO = 0.25;
export const MAX_COMPACT_VIDEO_PROMPT_ATTEMPTS = 2;
const STRICT_NO_SUBTITLE_PROMPT =
  '禁止显示字幕、贴字、标题、Logo、水印、时间码和任何画面内文字。';

function getStoryboardSubmitDurationLabel(storyboard: StoryboardState): string {
  return `${resolveStoryboardVideoDuration(storyboard, storyboard.storyboard.duration)}秒`;
}

export interface CompactVideoPromptState {
  enabled: boolean;
  status: CompactVideoPromptStatus;
  mode?: CompactVideoPromptMode;
  optimizedPrompt: string;
  error?: string;
  sourcePromptSnapshot: string;
  updatedAt?: number;
  isFresh: boolean;
  isUsable: boolean;
}

export interface BuildFinalVideoSubmitPromptOptions {
  effectiveItems?: readonly EffectiveVideoReferenceItem[];
  omittedItems?: readonly VideoReferenceBudgetOmission[];
  videoRatio?: string;
  ignoreCompactPrompt?: boolean;
}

export function buildVideoPromptCompactPayload(
  sourcePrompt: string,
  options?: {
    targetCompressionRatio?: number;
    targetMaxChars?: number;
    aggressiveMode?: boolean;
    attempt?: number;
  },
): string {
  return JSON.stringify({
    sourcePrompt,
    targetCompressionRatio: options?.targetCompressionRatio ?? DEFAULT_COMPACT_VIDEO_PROMPT_RATIO,
    targetMaxChars: options?.targetMaxChars ?? DEFAULT_COMPACT_VIDEO_PROMPT_MAX_CHARS,
    aggressiveMode: options?.aggressiveMode ?? false,
    attempt: options?.attempt ?? 1,
  });
}

export function buildVideoPromptDesensitizePayload(
  sourcePrompt: string,
  options?: {
    failedReason?: string;
  },
): string {
  return JSON.stringify({
    sourcePrompt,
    failedReason: options?.failedReason ?? '',
  });
}

function collectRequiredTokens(sourcePrompt: string): string[] {
  const tokens = new Set<string>();
  for (const match of sourcePrompt.matchAll(/(?:参考图片|图片)(\d+)/g)) {
    tokens.add(`图片${match[1]}`);
  }
  for (const match of sourcePrompt.matchAll(/\d+(?:\.\d+)?[–-]\d+(?:\.\d+)?秒/g)) {
    tokens.add(match[0]);
  }
  return Array.from(tokens);
}

function collectRequiredSemanticGuards(sourcePrompt: string): { label: string; pattern: RegExp }[] {
  const guards: { label: string; pattern: RegExp }[] = [];
  if (/禁止显示字幕|不显示字幕/.test(sourcePrompt)) {
    guards.push({ label: '字幕禁令', pattern: /禁止显示字幕|不显示字幕/ });
  }
  if (/唯一场景空间母版/.test(sourcePrompt)) {
    guards.push({ label: '唯一场景空间母版', pattern: /唯一场景空间母版/ });
  }
  if (/身份硬锁|人物身份硬锁|官方虚拟人身份硬锁/.test(sourcePrompt)) {
    guards.push({ label: '人物身份硬锁', pattern: /身份硬锁/ });
  }
  if (/道具外观硬锁/.test(sourcePrompt)) {
    guards.push({ label: '道具外观硬锁', pattern: /道具外观硬锁/ });
  }
  if (/(服饰|服装|衣服|配饰|造型|服饰款式|服装版本|变装|四视图)/.test(sourcePrompt)) {
    guards.push({ label: '人物服装锁定', pattern: /锁定|一致|保持/ });
    guards.push({ label: '服装/服饰语义', pattern: /服饰|服装|衣服|配饰|造型/ });
  }
  return guards;
}

export function validateDesensitizedVideoPrompt(
  sourcePrompt: string,
  candidatePrompt: string,
): { ok: boolean; reason?: string } {
  const candidate = candidatePrompt.trim();
  if (!candidate) return { ok: false, reason: '脱敏提示词为空。' };

  const sourceSeparators = (sourcePrompt.match(/\*\*\*/g) ?? []).length;
  const candidateSeparators = (candidate.match(/\*\*\*/g) ?? []).length;
  if (sourceSeparators > 0 && candidateSeparators < sourceSeparators) {
    return { ok: false, reason: '脱敏结果丢失了提示词分段结构。' };
  }

  const missingTokens = collectRequiredTokens(sourcePrompt).filter((token) => !candidate.includes(token));
  if (missingTokens.length > 0) {
    return { ok: false, reason: `脱敏结果缺少关键约束：${missingTokens.slice(0, 4).join('、')}。` };
  }

  const missingSemanticGuards = collectRequiredSemanticGuards(sourcePrompt)
    .filter((guard) => !guard.pattern.test(candidate))
    .map((guard) => guard.label);
  if (missingSemanticGuards.length > 0) {
    return { ok: false, reason: `脱敏结果缺少关键语义：${missingSemanticGuards.join('、')}。` };
  }

  const sourceDialogues = extractDialogueEntriesFromText(sourcePrompt);
  if (sourceDialogues.length > 0) {
    const candidateDialogues = extractDialogueEntriesFromText(candidate);
    const dialogueReport = compareDialogueFidelity(sourceDialogues, candidateDialogues);
    if (!dialogueReport.passed) {
      return {
        ok: false,
        reason: `${formatDialogueFidelityReport(dialogueReport, '脱敏提示词')}脱敏只能替换画面风险词，不能改写对白原文。`,
      };
    }
  }

  if (sourcePrompt.length >= 800 && candidate.length < sourcePrompt.length * 0.45) {
    return { ok: false, reason: '脱敏结果过短，可能误删了镜头调度或台词。' };
  }

  return { ok: true };
}

export function isLikelyTextAuditFailure(message?: string): boolean {
  if (!message) return false;
  return /文字审核|文本审核|内容审核|安全审核|敏感词|敏感内容|侵犯他人权益|权益|违规|不合规|审核失败|审核不通过|content filter|moderation|sensitive|policy|unsafe|blocked|rejected/i.test(message);
}

export function getCompactVideoPromptState(
  storyboard: StoryboardState,
  sourcePrompt: string,
): CompactVideoPromptState {
  const status = storyboard.compactVideoPromptStatus ?? 'idle';
  const mode = storyboard.compactVideoPromptMode;
  const optimizedPrompt = storyboard.compactVideoPrompt?.trim() ?? '';
  const sourcePromptSnapshot = storyboard.compactVideoPromptSourcePrompt ?? '';
  const isFresh =
    status === 'done'
    && !!optimizedPrompt
    && sourcePromptSnapshot === sourcePrompt
    && mode === 'desensitized'
    && validateDesensitizedVideoPrompt(sourcePrompt, optimizedPrompt).ok;

  return {
    enabled: !!storyboard.useCompactVideoPrompt,
    status,
    mode,
    optimizedPrompt,
    error: storyboard.compactVideoPromptError,
    sourcePromptSnapshot,
    updatedAt: storyboard.compactVideoPromptUpdatedAt,
    isFresh,
    isUsable: !!storyboard.useCompactVideoPrompt && isFresh,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CREATURE_REFERENCE_NAME_RE = /(怪兽|巨兽|妖兽|异兽|魔兽|凶兽|灵兽|神兽|怪物|兽群|巨龙|龙兽|鳞兽|蛇妖|狼妖|虫群|鼠群|黑鳞|骨刺|monster|creature|beast|dragon|kaiju)/i;
const BACKGROUND_REFERENCE_NAME_RE = /(模糊|人影|远处|背景|群众|群演|剪影|轮廓|背影|路人|护卫|shadow|silhouette|background|crowd|extra|blurred)/i;

function isAssetVideoReferenceItem(
  item: EffectiveVideoReferenceItem,
): item is Extract<EffectiveVideoReferenceItem, { asset: unknown }> {
  return 'asset' in item;
}

function isBlobOnlyVideoReferenceItem(
  item: EffectiveVideoReferenceItem,
): item is Extract<EffectiveVideoReferenceItem, { blobKey: string }> {
  return 'blobKey' in item;
}

function isCreatureReferenceItem(item: EffectiveVideoReferenceItem): boolean {
  if (item.type !== 'character') return false;
  const assetText = isAssetVideoReferenceItem(item)
    ? [
        item.asset.name,
        item.asset.description,
        item.asset.optimizedPrompt,
        item.asset.concept,
      ].filter(Boolean).join(' ')
    : '';
  return CREATURE_REFERENCE_NAME_RE.test(`${item.name} ${assetText}`);
}

function isBackgroundCharacterReferenceItem(item: EffectiveVideoReferenceItem): boolean {
  return item.type === 'character' && BACKGROUND_REFERENCE_NAME_RE.test(item.name);
}

function extractImageNumber(refId: string): number | null {
  const match = refId.match(/图片\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

function hasOfficialVirtualHumanReference(effectiveItems: readonly EffectiveVideoReferenceItem[] | undefined) {
  return !!effectiveItems?.some((item) =>
    isAssetVideoReferenceItem(item)
    && item.asset.type === 'character'
    && item.asset.source === 'volc_virtual_human',
  );
}

function getSubmitImageReferenceType(item: EffectiveVideoReferenceItem): ImageReference['type'] {
  if (item.type === 'storyboard-board' || item.type === 'scene-position-board') return 'scene';
  return item.type;
}

function buildScenePositionBoardInstruction(
  effectiveItems: readonly EffectiveVideoReferenceItem[] | undefined,
  videoRatio?: string,
) {
  if (!effectiveItems?.length) return '';
  const sceneBoard = effectiveItems.find((item) => item.type === 'scene-position-board');
  if (!sceneBoard || sceneBoard.type !== 'scene-position-board') return '';
  const targetFrameRatio = normalizeFrameRatio(videoRatio);
  const frameLabel = getFrameDisplayLabel(targetFrameRatio);
  const layoutGuard = targetFrameRatio === '16:9'
    ? '横屏短剧布局约束：人物脸部必须落在横屏安全区，主要角色保持中近景或半身中景，表情和五官清晰；可利用更宽的左右调度，但不得因为色点靠边、靠下或靠后而把角色生成成远处小人、背影、低头遮脸或被场景陈设遮挡。'
    : '竖屏短剧布局约束：人物脸部必须落在竖屏中上部安全区，主要角色保持中近景或半身中景，表情和五官清晰；不得因为色点靠下、靠边或靠后而把角色生成成远处小人、背影、低头遮脸或被桌椅遮挡。';

  const characterRefByName = new Map<string, string>();
  effectiveItems.forEach((item, index) => {
    if (item.type !== 'character') return;
    if (characterRefByName.has(item.name)) return;
    characterRefByName.set(item.name, `参考图片${index + 1}`);
  });

  const mappingLines = sceneBoard.points
    .filter((point) => characterRefByName.has(point.character))
    .map((point) =>
      `${point.character} 使用 ${characterRefByName.get(point.character)}，脚下/落位点对齐参考图片1中的${point.colorName}，对应空间${formatScenePositionPoint(point)}（约${Math.round(point.x * 100)}%, ${Math.round(point.y * 100)}%）；${frameLabel}成片构图：${formatShortDramaLayout(point, targetFrameRatio)}。`,
    );

  return [
    `场景定位约束：参考图片1是当前镜头的场景定位图（${frameLabel}），彩色圆点只用于人物脚下/落位定位，不是脸部位置，也不是画面物件。`,
    layoutGuard,
    ...mappingLines,
    '最终视频画面不得保留彩色圆点、文字标记、箭头、分屏或示意图样式。',
  ].join('\n');
}

export function getVideoPromptFrameLabel(videoRatio?: string): string {
  const ratio = normalizeFrameRatio(videoRatio);
  if (ratio === '16:9') return '横屏16:9画幅';
  return '竖屏9:16画幅';
}

function replacePromptHeaderFrameRatio(header: string, videoRatio?: string): string {
  const target = getVideoPromptFrameLabel(videoRatio);
  const framePattern = /(?:竖屏|竖版|横屏|横版|方形|正方形)?\s*(?:9\s*[:：]\s*16|16\s*[:：]\s*9|1\s*[:：]\s*1)\s*(?:画幅|比例|构图|视频画幅|竖屏|竖版|横屏|横版|方形|正方形)?/i;
  if (framePattern.test(header)) {
    return header.replace(framePattern, target);
  }
  if (header.includes(target)) return header;
  return `${target}，${header}`;
}

export function syncVideoPromptFrameRatio(prompt: string, videoRatio?: string): string {
  if (!prompt.trim()) return prompt;
  const segments = prompt.split('***');
  const headerIndex = segments.findIndex((segment) => segment.trim().length > 0);
  if (headerIndex < 0) return prompt;

  const segment = segments[headerIndex];
  const trimmedHeader = segment.trim();
  const nextHeader = replacePromptHeaderFrameRatio(trimmedHeader, videoRatio);
  if (nextHeader === trimmedHeader) return prompt;

  segments[headerIndex] = segment.replace(trimmedHeader, nextHeader);
  return segments.join('***');
}

function buildSubmitImageReferences(effectiveItems: readonly EffectiveVideoReferenceItem[]): ImageReference[] {
  return effectiveItems.map((item, index) => ({
    refId: `(图片${index + 1})`,
    type: getSubmitImageReferenceType(item),
    name: item.name,
    fileName: item.name,
    assetId: isAssetVideoReferenceItem(item) ? item.asset.id : (isBlobOnlyVideoReferenceItem(item) ? item.blobKey : undefined),
    trackingId: isAssetVideoReferenceItem(item) ? item.trackingId : undefined,
  }));
}

interface SubmitImageMapping {
  originalNumber: number;
  name: string;
  type: ImageReference['type'] | 'storyboard-board' | 'scene-position-board';
  defaultNumber: number;
  identityNumber?: number;
  visualNumber?: number;
}

function buildSubmitImageMappings(
  effectiveItems: readonly EffectiveVideoReferenceItem[],
): SubmitImageMapping[] {
  const byOriginalNumber = new Map<number, SubmitImageMapping>();

  effectiveItems.forEach((item, index) => {
    const originalNumber = extractImageNumber(item.refId);
    if (!originalNumber) return;

    const submitNumber = index + 1;
    const existing = byOriginalNumber.get(originalNumber);
    const mapping: SubmitImageMapping = existing ?? {
      originalNumber,
      name: item.name,
      type: item.type,
      defaultNumber: submitNumber,
    };

    if (isAssetVideoReferenceItem(item) && item.asset.source === 'volc_virtual_human') {
      mapping.identityNumber = submitNumber;
      mapping.defaultNumber = submitNumber;
    } else if (item.type === 'character') {
      mapping.visualNumber = submitNumber;
      if (!mapping.identityNumber) mapping.defaultNumber = submitNumber;
    } else {
      mapping.defaultNumber = submitNumber;
    }

    byOriginalNumber.set(originalNumber, mapping);
  });

  return Array.from(byOriginalNumber.values());
}

function createPlaceholderStore() {
  let index = 0;
  const replacements = new Map<string, string>();

  return {
    put(value: string) {
      const key = `__VIDEO_REF_PLACEHOLDER_${index++}__`;
      replacements.set(key, value);
      return key;
    },
    restore(value: string) {
      let restored = value;
      replacements.forEach((replacement, key) => {
        restored = restored.split(key).join(replacement);
      });
      return restored;
    },
  };
}

function replaceOfficialVirtualHumanCharacterRefs(
  prompt: string,
  mappings: readonly SubmitImageMapping[],
  placeholders: ReturnType<typeof createPlaceholderStore>,
) {
  let nextPrompt = prompt;

  mappings
    .filter((mapping) => mapping.type === 'character' && !!mapping.identityNumber)
    .forEach((mapping) => {
      const identityNumber = mapping.identityNumber!;
      const visualNumber = mapping.visualNumber;
      const escapedName = escapeRegExp(mapping.name);
      const originalNumber = mapping.originalNumber;

      const subjectReference = visualNumber && visualNumber !== identityNumber
        ? `${mapping.name}(图片${identityNumber}，服装参考图片${visualNumber})`
        : `${mapping.name}(图片${identityNumber})`;

      nextPrompt = nextPrompt.replace(
        new RegExp(`${escapedName}[（(]\\s*图片\\s*${originalNumber}\\s*[）)]`, 'g'),
        placeholders.put(subjectReference),
      );

      nextPrompt = nextPrompt.replace(
        new RegExp(`(${escapedName}[：:])\\s*官方虚拟人身份图?锁定`, 'g'),
        (_match, prefix: string) => `${prefix}${placeholders.put(`参考图片${identityNumber}为${mapping.name}官方虚拟人身份图，锁定`)}`,
      );

      if (!visualNumber) {
        nextPrompt = nextPrompt.replace(
          new RegExp(`参考图片\\s*${originalNumber}\\s*(?:只锁定|仅锁定)[^。；;\\n]*(?:[。；;]|$)`, 'g'),
          placeholders.put('服装、体态和配饰以本段文字描述为准。'),
        );
        nextPrompt = nextPrompt.replace(
          new RegExp(`参考图片\\s*${originalNumber}(?!\\d)(?=.{0,18}(?:服装|服饰|衣服|造型|配饰|体态|身形|伤势|四视图|变装))`, 'g'),
          placeholders.put('文字服装描述'),
        );
        return;
      }

      nextPrompt = nextPrompt.replace(
        new RegExp(`参考图片\\s*${originalNumber}\\s*(只锁定|仅锁定)`, 'g'),
        (_match, lockWord: string) => placeholders.put(`参考图片${visualNumber}${lockWord}`),
      );

      nextPrompt = nextPrompt.replace(
        new RegExp(`参考图片\\s*${originalNumber}(?!\\d)(?=.{0,18}(?:服装|服饰|衣服|造型|配饰|体态|身形|伤势|四视图|变装))`, 'g'),
        placeholders.put(`参考图片${visualNumber}`),
      );
    });

  return nextPrompt;
}

function removeOmittedImageReferenceForms(
  prompt: string,
  omittedItems: readonly VideoReferenceBudgetOmission[] | undefined,
  mappings: readonly SubmitImageMapping[],
  placeholders: ReturnType<typeof createPlaceholderStore>,
) {
  if (!omittedItems?.length) return prompt;

  const mappingByOriginalNumber = new Map(mappings.map((mapping) => [mapping.originalNumber, mapping]));
  let nextPrompt = prompt;

  omittedItems.forEach((item) => {
    const originalNumber = extractImageNumber(item.refId);
    if (!originalNumber) return;

    const mapping = mappingByOriginalNumber.get(originalNumber);
    if (item.reason === 'character-visual-degraded' && mapping?.identityNumber) {
      nextPrompt = nextPrompt.replace(
        new RegExp(`参考图片\\s*${originalNumber}\\s*(?:只锁定|仅锁定)[^。；;\\n]*(?:[。；;]|$)`, 'g'),
        placeholders.put('服装、体态和配饰以本段文字描述为准。'),
      );
      nextPrompt = nextPrompt.replace(
        new RegExp(`参考图片\\s*${originalNumber}(?!\\d)(?=.{0,18}(?:服装|服饰|衣服|造型|配饰|体态|身形|伤势|四视图|变装))`, 'g'),
        placeholders.put('文字服装描述'),
      );
      return;
    }

    const escapedName = escapeRegExp(item.name);
    if (item.reason === 'character-identity-overflow') {
      nextPrompt = nextPrompt.replace(
        new RegExp(`${escapedName}[：:]\\s*官方虚拟人身份图?锁定[^。；;\\n]*(?:[。；;]|$)`, 'g'),
        placeholders.put(`${item.name}：外貌身份以角色文字描述为准。`),
      );
    }
    nextPrompt = nextPrompt.replace(
      new RegExp(`${escapedName}[（(]\\s*图片\\s*${originalNumber}\\s*[）)]`, 'g'),
      placeholders.put(item.name),
    );
    nextPrompt = nextPrompt.replace(
      new RegExp(`参考图片\\s*${originalNumber}\\s*(?:中|里|里的)?`, 'g'),
      '',
    );
    nextPrompt = nextPrompt.replace(
      new RegExp(`（\\s*图片\\s*${originalNumber}\\s*）`, 'g'),
      '',
    );
    nextPrompt = nextPrompt.replace(
      new RegExp(`\\(\\s*图片\\s*${originalNumber}\\s*\\)`, 'g'),
      '',
    );
    nextPrompt = nextPrompt.replace(
      new RegExp(`图片\\s*${originalNumber}(?!\\d)`, 'g'),
      '',
    );
  });

  return nextPrompt;
}

function replaceImageReferenceForms(
  prompt: string,
  originalNumber: number,
  submitNumber: number,
  placeholders: ReturnType<typeof createPlaceholderStore>,
) {
  let nextPrompt = prompt;

  nextPrompt = nextPrompt.replace(
    new RegExp(`参考图片\\s*${originalNumber}(?!\\d)`, 'g'),
    placeholders.put(`参考图片${submitNumber}`),
  );
  nextPrompt = nextPrompt.replace(
    new RegExp(`（\\s*图片\\s*${originalNumber}\\s*）`, 'g'),
    placeholders.put(`（图片${submitNumber}）`),
  );
  nextPrompt = nextPrompt.replace(
    new RegExp(`\\(\\s*图片\\s*${originalNumber}\\s*\\)`, 'g'),
    placeholders.put(`(图片${submitNumber})`),
  );
  nextPrompt = nextPrompt.replace(
    new RegExp(`图片\\s*${originalNumber}(?!\\d)`, 'g'),
    placeholders.put(`图片${submitNumber}`),
  );

  return nextPrompt;
}

function remapOfficialVirtualHumanSubmitPrompt(
  prompt: string,
  effectiveItems: readonly EffectiveVideoReferenceItem[],
  omittedItems?: readonly VideoReferenceBudgetOmission[],
) {
  const mappings = buildSubmitImageMappings(effectiveItems);
  if (mappings.length === 0) return prompt;

  const placeholders = createPlaceholderStore();
  let nextPrompt = removeOmittedImageReferenceForms(prompt, omittedItems, mappings, placeholders);
  nextPrompt = replaceOfficialVirtualHumanCharacterRefs(nextPrompt, mappings, placeholders);

  mappings.forEach((mapping) => {
    nextPrompt = replaceImageReferenceForms(nextPrompt, mapping.originalNumber, mapping.defaultNumber, placeholders);
  });

  return placeholders.restore(nextPrompt);
}

function hasHardLockEquivalent(segment: string, refNumber: number, keyword: string) {
  return new RegExp(`参考图片\\s*${refNumber}(?!\\d)[^\\n。；;]*${keyword}`).test(segment);
}

function appendMissingHardLockLines(segment: string, lines: string[]) {
  const missing = lines.filter((line) => !segment.includes(line));
  if (missing.length === 0) return segment;

  const trimmed = segment.trim();
  if (!trimmed) return `\n${missing.join('\n')}\n`;
  return segment.replace(trimmed, `${trimmed}\n${missing.join('\n')}`);
}

function normalizeNoSubtitleWording(prompt: string): string {
  return prompt
    .replace(/不显示字幕，画面内禁止任何中文字幕、对白字幕、歌词字幕、贴字、标题、弹幕、对白气泡、Logo、水印、时间码和烧录字幕/g, STRICT_NO_SUBTITLE_PROMPT)
    .replace(/禁止显示字幕，禁止任何画面内文字、中文字幕、对白字幕、歌词字幕、贴字、标题、弹幕、对白气泡、Logo、水印、时间码和烧录字幕/g, STRICT_NO_SUBTITLE_PROMPT);
}

function getHardLockSegmentIndexes(segments: string[]) {
  const nonEmpty = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.trim().length > 0);

  return {
    sceneIndex: nonEmpty[1]?.index,
    characterIndex: nonEmpty[2]?.index,
  };
}

function buildReferenceHardLockLines(effectiveItems: readonly EffectiveVideoReferenceItem[]) {
  const hasOfficialIdentityByName = new Set(
    effectiveItems
      .filter((item) =>
        item.type === 'character'
        && isAssetVideoReferenceItem(item)
        && item.asset.source === 'volc_virtual_human',
      )
      .map((item) => item.name),
  );

  const sceneLines: string[] = [];
  const characterLines: string[] = [];
  const propLines: string[] = [];

  effectiveItems.forEach((item, index) => {
    const refNumber = index + 1;
    if (item.type === 'scene') {
      sceneLines.push(`参考图片${refNumber}是唯一场景空间母版，${item.name}的空间结构、关键锚点、光线、色调和机位轴线全程锁定；文字只补本镜空间轴线、危险区、入场方向和不可换轴。`);
      return;
    }
    if (item.type === 'scene-position-board') {
      sceneLines.push(`参考图片${refNumber}是当前镜头场景定位图，只硬锁人物脚下/落位坐标和空间方位；彩色圆点不得作为最终画面元素保留。`);
      return;
    }
    if (item.type === 'storyboard-board') {
      if (item.packType === 'scene-blocking') {
        sceneLines.push(`参考图片${refNumber}是当前镜头的场景走位合成图：真实场景图上叠加角色脚下落位点、运动箭头和编号，只用于锁定空间、运动方向和落幅关系；最终视频画面不得保留彩色点、箭头、编号、标题或任何标记。`);
        return;
      }
      if (item.packType === 'character-lock') {
        characterLines.push(`参考图片${refNumber}是旧版开发板角色锁定裁剪图，只用于辅助读取本镜头角色身份关系；角色五官、脸型、服装和配饰仍以独立角色参考图为最高优先级。`);
        return;
      }
      if (item.packType === 'camera-light') {
        sceneLines.push(`参考图片${refNumber}是旧版开发板镜头光线裁剪图，只锁定机位方向、景别推进、主光方向和落幅重心，不得把模块排版或文字生成到画面中。`);
        return;
      }
      if (item.packType === 'keyframes') {
        sceneLines.push(`参考图片${refNumber}是旧版开发板 3x3 关键帧裁剪图，必须按 1-9 格理解 15 秒内动作、站位、构图和镜头重心的连续推进；最终视频不是九宫格，不得保留分格边框、数字或标签。`);
        return;
      }
      sceneLines.push(`参考图片${refNumber}是当前镜头的故事板导演参考图，只硬锁镜头调度、景别节奏、动作推进、站位连续和落幅关系；不得当成新场景母版改写场景，最终视频不得保留故事板边框、编号、标签或说明文字。`);
      return;
    }

    if (item.type === 'character') {
      if (isBackgroundCharacterReferenceItem(item)) {
        characterLines.push(`参考图片${refNumber}中的${item.name}只作为远景/背景/模糊轮廓参考，不锁清晰五官、脸型、发型和服装，不得抢占主戏或生成成新主角。`);
        return;
      }

      if (isAssetVideoReferenceItem(item) && item.asset.source === 'volc_virtual_human') {
        characterLines.push(`参考图片${refNumber}为${item.name}官方虚拟人身份图，官方虚拟人身份硬锁脸部身份，五官比例、脸型、发型和年龄感全程继承官方身份图。`);
        return;
      }

      if (hasOfficialIdentityByName.has(item.name)) {
        characterLines.push(`参考图片${refNumber}硬锁${item.name}服装/体态/装扮/材质/配饰，不锁五官脸型发型。`);
        return;
      }

      if (isCreatureReferenceItem(item)) {
        characterLines.push(`参考图片${refNumber}中${item.name}身份硬锁，主体形态硬锁；文字只补本镜攻击方式、受损变化和运动姿态，不套用人类发型服饰配饰。`);
        return;
      }

      characterLines.push(`参考图片${refNumber}中${item.name}身份硬锁，参考图负责五官、脸型、发型、服装、配饰一致性；文字只补当前状态、持物和本镜动作任务。`);
      return;
    }

    if (item.type === 'prop') {
      propLines.push(`参考图片${refNumber}中${item.name}道具工业板硬锁；继承形状、尺寸、材质、颜色、结构、多角度、状态版本和使用方式；文字只补当前持有人、位置、状态和变化，不得变色、变形、消失或替换。`);
    }
  });

  return { sceneLines, characterLines, propLines };
}

export function enforceReferenceHardLocks(
  prompt: string,
  effectiveItems?: readonly EffectiveVideoReferenceItem[],
): string {
  if (!prompt.trim() || !effectiveItems?.length) return prompt;
  if (/Reference Material Roles \/ 参考图优先级|参考图优先级|(?:场景|角色|道具|主导演板)：参考图片/.test(prompt)) return prompt;

  const { sceneLines, characterLines, propLines } = buildReferenceHardLockLines(effectiveItems);
  if (sceneLines.length === 0 && characterLines.length === 0 && propLines.length === 0) return prompt;

  const segments = prompt.split('***');
  const { sceneIndex, characterIndex } = getHardLockSegmentIndexes(segments);
  if (typeof sceneIndex !== 'number' && typeof characterIndex !== 'number') {
    return appendMissingHardLockLines(prompt, [
      ...sceneLines,
      ...characterLines,
      ...propLines,
    ]);
  }

  if (typeof sceneIndex === 'number') {
    let sceneSegment = segments[sceneIndex];
    effectiveItems.forEach((item, index) => {
      if (item.type !== 'scene') return;
      const refNumber = index + 1;
      sceneSegment = sceneSegment.replace(
        new RegExp(`参考图片\\s*${refNumber}\\s*(?:中|中的|里|里的)?场景`, 'g'),
        `参考图片${refNumber}是唯一场景空间母版`,
      );
    });
    const missingSceneLines = sceneLines.filter((line) => {
      const refNumber = Number(line.match(/参考图片(\d+)/)?.[1]);
      return !refNumber || !hasHardLockEquivalent(sceneSegment, refNumber, '唯一场景空间母版|场景定位图|故事板导演参考图|Seedance九宫格故事板');
    });
    segments[sceneIndex] = appendMissingHardLockLines(sceneSegment, missingSceneLines);
  }

  if (typeof characterIndex === 'number') {
    let characterSegment = segments[characterIndex];
    effectiveItems.forEach((item, index) => {
      const refNumber = index + 1;
      if (item.type === 'character') {
        characterSegment = characterSegment.replace(
          new RegExp(`参考图片\\s*${refNumber}\\s*中\\s*${escapeRegExp(item.name)}\\s*的?外貌特征`, 'g'),
          `参考图片${refNumber}中${item.name}身份硬锁`,
        );
        if (isCreatureReferenceItem(item)) {
          const escapedName = escapeRegExp(item.name);
          characterSegment = characterSegment.replace(
            new RegExp(`(参考图片\\s*${refNumber}\\s*中\\s*${escapedName}\\s*身份硬锁[^\\n]*?)五官[、，]?脸型[、，]?发型[、，]?服(?:装|饰)[、，]?配饰全程继承参考图`, 'g'),
            `$1主体形态硬锁；文字只补本镜攻击方式、受损变化和运动姿态，不套用人类发型服饰配饰`,
          );
          characterSegment = characterSegment.replace(
            new RegExp(`(参考图片\\s*${refNumber}\\s*中\\s*${escapedName}\\s*身份硬锁[^\\n]*?)五官脸型发型服饰配饰全程继承参考图`, 'g'),
            `$1主体形态硬锁；文字只补本镜攻击方式、受损变化和运动姿态，不套用人类发型服饰配饰`,
          );
        }
      }
      if (item.type === 'prop') {
        characterSegment = characterSegment.replace(
          new RegExp(`参考图片\\s*${refNumber}\\s*中\\s*([^，。；;\\n]{0,24}?)道具的外观特征`, 'g'),
          `参考图片${refNumber}中$1道具外观硬锁`,
        );
      }
    });

    const missingCharacterLines = characterLines.filter((line) => {
      const refNumber = Number(line.match(/参考图片(\d+)/)?.[1]);
      if (!refNumber) return true;
      return !hasHardLockEquivalent(characterSegment, refNumber, '身份硬锁')
        && !hasHardLockEquivalent(characterSegment, refNumber, '官方虚拟人身份硬锁')
        && !hasHardLockEquivalent(characterSegment, refNumber, '硬锁');
    });
    const missingPropLines = propLines.filter((line) => {
      const refNumber = Number(line.match(/参考图片(\d+)/)?.[1]);
      return !refNumber || !hasHardLockEquivalent(characterSegment, refNumber, '道具外观硬锁');
    });
    segments[characterIndex] = appendMissingHardLockLines(characterSegment, [
      ...missingCharacterLines,
      ...missingPropLines,
    ]);
  }

  return segments.join('***');
}

function clipDirectorText(value: string | undefined, maxLength: number): string {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…` : normalized;
}

function uniqueCompactValues(values: Array<string | undefined>, maxItems: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = clipDirectorText(value, 120);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

function joinDirectorParts(parts: Array<string | undefined>, separator = '，'): string {
  return parts
    .map((part) => clipDirectorText(part, 160))
    .filter(Boolean)
    .join(separator);
}

function formatCueSentence(
  lead: string,
  parts: Array<string | undefined>,
  fallback: string,
): string {
  const body = joinDirectorParts(parts);
  return `${lead}${body || fallback}。`;
}

function extractCurrentStoryboardSection(text: string | undefined, storyboard: StoryboardState): string {
  const source = text?.trim() ?? '';
  if (!source) return '';

  const headingPattern = /^#{0,4}\s*分镜\s*0*(\d+)[^\n\r]*$/gm;
  const matches = Array.from(source.matchAll(headingPattern));
  if (matches.length === 0) return source;

  const storyboardNumber = storyboard.storyboard.number;
  const normalizedName = storyboard.storyboard.name.trim();
  const resolved = matches
    .map((match, index) => {
      const start = match.index ?? 0;
      const end = index < matches.length - 1 ? (matches[index + 1].index ?? source.length) : source.length;
      return {
        number: Number(match[1]),
        heading: match[0],
        content: source.slice(start, end).trim(),
      };
    })
    .find((section) =>
      section.number === storyboardNumber
      || (!!normalizedName && section.heading.includes(normalizedName)),
    );

  return resolved?.content ?? '';
}

function buildStoryboardDirectorScriptBrief(storyboard: StoryboardState): string {
  const candidates = [
    storyboard.sourceExcerpt,
    storyboard.correctedScript,
    storyboard.sourceExcerptSummary,
  ];

  for (const candidate of candidates) {
    const section = extractCurrentStoryboardSection(candidate, storyboard);
    if (section.trim()) return clipDirectorText(section, 520);
  }

  return storyboard.storyboard.name;
}

function formatStoryboardDirectorReferenceRole(item: EffectiveVideoReferenceItem, index: number): string {
  const refLabel = `参考图片${index + 1}`;

  if (item.type === 'scene') {
    return `Step3场景：${refLabel}「${item.name}」= 空间结构、关键锚点、光线、色调、机位轴线。`;
  }

  if (item.type === 'scene-position-board') {
    return `定位图：${refLabel} = 人物脚下落位和空间方位；成片不保留色点、箭头或示意图。`;
  }

  if (item.type === 'storyboard-board') {
    return `主导演板：${refLabel}（${clipDirectorText(item.modeLabel, 48)}）= 镜头顺序、blocking、机位节奏、对白/SFX/AUDIO、转场、首尾连续；成片不保留边框、编号、箭头或文字。`;
  }

  if (item.type === 'character') {
    if (isBackgroundCharacterReferenceItem(item)) {
      return `氛围角色：${refLabel}「${item.name}」= 远景/背景轮廓，不锁清晰五官服装，不生成清晰主角。`;
    }
    if (isAssetVideoReferenceItem(item) && item.asset.source === 'volc_virtual_human') {
      return `官方角色：${refLabel}「${item.name}」= 脸部身份、五官比例、脸型、发型、年龄感。`;
    }
    if (isCreatureReferenceItem(item)) {
      return `生物角色：${refLabel}「${item.name}」= 主体形态、体量、材质、轮廓；文字只补运动姿态。`;
    }
    return `Step3角色：${refLabel}「${item.name}」= 身份、五官、服装、配饰、体态一致。`;
  }

  if (item.type === 'prop') {
    return `Step3道具：${refLabel}「${item.name}」= 形状、尺寸、材质、颜色、结构、使用方式。`;
  }

  return `参考素材：${refLabel}「${item.name}」= 按文本指定职责使用。`;
}

function buildStoryboardDirectorReferenceRoles(
  effectiveItems: readonly EffectiveVideoReferenceItem[] | undefined,
  frameLabel: string,
  mode: 'director' | 'compact' = 'director',
  includeHeading = true,
): string {
  const executionRuleWithStoryboardBoard = '执行规则：先按主导演板完成调度和节奏，再用场景、角色、道具100%锁定外观；不要从整板重设计角色、场景或道具。';

  if (mode === 'compact') {
    const items = effectiveItems ?? [];
    const labelFor = (item: EffectiveVideoReferenceItem) => {
      const index = items.indexOf(item);
      return `参考图片${index >= 0 ? index + 1 : 0}「${item.name}」`;
    };
    const storyboardBoardItem = items.find((item) => item.type === 'storyboard-board');
    const sceneItems = items.filter((item) => item.type === 'scene');
    const scenePositionItems = items.filter((item) => item.type === 'scene-position-board');
    const characterItems = items.filter((item) => item.type === 'character');
    const propItems = items.filter((item) => item.type === 'prop');
    const plainCharacterItems = characterItems.filter((item) =>
      !isBackgroundCharacterReferenceItem(item)
      && !(isAssetVideoReferenceItem(item) && item.asset.source === 'volc_virtual_human')
      && !isCreatureReferenceItem(item),
    );
    const specialCharacterItems = characterItems.filter((item) =>
      !plainCharacterItems.includes(item),
    );
    const lines: string[] = [];

    if (sceneItems.length > 0) {
      lines.push(`场景：${sceneItems.map(labelFor).join('、')} = 空间结构、关键锚点、光线、色调、机位轴线。`);
    }

    if (scenePositionItems.length > 0) {
      lines.push(`定位图：${scenePositionItems.map(labelFor).join('、')} = 人物脚下落位和空间方位；成片不保留色点、箭头或示意图。`);
    }

    if (plainCharacterItems.length > 0) {
      lines.push(`角色：${plainCharacterItems.map(labelFor).join('、')} = 身份、五官、服装、配饰、体态一致。`);
    }

    for (const item of specialCharacterItems) {
      if (isBackgroundCharacterReferenceItem(item)) {
        lines.push(`氛围角色：${labelFor(item)} = 远景/背景轮廓，不生成清晰主角。`);
        continue;
      }
      if (isAssetVideoReferenceItem(item) && item.asset.source === 'volc_virtual_human') {
        lines.push(`官方角色：${labelFor(item)} = 脸部身份、五官比例、脸型、发型、年龄感。`);
        continue;
      }
      if (isCreatureReferenceItem(item)) {
        lines.push(`生物角色：${labelFor(item)} = 主体形态、体量、材质、轮廓。`);
        continue;
      }
      lines.push(`角色：${labelFor(item)} = 身份、五官、服装、配饰、体态一致。`);
    }

    if (propItems.length > 0) {
      lines.push(`道具：${propItems.map(labelFor).join('、')} = 形状、尺寸、材质、颜色、结构、使用方式。`);
    }

    if (storyboardBoardItem) {
      lines.push(`主导演板：${labelFor(storyboardBoardItem)} = 镜头顺序、blocking、机位节奏、对白/SFX/AUDIO、转场、首尾连续；成片不保留边框、编号、箭头或文字。`);
    }

    lines.push(storyboardBoardItem
      ? executionRuleWithStoryboardBoard
      : '执行规则：按 Step3 资产锁定身份、空间和外观。');

    return [
      includeHeading ? `参考图优先级（${frameLabel}，按提交顺序）：` : '',
      ...lines,
    ].filter(Boolean).join('\n');
  }

  const lines = effectiveItems?.length
    ? effectiveItems.map(formatStoryboardDirectorReferenceRole)
    : ['未解析到参考图时，仍按 Step3 已提交的角色、场景和道具资产锁定身份、空间和外观。'];
  const hasStoryboardBoard = !!effectiveItems?.some((item) => item.type === 'storyboard-board');

  return [
    includeHeading ? `参考图优先级（${frameLabel}，按提交顺序）：` : '',
    ...lines,
    hasStoryboardBoard
      ? executionRuleWithStoryboardBoard
      : '执行规则：按 Step3 资产锁定身份、空间和外观。',
  ].filter(Boolean).join('\n');
}

function getStoryboardDirectorPanels(storyboard: StoryboardState): StoryboardBoardPlanPanel[] {
  const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const variant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode);
  return variant?.plan?.panels ?? [];
}

function getPanelGroupLabel(groupIndex: number, groupCount: number): string {
  if (groupCount <= 3) return ['起势', '推进', '落幅'][groupIndex] ?? '推进';
  if (groupCount === 4) return ['起势', '推进', '转折', '落幅'][groupIndex] ?? '推进';
  if (groupCount === 5) return ['起势', '推进', '转折', '高潮', '落幅'][groupIndex] ?? '推进';
  return ['起势', '入场/对峙', '推进', '转折', '高潮', '落幅'][groupIndex] ?? '推进';
}

function splitPanelsForTimeline(panels: StoryboardBoardPlanPanel[]): StoryboardBoardPlanPanel[][] {
  if (panels.length <= 6) return panels.map((panel) => [panel]);

  if (panels.length === 7) {
    return [[panels[0]], [panels[1]], [panels[2], panels[3]], [panels[4]], [panels[5]], [panels[6]]];
  }

  return [
    panels.slice(0, 2),
    panels.slice(2, 4),
    panels.slice(4, 6),
    panels.slice(6, 7),
    panels.slice(7, 9),
  ].filter((group) => group.length > 0);
}

function formatPanelGroupTime(group: StoryboardBoardPlanPanel[], fallback?: string): string {
  const first = group[0];
  const last = group[group.length - 1];
  if (!first) return fallback || '未标注时间';
  if (group.length === 1) return first.timeRange || first.beat;
  const firstTime = first.timeRange || first.beat;
  const lastTime = last.timeRange || last.beat;
  if (!firstTime && !lastTime) return fallback || '未标注时间';
  return firstTime === lastTime ? firstTime : `${firstTime || fallback || '起点'} → ${lastTime || fallback || '落点'}`;
}

function formatStoryboardDirectorCueGroup(
  group: StoryboardBoardPlanPanel[],
  index: number,
  groupCount: number,
): string {
  const first = group[0];
  const last = group[group.length - 1];
  const subjects = uniqueCompactValues(
    group.flatMap((panel) => [panel.primarySubject, ...panel.secondarySubjects]),
    4,
  ).join('、');
  const actions = uniqueCompactValues(
    group.map((panel) => panel.motion || panel.staticMoment || panel.beat),
    3,
  ).join('；');
  const camera = uniqueCompactValues(
    group.map((panel) => panel.cameraTask || `${panel.shotType} ${panel.cameraAngle}`),
    2,
  ).join('；');
  const composition = uniqueCompactValues(
    group.map((panel) => panel.composition || panel.staticMoment),
    2,
  ).join('；');
  const mustShow = uniqueCompactValues(
    group.flatMap((panel) => panel.mustShow),
    4,
  ).join('、');
  const entry = clipDirectorText(first?.continuityIn || first?.blocking, 100);
  const exit = clipDirectorText(last?.continuityOut || last?.continuity, 120);
  const dialoguePerformance = uniqueCompactValues(
    group.map((panel) => panel.dialoguePerformance),
    2,
  ).join('；');
  const dialogue = uniqueCompactValues(
    group.map((panel) => panel.dialogue),
    2,
  ).join('；');
  const sfx = uniqueCompactValues(
    group.map((panel) => panel.sfx),
    2,
  ).join('；');
  const audio = uniqueCompactValues(
    group.map((panel) => panel.audio),
    2,
  ).join('；');
  const transition = uniqueCompactValues(
    group.map((panel) => panel.transition),
    2,
  ).join('；');
  const beat = getPanelGroupLabel(index, groupCount);
  const time = formatPanelGroupTime(group, `${index + 1}/${groupCount}`);
  const lead = index === 0
    ? 'Open with '
    : index === groupCount - 1
      ? 'Finish with '
      : index === 1
        ? 'Cut to '
        : 'Continue with ';
  const fallback = `${subjects || 'the current subject'} following the Seedance storyboard beat ${beat}`;

  return [
    `${index + 1}. ${time} | ${beat}`,
    entry ? `Start from: ${entry}.` : '',
    formatCueSentence(lead, [
      subjects ? `${subjects} as the visible subject` : '',
      actions,
      composition ? `composition: ${composition}` : '',
      mustShow ? `must show ${mustShow}` : '',
    ], fallback),
    camera ? `Camera cue: ${clipDirectorText(camera, 170)}.` : '',
    dialogue ? `Dialogue cue: ${clipDirectorText(dialogue, 150)}.` : '',
    sfx || audio ? `Sound cue: ${clipDirectorText([sfx ? `SFX ${sfx}` : '', audio ? `AUDIO ${audio}` : ''].filter(Boolean).join(' / '), 180)}.` : '',
    transition ? `Transition cue: ${clipDirectorText(transition, 120)}.` : '',
    dialoguePerformance ? `Performance cue: ${clipDirectorText(dialoguePerformance, 150)}.` : '',
    exit ? `End with: ${exit}.` : '',
  ].filter(Boolean).join(' ');
}

function buildStoryboardDirectorShotCueSequence(storyboard: StoryboardState): string {
  const panels = getStoryboardDirectorPanels(storyboard);
  if (panels.length > 0) {
    const groups = splitPanelsForTimeline(panels);
    return groups
      .map((group, index) => formatStoryboardDirectorCueGroup(group, index, groups.length))
      .join('\n');
  }

  const choreographySegments = storyboard.choreography?.timeSegments ?? [];
  if (choreographySegments.length > 0) {
    return choreographySegments.slice(0, 6).map((segment, index) => [
      `${index + 1}. ${segment.timeRange || `${index + 1}/6`} | ${segment.segmentType || '推进'}`,
      formatCueSentence(index === 0 ? 'Open with ' : index === choreographySegments.length - 1 ? 'Finish with ' : 'Cut to ', [
        segment.actionFlow,
        segment.rhythm ? `rhythm: ${segment.rhythm}` : '',
      ], storyboard.storyboard.name),
      segment.camera ? `Camera cue: ${clipDirectorText(segment.camera, 170)}.` : '',
      segment.sound ? `Audio cue: ${clipDirectorText(segment.sound, 100)}.` : '',
    ].filter(Boolean).join(' ')).join('\n');
  }

  return `1. Full segment | current storyboard. Open with ${clipDirectorText(storyboard.storyboard.name, 120)}. Camera cue: ${storyboard.storyboard.shotSize || 'follow the storyboard shot size'}. End with the current segment's final state ready for the next shot.`;
}

function buildStoryboardDirectorScreenDirection(storyboard: StoryboardState): string {
  const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const variant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode);
  const plan = variant?.plan;
  const axis = plan?.blockingContinuity?.movementAxis || plan?.cameraPlan?.cameraAxis;
  const relation = plan?.cameraPlan?.cameraRelation;
  const changeReason = plan?.blockingContinuity?.cameraChanged
    ? plan.blockingContinuity.cameraChangeReason || 'camera angle may change only as specified'
    : '';

  return [
    axis ? `Screen direction / movement axis: ${clipDirectorText(axis, 150)}.` : '',
    relation ? `Camera relationship: ${clipDirectorText(relation, 120)}.` : '',
    changeReason
      ? `If the camera changes, keep the same world positions and use the change only for ${clipDirectorText(changeReason, 130)}.`
      : 'Do not flip screen direction or reset world positions between cues.',
  ].filter(Boolean).join('\n');
}

function buildStoryboardDirectorContinuityBrief(storyboard: StoryboardState): string {
  const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const variant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode);
  const plan = variant?.plan;
  const worldLock = plan?.worldLock;
  const blocking = plan?.blockingContinuity;
  const sceneLine = worldLock
    ? [
        `场景：${worldLock.sceneName || storyboard.storyboard.scene || '当前场景'}`,
        (worldLock.anchors ?? []).length ? `锚点=${worldLock.anchors.slice(0, 4).join(' / ')}` : '',
        worldLock.actionZone ? `行动区=${clipDirectorText(worldLock.actionZone, 100)}` : '',
      ].filter(Boolean).join('；')
    : '';
  const blockingLine = blocking
    ? [
        blocking.previousEnd ? `上一镜落点=${clipDirectorText(blocking.previousEnd, 100)}` : '',
        blocking.currentStart ? `本镜起点=${clipDirectorText(blocking.currentStart, 110)}` : '',
        blocking.currentEnd ? `本镜落点=${clipDirectorText(blocking.currentEnd, 120)}` : '',
      ].filter(Boolean).join('；')
    : '';

  return [
    '空间连续：',
    sceneLine,
    blockingLine,
    buildStoryboardDirectorScreenDirection(storyboard),
  ].filter(Boolean).join('\n');
}

function extractQuotedDialogueSnippets(text: string): string[] {
  const snippets: string[] = [];
  const patterns = [
    /“([^”\n]{1,120})”/g,
    /"([^"\n]{1,120})"/g,
    /「([^」\n]{1,120})」/g,
    /『([^』\n]{1,120})』/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const value = match[1]?.trim();
      if (value && !snippets.includes(value)) snippets.push(value);
      if (snippets.length >= 5) return snippets;
    }
  }

  return snippets;
}

function buildStoryboardDirectorDialogue(scriptText: string): string {
  const dialogueEntries = extractDialogueEntriesFromText(scriptText);
  const dialogueTexts = uniqueCompactValues([
    ...dialogueEntries.map((entry) => entry.text),
    ...extractQuotedDialogueSnippets(scriptText),
  ], 3);
  const dialogueLines = dialogueTexts.map((text) => `对白原文：“${text}”`);

  if (dialogueLines.length === 0) {
    return '对白：无明确对白时，用眼神、呼吸、停顿、身体重心和对手反应推动表演，台词也要像真人临场说话，不生成字幕。';
  }

  return ['对白（只作口型和表演，不生成字幕，台词必须口语化、像真人说话）：', ...dialogueLines].join('\n');
}

function stripAppendedStoryboardBoardReferenceInstruction(prompt: string): string {
  return prompt
    .replace(/(?:\r?\n){2,}补充镜头编排参考：[\s\S]*$/u, '')
    .trimEnd();
}

function isLikelyTimelineSection(segment: string): boolean {
  const hasTimecode = /\d+(?:\.\d+)?[–-]\d+(?:\.\d+)?秒/.test(segment) || /\d+\.\d+–\d+\.\d+秒/.test(segment);
  const hasShotStructure = /[｜|].*(?:音效|对白|BGM|Camera|Audio|Transition|表演|落幅|推近|切|推|扫)/.test(segment);
  const hasShotOrder = /(?:^\s*\d+\.|\n\s*\d+\.)/.test(segment);
  return hasTimecode || hasShotStructure || hasShotOrder;
}

function buildTimelineBrief(sourcePrompt: string): string {
  const normalized = sourcePrompt.trim();
  if (!normalized) return '';

  const segments = normalized
    .split('***')
    .map((segment) => segment.trim())
    .filter(Boolean);

  const rankedSegments = segments
    .map((segment, index) => {
      let score = 0;
      if (isLikelyTimelineSection(segment)) score += 6;
      if (/\d+(?:\.\d+)?[–-]\d+(?:\.\d+)?秒/.test(segment)) score += 3;
      if (/对白|音效|BGM|Camera|Audio|Transition|表演/.test(segment)) score += 2;
      if (/参考图片1是唯一场景空间母版|身份硬锁|道具外观硬锁|调色光影|禁止显示字幕/.test(segment)) score -= 3;
      if (/场景空间母版|角色|道具|调色|禁止/.test(segment) && !isLikelyTimelineSection(segment)) score -= 1;
      return { segment, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = rankedSegments[0]?.score && rankedSegments[0].score > 0
    ? rankedSegments[0].segment
    : normalized;

  return clipDirectorText(selected, 1200);
}

export function buildStoryboardDirectorVideoPrompt(
  storyboard: StoryboardState,
  _sourcePrompt: string,
  options?: BuildFinalVideoSubmitPromptOptions,
): string {
  const frameLabel = getFrameDisplayLabel(options?.videoRatio);
  const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const variant = getStoryboardBoardVariant(storyboard.storyboardBoard, selectedMode);
  const plan = variant?.plan;
  const directorBrief = plan?.directorBrief;
  const choreography = storyboard.choreography;
  const scriptText = buildStoryboardDirectorScriptBrief(storyboard);
  const storyFunction = plan?.boardGoal || choreography?.sceneType || '当前 15 秒只完成一个清晰动作/情绪推进';
  const visualNotes = [
    directorBrief?.styleStatement ? `导演阐述：${directorBrief.styleStatement}` : '',
    directorBrief?.hookStrategy ? `钩子策略：${directorBrief.hookStrategy}` : '',
    storyboard.sceneBlueprint?.emotionArc ? `情绪弧：${storyboard.sceneBlueprint.emotionArc}` : '',
    choreography?.overallRhythm ? `节奏：${choreography.overallRhythm}` : '',
    choreography?.cameraOverview ? `运镜：${choreography.cameraOverview}` : '',
    choreography?.lightNotes ? `光线：${choreography.lightNotes}` : '',
    choreography?.colorGrading ? `色彩：${choreography.colorGrading}` : '',
  ].filter(Boolean).join('；');
  const submitDurationLabel = getStoryboardSubmitDurationLabel(storyboard);

  return [
    '故事板导演提交版：只生成当前分镜的连续视频，不生成整集，不重讲角色设定。',
    buildStoryboardDirectorReferenceRoles(options?.effectiveItems, frameLabel),
    [
      `当前分镜任务：分镜${String(storyboard.storyboard.number).padStart(2, '0')}｜${storyboard.storyboard.name}｜${submitDurationLabel}｜${frameLabel}｜${storyboard.storyboard.shotSize}`,
      `故事功能：${clipDirectorText(storyFunction, 160)}`,
      `剧情摘录：${scriptText}`,
    ].join('\n'),
    buildStoryboardDirectorContinuityBrief(storyboard),
    `连续镜头指令 Shot cue sequence：\n${buildStoryboardDirectorShotCueSequence(storyboard)}`,
    buildStoryboardDirectorDialogue(scriptText),
    [
      `镜头与风格：${plan?.cameraPlan ? [plan.cameraPlan.cameraId, plan.cameraPlan.lensPlan, plan.cameraPlan.lightPlan].filter(Boolean).join('；') : '按故事板镜头节奏执行'}`,
      directorBrief?.cameraStrategy ? `前置镜头策略：${directorBrief.cameraStrategy}` : '',
      directorBrief?.soundStrategy ? `前置声音策略：${directorBrief.soundStrategy}` : '',
      visualNotes || '动作、眼神、身体重心、衣料/雨水/尘埃/火花等环境反馈要跟随动作变化。',
    ].filter(Boolean).join('\n'),
    [
      '禁止项：不要生成故事板页、漫画页、制作板或参考拼贴。',
      '不要保留边框、编号、箭头、标签、信息条、字幕、Logo、水印或任何画面内文字。',
      '不要重设计 Step3 角色、服装、场景、道具；不要新增无关角色；不要把背景人影变主角。',
      STRICT_NO_SUBTITLE_PROMPT,
    ].join('\n'),
  ].filter(Boolean).join('\n\n');
}

function buildNormalStructuredVideoPrompt(
  storyboard: StoryboardState,
  sourcePrompt: string,
  options?: BuildFinalVideoSubmitPromptOptions,
): string {
  const frameLabel = getFrameDisplayLabel(options?.videoRatio);
  const storyboardBoardItem = options?.effectiveItems?.find((item) => item.type === 'storyboard-board');
  const scenePositionItem = options?.effectiveItems?.find((item) => item.type === 'scene-position-board');
  const sourceTimeline = storyboardBoardItem
    ? stripAppendedStoryboardBoardReferenceInstruction(sourcePrompt)
    : sourcePrompt;
  const timelineSource = options?.videoRatio ? syncVideoPromptFrameRatio(sourceTimeline, options.videoRatio) : sourceTimeline;
  const timeline = buildTimelineBrief(timelineSource);
  const submitDurationLabel = getStoryboardSubmitDurationLabel(storyboard);
  const continuityIn = storyboard.continuityInput?.lastFrameInfo
    || storyboard.continuityInput?.summary
    || storyboard.storyboard.scene
    || 'Start from the current storyboard setup.';
  const continuityOut = storyboard.lastFrameInfo
    || storyboard.continuityOutput?.lastFrameInfo
    || storyboard.spatialBlocking?.continuityNotes
    || 'End with a readable final state for the next storyboard.';

  return [
    `${getVideoPromptFrameLabel(options?.videoRatio)}，Video Submit Prompt`,
    buildStoryboardDirectorReferenceRoles(options?.effectiveItems, frameLabel, 'compact', false),
    [
      'Scene Goal',
      `Storyboard ${String(storyboard.storyboard.number).padStart(2, '0')} · ${storyboard.storyboard.name}`,
      `Duration/Frame: ${submitDurationLabel} · ${frameLabel} · ${storyboard.storyboard.shotSize}`,
      scenePositionItem
        ? `Scene positioning board: ${scenePositionItem.refId} only locks spatial positions; do not preserve colored dots, arrows, or planning marks.`
        : '',
    ].filter(Boolean).join('\n'),
    [
      'Continuity In/Out',
      `Continuity In: ${clipDirectorText(continuityIn, 160)}`,
      `Continuity Out: ${clipDirectorText(continuityOut, 160)}`,
    ].join('\n'),
    [
      'Timeline',
      timeline || `${storyboard.storyboard.name}: generate the current storyboard as one continuous video beat.`,
    ].join('\n'),
    [
      'Negative Rules',
      'No subtitles, visible text, watermarks, board/grid marks, arrows, or reference-collage artifacts; keep Step3 identities, scenes, and props unchanged.',
    ].join('\n'),
  ].filter(Boolean).join('\n\n');
}

function buildSeedanceFinalSubmitReferenceHeader(
  effectiveItems: readonly EffectiveVideoReferenceItem[] | undefined,
  frameLabel: string,
): string {
  return buildStoryboardDirectorReferenceRoles(effectiveItems, frameLabel, 'compact', false);
}

function buildSeedanceFinalPromptUnavailableNotice(videoRatio?: string) {
  const frameLabel = getVideoPromptFrameLabel(videoRatio);
  return [
    `${frameLabel}，Video Submit Prompt`,
    'Seedance 最终视频提示词尚未生成。',
    '请返回 Step4 生成 Seedance 提交词后再提交。',
  ].join('\n\n');
}

function buildSeedanceDirectorVideoSubmitPrompt(
  storyboard: StoryboardState,
  options?: BuildFinalVideoSubmitPromptOptions,
): string {
  const frameLabel = getFrameDisplayLabel(options?.videoRatio);
  const selectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const step4Prompt = storyboard.seedanceFinalVideoPrompt?.trim() || storyboard.prompt?.rawText?.trim() || '';
  const body = step4Prompt
    ? step4Prompt
    : buildSeedanceFinalPromptUnavailableNotice(options?.videoRatio);

  if (isShotPlanBoardMode(selectedMode) && step4Prompt) {
    return body;
  }

  return [
    buildSeedanceFinalSubmitReferenceHeader(options?.effectiveItems, frameLabel),
    body,
  ].filter(Boolean).join('\n\n');
}

export function buildFinalVideoSubmitPrompt(
  storyboard: StoryboardState,
  sourcePrompt: string,
  imageRefs: readonly ImageReference[] = storyboard.imageRefs,
  options?: BuildFinalVideoSubmitPromptOptions,
): string {
  const compactState = options?.ignoreCompactPrompt
    ? {
        enabled: false,
        status: 'idle' as const,
        mode: undefined,
        optimizedPrompt: '',
        error: undefined,
        sourcePromptSnapshot: '',
        updatedAt: undefined,
        isFresh: false,
        isUsable: false,
      }
    : getCompactVideoPromptState(storyboard, sourcePrompt);
  const directorMode = isStoryboardDirectorMode(storyboard);
  const directorSelectedMode = getStoryboardBoardSelectedMode(storyboard.storyboardBoard);
  const isShotPlanDirectorMode = directorMode && isShotPlanBoardMode(directorSelectedMode);
  const prompt = compactState.isUsable
    ? compactState.optimizedPrompt
    : isStoryboardDirectorMode(storyboard)
    ? buildSeedanceDirectorVideoSubmitPrompt(storyboard, options)
    : buildNormalStructuredVideoPrompt(
        storyboard,
        sourcePrompt,
        options,
      );
  const effectiveItems = options?.effectiveItems;
  const scenePositionInstruction = buildScenePositionBoardInstruction(effectiveItems, options?.videoRatio);
  const withScenePositionInstruction = (value: string) =>
    !directorMode && scenePositionInstruction ? `${value}\n\n${scenePositionInstruction}` : value;
  const withReferenceHardLocks = (value: string) =>
    directorMode ? value : enforceReferenceHardLocks(value, effectiveItems);
  const finalizePrompt = (value: string) => {
    const normalized = normalizeNoSubtitleWording(value);
    if (isShotPlanDirectorMode) return normalized;
    return options?.videoRatio ? syncVideoPromptFrameRatio(normalized, options.videoRatio) : normalized;
  };
  if (hasOfficialVirtualHumanReference(effectiveItems) && effectiveItems) {
    const submitRefs = buildSubmitImageReferences(effectiveItems);
    const submitPrompt = sanitizeMisboundImageReferenceLabels(
      remapOfficialVirtualHumanSubmitPrompt(prompt, effectiveItems, options?.omittedItems),
      submitRefs,
    );
    const submitWithLocks = withReferenceHardLocks(submitPrompt);
    const submitWithPosition = withScenePositionInstruction(submitWithLocks);
    return finalizePrompt(submitWithPosition);
  }
  const submitRefs = effectiveItems ? buildSubmitImageReferences(effectiveItems) : imageRefs;
  const submitPrompt = sanitizeMisboundImageReferenceLabels(prompt, submitRefs);
  const submitWithLocks = withReferenceHardLocks(submitPrompt);
  const submitWithPosition = withScenePositionInstruction(submitWithLocks);
  return finalizePrompt(submitWithPosition);
}

export function buildCompactVideoPromptDisabledReason(
  compactState: CompactVideoPromptState,
): string | null {
  if (!compactState.enabled) return null;
  if (compactState.status === 'optimizing') return '脱敏提示词正在生成中，请稍候。';
  if (compactState.status === 'failed' && compactState.error) return `脱敏失败：${compactState.error}`;
  if (!compactState.isFresh) return '当前已启用脱敏提交，但还没有生成与当前参考图和提示词匹配的脱敏版本。';
  return null;
}

export function getPromptLengthStats(
  originalPrompt: string,
  optimizedPrompt?: string,
): { originalChars: number; optimizedChars: number; savedChars: number; savedRatio: number } {
  const originalChars = originalPrompt.length;
  const optimizedChars = optimizedPrompt?.length ?? 0;
  const savedChars = Math.max(0, originalChars - optimizedChars);
  const savedRatio = originalChars > 0 ? savedChars / originalChars : 0;

  return { originalChars, optimizedChars, savedChars, savedRatio };
}

export interface VideoSubmitPromptOverrideState {
  hasOverride: boolean;
  isFresh: boolean;
  isUsable: boolean;
  prompt: string;
  sourcePrompt: string;
  updatedAt?: number;
}

export interface Step5Step4PromptLengthValidation {
  ok: boolean;
  reason?: string;
  step4Chars: number;
  step5Chars: number;
}

export function getVideoSubmitPromptOverrideState(
  storyboard: StoryboardState,
  autoSubmitPrompt: string,
): VideoSubmitPromptOverrideState {
  const sourcePrompt = storyboard.videoSubmitPromptOverrideSourcePrompt ?? '';
  const prompt = storyboard.videoSubmitPromptOverride ?? '';
  const hasOverride = typeof storyboard.videoSubmitPromptOverride === 'string'
    && sourcePrompt.length > 0
    && sourcePrompt === autoSubmitPrompt;
  const isFresh = hasOverride;

  return {
    hasOverride,
    isFresh,
    isUsable: isFresh,
    prompt: isFresh ? prompt : '',
    sourcePrompt,
    updatedAt: storyboard.videoSubmitPromptOverrideUpdatedAt,
  };
}

export function getStep4VideoPromptForLengthCheck(storyboard: StoryboardState): string {
  if (!isStoryboardDirectorMode(storyboard)) return '';
  return storyboard.seedanceFinalVideoPrompt?.trim() || storyboard.prompt?.rawText?.trim() || '';
}

export function validateStep5VideoPromptMatchesStep4Length(
  storyboard: StoryboardState,
  step5Prompt: string,
  options?: { manualOverride?: boolean },
): Step5Step4PromptLengthValidation {
  const step4Prompt = getStep4VideoPromptForLengthCheck(storyboard);
  const step4Chars = step4Prompt.length;
  const step5Chars = step5Prompt.length;

  if (!isStoryboardDirectorMode(storyboard) || options?.manualOverride || !step4Prompt) {
    return { ok: true, step4Chars, step5Chars };
  }

  if (step4Chars !== step5Chars) {
    return {
      ok: false,
      step4Chars,
      step5Chars,
      reason: `Step5 视频提示词字数与 Step4 不一致：Step4 ${step4Chars} 字，Step5 ${step5Chars} 字。请展开视频提示词人工确认并编辑，编辑后将按人工版提交。`,
    };
  }

  return { ok: true, step4Chars, step5Chars };
}
