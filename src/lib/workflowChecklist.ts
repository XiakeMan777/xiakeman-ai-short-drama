import type { Chapter } from '@/types';
import { isStoryboardPromptReady } from '@/lib/storyboardReadiness';
import { buildPostProductionState, runPreflight } from '@/lib/postProduction';
import { DEFAULT_STEP4_OUTPUT_MODE } from '@/lib/storage';

export type WorkflowChecklistItem = {
  id: 'script' | 'analysis' | 'assets' | 'prompts' | 'videos' | 'render';
  label: string;
  status: 'done' | 'active' | 'todo' | 'blocked';
  detail: string;
};

const ACTIVE_BY_STATUS: Partial<Record<Chapter['status'], WorkflowChecklistItem['id']>> = {
  idle: 'script',
  scripting: 'script',
  adapting: 'script',
  analyzing: 'analysis',
  assets: 'assets',
  generating: 'prompts',
  videos: 'videos',
  dubbing: 'render',
  compositing: 'render',
};

function withActiveState(
  id: WorkflowChecklistItem['id'],
  done: boolean,
  blocked: boolean,
  chapter: Chapter,
): WorkflowChecklistItem['status'] {
  if (done) return 'done';
  if (blocked) return 'blocked';
  return ACTIVE_BY_STATUS[chapter.status] === id ? 'active' : 'todo';
}

export function buildWorkflowChecklist(chapter: Chapter | null): WorkflowChecklistItem[] {
  if (!chapter) {
    return [{
      id: 'script',
      label: '准备剧本',
      status: 'active',
      detail: '创建项目后，从剧本或小说正文开始。',
    }];
  }

  const storyboards = chapter.storyboards ?? [];
  const isStoryboardDirectorMode = (chapter.step4OutputMode ?? DEFAULT_STEP4_OUTPUT_MODE) === 'storyboard-director';
  const step4OutputLabel = isStoryboardDirectorMode ? '故事板' : '提示词';
  const promptReadyCount = storyboards.filter(isStoryboardPromptReady).length;
  const promptTotal = storyboards.length;
  const videoReadyCount = storyboards.filter((sb) => sb.videoStatus === 'done' && (sb.videoBlobKey || sb.videoUrl)).length;
  const postProduction = chapter.postProduction ?? buildPostProductionState(chapter);
  const preflight = runPreflight(postProduction);
  const assetCount = storyboards.reduce((sum, sb) => sum + sb.imageRefs.filter((ref) => ref.assetId).length, 0);
  const refCount = storyboards.reduce((sum, sb) => sum + sb.imageRefs.length, 0);

  const scriptDone = Boolean(chapter.rawScript.trim() || chapter.adaptedScript.trim());
  const analysisDone = Boolean(chapter.analysis && !chapter.analysisIsStale);
  const assetsDone = refCount === 0 ? analysisDone : assetCount >= refCount;
  const promptsDone = promptTotal > 0 && promptReadyCount === promptTotal;

  return [
    {
      id: 'script',
      label: '剧本',
      status: withActiveState('script', scriptDone, false, chapter),
      detail: scriptDone ? '正文已准备好。' : '先导入或生成本集正文。',
    },
    {
      id: 'analysis',
      label: '分析',
      status: withActiveState('analysis', analysisDone, !scriptDone, chapter),
      detail: analysisDone ? '场景、角色、道具、分镜已确认。' : scriptDone ? '需要确认结构化分析。' : '缺少正文。',
    },
    {
      id: 'assets',
      label: '资产',
      status: withActiveState('assets', assetsDone, !analysisDone, chapter),
      detail: refCount > 0 ? `已绑定 ${assetCount}/${refCount} 张参考图。` : '确认分析后再准备参考图。',
    },
    {
      id: 'prompts',
      label: step4OutputLabel,
      status: withActiveState('prompts', promptsDone, !assetsDone, chapter),
      detail: promptTotal > 0 ? `已完成 ${promptReadyCount}/${promptTotal} 个镜头。` : `需要先生成${step4OutputLabel}。`,
    },
    {
      id: 'videos',
      label: '视频',
      status: withActiveState('videos', videoReadyCount > 0, !promptsDone, chapter),
      detail: promptTotal > 0 ? `已完成 ${videoReadyCount}/${promptTotal} 个视频。` : `${step4OutputLabel}完成后再生成视频。`,
    },
    {
      id: 'render',
      label: '成片',
      status: withActiveState('render', preflight.ok && postProduction.renderJob?.status === 'done', !preflight.ok, chapter),
      detail: preflight.ok ? '预检通过，可以渲染 ZIP。' : `还有 ${preflight.errors.length} 个阻塞项。`,
    },
  ];
}
