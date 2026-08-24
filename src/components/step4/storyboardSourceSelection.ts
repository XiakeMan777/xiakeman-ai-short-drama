export function selectPrimaryStoryboardSourceText({
  scriptType,
  sourceExcerpt,
  adaptedScript,
  rawScript,
}: {
  scriptType: 'annotated' | 'novel';
  sourceExcerpt?: string;
  adaptedScript?: string;
  rawScript?: string;
}) {
  if (sourceExcerpt?.trim()) {
    return sourceExcerpt;
  }

  if (scriptType === 'novel') {
    return adaptedScript?.trim() || rawScript || '';
  }

  return rawScript || '';
}
