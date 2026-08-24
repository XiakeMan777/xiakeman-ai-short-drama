import type {
  AudioCue,
  BgmConfig,
  Chapter,
  PostClip,
  PostProductionState,
  PostTimelineItem,
  PostTimelineState,
  PostTimelineTrack,
  RenderJobState,
  StoryboardState,
  SubtitleCue,
} from '@/types';
import { normalizeFrameRatio } from '@/lib/frameRatio';
import { extractFromActionDescRaw } from '@/lib/extractDialogues';

export interface RenderAssetManifestItem {
  id: string;
  type: 'video' | 'sfx' | 'bgm';
  blobKey?: string;
  sourceUrl?: string;
  fileName: string;
}

export interface RenderManifest {
  version: string;
  projectName: string;
  chapterTitle: string;
  output: {
    width: number;
    height: number;
    fps: number;
  };
  assets: Array<{
    id: string;
    type: 'video' | 'sfx' | 'bgm';
    fileName: string;
  }>;
  clips: Array<{
    id: string;
    name: string;
    order: number;
    enabled: boolean;
    durationSec: number;
    sourceStartSec?: number;
    sourceEndSec?: number;
    videoAssetId: string;
    keepOriginalAudio: boolean;
    volume: number;
  }>;
  subtitles: SubtitleCue[];
  audioCues: Array<{
    id: string;
    clipId?: string;
    type: 'sfx';
    assetId: string;
    startSec: number;
    endSec?: number;
    volume: number;
    label: string;
  }>;
  bgm?: {
    assetId: string;
    volume: number;
    fadeIn: number;
    fadeOut: number;
    loop: boolean;
  };
}

export interface RenderPackage {
  manifest: RenderManifest;
  assets: RenderAssetManifestItem[];
}

export function getRenderOutputDimensions(videoRatio?: string | null) {
  return normalizeFrameRatio(videoRatio) === '16:9'
    ? { width: 1920, height: 1080, fps: 30 }
    : { width: 1080, height: 1920, fps: 30 };
}

export interface PreflightIssue {
  level: 'error' | 'warning';
  message: string;
  clipId?: string;
}

export interface PreflightResult {
  ok: boolean;
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
}

const DEFAULT_CLIP_DURATION_SEC = 15;
const DEFAULT_TIMELINE_SCALE = 28;
const TRACKS: PostTimelineTrack[] = [
  { id: 'track-video', type: 'video', name: '视频' },
  { id: 'track-original-audio', type: 'original-audio', name: '原声' },
  { id: 'track-subtitle', type: 'subtitle', name: '字幕' },
  { id: 'track-sfx', type: 'sfx', name: '音效' },
  { id: 'track-bgm', type: 'bgm', name: 'BGM' },
];

export function parseDurationSec(value?: string | number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0.1, value);
  const match = String(value ?? '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return DEFAULT_CLIP_DURATION_SEC;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CLIP_DURATION_SEC;
}

interface SubtitleCandidate {
  speaker: string;
  text: string;
  startSec?: number;
  endSec?: number;
  source: string;
}

function normalizeSubtitleText(text?: string) {
  return (text ?? '')
    .replace(/[“”「」『』]/g, '"')
    .replace(/^\s*(对白原文|对白|台词|旁白|内心OS|内心独白|voiceover|narration)\s*[：:]\s*/i, '')
    .trim();
}

function subtitleKey(candidate: Pick<SubtitleCandidate, 'speaker' | 'text'>) {
  return `${candidate.speaker.trim()}::${candidate.text.replace(/\s+/g, '')}`;
}

function parseTimeRangeSec(timeRange?: string, durationSec = DEFAULT_CLIP_DURATION_SEC) {
  const match = String(timeRange ?? '').match(/(\d+(?:\.\d+)?)\s*[-~–—]\s*(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const startSec = Math.max(0, Number(match[1]));
  const endSec = Math.min(durationSec, Math.max(startSec + 0.1, Number(match[2])));
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return undefined;
  return { startSec, endSec };
}

function splitRange(timeRange: string | undefined, count: number, durationSec: number) {
  const parsed = parseTimeRangeSec(timeRange, durationSec);
  if (!parsed || count <= 0) return Array.from({ length: count }, () => undefined);
  const segmentSec = (parsed.endSec - parsed.startSec) / count;
  return Array.from({ length: count }, (_, index) => ({
    startSec: Number((parsed.startSec + segmentSec * index).toFixed(3)),
    endSec: Number((index === count - 1 ? parsed.endSec : parsed.startSec + segmentSec * (index + 1)).toFixed(3)),
  }));
}

function pushSubtitleCandidate(
  candidates: SubtitleCandidate[],
  seen: Set<string>,
  candidate: SubtitleCandidate,
) {
  const text = normalizeSubtitleText(candidate.text);
  if (!text || /^(无|无台词|没有|none|null|undefined)$/i.test(text)) return;
  const next = { ...candidate, text };
  const key = subtitleKey(next);
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push(next);
}

function extractCharacterNames(chapter: Chapter) {
  const fromAnalysis = chapter.analysis?.allCharacterNames ?? [];
  const fromProfiles = chapter.analysis?.characterProfiles?.map((profile) => profile.name) ?? [];
  return Array.from(new Set([...fromAnalysis, ...fromProfiles].map((name) => name.trim()).filter(Boolean)));
}

function getDubbingSubtitleCandidates(chapter: Chapter, storyboardIndex: number, durationSec: number): SubtitleCandidate[] {
  return (chapter.dubbingAnalysisLines ?? [])
    .filter((line) => line.storyboardIndex === storyboardIndex)
    .map((line) => {
      const range = parseTimeRangeSec(line.timeRange, durationSec);
      return {
        speaker: line.speaker || '',
        text: line.text,
        startSec: range?.startSec,
        endSec: range?.endSec,
        source: '配音分析',
      };
    });
}

function getStoryboardSubtitleCandidates(
  sb: StoryboardState,
  storyboardIndex: number,
  characterNames: string[],
  durationSec: number,
): SubtitleCandidate[] {
  const candidates: SubtitleCandidate[] = [];
  const seen = new Set<string>();

  for (const segment of sb.prompt?.timeSegments ?? []) {
    const directTexts = [
      (segment as { dialogue?: string }).dialogue,
      (segment as { voiceover?: string }).voiceover,
      (segment as { narration?: string }).narration,
    ].filter((text): text is string => Boolean(text?.trim()));
    const directRanges = splitRange(segment.timeRange, directTexts.length, durationSec);
    directTexts.forEach((text, index) => pushSubtitleCandidate(candidates, seen, {
      speaker: '',
      text,
      startSec: directRanges[index]?.startSec,
      endSec: directRanges[index]?.endSec,
      source: '提示词时间段',
    }));

    const lines = extractFromActionDescRaw(
      segment.actionDesc,
      characterNames,
      storyboardIndex,
      sb.storyboard.name,
      segment.timeRange,
    );
    const actionRanges = splitRange(segment.timeRange, lines.length, durationSec);
    lines.forEach((line, index) => pushSubtitleCandidate(candidates, seen, {
      speaker: line.speaker,
      text: line.text,
      startSec: actionRanges[index]?.startSec,
      endSec: actionRanges[index]?.endSec,
      source: '动作台词',
    }));
  }

  for (const segment of sb.choreography?.timeSegments ?? []) {
    const actions = segment.actions.filter((action) => action.dialogue?.trim());
    const ranges = splitRange(segment.timeRange, actions.length, durationSec);
    actions.forEach((action, index) => pushSubtitleCandidate(candidates, seen, {
      speaker: action.character.replace(/(?:\([^)]*\)|【[^】]*】)/g, '').trim(),
      text: action.dialogue ?? '',
      startSec: ranges[index]?.startSec,
      endSec: ranges[index]?.endSec,
      source: '动作编排',
    }));
  }

  if (candidates.length === 0) {
    const fallbackText = [
      sb.videoSubmitPromptOverride,
      sb.seedanceFinalVideoPrompt,
      sb.compactVideoPrompt,
      sb.prompt?.rawText,
    ].find((text) => text?.trim());
    for (const line of extractFromActionDescRaw(
      fallbackText ?? '',
      characterNames,
      storyboardIndex,
      sb.storyboard.name,
    )) {
      pushSubtitleCandidate(candidates, seen, {
        speaker: line.speaker,
        text: line.text,
        source: '最终提示词',
      });
    }
  }

  return candidates;
}

function distributeSubtitleCandidates(candidates: SubtitleCandidate[], durationSec: number): SubtitleCandidate[] {
  if (candidates.length === 0) return [];
  let cursor = 0;
  return candidates.map((candidate, index) => {
    if (candidate.startSec !== undefined && candidate.endSec !== undefined && candidate.endSec > candidate.startSec) {
      const startSec = Math.max(0, Math.min(durationSec - 0.1, candidate.startSec));
      const endSec = Math.max(startSec + 0.1, Math.min(durationSec, candidate.endSec));
      cursor = Math.max(cursor, endSec);
      return { ...candidate, startSec, endSec };
    }

    const remaining = Math.max(0.1, durationSec - cursor);
    const remainingCount = candidates.slice(index).filter((item) => item.startSec === undefined || item.endSec === undefined).length;
    const segmentSec = Math.max(0.6, remaining / Math.max(1, remainingCount));
    const startSec = Math.min(Math.max(0, cursor), Math.max(0, durationSec - 0.1));
    const endSec = Math.min(durationSec, Math.max(startSec + 0.1, startSec + segmentSec));
    cursor = endSec;
    return { ...candidate, startSec, endSec };
  });
}

function getClipSubtitleCandidates(
  chapter: Chapter,
  sb: StoryboardState,
  storyboardIndex: number,
  durationSec: number,
  characterNames: string[],
) {
  const candidates: SubtitleCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of getDubbingSubtitleCandidates(chapter, storyboardIndex, durationSec)) {
    pushSubtitleCandidate(candidates, seen, candidate);
  }
  for (const candidate of getStoryboardSubtitleCandidates(sb, storyboardIndex, characterNames, durationSec)) {
    pushSubtitleCandidate(candidates, seen, candidate);
  }
  return distributeSubtitleCandidates(candidates, durationSec);
}

function extractPromptSubtitleText(
  chapter: Chapter,
  sb: StoryboardState,
  storyboardIndex: number,
  durationSec: number,
  characterNames: string[],
): string {
  return getClipSubtitleCandidates(chapter, sb, storyboardIndex, durationSec, characterNames)
    .map((candidate) => candidate.speaker ? `${candidate.speaker}：${candidate.text}` : candidate.text)
    .join('\n');
}

function splitSubtitleLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function createClipSubtitleCue(
  clip: PostClip,
  chapter?: Chapter,
  sb?: StoryboardState,
  characterNames: string[] = [],
): SubtitleCue[] {
  const candidates = chapter && sb
    ? getClipSubtitleCandidates(chapter, sb, clip.storyboardIndex, clip.durationSec, characterNames)
    : [];
  if (candidates.length > 0) {
    return candidates.map((candidate, index) => ({
      id: `sub-${clip.id}-${index + 1}`,
      clipId: clip.id,
      speaker: candidate.speaker,
      text: candidate.text,
      startSec: Math.max(0, Number((candidate.startSec ?? 0).toFixed(3))),
      endSec: Math.min(clip.durationSec, Number((candidate.endSec ?? clip.durationSec).toFixed(3))),
      source: candidate.source,
    }));
  }

  const lines = splitSubtitleLines(clip.subtitleText);
  if (lines.length === 0) return [];
  const segmentSec = clip.durationSec / lines.length;
  return lines.map((text, index) => ({
    id: `sub-${clip.id}-${index + 1}`,
    clipId: clip.id,
    speaker: '',
    text,
    startSec: Math.max(0, Number((segmentSec * index).toFixed(3))),
    endSec: Math.min(clip.durationSec, Number((segmentSec * (index + 1)).toFixed(3))),
  }));
}

function getSfxStatus(sb: StoryboardState): PostClip['sfxStatus'] {
  const segments = sb.prompt?.timeSegments?.filter((segment) => segment.soundEffect?.trim()) ?? [];
  if (segments.length === 0) return 'none';
  const ready = segments.filter((segment) => segment.soundEffectBlobKey).length;
  if (ready === 0) return 'missing';
  return ready >= segments.length ? 'ready' : 'partial';
}

function getBgmStatus(chapter: Chapter): PostClip['bgmStatus'] {
  if (!chapter.bgm) return 'missing';
  return chapter.bgm.blobKey ? 'ready' : 'style-only';
}

function mergeTrackState(track: PostTimelineTrack, previous?: PostTimelineTrack): PostTimelineTrack {
  return {
    ...track,
    muted: previous?.muted,
    locked: previous?.locked,
  };
}

function getTimelineTotalSec(clips: ReturnType<typeof getEnabledTimelineClips>): number {
  return clips.length ? clips[clips.length - 1].timelineEndSec : 0;
}

export function buildPostTimeline(
  postProduction: PostProductionState,
  bgm?: BgmConfig,
  previous?: PostTimelineState,
): PostTimelineState {
  const previousTracks = new Map((previous?.tracks ?? []).map((track) => [track.id, track]));
  const tracks = TRACKS.map((track) => mergeTrackState(track, previousTracks.get(track.id)));
  const enabledClips = getEnabledTimelineClips(postProduction);
  const totalSec = getTimelineTotalSec(enabledClips);
  const timelineByClip = new Map(enabledClips.map((clip) => [clip.id, clip]));
  const items: PostTimelineItem[] = [];

  for (const clip of enabledClips) {
    items.push({
      id: `timeline-video-${clip.id}`,
      trackId: 'track-video',
      type: 'clip',
      label: `${String(clip.storyboardIndex + 1).padStart(2, '0')} ${clip.name}`,
      startSec: clip.timelineStartSec,
      durationSec: clip.durationSec,
      sourceStartSec: clip.sourceStartSec ?? 0,
      sourceEndSec: clip.sourceEndSec ?? (clip.sourceStartSec ?? 0) + clip.durationSec,
      volume: clip.volume,
      enabled: clip.enabled,
      clipId: clip.id,
      status: clip.videoBlobKey || clip.videoUrl ? 'ready' : 'missing',
    });

    if (clip.keepOriginalAudio) {
      items.push({
        id: `timeline-original-audio-${clip.id}`,
        trackId: 'track-original-audio',
        type: 'original-audio',
        label: `${clip.name} 原声`,
        startSec: clip.timelineStartSec,
        durationSec: clip.durationSec,
        volume: clip.volume,
        enabled: clip.enabled,
        clipId: clip.id,
        status: 'ready',
      });
    }

    const clipSubtitles = postProduction.subtitles.filter((cue) => cue.clipId === clip.id && cue.text.trim());
    for (const cue of clipSubtitles) {
      items.push({
        id: `timeline-subtitle-${cue.id}`,
        trackId: 'track-subtitle',
        type: 'subtitle',
        label: cue.text,
        startSec: clip.timelineStartSec + cue.startSec,
        durationSec: Math.max(0.1, cue.endSec - cue.startSec),
        enabled: clip.enabled,
        clipId: clip.id,
        subtitleCueId: cue.id,
        text: cue.text,
        status: 'ready',
      });
    }
  }

  for (const cue of postProduction.audioCues) {
    const clip = cue.clipId ? timelineByClip.get(cue.clipId) : undefined;
    if (!clip) continue;
    const durationSec = cue.endSec && cue.endSec > cue.startSec
      ? cue.endSec - cue.startSec
      : Math.min(1.8, Math.max(0.6, clip.durationSec - cue.startSec));
    const type = cue.type === 'tts' ? 'tts' : 'sfx';
    items.push({
      id: `timeline-audio-${cue.id}`,
      trackId: type === 'tts' ? 'track-tts' : 'track-sfx',
      type,
      label: cue.label,
      startSec: clip.timelineStartSec + cue.startSec,
      durationSec,
      volume: cue.volume,
      enabled: cue.status !== 'missing' && cue.status !== 'error',
      clipId: cue.clipId,
      audioCueId: cue.id,
      status: cue.status,
    });
  }

  if (postProduction.audioCues.some((cue) => cue.type === 'tts') && !tracks.some((track) => track.id === 'track-tts')) {
    tracks.splice(3, 0, { id: 'track-tts', type: 'tts', name: '配音' });
  }

  if (bgm && totalSec > 0) {
    items.push({
      id: 'timeline-bgm-main',
      trackId: 'track-bgm',
      type: 'bgm',
      label: bgm.name || '章节 BGM',
      startSec: 0,
      durationSec: totalSec,
      volume: bgm.volume,
      enabled: Boolean(bgm.blobKey),
      status: bgm.blobKey ? 'ready' : 'missing',
    });
  }

  const maxPlayhead = Math.max(0, totalSec);
  const previousPlayhead = previous?.playheadSec ?? 0;
  return {
    version: 2,
    tracks,
    items,
    scalePxPerSec: previous?.scalePxPerSec ?? DEFAULT_TIMELINE_SCALE,
    playheadSec: Math.min(maxPlayhead, Math.max(0, previousPlayhead)),
    selectedItemId: previous?.selectedItemId,
  };
}

export function buildPostProductionState(chapter: Chapter): PostProductionState {
  const previous = chapter.postProduction;
  const characterNames = extractCharacterNames(chapter);
  const previousClipsByStoryboard = new Map<number, PostClip[]>();
  for (const clip of previous?.clips ?? []) {
    const list = previousClipsByStoryboard.get(clip.storyboardIndex) ?? [];
    list.push(clip);
    previousClipsByStoryboard.set(clip.storyboardIndex, list);
  }

  const clips: PostClip[] = chapter.storyboards.flatMap((sb, index) => {
    const previousClips = previousClipsByStoryboard.get(index)
      ?.sort((a, b) => a.order - b.order) ?? [];
    const sourceClips = previousClips.length > 0
      ? previousClips
      : [{
          id: `clip-${index + 1}`,
          storyboardIndex: index,
          name: sb.storyboard.name || `分镜 ${index + 1}`,
          order: index + 1,
          enabled: sb.videoStatus === 'done',
          durationSec: parseDurationSec(sb.storyboard.duration),
          keepOriginalAudio: true,
          volume: 1,
          subtitleText: '',
          sfxStatus: getSfxStatus(sb),
          bgmStatus: getBgmStatus(chapter),
        } satisfies PostClip];

    return sourceClips.map((previousClip, duplicateIndex) => {
      const clipId = previousClip.id || `clip-${index + 1}-${duplicateIndex + 1}`;
      const durationSec = previousClip.durationSec ?? parseDurationSec(sb.storyboard.duration);
      const subtitleText = previousClip.subtitleText
        || extractPromptSubtitleText(chapter, sb, index, durationSec, characterNames);
      const sourceStartSec = Math.max(0, previousClip.sourceStartSec ?? 0);
      const sourceEndSec = previousClip.sourceEndSec && previousClip.sourceEndSec > sourceStartSec
        ? previousClip.sourceEndSec
        : sourceStartSec + durationSec;
      return {
        ...previousClip,
        id: clipId,
        storyboardIndex: index,
        name: previousClip.name || sb.storyboard.name || `分镜 ${index + 1}`,
        order: previousClip.order ?? index + duplicateIndex + 1,
        enabled: previousClip.enabled ?? sb.videoStatus === 'done',
        durationSec,
        videoBlobKey: sb.videoBlobKey,
        videoUrl: sb.videoUrl,
        keepOriginalAudio: previousClip.keepOriginalAudio ?? true,
        volume: previousClip.volume ?? 1,
        sourceStartSec,
        sourceEndSec,
        subtitleText,
        sfxStatus: getSfxStatus(sb),
        bgmStatus: getBgmStatus(chapter),
      };
    });
  })
    .sort((a, b) => a.order - b.order)
    .map((clip, index) => ({ ...clip, order: index + 1 }));

  const clipIds = new Set(clips.map((clip) => clip.id));
  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const previousSubtitles = (previous?.subtitles ?? [])
    .filter((cue) => clipIds.has(cue.clipId) && cue.text.trim())
    .map((cue) => {
      const clip = clipById.get(cue.clipId);
      const startSec = Math.min(Math.max(0, cue.startSec), Math.max(0, (clip?.durationSec ?? cue.endSec) - 0.1));
      const endSec = Math.min(Math.max(startSec + 0.1, cue.endSec), clip?.durationSec ?? cue.endSec);
      return { ...cue, startSec, endSec };
    });
  const subtitles = previousSubtitles.length > 0
    ? previousSubtitles
    : clips.flatMap((clip) => createClipSubtitleCue(
      clip,
      chapter,
      chapter.storyboards[clip.storyboardIndex],
      characterNames,
    ));

  const derivedAudioCues: AudioCue[] = [];
  for (const clip of clips) {
    const sb = chapter.storyboards[clip.storyboardIndex];
    const segments = sb.prompt?.timeSegments ?? [];
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (!segment.soundEffectBlobKey) continue;
      const startSec = i === 0 ? 0.2 : Math.min(clip.durationSec - 0.2, (clip.durationSec / segments.length) * i);
      derivedAudioCues.push({
        id: `sfx-${clip.id}-${i + 1}`,
        clipId: clip.id,
        type: 'sfx',
        blobKey: segment.soundEffectBlobKey,
        label: segment.soundEffect?.trim() || '音效',
        startSec,
        volume: 0.65,
        status: 'ready',
      });
    }
  }
  const derivedAudioCueById = new Map(derivedAudioCues.map((cue) => [cue.id, cue]));
  const previousAudioCues = (previous?.audioCues ?? [])
    .filter((cue) => !cue.clipId || clipIds.has(cue.clipId));
  const previousAudioCueById = new Map(previousAudioCues.map((cue) => [cue.id, cue]));
  const audioCues: AudioCue[] = [
    ...derivedAudioCues.map((cue) => ({
      ...previousAudioCueById.get(cue.id),
      ...cue,
    })),
    ...previousAudioCues.filter((cue) => !derivedAudioCueById.has(cue.id)),
  ];

  const next: PostProductionState = {
    version: 1,
    generatedAt: Date.now(),
    clips,
    voiceProfiles: {},
    subtitles,
    audioCues,
    cc0Assets: previous?.cc0Assets ?? [],
    renderJob: previous?.renderJob,
  };
  return {
    ...next,
    timeline: buildPostTimeline(next, chapter.bgm, previous?.timeline),
  };
}

export function rebuildSubtitlesFromSources(
  postProduction: PostProductionState,
  chapter: Chapter,
): PostProductionState {
  const characterNames = extractCharacterNames(chapter);
  const subtitles = postProduction.clips.flatMap((clip) => createClipSubtitleCue(
    clip,
    chapter,
    chapter.storyboards[clip.storyboardIndex],
    characterNames,
  ));
  const clips = postProduction.clips.map((clip) => ({
    ...clip,
    subtitleText: subtitles
      .filter((cue) => cue.clipId === clip.id)
      .sort((a, b) => a.startSec - b.startSec)
      .map((cue) => cue.speaker ? `${cue.speaker}：${cue.text}` : cue.text)
      .join('\n'),
  }));
  const next: PostProductionState = {
    ...postProduction,
    generatedAt: Date.now(),
    clips,
    subtitles,
  };
  return {
    ...next,
    timeline: buildPostTimeline(next, chapter.bgm, postProduction.timeline),
  };
}

export function getEnabledTimelineClips(postProduction: PostProductionState): Array<PostClip & { timelineStartSec: number; timelineEndSec: number }> {
  let cursor = 0;
  return postProduction.clips
    .filter((clip) => clip.enabled)
    .sort((a, b) => a.order - b.order)
    .map((clip) => {
      const timelineClip = {
        ...clip,
        timelineStartSec: cursor,
        timelineEndSec: cursor + clip.durationSec,
      };
      cursor += clip.durationSec;
      return timelineClip;
    });
}

export function localizeCuesToTimeline(postProduction: PostProductionState): SubtitleCue[] {
  const clips = getEnabledTimelineClips(postProduction);
  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  return postProduction.subtitles
    .flatMap((cue) => {
      const clip = byId.get(cue.clipId);
      if (!clip) return [];
      return [{
        ...cue,
        startSec: clip.timelineStartSec + cue.startSec,
        endSec: clip.timelineStartSec + Math.min(cue.endSec, clip.durationSec),
      }];
    })
    .filter((cue) => cue.endSec > cue.startSec);
}

export function formatSrtTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function formatAssTime(seconds: number): string {
  const totalCs = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(totalCs / 360000);
  const minutes = Math.floor((totalCs % 360000) / 6000);
  const secs = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function buildSrt(cues: SubtitleCue[]): string {
  return cues
    .filter((cue) => cue.text.trim() && cue.endSec > cue.startSec)
    .sort((a, b) => a.startSec - b.startSec)
    .map((cue, index) => [
      String(index + 1),
      `${formatSrtTime(cue.startSec)} --> ${formatSrtTime(cue.endSec)}`,
      `${cue.speaker ? `${cue.speaker}: ` : ''}${cue.text}`.trim(),
    ].join('\n'))
    .join('\n\n')
    .concat('\n');
}

function escapeAss(value: string) {
  return value.replace(/[{}]/g, '').replace(/\r?\n/g, '\\N');
}

export function buildAss(cues: SubtitleCue[], output = { width: 1080, height: 1920 }): string {
  const fontSize = Math.max(38, Math.round(output.height * 0.032));
  const marginV = Math.max(90, Math.round(output.height * 0.09));
  const events = cues
    .filter((cue) => cue.text.trim() && cue.endSec > cue.startSec)
    .sort((a, b) => a.startSec - b.startSec)
    .map((cue) => {
      const text = `${cue.speaker ? `${cue.speaker}: ` : ''}${cue.text}`.trim();
      return `Dialogue: 0,${formatAssTime(cue.startSec)},${formatAssTime(cue.endSec)},Default,,0,0,0,,${escapeAss(text)}`;
    });
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${output.width}`,
    `PlayResY: ${output.height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Arial,${fontSize},&H00FFFFFF,&H000000FF,&HAA000000,&H66000000,1,0,0,0,100,100,0,0,1,5,1,2,48,48,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}

export function runPreflight(postProduction: PostProductionState): PreflightResult {
  const errors: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = [];
  const clips = getEnabledTimelineClips(postProduction);
  const totalClipCount = postProduction.clips.length;
  if (clips.length === 0) {
    errors.push({ level: 'error', message: '没有启用的视频片段，无法成片。' });
  }
  if (totalClipCount > 0 && clips.length > 0 && clips.length < totalClipCount) {
    warnings.push({
      level: 'warning',
      message: `当前只启用 ${clips.length}/${totalClipCount} 个片段；本次会输出试合成，不是完整本集。`,
    });
  }

  for (const clip of clips) {
    if (!clip.videoBlobKey && !clip.videoUrl) {
      errors.push({ level: 'error', clipId: clip.id, message: `${clip.name} 缺少视频文件。` });
    }
    if (!clip.keepOriginalAudio && !postProduction.audioCues.some((cue) => cue.clipId === clip.id && cue.blobKey)) {
      warnings.push({ level: 'warning', clipId: clip.id, message: `${clip.name} 已关闭视频原声，且没有独立音频；合成后这一段可能静音。` });
    }
    if (clip.sfxStatus === 'missing' || clip.sfxStatus === 'partial') {
      warnings.push({ level: 'warning', clipId: clip.id, message: `${clip.name} 有音效描述但未全部生成。` });
    }
  }

  if (clips.some((clip) => clip.bgmStatus === 'missing')) {
    warnings.push({ level: 'warning', message: '还没有真实 BGM 音频，成片会没有背景音乐。' });
  } else if (clips.some((clip) => clip.bgmStatus === 'style-only')) {
    warnings.push({ level: 'warning', message: '当前只有 BGM 风格，未生成音频文件。' });
  }

  return { ok: errors.length === 0, errors, warnings };
}

function addAsset(
  assets: RenderAssetManifestItem[],
  seen: Set<string>,
  type: RenderAssetManifestItem['type'],
  blobKey: string | undefined,
  preferredId: string,
  extension: string,
  sourceUrl?: string,
) {
  if (!blobKey && !sourceUrl) return '';
  const id = preferredId.replace(/[^\w.-]+/g, '_');
  if (!seen.has(id)) {
    seen.add(id);
    assets.push({
      id,
      type,
      blobKey,
      sourceUrl,
      fileName: `${id}.${extension}`,
    });
  }
  return id;
}

export function buildRenderPackage(
  postProduction: PostProductionState,
  chapter: Pick<Chapter, 'title' | 'bgm'>,
  projectName: string,
  options?: { videoRatio?: string | null },
): RenderPackage {
  const enabledClips = getEnabledTimelineClips(postProduction);
  const assets: RenderAssetManifestItem[] = [];
  const seen = new Set<string>();
  const output = getRenderOutputDimensions(options?.videoRatio);

  const clipManifests = enabledClips.map((clip) => {
    const videoAssetId = addAsset(assets, seen, 'video', clip.videoBlobKey, `video-${clip.id}`, 'mp4', clip.videoUrl);
    return {
      id: clip.id,
      name: clip.name,
      order: clip.order,
      enabled: clip.enabled,
      durationSec: clip.durationSec,
      sourceStartSec: clip.sourceStartSec,
      sourceEndSec: clip.sourceEndSec,
      videoAssetId,
      keepOriginalAudio: clip.keepOriginalAudio,
      volume: clip.volume,
    };
  });

  const timelineByClip = new Map(enabledClips.map((clip) => [clip.id, clip]));
  const audioCues = postProduction.audioCues.flatMap((cue) => {
    if (cue.type !== 'sfx') return [];
    const clip = cue.clipId ? timelineByClip.get(cue.clipId) : undefined;
    if (!clip || !cue.blobKey) return [];
    const assetId = addAsset(assets, seen, 'sfx', cue.blobKey, `sfx-${cue.id}`, 'mp3');
    return [{
      id: cue.id,
      clipId: cue.clipId,
      type: cue.type,
      assetId,
      startSec: clip.timelineStartSec + cue.startSec,
      endSec: cue.endSec === undefined ? undefined : clip.timelineStartSec + cue.endSec,
      volume: cue.volume,
      label: cue.label,
    }];
  });

  const bgmAssetId = addAsset(assets, seen, 'bgm', chapter.bgm?.blobKey, 'bgm-main', 'mp3');
  return {
    assets,
    manifest: {
      version: '1',
      projectName,
      chapterTitle: chapter.title,
      output: {
        width: output.width,
        height: output.height,
        fps: output.fps,
      },
      assets: assets.map(({ id, type, fileName }) => ({ id, type, fileName })),
      clips: clipManifests,
      subtitles: localizeCuesToTimeline(postProduction),
      audioCues,
      bgm: bgmAssetId && chapter.bgm ? {
        assetId: bgmAssetId,
        volume: chapter.bgm.volume,
        fadeIn: chapter.bgm.fadeIn,
        fadeOut: chapter.bgm.fadeOut,
        loop: chapter.bgm.loop,
      } : undefined,
    },
  };
}

export function updateRenderJob(postProduction: PostProductionState, renderJob: RenderJobState): PostProductionState {
  return {
    ...postProduction,
    renderJob,
  };
}

export function emptyPostProductionState(): PostProductionState {
  return {
    version: 1,
    generatedAt: Date.now(),
    clips: [],
    voiceProfiles: {},
    subtitles: [],
    audioCues: [],
    timeline: {
      version: 2,
      tracks: TRACKS,
      items: [],
      scalePxPerSec: DEFAULT_TIMELINE_SCALE,
      playheadSec: 0,
    },
  };
}

export function cloneBgmConfig(bgm: BgmConfig | undefined): BgmConfig | undefined {
  return bgm ? { ...bgm } : undefined;
}

export function createIdleRenderJob(): RenderJobState {
  return {
    status: 'idle',
    progress: 0,
  };
}
