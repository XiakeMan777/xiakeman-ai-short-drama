import type { StoryboardState } from '@/types';

export type VideoContinuityDecisionMode = 'normal' | 'extend';

export interface VideoContinuityDecision {
  index: number;
  mode: VideoContinuityDecisionMode;
  groupId: string;
  groupHeadIndex: number;
  sourceIndex?: number;
  reason: string;
  blockingReason?: string;
  sharedCharacters: string[];
}

const BREAK_KEYWORDS = [
  '转场',
  '闪回',
  '回忆',
  '梦境',
  '幻想',
  '幻觉',
  '系统空间',
  '黑场',
  '白场',
  '切至',
  '切到',
  '与此同时',
  '另一边',
  '次日',
  '翌日',
  '几日后',
  '数日后',
  '三日后',
  '多年后',
  '小时后',
  '片刻后',
  '时间跳跃',
  '时空',
  '新场景',
];

function normalizeText(value?: string | null) {
  return (value ?? '')
    .replace(/[【】[\]（）()《》<>「」"'\s]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeScene(value?: string | null) {
  return normalizeText(value)
    .replace(/^(场景|地点|内景|外景)[:：]/, '')
    .replace(/[，,。.!！?？;；:：、]/g, '');
}

function normalizeCharacter(value?: string | null) {
  return normalizeText(value)
    .replace(/参考图片\d+/g, '')
    .replace(/图片\d+/g, '')
    .replace(/图\d+/g, '');
}

function getScene(storyboard?: StoryboardState) {
  return normalizeScene(storyboard?.storyboard?.scene);
}

function getCharacters(storyboard?: StoryboardState) {
  const names = storyboard?.storyboard?.characters ?? [];
  return names
    .map((name) => ({ raw: name, key: normalizeCharacter(name) }))
    .filter((item) => item.key.length > 0);
}

function getSharedCharacters(previous: StoryboardState, current: StoryboardState) {
  const prev = getCharacters(previous);
  const currentKeys = new Set(getCharacters(current).map((item) => item.key));
  return prev
    .filter((item) => currentKeys.has(item.key))
    .map((item) => item.raw);
}

function hasBreakKeyword(storyboard: StoryboardState) {
  const haystack = [
    storyboard.storyboard?.name,
    storyboard.storyboard?.scene,
    storyboard.correctedScript,
    storyboard.sourceExcerpt,
    storyboard.prompt?.rawText,
    storyboard.choreography?.transitionType,
  ].filter(Boolean).join('\n');

  return BREAK_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function buildGroupId(storyboards: readonly StoryboardState[], headIndex: number) {
  const head = storyboards[headIndex];
  const scene = normalizeScene(head?.storyboard?.scene) || `scene-${headIndex + 1}`;
  return `scene-${headIndex + 1}-${scene}`;
}

function previousVideoIsReady(previous: StoryboardState) {
  return previous.videoStatus === 'done' && (!!previous.videoBlobKey || !!previous.videoUrl);
}

export function buildVideoContinuityPlan(
  storyboards: readonly StoryboardState[],
): VideoContinuityDecision[] {
  const decisions: VideoContinuityDecision[] = [];
  let groupHeadIndex = 0;

  storyboards.forEach((storyboard, index) => {
    if (index === 0) {
      decisions.push({
        index,
        mode: 'normal',
        groupId: buildGroupId(storyboards, 0),
        groupHeadIndex: 0,
        reason: '本集首个镜头，正常生成作为连续镜组起点。',
        sharedCharacters: [],
      });
      return;
    }

    const previous = storyboards[index - 1];
    const currentScene = getScene(storyboard);
    const previousScene = getScene(previous);
    const sharedCharacters = getSharedCharacters(previous, storyboard);

    if (!currentScene || !previousScene || currentScene !== previousScene) {
      groupHeadIndex = index;
      decisions.push({
        index,
        mode: 'normal',
        groupId: buildGroupId(storyboards, groupHeadIndex),
        groupHeadIndex,
        reason: '场景发生变化，正常生成新场景首镜。',
        sharedCharacters,
      });
      return;
    }

    if (hasBreakKeyword(storyboard)) {
      groupHeadIndex = index;
      decisions.push({
        index,
        mode: 'normal',
        groupId: buildGroupId(storyboards, groupHeadIndex),
        groupHeadIndex,
        reason: '检测到转场、闪回或时间跳跃，正常生成新连续段。',
        sharedCharacters,
      });
      return;
    }

    if (sharedCharacters.length === 0) {
      groupHeadIndex = index;
      decisions.push({
        index,
        mode: 'normal',
        groupId: buildGroupId(storyboards, groupHeadIndex),
        groupHeadIndex,
        reason: '同场景但没有共享核心角色，正常生成避免错误延续。',
        sharedCharacters,
      });
      return;
    }

    decisions.push({
      index,
      mode: 'extend',
      groupId: buildGroupId(storyboards, groupHeadIndex),
      groupHeadIndex,
      sourceIndex: index - 1,
      reason: `同场景连续镜头，共享角色：${sharedCharacters.join('、')}，优先使用上一镜视频参考保持连续。`,
      blockingReason: previousVideoIsReady(previous)
        ? undefined
        : `需要先完成分镜 ${index} 的视频，才能从上一镜延长。`,
      sharedCharacters,
    });
  });

  return decisions;
}

export function getStoryboardVideoContinuityDecision(
  storyboards: readonly StoryboardState[],
  index: number,
): VideoContinuityDecision {
  return buildVideoContinuityPlan(storyboards)[index] ?? {
    index,
    mode: 'normal',
    groupId: `scene-${index + 1}`,
    groupHeadIndex: index,
    reason: '未找到对应分镜，按普通生成处理。',
    sharedCharacters: [],
  };
}
