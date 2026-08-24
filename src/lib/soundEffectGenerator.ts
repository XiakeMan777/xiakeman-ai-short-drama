// ============================================================
// AI 音效生成 — 基于 soundEffect 描述生成音效音频
// 使用 MiMo TTS API 生成（复用已有 TTS 基础设施）
// ============================================================

import { generateTts, type TtsVoice } from '@/lib/mimoTtsClient';
import { generateElevenLabsSoundEffect } from '@/lib/elevenLabsClient';
import type { TtsApiConfig } from '@/types';

/** 音效生成参数 */
export interface SfxGenerateOptions {
  /** 音效描述（来自 TimeSegment.soundEffect），如 "剑气破空声" / "雨声渐大" */
  description: string;
  /** TTS API 配置 */
  ttsConfig: TtsApiConfig;
  provider?: 'elevenlabs' | 'mimo-fallback';
  elevenLabsApiKey?: string;
}

/**
 * 将音效描述转化为 TTS 合成文本
 * 策略：用拟声词+场景词让 TTS 生成类似音效的声音
 * 例如 "剑气破空" → "<style>变快</style>（嗖——）剑气破空"
 */
function sfxDescriptionToTtsText(description: string): { text: string; styleTag: string; audioTag: string } {
  // 音效分类关键词 → 拟声词映射
  const sfxMap: Array<{ keywords: RegExp; onomatopoeia: string; style: string }> = [
    { keywords: /剑|刀|斩|劈|刺|破空|锋/, onomatopoeia: '嗖——', style: '变快' },
    { keywords: /拳|掌|击|打|碎|裂|碰撞/, onomatopoeia: '砰！', style: '变快' },
    { keywords: /风|呼啸|暴风|狂风/, onomatopoeia: '呜——', style: '变快' },
    { keywords: /雨|雷|闪电|暴雨/, onomatopoeia: '轰隆——', style: '变快' },
    { keywords: /火|燃烧|爆炸|炸/, onomatopoeia: '轰！', style: '变快' },
    { keywords: /水|流|河|瀑布|溪/, onomatopoeia: '哗——', style: '变慢' },
    { keywords: /脚步|走|跑|追赶/, onomatopoeia: '哒哒哒', style: '变快' },
    { keywords: /门|开|关|锁/, onomatopoeia: '吱呀——', style: '变慢' },
    { keywords: /钟|铃|响|报时/, onomatopoeia: '叮——', style: '变慢' },
    { keywords: /鸟|虫|蝉|蛙/, onomatopoeia: '啾啾', style: '变慢' },
    { keywords: /心跳|紧张|恐惧/, onomatopoeia: '咚……咚……', style: '变慢' },
    { keywords: /哭|泣|呜咽|哽咽/, onomatopoeia: '呜呜', style: '悲伤' },
    { keywords: /笑|欢笑|嬉笑/, onomatopoeia: '哈哈', style: '开心' },
    { keywords: /鼓|号|战鼓|出征/, onomatopoeia: '咚咚咚', style: '变快' },
    { keywords: /马|奔|蹄|骑/, onomatopoeia: '哒哒哒', style: '变快' },
    { keywords: /沉默|寂静|安静|静/, onomatopoeia: '……', style: '变慢' },
  ];

  let onomatopoeia = '嗖——';
  let style = '变快';

  for (const entry of sfxMap) {
    if (entry.keywords.test(description)) {
      onomatopoeia = entry.onomatopoeia;
      style = entry.style;
      break;
    }
  }

  return {
    text: onomatopoeia,
    styleTag: style,
    audioTag: description,
  };
}

/**
 * 生成音效音频
 *
 * 注意：TTS API 本质是生成语音，不是生成音效。
 * 这里用拟声词+描述来让 TTS 产生类似音效的声音效果。
 * 实际效果取决于 TTS 模型的能力。
 */
export async function generateSoundEffect(opts: SfxGenerateOptions): Promise<Blob> {
  const { description, ttsConfig } = opts;

  if (opts.provider === 'elevenlabs' && opts.elevenLabsApiKey?.trim()) {
    return await generateElevenLabsSoundEffect({
      apiKey: opts.elevenLabsApiKey,
      prompt: description,
      durationSeconds: 2.5,
    });
  }

  if (!ttsConfig.apiKey) {
    throw new Error('请先在 API 配置中设置语音模型 API Key');
  }

  const { text, styleTag, audioTag } = sfxDescriptionToTtsText(description);

  const result = await generateTts({
    text,
    voice: 'mimo_default' as TtsVoice,
    styleTag,
    audioTag,
    apiKey: ttsConfig.apiKey,
    baseUrl: ttsConfig.baseUrl,
    model: ttsConfig.model,
  });

  return result.audioBlob;
}

/**
 * 批量生成分镜音效
 * @param soundEffects 音效描述数组
 * @param ttsConfig TTS 配置
 * @param onProgress 进度回调
 * @returns 生成的音频 Blob 数组（与输入一一对应，失败的为 null）
 */
export async function batchGenerateSoundEffects(
  soundEffects: string[],
  ttsConfig: TtsApiConfig,
  onProgress?: (index: number, total: number) => void,
  concurrency = 3,
  provider?: { type: 'elevenlabs'; apiKey: string },
): Promise<(Blob | null)[]> {
  const results: (Blob | null)[] = new Array(soundEffects.length).fill(null);
  const workerCount = Math.max(1, Math.min(concurrency, soundEffects.length || 1));
  let nextIndex = 0;
  let done = 0;

  async function runWorker() {
    while (nextIndex < soundEffects.length) {
      const i = nextIndex++;
      const desc = soundEffects[i]?.trim();
      if (!desc) {
        done++;
        onProgress?.(done, soundEffects.length);
        continue;
      }

      try {
        results[i] = await generateSoundEffect({
          description: desc,
          ttsConfig,
          provider: provider?.type,
          elevenLabsApiKey: provider?.apiKey,
        });
      } catch (err) {
        console.warn(`[SFX] Failed to generate sound effect "${desc}":`, err);
      }

      done++;
      onProgress?.(done, soundEffects.length);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}
