import type { ImageReference } from '@/types';

function normalizeLabel(text: string) {
  return text
    .replace(/^参考图片\d+中/, '')
    .replace(/的(?:外貌特征|场景|道具|外观特征)?$/, '')
    .replace(/[“”"'`]/g, '')
    .trim();
}

function labelMatchesRefName(label: string, refName: string) {
  const normalizedLabel = normalizeLabel(label);
  const normalizedRefName = normalizeLabel(refName);
  if (!normalizedLabel || !normalizedRefName) return false;
  return normalizedLabel.includes(normalizedRefName) || normalizedRefName.includes(normalizedLabel);
}

export interface MisboundImageReferenceIssue {
  label: string;
  imageNumber: number;
  expectedName: string;
}

export function findMisboundImageReferenceLabels(
  promptText: string,
  refs: readonly ImageReference[] | undefined,
): MisboundImageReferenceIssue[] {
  if (!refs?.length) return [];

  const issues: MisboundImageReferenceIssue[] = [];
  const pattern = /([^，。；;、｜\n\r\s()[\]（）【】]{1,28})[（(]图片(\d+)[）)]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(promptText)) !== null) {
    const label = match[1].trim();
    const imageNumber = Number(match[2]);
    const ref = refs[imageNumber - 1];
    if (!ref?.name) continue;
    if (!labelMatchesRefName(label, ref.name)) {
      issues.push({ label, imageNumber, expectedName: ref.name });
    }
  }

  return issues;
}

export function sanitizeMisboundImageReferenceLabels(promptText: string, refs: readonly ImageReference[] | undefined) {
  if (!refs?.length) return promptText;

  return promptText.replace(
    /([^，。；;、｜\n\r\s()[\]（）【】]{1,28})[（(]图片(\d+)[）)]/g,
    (match, rawLabel: string, rawIndex: string) => {
      const ref = refs[Number(rawIndex) - 1];
      if (!ref?.name) return match;
      if (labelMatchesRefName(rawLabel, ref.name)) return match;
      return rawLabel;
    },
  );
}
