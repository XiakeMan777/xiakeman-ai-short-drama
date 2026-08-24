import type { ChatMessage } from '@/lib/api-client';

import seedanceFinalVideoPromptTemplateSource from '../../bff/templates/seedance-final-video-prompt.js?raw';
import storyboardBoardTemplateSource from '../../bff/templates/storyboard-board.js?raw';

type StoryboardBoardTemplateModule = {
  STORYBOARD_DIRECTOR_BRIEF_SYSTEM_PROMPT: string;
  STORYBOARD_ACTION_DIRECTOR_SYSTEM_PROMPT: string;
  STORYBOARD_BOARD_PLAN_SYSTEM_PROMPT: string;
  STORYBOARD_NINE_BOARD_PLAN_SYSTEM_PROMPT: string;
  STORYBOARD_SHOT15_BOARD_PLAN_SYSTEM_PROMPT: string;
  STORYBOARD_SMART_BOARD_PLAN_SYSTEM_PROMPT: string;
  buildStoryboardDirectorBriefUserPrompt: (data: unknown) => string;
  buildStoryboardActionDirectorUserPrompt: (data: unknown) => string;
  buildStoryboardBoardPlanUserPrompt: (data: unknown) => string;
  buildStoryboardNineBoardPlanUserPrompt: (data: unknown) => string;
  buildStoryboardShot15BoardPlanUserPrompt: (data: unknown) => string;
  buildStoryboardSmartBoardPlanUserPrompt: (data: unknown) => string;
};

type SeedanceFinalVideoPromptTemplateModule = {
  buildSeedanceFinalVideoPromptSystemPrompt: () => string;
  buildSeedanceFinalVideoPromptUserPrompt: (data: unknown) => string;
};

const STEP4_DIRECT_TEMPLATE_TYPES = new Set([
  'storyboard_director_brief',
  'storyboard_action_director',
  'storyboard_board_plan',
  'storyboard_board_plan_nine',
  'storyboard_board_plan_shot15',
  'storyboard_board_plan_smart',
  'seedance_final_video_prompt',
]);

function evaluateCommonJsModule<T>(source: string, debugName: string): T {
  const module = { exports: {} };
  const factory = new Function(
    'module',
    'exports',
    `${source}\n//# sourceURL=${debugName}`,
  ) as (moduleRef: { exports: unknown }, exportsRef: unknown) => void;
  factory(module, module.exports);
  return module.exports as T;
}

const storyboardBoardTemplates = evaluateCommonJsModule<StoryboardBoardTemplateModule>(
  storyboardBoardTemplateSource,
  'local-bff-template-storyboard-board.js',
);

const seedanceFinalVideoPromptTemplates = evaluateCommonJsModule<SeedanceFinalVideoPromptTemplateModule>(
  seedanceFinalVideoPromptTemplateSource,
  'local-bff-template-seedance-final-video-prompt.js',
);

function parseTemplateJson(templateType: string, userContent: string): unknown {
  try {
    return JSON.parse(userContent);
  } catch {
    throw new Error(`Invalid JSON payload for templateType: ${templateType}`);
  }
}

function buildSystemPrompt(templateType: string): string | null {
  switch (templateType) {
    case 'storyboard_director_brief':
      return storyboardBoardTemplates.STORYBOARD_DIRECTOR_BRIEF_SYSTEM_PROMPT;
    case 'storyboard_action_director':
      return storyboardBoardTemplates.STORYBOARD_ACTION_DIRECTOR_SYSTEM_PROMPT;
    case 'storyboard_board_plan':
      return storyboardBoardTemplates.STORYBOARD_BOARD_PLAN_SYSTEM_PROMPT;
    case 'storyboard_board_plan_nine':
      return storyboardBoardTemplates.STORYBOARD_NINE_BOARD_PLAN_SYSTEM_PROMPT;
    case 'storyboard_board_plan_shot15':
      return storyboardBoardTemplates.STORYBOARD_SHOT15_BOARD_PLAN_SYSTEM_PROMPT;
    case 'storyboard_board_plan_smart':
      return storyboardBoardTemplates.STORYBOARD_SMART_BOARD_PLAN_SYSTEM_PROMPT;
    case 'seedance_final_video_prompt':
      return seedanceFinalVideoPromptTemplates.buildSeedanceFinalVideoPromptSystemPrompt();
    default:
      return null;
  }
}

function buildUserPrompt(templateType: string, userContent: string): string {
  const data = parseTemplateJson(templateType, userContent);
  switch (templateType) {
    case 'storyboard_director_brief':
      return storyboardBoardTemplates.buildStoryboardDirectorBriefUserPrompt(data);
    case 'storyboard_action_director':
      return storyboardBoardTemplates.buildStoryboardActionDirectorUserPrompt(data);
    case 'storyboard_board_plan':
      return storyboardBoardTemplates.buildStoryboardBoardPlanUserPrompt(data);
    case 'storyboard_board_plan_nine':
      return storyboardBoardTemplates.buildStoryboardNineBoardPlanUserPrompt(data);
    case 'storyboard_board_plan_shot15':
      return storyboardBoardTemplates.buildStoryboardShot15BoardPlanUserPrompt(data);
    case 'storyboard_board_plan_smart':
      return storyboardBoardTemplates.buildStoryboardSmartBoardPlanUserPrompt(data);
    case 'seedance_final_video_prompt':
      return seedanceFinalVideoPromptTemplates.buildSeedanceFinalVideoPromptUserPrompt(data);
    default:
      return userContent;
  }
}

export function supportsStep4DirectTemplate(templateType: string): boolean {
  return STEP4_DIRECT_TEMPLATE_TYPES.has(templateType);
}

export function buildStep4DirectTemplateMessages(
  templateType: string,
  userMessages: ChatMessage[],
): ChatMessage[] {
  const systemPrompt = buildSystemPrompt(templateType);
  if (!systemPrompt) {
    throw new Error(`Unknown Step4 direct templateType: ${templateType}`);
  }

  return [
    { role: 'system', content: systemPrompt },
    ...userMessages.map((message) => (
      message.role === 'user'
        ? { ...message, content: buildUserPrompt(templateType, message.content) }
        : message
    )),
  ];
}
