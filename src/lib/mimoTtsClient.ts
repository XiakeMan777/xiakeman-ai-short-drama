import type { PresetTtsVoice, TtsApiConfig, TtsMode } from '@/types';

/**
 * MiMo-V2.5-TTS client.
 * Official docs:
 * https://platform.xiaomimimo.com/static/docs/usage-guide/speech-synthesis-v2.5.md
 */

export type TtsVoice = PresetTtsVoice;

export const DEFAULT_TTS_PRESET_VOICE: TtsVoice = 'mimo_default';
export const DEFAULT_TTS_MODEL = 'mimo-v2.5-tts';
export const DEFAULT_TTS_VOICE_DESIGN_MODEL = 'mimo-v2.5-tts-voicedesign';
export const DEFAULT_TTS_VOICE_CLONE_MODEL = 'mimo-v2.5-tts-voiceclone';

const DEFAULT_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const MAX_VOICE_CLONE_FILE_SIZE_BYTES = Math.floor(7.5 * 1024 * 1024);

export const TTS_VOICE_OPTIONS: Array<{ value: TtsVoice; label: string }> = [
  { value: 'mimo_default', label: 'MiMo 默认' },
  { value: '\u51b0\u7cd6', label: '\u51b0\u7cd6' },
  { value: '\u8309\u8389', label: '\u8309\u8389' },
  { value: '\u82cf\u6253', label: '\u82cf\u6253' },
  { value: '\u767d\u6866', label: '\u767d\u6866' },
  { value: 'Mia', label: 'Mia' },
  { value: 'Chloe', label: 'Chloe' },
  { value: 'Milo', label: 'Milo' },
  { value: 'Dean', label: 'Dean' },
];

const LEGACY_VOICE_ALIASES: Record<string, TtsVoice> = {
  default_zh: '\u51b0\u7cd6',
  default_en: 'Mia',
};

export interface TtsRequest {
  text: string;
  voice?: TtsVoice;
  mode?: TtsMode;
  styleTag?: string;
  audioTag?: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  userMessage?: string;
  voiceDesignPrompt?: string;
  sceneContext?: string;
  cloneSampleDataUrl?: string;
  background?: {
    projectId?: string;
    chapterId?: string;
    storyboardIndex?: number;
    lineIndex?: number;
    cloneSampleBlob?: Blob;
    enabled?: boolean;
  };
}

export interface TtsResult {
  audioBlob: Blob;
  durationMs: number;
}

export interface VoiceCloneValidationResult {
  ok: boolean;
  error?: string;
  mimeType?: 'audio/mpeg' | 'audio/wav';
}

export interface ApiTestResult {
  success: boolean;
  message: string;
}

export function coerceTtsVoice(value?: string | null): TtsVoice {
  if (!value) return DEFAULT_TTS_PRESET_VOICE;
  if (value in LEGACY_VOICE_ALIASES) {
    return LEGACY_VOICE_ALIASES[value];
  }
  return TTS_VOICE_OPTIONS.some((option) => option.value === value)
    ? (value as TtsVoice)
    : DEFAULT_TTS_PRESET_VOICE;
}

export function buildAssistantContent(text: string, styleTag?: string, audioTag?: string): string {
  const parts: string[] = [];
  const normalizedStyleTag = normalizeTag(sanitizeTtsTag(styleTag));
  const normalizedAudioTag = normalizeTag(sanitizeTtsTag(audioTag));
  if (normalizedStyleTag) parts.push(normalizedStyleTag);
  if (normalizedAudioTag) parts.push(normalizedAudioTag);
  const normalizedText = sanitizeSpeakableText(text);
  if (normalizedText) parts.push(normalizedText);
  return parts.join(' ').trim();
}

export function buildVoiceDesignUserContent(
  voiceDesignPrompt: string,
): string {
  return sanitizeVoiceDesignPrompt(voiceDesignPrompt);
}

export function resolveTtsModel(requestedModel: string | undefined, mode: TtsMode): string {
  const trimmed = requestedModel?.trim();
  if (mode === 'voiceDesign') {
    if (
      !trimmed
      || trimmed === 'mimo-v2-tts'
      || trimmed === DEFAULT_TTS_MODEL
      || trimmed === DEFAULT_TTS_VOICE_CLONE_MODEL
    ) {
      return DEFAULT_TTS_VOICE_DESIGN_MODEL;
    }
    return trimmed;
  }

  if (mode === 'voiceClone') {
    if (!trimmed || trimmed === 'mimo-v2-tts' || trimmed === DEFAULT_TTS_MODEL || trimmed === DEFAULT_TTS_VOICE_DESIGN_MODEL) {
      return DEFAULT_TTS_VOICE_CLONE_MODEL;
    }
    return trimmed;
  }

  if (!trimmed || trimmed === 'mimo-v2-tts') {
    return DEFAULT_TTS_MODEL;
  }
  return trimmed;
}

export function validateVoiceCloneSample(file: Pick<Blob, 'size' | 'type'> & { name?: string }): VoiceCloneValidationResult {
  const mimeType = inferVoiceCloneMimeType(file.type, file.name);
  if (!mimeType) {
    return {
      ok: false,
      error: '克隆音色样本仅支持 mp3 或 wav 文件。',
    };
  }

  if (file.size > MAX_VOICE_CLONE_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: '克隆音色样本过大，请控制在约 7.5MB 以内。',
    };
  }

  return { ok: true, mimeType };
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('无法读取克隆音色样本。'));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('无法读取克隆音色样本。'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Call MiMo TTS and return a complete WAV blob.
 */
export async function generateTts(req: TtsRequest): Promise<TtsResult> {
  const {
    text,
    voice,
    styleTag,
    audioTag,
    apiKey,
    baseUrl,
    model,
    userMessage,
    voiceDesignPrompt,
    cloneSampleDataUrl,
  } = req;

  const mode: TtsMode = req.mode ?? (cloneSampleDataUrl ? 'voiceClone' : 'preset');
  const assistantContent = buildAssistantContent(text, styleTag, audioTag);
  if (!assistantContent) {
    throw new Error('TTS 文本不能为空。');
  }

  const apiUrl = baseUrl
    ? `${baseUrl.replace(/\/+$/, '')}/chat/completions`
    : DEFAULT_API_URL;
  const modelName = resolveTtsModel(model, mode);
  const startTime = Date.now();

  if (mode === 'voiceClone' && !cloneSampleDataUrl) {
    throw new Error('缺少克隆音色样本，请重新上传样本。');
  }

  if (mode === 'voiceDesign' && !voiceDesignPrompt?.trim()) {
    throw new Error('缺少角色声线描述，请先生成或填写 VoiceDesign 声线卡。');
  }

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (mode === 'voiceDesign') {
    messages.push({
      role: 'user',
      content: buildVoiceDesignUserContent(voiceDesignPrompt!.trim()),
    });
  } else if (userMessage?.trim()) {
    messages.push({ role: 'user', content: userMessage.trim() });
  }
  messages.push({ role: 'assistant', content: assistantContent });

  const audioVoice = mode === 'voiceDesign'
    ? undefined
    : mode === 'voiceClone'
    ? cloneSampleDataUrl!
    : coerceTtsVoice(voice);
  const audio: { format: 'wav'; voice?: string } = { format: 'wav' };
  if (audioVoice) audio.voice = audioVoice;

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      audio,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`TTS 请求失败 (${res.status}): ${errText || res.statusText}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  if (!choice?.message?.audio?.data) {
    throw new Error('TTS 响应格式异常：缺少音频数据。');
  }

  const audioBytes = base64ToUint8Array(choice.message.audio.data);
  const copiedBytes = new Uint8Array(audioBytes);
  const audioBlob = new Blob([copiedBytes.buffer], { type: 'audio/wav' });
  const durationMs = getWavDurationMs(copiedBytes) ?? Date.now() - startTime;

  return {
    audioBlob,
    durationMs,
  };
}

export async function getAudioBlobDurationMs(blob: Blob): Promise<number> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return getWavDurationMs(bytes) ?? 0;
}

export async function testTtsConnection(config: Pick<TtsApiConfig, 'apiKey' | 'baseUrl' | 'model'>): Promise<ApiTestResult> {
  try {
    const result = await generateTts({
      text: '连接成功',
      mode: 'preset',
      voice: DEFAULT_TTS_PRESET_VOICE,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    });

    return {
      success: true,
      message: `连接成功！已生成 ${(result.audioBlob.size / 1024).toFixed(1)} KB 测试音频。`,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : '未知错误',
    };
  }
}

function normalizeTag(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith('(') && trimmed.endsWith(')')) ||
    (trimmed.startsWith('（') && trimmed.endsWith('）')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return trimmed;
  }
  return `(${trimmed})`;
}

function sanitizeSpeakableText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*(Character|Scene|Guidance|角色|场景|导演|提示词|表演要求)\s*[:：].*$/gim, '')
    .replace(/\b(Character|Scene|Guidance)\s*[:：]/gi, '')
    .replace(/(请只朗读|不要朗读|目标时长|最大时长|潜台词|停顿方案|重音词|情绪曲线|导演质检|返工)[^。！？\n]*[。！？]?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeVoiceDesignPrompt(value: string): string {
  const firstSentence = value
    .replace(/\s+/g, ' ')
    .replace(/\b(Character|Scene|Guidance)\s*[:：]/gi, '')
    .split(/[。！？\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join('。');
  return firstSentence.slice(0, 120) || '自然、有真人呼吸感的短剧角色声线。';
}

function sanitizeTtsTag(value?: string): string {
  if (!value) return '';
  const compact = value
    .replace(/[()（）[\]【】]/g, ' ')
    .replace(/(请|不要|必须|目标|最多|提示词|潜台词|场景|导演|Character|Scene|Guidance)[^，。；;、]*/gi, ' ')
    .replace(/[，。；;,.!?！？：:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return compact.split(' ').filter((part) => part.length <= 8).slice(0, 3).join(' ').slice(0, 24);
}

function inferVoiceCloneMimeType(type?: string, name?: string): 'audio/mpeg' | 'audio/wav' | null {
  const normalizedType = type?.toLowerCase().trim();
  if (normalizedType === 'audio/mpeg' || normalizedType === 'audio/mp3') {
    return 'audio/mpeg';
  }
  if (normalizedType === 'audio/wav' || normalizedType === 'audio/x-wav') {
    return 'audio/wav';
  }

  const lowerName = name?.toLowerCase().trim();
  if (lowerName?.endsWith('.mp3')) return 'audio/mpeg';
  if (lowerName?.endsWith('.wav')) return 'audio/wav';
  return null;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset + length > bytes.length) return '';
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function readUint32LE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) return null;
  return (
    bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)
  ) >>> 0;
}

export function getWavDurationMs(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  if (readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WAVE') return null;

  let offset = 12;
  let byteRate: number | null = null;
  let dataSize: number | null = null;

  while (offset + 8 <= bytes.length) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = readUint32LE(bytes, offset + 4);
    if (chunkSize == null) break;
    const chunkDataOffset = offset + 8;

    if (chunkId === 'fmt ') {
      byteRate = readUint32LE(bytes, chunkDataOffset + 8);
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!byteRate || !dataSize) return null;
  return Math.round((dataSize / byteRate) * 1000);
}
