// ============================================================
// 虾客漫 BFF - 提示词模板兼容入口
// 长模板正文已按领域拆分到 ./templates/*，本文件只做路由分发。
// ============================================================

const {
  buildStep1SystemPrompt: buildStep1StructuredSystemPrompt,
  buildStep1UserPrompt: buildStep1StructuredUserPrompt,
} = require('./step1-contract');
const seriesTemplates = require('./series-templates');

const {
  buildAnalysisAutofillSystemPrompt,
  buildAnalysisAutofillUserPrompt,
  buildAnalysisAutofillPatchSystemPrompt,
  buildAnalysisAutofillPatchUserPrompt,
} = require('./templates/analysis-autofill');
const {
  NOVEL_ADAPT_SYSTEM_PROMPT,
  NOVEL_ADAPT_RHYTHM_REPAIR_SYSTEM_PROMPT,
  buildNovelAdaptUserPrompt,
  buildNovelAdaptRhythmRepairUserPrompt,
} = require('./templates/novel-adapt');
const {
  SCRIPT_FORMAT_ADAPT_SYSTEM_PROMPT,
  buildScriptFormatAdaptUserPrompt,
} = require('./templates/script-format-adapt');
const {
  SCRIPT_TYPE_CLASSIFIER_SYSTEM_PROMPT,
  buildScriptTypeClassifierUserPrompt,
} = require('./templates/script-type-classifier');
const {
  getStyleKeywords,
  buildSystemPromptL1,
  normalizeFrameRatio,
  getFrameLanguageLabel,
  getFrameMotionSpecialty,
  applyFrameDirectorRules,
  mergeFrameRatioIntoPayload,
  buildSystemPromptL2,
} = require('./templates/shared-frame');
const {
  buildCheckSystemPrompt,
  CORRECT_SYSTEM_PROMPT,
  buildCheckUserPrompt,
  buildCorrectUserPrompt,
} = require('./templates/step4-check-correct');
const {
  buildGenerateUserPrompt,
  buildGenerateWithChoreographyPrompt,
  buildOfficialVirtualHumanGenerateSystemPrompt,
  buildOfficialVirtualHumanGenerateUserPrompt,
} = require('./templates/step4-generate');
const {
  GENERATE_FORMATTER_SYSTEM_PROMPT,
  buildChoreographSystemPrompt,
  buildChoreographUserPrompt,
  CHOREO_CHECK_SYSTEM_PROMPT,
  buildChoreoCheckUserPrompt,
} = require('./templates/step4-choreograph');
const {
  STORYBOARD_DIRECTOR_BRIEF_SYSTEM_PROMPT,
  STORYBOARD_ACTION_DIRECTOR_SYSTEM_PROMPT,
  STORYBOARD_BOARD_PLAN_SYSTEM_PROMPT,
  STORYBOARD_NINE_BOARD_PLAN_SYSTEM_PROMPT,
  STORYBOARD_SHOT15_BOARD_PLAN_SYSTEM_PROMPT,
  STORYBOARD_SMART_BOARD_PLAN_SYSTEM_PROMPT,
  buildStoryboardDirectorBriefUserPrompt,
  buildStoryboardActionDirectorUserPrompt,
  buildStoryboardBoardPlanUserPrompt,
  buildStoryboardNineBoardPlanUserPrompt,
  buildStoryboardShot15BoardPlanUserPrompt,
  buildStoryboardSmartBoardPlanUserPrompt,
} = require('./templates/storyboard-board');
const {
  VIDEO_PROMPT_COMPACT_SYSTEM_PROMPT,
  VIDEO_PROMPT_DESENSITIZE_SYSTEM_PROMPT,
  buildVideoPromptCompactUserPrompt,
  buildVideoPromptDesensitizeUserPrompt,
} = require('./templates/video-utils');
const {
  buildSeedanceFinalVideoPromptSystemPrompt,
  buildSeedanceFinalVideoPromptUserPrompt,
} = require('./templates/seedance-final-video-prompt');

// 步骤1历史模板（legacy，不参与运行；实际 Step1 使用 ./step1-contract）
// LEGACY_STEP1_SYSTEM_PROMPT_DO_NOT_USE
// buildLegacyStep1UserPromptDoNotUse

function buildSystemPrompt(templateType, vars = {}) {
  const videoRatio = normalizeFrameRatio(vars.videoRatio);
  switch (templateType) {
    case 'step1':
      return buildStep1StructuredSystemPrompt();

    case 'analysis_autofill':
      return buildAnalysisAutofillSystemPrompt();

    case 'analysis_autofill_patch':
      return buildAnalysisAutofillPatchSystemPrompt();

    case 'novel_adapt':
      return NOVEL_ADAPT_SYSTEM_PROMPT;

    case 'script_format_adapt':
      return SCRIPT_FORMAT_ADAPT_SYSTEM_PROMPT;

    case 'script_type_classifier':
      return SCRIPT_TYPE_CLASSIFIER_SYSTEM_PROMPT;

    case 'novel_adapt_rhythm_repair':
      return NOVEL_ADAPT_RHYTHM_REPAIR_SYSTEM_PROMPT;

    case 'series_premise_polish':
    case 'series_concept_analyze':
    case 'series_concept_alignment_check':
    case 'series_step0_quality_check':
    case 'series_step0_quality_repair':
      return seriesTemplates.buildSeriesSystemPrompt(templateType);

    case 'series_bible_generate':
    case 'series_episode_cards_generate':
    case 'series_episode_script_generate':
    case 'series_episode_script_repair':
    case 'series_episode_settle':
      return seriesTemplates.buildSeriesSystemPrompt(templateType);

    case 'preprocess':
      // 向后兼容：preprocess 走 check 流程
      return buildCheckSystemPrompt(videoRatio);

    case 'check':
      return buildCheckSystemPrompt(videoRatio);

    case 'correct':
      return CORRECT_SYSTEM_PROMPT;

    case 'choreograph':
      // 动作编排 — 根据场景蓝图中的 sceneType 和 combatSubType 选择专业路径
      return buildChoreographSystemPrompt(vars.sceneType || 'dialogue', vars.combatSubType, videoRatio);

    case 'choreo_check':
      // 编排方案逻辑检查
      return CHOREO_CHECK_SYSTEM_PROMPT;

    case 'generate':
      // 单一分支真相：优先使用 generateMode，向后兼容 hasChoreography
      if ((vars.generateMode || (vars.hasChoreography ? 'formatter' : 'full')) === 'formatter') {
        const styleInfo = getStyleKeywords(vars.styleConfig || '');
        return `# 身份定义\n你是一位${styleInfo.style}${getFrameLanguageLabel(videoRatio)}短剧视频提示词导演写手。你的唯一任务是基于动作编排方案（JSON）写出标准格式、高密度、可直接用于视频AI工具的最终提示词。\n\n## 你的专长\n- 熟练掌握${styleInfo.expertise}\n- 擅长把导演编排、人物站位、道具状态、镜头节奏转写成视频模型能稳定理解的画面语言\n- 熟悉${getFrameMotionSpecialty(videoRatio)}\n- 能在不改变剧情事实和编排骨架的前提下，补足动作力度、环境反馈、微表情、光影质感和落幅张力` + '\n\n' + applyFrameDirectorRules(GENERATE_FORMATTER_SYSTEM_PROMPT, videoRatio);
      }
      return applyFrameDirectorRules(buildSystemPromptL1(vars.styleConfig || ''), videoRatio)
        .replace('精通竖屏9:16画幅的视频语言和运镜设计', `精通${getFrameMotionSpecialty(videoRatio)}`)
        + '\n\n' + buildSystemPromptL2(vars.styleConfig || '', videoRatio);

    case 'generate_official_virtual_human':
      return buildOfficialVirtualHumanGenerateSystemPrompt(vars);

    case 'video_prompt_compact':
      return VIDEO_PROMPT_COMPACT_SYSTEM_PROMPT;

    case 'video_prompt_desensitize':
      return VIDEO_PROMPT_DESENSITIZE_SYSTEM_PROMPT;

    case 'seedance_final_video_prompt':
      return buildSeedanceFinalVideoPromptSystemPrompt();

    case 'bgm_analysis':
      return 'You are a professional film and short-drama music supervisor. Return only the JSON object requested by the user, with no markdown or extra commentary.';

    case 'dubbing_analysis':
      // TTS 配音分析 — 前端已自带完整 prompt，BFF 只做透传
      return '你是一个专业的漫剧配音导演，擅长分析角色台词的情绪、音色和风格。请严格按照用户要求的 JSON 格式输出分析结果，不要输出任何其他内容。';

    case 'storyboard_director_brief':
      return STORYBOARD_DIRECTOR_BRIEF_SYSTEM_PROMPT;

    case 'storyboard_action_director':
      return STORYBOARD_ACTION_DIRECTOR_SYSTEM_PROMPT;

    case 'storyboard_board_plan':
      return STORYBOARD_BOARD_PLAN_SYSTEM_PROMPT;

    case 'storyboard_board_plan_nine':
      return STORYBOARD_NINE_BOARD_PLAN_SYSTEM_PROMPT;

    case 'storyboard_board_plan_shot15':
      return STORYBOARD_SHOT15_BOARD_PLAN_SYSTEM_PROMPT;

    case 'storyboard_board_plan_smart':
      return STORYBOARD_SMART_BOARD_PLAN_SYSTEM_PROMPT;

    default:
      console.warn(`[BFF] Unknown templateType: ${templateType}`);
      return null;
  }
}

function parseTemplateJson(templateType, userContent) {
  try {
    return JSON.parse(userContent);
  } catch {
    throw new Error(`Invalid JSON payload for templateType: ${templateType}`);
  }
}

/**
 * 根据模板类型和用户数据构建 user prompt
 * @param {string} templateType - 模板类型标识
 * @param {string} userContent - 前端发送的用户消息（可能是剧本文本或 JSON 数据）
 * @returns {string} 完整的 user prompt
 */
function buildUserPrompt(templateType, userContent, vars = {}) {
  switch (templateType) {
    case 'step1':
      // 前端只发送剧本文本
      return buildStep1StructuredUserPrompt(userContent);

    case 'analysis_autofill':
      return buildAnalysisAutofillUserPrompt(parseTemplateJson(templateType, userContent));

    case 'analysis_autofill_patch':
      return buildAnalysisAutofillPatchUserPrompt(parseTemplateJson(templateType, userContent));

    case 'novel_adapt':
      // 前端发送 JSON: { novelText, storyboardDuration, episodeDuration }
      {
        const data = parseTemplateJson(templateType, userContent);
        return buildNovelAdaptUserPrompt(data.novelText, data.storyboardDuration, data.episodeDuration);
      }

    case 'script_format_adapt':
      return buildScriptFormatAdaptUserPrompt(parseTemplateJson(templateType, userContent));

    case 'script_type_classifier':
      return buildScriptTypeClassifierUserPrompt(parseTemplateJson(templateType, userContent));

    case 'novel_adapt_rhythm_repair':
      return buildNovelAdaptRhythmRepairUserPrompt(parseTemplateJson(templateType, userContent));

    case 'series_premise_polish':
    case 'series_concept_analyze':
    case 'series_concept_alignment_check':
    case 'series_step0_quality_check':
    case 'series_step0_quality_repair':
      return seriesTemplates.buildSeriesUserPrompt(templateType, parseTemplateJson(templateType, userContent));

    case 'series_bible_generate':
    case 'series_episode_cards_generate':
    case 'series_episode_script_generate':
    case 'series_episode_script_repair':
    case 'series_episode_settle':
      return seriesTemplates.buildSeriesUserPrompt(templateType, parseTemplateJson(templateType, userContent));

    case 'preprocess':
      // 向后兼容：preprocess 走 check 流程
      return buildCheckUserPrompt(mergeFrameRatioIntoPayload(parseTemplateJson(templateType, userContent), vars));

    case 'check':
      // 前端发送 JSON 结构化数据
      return buildCheckUserPrompt(mergeFrameRatioIntoPayload(parseTemplateJson(templateType, userContent), vars));

    case 'correct':
      // 前端发送 JSON: { storyboard, scriptText, logicFixes, isFirstStoryboard, isLastStoryboard }
      return buildCorrectUserPrompt(mergeFrameRatioIntoPayload(parseTemplateJson(templateType, userContent), vars));

    case 'choreograph':
      // 前端发送 JSON: { storyboard, sceneDetail, imageRefs, scriptText, correctedScript, sceneBlueprint, prevLastFrameInfo }
      return buildChoreographUserPrompt(mergeFrameRatioIntoPayload(parseTemplateJson(templateType, userContent), vars));

    case 'choreo_check':
      // 前端发送 JSON: { storyboard, choreographyJson, propTracking, itemTracker, sceneBlueprint, scriptText, correctedScript }
      return buildChoreoCheckUserPrompt(mergeFrameRatioIntoPayload(parseTemplateJson(templateType, userContent), vars));

    case 'generate':
      {
        const data = mergeFrameRatioIntoPayload(parseTemplateJson(templateType, userContent), vars);
        if ((data.generateMode || (data.choreography ? 'formatter' : 'full')) === 'formatter') {
          return buildGenerateWithChoreographyPrompt(data);
        }
        return buildGenerateUserPrompt(data);
      }

    case 'generate_official_virtual_human':
      return buildOfficialVirtualHumanGenerateUserPrompt(mergeFrameRatioIntoPayload(parseTemplateJson(templateType, userContent), vars));

    case 'video_prompt_compact':
      return buildVideoPromptCompactUserPrompt(parseTemplateJson(templateType, userContent));

    case 'video_prompt_desensitize':
      return buildVideoPromptDesensitizeUserPrompt(parseTemplateJson(templateType, userContent));

    case 'seedance_final_video_prompt':
      return buildSeedanceFinalVideoPromptUserPrompt(parseTemplateJson(templateType, userContent));

    case 'bgm_analysis':
      return userContent;

    case 'dubbing_analysis':
      // TTS 配音分析 — 前端已自带完整 prompt，直接透传
      return userContent;

    case 'storyboard_director_brief':
      return buildStoryboardDirectorBriefUserPrompt(parseTemplateJson(templateType, userContent));

    case 'storyboard_action_director':
      return buildStoryboardActionDirectorUserPrompt(parseTemplateJson(templateType, userContent));

    case 'storyboard_board_plan':
      return buildStoryboardBoardPlanUserPrompt(parseTemplateJson(templateType, userContent));

    case 'storyboard_board_plan_nine':
      return buildStoryboardNineBoardPlanUserPrompt(parseTemplateJson(templateType, userContent));

    case 'storyboard_board_plan_shot15':
      return buildStoryboardShot15BoardPlanUserPrompt(parseTemplateJson(templateType, userContent));

    case 'storyboard_board_plan_smart':
      return buildStoryboardSmartBoardPlanUserPrompt(parseTemplateJson(templateType, userContent));

    default:
      return userContent;
  }
}

module.exports = {
  buildSystemPrompt,
  buildUserPrompt,
  findSeriesEpisodeScriptGuardIssues: seriesTemplates.findSeriesEpisodeScriptGuardIssues,
  buildSeriesEpisodeScriptRepairPrompt: seriesTemplates.buildSeriesEpisodeScriptRepairPrompt,
  buildSeriesEpisodeScriptRepairUserPrompt: seriesTemplates.buildSeriesEpisodeScriptRepairUserPrompt,
};
