import type { StoryboardCameraSegmentPreference, StoryboardInfo, StoryboardState } from '@/types';

export const DEFAULT_STORYBOARD_CAMERA_SEGMENT_COUNT = 2;
export const DEFAULT_STORYBOARD_CAMERA_SEGMENT_PREFERENCE: StoryboardCameraSegmentPreference = 'auto';
export const MIN_STORYBOARD_CAMERA_SEGMENT_COUNT = 1;
export const MAX_STORYBOARD_CAMERA_SEGMENT_COUNT = 5;

export function normalizeStoryboardCameraSegmentPreference(value: unknown): StoryboardCameraSegmentPreference {
  if (value === 'auto') return 'auto';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_STORYBOARD_CAMERA_SEGMENT_PREFERENCE;
  return Math.min(
    MAX_STORYBOARD_CAMERA_SEGMENT_COUNT,
    Math.max(MIN_STORYBOARD_CAMERA_SEGMENT_COUNT, Math.round(numeric)),
  ) as StoryboardCameraSegmentPreference;
}

export function normalizeStoryboardCameraSegmentCount(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_STORYBOARD_CAMERA_SEGMENT_COUNT;
  return Math.min(
    MAX_STORYBOARD_CAMERA_SEGMENT_COUNT,
    Math.max(MIN_STORYBOARD_CAMERA_SEGMENT_COUNT, Math.round(numeric)),
  );
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (text.match(pattern)?.length ?? 0), 0);
}

function buildCameraSegmentSignalText(
  storyboard?: Partial<StoryboardState> | StoryboardInfo,
  extraText?: string,
): string {
  const state = storyboard as Partial<StoryboardState> | undefined;
  const info = (state?.storyboard ?? storyboard) as StoryboardInfo | undefined;
  return [
    info?.name,
    info?.duration,
    info?.shotSize,
    info?.scene,
    Array.isArray(info?.characters) ? info?.characters.join(' ') : '',
    state?.correctedScript,
    state?.sourceExcerpt,
    state?.sourceExcerptSummary,
    state?.nextStoryboardSummary,
    state?.prompt?.rawText,
    state?.lastFrameInfo,
    state?.continuityInput?.lastFrameInfo,
    state?.continuityOutput?.lastFrameInfo,
    extraText,
  ].filter(Boolean).join('\n').toLowerCase();
}

export function inferStoryboardCameraSegmentCount(
  storyboard?: Partial<StoryboardState> | StoryboardInfo,
  extraText?: string,
): number {
  const text = buildCameraSegmentSignalText(storyboard, extraText);
  if (!text.trim()) return DEFAULT_STORYBOARD_CAMERA_SEGMENT_COUNT;

  let score = 0;
  const actionScore = countMatches(text, [
    /打斗|交锋|对打|追逐|奔跑|逃跑|冲刺|闪避|扑来|撞击|爆炸|坠落|摔|砍|刺|枪|尸群|怪物|感染者/g,
    /\bfight\b|\bchase\b|\brun\b|\battack\b|\bimpact\b|\bexplosion\b|\bmonster\b/gi,
  ]);
  const dialogueScore = countMatches(text, [
    /对话|对白|台词|传令|质问|心声|低声|沉默|凝视|犹豫|呼吸|停住|僵住/g,
    /\bdialogue\b|\bvoice\b|\bwhisper\b|\bbreath\b|\bsilence\b/gi,
  ]);
  const cutRiskScore = countMatches(text, [
    /闪切|快剪|蒙太奇|硬切|插入|特写|主观|幻象|回忆|倒计时|界面|phone pov|pov|insert|montage|flash cut|hard cut/gi,
  ]);
  const oneTakeScore = countMatches(text, [
    /单镜头|长镜头|连续跟拍|连续手持|同一镜位|同机位|不切|one[- ]take|continuous|tracking shot/gi,
  ]);
  const bridgeScore = countMatches(text, [
    /start frame|end beat|桥接|承接|交接|上一镜|下一镜|final hold/gi,
  ]);

  score += Math.min(3, actionScore);
  score += Math.min(2, cutRiskScore);
  score += bridgeScore > 1 ? 1 : 0;
  score -= Math.min(2, dialogueScore);
  score -= Math.min(2, oneTakeScore * 2);

  if (oneTakeScore > 0 && actionScore <= 1) return 1;
  if (score <= -1) return 1;
  if (score <= 1) return 2;
  if (score <= 3) return 3;
  if (score <= 5) return 4;
  return 5;
}

export function resolveStoryboardCameraSegmentCount(
  preference: unknown,
  storyboard?: Partial<StoryboardState> | StoryboardInfo,
  extraText?: string,
): number {
  const normalized = normalizeStoryboardCameraSegmentPreference(preference);
  if (normalized !== 'auto') return normalizeStoryboardCameraSegmentCount(normalized);
  return inferStoryboardCameraSegmentCount(storyboard, extraText);
}

export function buildStoryboardCameraSegmentContract(value: unknown): string[] {
  const count = normalizeStoryboardCameraSegmentCount(value);
  const segmentText = count === 1 ? '1 continuous camera segment' : `${count} continuous camera segments`;
  return [
    `User-selected camera segment count: ${segmentText}. S labels are action/state anchors, not cut points.`,
    count === 1
      ? 'Use one-take shot-flow by default: no hard cuts, no montage, no repeated restart framing. Use motivated pan, track, push, pull, rack focus, blocking change, and sound bridge inside the same camera segment.'
      : `Use at most ${count} motivated camera segments across the whole shot. Do not cut every second; hard cuts, inserts, close-up inserts, smash cuts, montage, and POV inserts all count as segment breaks unless they are described as continuous camera movement.`,
    'Allow the same subject, shot size, or camera angle to continue across more than 2 panels when acting, blocking, prop state, focus, sound, or emotional pressure visibly changes.',
    'Avoid flash-cut rhythm, strobing visual changes, rapid montage, and unnecessary close-up inserts unless the source story explicitly requires them.',
  ];
}
