import { SCENE_SPATIAL_MASTER_SCHEMA_VERSION } from '@/lib/sceneSpatialMasterState';
import type { Asset, ImageReference, StoryboardState } from '@/types';

export type Step4DiagnosticLevel = 'info' | 'warning' | 'error' | 'success';

export function isStoryboardBusy(status: StoryboardState['status']) {
  return status === 'checking'
    || status === 'correcting'
    || status === 'choreographing'
    || status === 'choreo-checking'
    || status === 'generating'
    || status === 'self-checking';
}

export function isStep4GenerationActionBusy({
  apiLoading,
  storyboardStatus,
  busyStoryboardCount = 0,
  storyboardBoardGenerating = false,
  storyboardBoardOptimizing = false,
  scenePositionBoardGenerating = false,
}: {
  apiLoading: boolean;
  storyboardStatus?: StoryboardState['status'] | null;
  busyStoryboardCount?: number;
  storyboardBoardGenerating?: boolean;
  storyboardBoardOptimizing?: boolean;
  scenePositionBoardGenerating?: boolean;
}) {
  return apiLoading
    || (storyboardStatus ? isStoryboardBusy(storyboardStatus) : false)
    || busyStoryboardCount > 0
    || storyboardBoardGenerating
    || storyboardBoardOptimizing
    || scenePositionBoardGenerating;
}

export function hasOfficialVirtualHumanTemplateMatch(
  enabled: boolean,
  imageRefs: readonly ImageReference[],
  assetLibrary: readonly Asset[] | undefined,
) {
  if (!enabled) return false;
  const characterNames = new Set(
    imageRefs
      .filter((ref) => ref.type === 'character')
      .map((ref) => ref.name),
  );
  if (characterNames.size === 0) return false;

  return (assetLibrary ?? []).some((asset) => (
    asset.type === 'character'
    && asset.source === 'volc_virtual_human'
    && characterNames.has(asset.name)
  ));
}

export function getStep4PhaseLabel(status: StoryboardState['status'] | null) {
  switch (status) {
    case 'checking':
      return '逻辑检查';
    case 'correcting':
      return '修正剧本';
    case 'choreographing':
      return '动作编排';
    case 'choreo-checking':
      return '编排校验';
    case 'generating':
      return '生成提示词';
    case 'self-checking':
      return '前端自检';
    default:
      return '处理中';
  }
}

export function buildStep4FailureHint(message: string | undefined) {
  if (!message) return null;
  if (
    message.includes('无法连接到提示词代理服务')
    || message.includes('ERR_CONNECTION_REFUSED')
  ) {
    return '请确认前端开发服务和 BFF 提示词代理都已启动，再重新生成。';
  }
  if (message.includes('Failed to fetch')) {
    return '图片 API 请求被中断。若发生在15格故事板生成，通常是参考图上传体积过大或本地图片 API 主动断开；当前会先尝试优化参考图体积，再恢复重试。';
  }
  if (message.includes('请求已取消')) {
    return '上一次生成已被取消，可点击“重试当前步骤”从断点继续。';
  }
  if (message.includes('timeout') || message.includes('超时')) {
    return '请求可能超时了，建议检查网络后点击“重试当前步骤”或“重新生成”。';
  }
  return '可点击“重试当前步骤”，系统会尽量保留已完成的导演规划和故事板图。';
}

export function getDiagnosticStyles(level: Step4DiagnosticLevel) {
  switch (level) {
    case 'error':
      return 'border-red-200/80 bg-red-50/90 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-50';
    case 'warning':
      return 'border-amber-200/80 bg-amber-50/90 text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-50';
    case 'success':
      return 'border-green-200/80 bg-green-50/90 text-green-900 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-50';
    default:
      return 'border-blue-200/80 bg-blue-50/90 text-blue-900 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-50';
  }
}

export function isLegacySceneSchema(schemaVersion: number | undefined) {
  return (schemaVersion ?? 1) < SCENE_SPATIAL_MASTER_SCHEMA_VERSION;
}
