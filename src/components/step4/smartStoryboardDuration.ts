import type { StoryboardBoardDirectorBrief, StoryboardBoardMode, StoryboardState } from '@/types';
import {
  MAX_VIDEO_SUBMIT_DURATION_SEC,
  MIN_VIDEO_SUBMIT_DURATION_SEC,
  normalizeWholeSecondVideoDuration,
  parseStoryboardDurationSeconds,
} from '@/lib/storyboardDuration';
import type { ManualSmartStoryboardPanelCount } from '@/lib/smartStoryboardPanelCount';
import { isSmartShotPlanBoardMode } from './storyboardBoardMode';

export interface SmartStoryboardDurationDecision {
  durationSeconds?: number;
  originalSeconds?: number;
  panelCount?: 6 | 9 | 12 | 15;
  reason?: string;
  changed: boolean;
}

interface SmartStoryboardDurationOptions {
  durationCompressionEnabled?: boolean;
}

function hasDurationValue(value: unknown): value is number | string {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && Number.isFinite(Number(trimmed));
}

function normalizeSmartPanelCount(value: unknown): 6 | 9 | 12 | 15 | undefined {
  const numericValue = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (numericValue === 6 || numericValue === 9 || numericValue === 12 || numericValue === 15) return numericValue;
  return undefined;
}

function getFallbackPanelCountForDuration(seconds: number | undefined) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return undefined;
  if (seconds <= 6) return 6;
  if (seconds <= 9) return 9;
  if (seconds <= 12) return 12;
  return 15;
}

function hasExplicitBeatEvidence(reason: string | undefined, minimumBeatCount: number) {
  const text = reason?.toLowerCase() ?? '';
  if (!text) return false;
  const numericMatches = Array.from(text.matchAll(/(\d+)\s*(?:个|条|组)?\s*(?:可见|视觉|导演|独立)?\s*(?:beat|节拍|锚点|动作点|视觉点)/gi));
  if (numericMatches.some((match) => Number(match[1]) >= minimumBeatCount)) return true;
  if (minimumBeatCount <= 7 && /(七|7)\s*(?:个|条|组)?\s*(?:可见|视觉|导演|独立)?\s*(?:beat|节拍|锚点|动作点|视觉点)/i.test(text)) return true;
  if (minimumBeatCount <= 13 && /(十三|13)\s*(?:个|条|组)?\s*(?:可见|视觉|导演|独立)?\s*(?:beat|节拍|锚点|动作点|视觉点)/i.test(text)) return true;
  return false;
}

export function resolveSmartStoryboardDurationDecision(
  mode: StoryboardBoardMode,
  storyboard: StoryboardState,
  directorBrief?: StoryboardBoardDirectorBrief,
  lockedPanelCount?: ManualSmartStoryboardPanelCount,
  options?: SmartStoryboardDurationOptions,
): SmartStoryboardDurationDecision {
  if (!isSmartShotPlanBoardMode(mode) || !directorBrief) {
    return { changed: false };
  }

  const durationCompressionEnabled = options?.durationCompressionEnabled !== false;
  const originalRaw = parseStoryboardDurationSeconds(storyboard.storyboard.duration);
  const originalSeconds = typeof originalRaw === 'number' && Number.isFinite(originalRaw)
    ? normalizeWholeSecondVideoDuration(originalRaw, originalRaw)
    : undefined;
  const originalDurationSeconds = normalizeWholeSecondVideoDuration(
    originalSeconds,
    15,
    MIN_VIDEO_SUBMIT_DURATION_SEC,
    MAX_VIDEO_SUBMIT_DURATION_SEC,
  );
  const modelDurationSeconds = hasDurationValue(directorBrief.recommendedDurationSeconds)
    ? normalizeWholeSecondVideoDuration(
      directorBrief.recommendedDurationSeconds,
      originalSeconds ?? 15,
      MIN_VIDEO_SUBMIT_DURATION_SEC,
      MAX_VIDEO_SUBMIT_DURATION_SEC,
    )
    : undefined;
  const durationSeconds = durationCompressionEnabled
    ? modelDurationSeconds ?? originalDurationSeconds
    : originalDurationSeconds;
  const changed = durationCompressionEnabled
    && typeof originalSeconds === 'number'
    && originalSeconds !== durationSeconds;
  const baseReason = directorBrief.panelCountReason?.trim()
    || '智能导演根据剧情节奏、动作密度、对白密度和连续性风险给出时长。';
  const panelCount = lockedPanelCount
    ?? normalizeSmartPanelCount(directorBrief.recommendedPanelCount)
    ?? getFallbackPanelCountForDuration(modelDurationSeconds ?? durationSeconds);
  const reasonPrefix = lockedPanelCount
    ? `智能模式手动锁定 ${lockedPanelCount}格；`
    : '';

  if (!durationCompressionEnabled) {
    return {
      durationSeconds,
      originalSeconds,
      panelCount,
      changed: false,
      reason: `${reasonPrefix}智能时长压缩已关闭，沿用原分镜 ${durationSeconds}秒；仅使用智能格数与节奏密度。${baseReason}`,
    };
  }

  return {
    durationSeconds,
    originalSeconds,
    panelCount,
    changed,
    reason: changed && originalSeconds
      ? `${reasonPrefix}智能模式建议 ${originalSeconds}秒 → ${durationSeconds}秒：${baseReason}`
      : `${reasonPrefix}智能模式确认 ${durationSeconds}秒：${baseReason}`,
  };
}

export function buildSmartStoryboardDurationRejudgeHint(
  mode: StoryboardBoardMode,
  storyboard: StoryboardState,
  directorBrief?: StoryboardBoardDirectorBrief,
  lockedPanelCount?: ManualSmartStoryboardPanelCount,
  options?: SmartStoryboardDurationOptions,
): string | undefined {
  if (!isSmartShotPlanBoardMode(mode) || !directorBrief) return undefined;

  const durationCompressionEnabled = options?.durationCompressionEnabled !== false;
  const originalRaw = parseStoryboardDurationSeconds(storyboard.storyboard.duration);
  const originalSeconds = typeof originalRaw === 'number' && Number.isFinite(originalRaw)
    ? normalizeWholeSecondVideoDuration(originalRaw, originalRaw)
    : undefined;
  const modelDurationSeconds = hasDurationValue(directorBrief.recommendedDurationSeconds)
    ? normalizeWholeSecondVideoDuration(
      directorBrief.recommendedDurationSeconds,
      originalSeconds ?? 15,
      MIN_VIDEO_SUBMIT_DURATION_SEC,
      MAX_VIDEO_SUBMIT_DURATION_SEC,
    )
    : undefined;
  const panelCount = normalizeSmartPanelCount(directorBrief.recommendedPanelCount);
  const originalPanelCount = getFallbackPanelCountForDuration(originalSeconds);

  if (!durationCompressionEnabled) {
    if (lockedPanelCount && panelCount && panelCount !== lockedPanelCount) {
      return `智能故事板已由用户手动锁定为 ${lockedPanelCount} 格，且时长压缩已关闭。请只修正 recommendedPanelCount 为 ${lockedPanelCount}，不要重新压缩 recommendedDurationSeconds。`;
    }
    if (!lockedPanelCount && !panelCount) {
      return '智能故事板时长压缩已关闭。请只补 recommendedPanelCount（只能是 6/9/12/15）和 panelCountReason，recommendedDurationSeconds 保持原分镜时长，不要重新压缩。';
    }
    return undefined;
  }

  if (lockedPanelCount) {
    if (!modelDurationSeconds) {
      return `智能故事板已由用户手动锁定为 ${lockedPanelCount} 格。请只重新判断当前分镜真正适合的 recommendedDurationSeconds（4-15 的整数秒），recommendedPanelCount 必须保持 ${lockedPanelCount}，panelCountReason 说明固定 ${lockedPanelCount} 格如何承载主要 beat。`;
    }
    if (panelCount && panelCount !== lockedPanelCount) {
      return `智能故事板已由用户手动锁定为 ${lockedPanelCount} 格。请修正 recommendedPanelCount 为 ${lockedPanelCount}，不要改选 6/9/12/15；recommendedDurationSeconds 仍按剧情独立判断。`;
    }
    return undefined;
  }

  if (!modelDurationSeconds || !panelCount) {
    return '智能故事板导演阐述缺少 recommendedDurationSeconds 或 recommendedPanelCount。请重新判断当前分镜的真实可拍时长：recommendedDurationSeconds 必须是 4-15 的任意整数；recommendedPanelCount 只能是 6/9/12/15，二者不能默认照抄原时长。';
  }

  if (
    typeof originalSeconds === 'number'
    && originalSeconds >= 7
    && modelDurationSeconds === originalSeconds
    && panelCount === originalPanelCount
  ) {
    return `上一次智能结果与原始时长和默认格数完全相同（${originalSeconds}秒 / ${panelCount}格），看起来可能只是继承旧设置。请重新阅读当前单个分镜剧情，独立判断它真正适合的成片时长和故事板密度。recommendedDurationSeconds 可以是 4-15 的任意整数，不必绑定 6/9/12/15；例如 15秒原镜也可以压缩为12/13/14秒。recommendedPanelCount 必须按“可见导演 beat 数”选择：3-6 个 beat 选 6 格，7-9 个 beat 选 9 格，10-12 个 beat 选 12 格，13 个以上或高风险连续性选 15 格。只有当剧情确实无法压缩时才保持 ${originalSeconds}秒，并在 panelCountReason 中明确写“保持”、可见 beat 数、不可压缩的具体剧情依据；否则请写“压缩”或“延长”和理由。`;
  }

  if (
    typeof originalSeconds === 'number'
    && originalSeconds >= 7
    && originalSeconds <= 9
    && modelDurationSeconds <= 7
    && panelCount === 9
    && !hasExplicitBeatEvidence(directorBrief.panelCountReason, 7)
  ) {
    return `你已经把当前分镜从原始 ${originalSeconds}秒 压缩到 ${modelDurationSeconds}秒，但 recommendedPanelCount 仍是 9 格。请重新按“可见导演 beat 数”判断宫格，而不是按秒数分档：如果当前镜只有 3-6 个关键视觉 beat，应改为 6 格；只有能明确列出 7 个以上独立视觉 beat 时，才保留 9 格。panelCountReason 必须写清可见 beat 数，以及为什么选择 6 或 9 格。`;
  }

  if (
    typeof originalSeconds === 'number'
    && originalSeconds >= 13
    && modelDurationSeconds < 13
    && panelCount === 15
    && !hasExplicitBeatEvidence(directorBrief.panelCountReason, 13)
  ) {
    return `你已经把当前分镜从原始 ${originalSeconds}秒 压缩到 ${modelDurationSeconds}秒，但 recommendedPanelCount 仍是 15 格。请重新按“可见导演 beat 数”和连续性风险判断宫格：如果只有 10-12 个关键视觉 beat，应改为 12 格；只有 13 个以上独立 beat，或门/入口/越线/UI/多人调度等高风险连续性确实需要逐拍锁定时，才保留 15 格。panelCountReason 必须写清可见 beat 数和保留 15 格的具体风险依据。`;
  }

  return undefined;
}

export function buildSmartStoryboardDurationUpdates(
  decision: SmartStoryboardDurationDecision,
  updatedAt = Date.now(),
): Partial<StoryboardState> {
  if (typeof decision.durationSeconds !== 'number') {
    return {
      smartVideoDurationSeconds: undefined,
      smartVideoDurationReason: undefined,
      smartVideoDurationUpdatedAt: undefined,
    };
  }
  return {
    smartVideoDurationSeconds: decision.durationSeconds,
    smartVideoDurationReason: decision.reason,
    smartVideoDurationUpdatedAt: updatedAt,
  };
}

export function applySmartDurationToStoryboardForPrompt(
  storyboard: StoryboardState,
  decision: SmartStoryboardDurationDecision,
): StoryboardState {
  if (typeof decision.durationSeconds !== 'number') return storyboard;
  return {
    ...storyboard,
    smartVideoDurationSeconds: decision.durationSeconds,
    smartVideoDurationReason: decision.reason,
    storyboard: {
      ...storyboard.storyboard,
      duration: `${decision.durationSeconds}秒`,
    },
  };
}

export function applySmartDurationToDirectorBrief(
  directorBrief: StoryboardBoardDirectorBrief,
  decision: SmartStoryboardDurationDecision,
): StoryboardBoardDirectorBrief {
  if (typeof decision.durationSeconds !== 'number') return directorBrief;
  return {
    ...directorBrief,
    recommendedDurationSeconds: decision.durationSeconds,
    recommendedPanelCount: decision.panelCount ?? directorBrief.recommendedPanelCount,
    panelCountReason: decision.reason ?? directorBrief.panelCountReason,
  };
}
