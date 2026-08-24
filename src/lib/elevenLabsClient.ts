export interface ElevenLabsSfxRequest {
  apiKey: string;
  prompt: string;
  durationSeconds?: number;
  promptInfluence?: number;
  baseUrl?: string;
  modelId?: string;
}

export interface ElevenLabsTranscriptionWord {
  text: string;
  start: number;
  end: number;
  speakerId?: string;
}

export interface ElevenLabsTranscriptionResult {
  text: string;
  words: ElevenLabsTranscriptionWord[];
}

function normalizeBaseUrl(baseUrl?: string) {
  return (baseUrl?.trim() || 'https://api.elevenlabs.io/v1').replace(/\/+$/, '');
}

function clamp(value: number | undefined, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export async function generateElevenLabsSoundEffect(req: ElevenLabsSfxRequest): Promise<Blob> {
  if (!req.apiKey.trim()) {
    throw new Error('缺少 ElevenLabs API Key。');
  }
  if (!req.prompt.trim()) {
    throw new Error('音效描述不能为空。');
  }

  const response = await fetch(`${normalizeBaseUrl(req.baseUrl)}/sound-generation`, {
    method: 'POST',
    headers: {
      'xi-api-key': req.apiKey.trim(),
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: req.prompt.trim(),
      duration_seconds: clamp(req.durationSeconds, 2.5, 0.5, 22),
      prompt_influence: clamp(req.promptInfluence, 0.5, 0, 1),
      model_id: req.modelId?.trim() || 'eleven_text_to_sound_v2',
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`ElevenLabs 音效生成失败 (${response.status}): ${text || response.statusText}`);
  }

  return await response.blob();
}

export async function transcribeElevenLabsAudio(opts: {
  apiKey: string;
  audio: Blob;
  fileName?: string;
  baseUrl?: string;
  modelId?: string;
}): Promise<ElevenLabsTranscriptionResult> {
  if (!opts.apiKey.trim()) {
    throw new Error('缺少 ElevenLabs API Key。');
  }

  const form = new FormData();
  form.append('file', opts.audio, opts.fileName || 'voice-source.mp4');
  form.append('model_id', opts.modelId?.trim() || 'scribe_v1');
  form.append('diarize', 'true');
  form.append('timestamps_granularity', 'word');

  const response = await fetch(`${normalizeBaseUrl(opts.baseUrl)}/speech-to-text`, {
    method: 'POST',
    headers: {
      'xi-api-key': opts.apiKey.trim(),
    },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`ElevenLabs 转写失败 (${response.status}): ${text || response.statusText}`);
  }

  const data = await response.json() as {
    text?: string;
    words?: Array<{ text?: string; start?: number; end?: number; speaker_id?: string; speaker?: string }>;
  };

  return {
    text: data.text ?? '',
    words: (data.words ?? []).flatMap((word) => {
      if (typeof word.start !== 'number' || typeof word.end !== 'number') return [];
      return [{
        text: word.text ?? '',
        start: word.start,
        end: word.end,
        speakerId: word.speaker_id ?? word.speaker,
      }];
    }),
  };
}
