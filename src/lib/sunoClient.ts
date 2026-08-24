// ============================================================
// MiniMax 音乐生成 API 客户端
// 文档: https://platform.minimaxi.com/docs/api-reference/music-generation
// 端点: POST /v1/music_generation
// 模型: music-2.6 / music-2.6-free
// ============================================================

export interface MusicGenerationRequest {
  prompt: string;
  model?: string;
  is_instrumental?: boolean;
  output_format?: 'url' | 'hex';
  apiKey: string;
  baseUrl?: string;
}

export interface MusicGenerationResult {
  audioBlob: Blob;
  durationMs: number;
  taskId: string;
}

const DEFAULT_BASE_URL = 'https://api.minimaxi.com';

export async function generateMusic(req: MusicGenerationRequest, signal?: AbortSignal): Promise<MusicGenerationResult> {
  const {
    prompt,
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    model = 'music-2.6-free',
    is_instrumental = true,
    output_format = 'url',
  } = req;

  const url = `${baseUrl.replace(/\/$/, '')}/v1/music_generation`;

  if (import.meta.env.DEV) {
    console.log('[MiniMax Music] 提交音乐生成:', { model, prompt: prompt.slice(0, 100) });
  }

  const body: Record<string, unknown> = {
    model,
    prompt,
    is_instrumental,
    output_format,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Music generation failed (${res.status}): ${errText}`);
  }

  const data = await res.json();

  if (data.base_resp?.status_code !== 0) {
    throw new Error(`Music generation API error: ${data.base_resp?.status_msg || JSON.stringify(data)}`);
  }

  if (data.data?.status === 2) {
    const audioUrl = data.data.audio_url || data.data.audio;
    if (!audioUrl) {
      throw new Error(`Music generation succeeded but no audio URL found: ${JSON.stringify(data)}`);
    }

    if (import.meta.env.DEV) {
      console.log('[MiniMax Music] 音乐生成完成, audioUrl:', audioUrl);
    }

    let audioBlob: Blob;
    if (output_format === 'hex' && typeof audioUrl === 'string') {
      const binaryString = audioUrl.match(/.{1,2}/g)?.map((h) => String.fromCharCode(parseInt(h, 16))).join('') ?? '';
      const buffer = new ArrayBuffer(binaryString.length);
      const view = new Uint8Array(buffer);
      for (let i = 0; i < binaryString.length; i++) view[i] = binaryString.charCodeAt(i);
      audioBlob = new Blob([buffer], { type: 'audio/mp3' });
    } else {
      const audioRes = await fetch(audioUrl as string, { signal });
      if (!audioRes.ok) throw new Error(`Failed to download audio: ${audioRes.status}`);
      audioBlob = await audioRes.blob();
    }

    const duration = data.extra_info?.music_duration ?? 0;

    return {
      audioBlob,
      durationMs: duration,
      taskId: data.trace_id || String(Date.now()),
    };
  }

  if (data.data?.status === 1) {
    throw new Error(`Music generation returned status=1 (processing), but MiniMax free endpoint is synchronous. Response: ${JSON.stringify(data)}`);
  }

  throw new Error(`Unexpected music generation response: ${JSON.stringify(data)}`);
}
