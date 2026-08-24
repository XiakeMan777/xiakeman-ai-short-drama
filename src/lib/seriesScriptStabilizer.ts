const ELLIPSIS_RE = /…{2,}|\.{3,}/g;
const DUPLICATED_SHORT_PHRASE_AFTER_PAUSE_RE = /([\u4e00-\u9fa5]{1,4})，\1/g;

function normalizeMechanicalPause(line: string): string {
  return line
    .replace(ELLIPSIS_RE, '，')
    .replace(DUPLICATED_SHORT_PHRASE_AFTER_PAUSE_RE, '$1')
    .replace(/，([”’」』])/g, '$1')
    .replace(/，([。！？!?；;])/g, '$1')
    .replace(/，{2,}/g, '，');
}

export function stabilizeGeneratedEpisodeScript(script: string): string {
  return script
    .split(/\r?\n/)
    .map((line) => normalizeMechanicalPause(line))
    .join('\n')
    .trim();
}
