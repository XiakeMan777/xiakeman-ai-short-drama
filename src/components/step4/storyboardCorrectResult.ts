import type { SceneBlueprint } from '@/types';

function extractTaggedSection(text: string, tag: string) {
  const match = text.match(new RegExp(`【${tag}】\\s*\\n([\\s\\S]*?)(?=\\n【|$)`));
  return match?.[1]?.trim() ?? '';
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      if (inString) escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function extractJsonCandidate(text: string): string {
  const fencedMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  return extractFirstJsonObject(text) ?? text.trim();
}

export function parseCorrectResult(text: string, fallbackSceneBlueprint: SceneBlueprint | null): {
  correctedScript: string;
  sceneBlueprint: SceneBlueprint | null;
} {
  const correctedScript = extractTaggedSection(text, '修正后剧本');
  const blueprintText = extractTaggedSection(text, '修正后场景蓝图');

  let sceneBlueprint = fallbackSceneBlueprint;
  if (blueprintText) {
    try {
      const parsed = JSON.parse(extractJsonCandidate(blueprintText));
      if (parsed && typeof parsed === 'object' && 'sceneType' in parsed) {
        sceneBlueprint = parsed as SceneBlueprint;
      }
    } catch {
      // 保持 fallback
    }
  }

  return {
    correctedScript,
    sceneBlueprint,
  };
}
