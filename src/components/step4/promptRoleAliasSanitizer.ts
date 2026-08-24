import type { ImageReference } from '@/types';

const TEMP_ROLE_ALIAS_REPLACEMENTS: Array<{ alias: string; replacement: string }> = [
  { alias: '杂役甲', replacement: '近侧杂役' },
  { alias: '杂役乙', replacement: '后景杂役' },
  { alias: '杂役丙', replacement: '过道杂役' },
  { alias: '杂役丁', replacement: '远侧杂役' },
  { alias: '护工甲', replacement: '近侧护工' },
  { alias: '护工乙', replacement: '后景护工' },
  { alias: '护工丙', replacement: '过道护工' },
  { alias: '伤员甲', replacement: '近侧伤员' },
  { alias: '伤员乙', replacement: '后景伤员' },
  { alias: '伤员丙', replacement: '远侧伤员' },
  { alias: '守备队', replacement: '守备队员群像' },
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitizeUnboundTemporaryRoleAliases(
  promptText: string,
  imageRefs: ImageReference[] | undefined,
): string {
  const allowedCharacterNames = new Set(
    (imageRefs ?? [])
      .filter((ref) => ref.type === 'character')
      .map((ref) => ref.name.trim())
      .filter(Boolean),
  );

  let sanitized = promptText;
  for (const { alias, replacement } of TEMP_ROLE_ALIAS_REPLACEMENTS) {
    if (allowedCharacterNames.has(alias)) continue;
    const pattern = alias === '守备队'
      ? /守备队(?!员)/g
      : new RegExp(escapeRegExp(alias), 'g');
    sanitized = sanitized.replace(pattern, replacement);
  }

  return sanitized;
}
