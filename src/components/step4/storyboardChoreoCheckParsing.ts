import type { Choreography, ChoreoCheckFix, LogicFix } from '@/types';

/** 从编排检查输出中解析修正记录（choreo-check 步骤专用，字段为 issueType/description/fixSuggestion） */
type ChoreoCheckJsonPayload = Choreography & {
  _choreoCheckFixes?: unknown;
  choreoCheckFixes?: unknown;
  fixes?: unknown;
};

function normalizeChoreoCheckFix(value: unknown): ChoreoCheckFix | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const issueType = String(record.issueType ?? record.type ?? record.category ?? '').trim();
  const description = String(record.description ?? record.issue ?? record.problem ?? '').trim();
  const fixSuggestion = String(record.fixSuggestion ?? record.fix ?? record.action ?? record.suggestion ?? '').trim();
  if (!issueType && !description && !fixSuggestion) return null;
  const criticalText = `${issueType}\n${description}\n${fixSuggestion}`;
  return {
    issueType: issueType || '编排修正',
    description,
    fixSuggestion,
    isCritical: record.isCritical === true || /严重|critical|降级/.test(criticalText),
  };
}

function collectChoreoCheckFixes(value: unknown): ChoreoCheckFix[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeChoreoCheckFix)
    .filter((item): item is ChoreoCheckFix => item !== null);
}

function parseChoreographyJsonPayload(jsonText: string): {
  choreography: Choreography | null;
  embeddedFixes: ChoreoCheckFix[];
} {
  try {
    const parsed = JSON.parse(jsonText.trim()) as ChoreoCheckJsonPayload;
    if (!parsed || typeof parsed !== 'object') {
      return { choreography: null, embeddedFixes: [] };
    }
    if (!parsed.timeSegments && !parsed.cameraOverview && !(parsed as { actions?: unknown }).actions) {
      return { choreography: null, embeddedFixes: [] };
    }

    const embeddedFixes = [
      ...collectChoreoCheckFixes(parsed._choreoCheckFixes),
      ...collectChoreoCheckFixes(parsed.choreoCheckFixes),
      ...collectChoreoCheckFixes(parsed.fixes),
    ];
    delete parsed._choreoCheckFixes;
    delete parsed.choreoCheckFixes;
    delete parsed.fixes;

    return {
      choreography: parsed as Choreography,
      embeddedFixes,
    };
  } catch {
    return { choreography: null, embeddedFixes: [] };
  }
}

/** 使用括号深度计数从文本中提取第一个完整的 JSON 对象 */
export function extractFirstJsonObject(text: string, startPattern?: RegExp): string | null {
  const startMatch = startPattern
    ? text.match(startPattern)
    : text.match(/\{/);
  if (!startMatch || startMatch.index === undefined) return null;
  const start = startMatch.index;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { if (inString) escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/** 从 check 步骤输出中解析逻辑修正记录（匹配"原剧本矛盾/修正为/原因"格式） */
export function parseLogicFixes(text: string): LogicFix[] {
  if (text.includes('检查通过') || text.includes('无需修正')) {
    return [];
  }

  const fixes: LogicFix[] = [];

  const blockMatch = text.match(/【分镜\d+\s+逻辑修正记录】([\s\S]*?)(?=【|$)/);
  const sourceText = blockMatch ? blockMatch[1] : text;

  const standardMatches = sourceText.matchAll(/[-•*]?\s*原剧本矛盾[：:]\s*(.+?)\n\s*[-•*]?\s*修正为[：:]\s*(.+?)\n\s*[-•*]?\s*原因[：:]\s*(.+?)(?=\n\s*[-•*]\s*原剧本矛盾|\n\n|\n【|$)/gs);
  for (const m of standardMatches) {
    fixes.push({
      originalIssue: m[1].trim(),
      correction: m[2].trim(),
      reason: m[3].trim(),
    });
  }

  if (fixes.length === 0) {
    const looseMatches = sourceText.matchAll(/原剧本矛盾[：:]\s*(.+?)[\n,，]\s*修正为[：:]\s*(.+?)[\n,，]\s*原因[：:]\s*(.+?)(?=\n[-•*]|\n\n|$)/gs);
    for (const m of looseMatches) {
      fixes.push({
        originalIssue: m[1].trim(),
        correction: m[2].trim(),
        reason: m[3].trim(),
      });
    }
  }

  return fixes;
}

/** 从 choreo-check 输出中解析修正记录和修正后的 choreography JSON */
export function parseChoreoCheckResult(text: string): { fixes: ChoreoCheckFix[]; correctedChoreography: Choreography | null } {
  const fixes: ChoreoCheckFix[] = [];
  let correctedChoreography: Choreography | null = null;

  const hasCorrectedJsonCandidate = /```json\s*[\s\S]*"timeSegments"[\s\S]*```/.test(text)
    || /\{[\s\S]*"timeSegments"[\s\S]*\}/.test(text);
  if ((text.includes('检查通过') || text.includes('无需修正')) && !hasCorrectedJsonCandidate) {
    return { fixes: [], correctedChoreography: null };
  }

  const blockMatch = text.match(/【编排修正记录】([\s\S]*?)(?=```json|$)/);
  const sourceText = blockMatch ? blockMatch[1] : text;

  const standardMatches = sourceText.matchAll(/[-•*]?\s*问题类型[：:]\s*(.+?)\n\s*[-•*]?\s*(?:问题描述|问题描述)[：:]\s*(.+?)\n\s*[-•*]?\s*(?:修正建议|修正操作)[：:]\s*(.+?)(?=\n\s*[-•*]\s*问题类型|\n\n|\n【|$)/gs);
  for (const m of standardMatches) {
    fixes.push({
      issueType: m[1].trim(),
      description: m[2].trim(),
      fixSuggestion: m[3].trim(),
      isCritical: m[3].includes('严重-建议降级') || m[1].includes('道具分身') || m[1].includes('时长矛盾') || m[1].includes('位置重叠') || m[1].includes('图片编号') || m[1].includes('语义绑定') || m[1].includes('剧情逻辑') || m[1].includes('站位'),
    });
  }

  if (fixes.length === 0) {
    const looseMatches = sourceText.matchAll(/问题类型[：:]\s*(.+?)[\n,，]\s*(?:问题描述|问题描述)[：:]\s*(.+?)[\n,，]\s*(?:修正建议|修正操作)[：:]\s*(.+?)(?=\n[-•*]|\n\n|$)/gs);
    for (const m of looseMatches) {
      fixes.push({
        issueType: m[1].trim(),
        description: m[2].trim(),
        fixSuggestion: m[3].trim(),
        isCritical: m[3].includes('严重-建议降级') || m[1].includes('道具分身') || m[1].includes('时长矛盾') || m[1].includes('位置重叠') || m[1].includes('图片编号') || m[1].includes('语义绑定') || m[1].includes('剧情逻辑') || m[1].includes('站位'),
      });
    }
  }

  const jsonBlocks = text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
  const allJsons: string[] = [];
  for (const m of jsonBlocks) {
    const candidate = m[1].trim();
    if (candidate.includes('{') && candidate.includes('timeSegments')) {
      allJsons.push(candidate);
    }
  }
  for (let index = allJsons.length - 1; index >= 0; index -= 1) {
    const parsed = parseChoreographyJsonPayload(allJsons[index]);
    if (parsed.choreography) {
      correctedChoreography = parsed.choreography;
      fixes.push(...parsed.embeddedFixes);
      break;
    }
  }
  if (!correctedChoreography && allJsons.length > 0) {
    const lastJson = allJsons[allJsons.length - 1];
    try {
      const parsed = JSON.parse(lastJson);
      if (parsed && (parsed.timeSegments || parsed.cameraOverview || parsed.actions)) {
        correctedChoreography = parsed as Choreography;
      }
    } catch {
      // JSON 解析失败，忽略
    }
  }

  if (!correctedChoreography) {
    const jsonCandidate = extractFirstJsonObject(text);
    if (jsonCandidate && jsonCandidate.includes('timeSegments')) {
      const parsed = parseChoreographyJsonPayload(jsonCandidate);
      if (parsed.choreography) {
        correctedChoreography = parsed.choreography;
        fixes.push(...parsed.embeddedFixes);
      }
    }
  }

  if (!correctedChoreography) {
    const jsonMatch = text.match(/\{[\s\S]*"timeSegments"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed && parsed.timeSegments) {
          correctedChoreography = parsed as Choreography;
        }
      } catch {
        // JSON 解析失败，忽略
      }
    }
  }

  return { fixes, correctedChoreography };
}
