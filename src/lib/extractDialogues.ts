/**
 * 从分镜提示词中提取台词
 *
 * 支持的台词格式:
 *   对白：    角色名(图片X)嘴唇微张开口说话："台词内容"
 *   内心独白：角色名(图片X)内心独白（全程闭唇、无任何口型动作）："台词内容"
 *   旁白：    旁白："台词内容"
 *
 * 提取来源:
 *   1. prompt.timeSegments[].actionDesc  (结构化)
 *   2. prompt.rawText                    (完整原始文本，兜底)
 */

import type { StoryboardState } from '@/types';

/** 提取出的单条台词 */
export interface DialogueLine {
  speaker: string;        // 角色名 / "旁白"
  text: string;           // 台词内容
  storyboardIndex: number; // 所属分镜序号
  storyboardName: string;  // 所属分镜名称
  timeRange?: string;     // 时间段
}

/**
 * 从文本中提取台词（核心函数）
 *
 * 支持中文引号 ""、英文引号 ""、书名号「」等
 * 支持角色名+(图片X)+动词 格式 和 角色名+【@图片X】+动词 旧格式
 */
function extractDialoguesFromText(
  text: string,
  characterNames: string[],
  storyboardIndex: number,
  storyboardName: string,
  timeRange?: string,
): DialogueLine[] {
  const lines: DialogueLine[] = [];
  if (!text) return lines;

  // 匹配各种引号包裹的台词: ""  ""  「」  ""
  const quoteRegex = /[""\u201C\u201D]([^""\u201C\u201D\u300C\u300D]+?)[""\u201C\u201D\u300C\u300D]|[\u300C\u300D]([^\u300C\u300D]+?)[\u300C\u300D]/g;

  let quoteMatch;
  while ((quoteMatch = quoteRegex.exec(text))) {
    const dialogueText = (quoteMatch[1] || quoteMatch[2] || '').trim();
    if (!dialogueText) continue;

    // 从引号位置往前找说话人
    const beforeQuote = text.substring(0, quoteMatch.index);

    // 判断是旁白
    if (/旁白/.test(beforeQuote.slice(-20))) {
      lines.push({
        speaker: '旁白',
        text: dialogueText,
        storyboardIndex,
        storyboardName,
        timeRange,
      });
      continue;
    }

    // 判断是内心独白
    const isInnerMonologue = /内心独白/.test(beforeQuote);

    // 匹配角色名：在引号前找
    let speaker = '';

    // 策略1：用已知角色名匹配
    if (characterNames.length > 0) {
      for (const name of characterNames) {
        const namePattern = new RegExp(
          `${escapeRegex(name)}(?:\\(图片\\d+\\)|【[^】]*】|\\s*(?:嘴唇微张)?(?:开口说话|内心独白|说话|说|道|喊|叫|低声|轻声|怒吼|呢喃|笑|哭|叹息|冷笑|咬牙))`,
        );
        if (namePattern.test(beforeQuote)) {
          speaker = name;
          break;
        }
      }
    }

    // 策略2：从 "XXX(图片X)动词：" 或 "XXX【@图片X】动词：" 模式提取说话人
    if (!speaker) {
      // 匹配: 角色名(图片X)...开口说话：" / 角色名【@图片X】...开口说话：" / 角色名说话："
      const speakerMatch = beforeQuote.match(
        /([^\s,，。；;！!？?【】[\]（）():：:]{1,10})(?:\([^)]*图片\d+[^)]*\)|【[^】]*】)?[^""]{0,20}(?:开口说话|内心独白|说话|低声说|轻声说|怒吼|呢喃|道|喊|叫|笑|哭|叹息)[：:]?\s*$/,
      );
      if (speakerMatch) {
        speaker = speakerMatch[1];
        // 清理可能带的前缀
        speaker = speaker.replace(/^[对向和与]/, '');
      }
    }

    // 策略3：更宽泛 — "XXX：" 引号前最近的名字
    if (!speaker) {
      const lastColonMatch = beforeQuote.match(/([^\s,，。；;！!？?：:]{1,8})[：:]\s*$/);
      if (lastColonMatch) {
        speaker = lastColonMatch[1];
      }
    }

    if (speaker) {
      lines.push({
        speaker: isInnerMonologue ? `${speaker}(内心)` : speaker,
        text: dialogueText,
        storyboardIndex,
        storyboardName,
        timeRange,
      });
    }
  }

  return lines;
}

/**
 * 从单个 actionDesc 中提取台词（公开导出，供 Step6 使用）
 */
export function extractFromActionDescRaw(
  actionDesc: string,
  characterNames: string[],
  storyboardIndex: number,
  storyboardName: string,
  timeRange?: string,
): DialogueLine[] {
  return extractDialoguesFromText(actionDesc, characterNames, storyboardIndex, storyboardName, timeRange);
}

/**
 * 从所有分镜中批量提取台词
 * 同时从 timeSegments 和 rawText 两个来源提取，去重
 */
export function extractAllDialogues(
  storyboards: StoryboardState[],
  characterNames: string[],
  selectedIndices?: Set<number>,
): DialogueLine[] {
  const allLines: DialogueLine[] = [];
  const seen = new Set<string>(); // 去重用

  for (let i = 0; i < storyboards.length; i++) {
    if (selectedIndices !== undefined && !selectedIndices.has(i)) continue;

    const sb = storyboards[i];
    const prompt = sb.prompt;
    if (!prompt) continue;

    // 来源1: timeSegments (结构化，优先)
    if (prompt.timeSegments?.length) {
      for (const seg of prompt.timeSegments) {
        const lines = extractDialoguesFromText(
          seg.actionDesc,
          characterNames,
          i,
          sb.storyboard.name,
          seg.timeRange,
        );
        for (const line of lines) {
          const key = `${i}:${line.speaker}:${line.text}`;
          if (!seen.has(key)) {
            seen.add(key);
            allLines.push(line);
          }
        }
      }
    }

    // 来源2: rawText 兜底（如果 timeSegments 提取不到台词，从完整文本提取）
    const fromStructured = allLines.filter((l) => l.storyboardIndex === i).length;
    if (fromStructured === 0 && prompt.rawText) {
      const lines = extractDialoguesFromText(
        prompt.rawText,
        characterNames,
        i,
        sb.storyboard.name,
      );
      for (const line of lines) {
        const key = `${i}:${line.speaker}:${line.text}`;
        if (!seen.has(key)) {
          seen.add(key);
          allLines.push(line);
        }
      }
    }
  }

  return allLines;
}

/**
 * 按角色分组台词
 */
export function groupDialoguesBySpeaker(
  dialogues: DialogueLine[],
): Map<string, DialogueLine[]> {
  const map = new Map<string, DialogueLine[]>();
  for (const d of dialogues) {
    const list = map.get(d.speaker) ?? [];
    list.push(d);
    map.set(d.speaker, list);
  }
  return map;
}

/** 正则转义 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
