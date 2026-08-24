// ============================================================
// 前端自检引擎 - 对AI生成的提示词进行自动规则校验
// ============================================================

import type { CheckItem, SelfCheckResult, ImageReference, VideoImageBudgetState } from '@/types';
import { getMissingImageReferenceLabels } from '@/lib/storyboardReadiness';
import { findMisboundImageReferenceLabels } from '@/lib/promptImageRefValidation';
import { compareDialogueFidelity, extractDialogueEntriesFromText, formatDialogueFidelityReport } from '@/lib/dialogueFidelity';
import { findDialogueAudioTimingIssues } from '@/lib/dialogueAudioTiming';
import { normalizeFrameRatio } from '@/lib/frameRatio';

const TIME_RANGE_PATTERN = String.raw`\d+(?:\.\d+)?\s*[-~–—]\s*\d+(?:\.\d+)?\s*(?:秒|s|S)?`;
const TIME_SEGMENT_START_PATTERN = new RegExp(`^${TIME_RANGE_PATTERN}`);
const TIME_SEGMENT_WITH_CAMERA_PATTERN = new RegExp(`^${TIME_RANGE_PATTERN}\\s*｜(.+?)｜`, 'gm');
const IMAGE_REF_PATTERN = /图片\s*(\d+)/g;

/**
 * 执行所有自检规则
 * @param promptText 提示词文本
 * @param imageRefs 图片引用分配（可选，传入后可检查 prop 引用完整性）
 */
export function runSelfCheck(
  promptText: string,
  imageRefs?: ImageReference[],
  videoImageBudget?: VideoImageBudgetState,
  sourceDialogueText?: string,
  dialogueAllowSubset = false,
  videoRatio?: string | null,
): SelfCheckResult {
  const frameRatio = resolveSelfCheckFrameRatio(promptText, videoRatio);
  const items: CheckItem[] = [
    checkSeparatorAsterisk(promptText),
    checkImageRefs(promptText),
    checkImageReferenceBudget(promptText, imageRefs, videoImageBudget),
    checkLinkedImageRefs(imageRefs),
    checkTimeSegmentFields(promptText),
    checkSubtitleBan(promptText),
    checkHoldFrame(promptText),
    checkQuoteFormat(promptText),
    checkVerticalBarFormat(promptText),
    checkCameraMoveCount(promptText, frameRatio),
    checkPromptCompleteness(promptText, frameRatio),
    checkVisualAnchors(promptText, imageRefs),
    checkPropImageRefs(promptText, imageRefs),
    checkImageRefBindingAccuracy(promptText, imageRefs),
    checkDialogueAudioTiming(promptText),
    checkDialogueFidelity(promptText, sourceDialogueText, dialogueAllowSubset),
  ];

  const passedCount = items.filter((i) => i.passed).length;
  const blockingItems = items.filter((item) => item.name !== '台词保真质量提示');
  const failedCount = blockingItems.filter((i) => !i.passed).length;

  return {
    totalChecks: items.length,
    passedCount,
    failedCount,
    items,
    overallPassed: failedCount === 0,
  };
}

// ---------- 各项检查函数 ----------

function resolveSelfCheckFrameRatio(promptText: string, videoRatio?: string | null) {
  if (videoRatio) return normalizeFrameRatio(videoRatio);
  return /横屏|16\s*[:：]\s*9|16:9/.test(promptText) ? '16:9' : '9:16';
}

/** 检查1: 段落分隔符 *** */
function checkSeparatorAsterisk(text: string): CheckItem {
  const matches = text.match(/\*{3}/g);
  const count = matches ? matches.length : 0;
  // 标准模板有7个段落，需要至少6个 ***
  const pass = count >= 5;
  return {
    name: '段落分隔符 (***)',
    passed: pass,
    detail: pass
      ? `找到 ${count} 个 *** 分隔符`
      : `只找到 ${count} 个 *** 分隔符，标准格式需要至少6个（7个段落）`,
  };
}

/** 检查2: 图片引用完整性 */
function checkImageRefs(text: string): CheckItem {
  // 提取所有图片引用：支持 (图片X)、【@图片X】、参考图片X、图片 X 等格式。
  const refPattern = new RegExp(IMAGE_REF_PATTERN);
  const refs: number[] = [];
  let match;
  while ((match = refPattern.exec(text)) !== null) {
    refs.push(parseInt(match[1]));
  }

  if (refs.length === 0) {
    return {
      name: '图片引用完整性',
      passed: false,
      detail: '未发现任何图片引用。场景需要(图片1)，角色需要(图片2)起',
    };
  }

  // 检查是否有(图片1)（场景图）
  const hasSceneRef = refs.includes(1);
  const uniqueRefs = [...new Set(refs)].sort((a, b) => a - b);

  return {
    name: '图片引用完整性',
    passed: hasSceneRef && refs.length >= 2,
    detail: hasSceneRef
      ? `引用了 ${uniqueRefs.join(', ')} 共 ${refs.length} 处 ✅`
      : `缺少(图片1)（场景图引用）。当前引用：${uniqueRefs.join(', ')}`,
  };
}

function getPromptImageRefNumbers(text: string) {
  const refPattern = new RegExp(IMAGE_REF_PATTERN);
  const refs: number[] = [];
  let match;
  while ((match = refPattern.exec(text)) !== null) {
    refs.push(parseInt(match[1], 10));
  }
  return refs;
}

function getAllowedImageRefNumbers(imageRefs: ImageReference[] | undefined) {
  return new Set(
    (imageRefs ?? [])
      .map((ref) => extractImageRefNumber(ref.refId))
      .filter((num): num is string => !!num)
      .map((num) => parseInt(num, 10)),
  );
}

function checkImageReferenceBudget(
  text: string,
  imageRefs?: ImageReference[],
  videoImageBudget?: VideoImageBudgetState,
): CheckItem {
  if (!imageRefs || imageRefs.length === 0) {
    return {
      name: '视频参考图预算 (≤9张)',
      passed: false,
      detail: '未传入图片引用分配，无法确认视频参考图预算。',
    };
  }

  const allowedNumbers = getAllowedImageRefNumbers(imageRefs);
  const usedNumbers = [...new Set(getPromptImageRefNumbers(text))].sort((a, b) => a - b);
  const missingNumbers = usedNumbers.filter((num) => !allowedNumbers.has(num));
  const limit = videoImageBudget?.limit ?? 9;
  const overLimit = imageRefs.length > limit;
  const pass = !overLimit && missingNumbers.length === 0;
  const compressedText = videoImageBudget?.compressed
    ? `；已从 ${videoImageBudget.originalCount} 张压缩为 ${videoImageBudget.selectedCount}/${limit} 张`
    : '';

  return {
    name: '视频参考图预算 (≤9张)',
    passed: pass,
    detail: pass
      ? `当前分镜使用 ${imageRefs.length}/${limit} 张参考图，提示词未引用未分配编号${compressedText} ✅`
      : [
          overLimit ? `当前分镜分配了 ${imageRefs.length}/${limit} 张参考图` : '',
          missingNumbers.length > 0 ? `提示词引用了未分配图片编号：${missingNumbers.map((num) => `图片${num}`).join('、')}` : '',
        ].filter(Boolean).join('；'),
  };
}

function checkDialogueFidelity(
  promptText: string,
  sourceDialogueText?: string,
  allowSubset = false,
): CheckItem {
  const expectedEntries = extractDialogueEntriesFromText(sourceDialogueText ?? '');
  if (expectedEntries.length === 0) {
    return {
      name: '台词保真质量提示',
      passed: true,
      detail: '源剧本未检测到需锁定台词，跳过逐字比对。',
    };
  }

  const actualEntries = extractDialogueEntriesFromText(promptText);
  const report = compareDialogueFidelity(expectedEntries, actualEntries, { allowSubset });

  return {
    name: '台词保真质量提示',
    passed: report.passed,
    detail: report.passed
      ? formatDialogueFidelityReport(report, allowSubset ? '最终提示词包含性' : '最终提示词')
      : `${formatDialogueFidelityReport(report, allowSubset ? '最终提示词包含性' : '最终提示词')} 仅作为质量提示，不阻断生成。`,
  };
}

function checkDialogueAudioTiming(promptText: string): CheckItem {
  const issues = findDialogueAudioTimingIssues(promptText);
  const dialogueCount = extractDialogueEntriesFromText(promptText).length;

  if (dialogueCount === 0) {
    return {
      name: '对白音轨秒数',
      passed: true,
      detail: '本分镜无对白/内心OS/系统播报，跳过音轨秒数检查。',
    };
  }

  return {
    name: '对白音轨秒数',
    passed: issues.length === 0,
    detail: issues.length === 0
      ? `${dialogueCount} 句语音均带独立音轨秒数。`
      : `发现 ${issues.length} 句语音缺少音轨秒数：${issues.slice(0, 3).map((issue) => `「${issue.dialogue}」@${issue.timeRange}`).join('、')}`,
  };
}

/** 检查3: 时间段字段数量（3-4个｜） */
function checkLinkedImageRefs(imageRefs?: ImageReference[]): CheckItem {
  if (!imageRefs || imageRefs.length === 0) {
    return {
      name: '图片资产绑定完整性',
      passed: false,
      detail: '未传入图片引用分配，无法确认 Step5 可用素材。',
    };
  }

  const missingLabels = getMissingImageReferenceLabels(imageRefs);
  const pass = missingLabels.length === 0;

  return {
    name: '图片资产绑定完整性',
    passed: pass,
    detail: pass
      ? `${imageRefs.length} 个参考图均已绑定资产 ✅`
      : `以下参考图未绑定 Step3 资产：${missingLabels.join('、')}`,
  };
}

function checkTimeSegmentFields(text: string): CheckItem {
  // 按段落分割后检查时间段行
  const sections = text.split(/\*{3}/);
  const issues: string[] = [];
  let validSegments = 0;

  for (const section of sections) {
    const lines = section.trim().split('\n');
    for (const line of lines) {
      // 匹配时间段行：以数字开头，包含 ｜
      if (TIME_SEGMENT_START_PATTERN.test(line.trim())) {
        const fields = line.split('｜').filter((f) => f.trim());
        if (fields.length < 3 || fields.length > 4) {
          issues.push(
            `字段数=${fields.length}: "${line.trim().slice(0, 60)}..."`,
          );
        } else {
          validSegments++;
        }
      }
    }
  }

  const pass = issues.length === 0 && validSegments >= 1;
  return {
    name: '时间段字段数 (3-4个｜)',
    passed: pass,
    detail: pass
      ? `${validSegments} 个时间段均符合字段格式 ✅`
      : `${validSegments}个有效段, ${issues.length}个异常: ${issues[0]}`,
  };
}

/** 检查4: 字幕禁令 */
function checkSubtitleBan(text: string): CheckItem {
  const hasStartBan = /不显示字幕/.test(text);
  const hasEndBan = /禁止显示字幕/.test(text);
  const pass = hasStartBan && hasEndBan;
  return {
    name: '字幕禁令',
    passed: pass,
    detail: pass
      ? '开头和结尾均有字幕禁令 ✅'
      : `缺少${!hasStartBan ? '开头"不显示字幕"' : ''}${!hasEndBan ? (!hasStartBan ? '/' : '') + '结尾"禁止显示字幕"' : ''}`,
  };
}

/** 检查5: 落幅定格 */
function checkHoldFrame(text: string): CheckItem {
  const patterns = [
    /落幅定格/,
    /画面回归稳定/,
    /定格在.*姿态/,
    /停在.*瞬间/,
  ];
  const found = patterns.some((p) => p.test(text));
  return {
    name: '落幅定格 (Hold Frame)',
    passed: found,
    detail: found ? '检测到落幅定格描述 ✅' : '未检测到落幅定格描述，最后一段需包含收尾描述',
  };
}

/** 检查6: 台词标点格式（中文冒号+引号） */
function checkQuoteFormat(text: string): CheckItem {
  // 检查是否使用了中文引号（正确格式）而非英文/特殊引号
  const hasChineseQuote = /[“”「」『』]/.test(text);
  const englishColonWrong = /\w+\s*:\s*"/.test(text); // 英文冒号+引号

  // 检查是否有台词内容
  const hasDialogue = /说话|："|内心独白|旁白/.test(text);

  if (!hasDialogue) {
    return { name: '台词标点格式', passed: true, detail: '本分镜无台词内容，跳过检查 ✅' };
  }

  const pass = hasChineseQuote && !englishColonWrong;
  return {
    name: '台词标点格式 (中文冒号+引号)',
    passed: pass,
    detail: pass ? '使用正确的中文引号格式 ✅' : '可能使用了英文标点或非标准引号格式',
  };
}

/** 检查7: 全角竖线格式 */
function checkVerticalBarFormat(text: string): CheckItem {
  // 检查是否混用了半角 |
  const hasHalfWidth = text.includes('|');
  // 检查是否使用了全角 ｜
  const hasFullWidth = text.includes('｜');

  const hasTimeSegments = new RegExp(`^${TIME_RANGE_PATTERN}.*｜.*｜`, 'm').test(text);

  if (!hasTimeSegments) {
    return { name: '全角竖线格式 (｜)', passed: true, detail: '无时间段内容，跳过检查' };
  }

  const pass = hasFullWidth && !hasHalfWidth;
  return {
    name: '全角竖线格式 (｜)',
    passed: pass,
    detail: pass
      ? '正确使用全角竖线 ✅'
      : hasHalfWidth
        ? '⚠️ 检测到半角 | ，应使用全角 ｜ (U+FF5C)'
        : '未检测到全角竖线分隔符',
  };
}

/** 检查8: 运镜类型计数（15秒内≤3种大类变化） */
function checkCameraMoveCount(text: string, videoRatio: '9:16' | '16:9' = '9:16'): CheckItem {
  // 运镜大类关键词映射
  const cameraTypes: Record<string, RegExp[]> = {
    '推进类': [/push\s*in|推近|推进/i],
    '拉远类': [/pull\s*out|拉远/i],
    '固定类': [/static|固定/i],
    '垂直类': [/tilt|升降|俯拍.*下推|仰拍.*上推/i],
    '震动类': [/shake|震屏|震颤|手持/i],
    '旋转类': [/orbit|旋转/i],
    '切换类': [/flash\s*cut|硬切|quick\s*cut|切换/i],
    ...(videoRatio === '16:9' ? { '水平类': [/横移|横摇|侧向跟拍|横向跟拍|lateral|pan/i] } : {}),
  };

  // 从时间段中提取运镜描述
  const usedTypes = new Set<string>();
  let match;

  TIME_SEGMENT_WITH_CAMERA_PATTERN.lastIndex = 0;
  while ((match = TIME_SEGMENT_WITH_CAMERA_PATTERN.exec(text)) !== null) {
    const cameraField = match[1];
    for (const [type, patterns] of Object.entries(cameraTypes)) {
      if (patterns.some((p) => p.test(cameraField))) {
        usedTypes.add(type);
      }
    }
  }

  const count = usedTypes.size;
  const limit = videoRatio === '16:9' ? 4 : 3;
  const pass = count <= limit;
  return {
    name: `运镜类型计数 (≤${limit}次/15s)`,
    passed: pass,
    detail: pass
      ? `使用 ${count} 种运镜类型: ${[...usedTypes].join('/')} ✅`
      : `使用了 ${count} 种运镜类型（超过${limit}种上限）: ${[...usedTypes].join('/')}`,
  };
}

/** 检查9: 提示词完整性（各段落是否齐全） */
function checkPromptCompleteness(text: string, videoRatio: '9:16' | '16:9' = '9:16'): CheckItem {
  const framePattern = videoRatio === '16:9'
    ? /16\s*[:：]\s*9|16:9画幅|横屏/i
    : /9\s*[:：]\s*16|9:16画幅|竖屏/i;
  const requiredSections = [
    { name: '画幅风格头部', pattern: framePattern },
    { name: '场景段', pattern: /参考图片1|图片1/ },
    { name: '人物段', pattern: /参考图片\d+|图片\d+/ },
    { name: '景别运镜概述', pattern: /→.*(镜头|运镜|推进|硬切|甩镜|定格|节奏)/ },
    { name: '时间段', pattern: new RegExp(`^${TIME_RANGE_PATTERN}`, 'm') },
    { name: '调色光影', pattern: /调色.*光影|光影/i },
  ];

  const missing = requiredSections.filter((s) => !s.pattern.test(text));
  const pass = missing.length === 0;

  return {
    name: '提示词结构完整性',
    passed: pass,
    detail: pass
      ? '所有必需段落齐全 ✅'
      : `缺少: ${missing.map((m) => m.name).join(', ')}`,
  };
}

/** 检查10: 角色外貌视觉锚点（≥2个） */
function extractImageRefNumber(refId: string): string | null {
  return refId.match(/图片\s*(\d+)/)?.[1] ?? null;
}

function getImageRefNumbersByType(imageRefs: ImageReference[] | undefined, type: ImageReference['type']) {
  return new Set(
    (imageRefs ?? [])
      .filter((ref) => ref.type === type)
      .map((ref) => extractImageRefNumber(ref.refId))
      .filter((num): num is string => !!num),
  );
}

function lineContainsRelevantImageRef(line: string, relevantNumbers: Set<string>, hasTypedRefs: boolean) {
  const matches = [...line.matchAll(IMAGE_REF_PATTERN)].map((match) => match[1]);
  if (matches.length === 0) return false;
  if (!hasTypedRefs) return true;
  return matches.some((num) => relevantNumbers.has(num));
}

function checkVisualAnchors(text: string, imageRefs?: ImageReference[]): CheckItem {
  const characterRefNumbers = getImageRefNumbersByType(imageRefs, 'character');
  const hasTypedRefs = !!imageRefs?.length;

  // 查找包含图片引用的角色设定段。动作时间段只负责镜头/动作，不强制重复外貌锚点。
  const lines = text
    .split(/\n|\*\*\*/)
    .map((line) => line.trim())
    .filter(Boolean);
  let anchorIssues = 0;
  let checkedLines = 0;

  for (const line of lines) {
    // 跳过时间段行和概述行
    if (
      TIME_SEGMENT_START_PATTERN.test(line.trim()) ||
      /→.*(镜头|运镜|推进|硬切|甩镜|定格|节奏)/.test(line.trim())
    ) {
      continue;
    }

    // 只检查人物/角色外貌设定段，避免把动作段误判为“外貌锚点不足”。
    if (!/(外貌特征|人物|角色)/.test(line)) continue;

    // 查找角色引用行：匹配 (图片X)、【@图片X】或参考图片X。
    // 如果传入了 Step4 图片引用分配，只检查 type=character 的参考图，
    // 避免场景/道具的“外观特征”误触发人物外貌锚点告警。
    if (lineContainsRelevantImageRef(line, characterRefNumbers, hasTypedRefs)) {
      checkedLines++;
      // 计算该行的视觉锚点数量
      const anchors =
        (line.match(/发|发型|肤色|皮肤|眼|眉|脸|服装|衣|裙|袍|饰|项链|胎记|纹|剑|武器|道具/g) ||
          []).length;
      if (anchors < 2 && !line.includes('敌方') && !line.includes('大长老')) {
        // 敌方生物可能不需要锚点检查
        anchorIssues++;
      }
    }
  }

  const pass = anchorIssues === 0 || checkedLines === 0;
  return {
    name: '角色外貌视觉锚点 (≥2个)',
    passed: pass,
    detail: pass
      ? `检查 ${checkedLines} 处角色引用，均含足够视觉锚点 ✅`
      : `${anchorIssues}/${checkedLines} 处角色描述视觉锚点不足`,
  };
}

/** 检查11: 物品/道具图片引用完整性 */
function checkPropImageRefs(text: string, imageRefs?: ImageReference[]): CheckItem {
  if (!imageRefs || imageRefs.length === 0) {
    return {
      name: '道具图片引用完整性',
      passed: true,
      detail: '无图片引用分配信息，跳过检查 ✅',
    };
  }

  const propRefs = imageRefs.filter((r) => r.type === 'prop');

  if (propRefs.length === 0) {
    return {
      name: '道具图片引用完整性',
      passed: true,
      detail: '无道具图片引用，跳过检查 ✅',
    };
  }

  const issues: string[] = [];
  const passiveSingleRefs: string[] = [];

  for (const propRef of propRefs) {
    const num = extractImageRefNumber(propRef.refId);
    if (!num) continue;
    // 提取图片编号的正则：匹配 (图片N)、【@图片N】、参考图片N、图片 N。
    const refPattern = new RegExp(`图片\\s*${num}(?!\\d)`, 'g');
    const matches = [...text.matchAll(refPattern)];
    const occurrences = matches.length;

    if (occurrences === 0) {
      issues.push(`${propRef.refId}（${propRef.name}）完全未引用`);
    } else if (occurrences === 1) {
      if (isPassiveContinuityPropReference(text, matches[0].index ?? 0)) {
        passiveSingleRefs.push(`${propRef.refId}（${propRef.name}）`);
      } else {
        issues.push(`${propRef.refId}（${propRef.name}）仅引用1处，可能缺少时间段或人物段引用`);
      }
    }
  }

  const pass = issues.length === 0;
  return {
    name: '道具图片引用完整性',
    passed: pass,
    detail: pass
      ? passiveSingleRefs.length > 0
        ? `${propRefs.length} 个道具图片均已覆盖，其中 ${passiveSingleRefs.join('、')} 为背景/延续性单次引用 ✅`
        : `${propRefs.length} 个道具图片均正确引用 ✅`
      : `道具引用问题：${issues.join('；')}`,
  };
}

function checkImageRefBindingAccuracy(text: string, imageRefs?: ImageReference[]): CheckItem {
  if (!imageRefs || imageRefs.length === 0) {
    return {
      name: '图片编号语义绑定',
      passed: false,
      detail: '未传入图片引用分配，无法确认图片编号是否被误用。',
    };
  }

  const issues = findMisboundImageReferenceLabels(text, imageRefs);
  const pass = issues.length === 0;
  return {
    name: '图片编号语义绑定',
    passed: pass,
    detail: pass
      ? '所有“名称(图片N)”均与对应参考图名称匹配 ✅'
      : `发现 ${issues.length} 处图片编号错绑：${issues
        .slice(0, 5)
        .map((issue) => `${issue.label}(图片${issue.imageNumber}) 实际应为 ${issue.expectedName}`)
        .join('；')}`,
  };
}

function isPassiveContinuityPropReference(text: string, refIndex: number) {
  const context = text.slice(Math.max(0, refIndex - 120), Math.min(text.length, refIndex + 160));
  return /(仍|残留|附着|放着|留在|床尾|角落|药盘|铁盆|未被|不被|不触碰|背景|虚化|旁侧|旁边|边缘|不作为动作主体)/.test(context);
}
