import type { ApiConfig, BgmConfig, MusicApiConfig, ScriptAnalysis, StoryboardState } from '@/types';
import { chatComplete } from '@/lib/api-client';
import { bffChatComplete } from '@/lib/bff-client';
import { saveBlob } from '@/lib/imageStore';
import { generateMusic } from '@/lib/sunoClient';

export interface BgmGenerationProgress {
  phase: 'analyzing' | 'generating' | 'downloading' | 'done' | 'error';
  message: string;
  progress: number;
}

export type BgmProgressCallback = (progress: BgmGenerationProgress) => void;

export interface BgmGenerationParams {
  analysis: ScriptAnalysis;
  storyboards: StoryboardState[];
  apiConfig: ApiConfig;
  musicApiConfig: MusicApiConfig;
  totalDurationSeconds: number;
  projectId?: string;
  chapterId?: string;
  signal?: AbortSignal;
  onProgress?: BgmProgressCallback;
}

export interface BgmAnalysisResult {
  style: string;
  mood: string;
  instruments: string;
  tempo: string;
  prompt: string;
  tags: string;
  title: string;
}

function buildBgmAnalysisUserPrompt(
  analysis: ScriptAnalysis,
  storyboards: StoryboardState[],
  totalDurationSeconds: number,
): string {
  const sceneTypes = storyboards.map((storyboard) => storyboard.sceneBlueprint?.sceneType ?? 'unknown');
  const sceneTypeCounts = sceneTypes.reduce<Record<string, number>>((counts, sceneType) => {
    counts[sceneType] = (counts[sceneType] || 0) + 1;
    return counts;
  }, {});
  const dominantScene = Object.entries(sceneTypeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'dialogue';
  const hasHighIntensity = storyboards.some((storyboard) => {
    const intensity = storyboard.sceneBlueprint?.intensity;
    return intensity === 'high' || intensity === 'extreme';
  });

  return `Create one instrumental BGM plan for this short-drama episode.

Return strict JSON only with these fields:
{
  "style": "short Chinese label",
  "mood": "short Chinese label",
  "instruments": "short Chinese label",
  "tempo": "short Chinese label",
  "prompt": "English MiniMax/Suno music prompt, 50-150 words, must include instrumental only, no vocals, no lyrics, no singing",
  "tags": "English comma-separated tags",
  "title": "Chinese title, 4-8 chars"
}

Episode facts:
- characters: ${(analysis.allCharacterNames ?? []).join(', ') || 'unknown'}
- style: ${analysis.styleConfig || 'project visual style'}
- total duration: ${totalDurationSeconds}s
- dominant scene type: ${dominantScene}
- scene type counts: ${Object.entries(sceneTypeCounts).map(([key, value]) => `${key}(${value})`).join(', ')}
- has high intensity scene: ${hasHighIntensity ? 'yes' : 'no'}
- scene summary: ${(analysis.scenes ?? []).map((scene) => [scene.name, scene.environment, scene.timeOfDay, scene.colorTone].filter(Boolean).join('/')).join('; ') || 'unknown'}

The music should support pacing and emotion without lyrics or voice.`;
}

const BGM_ANALYSIS_SYSTEM_PROMPT =
  'You are a professional film and short-drama music supervisor. Return only valid JSON.';

export async function analyzeBgm(params: {
  analysis: ScriptAnalysis;
  storyboards: StoryboardState[];
  apiConfig: ApiConfig;
  totalDurationSeconds: number;
  signal?: AbortSignal;
}): Promise<BgmAnalysisResult> {
  const { analysis, storyboards, apiConfig, totalDurationSeconds, signal } = params;
  const userPrompt = buildBgmAnalysisUserPrompt(analysis, storyboards, totalDurationSeconds);

  let result: string;
  try {
    result = await bffChatComplete({
      templateType: 'bgm_analysis',
      userMessages: [{ role: 'user', content: userPrompt }],
      apiConfig,
      temperature: 0.5,
      maxTokens: 2000,
      reasoningEffort: 'medium',
    }, signal);
  } catch {
    result = await chatComplete(
      apiConfig,
      [
        { role: 'system', content: BGM_ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.5, maxTokens: 2000 },
      signal,
    );
  }

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('BGM analysis did not return valid JSON');
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    style: parsed.style || 'cinematic',
    mood: parsed.mood || 'tension',
    instruments: parsed.instruments || 'synths',
    tempo: parsed.tempo || 'medium',
    prompt: parsed.prompt || 'cinematic instrumental only, no vocals, no lyrics, no singing, dark atmosphere, tension building',
    tags: parsed.tags || 'cinematic,instrumental',
    title: parsed.title || '智能BGM',
  };
}

export async function generateBgm(params: BgmGenerationParams): Promise<BgmConfig> {
  const {
    analysis,
    storyboards,
    apiConfig,
    musicApiConfig,
    totalDurationSeconds,
    signal,
    onProgress,
  } = params;

  onProgress?.({ phase: 'analyzing', message: '分析全片音乐基调...', progress: 10 });
  const bgmAnalysis = await analyzeBgm({ analysis, storyboards, apiConfig, totalDurationSeconds, signal });
  onProgress?.({ phase: 'generating', message: `生成BGM: ${bgmAnalysis.title} (${bgmAnalysis.style})`, progress: 30 });

  const directMusicResult = await generateMusic(
    {
      prompt: bgmAnalysis.prompt,
      apiKey: musicApiConfig.apiKey,
      baseUrl: musicApiConfig.baseUrl,
      model: musicApiConfig.model,
      is_instrumental: true,
      output_format: 'url',
    },
    signal,
  );
  onProgress?.({ phase: 'downloading', message: '保存BGM文件...', progress: 80 });
  const musicResult = {
    blobKey: await saveBlob(directMusicResult.audioBlob),
    taskId: directMusicResult.taskId,
  };

  const bgmConfig: BgmConfig = {
    id: `minimax-${musicResult.taskId || Date.now()}`,
    name: `${bgmAnalysis.title} (${bgmAnalysis.style})`,
    source: 'upload',
    blobKey: musicResult.blobKey,
    volume: 0.3,
    loop: true,
    fadeIn: 1,
    fadeOut: 1,
  };

  onProgress?.({ phase: 'done', message: `BGM生成完成: ${bgmAnalysis.title}`, progress: 100 });
  return bgmConfig;
}

export function createDefaultBgmProgress(): BgmGenerationProgress {
  return { phase: 'analyzing', message: '等待开始...', progress: 0 };
}
