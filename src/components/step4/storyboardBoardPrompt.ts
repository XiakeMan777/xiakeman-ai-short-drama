import type {
  AssetSource,
  ImageConcept,
  StoryboardBoardMode,
  StoryboardBoardPlan,
  StoryboardBoardStyle,
  StoryboardSequenceContinuityContext,
  StoryboardState,
} from '@/types';
import { resolveStoryboardProjectVisualStyle } from '@/lib/projectVisualStyle';
import { buildStoryboardReferenceReadingContract } from './storyboardReferenceReadingContract';
import {
  formatStoryboardPanelLabel,
  getSmartStoryboardLayoutRule,
  isFixedShotPlanBoardMode,
  isShotPlanBoardMode,
  isSmartShotPlanBoardMode,
} from './storyboardBoardMode';

export interface StoryboardBoardReference {
  refId: string;
  type: 'scene' | 'character' | 'prop';
  name: string;
  concept?: ImageConcept;
  assetSource?: AssetSource;
  trackingId?: string;
  assetId?: string;
  variantKey?: string;
  outfitSeq?: number;
  isNoFaceCharacterVisual?: boolean;
}

export interface StoryboardBoardPromptOptions {
  frameRatio?: string;
  sequenceContinuityContext?: StoryboardSequenceContinuityContext;
  projectVisualStyle?: string;
}

function normalizeRefNumber(refId: string) {
  const match = refId.match(/\d+/);
  return match ? match[0] : refId.replace(/[()（）【】\s图片]/g, '');
}

function compactText(value: string | undefined, maxLength = 180) {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

const APPEARANCE_DETAIL_PATTERN = /外貌|五官|脸型|发型|发饰|发髻|妆容|服装细节|服饰|配饰|耳饰|钗饰|肤色|面部轮廓|眉眼|鼻梁|唇形|发丝/;

function sanitizeImagePromptText(value: string | undefined, maxLength = 160) {
  const source = (value ?? '')
    .replace(/背景群像/g, '背景压暗人影')
    .replace(/后方虚化群像/g, '后方虚化人影')
    .replace(/虚化群像/g, '虚化人影')
    .replace(/压暗群像/g, '压暗人影')
    .replace(/群像/g, '远处模糊人影')
    .replace(/\d+(?:[–—-]\d+)?秒/g, '')
    .replace(/每秒\d+(?:\.\d+)?(?:厘米|米|帧)/g, '')
    .replace(/稳定性\d+%/g, '')
    .replace(/无特效/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!source) return '';

  const clauses = source
    .split(/([，；。])/)
    .reduce<string[]>((result, part, index, array) => {
      if (index % 2 === 0) {
        const next = array[index + 1] ?? '';
        result.push(`${part}${next}`.trim());
      }
      return result;
    }, [])
    .filter((clause) => clause && !APPEARANCE_DETAIL_PATTERN.test(clause));

  return compactText(clauses.join(''), maxLength);
}

function sanitizeImagePromptList(items: string[] | undefined, maxItems = 4) {
  return (items ?? [])
    .map((item) => sanitizeImagePromptText(item, 48))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function sortStoryboardBoardReferencesByPlanPriority(
  references: StoryboardBoardReference[],
  plan?: StoryboardBoardPlan,
) {
  if (!plan) {
    return [...references].sort((left, right) => left.refId.localeCompare(right.refId));
  }
  const priorityMap = new Map(plan.referencePriority.map((refId, index) => [refId, index]));
  return [...references].sort((left, right) => {
    const leftPriority = priorityMap.get(left.refId) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = priorityMap.get(right.refId) ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.refId.localeCompare(right.refId);
  });
}

function buildNineGridPanelLines(
  plan: StoryboardBoardPlan,
  frameLabel: '竖屏' | '横版',
) {
  return plan.panels
    .slice(0, 9)
    .map((panel) => {
      const secondarySubjects = panel.secondarySubjects.length > 0
        ? `；辅=${panel.secondarySubjects.slice(0, 2).join('、')}`
        : '';
      const mustShow = sanitizeImagePromptList(panel.mustShow, 4).join('、') || '核心主体、关键动作、空间关系';
      const staticMoment = sanitizeImagePromptText(panel.staticMoment, 120) || panel.beat;
      const composition = sanitizeImagePromptText(panel.composition, 120) || `${frameLabel}完整构图，主体清晰，不跨格`;
      return `${String(panel.index).padStart(2, '0')}｜${panel.beat}
主=${panel.primarySubject}${secondarySubjects}
画面=${staticMoment}
构图=${composition}
必见=${mustShow}`;
    })
    .join('\n\n');
}

function buildNineGridReferenceLines(
  references: StoryboardBoardReference[],
  plan: StoryboardBoardPlan,
) {
  return sortStoryboardBoardReferencesByPlanPriority(references, plan)
    .map((reference) => {
      const refNumber = normalizeRefNumber(reference.refId);
      const contract = buildStoryboardReferenceReadingContract(reference);
      return `图片${refNumber}=${reference.name}（${contract.readFor} Do not: ${contract.doNotUseFor}）`;
    })
    .join('\n');
}

function buildDirectorBriefLines(plan: StoryboardBoardPlan) {
  const brief = plan.directorBrief;
  if (!brief) return [];
  const referenceLines = (brief.referenceMatching ?? [])
    .slice(0, 8)
    .map((item) => [
      item.refId || item.name,
      item.type,
      item.readFor ? `read: ${compactText(item.readFor, 120)}` : '',
      item.doNotUseFor ? `do not: ${compactText(item.doNotUseFor, 100)}` : '',
    ].filter(Boolean).join(' | '));

  return [
    'Director brief before storyboard planning:',
    brief.styleStatement ? `- Style statement: ${compactText(brief.styleStatement, 180)}` : '',
    brief.cameraStrategy ? `- Camera strategy: ${compactText(brief.cameraStrategy, 180)}` : '',
    brief.soundStrategy ? `- Sound strategy: ${compactText(brief.soundStrategy, 180)}` : '',
    brief.hookStrategy ? `- Hook strategy: ${compactText(brief.hookStrategy, 180)}` : '',
    brief.storyboardStrategy ? `- Storyboard strategy: ${compactText(brief.storyboardStrategy, 180)}` : '',
    referenceLines.length > 0 ? `- Reference matching:\n${referenceLines.map((line) => `  * ${line}`).join('\n')}` : '',
  ].filter(Boolean);
}

function hasNoFaceReference(references: StoryboardBoardReference[]) {
  return references.some((reference) => reference.type === 'character' && reference.isNoFaceCharacterVisual);
}

function hasOutfitReference(references: StoryboardBoardReference[]) {
  return references.some((reference) =>
    reference.type === 'character'
    && (
      reference.concept === 'landscape_outfit_turnaround'
      || reference.concept === 'portrait_outfit'
      || !!reference.variantKey
      || typeof reference.outfitSeq === 'number'
    ),
  );
}

function buildReferenceStyleTransferGuardLines(projectVisualStyle: string) {
  return [
    '- Reference style transfer is forbidden: Step3 images provide identity anchors, outfit silhouette, body proportion, scene geometry, and prop shape only.',
    `- Render all Step3 references in the current project visual style: ${projectVisualStyle}.`,
    '- Do not copy accidental render style, lighting style, retouching style, camera artifact, or production format from reference images.',
    '- Do not force any undeclared global aesthetic; only use a specific visual medium when the current project visual style explicitly requires it.',
    '- Wardrobe safety: no cleavage, no exposed breasts, no lingerie styling, no sexualized posing or camera emphasis; keep costumes production-safe for the current project style.',
  ];
}

function buildStoryboardRenderingContractLines(
  references: StoryboardBoardReference[],
  mode: StoryboardBoardMode,
  visualLayerOnly: boolean,
  projectVisualStyle: string,
  panelCount?: number,
) {
  const isShotPlanMode = isShotPlanBoardMode(mode);
  const usesOutfitReference = hasOutfitReference(references);
  const usesNoFaceReference = hasNoFaceReference(references);
  const finalPanelLabel = isShotPlanMode
    ? formatStoryboardPanelLabel(panelCount ?? 15)
    : 'S09';
  const nineGridPanelCount = 9;
  return [
    'Storyboard rendering contract:',
    '- Match Step3 references by refId first; if the same character has identity, outfit, and no-face body references, keep each reference purpose separate.',
    '- Render the approved storyboard plan literally: primarySubject, mustShow, blocking, motion, cameraTask, continuityIn, and continuityOut are drawing instructions, not optional notes.',
    isShotPlanMode
      ? `- Render the shot-sheet plan literally; START FRAME is the incoming bridge before S01, ${finalPanelLabel} is the final action anchor, and END BEAT is the outgoing handoff after ${finalPanelLabel}. Keep them causally continuous, but do not duplicate-crop START FRAME from S01 or END BEAT from ${finalPanelLabel}.`
      : '- Render the 9-panel plan literally; S01-S09 must read left-to-right, top-to-bottom as complete keyframes, not repeated crops.',
    '- Do not draw character sheet layouts, FRONT VIEW/BACK VIEW/COSTUME DETAIL labels, prop display windows, scene design modules, overhead maps, or pasted reference collage areas.',
    usesOutfitReference
      ? '- OUTFIT VERSION visual lock: keep the selected outfit version consistent in every panel where that character appears; never drift back to base outfit or default outfit.'
      : '- Keep character clothing consistent with the bound Step3 identity references; do not invent a new costume.',
    usesNoFaceReference
      ? '- No-face reference safety: no-face outfit/body references control only clothing version, body proportion, material, silhouette, accessories, and equipment; never derive face, facial features, hairstyle, skin tone, or portrait identity from them.'
      : '- If an official portrait and an outfit/body reference both exist, use the portrait for identity and the outfit/body reference only for clothing/body/material.',
    isShotPlanMode
      ? '- Every planned S panel must have one clear visual task and one lead subject; background people stay vague unless they have Step3 references.'
      : `- Each of the ${nineGridPanelCount} panels must have one clear visual task and one lead subject; background people stay vague unless they have Step3 references.`,
    visualLayerOnly
      ? '- These contract lines are instructions for image generation; do not render these contract instructions as visible text, labels, arrows, borders, or UI.'
      : '- These contract lines are preflight rules; only the planned short production-board labels may appear as visible text.',
    ...buildReferenceStyleTransferGuardLines(projectVisualStyle),
  ];
}

function buildSeedanceBoardPanelLines(
  plan: StoryboardBoardPlan,
  frameLabel: '竖屏' | '横版',
) {
  return plan.panels
    .slice(0, 9)
    .map((panel) => {
      const secondarySubjects = panel.secondarySubjects.length > 0
        ? `；辅助主体=${panel.secondarySubjects.slice(0, 2).join('、')}`
        : '';
      const staticMoment = sanitizeImagePromptText(panel.staticMoment, 150) || panel.beat;
      const blocking = sanitizeImagePromptText(panel.blocking || panel.composition, 130) || `${frameLabel}完整成镜，主体落位清楚`;
      const motion = sanitizeImagePromptText(panel.motion || panel.staticMoment, 130) || '动作起点与终点清楚';
      const cameraTask = sanitizeImagePromptText(panel.cameraTask || `${panel.shotType}，${panel.cameraAngle}`, 120);
      const continuity = sanitizeImagePromptText(panel.continuityOut || panel.continuity, 100) || '承接前后格落幅';
      const mustShow = sanitizeImagePromptList(panel.mustShow, 3).join('、') || '主体、动作、空间关系';
      const worldAnchor = sanitizeImagePromptText(panel.worldAnchor, 64);
      const dialogue = compactText(panel.dialogue, 86) || compactText(panel.dialoguePerformance, 86) || 'NO DIALOGUE';
      const sfx = compactText(panel.sfx, 72) || 'ROOM TONE';
      const audio = compactText(panel.audio, 72) || 'SYNC AUDIO';
      const transition = compactText(panel.transition, 54) || (panel.index === 9 ? 'END HOLD' : 'CUT');

      return `S${String(panel.index).padStart(2, '0')} | TIME ${panel.timeRange || panel.beat}
SHOT ${panel.shotType} / ${panel.cameraAngle} / ${cameraTask}
ACTION ${staticMoment}; blocking ${blocking}; motion ${motion}
DIALOGUE ${dialogue}
SFX ${sfx}
AUDIO ${audio}
TRANSITION ${transition}
SUBJECT ${panel.primarySubject}${secondarySubjects}
ANCHOR ${worldAnchor || 'same set'} | MUST ${mustShow} | OUT ${continuity}`;
    })
    .join('\n\n');
}

function buildStoryboardSheetFooterLines(
  plan: StoryboardBoardPlan,
  storyboard: StoryboardState,
) {
  const first = plan.panels[0];
  const last = plan.panels[plan.panels.length - 1];
  return [
    `BOARD INFO: storyboard ${String(storyboard.storyboard.number).padStart(2, '0')} / ${storyboard.storyboard.name} / duration ${storyboard.storyboard.duration} / shot ${storyboard.storyboard.shotSize}`,
    `READ ORDER: S01 S02 S03 / S04 S05 S06 / S07 S08 S09`,
    `CONTINUITY: IN ${compactText(first?.continuityIn || plan.blockingContinuity?.currentStart, 90)} / OUT ${compactText(last?.continuityOut || plan.blockingContinuity?.currentEnd, 90)}`,
    `CAMERA: ${compactText([plan.cameraPlan?.cameraId, plan.cameraPlan?.cameraRelation, plan.cameraPlan?.cameraAxis, plan.cameraPlan?.lensPlan].filter(Boolean).join(' / '), 140) || 'follow shot cues'}`,
    `AUDIO MAP: ${compactText(plan.panels.map((panel) => panel.sfx || panel.audio).filter(Boolean).slice(0, 5).join(' -> '), 150) || 'dialogue, sfx, room tone follow panels'}`,
  ];
}

function buildShotSheetReadOrder(panelCount: number) {
  const columns = panelCount === 12 ? 4 : panelCount === 15 ? 5 : 3;
  const labels = Array.from({ length: panelCount }, (_, index) => formatStoryboardPanelLabel(index + 1));
  const rows: string[] = [];
  for (let index = 0; index < labels.length; index += columns) {
    rows.push(labels.slice(index, index + columns).join(' '));
  }
  return rows.join(' / ');
}

function buildShotSheetGridDescription(panelCount: number) {
  if (panelCount === 6) return '3 columns x 2 rows';
  if (panelCount === 9) return '3 columns x 3 rows';
  if (panelCount === 12) return '4 columns x 3 rows';
  return '5 columns x 3 rows';
}

function buildSequenceContinuityPromptLines(
  context?: StoryboardSequenceContinuityContext,
  currentFinalPanelLabel = 'S09',
): string[] {
  if (!context || (!context.hasPrevious && context.visualLocks.length === 0)) return [];
  return [
    'Cross-shot visual continuity locks:',
    context.previousStoryboardNumber
      ? `- Previous storyboard: ${String(context.previousStoryboardNumber).padStart(2, '0')} ${context.previousStoryboardName || ''}`.trim()
      : '',
    context.previousLastFrameInfo ? `- Previous final frame: ${context.previousLastFrameInfo}` : '',
    context.previousFinalPanel?.staticMoment ? `- Previous final panel image moment: ${context.previousFinalPanel.staticMoment}` : '',
    context.previousFinalPanel?.blocking ? `- Previous final panel blocking: ${context.previousFinalPanel.blocking}` : '',
    context.previousFinalPanel?.motion ? `- Previous final panel motion: ${context.previousFinalPanel.motion}` : '',
    context.currentContinuityIn ? `- Current S01 continuity-in: ${context.currentContinuityIn}` : '',
    context.currentContinuityOut ? `- Current ${currentFinalPanelLabel} continuity-out: ${context.currentContinuityOut}` : '',
    context.nextContinuityIn ? `- Reserve for next storyboard: ${context.nextContinuityIn}` : '',
    '- Hard rule: S01 must visually inherit previous shot final panel / END BEAT when previous context exists.',
    '- Hard rule: if a character was prone, kneeling, crouching, or grounded, S01-S03 must show that low posture before any standing transition.',
    '- Hard rule: keep phone ownership/location, danger direction, threshold/boundary, and character side assignment continuous.',
    ...context.hardRules.slice(0, 5).map((rule) => `- ${rule}`),
    ...context.warnings.slice(0, 3).map((warning) => `- Continuity warning: ${warning}`),
  ].filter(Boolean);
}

function buildSeedanceProductionBoardPrompt(
  storyboard: StoryboardState,
  references: StoryboardBoardReference[],
  plan: StoryboardBoardPlan,
  mode: StoryboardBoardMode,
  options: StoryboardBoardPromptOptions = {},
) {
  const isLandscape = mode === 'nine-landscape';
  const boardRatio = isLandscape ? '16:9 横版高清图片' : '9:16 竖版高清图片';
  const keyframeRatio = isLandscape ? '16:9 横版电影静帧' : '9:16 竖屏电影静帧';
  const panelLines = buildSeedanceBoardPanelLines(plan, isLandscape ? '横版' : '竖屏');
  const referenceLines = buildNineGridReferenceLines(references, plan);
  const sceneAnchor = sanitizeImagePromptText(plan.sceneAnchor, 220)
    || '当前分镜既定场景、空间结构、材质、光线方向保持一致';
  const worldLock = [
    plan.worldLock?.sceneName,
    plan.worldLock?.masterScene,
    plan.worldLock?.anchors?.length ? `anchors: ${plan.worldLock.anchors.slice(0, 6).join(' / ')}` : '',
    plan.worldLock?.actionZone,
  ].filter(Boolean).join('；');
  const blockingContinuity = [
    plan.blockingContinuity?.previousEnd ? `PREV END: ${sanitizeImagePromptText(plan.blockingContinuity.previousEnd, 90)}` : '',
    `START: ${sanitizeImagePromptText(plan.blockingContinuity?.currentStart, 90) || 'current start blocking'}`,
    `END: ${sanitizeImagePromptText(plan.blockingContinuity?.currentEnd, 90) || 'current end blocking'}`,
    plan.blockingContinuity?.cameraChanged ? 'CAMERA ANGLE CHANGED, WORLD POSITION LOCKED' : '',
  ].filter(Boolean).join('；');
  const cameraPlan = [
    plan.cameraPlan?.cameraId,
    plan.cameraPlan?.cameraRelation,
    plan.cameraPlan?.cameraAxis,
    plan.cameraPlan?.lensPlan,
    plan.cameraPlan?.lightPlan,
  ].filter(Boolean).join('；');
  const projectVisualStyle = options.projectVisualStyle
    || resolveStoryboardProjectVisualStyle(storyboard, plan).resolvedVisualStyle;
  const styleAnchor = sanitizeImagePromptText(plan.styleAnchor, 180)
    || projectVisualStyle;
  const propLocks = plan.propLocks.slice(0, 6).join('、');
  const consistencyRules = plan.consistencyRules.slice(0, 4).join('；');

  const footerLines = buildStoryboardSheetFooterLines(plan, storyboard);
  const referenceStyleTransferGuardLines = buildReferenceStyleTransferGuardLines(projectVisualStyle);
  const sceneFunction = compactText([
    plan.boardGoal,
    plan.blockingContinuity?.currentStart ? `IN ${plan.blockingContinuity.currentStart}` : '',
    plan.blockingContinuity?.currentEnd ? `OUT ${plan.blockingContinuity.currentEnd}` : '',
  ].filter(Boolean).join(' / '), 180);

  return [
    `生成一张给 Seedance 2.0 全能参考模式读取的「单分镜详细 storyboard sheet」，整张图是单张 ${boardRatio}。`,
    '',
    '这是给视频模型读取的导演故事板 sheet，不是漫画页、不是海报、不是情绪板、不是成片截图。整张图只服务当前单个分镜的 shot order、blocking、镜头节奏、声音提示和 transition。',
    'Step3 已经单独提供角色、场景、道具参考图；本图不得重复绘制角色设定表、场景母版、道具小窗、定位图模块、镜头光线模块或参考图拼贴区。',
    `视觉风格锁定：${projectVisualStyle}。故事板只继承当前项目风格和本镜光色情绪，不得自行切换成未声明的美术风格。`,
    '参考图风格转换硬规则：',
    ...referenceStyleTransferGuardLines,
    '',
    '整体版式硬约束（必须画进图片）：',
    `1. 整张图保持 ${boardRatio}，专业黑底导演板，顶部一条黑色 title bar，白色大标题：STORYBOARD SHEET - ${storyboard.storyboard.name.toUpperCase()}。`,
    '2. title bar 下方有一条 shared choices 黑底信息条：SHOT COUNT 9 / READ ORDER S01-S09 / COLOR & LIGHT / SCENE FINGERPRINT / AUDIO PLAN，文字短、清晰、可读。',
    `3. 主体区域固定 3-column × 3-row，共 9 个 panel；顺序严格 S01 S02 S03 / S04 S05 S06 / S07 S08 S09。每个 panel 都是完整独立的 ${keyframeRatio}，不是从同一张大图裁出的碎片。`,
    '4. 每个 panel 上半部是画面静帧，下半部必须有每格底部信息条（黑底或深灰底信息条），白字分行写：TIME / SHOT / ACTION / DIALOGUE / SFX / AUDIO / TRANSITION。信息条是故事板的一部分，必须清楚可读。',
    '5. 每格左上角必须有清晰 S01-S09 编号；镜头词可使用 WIDE / MEDIUM / CLOSE / OTS / POV / INSERT / PUSH / HOLD / CUT / MATCH CUT / END。',
    '6. 整张图底部必须有一条黑色 footer information bar，白字总结 READ ORDER、CONTINUITY IN/OUT、CAMERA、AUDIO MAP、DO NOT REDESIGN STEP3 ASSETS。',
    '7. 禁止出现任何 MODULE 字样、角色锁定模块、世界锁定模块、俯视地图模块、镜头灯光模块、道具展示模块或参考图拼贴区；这是详细故事板 sheet，不是旧版开发模块板。',
    '8. 允许短英文标签和短对白出现在故事板信息条；禁止随机乱码、长段落散文、Logo、水印、字幕烧录样式、漫画气泡和 UI 控件。',
    '',
    'Step3 参考图锁定，只作为外部参考，不画成模块或贴图区：',
    referenceLines || '- 无参考图',
    `场景锚点：${sceneAnchor}`,
    worldLock ? `世界连续：${sanitizeImagePromptText(worldLock, 240)}` : '',
    propLocks ? `关键道具：${propLocks}，只在需要的格子中出现` : '关键道具只在需要的格子中出现，不额外添加新物件。',
    `项目视觉风格：${projectVisualStyle}`,
    `本镜光色/气质补充：${styleAnchor}`,
    consistencyRules ? `连续性规则：${consistencyRules}` : '',
    blockingContinuity ? `跨分镜站位承接：${blockingContinuity}` : '',
    cameraPlan ? `机位计划：${sanitizeImagePromptText(cameraPlan, 220)}` : '',
    '',
    '故事板视觉规则：',
    '- 九格必须像 15 秒视频的 9 个关键静帧，动作连续、站位连续、镜头推进连续，且信息条能说明每格的导演意图。',
    '- 每格只保留 1 个主主体，最多 0-2 个辅助人物；背景人群只能是远处模糊人影、背影或压暗轮廓。',
    '- 每格最多 1 张清晰正脸；辅助人物用侧脸、背影、剪影或虚焦，避免多人脸混合。',
    '- 同一角色在九格中身体比例、朝向、服装轮廓和位置关系保持连续，不要跳轴、瞬移或换脸。',
    '- 必须用画面构图、站位、朝向、动作箭头和镜头距离表达调度；文字只做 storyboard sheet 标签，不替代画面。',
    '',
    '当前分镜：',
    `- 分镜：${storyboard.storyboard.number}｜${storyboard.storyboard.name}`,
    `- 时长/景别：${storyboard.storyboard.duration}｜${storyboard.storyboard.shotSize}`,
    sceneFunction ? `- 故事功能：${sceneFunction}` : '',
    '',
    'S01-S09 详细故事板执行计划（必须逐格画成 panel，并把 TIME / SHOT / ACTION / DIALOGUE / SFX / AUDIO / TRANSITION 写入每格信息条）：',
    panelLines,
    '',
    '底部 footer information bar 必须包含以下短行：',
    footerLines.join('\n'),
    '',
    '负面约束：',
    '- 禁止漫画页、四格漫画、长条漫画、拼贴海报、杂志排版、UI卡片、设计灵感板。',
    '- 禁止角色设定表、场景母版小窗、道具特写展板、俯视定位图、镜头灯光说明板、旧式开发 MODULE。',
    '- 禁止单纯把 9 张相似剧照拼在一起；必须让 S01-S09 呈现起势、推进、转折、反应、落幅的连续变化。',
    '- 禁止角色换脸、多人脸混合、背景人影变成新角色、道具形状漂移、场景方向反转。',
    '- 禁止夸张特效光污染、超现实装饰、AI塑料质感、畸形手、错误肢体、文字水印、不可读乱码。',
    '- 禁止复制参考图偶然的渲染风格、棚拍格式、相机瑕疵或修图痕迹；画面必须服从当前项目视觉风格。',
    '- 禁止露乳沟、露乳、内衣化服装、性暗示姿势或性化镜头；服装必须安全、主角感强、适合当前项目正片制作。',
  ].filter(Boolean).join('\n');
}

function buildCleanNineGridStoryboardBoardPrompt(
  storyboard: StoryboardState,
  references: StoryboardBoardReference[],
  plan: StoryboardBoardPlan,
  mode: StoryboardBoardMode,
  boardStyle: StoryboardBoardStyle,
  options: StoryboardBoardPromptOptions = {},
) {
  const isLandscape = mode === 'nine-landscape';
  const boardRatio = isLandscape ? '16:9' : '9:16';
  const cellRatio = isLandscape ? '16:9 horizontal' : '9:16 vertical';
  const styleHint = boardStyle === 'stick-figure'
    ? 'clean low-fidelity directing board'
    : boardStyle === 'seedance-board'
      ? 'clean Seedance director board'
      : 'clean cinematic storyboard board';
  const panelLines = buildNineGridPanelLines(plan, isLandscape ? '横版' : '竖屏');
  const referenceLines = buildNineGridReferenceLines(references, plan);
  const sequenceContinuityLines = buildSequenceContinuityPromptLines(options.sequenceContinuityContext);
  const directorBriefLines = buildDirectorBriefLines(plan);
  const projectVisualStyle = options.projectVisualStyle
    || resolveStoryboardProjectVisualStyle(storyboard, plan).resolvedVisualStyle;
  const renderingContractLines = buildStoryboardRenderingContractLines(references, mode, true, projectVisualStyle);

  return [
    `Generate a clean ${boardRatio} 3x3 visual storyboard layer for Seedance 2.0.`,
    `Each of the 9 cells must be a complete ${cellRatio} keyframe. Do not crop a vertical cell into a horizontal strip, and do not crop a horizontal cell into a vertical strip.`,
    'This image is only the visual layer. A program will add S01-S09, TIME, SHOT, ACTION, DIALOGUE, SFX, AUDIO, TRANSITION and footer text later.',
    'Do not render any visible text, labels, subtitles, title bars, footer bars, arrows, logos, watermarks, or module names.',
    'Do not make poster tiles, contact sheets, comics, moodboards, or repeated crops. Each panel must be a distinct shot with readable blocking and motion.',
    `Board format target: ${styleHint}.`,
    `Current project visual style: ${projectVisualStyle}.`,
    `Board goal: ${compactText(plan.boardGoal) || storyboard.storyboard.name}`,
    `Scene anchor: ${compactText(plan.sceneAnchor) || storyboard.storyboard.scene || 'current scene'}`,
    `Shot color/mood supplement: ${compactText(plan.styleAnchor) || storyboard.storyboard.shotSize || 'follow the project visual style'}`,
    '',
    ...directorBriefLines,
    directorBriefLines.length > 0 ? '' : '',
    ...renderingContractLines,
    '',
    'Reference images are for identity / scene / prop locking only:',
    referenceLines || '- no reference images',
    '',
    ...sequenceContinuityLines,
    sequenceContinuityLines.length > 0 ? '' : '',
    'Visual cues for the 3x3 cells:',
    panelLines,
    '',
    'Reading order:',
    'S01 S02 S03 / S04 S05 S06 / S07 S08 S09',
    '',
    'Negative rules:',
    '- no visible text, numbers, labels, subtitles, arrows, charts, borders, template modules, logos, watermarks, or UI elements',
    '- no redesign of Step3 assets',
    '- final video must not preserve board borders or board text',
  ].join('\n');
}

function buildSmartShotPlanStoryboardBoardPrompt(
  storyboard: StoryboardState,
  references: StoryboardBoardReference[],
  plan: StoryboardBoardPlan,
  boardStyle: StoryboardBoardStyle,
  options: StoryboardBoardPromptOptions = {},
) {
  const panelCount = [6, 9, 12, 15].includes(plan.panels.length) ? plan.panels.length : 15;
  const finalLabel = formatStoryboardPanelLabel(panelCount);
  const boardRatio = '16:9 horizontal image';
  const targetFrameRatio = options.frameRatio === '9:16' ? '9:16' : '16:9';
  const targetFrameRule = targetFrameRatio === '9:16'
    ? 'TARGET VIDEO FRAME: 9:16 vertical. Increase face readability, close/medium-close emotional beats, center-safe upper-body blocking, vertical depth, and reduce wide horizontal tracking grammar.'
    : 'TARGET VIDEO FRAME: 16:9 horizontal. Wider spatial blocking is allowed, but protagonist reaction and final handoff must stay readable.';
  const gridDescription = buildShotSheetGridDescription(panelCount);
  const readOrder = buildShotSheetReadOrder(panelCount);
  const layoutRule = `single 16:9 horizontal cinematic storyboard sheet, same tuned black production-board structure as the fixed 15-panel template; only the main grid changes to exactly ${gridDescription}, ${panelCount} numbered panels, read ${readOrder}.`;
  const referenceLines = buildNineGridReferenceLines(references, plan);
  const sequenceContinuityLines = buildSequenceContinuityPromptLines(options.sequenceContinuityContext, finalLabel);
  const directorBriefLines = buildDirectorBriefLines(plan);
  const projectVisualStyle = options.projectVisualStyle
    || resolveStoryboardProjectVisualStyle(storyboard, plan).resolvedVisualStyle;
  const renderingContractLines = buildStoryboardRenderingContractLines(references, plan.mode, false, projectVisualStyle, panelCount);
  const referenceStyleTransferGuardLines = buildReferenceStyleTransferGuardLines(projectVisualStyle);
  const characterLockLine = compactText(
    plan.characterLocks
      ?.filter((lock) => lock.role !== 'background')
      .map((lock) => lock.name)
      .join(' / '),
    120,
  ) || 'use the locked character names explicitly';
  const uiPolicyLine = compactText(plan.directorContract?.uiContinuity, 220)
    || 'if UI or countdown exists, show only plot-required readable digits on the first clear reveal, then blur / glow / placeholder later; no random digits';
  const panelLines = plan.panels
    .slice(0, panelCount)
    .map((panel) => [
      `PANEL ${formatStoryboardPanelLabel(panel.index)} | ${panel.timeRange || panel.beat}`,
      `CHARACTERS: ${characterLockLine}`,
      `CAMERA / MOVEMENT: ${compactText([panel.shotType, panel.cameraAngle, panel.cameraTask].filter(Boolean).join(' / '), 120)}`,
      `ACTION: ${sanitizeImagePromptText(panel.staticMoment || panel.motion || panel.beat, 160)}`,
      `BLOCKING: ${sanitizeImagePromptText(panel.blocking || panel.composition, 150)}`,
      `UI / COUNTDOWN STRATEGY: ${uiPolicyLine}`,
      `SOUND: ${compactText([panel.dialogue, panel.sfx, panel.audio].filter(Boolean).join(' / '), 130) || 'breath, ambience, movement'}`,
      `TRANSITION: ${compactText(panel.transition || (panel.index === panelCount ? 'HOLD ON END BEAT' : 'CUT'), 60)}`,
      `HANDOFF: ${sanitizeImagePromptText(panel.continuityOut || panel.continuity, 120)}`,
    ].filter(Boolean).join('\n'))
    .join('\n\n');
  const firstPanel = plan.panels[0];
  const lastPanel = plan.panels[panelCount - 1] ?? plan.panels[plan.panels.length - 1];
  const title = compactText(storyboard.storyboard.name, 64).toUpperCase();
  const sceneOverview = compactText(plan.boardGoal || storyboard.storyboard.scene || storyboard.storyboard.name, 180);
  const firstFrame = compactText(firstPanel?.continuityIn || plan.blockingContinuity?.currentStart || firstPanel?.staticMoment, 130);
  const endBeat = compactText(lastPanel?.continuityOut || plan.blockingContinuity?.currentEnd || lastPanel?.staticMoment, 130);
  const previousEndBeat = compactText(
    plan.transitionBridge?.previousEndBeat
      || options.sequenceContinuityContext?.previousFinalPanel?.continuityOut
      || options.sequenceContinuityContext?.previousFinalPanel?.staticMoment
      || options.sequenceContinuityContext?.previousLastFrameInfo,
    150,
  );
  const transitionType = compactText(plan.transitionBridge?.transitionType, 80)
    || (previousEndBeat ? 'director-chosen continuity transition' : 'fresh opening');
  const transitionRationale = compactText(plan.transitionBridge?.transitionRationale, 150);
  const visualBridge = compactText(plan.transitionBridge?.visualBridge, 150);
  const soundBridge = compactText(plan.transitionBridge?.soundBridge, 120);
  const cameraBridge = compactText(plan.transitionBridge?.cameraBridge, 120);
  const firstFrameInstruction = compactText(plan.transitionBridge?.firstFrameInstruction || firstFrame, 140);
  const directorContract = plan.directorContract;
  const characterZones = directorContract?.characterZones?.length
    ? directorContract.characterZones.map((rule) => `- ${compactText(rule, 160)}`).join('\n')
    : '- lock character zones before drawing panels';
  const rejectionRules = directorContract?.rejectionRules?.length
    ? directorContract.rejectionRules.slice(0, 8).map((rule) => `- ${compactText(rule, 150)}`).join('\n')
    : '- reject spatial jumps, random UI digits, sudden mechanism changes, repeated composition, broken START->S01 bridge, broken final panel->END BEAT handoff, or duplicate-cropped bridge frames';

  return [
    `Directly generate one adaptive detailed cinematic storyboard sheet for Seedance 2.0. Output is the final director reference image itself, not a clean visual layer and not a program-composed overlay. Canvas: ${boardRatio}.`,
    '',
    'Use the tuned fixed 15-panel shot-sheet template as the base. This is a layout contract only, not an art-style override:',
    '- Keep the same top title bar, START FRAME / TRANSITION IN hero strip, per-panel cinematic keyframe + info bar language, six-section black footer, and END BEAT thumbnail rules from the 15-panel template.',
    `- Only replace the 15-panel main body with the adaptive ${panelCount}-panel body and upgraded read order: ${readOrder}.`,
    `PROJECT VISUAL STYLE LOCK: ${projectVisualStyle}. All Step3 references must be re-rendered in this project style while preserving only their assigned identity / outfit / scene / prop locks.`,
    targetFrameRule,
    `- Layout: ${layoutRule}`,
    `- Top black title bar: left text "PART 1/1 | SMART ${panelCount}-BEAT SHOT SHEET", large centered title "${title}", right metadata block "GENRE / TONE / LOCATION".`,
    '- Below the title, create one wide hero strip: left column must contain SCENE OVERVIEW plus a compact START FRAME / TRANSITION IN FROM PREVIOUS END BEAT block; center/right must be a cinematic START FRAME image for this shot, no poster composition and no random reference collage.',
    '- The START FRAME image is a TRANSITION IN bridge from the previous END BEAT into the current shot. It may use match cut, J-cut, L-cut, smash cut, montage, or same-space pre-roll. It must not be a duplicate crop of S01.',
    `- The TRANSITION IN block is director planning for how this shot enters from the previous storyboard end beat. It is not an extra panel and must not consume S01-${finalLabel} time.`,
    `- Main body: exactly ${panelCount} panels in ${gridDescription}. ${getSmartStoryboardLayoutRule(panelCount)}. Every panel has a cinematic keyframe on top and a black information bar below.`,
    '- Every panel must have a small red number square at top-left, a black timecode capsule at top-right, thin white grid lines, and short readable English labels.',
    '- Panel info labels must be fixed and concise: CAMERA / MOVEMENT in blue, ACTION in white, SOUND in yellow/orange, TRANSITION in red/orange. If a quoted dialogue line is shown, keep the source language verbatim: English stays English, Chinese stays Chinese, mixed-language dialogue stays mixed. If full dialogue is not essential for the board, summarize it as original-language spoken dialogue without translating the quote.',
    '- Bottom black footer must have six sections in one row: DIRECTOR NOTES, CAMERA LANGUAGE, SOUND DESIGN APPROACH, LIGHT & ATMOSPHERE, COLOR & MOOD, END BEAT.',
    `- The END BEAT footer section must include a small separate cinematic thumbnail image after ${finalLabel}, showing the next-shot handoff/final hold rather than a duplicate crop of ${finalLabel}; this thumbnail is mandatory.`,
    `- S01 is the first current-shot action anchor after the transition bridge. ${finalLabel} is the final current-shot action anchor. START FRAME and END BEAT are bridge/handoff images around the panel sequence, not repeated panels.`,
    '- Text must be legible and sparse: short English production-board phrases only. The visual stills must carry the story; text clarifies camera/action/sound/transition.',
    '',
    `PREVIOUS END BEAT: ${previousEndBeat || 'none / fresh opening'}`,
    `TRANSITION IN METHOD: ${transitionType}${transitionRationale ? ` — ${transitionRationale}` : ''}`,
    visualBridge ? `TRANSITION IN VISUAL BRIDGE: ${visualBridge}` : '',
    soundBridge ? `TRANSITION IN SOUND BRIDGE: ${soundBridge}` : '',
    cameraBridge ? `TRANSITION IN CAMERA BRIDGE: ${cameraBridge}` : '',
    `S01 ENTRY INSTRUCTION: ${firstFrameInstruction || `begin the current ${panelCount}-beat shot, not a recap of the previous shot`}`,
    `START FRAME LOCK: ${firstFrameInstruction || firstFrame || 'top hero strip must bridge previous END BEAT into S01 without duplicating S01'}`,
    `FIRST FRAME LOCK: ${firstFrame || 'inherit previous shot and establish current action start'}`,
    `END BEAT LOCK: ${endBeat || 'hold on final readable handoff frame'}`,
    `END BEAT THUMBNAIL: draw a small bottom-right insert image showing ${endBeat || 'the final handoff object or final frame anchor'}; it must be inside the END BEAT footer section.`,
    '',
    ...directorBriefLines,
    directorBriefLines.length > 0 ? '' : '',
    ...renderingContractLines,
    '',
    'REFERENCE STYLE TRANSFER GUARD (highest priority):',
    ...referenceStyleTransferGuardLines,
    '',
    `DIRECTOR PREFLIGHT CONTRACT (must be obeyed before drawing START FRAME, S01-${finalLabel}, and END BEAT):`,
    `SPATIAL CONTRACT: ${compactText(directorContract?.spatialContract, 180) || 'lock the world axis, boundary line, character zones, prop positions, and danger direction before choosing camera angles'}`,
    'CHARACTER ZONES:',
    characterZones,
    `MECHANISM / DOOR STATE: ${compactText(directorContract?.mechanismState, 360) || 'define any door, gate, screen, weapon, or mechanism state before it changes; no sudden opening, closing, or prop teleporting'}`,
    `DIEGETIC UI / COUNTDOWN: ${compactText(directorContract?.uiContinuity, 220) || 'if UI or countdown exists, show only plot-required readable digits; otherwise use glow, blur, tick, or placeholder; no random numbers'}`,
    `BEAT PROGRESSION: ${compactText(directorContract?.beatProgression, 260) || `each of the ${panelCount} panels must advance one visible beat; do not repeat the same subject / framing for more than two panels; show visible contact frames before causal results`}`,
    `START FRAME CONTRACT: ${compactText(directorContract?.startFrameContract, 180) || 'top START FRAME must be an incoming bridge from previous END BEAT into S01 and must not duplicate S01'}`,
    `END BEAT CONTRACT: ${compactText(directorContract?.endBeatContract, 180) || `bottom END BEAT thumbnail must be an outgoing handoff after ${finalLabel}, not a duplicate of ${finalLabel}`}`,
    'REJECTION RULES:',
    rejectionRules,
    '',
    'External Step3 reference images are identity / scene / prop locks only. Do not paste them as reference modules inside the sheet:',
    referenceLines || '- 无参考图',
    '',
    `当前分镜：${storyboard.storyboard.number} · ${storyboard.storyboard.name} · ${storyboard.storyboard.duration}`,
    `场景锚点：${sanitizeImagePromptText(plan.sceneAnchor, 180)}`,
    `项目视觉风格：${projectVisualStyle}`,
    `本镜光色/气质补充：${sanitizeImagePromptText(plan.styleAnchor, 160) || 'follow the project visual style'}`,
    ...sequenceContinuityLines,
    '',
    `SCENE OVERVIEW TEXT: ${sceneOverview || 'an adaptive cinematic beat with clear action escalation and a readable final handoff'}`,
    '',
    `${panelCount}-PANEL ADAPTIVE SHOT SHEET PLAN (draw all ${Math.min(plan.panels.length, panelCount)} panels in order; do not add empty placeholder panels):`,
    panelLines,
    '',
    'Negative rules:',
    '- Do not make a clean visual-only grid, a freeform collage, a poster, or a normal nine-grid storyboard. This must be the adaptive detailed shot sheet based on the tuned 15-panel template.',
    `- Do not revert to fixed 15 panels when panelCount is ${panelCount}. The main body must contain exactly ${panelCount} panels in ${gridDescription}, read ${readOrder}.`,
    '- Do not create MODULE A-F, character sheet boxes, prop display modules, overhead maps, reference collage areas, UI cards, posters, comic balloons, subtitles, logos, watermarks, random illegible text, or alternate footer sections.',
    '- Do not redesign Step3 characters, costumes, scene, or props. Keep first frame and end beat continuous with the cross-shot locks.',
    '- Do not copy accidental reference-image render artifacts; redraw every lock in the current project visual style.',
    '- Do not switch to any undeclared aesthetic or medium; the layout is adaptive, but the visual style comes only from the current project style.',
    '- No cleavage, exposed breasts, lingerie styling, sexualized posing, or sexualized camera emphasis; keep all costumes production-safe and protagonist-grade.',
    '- Do not let door/gate/mechanism state change without a visible action chain. Do not let countdown digits jump randomly. Do not skip causal contact frames.',
    boardStyle === 'stick-figure'
      ? 'Style: low-fidelity director sketch sheet, but still keep the same title band, adaptive panels, and info bars.'
      : boardStyle === 'seedance-board'
        ? `Style: ${projectVisualStyle}; detailed Seedance control sheet, readable labels, dark professional storyboard layout.`
        : `Style: ${projectVisualStyle}; keyframe storyboard sheet close to final film composition while retaining clear director-board readability.`,
  ].filter(Boolean).join('\n');
}

function buildNineGridStoryboardBoardPrompt(
  storyboard: StoryboardState,
  references: StoryboardBoardReference[],
  plan: StoryboardBoardPlan,
  mode: StoryboardBoardMode,
  boardStyle: StoryboardBoardStyle = 'cinematic',
  options: StoryboardBoardPromptOptions = {},
) {
  if (isSmartShotPlanBoardMode(mode)) {
    return buildSmartShotPlanStoryboardBoardPrompt(storyboard, references, plan, boardStyle, options);
  }
  if (!isFixedShotPlanBoardMode(mode)) {
    return buildCleanNineGridStoryboardBoardPrompt(storyboard, references, plan, mode, boardStyle, options);
  }
  if (isFixedShotPlanBoardMode(mode)) {
    const boardRatio = '16:9 horizontal image';
    const layoutRule = 'single 16:9 horizontal cinematic storyboard sheet, fixed black production-board layout, top title bar, wide START FRAME / transition-in hero strip, main grid is exactly 5 columns x 3 rows, 15 numbered panels, read S01-S05 / S06-S10 / S11-S15.';
    const referenceLines = buildNineGridReferenceLines(references, plan);
    const sequenceContinuityLines = buildSequenceContinuityPromptLines(options.sequenceContinuityContext, 'S15');
    const directorBriefLines = buildDirectorBriefLines(plan);
    const projectVisualStyle = options.projectVisualStyle
      || resolveStoryboardProjectVisualStyle(storyboard, plan).resolvedVisualStyle;
    const renderingContractLines = buildStoryboardRenderingContractLines(references, mode, false, projectVisualStyle, 15);
    const referenceStyleTransferGuardLines = buildReferenceStyleTransferGuardLines(projectVisualStyle);
    const characterLockLine = compactText(
      plan.characterLocks
        ?.filter((lock) => lock.role !== 'background')
        .map((lock) => lock.name)
        .join(' / '),
      120,
    ) || 'use the locked character names explicitly';
    const uiPolicyLine = compactText(plan.directorContract?.uiContinuity, 220)
      || 'if UI or countdown exists, show only the plot-required readable digits on the first clear reveal, then use blur / glow / tick / placeholder on later panels; no random digits';
    const panelLines = plan.panels
      .slice(0, 15)
      .map((panel) => [
        `PANEL S${String(panel.index).padStart(2, '0')} | ${panel.timeRange || panel.beat}`,
        `CHARACTERS: ${characterLockLine}`,
        `CAMERA / MOVEMENT: ${compactText([panel.shotType, panel.cameraAngle, panel.cameraTask].filter(Boolean).join(' / '), 120)}`,
        `ACTION: ${sanitizeImagePromptText(panel.staticMoment || panel.motion || panel.beat, 160)}`,
        `BLOCKING: ${sanitizeImagePromptText(panel.blocking || panel.composition, 150)}`,
        `UI / COUNTDOWN STRATEGY: ${uiPolicyLine}`,
        `SOUND: ${compactText([panel.dialogue, panel.sfx, panel.audio].filter(Boolean).join(' / '), 130) || 'breath, ambience, movement'}`,
        `TRANSITION: ${compactText(panel.transition || (panel.index === 15 ? 'HOLD ON END BEAT' : 'CUT'), 60)}`,
        `HANDOFF: ${sanitizeImagePromptText(panel.continuityOut || panel.continuity, 120)}`,
      ].filter(Boolean).join('\n'))
      .join('\n\n');
    const firstPanel = plan.panels[0];
    const lastPanel = plan.panels[plan.panels.length - 1];
    const title = compactText(storyboard.storyboard.name, 64).toUpperCase();
    const sceneOverview = compactText(plan.boardGoal || storyboard.storyboard.scene || storyboard.storyboard.name, 180);
    const firstFrame = compactText(firstPanel?.continuityIn || plan.blockingContinuity?.currentStart || firstPanel?.staticMoment, 130);
    const endBeat = compactText(lastPanel?.continuityOut || plan.blockingContinuity?.currentEnd || lastPanel?.staticMoment, 130);
    const previousEndBeat = compactText(
      plan.transitionBridge?.previousEndBeat
        || options.sequenceContinuityContext?.previousFinalPanel?.continuityOut
        || options.sequenceContinuityContext?.previousFinalPanel?.staticMoment
        || options.sequenceContinuityContext?.previousLastFrameInfo,
      150,
    );
    const transitionType = compactText(plan.transitionBridge?.transitionType, 80)
      || (previousEndBeat ? 'director-chosen continuity transition' : 'fresh opening');
    const transitionRationale = compactText(plan.transitionBridge?.transitionRationale, 150);
    const visualBridge = compactText(plan.transitionBridge?.visualBridge, 150);
    const soundBridge = compactText(plan.transitionBridge?.soundBridge, 120);
    const cameraBridge = compactText(plan.transitionBridge?.cameraBridge, 120);
    const firstFrameInstruction = compactText(plan.transitionBridge?.firstFrameInstruction || firstFrame, 140);
    const directorContract = plan.directorContract;
    const characterZones = directorContract?.characterZones?.length
      ? directorContract.characterZones.map((rule) => `- ${compactText(rule, 160)}`).join('\n')
      : '- lock character zones before drawing panels';
    const rejectionRules = directorContract?.rejectionRules?.length
      ? directorContract.rejectionRules.slice(0, 8).map((rule) => `- ${compactText(rule, 150)}`).join('\n')
      : '- reject spatial jumps, random UI digits, sudden mechanism changes, repeated composition, broken START->S01 bridge, broken S15->END BEAT handoff, or duplicate-cropped bridge frames';

    return [
      `Directly generate one fixed-format detailed cinematic storyboard sheet for Seedance 2.0. Output is the final director reference image itself, not a clean visual layer and not a program-composed overlay. Canvas: ${boardRatio}.`,
      '',
      'Use the fixed professional 15-panel shot-sheet layout reference. This is a layout contract only, not an art-style override:',
      `PROJECT VISUAL STYLE LOCK: ${projectVisualStyle}. All Step3 references must be re-rendered in this project style while preserving only their assigned identity / outfit / scene / prop locks.`,
      `- Layout: ${layoutRule}`,
      `- Top black title bar: left text "PART 1/1 | 15-SECOND CLIMACTIC BEAT", large centered title "${title}", right metadata block "GENRE / TONE / LOCATION".`,
      '- Below the title, create one wide hero strip: left column must contain SCENE OVERVIEW plus a compact START FRAME / TRANSITION IN FROM PREVIOUS END BEAT block; center/right must be a cinematic START FRAME image for this shot, no poster composition and no random reference collage.',
      '- The START FRAME image is a TRANSITION IN bridge from the previous END BEAT into S01. It may use match cut, J-cut, L-cut, smash cut, montage, or same-space pre-roll. It must not be a duplicate crop of S01.',
      '- The TRANSITION IN block is director planning for how this shot enters from the previous storyboard end beat. It is not an extra panel and must not consume S01-S15 time.',
      '- Main body: exactly 15 panels in 5 columns x 3 rows. Row 1 is S01-S05, row 2 is S06-S10, row 3 is S11-S15. Every panel has a cinematic keyframe on top and a black information bar below.',
      '- Every panel must have a small red number square at top-left, a black timecode capsule at top-right, thin white grid lines, and short readable English labels.',
      '- Panel info labels must be fixed and concise: CAMERA / MOVEMENT in blue, ACTION in white, SOUND in yellow/orange, TRANSITION in red/orange. If a quoted dialogue line is shown, keep the source language verbatim: English stays English, Chinese stays Chinese, mixed-language dialogue stays mixed. If full dialogue is not essential for the board, summarize it as original-language spoken dialogue without translating the quote.',
      '- Bottom black footer must have six sections in one row: DIRECTOR NOTES, CAMERA LANGUAGE, SOUND DESIGN APPROACH, LIGHT & ATMOSPHERE, COLOR & MOOD, END BEAT.',
      '- The END BEAT footer section must include a small separate cinematic thumbnail image at the far right, showing the next-shot handoff/final hold after S15 rather than a duplicate crop of S15. This thumbnail is mandatory, not optional.',
      '- S01 is the first current-shot action anchor after the transition bridge. S15 is the final current-shot action anchor before the outgoing handoff. START FRAME and END BEAT are bridge/handoff images around the panel sequence, not repeated panels.',
      '- Text must be legible and sparse: short English production-board phrases only. The visual stills must carry the story; text clarifies camera/action/sound/transition.',
      '',
      `PREVIOUS END BEAT: ${previousEndBeat || 'none / fresh opening'}`,
      `TRANSITION IN METHOD: ${transitionType}${transitionRationale ? ` — ${transitionRationale}` : ''}`,
      visualBridge ? `TRANSITION IN VISUAL BRIDGE: ${visualBridge}` : '',
      soundBridge ? `TRANSITION IN SOUND BRIDGE: ${soundBridge}` : '',
      cameraBridge ? `TRANSITION IN CAMERA BRIDGE: ${cameraBridge}` : '',
      `S01 ENTRY INSTRUCTION: ${firstFrameInstruction || 'begin the current 15-second shot, not a recap of the previous shot'}`,
      `START FRAME LOCK: ${firstFrameInstruction || firstFrame || 'top hero strip must bridge previous END BEAT into S01 without duplicating S01'}`,
      `FIRST FRAME LOCK: ${firstFrame || 'inherit previous shot and establish current action start'}`,
      `END BEAT LOCK: ${endBeat || 'hold on final readable handoff frame'}`,
      `END BEAT THUMBNAIL: draw a small bottom-right insert image showing ${endBeat || 'the final handoff object or final frame anchor'}; it must be inside the END BEAT footer section.`,
      '',
      ...directorBriefLines,
      directorBriefLines.length > 0 ? '' : '',
      ...renderingContractLines,
      '',
      'REFERENCE STYLE TRANSFER GUARD (highest priority):',
      ...referenceStyleTransferGuardLines,
      '',
      'DIRECTOR PREFLIGHT CONTRACT (must be obeyed before drawing START FRAME, S01-S15, and END BEAT):',
      `SPATIAL CONTRACT: ${compactText(directorContract?.spatialContract, 180) || 'lock the world axis, boundary line, character zones, prop positions, and danger direction before choosing camera angles'}`,
      'CHARACTER ZONES:',
      characterZones,
      `MECHANISM / DOOR STATE: ${compactText(directorContract?.mechanismState, 360) || 'define any door, gate, screen, weapon, or mechanism state before it changes; no sudden opening, closing, or prop teleporting'}`,
      `DIEGETIC UI / COUNTDOWN: ${compactText(directorContract?.uiContinuity, 220) || 'if UI or countdown exists, show only plot-required readable digits; otherwise use glow, blur, tick, or placeholder; no random numbers'}`,
      `BEAT PROGRESSION: ${compactText(directorContract?.beatProgression, 260) || 'each second must advance one visible beat; do not repeat the same subject / framing for more than two panels; show visible contact frames before any causal result'}`,
      `START FRAME CONTRACT: ${compactText(directorContract?.startFrameContract, 180) || 'top START FRAME must be an incoming bridge from previous END BEAT into S01 and must not duplicate S01'}`,
      `END BEAT CONTRACT: ${compactText(directorContract?.endBeatContract, 180) || 'bottom END BEAT thumbnail must be an outgoing handoff after S15, not a duplicate of S15'}`,
      'REJECTION RULES:',
      rejectionRules,
      '',
      'External Step3 reference images are identity / scene / prop locks only. Do not paste them as reference modules inside the sheet:',
      referenceLines || '- 无参考图',
      '',
      `当前分镜：${storyboard.storyboard.number} · ${storyboard.storyboard.name} · ${storyboard.storyboard.duration}`,
      `场景锚点：${sanitizeImagePromptText(plan.sceneAnchor, 180)}`,
      `项目视觉风格：${projectVisualStyle}`,
      `本镜光色/气质补充：${sanitizeImagePromptText(plan.styleAnchor, 160) || 'follow the project visual style'}`,
      ...sequenceContinuityLines,
      '',
      `SCENE OVERVIEW TEXT: ${sceneOverview || 'a 15-second cinematic beat with clear action escalation and a readable final handoff'}`,
      '',
      `15-PANEL SHOT SHEET PLAN (draw all ${Math.min(plan.panels.length, 15)} panels in order):`,
      panelLines,
      '',
      'Negative rules:',
      '- Do not make a clean 3x3 visual-only grid, a 3 columns x 5 rows vertical stack, a freeform collage, or a poster. This must be the fixed 5 columns x 3 rows detailed shot sheet.',
      '- Do not create MODULE A-F, character sheet boxes, prop display modules, overhead maps, reference collage areas, UI cards, posters, comic balloons, subtitles, logos, watermarks, random illegible text, or alternate footer sections.',
      '- Do not redesign Step3 characters, costumes, scene, or props. Do not add unrelated characters. Keep first frame and end beat continuous with the cross-shot locks.',
      '- Do not copy accidental reference-image render artifacts, source lighting, retouching, camera texture, or production format; redraw every lock in the current project visual style.',
      '- Do not switch to any undeclared aesthetic or medium; the layout is fixed, but the visual style comes only from the current project style.',
      '- No cleavage, exposed breasts, lingerie styling, sexualized posing, or sexualized camera emphasis; keep all anime costumes production-safe and protagonist-grade.',
      '- Do not let door/gate/mechanism state change without a visible action chain. Do not let countdown digits jump randomly. Do not repeat the same front-facing shot for three panels when the plan requires a new beat.',
      '- Do not skip causal contact frames: draw the boot impact, plug insertion, button press, bite, strike, or handoff before drawing sparks, explosion, collapse, electrocution, or aftermath.',
      boardStyle === 'stick-figure'
        ? 'Style: low-fidelity director sketch sheet, but still keep the same title band, 15 panels, and info bars.'
        : boardStyle === 'seedance-board'
          ? `Style: ${projectVisualStyle}; detailed Seedance control sheet, readable labels, dark professional storyboard layout.`
          : `Style: ${projectVisualStyle}; keyframe storyboard sheet close to final film composition while retaining clear director-board readability.`,
    ].filter(Boolean).join('\n');
  }

  if (boardStyle === 'seedance-board') {
    return buildSeedanceProductionBoardPrompt(storyboard, references, plan, mode, options);
  }

  if (boardStyle === 'stick-figure') {
    const isLandscape = mode === 'nine-landscape';
    const panelLines = plan.panels
      .slice(0, 9)
      .map((panel) => [
        `${String(panel.index).padStart(2, '0')}｜${panel.timeRange || panel.beat}`,
        `主体=${panel.primarySubject}${panel.secondarySubjects.length > 0 ? `；辅助=${panel.secondarySubjects.slice(0, 2).join('、')}` : ''}`,
        `站位=${panel.blocking || panel.composition}`,
        `动作=${panel.motion || panel.staticMoment}`,
        `镜头=${panel.cameraTask || `${panel.shotType}，${panel.cameraAngle}`}`,
        `落幅=${panel.continuity}`,
      ].join('\n'))
      .join('\n\n');
    const boardRatio = isLandscape ? '16:9 横版图片' : '9:16 竖版图片';
    const cellRatio = isLandscape ? '16:9 横屏小格' : '9:16 竖屏小格';

    return [
      `生成一张干净的火柴人导演草图九宫格，整张图为单张 ${boardRatio}，固定 3x3，共 9 个等大 ${cellRatio}。`,
      '',
      '核心要求：',
      '1. 这是给视频模型看的导演调度图，不是成片画面、不是漫画、不是海报。',
      '2. 只用黑白线稿、火柴人、简单剪影、地面线、门窗/桌椅等极简空间线框表达站位、朝向、动作起止、镜头重心。',
      '3. 禁止绘制真实五官、发型、服装花纹、皮肤、材质、复杂光影；角色外观以后续角色参考图为准。',
      '4. 禁止文字说明、对白、气泡、字幕、Logo、水印、箭头文字；每格只允许左上角极小数字 1-9。',
      '5. 九格必须按 1-9 连续推进：起势、推进、冲突、转折、落幅都要清晰。',
      '6. 每格边界清楚，人物和道具不得跨格；同一角色在九格中用一致的简单符号和相对身高表达。',
      '',
      '参考图只用于识别角色/场景/道具身份，不要复制参考图细节到草图里：',
      buildNineGridReferenceLines(references, plan) || '- 无参考图',
      '',
      '当前分镜：',
      `- 分镜：${storyboard.storyboard.number}｜${storyboard.storyboard.name}`,
      `- 场景锚点：${sanitizeImagePromptText(plan.sceneAnchor, 180)}`,
      `- 风格锚点：火柴人导演草图，低保真、强调动作与镜头，不表现成片美术质感`,
      '',
      '九宫格导演计划：',
      panelLines,
    ].join('\n');
  }

  const referenceLines = buildNineGridReferenceLines(references, plan);
  const isLandscape = mode === 'nine-landscape';
  const panelLines = buildNineGridPanelLines(plan, isLandscape ? '横版' : '竖屏');
  const propLocks = plan.propLocks.slice(0, 8).join('、');
  const sceneAnchor = sanitizeImagePromptText(plan.sceneAnchor, 180) || '当前分镜既定场景、空间关系与道具陈设保持一致';
  const projectVisualStyle = options.projectVisualStyle
    || resolveStoryboardProjectVisualStyle(storyboard, plan).resolvedVisualStyle;
  const styleAnchor = sanitizeImagePromptText(plan.styleAnchor, 160) || projectVisualStyle;
  const boardTitle = isLandscape ? '生成一张横版导演关键帧九宫格基图。' : '生成一张导演关键帧九宫格基图。';
  const boardRatio = isLandscape ? '16:9 横版图片' : '9:16 竖版图片';
  const cellRatio = isLandscape ? '16:9 横版电影静帧' : '9:16 窄竖屏电影静帧';
  const invalidCellRatios = isLandscape ? '禁止竖格、方格、漫画格、海报拼贴、把一张大图裁成九块。' : '禁止方格、横格、漫画格、海报拼贴、把一张大图裁成九块。';
  const boardName = isLandscape ? '横版九宫格' : '九宫格';

  return [
    boardTitle,
    '',
    '最高优先级硬约束：',
    `1. 整张图必须是单张 ${boardRatio}，固定 3列×3行，共 9 个等大小格，等比例切分，宫格铺满画布。`,
    `2. 每个小格本身都必须是完整独立的 ${cellRatio}，不是从同一张大画面裁出的碎片；${invalidCellRatios}`,
    '3. 所有小格边界清晰、格间距统一；人物、道具、背景、光影绝不跨格。',
    '4. 顺序严格从左到右、从上到下：1 2 3 / 4 5 6 / 7 8 9。',
    '5. 唯一允许的文字元素：每格左上角极小、统一、低干扰的数字 1-9；除此之外禁止任何文字、字幕、标题、对白、Logo、水印。',
    '6. 角色外观完全以绑定参考图为唯一依据；提示词里的角色文字只表示身份，不重新设计五官、发型、服装、配饰或妆容。',
    '7. 每格只保留 1 个主主体，最多 0-2 个辅助人物；无关人物必须虚焦、背影、剪影、退后景或不出现，禁止每格塞满群像。',
    '8. 每个小格最多允许 1 张清晰可辨认的正脸；辅助人物只能是侧脸、背影、虚焦或剪影，避免多人脸混合。',
    '9. “群像/众人/见证者”只能表现为远处模糊人影或压暗轮廓，不允许生成多张清晰新脸。',
    '',
    '参考图锁定：',
    referenceLines || '- 无参考图',
    '',
    '当前分镜锚点：',
    `- 分镜：${storyboard.storyboard.number}｜${storyboard.storyboard.name}`,
    `- 场景：${sceneAnchor}`,
    `- 项目视觉风格：${projectVisualStyle}`,
    `- 本镜光色/气质补充：${styleAnchor}`,
    propLocks ? `- 关键道具：${propLocks}` : '- 关键道具：仅保留当前格需要出现的道具，不额外添加新物件',
    '',
    `${boardName}内容规划（严格逐格执行）：`,
    panelLines,
    '',
    '负面约束：',
    '- 禁止漫画分镜页、手绘 storyboard、概念图 moodboard、杂志排版、UI卡片、封面海报感。',
    '- 禁止速度线、动作残影、镜头轨迹线、箭头、说明框、对白气泡、时间码、参数文字。',
    '- 禁止复述角色外貌细节；禁止根据文字重画角色；禁止把所有参考人物同时塞进每格。',
    '- 禁止在同一小格内生成两张以上清晰正脸；禁止把背景人影画成清晰新角色。',
    '- 禁止夸张特效光效、超现实元素、过度磨皮、AI塑料感、畸形手、错脸、多人脸混合。',
  ].join('\n');
}

export function buildStoryboardBoardPrompt(
  storyboard: StoryboardState,
  references: StoryboardBoardReference[],
  mode: StoryboardBoardMode,
  plan: StoryboardBoardPlan,
  boardStyle: StoryboardBoardStyle = 'cinematic',
  options: StoryboardBoardPromptOptions = {},
): string {
  return buildNineGridStoryboardBoardPrompt(storyboard, references, plan, mode, boardStyle, options);
}
