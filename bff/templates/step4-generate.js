// ============================================================
// Step4 视频提示词生成模板
// 从 ../templates.js 拆分出的模板模块；请保持 prompt 文案等价。
// ============================================================

const {
  getStyleKeywords,
  getFramePromptLabel,
  getFrameLanguageLabel,
  buildFrameAwareStyleConfig,
  buildStrictNoSubtitleHeader,
  STRICT_NO_SUBTITLE_HEADER,
  STRICT_NO_SUBTITLE_FOOTER,
  STRICT_NO_SUBTITLE_RULE,
  SEEDANCE_2_PROMPT_RULES,
  AUDIO_PERFORMANCE_RULES,
  formatImageReferenceLine,
  buildSeedanceReferenceRoleInstruction,
  buildVisualCharacterReferenceInstruction,
  buildVideoImageBudgetInstruction,
  buildPropReferenceInstruction,
  buildExecutableShortDramaPromptRules,
  buildOutfitReferenceInstruction,
  buildSpatialContinuityContext,
} = require('./shared-frame');

function buildOfficialVirtualHumanGenerateSystemPrompt(vars = {}) {
  const styleInfo = getStyleKeywords(vars.styleConfig || '');
  const frameLabel = getFramePromptLabel(vars.videoRatio);
  const frameLanguageLabel = getFrameLanguageLabel(vars.videoRatio);
  const generateMode = (vars.generateMode || (vars.hasChoreography ? 'formatter' : 'full')) === 'formatter'
    ? 'formatter'
    : 'full';
  const modeInstruction = generateMode === 'formatter'
    ? '当前输入包含动作编排 JSON。你要保留编排的时间轴、站位、动作因果和道具状态，只把它转写成官方虚拟人视频模式的最终提示词。'
    : '当前输入不含可用动作编排。你要基于剧本、逻辑修正、图片引用和上下文，直接生成官方虚拟人视频模式的最终提示词。';

  return `# 官方虚拟人视频模式（独立模板）
你是一位${styleInfo.style}${frameLanguageLabel}短剧视频提示词导演写手。你的任务是为“官方虚拟人脸库 + 无脸服装/体态参考图”的视频链路生成 Step4 最终视频提示词。
本模板只服务 templateType=generate_official_virtual_human；普通 generate 模式仍使用原模板，不能混用本模板规则。

## 当前生成方式
${modeInstruction}

## 参考图语义硬规则
1. 官方虚拟人身份图负责角色脸部身份、五官比例、脸型、发型、年龄感和身份一致性；人物段必须写成“官方虚拟人身份硬锁脸部身份”，视频提交时会作为官方身份参考加入。
2. Step4 里的角色参考图片如果来自“无脸服装设定图 / 无脸装扮设定图 / 无头或无脸体态图”，只能读取服装、体态、轮廓、材质、配色、破损、装备和姿势比例；人物段必须写成“参考图片X硬锁服装/体态/装扮/材质/配饰”。
3. 严禁从无脸服装图提取、推断或锁定五官、脸型、表情、肤色、发型、发际线、眉眼鼻唇等脸部信息。
4. 人物段不能写“参考图片X中角色的外貌特征，全程锁定五官脸型发型”。必须改写为“官方虚拟人身份硬锁脸部身份；参考图片X硬锁服装/体态/装扮/材质/配饰”。
5. 时间段中仍可使用“角色名(图片X)”标注行动主体，但语义是服装/体态参考编号，不是脸部身份参考编号。
6. 角色近景、对话和情绪微动作可以写眼神、呼吸、唇线等表演细节，但脸部身份来源必须写为官方虚拟人身份，不得写成来自无脸服装图。

## 人物段推荐写法
- 正确：角色A：官方虚拟人身份硬锁脸部身份，锁定角色A的五官比例、脸型与发型；参考图片2硬锁服装/体态/装扮/材质/配饰，当前分镜指定服装版本、材质状态、体态轮廓和装扮层次全程继承参考图。
- 错误：参考图片2中角色A的外貌特征，角色A的脸部身份来自参考图片2，参考图片2全程锁定五官脸型发型服饰配饰。

## 输出质量要求
- 输出必须是可直接提交给视频模型的最终提示词，不要解释模板、不要输出 JSON、不要输出 markdown。
- 保留${frameLanguageLabel}、超高清8K、项目风格和严格无字幕禁令。
- 场景、人物、景别运镜、时间段、调色光影、结尾字幕禁令必须齐全。
- 第一行必须直接是“${frameLabel}...”并包含完整严格无字幕禁令，禁止在第一行前输出 *** 或任何标题。
- 调色光影段必须独立成段，并以“调色光影：”开头，同时写明色彩、光线、明暗对比和空气质感。
- 每个时间段必须写清楚空间位置、朝向、连续动作、说话/内心独白归属、音效、BGM、对白表演和落幅定格。
- 每句对白、内心OS、系统播报、旁白都必须在引号后标注独立音轨秒数，例如“台词”（对白音轨：3–5.2秒）。音轨秒数必须落在该行视觉时间段内；同一视觉时间段内多句语音必须拆成连续、不重叠的小音轨。
- 动作要有连续因果，不要把画面写成静态海报或逐帧摆拍。
- 风格质感只做增强，不得改变剧情事实、角色身份、道具持有状态和上下分镜边界。

${STRICT_NO_SUBTITLE_RULE}

${SEEDANCE_2_PROMPT_RULES}

${AUDIO_PERFORMANCE_RULES}

## 标准输出结构
${buildStrictNoSubtitleHeader(vars.styleConfig, vars.videoRatio)}
***
场景段
***
人物段
***
景别+运镜概述
***
时间段｜景别+运镜+特效标注｜空间位置+动作描述+说话+台词+每句语音音轨秒数｜音效：动作音效+环境音；BGM：情绪曲线；对白表演：语气/语速/呼吸停顿
***
调色光影：色彩、光线、明暗对比、空气质感
***
${STRICT_NO_SUBTITLE_FOOTER}`;
}

function buildOfficialVirtualHumanReferenceContext(data) {
  const explicitRefs = Array.isArray(data.officialVirtualHumanRefs) ? data.officialVirtualHumanRefs : [];
  const refs = explicitRefs.length > 0
    ? explicitRefs
    : (Array.isArray(data.imageRefs) ? data.imageRefs.filter((ref) => ref.type === 'character') : []);

  const lines = refs.map((ref) => {
    const outfitLabel = Number.isFinite(ref.outfitSeq)
      ? `变装${ref.outfitSeq}`
      : (ref.variantKey || '基础装扮');
    return `- ${ref.refId} ${ref.name}（${outfitLabel}）：官方虚拟人身份硬锁脸部身份，锁定脸、五官、脸型、发型和身份；${ref.refId} 硬锁服装/体态/装扮/材质/配饰，不得从该图读取脸部信息。`;
  });

  return `## 官方虚拟人模式引用语义（最高优先级）
${lines.length > 0 ? lines.join('\n') : '- 当前分镜未检测到角色图片引用；如出现角色，仍必须优先使用官方虚拟人身份硬锁脸部身份。'}

## 对普通模板措辞的覆盖
下方基础任务文本若出现“参考图片X中角色的外貌特征”“全程锁定五官脸型发型服饰配饰”等普通模式措辞，在本次输出中必须按官方虚拟人模式改写：
- “五官/脸型/发型/身份”归官方虚拟人身份图，并写成“官方虚拟人身份硬锁脸部身份”。
- “服装/体态/装扮/材质/破损/配饰/装备”归 Step4 的角色参考图片，并写成“参考图片X硬锁服装/体态/装扮/材质/配饰”。
- 不得让无脸服装图承担脸部锁定职责。

## 对普通模板格式的覆盖
- 最终输出第一行必须直接写“${getFramePromptLabel(data.videoRatio)}，超高清8K画质，...，${STRICT_NO_SUBTITLE_HEADER}”，禁止在第一行前输出 ***。
- 调色段必须以“调色光影：”开头；不要写成只有“调色由...”而没有“光影”的段落。`;
}

function buildOfficialVirtualHumanGenerateUserPrompt(data) {
  const mode = data.generateMode || (data.choreography ? 'formatter' : 'full');
  const basePrompt = mode === 'formatter'
    ? buildGenerateWithChoreographyPrompt(data)
    : buildGenerateUserPrompt(data);

  return `${buildOfficialVirtualHumanReferenceContext(data)}

---

${basePrompt}`;
}

// ============================================================
// 步骤1历史模板（legacy，不参与运行；实际 Step1 使用 ./step1-contract）

// ============================================================

function buildGenerateUserPrompt(data) {
  const { storyboard, sceneDetail, imageRefs, sceneRefName, hasSceneReference, sceneReferenceLabel, scriptText, styleConfig, logicFixSummary, prevLastFrameInfo, isLastStoryboard, isFirstStoryboard, preprocessNotes, correctedScript, choreoCheckFailSummary, sceneBlueprint, propTracking, prevNarrativeSummary, itemTracker, nextStoryboardSummary, prevSpatialBlocking, sceneSpatialBible } = data;
  const resolvedSceneName = storyboard.scene || sceneRefName || '未指定';
  const frameLabel = getFramePromptLabel(data.videoRatio);
  const frameAwareStyleConfig = buildFrameAwareStyleConfig(styleConfig, data.videoRatio);
  const sceneReferenceInstruction = hasSceneReference
    ? `场景段必须使用"${sceneReferenceLabel}是唯一场景空间母版"句式引用场景"${resolvedSceneName}"，锁定参考图中的空间结构、关键陈设、材质、光线、色调和机位轴线，禁止重新发挥。`
    : `当前分镜没有场景参考图，场景段必须直接围绕场景"${resolvedSceneName}"展开描述，禁止编造"参考图片1"或其他不存在的场景引用编号。`;
  const sceneSectionFormat = hasSceneReference
    ? `第2段（场景）：${sceneReferenceLabel}是唯一场景空间母版，场景名加上完整环境、色调、光影、氛围、时间段描述，并明确锁定空间结构、关键陈设、材质、光线、色调和机位轴线。禁止在场景描述后另起一行写道具信息，道具归入人物段。`
    : '第2段（场景）：直接以当前分镜场景设定起句，写场景名加上完整环境、色调、光影、氛围、时间段描述。禁止虚构场景参考图，道具归入人物段。';
  const imageRefText = imageRefs.map(formatImageReferenceLine).join('\n');
  const outfitRefNote = buildOutfitReferenceInstruction(imageRefs, '生成提示词时');
  const visualCharacterRefNote = buildVisualCharacterReferenceInstruction(imageRefs, '生成提示词时');
  const videoImageBudgetNote = buildVideoImageBudgetInstruction(imageRefs);
  const propRefs = imageRefs.filter((r) => r.type === 'prop');
  const propRefNote = buildPropReferenceInstruction(propRefs, '生成提示词时');
  const seedanceRefRoleNote = buildSeedanceReferenceRoleInstruction(imageRefs, '生成提示词时');
  const prevInfo = prevLastFrameInfo
    ? `\n\n## 上一分镜落幅画面信息（用于衔接）\n${prevLastFrameInfo}\n→ 请确保本分镜开场与上一分镜落幅之间视觉过渡自然\n→ ⚠️ 禁止使用"承接上一镜""续上一镜"等模糊引用词，必须将上一分镜落幅的具体状态（肢体位置、道具持有、朝向）显式重写为本分镜开场描述的一部分`
    : '';
  const lastNote = isLastStoryboard
    ? '\n\n## ⚠️ 末镜特殊处理\n这是本集最后一个分镜。落幅定格需要特别设计：'
    : '';
  const firstNote = isFirstStoryboard
    ? '\n\n## ⚠️ 首镜特殊处理\n这是本集第一个分镜。前3-5秒必须是钩子——冲突前置/悬念开场/视觉冲击开场，运镜要快速建立注意力。\n⚠️ 这是首镜，无上一分镜，禁止使用"承接上一镜""续上一镜"等引用词。'
    : '';
  const sceneDetailText = sceneDetail
    ? `（时间段：${sceneDetail.timeOfDay || '未指定'}，环境：${sceneDetail.environment || '未指定'}，色调：${sceneDetail.colorTone || '未指定'}）`
    : '';

  // 场景蓝图摘要（分支B新增）
  const sceneBlueprintInfo = sceneBlueprint
    ? `\n\n## 场景蓝图（供参考场景类型、运镜节奏和声音节奏）\n- 场景类型：${sceneBlueprint.sceneType || '未指定'}${sceneBlueprint.combatSubType ? `\n- 打斗子类型：${sceneBlueprint.combatSubType}` : ''}${sceneBlueprint.combatType ? `\n- 打斗类型：${sceneBlueprint.combatType}` : ''}\n- 强度等级：${sceneBlueprint.intensity || '中'}\n- 情绪弧线：${sceneBlueprint.emotionArc || '未指定'}${sceneBlueprint.soundDesign ? `\n- 声音设计：${sceneBlueprint.soundDesign}` : ''}${sceneBlueprint.bgmMood ? `\n- BGM情绪：${sceneBlueprint.bgmMood}` : ''}${sceneBlueprint.dialoguePerformance ? `\n- 对白表演：${sceneBlueprint.dialoguePerformance}` : ''}`
    : '';

  // 道具/物品追踪（分支B新增）
  const propTrackingInfo = propTracking && propTracking.length > 0
    ? `\n\n## 道具/物品一致性追踪（生成提示词时必须确保道具引用与以下清单一致）\n${propTracking.map(p =>
        `- **${p.propName}**${p.trackingId ? ` [ID=${p.trackingId}]` : ''}：外观="${p.appearanceDesc || '未描述'}"，持有者=${p.holder || '未指定'}，分镜范围=${p.storyboardRange || '未指定'}，状态变化=${p.stateChanges || '无'}，需追踪=${p.needsTracking === false ? '否' : '是'}，需参考图=${p.needsImage ? '是' : '否'}`
      ).join('\n')}\n请在人物段和时间段中严格遵循此清单的道具持有者和状态。`
    : '';
  const trackerInfo = itemTracker
    ? `\n\n## 当前物品状态快照（最终生成时必须以此为准）\n${typeof itemTracker === 'string' && itemTracker.includes(';')
        ? itemTracker.split(';').filter(Boolean).map(entry => `- ${entry.trim()}`).join('\n')
        : typeof itemTracker === 'string'
        ? itemTracker
        : Object.entries(itemTracker).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : '';
  const spatialContinuityInfo = buildSpatialContinuityContext(prevSpatialBlocking, sceneSpatialBible, '最终提示词生成');

  // 修正后剧本作为主源，原始剧本降级为参考
  const correctedSection = correctedScript
    ? `## 当前分镜修正后剧本（⚡ 主要依据，以该版本为准生成提示词）
${correctedScript}

## 当前分镜原始剧本片段（仅供参考，如与修正后剧本矛盾，以修正后剧本为准）
${scriptText}`
    : `## 当前分镜原始剧本片段（唯一主源）
${scriptText}`;

  return `请为以下分镜生成完整的视频提示词，严格遵循标准格式模板。

⚠️ 格式硬提醒：你的输出必须是纯文本+***分隔，绝对禁止使用#标题或章节式结构！禁止输出"分镜XX视频提示词""基础信息""场景提示词"等章节标题！参照system prompt中的Few-Shot示例格式！

## 当前分镜信息
- 编号：分镜${String(storyboard.number).padStart(2, '0')}
- 名称：${storyboard.name}
- 所属场景：${storyboard.scene || sceneRefName || '未指定'}${sceneDetailText}
- 时长：${storyboard.duration}
- 景别：${storyboard.shotSize}
- 出场角色：${storyboard.characters.join('、')}

## 图片引用分配（必须严格使用以下引用，不得替换或省略任何引用编号）
${imageRefText}

**重要**：${sceneReferenceInstruction}人物/生物段必须使用"参考图片X中角色名身份硬锁"句式引用各角色；参考图负责人类/类人角色的五官、脸型、发型、服装、配饰一致性，以及怪兽/异兽/敌方生物的主体形态一致性；文字只补当前状态、本镜任务、攻击/受损变化和易丢失锚点。不得把怪兽写成“五官脸型发型服饰配饰全程继承参考图”。如有物品/道具参考图，在持有该物品的角色描述中用"参考图片N中XX道具外观硬锁"句式引用，时间段中用(图片N)标注物品出现；参考图负责外观一致性，文字只补当前持有人、位置、状态和变化，不得变色、变形、消失、替换。不得自行编造引用编号、更换场景名或把变装分镜回退到基础服装参考图。${seedanceRefRoleNote}${videoImageBudgetNote}${outfitRefNote}${visualCharacterRefNote}

## 声音表演与BGM设计（必须写入每个时间段第3字段）
- 字段3统一格式：音效：动作音效+环境音；BGM：情绪曲线；对白表演：语气/音量/语速/呼吸停顿/口型节拍。
- 有对白时，必须写明说话情绪、音量、语速、句前呼吸或停顿、句后反应；BGM在对白出现时压低，不盖过人声。
- 没有对白时，也必须写环境底噪和BGM状态，禁止只写一个孤立音效词。

**⚠️ 朝向描写硬约束（视频方向一致性核心）**：
时间段第2字段中，每个出场角色必须明确写出朝向：
- 朝向词库：面朝镜头 / 背对镜头 / 左侧脸朝镜头 / 右侧脸朝镜头 / 面朝画面左侧 / 面朝画面右侧 / 侧面朝镜头 / 四分之三侧脸朝镜头 / 转身面朝XX
- 格式："角色名(图片X)+空间位置+朝向"，如"角色A(图片2)居中面朝镜头偏右"
- 规则：①同一角色相邻时间段朝向变化必须有过渡描述（如"转身面朝"）②对话场景说话人必须面朝镜头或四分之三侧脸③人物段首次出现的朝向决定观众对该角色的方向认知④当角色朝向与上一时间段相同时，直接写明朝向，禁止使用"转为""转向""变为"等暗示变化的词汇，朝向变化仅在确实发生物理转向时标注${prevInfo}${spatialContinuityInfo}${propRefNote}

## 逻辑修正记录（已体现在修正后剧本中，此处供参考）
${logicFixSummary || '【逻辑检查通过，无需修正】'}${preprocessNotes ? `\n\n## 预处理创作分析（请参考以下建议生成提示词）\n${preprocessNotes}` : ''}${choreoCheckFailSummary ? `\n\n## ⚠️ 动作编排检查结果（生成时必须吸收这些修正）\n${choreoCheckFailSummary}` : ''}${sceneBlueprintInfo}${propTrackingInfo}${trackerInfo}${firstNote}${lastNote}${prevNarrativeSummary ? `\n\n## ⚠️ 前序分镜叙事上下文（必须确保本分镜与前面剧情连贯）\n${prevNarrativeSummary}\n→ 本分镜开场必须与前序分镜的落幅状态视觉衔接\n→ 角色情绪/动作必须从前序分镜的状态自然过渡，禁止突兀跳变\n→ 场景/道具/服装状态必须与前序分镜保持一致` : ''}${
    isLastStoryboard
      ? `\n普通集：落幅定格后加"画面渐黑"或"画面缓缓暗下"\n卡点集：落幅定格停在最强张力点，不加渐黑，最大化悬念张力`
      : ''
  }

${nextStoryboardSummary ? `

## 下一分镜摘要（边界约束）
${nextStoryboardSummary}
→ 当前分镜不得提前表现下一分镜的核心事件、信息揭示或情绪高潮` : ''}

## 声音归属保持规则（硬约束）
- 源片段中标为“内心OS（角色）”的内容，后续必须按闭唇心声处理，禁止改写成世界观旁白
- 源片段中标为“系统播报（系统）”的内容，后续必须保持为系统声音/系统提示，不得改写成上帝视角解说
- 只有源片段明确为“世界观旁白”时，才允许输出外部解说式旁白
- 每句对白、内心OS、系统播报、旁白都必须在引号后标注独立音轨秒数，例如“台词”（对白音轨：3–5.2秒）。音轨秒数必须落在该行视觉时间段内；同一视觉时间段内多句语音必须拆成连续、不重叠的小音轨。禁止只把对白塞进动作字段而不给音轨秒数。
- 角色对白要带表演方向：语气、音量、语速、句前呼吸/停顿、句后反应；内心OS必须闭唇，用呼吸、心跳、环境低频或BGM承托。

${STRICT_NO_SUBTITLE_RULE}

${SEEDANCE_2_PROMPT_RULES}

${AUDIO_PERFORMANCE_RULES}

## 项目风格配置
${frameAwareStyleConfig}

${correctedSection}

---

## 输出格式规范（必须严格遵守）

提示词整体分为7个段落，用 *** 分隔符（即三个星号）分隔各段落。各段落具体说明如下：

第1段（开头）：固定格式，第一行必须是：${frameLabel}，超高清8K画质，[项目风格]，${STRICT_NO_SUBTITLE_HEADER}。禁止在此行前或后加任何其他文字。

${sceneSectionFormat}

第3段（人物/生物/道具）：参考图片X中各角色身份硬锁，每个角色占一行或多行。参考图已提交时采用压缩句式：人类/类人角色写身份硬锁、当前状态、本镜任务；怪兽/异兽/敌方生物写身份硬锁、主体形态硬锁、本镜攻击/受损变化；道具写道具外观硬锁、当前持有人/状态/变化。只有缺少可靠参考图或特征容易丢失时才补完整外观长段。

第4段（景别+运镜概述）：用 → 箭头按时间顺序串联每段运镜关键词，末尾写整体节奏总结。格式如：开场俯拍全景→快速推近至中景→切换仰拍→跟拍落幅定格，全程紧张递进节奏

第5段（时间段）：每个时间段严格用三个 ｜ 分隔为3个字段：
- 字段1：景别+运镜+特效标注（如：俯拍全景快速推进至中景，画面同步震颤抖动）
- 字段2：空间位置+朝向+动作描述+说话+台词（如：角色A居中面朝镜头偏右，抬手挡住前方压力，嘴唇微张开口说话："台词"）
- 字段3：声音标注（格式：音效：动作音效+环境音；BGM：情绪曲线；对白表演：语气/音量/语速/呼吸停顿；如：音效：圣光碰撞炸裂声、羽翼震颤声；BGM：低频鼓点骤强；对白表演：无对白）

**⚠️ 朝向描写硬约束（视频生成方向一致性核心）**：
每个时间段第2字段中，每个出场角色必须明确写出朝向，格式为"角色名(图片X)+空间位置+朝向"：
- 朝向词库：面朝镜头 / 背对镜头 / 左侧脸朝镜头 / 右侧脸朝镜头 / 面朝画面左侧 / 面朝画面右侧 / 侧面朝镜头 / 四分之三侧脸朝镜头 / 转身面朝XX
- 示例："角色A(图片2)居中偏左面朝镜头，角色B(图片3)画面右侧背对镜头偏右"
- 规则：①同一角色相邻时间段朝向变化必须有过渡描述（如"转身面朝"）②对话场景说话人必须面朝镜头或四分之三侧脸③人物段首次出现的朝向决定观众对该角色的方向认知

禁止将字段拆成多行。必须在一行内用 ｜ 分隔3个字段。旁白/心声格式为：角色名(图片X)内心独白（全程闭唇、无任何口型动作）："台词内容"

第6段（调色+光影）：写完整色调描述、光源描述、光效变化描述。

第7段（结尾）：固定为"${STRICT_NO_SUBTITLE_FOOTER}"，不得加任何其他说明文字。

标准输出示例（直接参照此格式生成，段落之间用 *** 分隔符分隔）：

***
${buildStrictNoSubtitleHeader(styleConfig, data.videoRatio)}
***
参考图片1是唯一场景空间母版，当前分镜的核心行动区、入口边界、主要障碍物、远端背景和可移动路线全部清晰可读，地面材质、墙面/背景层次、关键陈设、主光方向、环境补光和色调关系全程锁定参考图中的空间结构、材质、光线、色调和机位轴线
***
参考图片2中角色A身份硬锁，角色A的五官比例、脸型、发型、年龄感、体态比例、当前服装版本、标志性配饰和表演气质全程继承参考图，动作中保持同一身份不漂移
参考图片3中角色B身份硬锁，角色B的五官比例、脸型、发型、年龄感、体态比例、当前服装版本、手持道具或随身配饰全程继承参考图，动作中保持同一身份不漂移
参考图片4中角色C身份硬锁，角色C的五官比例、脸型、发型、年龄感、体态比例、当前服装版本、位置关系和情绪反应全程继承参考图，动作中保持同一身份不漂移
参考图片5中压力源角色身份硬锁，压力源角色的五官比例、脸型、发型、年龄感、体态比例、当前服装版本、手部动作和压迫状态全程继承参考图，动作中保持同一身份不漂移
***
开场3秒俯拍全景加速推进至中景→2秒快速推近至面部特写、焦点始终锁定角色A眼部→硬切转场1秒切换至对面压力源仰拍视角→1.5秒急推增强压迫感→3秒跟拍震颤快速拉回角色A落幅定格，全程短蓄快发节奏，运镜从宏观快速切入微观再硬切对立面，最终快速收束回主角
***
0–3秒｜3秒俯拍全景加速推进至中景，画面同步震颤抖动，镜头全程稳定无抖动｜角色A(图片2)居中面朝镜头偏右，角色B(图片3)居中偏左面朝镜头，角色C(图片4)居中偏右偏后面朝镜头，外部压力从四周向中心逼近，角色A(图片2)立刻向前一步抬手挡住冲击，三人位置关系清晰，压力扩散让地面尘粒和衣摆同步震动｜音效：外部冲击的低频轰鸣声、衣料震动声、地面细碎摩擦声
***
3–7秒｜2秒快速推近从中景至角色A面部近景特写，焦点始终锁定人物眼部｜角色A(图片2)居中面朝镜头，角色B(图片3)居中偏左偏后背对镜头，角色C(图片4)画面左侧偏后侧面朝镜头，第一轮冲击散去，角色A(图片2)仍挡在两人前方，手指极轻收紧，肩背稳住，发丝和衣摆被余波带动，瞳孔轻微收缩，视线牢牢锁定前方压力源方向，角色A(图片2)嘴唇微张开口说话："别再往前。"｜音效：风声渐弱、衣料摩擦声、远处人群或机械的低频压迫声
***
7–11秒｜硬切转场1秒切换至对面压力源视角，1.5秒仰拍急推增强压迫感，焦点硬切至压力源角色｜压力源角色(图片5)居中面朝镜头，身后跟随者或环境压力层层排列，压力源角色(图片5)站在最前方，瞳孔放大、喉结极细微滚动，抬起手中关键道具或发出明确指令，画面压力向角色A方向集中，压力源角色(图片5)嘴唇微张开口说话："最后一次，退开。"｜音效：能量或机械聚集的低频嗡鸣声、道具轻震声、远处人群或环境的整齐压迫声
***
11–15秒｜3秒跟拍震颤镜头从压力源方向快速拉回角色A视角，镜头轻微余震感，末段机位锁死落幅定格｜角色A(图片2)居中面朝镜头，角色B(图片3)居中偏左偏后侧面朝镜头，强烈外部压力从前方直直压向角色A(图片2)，地面细尘和空气纹理被推开，角色A(图片2)稳住重心，呼吸收得极轻，肩背稳而不动，手部动作准备正面承接，画面回归稳定，落幅定格在角色A(图片2)居中面朝镜头迎战的决绝姿态｜音效：压力逼近的尖锐破空声、环境低频共振声、地面细碎震动声，音效层层递进拉满紧张感
***
调色+光影：整体色调继承项目全局风格，主光来自场景中已定义的方向，环境补光服务人物脸部可读性，高光与阴影保持明确层次，角色A所在区域使用稳定轮廓光切割人物线条，压力源方向使用更强明暗对比制造压迫感，全程漫反射柔光补面保证面部无黑脸，电影级画面层次
***
${STRICT_NO_SUBTITLE_FOOTER}`;
}

// ============================================================
// 步骤4.4 带编排方案的 generate 用户侧消息模板（简化版）
// ============================================================

function buildGenerateWithChoreographyPrompt(data) {
  const { storyboard, sceneDetail, imageRefs, hasSceneReference, sceneReferenceLabel, styleConfig, isLastStoryboard, isFirstStoryboard, correctedScript, scriptText, choreography, prevLastFrameInfo, logicFixSummary, sceneBlueprint, propTracking, choreoCheckFailSummary, prevNarrativeSummary, itemTracker, nextStoryboardSummary, preprocessNotes, prevSpatialBlocking, sceneSpatialBible } = data;
  const resolvedSceneName = storyboard.scene || imageRefs.find((r) => r.type === 'scene')?.name || '未指定';
  const frameHeader = buildStrictNoSubtitleHeader(styleConfig, data.videoRatio);
  const frameAwareStyleConfig = buildFrameAwareStyleConfig(styleConfig, data.videoRatio);
  const sceneReferenceInstruction = hasSceneReference
    ? `场景段必须使用"${sceneReferenceLabel}是唯一场景空间母版"句式引用场景"${resolvedSceneName}"，锁定参考图中的空间结构、关键陈设、材质、光线、色调和机位轴线，禁止重新发挥。`
    : `当前分镜没有场景参考图，场景段必须直接围绕场景"${resolvedSceneName}"展开描述，禁止编造"参考图片1"或其他不存在的场景引用编号。`;
  const sceneSectionFormat = hasSceneReference
    ? `2. 场景段（${sceneReferenceLabel}是唯一场景空间母版）`
    : '2. 场景段（直接依据当前分镜场景设定，不引用不存在的场景参考图）';
  const imageRefText = imageRefs.map(formatImageReferenceLine).join('\n');
  const outfitRefNote = buildOutfitReferenceInstruction(imageRefs, '最终提示词写作时');
  const visualCharacterRefNote = buildVisualCharacterReferenceInstruction(imageRefs, '最终提示词写作时');
  const videoImageBudgetNote = buildVideoImageBudgetInstruction(imageRefs);
  const propRefs = imageRefs.filter((r) => r.type === 'prop');
  const propRefNote = buildPropReferenceInstruction(propRefs, '最终提示词写作时');
  const seedanceRefRoleNote = buildSeedanceReferenceRoleInstruction(imageRefs, '最终提示词写作时');
  const prevInfo = prevLastFrameInfo
    ? `\n\n## 上一分镜落幅画面信息（用于衔接）\n${prevLastFrameInfo}\n→ 请确保本分镜开场与上一分镜落幅之间视觉过渡自然\n→ ⚠️ 禁止使用"承接上一镜""续上一镜"等模糊引用词，必须将上一分镜落幅的具体状态（肢体位置、道具持有、朝向）显式重写为本分镜开场描述的一部分`
    : '';
  const lastNote = isLastStoryboard
    ? '\n\n## ⚠️ 末镜特殊处理\n这是本集最后一个分镜。落幅定格需要特别设计：普通集加"画面渐黑"或"画面缓缓暗下"，卡点集停在最强张力点不加渐黑。'
    : '';
  const firstNote = isFirstStoryboard
    ? '\n\n## ⚠️ 首镜特殊处理\n这是本集第一个分镜。前3-5秒必须是钩子——冲突前置/悬念开场/视觉冲击开场。\n⚠️ 这是首镜，无上一分镜，禁止使用"承接上一镜""续上一镜"等引用词。'
    : '';
  const sceneDetailText = sceneDetail
    ? `（时间段：${sceneDetail.timeOfDay || '未指定'}，环境：${sceneDetail.environment || '未指定'}，色调：${sceneDetail.colorTone || '未指定'}）`
    : '';

  const sceneBlueprintInfo = sceneBlueprint
      ? `\n\n## 场景蓝图（供最终提示词写作参考，帮助理解编排方案的导演意图）\n- 场景类型：${sceneBlueprint.sceneType || '未指定'}${sceneBlueprint.combatSubType ? `\n- 打斗子类型：${sceneBlueprint.combatSubType}` : ''}\n- 打斗类型：${sceneBlueprint.combatType || '无'}\n- 强度等级：${sceneBlueprint.intensity || '中'}\n- 情绪弧线：${sceneBlueprint.emotionArc || '未指定'}${sceneBlueprint.soundDesign ? `\n- 声音设计：${sceneBlueprint.soundDesign}` : ''}${sceneBlueprint.bgmMood ? `\n- BGM情绪：${sceneBlueprint.bgmMood}` : ''}${sceneBlueprint.dialoguePerformance ? `\n- 对白表演：${sceneBlueprint.dialoguePerformance}` : ''}`
    : '';

  const creativeAnalysisInfo = preprocessNotes
    ? `\n\n## 第一轮导演创作分析（必须吸收进最终提示词）\n${preprocessNotes}\n→ 这些建议用于控制运镜节奏、情绪曲线、镜头密度和落幅设计；如与动作编排方案冲突，以修正后编排方案为准，但不得完全丢弃其导演意图。`
    : '';
  const finalPromptPriorityInfo = `\n\n## 信息优先级（发生冲突时按顺序裁决）
1. 修正后剧本 / 原始剧本明确事实：剧情事件、人物关系、台词来源、声音通道。
2. 图片引用分配与变装/道具参考图：人物身份、服装版本、道具外观、场景参考编号；不得用剧本文字覆盖参考图。
3. 动作编排方案 JSON：时间段、站位、朝向、动作骨架、运镜、音效、BGM、对白表演。
4. 编排检查修复意见与跨分镜上下文：上一镜衔接、下一镜边界、道具/肢体状态。
5. 第一轮导演创作分析：节奏、情绪、镜头密度和落幅意图。
6. 风格质感补写：只做增强，不改事实、服装、道具、站位或台词。`;
  const executablePromptRules = buildExecutableShortDramaPromptRules();

  const choreographyText = JSON.stringify(choreography, null, 2);

  const scriptSection = correctedScript
    ? `## 当前分镜修正后剧本（剧情事实、台词、人物状态的主要来源；外貌/服装/变装以图片引用为准）\n${correctedScript}\n\n## 当前分镜原始剧本片段（补充上下文，如与修正后剧本冲突，以修正后剧本为准）\n${scriptText}`
    : `## 当前分镜原始剧本片段\n${scriptText}`;

  const logicFixSection = logicFixSummary
    ? `\n\n## 逻辑修正记录（已体现在修正后剧本中，此处供参考）\n${logicFixSummary}`
    : '';

  const propTrackingInfo = propTracking && propTracking.length > 0
    ? `\n\n## 道具/物品一致性追踪（格式化时必须确保道具引用与以下清单一致）\n${propTracking.map(p =>
        `- **${p.propName}**${p.trackingId ? ` [ID=${p.trackingId}]` : ''}：外观="${p.appearanceDesc || '未描述'}"，持有者=${p.holder || '未指定'}，分镜范围=${p.storyboardRange || '未指定'}，状态变化=${p.stateChanges || '无'}，需追踪=${p.needsTracking === false ? '否' : '是'}，需参考图=${p.needsImage ? '是' : '否'}`
      ).join('\n')}\n请在人物段和时间段中严格遵循此清单的道具持有者和状态。`
    : '';
  const trackerInfo = itemTracker
    ? `\n\n## 当前物品状态快照（格式化时必须保持一致）\n${typeof itemTracker === 'string' && itemTracker.includes(';')
        ? itemTracker.split(';').filter(Boolean).map(entry => `- ${entry.trim()}`).join('\n')
        : typeof itemTracker === 'string'
        ? itemTracker
        : Object.entries(itemTracker).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : '';
  const spatialContinuityInfo = buildSpatialContinuityContext(prevSpatialBlocking, sceneSpatialBible, '最终提示词生成');

  return `请基于以下动作编排方案，写成可直接提交给视频模型的高精度视频提示词。

⚠️ 格式硬提醒：你的输出必须是纯文本+***分隔，绝对禁止使用#标题或章节式结构！

## 当前分镜信息
- 编号：分镜${String(storyboard.number).padStart(2, '0')}
- 名称：${storyboard.name}
- 所属场景：${resolvedSceneName}${sceneDetailText}
- 时长：${storyboard.duration}
- 景别：${storyboard.shotSize}
- 出场角色：${storyboard.characters.join('、')}

## 图片引用分配（必须严格使用）
${imageRefText}

**重要**：${sceneReferenceInstruction}人物/生物段必须使用"参考图片X中角色名身份硬锁"句式引用各角色；参考图负责人类/类人角色的五官、脸型、发型、服装、配饰一致性，以及怪兽/异兽/敌方生物的主体形态一致性；文字只补当前状态、本镜任务、攻击/受损变化和易丢失锚点。不得把怪兽写成“五官脸型发型服饰配饰全程继承参考图”。如有物品/道具参考图，在持有该物品的角色描述中用"参考图片N中XX道具外观硬锁"句式引用，时间段中用(图片N)标注物品出现；参考图负责外观一致性，文字只补当前持有人、位置、状态和变化，不得变色、变形、消失、替换。不得把命中变装的分镜回退到基础服装参考图。${seedanceRefRoleNote}${videoImageBudgetNote}${outfitRefNote}${visualCharacterRefNote}${finalPromptPriorityInfo}${executablePromptRules}

## 声音表演与BGM设计（必须写入每个时间段第3字段）
- 字段3统一格式：音效：动作音效+环境音；BGM：情绪曲线；对白表演：语气/音量/语速/呼吸停顿/口型节拍。
- 优先继承 choreography.timeSegments[].sound、bgm、dialoguePerformance；缺失时根据场景蓝图 soundDesign / bgmMood / dialoguePerformance 自动补足。
- 有对白时，必须写明说话情绪、音量、语速、句前呼吸或停顿、句后反应；BGM在对白出现时压低，不盖过人声。没有对白时，也必须写环境底噪和BGM状态。

**⚠️ 朝向描写硬约束（视频方向一致性核心）**：
编排方案中每个角色的 facing 字段必须原样映射到时间段第2字段的朝向描写。格式："角色名(图片X)+空间位置+朝向"。朝向词库：面朝镜头/背对镜头/左侧脸朝镜头/右侧脸朝镜头/四分之三侧脸朝镜头/面朝画面左侧/面朝画面右侧。同一角色相邻时间段朝向变化必须有过渡描述。对话场景说话人必须面朝镜头或四分之三侧脸。当角色朝向与上一时间段相同时，直接写明朝向，禁止使用"转为""转向""变为"等暗示变化的词汇。${prevInfo}${spatialContinuityInfo}${propRefNote}${firstNote}${lastNote}${sceneBlueprintInfo}${creativeAnalysisInfo}${propTrackingInfo}${trackerInfo}${prevNarrativeSummary ? `\n\n## ⚠️ 前序分镜叙事上下文（必须确保本分镜与前面剧情连贯）\n${prevNarrativeSummary}\n→ 本分镜开场必须与前序分镜的落幅状态视觉衔接\n→ 角色情绪/动作必须从前序分镜的状态自然过渡，禁止突兀跳变\n→ 场景/道具/服装状态必须与前序分镜保持一致` : ''}${nextStoryboardSummary ? `\n\n## 下一分镜摘要（边界约束）\n${nextStoryboardSummary}\n→ 当前分镜最终提示词不得提前表现下一分镜的核心事件、信息揭示或情绪高潮` : ''}

## 声音归属保持规则（硬约束）
- 源片段中标为“内心OS（角色）”的内容，后续必须按闭唇心声处理，禁止改写成世界观旁白
- 源片段中标为“系统播报（系统）”的内容，后续必须保持为系统声音/系统提示，不得改写成上帝视角解说
- 只有源片段明确为“世界观旁白”时，才允许输出外部解说式旁白
- 每句对白、内心OS、系统播报、旁白都必须在引号后标注独立音轨秒数，例如“台词”（对白音轨：3–5.2秒）。音轨秒数必须落在该行视觉时间段内；同一视觉时间段内多句语音必须拆成连续、不重叠的小音轨。
- 角色对白要带表演方向：语气、音量、语速、句前呼吸/停顿、句后反应；内心OS必须闭唇，用呼吸、心跳、环境低频或BGM承托。

${STRICT_NO_SUBTITLE_RULE}

${SEEDANCE_2_PROMPT_RULES}

${AUDIO_PERFORMANCE_RULES}

## 项目风格配置
${frameAwareStyleConfig}

${scriptSection}${logicFixSection}${choreoCheckFailSummary ? `\n\n## ⚠️ 编排检查发现的问题（最终写作时必须修正）\n${choreoCheckFailSummary}\n请在最终提示词中直接修正以上问题，不要保留或复现错误表述。` : ''}

---

## 动作编排方案（已由专业导演设计，请严格按此方案生成提示词）

以下是 JSON 格式的动作编排方案。你的任务是在不改变剧情事实、人物关系、道具归属、站位朝向和台词来源的前提下，将它写成高密度、可执行、适合视频模型理解的最终提示词。
- 从 timeSegments 中提取运镜、动作、音效、BGM、对白表演 → 填入时间段字段；第3字段必须同时包含“音效：...；BGM：...；对白表演：...”
- 从 actions 中提取角色位置和动作描述 → 填入时间段第2字段
- 从 cameraOverview → 景别+运镜概述段
- 从 lightNotes + colorGrading → 调色+光影段
- 人物/生物身份、情绪和状态从剧本提取；参考图已提交时，图片负责五官/服装/主体形态/道具外观的一致性，文字只写身份硬锁、当前状态、本镜任务和变化；首次出现使用"参考图片X中角色名身份硬锁"句式建立关联；道具使用"参考图片N中道具名道具外观硬锁"
- startBlocking 必须映射到第一个时间段开场站位；endBlocking 必须映射到最后一个时间段落幅定格。若 timeSegments 与 startBlocking/endBlocking 冲突，以 startBlocking/endBlocking 为准，并在动作描述里补出过渡。

\`\`\`json
${choreographyText}
\`\`\`

---

## 输出格式（严格遵循）

7个段落，用 *** 分隔符分隔：

1. ${frameHeader}
${sceneSectionFormat}
3. 人物/生物/道具段（每个角色首次使用"参考图片X中角色名身份硬锁"句式 + 当前状态/本镜任务/变化；道具使用"参考图片N中道具名道具外观硬锁"）
4. 景别+运镜概述（→箭头串联 + 节奏总结）
5. 时间段（每段：景别+运镜+特效｜空间位置+动作+台词+每句语音音轨秒数｜音效：动作音效+环境音；BGM：情绪曲线；对白表演：语气/语速/呼吸停顿）
6. 调色+光影
7. ${STRICT_NO_SUBTITLE_FOOTER}`;
}

// ============================================================
// 步骤4.3 动作编排(choreograph) - 根据场景类型走不同专业路径

module.exports = {
  buildGenerateUserPrompt,
  buildGenerateWithChoreographyPrompt,
  buildOfficialVirtualHumanGenerateSystemPrompt,
  buildOfficialVirtualHumanGenerateUserPrompt,
};
