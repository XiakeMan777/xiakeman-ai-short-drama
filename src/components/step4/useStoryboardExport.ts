// ============================================================
// Step4: 分镜提示词导出 hook
// 封装复制、单个导出、批量导出逻辑
// ============================================================

import { useCallback } from 'react';
import { toast } from 'sonner';
import { sanitizeStoryboardCharacters } from '@/lib/storyboardCharacterSanitizer';
import { isStoryboardPromptReady } from '@/lib/storyboardReadiness';
import type { StoryboardBoardPlan, StoryboardState, ScriptAnalysis } from '@/types';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyTextToClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // WebView/iframe 环境可能拒绝 Clipboard API，继续走 textarea 兜底。
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error('copy failed');
  }
}

function getAnalysisCharacterNames(analysis: ScriptAnalysis | null | undefined) {
  return [
    ...(analysis?.allCharacterNames ?? []),
    ...(analysis?.characterProfiles ?? []).map((profile) => profile.name),
  ];
}

function getDirectorBoardPlan(sb: StoryboardState): StoryboardBoardPlan | undefined {
  const selectedMode = sb.storyboardBoard?.selectedMode;
  if (selectedMode) {
    const selectedPlan = sb.storyboardBoard?.variants?.[selectedMode]?.plan;
    if (selectedPlan) return selectedPlan;
  }
  return sb.storyboardBoard?.variants?.['nine-portrait']?.plan
    ?? sb.storyboardBoard?.variants?.['nine-landscape']?.plan;
}

function formatDirectorBoardText(sb: StoryboardState, analysis?: ScriptAnalysis | null): string {
  const storyboardCharacters = sanitizeStoryboardCharacters(sb.storyboard.characters, { allowedNames: getAnalysisCharacterNames(analysis) });
  const plan = getDirectorBoardPlan(sb);
  const lines = [
    `## 分镜${String(sb.storyboard.number).padStart(2, '0')}：${sb.storyboard.name}`,
    '',
    '模式：Seedance 详细故事板',
    `时长：${sb.storyboard.duration} | 景别：${sb.storyboard.shotSize} | 角色：${storyboardCharacters.join('、')}`,
    sb.correctedScript ? `修正剧本：${sb.correctedScript}` : '',
    plan?.boardGoal ? `导演目标：${plan.boardGoal}` : '',
    plan?.sceneAnchor ? `场景锚点：${plan.sceneAnchor}` : '',
    '',
    '### 详细故事板导演计划',
    ...(plan?.panels?.length
      ? plan.panels.slice(0, 9).map((panel) =>
          `${panel.index}. ${panel.timeRange || panel.beat} | ${panel.primarySubject} | ${panel.blocking || panel.composition} | ${panel.motion || panel.staticMoment} | ${panel.cameraTask || panel.shotType} | 落幅：${panel.continuity}`,
        )
      : ['尚未生成导演计划详情']),
  ];
  return `${lines.filter(Boolean).join('\n')}\n`;
}

function formatSbAsMarkdown(sb: StoryboardState, analysis?: ScriptAnalysis | null): string {
  if (!sb?.prompt?.rawText) return formatDirectorBoardText(sb, analysis);
  const { header, scene, characters: chars, cameraOverview, colorLighting, noSubtitle, timeSegments } = sb.prompt;
  const storyboardCharacters = sanitizeStoryboardCharacters(sb.storyboard.characters, { allowedNames: getAnalysisCharacterNames(analysis) });
  let md = `## 分镜${String(sb.storyboard.number).padStart(2, '0')}：${sb.storyboard.name}\n\n`;
  md += `**时长：** ${sb.storyboard.duration} | **景别：** ${sb.storyboard.shotSize} | **角色：** ${storyboardCharacters.join('、')}\n\n`;
  if (header) md += `### 画幅与风格\n${header}\n\n`;
  if (scene) md += `### 场景\n${scene}\n\n`;
  if (chars) md += `### 人物\n${chars}\n\n`;
  if (cameraOverview) md += `### 镜头运动\n${cameraOverview}\n\n`;
  if (timeSegments?.length > 0) {
    md += '### 时间分段\n';
    timeSegments.forEach((seg) => {
      md += `**${seg.timeRange}** | ${seg.cameraShot}\n${seg.actionDesc}\n${seg.soundEffect ? `音效：${seg.soundEffect}\n` : ''}\n`;
    });
    md += '\n';
  }
  if (colorLighting) md += `### 调色与光影\n${colorLighting}\n\n`;
  if (noSubtitle) md += `### 字幕禁令\n${noSubtitle}\n\n`;
  return md;
}

function formatSbAsJSON(sb: StoryboardState, analysis?: ScriptAnalysis | null): string {
  return JSON.stringify(
    {
      number: sb?.storyboard.number,
      name: sb?.storyboard.name,
      duration: sb?.storyboard.duration,
      shotSize: sb?.storyboard.shotSize,
      characters: sanitizeStoryboardCharacters(sb?.storyboard.characters, { allowedNames: getAnalysisCharacterNames(analysis) }),
      logicFixes: sb?.logicFixes,
      imageRefs: sb?.imageRefs,
      step4OutputMode: sb?.step4OutputMode,
      generatedStep4OutputMode: sb?.generatedStep4OutputMode,
      storyboardBoard: sb?.storyboardBoard,
      prompt: sb?.prompt,
      selfCheckResult: sb?.selfCheckResult,
    },
    null,
    2,
  );
}

export function useStoryboardExport(
  allStoryboards: StoryboardState[],
  analysis: ScriptAnalysis | null,
  currentIndex: number,
) {
  const currentSb = allStoryboards[currentIndex];
  const currentPromptText = currentSb?.isStale ? '' : (currentSb?.prompt?.rawText ?? '');

  const handleCopy = useCallback(() => {
    if (!currentPromptText) return;
    copyTextToClipboard(currentPromptText)
      .then(() => {
        toast.success('已复制到剪贴板');
      })
      .catch(() => {
        toast.error('复制失败，请先点击提示词区域后重试');
      });
  }, [currentPromptText]);

  const handleDownload = useCallback((format: 'txt' | 'json' | 'md') => {
    const exportText = currentSb ? (currentSb.prompt?.rawText ?? formatDirectorBoardText(currentSb, analysis)) : '';
    if (!currentSb || !exportText || currentSb.isStale || !currentSb.storyboard) return;
    const baseName = `分镜${String(currentSb.storyboard.number).padStart(2, '0')}_${currentSb.storyboard.name}`;
    if (format === 'json') {
      downloadBlob(new Blob([formatSbAsJSON(currentSb, analysis)], { type: 'application/json;charset=utf-8' }), `${baseName}.json`);
    } else if (format === 'md') {
      downloadBlob(new Blob([formatSbAsMarkdown(currentSb, analysis)], { type: 'text/markdown;charset=utf-8' }), `${baseName}.md`);
    } else {
      downloadBlob(new Blob([exportText], { type: 'text/plain;charset=utf-8' }), `${baseName}.txt`);
    }
    toast.success(`已导出 ${baseName}.${format}`);
  }, [currentSb, analysis]);

  const handleExportAll = useCallback((format: 'txt' | 'json' | 'md') => {
    const doneSbs = allStoryboards.filter(isStoryboardPromptReady);
    if (doneSbs.length === 0) {
      toast.error('还没有已生成的分镜提示词');
      return;
    }
    if (format === 'json') {
      const data = doneSbs.map((sb) => ({
        number: sb.storyboard.number,
        name: sb.storyboard.name,
        duration: sb.storyboard.duration,
        shotSize: sb.storyboard.shotSize,
        characters: sanitizeStoryboardCharacters(sb.storyboard.characters, { allowedNames: getAnalysisCharacterNames(analysis) }),
        logicFixes: sb.logicFixes,
        imageRefs: sb.imageRefs,
        step4OutputMode: sb.step4OutputMode,
        generatedStep4OutputMode: sb.generatedStep4OutputMode,
        storyboardBoard: sb.storyboardBoard,
        prompt: sb.prompt,
        selfCheckResult: sb.selfCheckResult,
      }));
      downloadBlob(new Blob([JSON.stringify({ projectName: analysis?.projectName, storyboards: data }, null, 2)], { type: 'application/json;charset=utf-8' }), `${analysis?.projectName || '项目'}_全部分镜提示词.json`);
    } else if (format === 'md') {
      const content = doneSbs.map((sb, i) => `【${i + 1}】分镜${String(sb.storyboard.number).padStart(2, '0')} · ${sb.storyboard.name}\n${'='.repeat(40)}\n\n${formatSbAsMarkdown(sb, analysis)}`).join('\n\n---\n\n');
      downloadBlob(new Blob([`# ${analysis?.projectName || '项目'} 全部分镜提示词\n\n共 ${doneSbs.length} 个分镜\n\n---\n\n${content}`], { type: 'text/markdown;charset=utf-8' }), `${analysis?.projectName || '项目'}_全部分镜提示词.md`);
    } else {
      const content = doneSbs.map((sb, i) => `【${i + 1}】分镜${String(sb.storyboard.number).padStart(2, '0')} · ${sb.storyboard.name}\n${'='.repeat(40)}\n${sb.prompt?.rawText ?? formatDirectorBoardText(sb, analysis)}`).join('\n\n');
      downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), `${analysis?.projectName || '项目'}_全部分镜提示词.txt`);
    }
    toast.success(`已导出 ${doneSbs.length} 个分镜提示词（${format.toUpperCase()}）`);
  }, [allStoryboards, analysis]);

  return {
    handleCopy,
    handleDownload,
    handleExportAll,
  };
}
