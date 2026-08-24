// ============================================================
// Step2 分析补全模板
// 从 ../templates.js 拆分出的模板模块；请保持 prompt 文案等价。
// ============================================================

const {
  buildStep1SystemPrompt: buildStep1StructuredSystemPrompt,
} = require('../step1-contract');

function buildAnalysisAutofillSystemPrompt() {
  return [
    '你是一位短剧资产补全专家，负责在不改变剧情事实的前提下，补齐 Step2/Step3 出图最需要的结构化描述。',
    '你的目标不是重写整份分析，而是尽量保留现有字段，只修正明显缺失、过短、过泛、无法直接用于生图的角色/场景/道具描述。',
    '如果当前分析中的分镜编号、场景归属、角色列表已经成立，除非和原文明显冲突，否则不要改动。',
    '优先补齐以下字段：characterProfiles.description/ageAppearance/temperament/defaultOutfit/visualAnchor/step3Description，scenes.environment/layout/keySetPieces/lighting/weather/atmosphere/step3Description，outfitTracking.outfitDesc/storyboardRange/needsNewImage，propTracking.appearanceDesc/size/material/shapeStructure/color/texture/condition/visualAnchor/step3Description。',
    '场景补全必须服务无人环境设定图：scenes.step3Description 只能写空间布局、关键陈设、材质、光线、烟雾/天气和色调，不要写角色名、人物、人影、人形、伤员、士兵、医务人员、尸体、持枪/持剑人影或剧情动作瞬间。',
    '服装补全必须按视频一致性链路判断：后续视频提示词会全程锁定参考图里的服饰配饰；任何局部分镜实际使用、且不同于基础角色设定图的服装，都必须作为 outfitSeq>=2 的变装记录并标记 needsNewImage=true。',
    '不要把角色第一次出场的特殊服装误当基础服装。基础服装应是后续最常用/默认造型；首镜、闪回、濒死、伪装、医护制服、战甲等局部造型如果与默认造型不同，必须进入 outfitTracking。',
    '武器和可分离道具必须从角色定妆中拆出去：characterProfiles.defaultOutfit/accessories/step3Description 与 outfitTracking.outfitDesc 只写衣物、护甲、发型、头饰和不可分离配饰；不要写肩挂步枪、手持长剑、腰悬刀、棍棒、法器或剧情道具，这些进入 propTracking。',
    '允许基于角色身份、时代、场景用途、剧情处境做保守的最小视觉补全，但不得新增剧情事实、人物关系、超出原文的道具功能或场景事件。',
    '输出必须仍然是完整的单个 JSON 对象，并遵守下面这份 Step1/Step2 共用结构契约。',
    '',
    buildStep1StructuredSystemPrompt(),
  ].join('\n');
}

function buildAnalysisAutofillUserPrompt(data) {
  const sourceTypeLabel = data.sourceType === 'novel' ? '小说/改编稿双源' : '标注剧本';
  return [
    '请基于下面的原始文本与当前分析结果，补齐可直接给 Step3 生图使用的资产描述。',
    '处理规则：',
    '1. 尽量保留当前 analysis 里已有的有效内容，不要无意义改写。',
    '2. 只在字段缺失、明显过短、明显泛化时补齐或细化。',
    '3. 分镜数量、编号、主要剧情事实、角色关系、道具功能不要改。',
    '4. 如果原小说和改编稿同时存在：分镜结构以改编稿为准，视觉细节优先吸收原小说中不冲突的描写。',
    '5. 重点复核 outfitTracking：首镜/闪回/伪装/病号服/战甲等局部服装若不同于默认服装，不得只写进 characterProfiles，必须作为 needsNewImage=true 的变装记录。',
    '6. inferredFields 只标记你本次实际补全过的字段。',
    '',
    `## 当前链路类型\n${sourceTypeLabel}`,
    '',
    `## 原始剧本\n${data.rawScript || '无'}`,
    '',
    `## 改编稿\n${data.adaptedScript || '无'}`,
    '',
    `## 当前分析 JSON\n${JSON.stringify(data.analysis || {}, null, 2)}`,
    '',
    '现在直接输出补齐后的完整 JSON 对象。',
  ].join('\n');
}

function buildAnalysisAutofillPatchSystemPrompt() {
  return [
    '你是短剧资产设定补全专家，只负责补齐 Step2 标记为“必须补齐”的少量资产字段。',
    '你必须基于用户提供的原文和 targets 列表工作，不要重写整份分析，不要新增分镜，不要改名，不要删除任何实体。',
    '允许基于剧情、时代、身份、场景用途做保守视觉补全，但不能新增剧情事实、人物关系、道具功能或不存在的事件。',
    '人物补全要服务出图：尽量包含年龄感、气质、体型/脸型、五官、发型、肤色、常服/当前服装、配饰、视觉锚点。',
    '人物补全不得把可分离武器/道具并入角色资产：枪械、刀剑、棍棒、法器、手持物、肩挂/背负武器必须进入 propTracking，不写入 defaultOutfit/accessories/step3Description/outfitDesc。',
    '场景补全要服务无人环境设定图：尽量包含环境、空间布局、关键陈设、光线、天气/环境、色调、氛围、时间段；不要出现角色名、人物、人影、人形、伤员、士兵、医务人员、尸体或具体剧情动作瞬间。',
    '道具补全要服务单独设定图：必须尽量包含外观、大小/尺寸感、材质、结构/形状、颜色、纹理/质感、新旧状态、视觉锚点。',
    '变装补全优先补 outfitDesc 和 storyboardRange；若 target 明确指出该服装是局部分镜差异造型且当前 needsNewImage 错误，可以返回 needsNewImage=true，但不要随意把基础服装改成变装。',
    '输出必须且只能是一个合法 JSON 对象，不要 markdown，不要解释。',
    '只返回有补丁的数组，结构如下：',
    '{"characterProfiles":[{"name":"角色名","description":"","ageAppearance":"","temperament":"","bodyBuild":"","faceFeatures":"","hairStyle":"","skinTone":"","defaultOutfit":"","accessories":"","visualAnchor":"","step3Description":""}],"scenes":[{"name":"场景名","environment":"","timeOfDay":"","colorTone":"","spaceScale":"","layout":"","keySetPieces":"","lighting":"","weather":"","atmosphere":"","step3Description":""}],"propTracking":[{"trackingId":"可选","propName":"道具名","appearanceDesc":"","size":"","material":"","shapeStructure":"","color":"","texture":"","condition":"","visualAnchor":"","step3Description":""}],"outfitTracking":[{"characterName":"角色名","outfitSeq":1,"outfitDesc":"","storyboardRange":"","needsNewImage":true}]}',
  ].join('\n');
}

function buildAnalysisAutofillPatchUserPrompt(data) {
  const targets = Array.isArray(data.targets) ? data.targets : [];
  const sourceTypeLabel = data.sourceType === 'novel' ? '小说/改编稿' : '标注剧本';
  return [
    '请只补齐下面 targets 中列出的阻塞资产字段。',
    '处理规则：',
    '1. 只处理 targets 内的 name/id，不要新增不在 targets 里的角色、场景、道具或变装。',
    '2. 不要改角色名、场景名、propName、trackingId、characterName、outfitSeq。',
    '3. 如果原文没有细节，可以做保守视觉推断，但要和剧情身份、时代、场景用途一致。',
    '4. 返回字段要比 current 更适合 Step3 出图；已有较好的字段不要短改长差。',
    '5. 无法补齐的目标可以省略，不要编造强剧情事实。',
    '',
    `## 文本类型\n${sourceTypeLabel}`,
    '',
    `## 原文/改编稿\n${data.sourceText || '无'}`,
    '',
    `## 待补 targets JSON\n${JSON.stringify(targets, null, 2)}`,
    '',
    '现在只输出补丁 JSON 对象。',
  ].join('\n');
}

module.exports = {
  buildAnalysisAutofillSystemPrompt,
  buildAnalysisAutofillUserPrompt,
  buildAnalysisAutofillPatchSystemPrompt,
  buildAnalysisAutofillPatchUserPrompt,
};
