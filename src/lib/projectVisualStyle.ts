import type { StoryboardBoardPlan, StoryboardState } from '@/types';

export const DEFAULT_PROJECT_VISUAL_STYLE = '当前项目既定视觉风格';

export type ProjectVisualStyleSource =
  | 'analysis.styleConfig'
  | 'boardPlan.styleAnchor'
  | 'directorBrief.styleStatement'
  | 'storyboard.prompt'
  | 'default';

export interface ProjectVisualStylePayload {
  styleConfig: string;
  resolvedVisualStyle: string;
  source: ProjectVisualStyleSource;
  inheritanceRule: string;
}

export interface ResolveProjectVisualStyleInput {
  styleConfig?: string | null;
  boardPlanStyleAnchor?: string | null;
  directorStyleStatement?: string | null;
  promptHeader?: string | null;
  promptColorLighting?: string | null;
}

function normalizeStyleText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function resolveProjectVisualStyle(input: ResolveProjectVisualStyleInput = {}): ProjectVisualStylePayload {
  const styleConfig = normalizeStyleText(input.styleConfig);
  const boardPlanStyleAnchor = normalizeStyleText(input.boardPlanStyleAnchor);
  const directorStyleStatement = normalizeStyleText(input.directorStyleStatement);
  const promptStyle = normalizeStyleText([input.promptHeader, input.promptColorLighting].filter(Boolean).join(' / '));

  if (styleConfig) {
    return {
      styleConfig,
      resolvedVisualStyle: styleConfig,
      source: 'analysis.styleConfig',
      inheritanceRule: 'analysis.styleConfig 是项目视觉媒介和美术风格的最高优先级；单镜 styleAnchor / styleStatement 只能补充光色、情绪和表演气质，不得覆盖它。',
    };
  }
  if (boardPlanStyleAnchor) {
    return {
      styleConfig: '',
      resolvedVisualStyle: boardPlanStyleAnchor,
      source: 'boardPlan.styleAnchor',
      inheritanceRule: '未提供全局 styleConfig 时，继承故事板规划的 styleAnchor；不得自行固定为任何未声明的风格。',
    };
  }
  if (directorStyleStatement) {
    return {
      styleConfig: '',
      resolvedVisualStyle: directorStyleStatement,
      source: 'directorBrief.styleStatement',
      inheritanceRule: '未提供全局 styleConfig 或 styleAnchor 时，继承导演阐述中的单镜风格判断；不得自行固定为任何未声明的风格。',
    };
  }
  if (promptStyle) {
    return {
      styleConfig: '',
      resolvedVisualStyle: promptStyle,
      source: 'storyboard.prompt',
      inheritanceRule: '未提供结构化项目风格时，继承当前分镜提示词里的画质、风格和光色；不得自行固定为任何未声明的风格。',
    };
  }
  return {
    styleConfig: '',
    resolvedVisualStyle: DEFAULT_PROJECT_VISUAL_STYLE,
    source: 'default',
    inheritanceRule: '未找到明确风格源时，仅保持当前项目既定视觉风格，不得自行固定为任何具体美术风格。',
  };
}

export function resolveStoryboardProjectVisualStyle(
  storyboard: StoryboardState,
  plan?: StoryboardBoardPlan,
  styleConfig?: string | null,
): ProjectVisualStylePayload {
  return resolveProjectVisualStyle({
    styleConfig,
    boardPlanStyleAnchor: plan?.styleAnchor,
    directorStyleStatement: plan?.directorBrief?.styleStatement,
    promptHeader: storyboard.prompt?.header,
    promptColorLighting: storyboard.prompt?.colorLighting,
  });
}
