function compactText(value, maxLength = 180) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function stringifyCompact(value) {
  if (!value) return '无';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isShotPlanLandscape(data) {
  return data?.mode === 'shot-plan-landscape'
    || data?.mode === 'smart-shot-plan-landscape'
    || data?.boardPlan?.mode === 'shot-plan-landscape'
    || data?.boardPlan?.mode === 'smart-shot-plan-landscape'
    || data?.storyboard?.storyboardBoard?.selectedMode === 'shot-plan-landscape'
    || data?.storyboard?.storyboardBoard?.selectedMode === 'smart-shot-plan-landscape';
}

function getShotPlanPanelCount(data) {
  const panels = data?.boardPlan?.panels;
  if (Array.isArray(panels) && [6, 9, 12, 15].includes(panels.length)) return panels.length;
  return data?.mode === 'smart-shot-plan-landscape' || data?.boardPlan?.mode === 'smart-shot-plan-landscape' ? 9 : 15;
}

function getShotPlanFinalLabel(panelCount) {
  return `S${String(panelCount).padStart(2, '0')}`;
}

function mentionRef(refId) {
  const normalized = String(refId ?? '').trim();
  if (!normalized) return '@图片';
  const imageMatch = normalized.match(/图片\s*(\d+)/);
  if (imageMatch) return `@图片${imageMatch[1]}`;
  const bare = normalized.replace(/^@+/, '').replace(/^参考/, '').trim();
  return `@${bare}`;
}

function buildReferenceLabel(name, refId, fallbackName = '参考图') {
  const label = compactText(name, 80) || fallbackName;
  return `${label}【${mentionRef(refId)}】`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isNoFaceReference(reference) {
  return reference && reference.type === 'character' && !!reference.isNoFaceCharacterVisual;
}

function isOutfitReference(reference) {
  return reference && reference.type === 'character'
    && (
      reference.concept === 'landscape_outfit_turnaround'
      || reference.concept === 'portrait_outfit'
      || !!reference.variantKey
      || typeof reference.outfitSeq === 'number'
    );
}

function isZombieGroupReferenceName(name) {
  const normalized = String(name ?? '').toLowerCase();
  return /尸群|丧尸|僵尸|活尸|腐尸|尸潮|感染者|zombie|horde|undead/.test(normalized);
}

function isGroupReferenceName(name) {
  const normalized = String(name ?? '').toLowerCase();
  return isZombieGroupReferenceName(normalized)
    || /群像|群体|人群|群众|居民|员工群|员工们|crowd|group|cast/.test(normalized);
}

function buildShotPlanReferenceAliasLines(references, directorBoardRefId, panelCount = 15) {
  const finalLabel = getShotPlanFinalLabel(panelCount);
  const counters = { scene: 0, character: 0, prop: 0, other: 0 };
  const lines = [
    `${buildReferenceLabel('主导演板', directorBoardRefId)} = 主导演板，优先读取顶部 START FRAME、S01-${finalLabel} 画面路线、blocking、camera rhythm、声音节拍、转场和底部 END BEAT。`,
  ];

  for (const reference of references) {
    const label = buildReferenceLabel(reference.name, reference.refId);
    if (reference.type === 'scene') {
      counters.scene += 1;
      lines.push(`${label} = 场景锁定：${reference.name} 的 space、lighting、color、camera-axis 与空间结构。`);
      continue;
    }
    if (reference.type === 'character') {
      counters.character += 1;
      const referenceName = String(reference.name ?? '');
      const lowerName = referenceName.toLowerCase();
      const isMechanicalCharacter = /alva|robot|机器人|机械|机甲/.test(lowerName);
      const isZombieGroupCharacter = isZombieGroupReferenceName(referenceName);
      const isGroupCharacter = isGroupReferenceName(referenceName);
      if (isNoFaceReference(reference)) {
        lines.push(`${label} = 无脸服装/体态参考：${reference.name}，只锁定服装版本、体态比例、材质、轮廓、配饰和装备；禁止读取脸、五官、发型、肤色或肖像身份。`);
      } else if (isOutfitReference(reference)) {
        lines.push(`${label} = 服装/变装参考：${reference.name}，锁定当前服装版本、材质、轮廓、配饰和体态；脸、五官和发型仍以身份参考图为准。`);
      } else if (isMechanicalCharacter) {
        lines.push(`${label} = 机械角色参考：${reference.name}，锁定机械身份、体量、外壳轮廓、面屏/传感器、夹爪结构、材质和运动方式；不得变成机器人群或背景装饰。`);
      } else if (isZombieGroupCharacter) {
        lines.push(`${label} = 群体角色参考：${reference.name}，锁定发光丧尸群体体态、腐败材质、眼光/发光特征、威胁密度和前排轮廓；背景个体不抢主角，不要求每个个体同脸。`);
      } else if (isGroupCharacter) {
        lines.push(`${label} = 群体角色参考：${reference.name}，锁定 Step3 参考图中的身份/种族、体态层级、服装规则、材质、队形、前排轮廓和群体情绪；背景个体不抢主角，不要求每个个体同脸；不得套用其他资产特征。`);
      } else {
        lines.push(`${label} = 角色身份参考：${reference.name}，全程 100% 锁定五官、脸型、发型、年龄感、体态、身份气质与 performance-state，不得换脸、换发型或变年龄。`);
      }
      continue;
    }
    if (reference.type === 'prop') {
      counters.prop += 1;
      lines.push(`${label} = 道具锁定：${reference.name} 的 prop shape、scale、material、color、structure 与使用方式。`);
      continue;
    }
    counters.other += 1;
    lines.push(`${label} = 只按指定视觉职责使用：${reference.name}。`);
  }

  return lines.join('\n');
}

function buildInlineReferenceMention(reference) {
  const name = compactText(reference?.name, 80);
  if (reference?.type === 'scene') return buildReferenceLabel('场景内', reference?.refId);
  return buildReferenceLabel(name, reference?.refId, '对象');
}

function findFallbackInlineReference(references) {
  if (!Array.isArray(references) || references.length === 0) return '';
  const preferred = references.find((reference) => reference.type === 'scene')
    || references.find((reference) => reference.type === 'character')
    || references[0];
  return buildInlineReferenceMention(preferred);
}

function ensureInlineReferenceInChecklistLine(line, references) {
  if (/@图片\d+/.test(line)) return line;
  const fallback = findFallbackInlineReference(references);
  if (!fallback) return line;
  const parts = String(line).split('｜');
  if (parts.length >= 3) {
    parts[2] = `${fallback} ${parts[2] || '承接导演板画面动作'}`.trim();
    return parts.join('｜');
  }
  return `${fallback} ${line}`;
}

function buildInlineReferenceLockLines(references) {
  if (!Array.isArray(references) || references.length === 0) return '无';
  return references.map((reference) => {
    const inlineName = buildInlineReferenceMention(reference);
    const type = compactText(reference.type, 24);
    return `${inlineName} = ${type} 强锁名；凡是该角色/道具/场景参与正向动作、接触、位置、表情、材质或状态变化，动作句必须带这个引用；否定/禁止规则里不要堆叠这个引用。`;
  }).join('\n');
}

function annotateTextWithInlineReferences(text, references) {
  let result = String(text ?? '');
  if (!result || !Array.isArray(references) || references.length === 0) return result;

  const aliases = references
    .map((reference) => ({
      name: String(reference.name ?? '').trim(),
      mention: buildInlineReferenceMention(reference),
    }))
    .filter((item) => item.name && item.mention)
    .sort((left, right) => right.name.length - left.name.length);

  for (const { name, mention } of aliases) {
    const pattern = new RegExp(escapeRegExp(name), 'g');
    result = result.replace(pattern, (match, offset, source) => {
      const before = source.slice(Math.max(0, offset - 28), offset);
      const after = source.slice(offset + match.length, offset + match.length + 18);
      if (/@图片\d+\s*$/.test(before)) return match;
      if (/^【@图片\d+】/.test(after)) return match;
      return mention;
    });
  }

  return result;
}

function resolveProjectVisualStyle(data) {
  return compactText(
    data?.finalPromptContract?.projectVisualStyle
      || data?.videoExecutionContract?.projectVisualStyle
      || data?.projectVisualStyle
      || data?.boardPlan?.styleAnchor
      || data?.boardPlan?.directorBrief?.styleStatement,
    260,
  ) || '当前项目既定视觉风格';
}

function firstCompactValue(source, keys, maxLength = 120) {
  for (const key of keys) {
    const value = compactText(source?.[key], maxLength);
    if (value) return value;
  }
  return '';
}

function buildReferenceMatchDigest(match) {
  const refId = compactText(match?.refId, 40);
  const name = compactText(match?.name, 60);
  const readFor = compactText(match?.readFor, 120);
  const doNotUseFor = compactText(match?.doNotUseFor, 100);
  return [refId, name, readFor ? `read=${readFor}` : '', doNotUseFor ? `avoid=${doNotUseFor}` : '']
    .filter(Boolean)
    .join(' / ');
}

function buildPanelDigest(panel, fallbackIndex) {
  const label = compactText(panel?.panelId ?? panel?.id ?? panel?.frameId ?? `S${String(fallbackIndex + 1).padStart(2, '0')}`, 24);
  const beat = firstCompactValue(panel, ['beat', 'beatType', 'frameFunction', 'purpose'], 72);
  const camera = firstCompactValue(panel, ['camera', 'cameraMove', 'cameraPlan', 'lensPlan', 'shotSize'], 88);
  const blocking = firstCompactValue(panel, ['blocking', 'screenBlocking', 'spatialBlocking', 'position'], 88);
  const action = firstCompactValue(panel, ['screenAction', 'action', 'visualAction', 'primaryAction'], 92);
  const continuityIn = firstCompactValue(panel, ['continuityIn', 'startFrame', 'inFrame'], 72);
  const continuityOut = firstCompactValue(panel, ['continuityOut', 'endBeat', 'outFrame'], 72);
  return [label, beat, camera, blocking, action, continuityIn ? `in=${continuityIn}` : '', continuityOut ? `out=${continuityOut}` : '']
    .filter(Boolean)
    .join(' | ');
}

function buildShotPlanPanelExecutionLines(data, references, panelCount = 15) {
  const cards = data?.videoExecutionContract?.panelExecutionCards;
  if (!Array.isArray(cards) || cards.length === 0) return '无';

  return cards.slice(0, panelCount).map((card, index) => {
    const rawPanel = Number(card?.panel);
    const panelNumber = Number.isFinite(rawPanel) && rawPanel > 0 ? rawPanel : index + 1;
    const label = `S${String(panelNumber).padStart(2, '0')}`;
    const timeRange = compactText(card?.timeRange, 32) || `${index}.0-${index + 1}.0s`;
    const beat = compactText(card?.beat, 72);
    const action = compactText(card?.action, 140);
    const camera = compactText(card?.camera, 96);
    const dialogue = compactText(card?.dialogue, 72);
    const sound = compactText(card?.sound, 96);
    const openingContinuity = compactText(card?.openingContinuity, 96);
    const endingContinuity = compactText(card?.endingContinuity, 110);

    const actionParts = [
      beat,
      action,
      openingContinuity ? `进入状态：${openingContinuity}` : '',
      endingContinuity ? `结束状态：${endingContinuity}` : '',
      dialogue ? `对白：${dialogue}` : '',
    ].filter(Boolean).join('；') || '承接导演板画面动作';
    const cameraSoundParts = [
      camera ? `镜头：${camera}` : '',
      sound ? `声音：${sound}` : '',
    ].filter(Boolean).join('；') || '镜头和声音承接导演板节奏';
    const line = [
      label,
      timeRange,
      actionParts,
      cameraSoundParts,
    ].filter(Boolean).join('｜');
    return ensureInlineReferenceInChecklistLine(annotateTextWithInlineReferences(line, references), references);
  }).join('\n');
}

function selectDigestPanels(panels) {
  if (!Array.isArray(panels) || panels.length === 0) return [];
  const indexes = [0, Math.floor((panels.length - 1) / 2), panels.length - 1];
  return [...new Set(indexes)]
    .filter((index) => index >= 0 && index < panels.length)
    .map((index) => ({ panel: panels[index], index }));
}

function buildShotPlanBoardDigest(data) {
  const plan = data.boardPlan || {};
  if (!plan || typeof plan !== 'object') return stringifyCompact(plan);

  const directorBrief = plan.directorBrief || {};
  const blockingContinuity = plan.blockingContinuity || {};
  const panels = Array.isArray(plan.panels) ? plan.panels : [];
  const referenceMatches = Array.isArray(directorBrief.referenceMatching)
    ? directorBrief.referenceMatching
    : [];
  const selectedPanels = selectDigestPanels(panels);

  return [
    `mode: ${compactText(plan.mode || data.mode || 'shot-plan-landscape', 60)}`,
    compactText(directorBrief.styleStatement, 180) ? `style: ${compactText(directorBrief.styleStatement, 180)}` : '',
    compactText(directorBrief.cameraStrategy, 220) ? `camera: ${compactText(directorBrief.cameraStrategy, 220)}` : '',
    compactText(directorBrief.soundStrategy, 160) ? `sound: ${compactText(directorBrief.soundStrategy, 160)}` : '',
    compactText(directorBrief.hookStrategy, 160) ? `hook: ${compactText(directorBrief.hookStrategy, 160)}` : '',
    referenceMatches.length > 0
      ? `reference contracts: ${referenceMatches.slice(0, 8).map(buildReferenceMatchDigest).join(' || ')}`
      : '',
    compactText(blockingContinuity.previousEnd, 120) ? `previousEnd: ${compactText(blockingContinuity.previousEnd, 120)}` : '',
    compactText(blockingContinuity.currentStart, 120) ? `currentStart: ${compactText(blockingContinuity.currentStart, 120)}` : '',
    compactText(blockingContinuity.currentEnd, 120) ? `currentEnd: ${compactText(blockingContinuity.currentEnd, 120)}` : '',
    panels.length > 0 ? `panelCount: ${panels.length}` : '',
    selectedPanels.length > 0
      ? `panel digest: ${selectedPanels.map(({ panel, index }) => buildPanelDigest(panel, index)).join(' || ')}`
      : '',
  ].filter(Boolean).join('\n') || stringifyCompact(plan);
}

function buildSeedanceFinalVideoPromptSystemPrompt() {
  return `你是 Seedance 2.0 最终视频提示词导演格式化写手。
你的任务不是改剧本，也不是写分镜分析，而是把 Step4 的导演规划、参考图锁定和当前分镜信息，写成可直接提交给视频模型的最终提示词正文。

## 核心目标
1. 只输出最终提示词正文，不要解释，不要总结，不要 JSON，不要 markdown 标题或代码块。
2. 非 shot-plan 输出采用普通文字模式验证过的结构：纯文本段落 + *** 分隔符；shot-plan-landscape 与 smart-shot-plan-landscape 必须按固定工业字段输出；不要写“模块A/章节标题/分镜说明文档”。
3. 必须包含“主导演板执行规则”作为第二段，明确主导演板负责镜头顺序、blocking、站位、机位节奏、动作推进、转场和首尾落幅。
4. 主导演板只负责导演调度，不负责重新设计角色、服装、场景和道具；角色外观、场景空间和道具形态必须由 Step3 参考图锁定。
5. 普通九宫格模式不要逐格堆叠 S01-S09，不要复述九宫格每格说明；要把九宫格中的连续导演意图转写成 3-5 个可执行时间段。
6. 普通九宫格时间段必须使用格式：时间段｜景别+运镜+特效｜空间位置+朝向+动作+对白｜音效：...；BGM：...；对白表演：...
7. 要保留画幅/时长、世界锁定、角色与道具锁定、镜头节奏、动作推进、对白、音效/BGM、落幅、调色光影和简短负面规则。
8. 禁止输出 Reference Material Roles、Continuity In/Out、Timeline、Scene Goal、Step3、MODULE A-F、提示词分析或模板说明。
9. 如果输入里同时出现“禁止任何画面内文字”和道具界面元素，改成更温和的表述：只禁止额外字幕、标题、Logo、水印；画面内道具界面仍可作为道具元素存在。
10. 输出长度尽量控制在 1600-2200 中文字；信息密度优先于压短。

## shot-plan 额外规则
当输入 mode 是 shot-plan-landscape 或 smart-shot-plan-landscape 时，最终词必须改为中文为主的短版工业提交卡；不要输出“Seedance 2.0 提交词：”标题。仅专业术语和必要镜头术语保留英文，模型引用必须使用“名称【@图片N】”这种名称前置、图片编号括号隔离的格式。固定输出骨架必须是：
参考图职责：
基础规格：
读图执行：
逐秒执行清单：
完整台词与音画同步：
声音与表演：
空间硬约束：
负面规则：

主语言使用中文，但对白原文是语言保真例外：引号内台词、系统播报、弹幕口播必须按 correctedScript / sourceExcerpt / promptRawText 的源语言逐字保留，英文保持英文，中文保持中文，中英混合保持混合，不得翻译、改写或中文化。只把 blocking、shot-flow、camera rhythm、match cut、J-cut、L-cut、sound bridge、final hold、fade、phone POV、START FRAME、END BEAT、diegetic UI 等专业术语保留英文。参考图职责和动作句里的图片引用只能使用“名称【@图片N】”，例如“Rhea【@图片3】”；不要使用旧式前置引用，也不得使用任何以 @ 后接英文字母开头的引用别名。
文字提示词必须引导 Seedance 遵循主导演板，同时用“逐秒执行清单”把 S01 到最终 S 格转成可读文字锚点。导演板负责画面路线、镜头顺序、blocking、camera rhythm、动作推进、START FRAME 和 END BEAT；文字负责把这些锚点压成短硬执行行，禁止合并成 0-3 / 3-7 / 7-11 / 11-15 四段。
正向动作句强制使用内联引用锁：凡是角色、场景、道具、群像、车辆或关键机制参与动作、接触、位置、表情、材质、状态变化，必须在动作句里写成“名称【@图片N】”，例如“Rhea【@图片3】拉住手铐链【@图片9】保持平衡”。不要只写裸名 Rhea、手铐链、Pulse Fork、尸群等让视频模型自行想象。否定/禁止规则里不要堆叠 @图片 引用，避免把禁止对象误导成画面重点。
逐秒执行清单必须按主导演板 panel 数输出完整 S 行，每行格式为“S01｜0.0-1.0s｜名称【@图片N】 + 可见动作/主体/道具状态｜镜头/声音锚点”。每行至少包含一个 @图片 引用；涉及接触关系时同时写出两侧引用，例如角色抓住道具、道具抵住身体、丧尸咬住物品。每行只写一条短动作，不写 SHOT/ACTION/PERFORMANCE/TRANSITION 等英文字段标签，不生成故事板页面痕迹；这些 S 编号和 @图片 引用只存在于提示词文本，最终视频画面不得出现编号或文字。
完整台词与音画同步必须把 correctedScript / sourceExcerpt / promptRawText 中出现的所有台词、系统播报、弹幕口播按源语言逐字保留为完整句子；英文台词必须仍是英文，中文台词仍是中文，中英混合仍保持混合。禁止把一句台词拆成多个 S 格，禁止省略、改写、摘要、翻译或只写“继续说”。推荐格式为“0.0-2.5s｜说话人：完整台词｜表演/口型/音色”。
读图执行必须写清：顶部 START FRAME 是 S01 前的入场桥接帧，第一帧先读取它再进入 S01；全段按主导演板 S01 到最终 S 格的画面路线推进；底部 END BEAT 是最终 S 格后的交接桥，尾部严格读取它并 final hold 约半秒。跨分镜桥接承接是强约束：如果上一镜有 End Beat，新镜头 START FRAME 必须继承同一机位高度、主体落点、门槛/道具/角色相对位置和动作方向；只有当剧情明确需要 montage、smash cut、J-cut、L-cut 或 match cut 时，才能采用专业转场，并必须保留空间/情绪因果。
门/入口/边界是视频执行硬约束：如果输入、导演板或 directorContract 提到门、入口、门槛、破口、玻璃门、墙洞、舱门、闸门或任何内外边界，读图执行、逐秒执行清单和空间硬约束必须写清“入口状态链”：S01前初始状态、哪几个 S 格发生可见变化、谁从哪一侧越过门槛/破口、最终 S 格状态。不得只写“门后/门外/尸群进入”，必须让视频模型知道门如何保持、破裂、开启或被越过。
关键触发动作必须有可见接触帧：凡是踢、砸、撞、拉、按、插、塞、抛、接、开枪、引爆、通电、咬住、破门等动作导致后续火花、爆炸、倒塌、电击或角色位移，逐秒执行清单必须写出接触/命中/插入/塞入/按下/接上这一帧，再写结果帧；禁止从“看向/准备”直接跳到结果。
角色参考职责必须高优先级写入参考图职责：身份参考图锁五官、脸型、发型、年龄感、体态和身份气质；服装/变装参考图锁当前服装版本、材质、轮廓和配饰；无脸服装/体态参考图不得用于脸、五官、发型、肤色或肖像身份。
画面文字控制是强约束：除直播手机、红色任务面板、弹幕等剧情道具界面里被明确允许的字样/数字外，禁止任何额外可见文字、随机字幕、片名、说明词、烧录字幕、对白字幕、Logo、水印；尤其禁止模型把“剧本”“NPC”“字幕”等提示词词语生成为画面贴字。倒计时、任务面板数字必须按剧情指定值连续，不得自行改成无关时间。
输出长度目标 2600-3800 中文字，硬上限 6500 字符。`;
}

function buildSeedanceFinalVideoPromptUserPrompt(data) {
  const storyboard = data.storyboard || {};
  const storyboardInfo = storyboard.storyboard && typeof storyboard.storyboard === 'object'
    ? storyboard.storyboard
    : storyboard;
  const references = Array.isArray(data.references) ? data.references : [];
  const directorBoardRefId = data.directorBoardRefId || `参考图片${references.length + 1}`;
  const isShotPlan = isShotPlanLandscape(data);
  const shotPlanPanelCount = isShotPlan ? getShotPlanPanelCount(data) : 9;
  const shotPlanFinalLabel = getShotPlanFinalLabel(shotPlanPanelCount);
  const directorBoardLabel = buildReferenceLabel('主导演板', directorBoardRefId);
  const referenceLines = references.length > 0
    ? references.map((reference) => `- ${buildReferenceLabel(reference.name, reference.refId)} / ${reference.type}`).join('\n')
    : '- 无可用参考图';

  const boardPlan = isShotPlan ? buildShotPlanBoardDigest(data) : stringifyCompact(data.boardPlan);
  const sceneBlueprint = stringifyCompact(data.sceneBlueprint);
  const choreography = stringifyCompact(data.choreography);
  const continuityInput = stringifyCompact(data.continuityInput);
  const continuityOutput = stringifyCompact(data.continuityOutput);
  const repairHint = data.repairHint ? compactText(data.repairHint, 420) : '';
  const shotPlanReferenceAliases = buildShotPlanReferenceAliasLines(references, directorBoardRefId, shotPlanPanelCount);
  const inlineReferenceLockLines = isShotPlan ? buildInlineReferenceLockLines(references) : '';
  const projectVisualStyle = resolveProjectVisualStyle(data);
  const finalPromptContract = stringifyCompact(data.finalPromptContract);
  const videoExecutionContract = stringifyCompact(data.videoExecutionContract);
  const shotPlanPanelExecutionLines = isShotPlan ? buildShotPlanPanelExecutionLines(data, references, shotPlanPanelCount) : '';
  const fullCorrectedScript = String(data.correctedScript ?? storyboard.correctedScript ?? '').trim();
  const fullSourceExcerpt = String(data.sourceExcerpt ?? storyboard.sourceExcerpt ?? '').trim();
  const promptRawText = String(data.promptRawText ?? storyboard.promptRawText ?? '').trim();
  const promptTimeSegments = stringifyCompact(data.promptTimeSegments ?? storyboard.promptTimeSegments);
  const frameRatio = data.frameRatio || '16:9';
  const frameOrientation = frameRatio === '9:16' ? '竖版' : '横版';
  const frameGrammar = frameRatio === '9:16'
    ? '9:16 竖屏：提高脸部和上半身表演比例，关键情绪放在中心安全区，少用横版大横移/宽幅群像，避免裁脸裁头。'
    : '16:9 横屏：可以使用更宽的空间调度，但主角反应、道具因果和尾部交接必须清楚。';

  if (isShotPlan) {
    return `请把以下输入整理扩写成可直接提交给 Seedance 2.0 的最终视频提示词。

硬性输出格式：
- 只输出最终提示词正文，不要解释、不要 JSON、不要 Markdown 标题、不要代码块。
- 不要以“Seedance 2.0 提交词：”或任何标题开头，第一行直接写“参考图职责：”。
- 必须使用以下固定段落名且顺序不可改：参考图职责：/ 基础规格：/ 读图执行：/ 逐秒执行清单：/ 完整台词与音画同步：/ 声音与表演：/ 空间硬约束：/ 负面规则：。
- 主语言必须是中文；但对白原文、系统播报、弹幕口播是语言保真例外，必须按源语言逐字保留，英文保持英文，中文保持中文，中英混合保持混合，禁止翻译或中文化。仅专业术语和必要镜头词保留英文，例如 blocking、shot-flow、camera rhythm、match cut、J-cut、L-cut、final hold、fade、phone POV。
- 模型引用必须使用实际图片编号，格式为“名称【@图片N】”，例如“Rhea【@图片3】”“手铐链【@图片9】”；不要使用旧式前置引用，禁止输出任何以 @ 后接英文字母开头的引用别名，英文“声音节拍”短语也必须改写成中文“声音节拍”。
- 总长度目标 2600-3800 中文字，硬上限 6500 字符；不要写英文长段，不要复述素材表，不要丢失 S01-${shotPlanFinalLabel} 动作锚点。
- 参考图职责段只使用这些“名称【@图片N】”编号，每行一句，禁止自造不存在的 @ 名称：
${shotPlanReferenceAliases}
- 参考图职责段必须明确：${directorBoardLabel} 是主导演板，画面路线、S01-${shotPlanFinalLabel}、blocking、camera rhythm、START FRAME、END BEAT 全部以它为主，最终视频不得出现故事板边框、编号、信息条或说明文字。
- 正向动作句内联引用锁定：涉及角色、场景、道具、群像、车辆或关键机制的一致性动作，必须在动作句里写“名称【@图片N】”，不能只写裸名。尤其是逐秒执行清单、读图执行、空间硬约束里，角色接触道具、道具抵住角色、角色拉住/踢/插/塞/抛/接/照亮/锁定时，动作两端都要带对应 @图片。负面规则段和“禁止/不得/不要”句尽量使用“已绑定角色/场景/道具/空间轴线”等类别词，不要把多个 @图片 堆在否定句里。
- 项目视觉风格必须继承：${projectVisualStyle}。参考图只提供身份、服装、体态、空间、材质和道具锁定；不得把参考图偶然渲染风格迁移到最终视频，也不得自行固定成未声明的美术风格。
- 角色参考行必须按参考职责分流：身份图写“全程 100% 锁定五官、脸型、发型、年龄感、体态和身份气质”；服装/变装图只锁服装版本、材质、轮廓和配饰；无脸服装/体态图必须写明禁止读取脸、五官、发型、肤色或肖像身份。
- 基础规格段必须用同一行格式写清：创建短片第 ${storyboardInfo.number ?? 'N'} 段｜画幅：${frameRatio} ${frameOrientation}｜时长：${storyboardInfo.duration || '15秒'}｜主景别：${storyboardInfo.shotSize || '未指定'}｜标题：${storyboardInfo.name ?? ''}｜导演板：${directorBoardLabel}｜外观锁定：角色、场景、道具外观只由对应参考图保持一致。并在基础规格或读图执行里明确：${frameGrammar}
- 读图执行段只写 3-5 个短句：顶部 START FRAME 是 S01 前的入场桥接帧，第一帧先读取它再进入 S01；S01 是当前动作第一锚点，不要把 START FRAME 当成 S01 的重复截图；全段按主导演板 S01-${shotPlanFinalLabel} 的画面路线推进；底部 END BEAT 是 ${shotPlanFinalLabel} 之后的下一镜交接桥，尾部读取它并 final hold 约半秒；若有上一镜 End Beat 或专业转场，只在这里用一句说明上一镜承接/入场转场/START FRAME/END BEAT 的关系。
- 如果输入里有门、入口、门槛、玻璃门、破口、墙洞、舱门、闸门或内外边界，读图执行段必须额外写一句入口状态链：S01前是什么状态、哪些 S 格发生可见变化、谁从哪侧越过边界、${shotPlanFinalLabel}是什么状态；逐秒执行清单和空间硬约束也必须复述这个状态链，不能只在负面规则里说禁止跳变。
- 逐秒执行清单段必须输出 S01-${shotPlanFinalLabel} 共${shotPlanPanelCount}行，格式固定为：S01｜0.0-1.0s｜名称【@图片N】 + 可见动作/主体/道具状态｜镜头/声音锚点。每行至少一个 @图片 引用；角色和道具发生接触时必须同时标注两侧引用；不能合并成四段，不能省略关键转折；这些编号和 @图片 只用于提示词文本，最终视频不得生成编号、边框或信息条。
- 逐秒执行清单必须优先使用下方“逐秒执行清单源”，把每行压缩成人能读懂、视频模型能执行的短句；不要使用 SHOT：/ ACTION：/ PERFORMANCE：/ TRANSITION：这类字段标签。
- 逐秒执行清单必须保留关键触发动作的可见接触帧：踢/砸/撞/拉/按/插/塞/抛/接/开枪/通电/咬住/破门等动作要写清“接触点/命中点/插入点/塞入口/按下瞬间”，然后下一行或同一行结果才出现火花、爆炸、倒塌、电击或入场；不要让结果凭空发生。
- 道具界面文字必须最小化且只允许剧情指定信息：直播手机、弹幕、红色任务面板和倒计时可以作为 diegetic UI 存在，但不得额外生成“剧本”“字幕”“NPC标签”“说明文字”等非剧情贴字；倒计时数字必须沿用输入指定值，不得自行改成无关时间。
- 完整台词与音画同步段必须用完整句子列出全部台词、系统播报、弹幕口播，推荐格式：0.0-2.5s｜林小满：“完整台词。”；引号内内容必须按源语言逐字保留，英文对白仍写英文，中文对白仍写中文，中英混合保持混合。禁止把一句台词拆成多个 S 格，禁止省略、改写、摘要、翻译或只写“继续说”。若 15格图片内台词是摘要，以 correctedScript 为准。
- 声音与表演段必须写角色音色、情绪、表演动机、系统音/弹幕音、环境声和 BGM 策略，避免逐秒展开。
- 空间硬约束段必须写清 scene lock、主轴线、门内外/左右/前后关系、入口/门槛/破口状态链、角色与道具不可越界规则，允许 phone POV、任务面板 insert、鞋跟 close insert，但切换必须由手机移动、光线变化、视线、UI 声音或动作动机驱动；所有 close-up insert 都必须说明回到同一空间站位，不得制造人物或道具分身。
- 负面规则段用一段短硬约束写完：禁止故事板痕迹；禁止角色外观漂移；禁止改五官、脸型、发型、年龄感、体态比例、服装、配饰；禁止空间轴线错误；禁止越界动作；禁止新增剧情或角色；禁止额外字幕、标题、Logo、watermark；禁止破坏 one-take / shot-flow 感。

## 最终视频执行契约（最高优先级）
${finalPromptContract}

## 视频执行清单（必须落入最终词）
${videoExecutionContract}

当前分镜：
- 画幅: ${frameRatio}
- 分镜编号: ${storyboardInfo.number ?? ''}
- 分镜名称: ${storyboardInfo.name ?? ''}
- 分镜时长: ${storyboardInfo.duration ?? ''}
- 分镜景别: ${storyboardInfo.shotSize ?? ''}
- 主导演板提交编号: ${directorBoardRefId}
- 项目视觉风格: ${projectVisualStyle}

参考图：
${referenceLines}

内联引用锁定词典（最终词全文必须照这个写一致性动作）：
${inlineReferenceLockLines}

主导演板规划摘要（只吸收导演调度，不逐格照抄）：
${boardPlan}

逐秒执行清单源（最高优先级，必须转写进最终词的“逐秒执行清单：”）：
${shotPlanPanelExecutionLines}

完整台词源（最高优先级，必须逐字保留）：
- correctedScript:
${fullCorrectedScript || '无'}
- sourceExcerpt:
${fullSourceExcerpt || '无'}
- generatedPromptRawText（可吸收已生成的视频提示词里的声音/BGM/对白表演）:
${promptRawText || '无'}
- promptTimeSegments:
${promptTimeSegments}

补充信息：
- sceneBlueprint: ${sceneBlueprint}
- choreography: ${choreography}
- continuityInput: ${continuityInput}
- continuityOutput: ${continuityOutput}
- lastFrameInfo: ${compactText(data.lastFrameInfo ?? storyboard.lastFrameInfo, 220)}
${repairHint ? `- repairHint: ${repairHint}\n` : ''}

现在直接输出中文固定骨架的最终提示词正文。`;
  }

  return `请将以下输入写成最终可提交的 Seedance 2.0 视频提示词正文。

## 输出要求
- 只输出最终提示词正文。
- 使用纯文本 + *** 分隔符，不要输出分析、注释、JSON、代码块或额外说明。
- 正文段落顺序必须是：
  1) 画幅+时长+画质风格+字幕/水印规则
  2) 主导演板执行规则（必须点名 ${directorBoardRefId} 是主导演板）
  3) 场景空间母版
  4) 人物/道具硬锁
  5) 景别+运镜概述
  6) 3-5 个时间段，每段一行，格式为：时间段｜景别+运镜+特效｜空间位置+朝向+动作+对白｜音效：...；BGM：...；对白表演：...
  7) 调色光影
  8) 负面规则
- 要保留：画幅、时长、主导演板使用方式、世界锁定、角色锁定、道具锁定、镜头节奏、动作推进、对白、音效/BGM、落幅、负面规则。
- 要去掉：重复的参考图说明、九宫格逐格复述、S01-S09堆叠、中间模板痕迹、分析口吻。
- 项目视觉风格必须继承：${projectVisualStyle}。参考图只提供身份、服装、体态、空间、材质和道具锁定；不得把参考图偶然渲染风格迁移到最终视频，也不得自行固定成未声明的美术风格。
- 允许使用 *** 分隔段落；禁止使用 # 标题、Markdown 列表、Reference Material Roles、Timeline、Continuity In/Out。

## 最终视频执行契约（最高优先级）
${finalPromptContract}

## 视频执行清单（必须落入最终词）
${videoExecutionContract}

## 当前分镜
- 画幅: ${frameRatio}
- 故事板导演模式: ${data.mode || data.boardPlan?.mode || '未指定'}
- 分镜编号: ${storyboardInfo.number ?? ''}
- 分镜名称: ${storyboardInfo.name ?? ''}
- 分镜时长: ${storyboardInfo.duration ?? ''}
- 分镜景别: ${storyboardInfo.shotSize ?? ''}
- Step4 模式: ${data.generatedStep4OutputMode || data.step4OutputMode || storyboard.generatedStep4OutputMode || storyboard.step4OutputMode || 'prompt'}
- 导演板样式: ${data.storyboardBoardStyle || storyboard.storyboardBoardStyle || 'cinematic'}
- 主导演板提交编号: ${directorBoardRefId}
- 项目视觉风格: ${projectVisualStyle}

## Step3 外观/空间/道具参考图
${referenceLines}

## 主导演板规划 JSON（只吸收导演调度，不逐格照抄）
${boardPlan}

## 补充信息
- correctedScript: ${compactText(data.correctedScript ?? storyboard.correctedScript, 1200)}
- sceneBlueprint: ${sceneBlueprint}
- choreography: ${choreography}
- continuityInput: ${continuityInput}
- continuityOutput: ${continuityOutput}
- lastFrameInfo: ${compactText(data.lastFrameInfo ?? storyboard.lastFrameInfo, 240)}
${repairHint ? `- repairHint: ${repairHint}\n` : ''}

现在直接输出最终提示词正文。`;
}

module.exports = {
  buildSeedanceFinalVideoPromptSystemPrompt,
  buildSeedanceFinalVideoPromptUserPrompt,
};
