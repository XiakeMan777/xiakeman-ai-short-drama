// ============================================================
// Step4 检查与修正模板
// 从 ../templates.js 拆分出的模板模块；请保持 prompt 文案等价。
// ============================================================

const {
  applyFrameDirectorRules,
  buildSpatialContinuityContext,
} = require('./shared-frame');

// ============================================================

const CHECK_SYSTEM_PROMPT = `# 身份定义
你是一位专业的{frameProductionLabel}剧本执行诊断专家。你的唯一任务是发现剧本中的逻辑矛盾和连续性错误，并把当前分镜压缩成后续视频模型能执行的主动作骨架。

## 工作原则
1. **只检查不改写**：你的任务是发现问题和提供建议，绝对不要输出修正后的剧本文本
2. **修正有据**：仅当剧本存在逻辑矛盾时才记录，不修正无矛盾的原文
3. **先减法后建议**：先提取“本镜唯一主推进、主动作链、前景角色、关键道具策略”，再给运镜和情绪建议；不要一开始堆镜头术语
4. **不生成提示词**：绝对不要输出视频提示词、场景描述、角色外貌描述等生成内容
5. **爽点词要翻译**：分镜名或剧本里的“甩脸/砸脸/逼脸/压脸/打脸/逼跪/甩出/砸下/递近”等是观众感受词，不是整镜持续动作。检查阶段必须判断它应如何翻译成短暂可见动作，并提醒后续不要把它持续化

{frameDirectorRules}

以上画幅规则只用于判断主动作链、固定站位、运镜建议和场景蓝图，不得扩写成最终视频提示词。

## 逻辑错误检查清单

| 错误类型 | 检查要点 |
|----------|----------|
| 物品分身 | 同一物品同时出现在两个位置？物品放下后又出现？ |
| 物品瞬移 | 上段在左手，下段突然在右手无过渡？ |
| 角色分身 | 同一角色同时出现在两个位置无移动描述？ |
| 状态回退 | 衣服已湿又变干？门已关又开？ |
| 空间穿帮 | 门关着角色却走出？室内突然到室外？ |
| 时间倒流 | 时间顺序矛盾？ |
| 动作矛盾 | "双手握剑"同时"单手扶栏"？ |
| 视角混乱 | 同一段既有背后看又有正面表情？ |
| 跨分镜连续性 | 与上一分镜的物品状态是否连贯？ |
| 空间逻辑未锁定 | 镜头切换时人物站位是否锚定？是否有机位乱跳风险？ |
| 情绪表达不可画面化 | 剧本是否用了纯抽象情绪词（如"悲伤""紧张"）而未提供可执行的微动作/运镜线索？ |
| 内心独白缺闭唇标记 | 不开口的内心戏是否标注了闭唇约束？ |
| 运镜缺量化参数 | 运镜描述是否只有方向（"推近"）而无速度/幅度/机位稳定性？ |
| 人物特征一致性 | 同一角色在不同位置描述中外貌是否一致（五官、脸型、发型、配饰、服饰款式/颜色/面料）？是否存在面部变形、服饰穿模、特征丢失？ |
| 对话合理性 | 角色在极限对抗/被压制/重伤状态下是否说了超过14字的长台词？极限状态下最多1句短句（≤14字），长对话应改为内心独白 |
| 爽点持续化风险 | 剧本标题或动作词是否可能被误解为整镜持续动作？例如证据/文书/布帛/武器/道具甩到脸前，只应是0.5-1秒钩子，后续应退出前景 |
| 主次失衡风险 | 是否把所有出场角色都当成前景角色？是否需要把旁观者、群演、配角压缩为背景压力 |
| 站位漂移风险 | 是否缺少固定空间轴线、前后左右关系和角色换位过渡，导致后续每段重新摆拍 |

## 场景类型判断补充
- “传旨、审判、赐死、退婚、羞辱、逼迫、威胁、证据甩出、文件拍桌、道具递近”等主要是权力压迫/对白对峙，默认归为 dialogue，除非剧本明确发生拳脚、兵器、法术或身体伤害攻防。
- 不要因为出现“白绫、刀、剑、药、证据、圣旨、合同”等威胁道具，就自动判为 combat。道具制造威胁不等于打斗。
- dialogue 场景也可以是 high 强度，但 high 只代表压迫强，不代表要加入打斗式升格、冲击波、环境破坏或过多动作。

## 输出纪律
1. 只输出修正记录、创作分析建议、物品状态更新和场景蓝图
2. 绝对不要输出修正后的剧本文本（那是下一步的事）
3. 绝对不要输出视频提示词内容
4. 即使没有发现逻辑问题，也必须按四个部分完整输出；第一部分固定输出"【分镜XX 逻辑检查通过，无需修正】"
5. 在创作分析建议中，必须先输出主动作链、钩子动作翻译、前景/背景角色划分、固定站位和道具策略；运镜建议必须服务这些骨架，不要堆砌术语
6. 第三部分物品状态更新和第四部分场景蓝图始终必须输出，这是后续动作编排步骤的核心输入`;

function buildCheckSystemPrompt(videoRatio) {
  return applyFrameDirectorRules(CHECK_SYSTEM_PROMPT, videoRatio);
}

// ============================================================
// 步骤4.2 修正(correct) system prompt — 根据检查结果改写剧本片段
// ============================================================

const CORRECT_SYSTEM_PROMPT = `# 身份定义
你是一位专业的竖屏短剧剧本修正专家。你的唯一任务是根据逻辑检查结果，修正剧本片段中的矛盾，同时保持剧情走向和台词保真。

## 核心原则

### 保真优先（最高优先级）
1. **剧情走向不变**：不得改变原始剧情的走向、因果关系、角色动机
2. **台词一字不改**：所有角色台词（引号内内容）必须原样保留，不得修改、删除、添加
3. **不编造内容**：不得添加原文没有的剧情、对话、角色、动作或事件
4. **只修矛盾**：仅修改存在逻辑矛盾的部分，无矛盾的原文一字不差保留

### 修正原则
1. **最小改动**：只改矛盾处，尽量保持原文语气和用词习惯
2. **改动作不改台词**：如果矛盾涉及台词和动作，保留台词，修改动作描述
3. **保持连贯**：修正后要确保与前序分镜和物品状态一致

## 输出纪律
1. 必须输出两个部分：
   - 第一部分：修正后的完整剧本片段
   - 第二部分：根据修正后剧本更新的场景蓝图 JSON
2. 如果没有修正项，也必须原样输出原始剧本片段，并输出修正后的场景蓝图
3. 不得输出视频提示词内容
4. 保持原始剧本的段落结构和格式`;

function buildCheckUserPrompt(data) {
  const { storyboard, scriptText, prevLastFrameInfo, itemTracker, isLastStoryboard, isFirstStoryboard, prevLogicFixSummary, propTracking, nextStoryboardSummary, prevSpatialBlocking, sceneSpatialBible } = data;
  const prevInfo = prevLastFrameInfo
    ? `\n\n## 上一分镜落幅画面信息\n${prevLastFrameInfo}`
    : '';
  const trackerInfo = itemTracker
    ? `\n\n## 跨分镜物品当前状态\n${typeof itemTracker === 'string' && itemTracker.includes(';')
        ? itemTracker.split(';').filter(Boolean).map(entry => `- ${entry.trim()}`).join('\n')
        : typeof itemTracker === 'string'
        ? itemTracker
        : Object.entries(itemTracker).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : '';
  const lastNote = isLastStoryboard
    ? '\n\n## ⚠️ 注意：这是本集最后一个分镜！\n分析结尾悬念设计：原始剧本设计了什么悬念/张力点？建议用哪种运镜来表现？判断是普通集结尾（加渐黑）还是卡点集结尾（停在张力点）。'
    : '';
  const firstNote = isFirstStoryboard
    ? '\n\n## ⚠️ 注意：这是本集第一个分镜！\n分析开头钩子设计：原始剧本是否已设计了冲突前置/悬念开场？如果有，如何在运镜中强化？如果没有，建议用运镜制造黄金3秒钩子。前3-5秒必须建立注意力。'
    : '';
  const prevFixesInfo = prevLogicFixSummary
    ? `\n\n${prevLogicFixSummary}`
    : '';
  const propTrackingInfo = propTracking && propTracking.length > 0
    ? `\n\n## 道具/物品一致性追踪清单（检查物品分身/瞬移/状态矛盾时必须参考）\n${propTracking.map(p =>
        `- **${p.propName}**${p.trackingId ? ` [ID=${p.trackingId}]` : ''}：外观="${p.appearanceDesc || '未描述'}"，持有者=${p.holder || '未指定'}，分镜范围=${p.storyboardRange || '未指定'}，状态变化=${p.stateChanges || '无'}`
      ).join('\n')}\n请特别检查：①道具是否在同一时间出现在两个不同位置（物品分身）②道具持有者切换是否有过渡描述（物品瞬移）③道具状态是否与stateChanges描述矛盾`
    : '';
  const spatialContinuityInfo = buildSpatialContinuityContext(prevSpatialBlocking, sceneSpatialBible, '逻辑检查');
  const sbNum = String(storyboard.number).padStart(2, '0');

  return `请对以下分镜进行**逻辑检查和创作分析**，输出修正记录和创作建议。

## 当前处理分镜
- 分镜编号：${storyboard.number}
- 分镜名称：${storyboard.name}
- 时长：${storyboard.duration}
- 景别：${storyboard.shotSize}
- 出场角色：${storyboard.characters.join('、')}${prevInfo}${trackerInfo}${propTrackingInfo}${spatialContinuityInfo}${prevFixesInfo}${firstNote}${lastNote}

## 该分镜的原始剧本片段（唯一主源）
请只围绕以下片段进行逻辑检查与创作分析，不要擅自吸收其他分镜的剧情内容。

**重要**：如果前序分镜已有逻辑修正，请确保本分镜的检查与修正结果保持一致，不要产生矛盾。

---

## 当前分镜剧本片段：
${scriptText}

${nextStoryboardSummary ? `---

## 下一分镜摘要（边界约束）
${nextStoryboardSummary}
→ 当前分镜不得提前吞并下一分镜的核心信息或高潮点` : ''}

---

## 输出格式（严格按以下四个部分输出）

### 第一部分：逻辑修正

如果没有发现任何逻辑问题，输出：
\`\`\`
【分镜${sbNum} 逻辑检查通过，无需修正】
\`\`\`
并继续完整输出第二部分创作分析建议、第三部分物品状态更新、第四部分场景蓝图。

如果有问题，对每个问题输出：
\`\`\`
【分镜${sbNum} 逻辑修正记录】
- 原剧本矛盾：[具体描述，需包含原文中的矛盾文本]
- 修正为：[修正后内容]
- 原因：[为什么这样修正]
\`\`\`

### 第二部分：创作分析建议

请分析该分镜的以下维度，为后续提示词生成提供指导：

\`\`\`
【执行诊断】
主推进：[本镜唯一要推进的戏剧问题，用一句话说明]
主动作链：[按时间顺序写3-5个动作节点，只写可拍动作，不写抽象爽点词]
钩子动作翻译：[如果标题/剧本有“甩脸/砸脸/逼脸/打脸/逼跪/甩出/递近”等爽点词，说明它是0.5-1秒瞬时动作，后续如何退出前景；如果没有，写“无特殊爽点词翻译需求”]
前景角色：[最多3个，说明谁承担主动作/说话/关键反应]
背景角色：[其余角色如何背景化为围压、旁观、收静、后退或画外声音]
固定站位：[锁定观众视角、左右前后关系；说明哪些角色不得换边或越过前景]
道具策略：[本镜最多1个前景关键道具；说明关键道具何时出现、何时退出/垂落/收回；普通道具文字化]

【运镜建议】
[根据主动作链建议2-4段运镜，只服务主推进。${isFirstStoryboard ? '特别注意：首镜前3-5秒必须是钩子，但钩子动作要短暂完成，不能整镜持续占画面。' : ''}${isLastStoryboard ? '特别注意：末镜落幅需要留悬念，运镜要配合结尾张力。' : ''}]

【情绪走向】
[该分镜的情绪变化曲线。如：警觉→愤怒→决绝，中段为情绪转折点]

【节奏建议】
[该分镜的整体节奏感。必须写清“瞬时钩子→反应→压迫升级→落幅”的接力，避免把每个小动作都升级成独立关键时刻]
\`\`\`

### 第三部分：物品状态快照

输出修正后的物品状态快照（用于传递给下一分镜）：
\`\`\`
【物品状态更新】
物品名：当前最终状态位置/持有者
\`\`\`

### 第四部分：场景蓝图（⚠️ 必须输出，这是后续动作编排的核心输入）

请根据剧本内容分析该分镜的场景类型和编排方向，输出一个 JSON 对象。分析维度：

1. **sceneType**（必填）：该分镜的主要场景类型
   - \`combat\`：包含武打/战斗/法术对攻/肢体冲突等物理对抗
   - \`dialogue\`：以角色对话为主，辅以表情反应和站位变化
   - \`emotional\`：以内心独白/情绪爆发/回忆闪回等心理活动为主
   - \`transition\`：以场景转换/时间流逝/空间移动为主
   - ⚠️ 权力压迫、传旨、审判、赐死、退婚、羞辱、证据甩出、文书拍桌、道具递近，默认归为 \`dialogue\`，除非剧本明确发生拳脚/兵器/法术攻防。不要因为出现威胁道具就判为 combat。

2. **combatSubType**（仅 combat 类型必填，决定编排子路径）：
   - \`active\`：双方均有攻防交换的主动打斗（你来我往）
   - \`suppressed\`：一方完全被压制/被动承受，无还手机会（如被按在墙上、被踩在地上、被钳制无法动弹）。⚠️ 此子类型必须使用"压迫递增→临界闪避→反击蓄势→定格悬念"的4拍结构，而非标准打斗的"蓄势→交锋→高潮→收束"
   - \`ambush\`：一方突袭/偷袭，另一方毫无防备

2. **combatType**（仅 combat 类型必填）：
   - \`melee\`：近身格斗（拳脚/擒拿）
   - \`weapon\`：冷兵器对战（剑/刀/枪等）
   - \`magic\`：法术/超能力对攻
   - \`mixed\`：混合型（如法术+近身）

3. **intensity**（必填）：场景强度等级
   - \`low\`：平静/日常/从容
   - \`medium\`：中等紧张度
   - \`high\`：激烈/紧张/快节奏
   - \`extreme\`：极致爆发/高潮/生死

4. **emotionArc**（建议填写）：情绪弧线，如"警觉→愤怒→决绝"

5. **keyMoments**（建议填写）：关键时刻列表，每个包含 timeRange 和 moment
   - 例：[{ "timeRange": "0-3秒", "moment": "蓄势：双方对峙，气氛凝固" }]
   - 只列2-4个关键时刻，必须来自“主动作链”。如果有爽点词，moment 必须写成“短暂掠近/砸下/拍出后退出前景”，禁止写成持续遮挡、持续贴脸、持续拉扯。

6. **cameraStyle**（建议填写）：推荐运镜风格
   - \`static\`：固定/微动，适合对话/情绪
   - \`dynamic\`：快速切换/跟拍，适合战斗
   - \`handheld\`：手持晃动，适合紧张/混乱
   - \`crane\`：摇臂/航拍，适合大场面/史诗感

7. **suggestedCuts**（建议填写）：建议时间段数量（通常2-5）

8. **needsSlowMotion**（建议填写）：是否需要升格慢动作（boolean）
   - dialogue/权力压迫场景默认 false；只有真实撞击、受伤、武器碰撞等物理冲击才建议 true。

9. **slowMotionMoments**（条件填写）：需要升格的具体时刻描述（string[]）

10. **soundDesign**（建议填写）：声音设计方向，必须同时包含动作音效、环境底噪、对白表演情绪和BGM曲线，如"动作音效=金属碰撞+破空；环境音=风声+人群低呼；对白表演=压低声线、短促呼吸；BGM=低频铺底→撞击点骤强→尾音收束"

11. **bgmMood**（建议填写）：BGM情绪方向，如"低频压迫、鼓点渐强、对白时压低、结尾悬停"

12. **dialoguePerformance**（建议填写）：对白表演方向，如"语气克制发冷、语速中快、句前短吸气、句后留0.4秒反应"

\`\`\`
【场景蓝图】
\`\`\`json
{
  "sceneType": "combat",
  "combatSubType": "active",
  "combatType": "weapon",
  "intensity": "high",
  "emotionArc": "蓄势→交锋→爆发→收束",
  "keyMoments": [
    { "timeRange": "0-3秒", "moment": "对峙蓄势" },
    { "timeRange": "7-10秒", "moment": "全力交锋高潮" }
  ],
  "cameraStyle": "dynamic",
  "suggestedCuts": 4,
  "needsSlowMotion": true,
  "slowMotionMoments": ["武器碰撞瞬间", "收招定格"],
  "soundDesign": "动作音效=金属碰撞声+破空声；环境音=风声+叛军低呼；对白表演=压低声线、短促呼吸；BGM=低频铺底→撞击点骤强→尾音收束",
  "bgmMood": "低频压迫、鼓点渐强、对白时压低、结尾悬停",
  "dialoguePerformance": "语气克制发冷、语速中快、句前短吸气、句后留0.4秒反应"
}
\`\`\`
\`\`\`

**判断要点**：
- 如果剧本中有任何形式的物理对抗（包括法术攻击），都应标为 combat
- 如果一段既有对话又有战斗，以占比更大或戏剧重心所在的一方为准
- 情绪弧线要与剧本内容一致，不要编造不存在的情绪转折`;
}

// ============================================================
// 步骤4.2 修正用户侧消息模板
// ============================================================

function buildCorrectUserPrompt(data) {
  const { storyboard, scriptText, logicFixes, isFirstStoryboard, isLastStoryboard, itemTracker, propTracking, prevNarrativeSummary, prevLogicFixSummary, sceneBlueprint, nextStoryboardSummary } = data;
  const sbNum = String(storyboard.number).padStart(2, '0');
  const hasFixes = logicFixes && logicFixes.length > 0;

  const fixList = hasFixes
    ? logicFixes.map((f, i) =>
        `${i + 1}. 原剧本矛盾：${f.originalIssue}\n   修正为：${f.correction}\n   原因：${f.reason}`
      ).join('\n\n')
    : '';

  const positionNote = isFirstStoryboard
    ? '\n\n**首镜注意**：这是本集第一个分镜，确保开头钩子的动作描述清晰有力。'
    : isLastStoryboard
    ? '\n\n**末镜注意**：这是本集最后一个分镜，确保结尾悬念的动作描述到位。'
    : '';

  const trackerInfo = itemTracker
    ? `\n\n## 跨分镜物品当前状态\n${typeof itemTracker === 'string' && itemTracker.includes(';')
        ? itemTracker.split(';').filter(Boolean).map(entry => `- ${entry.trim()}`).join('\n')
        : typeof itemTracker === 'string'
        ? itemTracker
        : Object.entries(itemTracker).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : '';

  const propTrackingInfo = propTracking && propTracking.length > 0
    ? `\n\n## 道具/物品一致性追踪清单（修正时必须保持道具状态一致）\n${propTracking.map(p =>
        `- **${p.propName}**${p.trackingId ? ` [ID=${p.trackingId}]` : ''}：外观="${p.appearanceDesc || '未描述'}"，持有者=${p.holder || '未指定'}，分镜范围=${p.storyboardRange || '未指定'}，状态变化=${p.stateChanges || '无'}`
      ).join('\n')}\n请确保修正后的剧本中：①道具持有者与追踪清单一致 ②道具不会同时出现在两个不同位置 ③道具状态变化与清单描述一致`
    : '';

  const sceneBlueprintInfo = sceneBlueprint
    ? `\n\n## 当前场景蓝图（如修正后的剧本已改变场景性质，必须同步更新）\n${JSON.stringify(sceneBlueprint, null, 2)}`
    : '';
  const noFixRewriteRule = hasFixes
    ? '存在逻辑修正项时，只改修正项对应的矛盾句；第一轮【执行诊断】、场景蓝图和创作分析只用于更新【修正后场景蓝图】，禁止写回【修正后剧本】。'
    : '当前逻辑检查通过，无需修正；【修正后剧本】必须逐字复制原始剧本片段，不得优化措辞、不得替换标题/爽点词、不得把第一轮【执行诊断】里的视频执行动作写回剧本。';

  return `请根据逻辑检查结果，修正以下分镜的剧本片段。

## 分镜信息
- 编号：分镜${sbNum}
- 名称：${storyboard.name}

## 逻辑修正项
${hasFixes ? fixList : '【逻辑检查通过，无需修正】'}${positionNote}${trackerInfo}${propTrackingInfo}${prevNarrativeSummary ? `\n\n## 前序分镜叙事上下文（修正时确保与前面剧情连贯）\n${prevNarrativeSummary}\n→ 修正后的剧本片段必须与前序分镜的剧情发展保持一致\n→ 角色状态/情绪必须从前序分镜自然延续` : ''}${prevLogicFixSummary ? `\n\n## 前序分镜逻辑修正记录（请保持一致）\n${prevLogicFixSummary}` : ''}

## 当前分镜原始剧本片段（唯一主源，请仅修正这一镜）
${scriptText}

${nextStoryboardSummary ? `## 下一分镜摘要（边界约束）
${nextStoryboardSummary}
→ 修正当前分镜时，不得提前把下一分镜的核心剧情、信息揭示或转折写入本镜` : ''}

---

## 输出要求

1. 只围绕“当前分镜原始剧本片段”进行修正
2. 应用上述修正项到该分镜片段中；${noFixRewriteRule}
3. 如果无需修正，必须原样输出该分镜的原始剧本片段，包含标题、职责、时间轴、对白、标点和换行；禁止做视频化改写
4. 输出必须严格包含以下两个部分，禁止额外解释：

【修正后剧本】
[修正后的完整剧本片段]

【修正后场景蓝图】


{
  "sceneType": "combat | dialogue | emotional | transition",
  "combatSubType": "active | suppressed | ambush（仅combat时填写）",
  "combatType": "melee | weapon | magic | mixed（仅combat时填写）",
  "intensity": "low | medium | high | extreme",
  "emotionArc": "情绪弧线",
  "cameraStyle": "static | dynamic | handheld | crane",
  "suggestedCuts": 3,
  "needsSlowMotion": false,
  "slowMotionMoments": [],
  "soundDesign": "动作音效+环境音+对白表演+BGM曲线",
  "bgmMood": "BGM情绪方向",
  "dialoguePerformance": "对白表演方向"
}
5. **禁止输出空内容**：即使无需修正，也必须输出原样剧本片段和修正后蓝图，绝对不能输出空字符串
6. **对白格式保真**：如果原文台词行使用“对白：角色：“台词” / 内心OS（角色）：“台词” / 系统播报：“台词””格式，修正后必须保留同类前缀和引号格式。禁止把“对白：角色：“台词””改成“角色：台词”、禁止去掉“对白/内心OS/系统播报”标签，禁止把多句台词合并到一行。
7. **禁止新增台词和分析句**：【修正后剧本】里只能出现原始剧本已有台词。不得补写“接旨认罪”“体面走”“不好看了”等新对白；不得把逻辑解释写成剧本行，例如“赐白绫=留全尸”“这说明她已被赐死”。分析、因果解释只能体现在场景蓝图或完全不写，不能进入修正后剧本。
8. **执行诊断不得回写**：第一轮【执行诊断】中的“主动作链、钩子动作翻译、前景/背景角色、固定站位、道具策略”只服务后续动作编排和场景蓝图，不属于剧本文案修正。禁止把“短暂掠近后回弹低垂”“不要持续横挡脸”等视频执行语句替换原剧本里的“甩脸/砸脸/递近”等短剧表达。
9. **爽点词保留**：除非爽点词本身造成剧情逻辑矛盾，否则不得替换分镜名、爽点/压力点或原画面描述中的短剧表达；“爽点词翻译”属于后续 choreograph/generate 阶段，不属于 correct 阶段。

**再次强调**：
- 台词（引号内内容）一字不改
- 台词所在行的声音通道格式也要保留，尤其是“对白：”“内心OS：”“系统播报：”
- 【修正后剧本】不是分析笔记，禁止出现等号总结、括号解释、额外劝降台词、补写旁白
- 无逻辑修正项时，【修正后剧本】逐字保留原始片段，不能把执行诊断、运镜建议或场景蓝图改写进剧本
- 只修改存在逻辑矛盾的部分
- 保持原文的段落结构和语气
- 不要添加原文没有的内容${sceneBlueprintInfo}`;
}

// ============================================================
// 生成用户侧消息模板

module.exports = {
  buildCheckSystemPrompt,
  CORRECT_SYSTEM_PROMPT,
  buildCheckUserPrompt,
  buildCorrectUserPrompt,
};
