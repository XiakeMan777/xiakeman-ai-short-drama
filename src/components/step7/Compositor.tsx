import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  AudioLines,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  Film,
  Layers3,
  Loader2,
  Music,
  Pause,
  Play,
  RefreshCw,
  Scissors,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Square,
  Subtitles,
  Trash2,
  Upload,
  Volume2,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentProject } from '@/stores/projectStore';
import { useBgmGeneration } from '@/components/step5/useBgmGeneration';
import {
  buildPostProductionState,
  buildPostTimeline,
  buildRenderPackage,
  buildSrt,
  buildAss,
  getEnabledTimelineClips,
  getRenderOutputDimensions,
  localizeCuesToTimeline,
  rebuildSubtitlesFromSources,
  runPreflight,
  updateRenderJob,
} from '@/lib/postProduction';
import { cancelRenderJob, createRenderJob, getRenderHealth, getRenderJob } from '@/lib/renderClient';
import { batchGenerateSoundEffects, generateSoundEffect } from '@/lib/soundEffectGenerator';
import { loadBlob, saveBlob } from '@/lib/imageStore';
import { resolveVideoBlob } from '@/lib/videoFileUtils';
import { cn } from '@/lib/utils';
import type { BgmConfig, PostClip, PostProductionState, PostTimelineItem, RenderJobState, SubtitleCue } from '@/types';

type InspectorMode = 'edit' | 'caption' | 'audio' | 'export';

function downloadText(text: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function normalizeJob(job: RenderJobState | undefined): RenderJobState {
  return job ?? { status: 'idle', progress: 0 };
}

function createEmptyPostProduction(): PostProductionState {
  return {
    version: 1,
    generatedAt: Date.now(),
    clips: [],
    voiceProfiles: {},
    subtitles: [],
    audioCues: [],
  };
}

function formatTimelineTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

function getTimelineTotalSec(items: PostTimelineItem[]) {
  return items.reduce((max, item) => Math.max(max, item.startSec + item.durationSec), 0);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getClipSourceTime(
  clip: (PostClip & { timelineStartSec?: number }) | undefined,
  timelineSecond: number,
) {
  if (!clip) return 0;
  const sourceStart = clip.sourceStartSec ?? 0;
  const localSecond = Math.max(0, timelineSecond - (clip.timelineStartSec ?? 0));
  return sourceStart + localSecond;
}

function getClipSubtitleText(subtitles: SubtitleCue[], clipId: string) {
  return subtitles
    .filter((cue) => cue.clipId === clipId)
    .sort((a, b) => a.startSec - b.startSec)
    .map((cue) => cue.text)
    .join('\n');
}

function syncSubtitleTextToClip(clips: PostClip[], subtitles: SubtitleCue[], clipId: string) {
  return clips.map((clip) => clip.id === clipId
    ? { ...clip, subtitleText: getClipSubtitleText(subtitles, clipId) }
    : clip);
}

function syncSubtitleTextToClips(clips: PostClip[], subtitles: SubtitleCue[], clipIds: string[]) {
  const idSet = new Set(clipIds);
  return clips.map((clip) => idSet.has(clip.id)
    ? { ...clip, subtitleText: getClipSubtitleText(subtitles, clip.id) }
    : clip);
}

function normalizeClipOrders(clips: PostClip[]) {
  return [...clips]
    .sort((a, b) => a.order - b.order)
    .map((clip, index) => ({ ...clip, order: index + 1 }));
}

function splitSubtitleText(text: string): [string, string] {
  const trimmed = text.trim();
  if (trimmed.length <= 1) return [trimmed, trimmed];
  const center = Math.ceil(trimmed.length / 2);
  const breakpoints: number[] = [];
  for (let index = 1; index < trimmed.length - 1; index += 1) {
    if ('，。；、,.!?！？; '.includes(trimmed[index])) breakpoints.push(index + 1);
  }
  const splitAt = breakpoints.reduce((best, index) => (
    best < 0 || Math.abs(index - center) < Math.abs(best - center) ? index : best
  ), -1);
  const pivot = splitAt > 0 ? splitAt : center;
  return [
    trimmed.slice(0, pivot).trim() || trimmed,
    trimmed.slice(pivot).trim() || trimmed,
  ];
}

function getItemTone(item: PostTimelineItem) {
  if (!item.enabled) return 'bg-muted text-muted-foreground border-border';
  if (item.type === 'clip') return 'border-sky-300/70 bg-sky-500/15 text-sky-950 dark:text-sky-100';
  if (item.type === 'original-audio') return 'border-emerald-300/70 bg-emerald-500/15 text-emerald-950 dark:text-emerald-100';
  if (item.type === 'subtitle') return 'border-amber-300/70 bg-amber-500/15 text-amber-950 dark:text-amber-100';
  if (item.type === 'sfx') return 'border-rose-300/70 bg-rose-500/15 text-rose-950 dark:text-rose-100';
  if (item.type === 'tts') return 'border-violet-300/70 bg-violet-500/15 text-violet-950 dark:text-violet-100';
  return 'border-lime-300/70 bg-lime-500/15 text-lime-950 dark:text-lime-100';
}

function getItemIcon(item: PostTimelineItem) {
  if (item.type === 'clip') return <Film className="h-3.5 w-3.5" />;
  if (item.type === 'subtitle') return <Subtitles className="h-3.5 w-3.5" />;
  if (item.type === 'bgm') return <Music className="h-3.5 w-3.5" />;
  if (item.type === 'original-audio' || item.type === 'tts' || item.type === 'sfx') return <AudioLines className="h-3.5 w-3.5" />;
  return <Layers3 className="h-3.5 w-3.5" />;
}

function useClipPreviewUrl(clip: PostClip | undefined) {
  const [preview, setPreview] = useState<{ key: string; url: string | null }>({ key: '', url: null });
  const clipKey = clip?.videoBlobKey ?? clip?.videoUrl ?? '';

  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;

    if (!clip?.videoBlobKey) return undefined;

    void resolveVideoBlob(undefined, clip.videoBlobKey)
      .then((blob) => {
        if (cancelled || !blob) return;
        revokedUrl = URL.createObjectURL(blob);
        setPreview({ key: clip.videoBlobKey ?? '', url: revokedUrl });
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [clip?.videoBlobKey, clip?.videoUrl]);

  if (!clip?.videoBlobKey && clip?.videoUrl) return { url: clip.videoUrl, loading: false };
  return {
    url: preview.key === clipKey ? preview.url : null,
    loading: Boolean(clip?.videoBlobKey && preview.key !== clipKey),
  };
}

export function Step7Compositor() {
  const { state, dispatch, currentProject, currentChapter: chapter } = useCurrentProject();
  const [postProduction, setPostProduction] = useState<PostProductionState | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(true);
  const [checkingRender, setCheckingRender] = useState(false);
  const [sfxGenerating, setSfxGenerating] = useState(false);
  const [sfxProgress, setSfxProgress] = useState({ done: 0, total: 0 });
  const [elevenLabsSfxKey, setElevenLabsSfxKey] = useState('');
  const [cc0Import, setCc0Import] = useState({
    type: 'sfx' as 'sfx' | 'bgm',
    sourceName: '',
    sourceUrl: '',
    author: '',
  });
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewSubtitlesVisible, setPreviewSubtitlesVisible] = useState(true);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>('edit');
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const {
    bgmProgress,
    bgmGenerating,
    bgmPreview,
    analyzeBgmOnly,
    confirmBgmGeneration,
    cancelBgmPreview,
    startBgmGeneration,
    cancelBgmGeneration,
    hasBgm,
  } = useBgmGeneration();

  useEffect(() => {
    if (!chapter) {
      setPostProduction(null);
      return;
    }
    setPostProduction(buildPostProductionState(chapter));
  }, [chapter]);

  useEffect(() => () => {
    if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    audioRef.current?.pause();
  }, []);

  const activePostProduction = postProduction ?? createEmptyPostProduction();
  const timelineClips = useMemo(() => getEnabledTimelineClips(activePostProduction), [activePostProduction]);
  const orderedClips = useMemo(
    () => [...activePostProduction.clips].sort((a, b) => a.order - b.order),
    [activePostProduction.clips],
  );
  const timeline = useMemo(
    () => buildPostTimeline(activePostProduction, chapter?.bgm, activePostProduction.timeline),
    [activePostProduction, chapter?.bgm],
  );
  const timelineCues = useMemo(() => localizeCuesToTimeline(activePostProduction), [activePostProduction]);
  const preflight = useMemo(() => runPreflight(activePostProduction), [activePostProduction]);
  const renderJob = normalizeJob(activePostProduction.renderJob);
  const enabledCount = activePostProduction.clips.filter((clip) => clip.enabled).length;
  const enabledClips = activePostProduction.clips.filter((clip) => clip.enabled);
  const isPartialEpisode = enabledCount > 0 && enabledCount < activePostProduction.clips.length;
  const videoReadyCount = enabledClips.filter((clip) => clip.videoBlobKey || clip.videoUrl).length;
  const nativeAudioCount = enabledClips.filter((clip) => clip.keepOriginalAudio).length;
  const sfxReadyCount = enabledClips.filter((clip) => clip.sfxStatus === 'ready' || clip.sfxStatus === 'none').length;
  const timelineTotalSec = getTimelineTotalSec(timeline.items);
  const selectedClip = activePostProduction.clips.find((clip) => clip.id === selectedClipId)
    ?? timelineClips[0];
  const selectedTimelineClip = selectedClip
    ? timelineClips.find((clip) => clip.id === selectedClip.id)
    : undefined;
  const selectedClipLocalPlayheadSec = selectedClip && selectedTimelineClip
    ? clampNumber(playheadSec - selectedTimelineClip.timelineStartSec, 0, selectedClip.durationSec)
    : 0;
  const canSplitSelectedClip = Boolean(
    selectedClip
      && selectedTimelineClip
      && selectedClipLocalPlayheadSec >= 0.5
      && selectedClip.durationSec - selectedClipLocalPlayheadSec >= 0.5,
  );
  const selectedItem = timeline.items.find((item) => item.id === selectedItemId)
    ?? timeline.items.find((item) => item.clipId === selectedClip?.id && item.type === 'clip')
    ?? timeline.items[0];
  const { url: previewUrl, loading: previewLoading } = useClipPreviewUrl(selectedClip);
  const currentTimelineClip = timelineClips.find((clip) => playheadSec >= clip.timelineStartSec && playheadSec < clip.timelineEndSec)
    ?? selectedClip;
  const currentSubtitle = timelineCues.find((cue) => playheadSec >= cue.startSec && playheadSec < cue.endSec);
  const selectedSubtitleCue = selectedItem?.subtitleCueId
    ? activePostProduction.subtitles.find((cue) => cue.id === selectedItem.subtitleCueId)
    : undefined;
  const selectedClipSubtitleCues = selectedClip
    ? activePostProduction.subtitles
      .filter((cue) => cue.clipId === selectedClip.id)
      .sort((a, b) => a.startSec - b.startSec)
    : [];
  const selectedSubtitleIndex = selectedSubtitleCue
    ? selectedClipSubtitleCues.findIndex((cue) => cue.id === selectedSubtitleCue.id)
    : -1;
  const subtitleSourceStats = useMemo(() => {
    const stats = new Map<string, number>();
    for (const cue of activePostProduction.subtitles) {
      const source = cue.source?.trim() || '手动/旧方案';
      stats.set(source, (stats.get(source) ?? 0) + 1);
    }
    return Array.from(stats.entries()).map(([source, count]) => ({ source, count }));
  }, [activePostProduction.subtitles]);

  useEffect(() => {
    const firstClip = timelineClips[0];
    if (!firstClip) {
      setSelectedClipId(null);
      setSelectedItemId(null);
      setPlayheadSec(0);
      return;
    }
    if (!selectedClipId || !timelineClips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(firstClip.id);
      setSelectedItemId(`timeline-video-${firstClip.id}`);
      setPlayheadSec(firstClip.timelineStartSec);
    }
  }, [selectedClipId, timelineClips]);

  if (!chapter || !currentProject || !postProduction) return null;

  const persistPostProduction = (next: PostProductionState) => {
    const withTimeline = {
      ...next,
      timeline: buildPostTimeline(next, chapter.bgm, next.timeline ?? postProduction.timeline),
    };
    setPostProduction(withTimeline);
    dispatch({ type: 'SET_POST_PRODUCTION_STATE', postProduction: withTimeline });
  };

  const rebuildPlan = () => {
    const next = buildPostProductionState(chapter);
    persistPostProduction(next);
    toast.success('已根据 Step5 最新视频结果刷新成片方案');
  };

  const updateClip = (clipId: string, updates: Partial<PostClip>) => {
    const currentClip = postProduction.clips.find((clip) => clip.id === clipId);
    const nextDuration = updates.durationSec ?? currentClip?.durationSec;
    persistPostProduction({
      ...postProduction,
      clips: postProduction.clips.map((clip) => clip.id === clipId ? { ...clip, ...updates } : clip),
      subtitles: nextDuration
        ? postProduction.subtitles.map((cue) => cue.clipId === clipId
          ? {
              ...cue,
              startSec: Math.min(cue.startSec, Math.max(0, nextDuration - 0.1)),
              endSec: Math.min(Math.max(cue.startSec + 0.1, cue.endSec), nextDuration),
            }
          : cue)
        : postProduction.subtitles,
    });
  };

  const updateClipTrim = (clip: PostClip, sourceStartSec: number, durationSec: number) => {
    const safeStart = clampNumber(sourceStartSec, 0, 60 * 60);
    const safeDuration = clampNumber(durationSec, 0.5, 60 * 60);
    updateClip(clip.id, {
      sourceStartSec: safeStart,
      sourceEndSec: safeStart + safeDuration,
      durationSec: safeDuration,
    });
  };

  const updateSubtitleCue = (cueId: string, updates: Partial<Pick<typeof postProduction.subtitles[number], 'text' | 'startSec' | 'endSec'>>) => {
    const nextSubtitles = postProduction.subtitles.map((cue) => {
      if (cue.id !== cueId) return cue;
      const clip = postProduction.clips.find((item) => item.id === cue.clipId);
      const maxEnd = clip?.durationSec ?? cue.endSec;
      const startSec = clampNumber(updates.startSec ?? cue.startSec, 0, Math.max(0, maxEnd - 0.1));
      const endSec = clampNumber(updates.endSec ?? cue.endSec, startSec + 0.1, maxEnd);
      return {
        ...cue,
        ...updates,
        startSec,
        endSec,
      };
    });
    const clipId = postProduction.subtitles.find((cue) => cue.id === cueId)?.clipId;
    const nextClips = clipId ? syncSubtitleTextToClip(postProduction.clips, nextSubtitles, clipId) : postProduction.clips;
    persistPostProduction({
      ...postProduction,
      clips: nextClips,
      subtitles: nextSubtitles,
    });
  };

  const updateClipSubtitleText = (clip: PostClip, subtitleText: string) => {
    const lines = subtitleText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const segmentSec = lines.length > 0 ? clip.durationSec / lines.length : clip.durationSec;
    const regenerated = lines.map((text, index) => ({
      id: `sub-${clip.id}-${index + 1}`,
      clipId: clip.id,
      speaker: '',
      text,
      startSec: Number((segmentSec * index).toFixed(3)),
      endSec: Number((segmentSec * (index + 1)).toFixed(3)),
      source: '手动文本',
    }));
    persistPostProduction({
      ...postProduction,
      clips: postProduction.clips.map((item) => item.id === clip.id ? { ...item, subtitleText } : item),
      subtitles: [
        ...postProduction.subtitles.filter((cue) => cue.clipId !== clip.id),
        ...regenerated,
      ],
    });
  };

  const selectSubtitleCue = (cue: SubtitleCue) => {
    const timelineClip = timelineClips.find((clip) => clip.id === cue.clipId);
    const timelineStart = timelineClip?.timelineStartSec ?? 0;
    const nextPlayhead = timelineStart + cue.startSec;
    setSelectedClipId(cue.clipId);
    setSelectedItemId(`timeline-subtitle-${cue.id}`);
    setPlayheadSec(nextPlayhead);
    if (videoRef.current && timelineClip) {
      videoRef.current.currentTime = getClipSourceTime(timelineClip, nextPlayhead);
    }
  };

  const selectSubtitleByOffset = (offset: -1 | 1) => {
    if (selectedClipSubtitleCues.length === 0) return;
    const baseIndex = selectedSubtitleIndex >= 0
      ? selectedSubtitleIndex
      : offset > 0 ? -1 : selectedClipSubtitleCues.length;
    const nextIndex = clampNumber(baseIndex + offset, 0, selectedClipSubtitleCues.length - 1);
    selectSubtitleCue(selectedClipSubtitleCues[nextIndex]);
  };

  const splitSelectedSubtitleCue = () => {
    if (!selectedSubtitleCue) return;
    const clip = postProduction.clips.find((item) => item.id === selectedSubtitleCue.clipId);
    if (!clip) return;
    const cueDuration = selectedSubtitleCue.endSec - selectedSubtitleCue.startSec;
    if (cueDuration < 0.4) {
      toast.info('这个字幕块太短，暂不适合继续拆分');
      return;
    }
    const timelineClip = timelineClips.find((item) => item.id === selectedSubtitleCue.clipId);
    const localPlayhead = timelineClip
      ? playheadSec - timelineClip.timelineStartSec
      : selectedSubtitleCue.startSec + cueDuration / 2;
    const splitAt = Number(clampNumber(
      localPlayhead,
      selectedSubtitleCue.startSec + 0.1,
      selectedSubtitleCue.endSec - 0.1,
    ).toFixed(3));
    const [firstText, secondText] = splitSubtitleText(selectedSubtitleCue.text);
    const nextCue: SubtitleCue = {
      ...selectedSubtitleCue,
      id: `${selectedSubtitleCue.id}-split-${Date.now().toString(36)}`,
      text: secondText,
      startSec: splitAt,
      endSec: selectedSubtitleCue.endSec,
    };
    const nextSubtitles = postProduction.subtitles.flatMap((cue) => cue.id === selectedSubtitleCue.id
      ? [
          { ...cue, text: firstText, endSec: splitAt },
          nextCue,
        ]
      : [cue]);
    persistPostProduction({
      ...postProduction,
      clips: syncSubtitleTextToClip(postProduction.clips, nextSubtitles, clip.id),
      subtitles: nextSubtitles,
    });
    selectSubtitleCue(nextCue);
    toast.success('已拆分字幕块');
  };

  const mergeSelectedSubtitleCueWithNext = () => {
    if (!selectedSubtitleCue || selectedSubtitleIndex < 0) return;
    const nextCue = selectedClipSubtitleCues[selectedSubtitleIndex + 1];
    if (!nextCue) {
      toast.info('后面没有可合并的字幕块');
      return;
    }
    const mergedText = [selectedSubtitleCue.text, nextCue.text]
      .map((text) => text.trim())
      .filter(Boolean)
      .join('\n');
    const nextSubtitles = postProduction.subtitles
      .filter((cue) => cue.id !== nextCue.id)
      .map((cue) => cue.id === selectedSubtitleCue.id
        ? {
            ...cue,
            text: mergedText,
            startSec: Math.min(cue.startSec, nextCue.startSec),
            endSec: Math.max(cue.endSec, nextCue.endSec),
          }
        : cue);
    persistPostProduction({
      ...postProduction,
      clips: syncSubtitleTextToClip(postProduction.clips, nextSubtitles, selectedSubtitleCue.clipId),
      subtitles: nextSubtitles,
    });
    selectSubtitleCue({
      ...selectedSubtitleCue,
      text: mergedText,
      startSec: Math.min(selectedSubtitleCue.startSec, nextCue.startSec),
      endSec: Math.max(selectedSubtitleCue.endSec, nextCue.endSec),
    });
    toast.success('已合并字幕块');
  };

  const splitSelectedClipAtPlayhead = () => {
    if (!selectedClip || !selectedTimelineClip) {
      toast.info('请先选择时间线上的一个已启用片段');
      return;
    }
    const splitAt = Number(selectedClipLocalPlayheadSec.toFixed(3));
    const firstDuration = Number(splitAt.toFixed(3));
    const secondDuration = Number((selectedClip.durationSec - splitAt).toFixed(3));
    if (firstDuration < 0.5 || secondDuration < 0.5) {
      toast.info('切点离片段边界太近，请至少保留 0.5 秒');
      return;
    }

    const suffix = Date.now().toString(36);
    const newClipId = `${selectedClip.id}-cut-${suffix}`;
    const sourceStartSec = selectedClip.sourceStartSec ?? 0;
    const firstClip: PostClip = {
      ...selectedClip,
      name: `${selectedClip.name} 前段`,
      durationSec: firstDuration,
      sourceEndSec: sourceStartSec + firstDuration,
    };
    const secondClip: PostClip = {
      ...selectedClip,
      id: newClipId,
      name: `${selectedClip.name} 后段`,
      order: selectedClip.order + 0.5,
      durationSec: secondDuration,
      sourceStartSec: sourceStartSec + firstDuration,
      sourceEndSec: sourceStartSec + firstDuration + secondDuration,
    };

    const nextSubtitles = postProduction.subtitles.flatMap((cue) => {
      if (cue.clipId !== selectedClip.id) return [cue];
      if (cue.endSec <= splitAt) return [cue];
      if (cue.startSec >= splitAt) {
        return [{
          ...cue,
          id: `${cue.id}-cut-${suffix}`,
          clipId: newClipId,
          startSec: Number((cue.startSec - splitAt).toFixed(3)),
          endSec: Number((cue.endSec - splitAt).toFixed(3)),
        }];
      }

      const [firstText, secondText] = splitSubtitleText(cue.text);
      return [
        {
          ...cue,
          text: firstText,
          endSec: splitAt,
        },
        {
          ...cue,
          id: `${cue.id}-cut-${suffix}`,
          clipId: newClipId,
          text: secondText,
          startSec: 0,
          endSec: Number((cue.endSec - splitAt).toFixed(3)),
        },
      ];
    });

    const nextAudioCues = postProduction.audioCues.flatMap((cue) => {
      if (cue.clipId !== selectedClip.id) return [cue];
      if (cue.startSec >= splitAt) {
        return [{
          ...cue,
          id: `${cue.id}-cut-${suffix}`,
          clipId: newClipId,
          startSec: Number((cue.startSec - splitAt).toFixed(3)),
          endSec: cue.endSec === undefined ? undefined : Number((cue.endSec - splitAt).toFixed(3)),
        }];
      }
      if (cue.endSec !== undefined && cue.endSec > splitAt) {
        return [
          { ...cue, endSec: splitAt },
          {
            ...cue,
            id: `${cue.id}-cut-${suffix}`,
            clipId: newClipId,
            startSec: 0,
            endSec: Number((cue.endSec - splitAt).toFixed(3)),
          },
        ];
      }
      return [cue];
    });

    const nextClips = syncSubtitleTextToClips(
      normalizeClipOrders(postProduction.clips.flatMap((clip) => (
        clip.id === selectedClip.id ? [firstClip, secondClip] : [clip]
      ))),
      nextSubtitles,
      [selectedClip.id, newClipId],
    );
    persistPostProduction({
      ...postProduction,
      clips: nextClips,
      subtitles: nextSubtitles,
      audioCues: nextAudioCues,
    });
    setSelectedClipId(newClipId);
    setSelectedItemId(`timeline-video-${newClipId}`);
    setPlayheadSec(selectedTimelineClip.timelineStartSec + firstDuration);
    toast.success('已在播放头切开片段');
  };

  const duplicateSelectedClip = () => {
    if (!selectedClip) return;
    const suffix = Date.now().toString(36);
    const newClipId = `${selectedClip.id}-copy-${suffix}`;
    const nextClip: PostClip = {
      ...selectedClip,
      id: newClipId,
      name: `${selectedClip.name} 副本`,
      order: selectedClip.order + 0.5,
    };
    const nextSubtitles = [
      ...postProduction.subtitles,
      ...postProduction.subtitles
        .filter((cue) => cue.clipId === selectedClip.id)
        .map((cue) => ({
          ...cue,
          id: `${cue.id}-copy-${suffix}`,
          clipId: newClipId,
        })),
    ];
    const nextAudioCues = [
      ...postProduction.audioCues,
      ...postProduction.audioCues
        .filter((cue) => cue.clipId === selectedClip.id)
        .map((cue) => ({
          ...cue,
          id: `${cue.id}-copy-${suffix}`,
          clipId: newClipId,
        })),
    ];
    persistPostProduction({
      ...postProduction,
      clips: normalizeClipOrders([...postProduction.clips, nextClip]),
      subtitles: nextSubtitles,
      audioCues: nextAudioCues,
    });
    setSelectedClipId(newClipId);
    setSelectedItemId(`timeline-video-${newClipId}`);
    if (selectedTimelineClip) setPlayheadSec(selectedTimelineClip.timelineEndSec);
    toast.success('已复制片段');
  };

  const removeSelectedClipFromTimeline = () => {
    if (!selectedClip) return;
    updateClip(selectedClip.id, { enabled: false });
    toast.success('已移出本次成片，可在启用片段开关恢复');
  };

  const moveClip = (clipId: string, direction: -1 | 1) => {
    const ordered = [...postProduction.clips].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((clip) => clip.id === clipId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const currentOrder = ordered[index].order;
    ordered[index].order = ordered[target].order;
    ordered[target].order = currentOrder;
    persistPostProduction({
      ...postProduction,
      clips: postProduction.clips.map((clip) => ordered.find((item) => item.id === clip.id) ?? clip),
    });
  };

  const reorderClipBefore = (sourceClipId: string, targetClipId: string) => {
    if (sourceClipId === targetClipId) return;
    const ordered = [...postProduction.clips].sort((a, b) => a.order - b.order);
    const source = ordered.find((clip) => clip.id === sourceClipId);
    if (!source) return;
    const withoutSource = ordered.filter((clip) => clip.id !== sourceClipId);
    const targetIndex = withoutSource.findIndex((clip) => clip.id === targetClipId);
    if (targetIndex < 0) return;
    withoutSource.splice(targetIndex, 0, source);
    const reordered = withoutSource.map((clip, index) => ({ ...clip, order: index + 1 }));
    persistPostProduction({
      ...postProduction,
      clips: postProduction.clips.map((clip) => reordered.find((item) => item.id === clip.id) ?? clip),
    });
  };

  const handleBgmUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const blobKey = await saveBlob(file);
    const bgm: BgmConfig = {
      id: `upload-${Date.now()}`,
      name: file.name.replace(/\.[^.]+$/, ''),
      source: 'upload',
      blobKey,
      volume: chapter.bgm?.volume ?? 0.3,
      loop: true,
      fadeIn: 1,
      fadeOut: 1,
    };
    dispatch({ type: 'SET_CHAPTER_BGM', bgm });
    toast.success('BGM 已上传');
  };

  const handleCc0Import = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!cc0Import.sourceName.trim()) {
      toast.error('请先填写素材来源名称');
      return;
    }
    const blobKey = await saveBlob(file);
    const asset = {
      id: `cc0-${Date.now()}`,
      name: file.name.replace(/\.[^.]+$/, ''),
      blobKey,
      mimeType: file.type || 'audio/mpeg',
      type: cc0Import.type,
      sourceName: cc0Import.sourceName.trim(),
      sourceUrl: cc0Import.sourceUrl.trim() || undefined,
      license: 'CC0' as const,
      author: cc0Import.author.trim() || undefined,
      importedAt: Date.now(),
    };
    persistPostProduction({
      ...postProduction,
      cc0Assets: [...(postProduction.cc0Assets ?? []), asset],
    });
    toast.success('CC0 素材已导入本地，并保存许可证信息');
  };

  const handleCc0AsBgm = (assetId: string) => {
    const asset = postProduction.cc0Assets?.find((item) => item.id === assetId);
    if (!asset || asset.type !== 'bgm') return;
    dispatch({
      type: 'SET_CHAPTER_BGM',
      bgm: {
        id: asset.id,
        name: asset.name,
        source: 'upload',
        blobKey: asset.blobKey,
        volume: chapter.bgm?.volume ?? 0.3,
        loop: true,
        fadeIn: 1,
        fadeOut: 1,
      },
    });
    toast.success('已使用该 CC0 素材作为 BGM');
  };

  const updateBgmVolume = (volume: number) => {
    if (!chapter.bgm) return;
    dispatch({ type: 'SET_CHAPTER_BGM', bgm: { ...chapter.bgm, volume } });
  };

  const handleGenerateSfx = async () => {
    const tasks: Array<{ sbIndex: number; segmentIndex: number; description: string }> = [];
    for (let sbIndex = 0; sbIndex < chapter.storyboards.length; sbIndex += 1) {
      const segments = chapter.storyboards[sbIndex].prompt?.timeSegments ?? [];
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const segment = segments[segmentIndex];
        if (segment.soundEffect?.trim() && !segment.soundEffectBlobKey) {
          tasks.push({ sbIndex, segmentIndex, description: segment.soundEffect.trim() });
        }
      }
    }
    if (tasks.length === 0) {
      toast.info('没有缺失音效');
      return;
    }

    if (!elevenLabsSfxKey.trim() && !state.ttsApiConfig.apiKey) {
      toast.error('请填写 ElevenLabs SFX Key，或配置语音接口作为占位音效降级');
      return;
    }

    setSfxGenerating(true);
    setSfxProgress({ done: 0, total: tasks.length });
    try {
      const blobs = await batchGenerateSoundEffects(
        tasks.map((task) => task.description),
        state.ttsApiConfig,
        (done, total) => setSfxProgress({ done, total }),
        3,
        elevenLabsSfxKey.trim() ? { type: 'elevenlabs', apiKey: elevenLabsSfxKey.trim() } : undefined,
      );
      let saved = 0;
      for (let i = 0; i < blobs.length; i += 1) {
        const blob = blobs[i];
        if (!blob) continue;
        const blobKey = await saveBlob(blob);
        dispatch({ type: 'SET_SFX_BLOB_KEY', index: tasks[i].sbIndex, segmentIndex: tasks[i].segmentIndex, blobKey });
        saved += 1;
      }
      toast.success(`音效生成完成：${saved}/${tasks.length}`);
      persistPostProduction(buildPostProductionState(chapter));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSfxGenerating(false);
    }
  };

  const handleGenerateOneSfx = async (clip: PostClip) => {
    const sb = chapter.storyboards[clip.storyboardIndex];
    const segment = sb.prompt?.timeSegments?.find((item) => item.soundEffect?.trim() && !item.soundEffectBlobKey);
    const segmentIndex = sb.prompt?.timeSegments?.findIndex((item) => item === segment) ?? -1;
    if (!segment || segmentIndex < 0) {
      toast.info('这个片段没有缺失音效');
      return;
    }
    if (!elevenLabsSfxKey.trim() && !state.ttsApiConfig.apiKey) {
      toast.error('请填写 ElevenLabs SFX Key，或配置语音接口作为占位音效降级');
      return;
    }
    try {
      const blob = await generateSoundEffect({
        description: segment.soundEffect!.trim(),
        ttsConfig: state.ttsApiConfig,
        provider: elevenLabsSfxKey.trim() ? 'elevenlabs' : 'mimo-fallback',
        elevenLabsApiKey: elevenLabsSfxKey.trim(),
      });
      const blobKey = await saveBlob(blob);
      dispatch({ type: 'SET_SFX_BLOB_KEY', index: clip.storyboardIndex, segmentIndex, blobKey });
      toast.success('音效已生成');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const previewClipAudio = async (clip: PostClip) => {
    if (previewing === clip.id) {
      audioRef.current?.pause();
      setPreviewing(null);
      return;
    }
    const audioCue = postProduction.audioCues.find((cue) => cue.clipId === clip.id && cue.blobKey);
    if (!audioCue?.blobKey) {
      toast.warning(clip.keepOriginalAudio
        ? '这个片段使用视频原声，独立音效还没有生成。'
        : '这个片段还没有可预览的独立音频。');
      return;
    }
    const blob = await loadBlob(audioCue.blobKey);
    if (!blob) {
      toast.error('音频读取失败');
      return;
    }
    audioRef.current?.pause();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => {
      URL.revokeObjectURL(url);
      setPreviewing(null);
    };
    audioRef.current = audio;
    await audio.play();
    setPreviewing(clip.id);
  };

  const setRenderJob = (job: RenderJobState) => {
    const next = updateRenderJob(postProduction, job);
    persistPostProduction(next);
  };

  const pollJob = (jobId: string) => {
    if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    pollTimerRef.current = window.setTimeout(async () => {
      try {
        const job = await getRenderJob(jobId);
        setRenderJob(job);
        if (job.status === 'queued' || job.status === 'running') {
          pollJob(jobId);
        } else if (job.status === 'done') {
          toast.success('渲染完成，可以下载 ZIP');
        } else if (job.status === 'failed') {
          toast.error(job.error || '渲染失败');
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    }, 1500);
  };

  const handleRender = async () => {
    const result = runPreflight(postProduction);
    if (!result.ok) {
      setPreflightOpen(true);
      toast.error('预检未通过，请先补齐红色阻塞项');
      return;
    }
    setCheckingRender(true);
    try {
      const health = await getRenderHealth();
      if (!health.ok) {
        throw new Error('服务端没有检测到 FFmpeg/ffprobe，无法渲染');
      }
      const pkg = buildRenderPackage(postProduction, chapter, currentProject.name, {
        videoRatio: state.videoApiConfig.videoRatio,
      });
      const job = await createRenderJob(pkg, {
        project: currentProject,
        chapterId: chapter.id,
      });
      setRenderJob(job);
      if (job.id) pollJob(job.id);
      toast.success('渲染任务已提交');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingRender(false);
    }
  };

  const handleCancelRender = async () => {
    if (!renderJob.id) return;
    try {
      const job = await cancelRenderJob(renderJob.id);
      setRenderJob(job);
      toast.success('渲染已取消');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const downloadSubtitles = () => {
    const output = getRenderOutputDimensions(state.videoApiConfig.videoRatio);
    downloadText(buildSrt(timelineCues), 'episode.srt', 'text/plain;charset=utf-8');
    downloadText(buildAss(timelineCues, output), 'episode.ass', 'text/plain;charset=utf-8');
  };

  const rebuildSubtitles = () => {
    const next = rebuildSubtitlesFromSources(postProduction, chapter);
    persistPostProduction(next);
    const count = next.subtitles.length;
    toast.success(count > 0 ? `已从脚本/提示词/配音分析重建 ${count} 条字幕` : '没有找到可重建的台词字幕');
  };

  const selectTimelineItem = (item: PostTimelineItem) => {
    setSelectedItemId(item.id);
    if (item.clipId) setSelectedClipId(item.clipId);
    setPlayheadSec(item.startSec);
    if (videoRef.current && item.clipId) {
      const clip = timelineClips.find((candidate) => candidate.id === item.clipId);
      videoRef.current.currentTime = getClipSourceTime(clip, item.startSec);
    }
  };

  const selectClip = (clip: PostClip) => {
    const timelineClip = timelineClips.find((candidate) => candidate.id === clip.id);
    setSelectedClipId(clip.id);
    setSelectedItemId(`timeline-video-${clip.id}`);
    if (!timelineClip) return;
    setPlayheadSec(timelineClip.timelineStartSec);
    if (videoRef.current) videoRef.current.currentTime = getClipSourceTime(timelineClip, timelineClip.timelineStartSec);
  };

  const selectClipByOffset = (offset: -1 | 1) => {
    if (timelineClips.length === 0) return;
    const currentIndex = Math.max(0, timelineClips.findIndex((clip) => clip.id === selectedClip?.id));
    const nextIndex = Math.min(timelineClips.length - 1, Math.max(0, currentIndex + offset));
    const nextClip = timelineClips[nextIndex];
    setSelectedClipId(nextClip.id);
    setSelectedItemId(`timeline-video-${nextClip.id}`);
    setPlayheadSec(nextClip.timelineStartSec);
    if (videoRef.current) videoRef.current.currentTime = getClipSourceTime(nextClip, nextClip.timelineStartSec);
  };

  const togglePreviewPlayback = async () => {
    const video = videoRef.current;
    if (!video || !previewUrl) return;
    if (video.paused) {
      await video.play();
      setPreviewPlaying(true);
    } else {
      video.pause();
      setPreviewPlaying(false);
    }
  };

  const handlePreviewTimeUpdate = () => {
    if (!videoRef.current || !selectedClip) return;
    const clip = timelineClips.find((item) => item.id === selectedClip.id);
    const clipStart = clip?.timelineStartSec ?? 0;
    const sourceStart = selectedClip.sourceStartSec ?? 0;
    const localSecond = Math.max(0, videoRef.current.currentTime - sourceStart);
    if (clip && localSecond >= clip.durationSec - 0.05) {
      handlePreviewEnded();
      return;
    }
    setPlayheadSec(Math.min(timelineTotalSec, clipStart + localSecond));
  };

  const handlePlayheadChange = (value: number) => {
    setPlayheadSec(value);
    const clip = timelineClips.find((item) => value >= item.timelineStartSec && value <= item.timelineEndSec);
    if (!clip) return;
    setSelectedClipId(clip.id);
    setSelectedItemId(`timeline-video-${clip.id}`);
    if (videoRef.current) videoRef.current.currentTime = getClipSourceTime(clip, value);
  };

  const handlePreviewEnded = () => {
    const currentIndex = timelineClips.findIndex((clip) => clip.id === selectedClip?.id);
    const nextClip = timelineClips[currentIndex + 1];
    if (!nextClip) {
      setPreviewPlaying(false);
      return;
    }
    setSelectedClipId(nextClip.id);
    setSelectedItemId(`timeline-video-${nextClip.id}`);
    setPlayheadSec(nextClip.timelineStartSec);
  };

  const syncPreviewToPlayhead = () => {
    if (!videoRef.current || !currentTimelineClip) return;
    videoRef.current.currentTime = getClipSourceTime(currentTimelineClip, playheadSec);
    if (previewPlaying) {
      void videoRef.current.play().catch(() => setPreviewPlaying(false));
    }
  };

  const adjustTimelineZoom = (direction: -1 | 1) => {
    const current = postProduction.timeline?.scalePxPerSec ?? timeline.scalePxPerSec;
    const nextScale = Math.min(72, Math.max(16, current + direction * 8));
    persistPostProduction({
      ...postProduction,
      timeline: {
        ...timeline,
        scalePxPerSec: nextScale,
      },
    });
  };

  const isLandscapePreview = state.videoApiConfig.videoRatio === '16:9';
  const previewHeightClamp = isLandscapePreview
    ? 'clamp(260px, 38vh, 420px)'
    : 'clamp(300px, 52vh, 520px)';
  const previewFrameStyle = {
    aspectRatio: isLandscapePreview ? '16 / 9' : '9 / 16',
    maxHeight: previewHeightClamp,
    width: isLandscapePreview
      ? `min(100%, calc(100vw - 2rem), calc(${previewHeightClamp} * 1.7778))`
      : `min(100%, calc(100vw - 2rem), calc(${previewHeightClamp} * 0.5625))`,
  };

  return (
    <div className="space-y-4">
      <Card className="surface-panel border-white/70">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Scissors className="h-5 w-5 text-amber-600" />
                成片剪映工作台
                <Badge variant="outline" className="ml-1">轻量网页剪辑</Badge>
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                左侧管素材，中间看画面，底部剪时间线，右侧调属性；默认使用 Step5 视频原声，可补字幕、音效和 BGM。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <Button className="min-w-0" size="sm" variant="outline" onClick={rebuildPlan}>
                <RefreshCw className="mr-1 h-4 w-4" />刷新方案
              </Button>
              <Button className="min-w-0" size="sm" variant="outline" onClick={rebuildSubtitles}>
                <Subtitles className="mr-1 h-4 w-4" />重建字幕
              </Button>
              <Button className="min-w-0" size="sm" variant="outline" onClick={downloadSubtitles}>
                <Download className="mr-1 h-4 w-4" />下载字幕
              </Button>
              {renderJob.status === 'queued' || renderJob.status === 'running' ? (
                <Button className="min-w-0" size="sm" variant="outline" onClick={() => void handleCancelRender()}>
                  <Square className="mr-1 h-4 w-4" />取消渲染
                </Button>
              ) : (
                <Button className="min-w-0" size="sm" onClick={() => void handleRender()} disabled={checkingRender}>
                  {checkingRender ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileArchive className="mr-1 h-4 w-4" />}
                  {isPartialEpisode ? '试合成 ZIP' : '合成 ZIP'}
                </Button>
              )}
              {renderJob.status === 'done' && renderJob.downloadUrl && (
                <Button className="min-w-0" size="sm" variant="outline" asChild>
                  <a href={renderJob.downloadUrl}>
                    <Download className="mr-1 h-4 w-4" />下载 ZIP
                  </a>
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <div className="rounded-lg border bg-background/60 p-3">
              <p className="text-2xl font-semibold">{enabledCount}/{postProduction.clips.length}</p>
              <p className="text-xs text-muted-foreground">启用片段</p>
            </div>
            <div className="rounded-lg border bg-background/60 p-3">
              <p className="text-2xl font-semibold">{videoReadyCount}</p>
              <p className="text-xs text-muted-foreground">视频素材</p>
            </div>
            <div className="rounded-lg border bg-background/60 p-3">
              <p className="text-2xl font-semibold">{nativeAudioCount}/{enabledCount}</p>
              <p className="text-xs text-muted-foreground">保留原声</p>
            </div>
            <div className="rounded-lg border bg-background/60 p-3">
              <p className="text-2xl font-semibold">{sfxReadyCount}/{enabledCount}</p>
              <p className="text-xs text-muted-foreground">音效状态</p>
            </div>
            <div className="rounded-lg border bg-background/60 p-3">
              <p className="text-2xl font-semibold">{formatTimelineTime(timelineTotalSec)}</p>
              <p className="text-xs text-muted-foreground">成片时长</p>
            </div>
          </div>

          {(renderJob.status === 'queued' || renderJob.status === 'running' || renderJob.status === 'failed' || renderJob.status === 'done') && (
            <div className="rounded-lg border bg-background/70 p-3">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span>{renderJob.message ?? '渲染任务'}</span>
                <span>{Math.round(renderJob.progress)}%</span>
              </div>
              <Progress value={renderJob.progress} className="h-2" />
              {renderJob.error && <p className="mt-2 text-xs text-red-600">{renderJob.error}</p>}
            </div>
          )}

          {subtitleSourceStats.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background/60 p-3 text-xs">
              <span className="text-muted-foreground">字幕来源</span>
              {subtitleSourceStats.map((item) => (
                <Badge key={item.source} variant="outline">{item.source} {item.count}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_minmax(320px,360px)]">
        <div className="space-y-4">
          <Card className="surface-panel border-white/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Layers3 className="h-4 w-4" />
                素材片段
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-md border bg-background/60 p-2">
                  <p className="font-semibold">{orderedClips.length}</p>
                  <p className="text-muted-foreground">总片段</p>
                </div>
                <div className="rounded-md border bg-background/60 p-2">
                  <p className="font-semibold">{enabledCount}</p>
                  <p className="text-muted-foreground">入轨</p>
                </div>
                <div className="rounded-md border bg-background/60 p-2">
                  <p className="font-semibold">{timeline.items.filter((item) => item.type === 'subtitle').length}</p>
                  <p className="text-muted-foreground">字幕</p>
                </div>
              </div>
              <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                {orderedClips.map((clip) => {
                  const isSelected = selectedClip?.id === clip.id;
                  return (
                    <div
                      key={clip.id}
                      className={cn(
                        'rounded-lg border bg-background/60 p-2 transition',
                        isSelected && 'border-amber-400 bg-amber-500/10',
                      )}
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => selectClip(clip)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {String(clip.storyboardIndex + 1).padStart(2, '0')} {clip.name}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {clip.durationSec.toFixed(1)}s · {clip.videoBlobKey || clip.videoUrl ? '视频就绪' : '缺视频'}
                            </p>
                          </div>
                          <Badge variant={clip.enabled ? 'default' : 'outline'}>{clip.enabled ? '入轨' : '未入轨'}</Badge>
                        </div>
                      </button>
                      <div className="mt-2 flex items-center gap-2">
                        <Button className="flex-1" size="sm" variant="outline" onClick={() => selectClip(clip)}>
                          选中
                        </Button>
                        <Button
                          className="flex-1"
                          size="sm"
                          variant={clip.enabled ? 'ghost' : 'outline'}
                          onClick={() => updateClip(clip.id, { enabled: !clip.enabled })}
                        >
                          {clip.enabled ? '移出' : '入轨'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="surface-panel border-white/70">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Film className="h-4 w-4" />
                  画面预览
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{state.videoApiConfig.videoRatio || '9:16'}</Badge>
                  <span>播放头 {formatTimelineTime(playheadSec)}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => setPreviewSubtitlesVisible((value) => !value)}
                  >
                    {previewSubtitlesVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {previewSubtitlesVisible ? '隐藏字幕' : '显示字幕'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                <div className={cn(
                  'relative mx-auto flex w-full items-center justify-center overflow-hidden rounded-lg border bg-black',
                )} style={previewFrameStyle}>
                  {previewUrl ? (
                    <>
                      <video
                        ref={videoRef}
                        src={previewUrl}
                        className="h-full w-full object-contain"
                        controls={false}
                        onLoadedMetadata={syncPreviewToPlayhead}
                        onCanPlay={() => {
                          if (previewPlaying) void videoRef.current?.play().catch(() => setPreviewPlaying(false));
                        }}
                        onTimeUpdate={handlePreviewTimeUpdate}
                        onPlay={() => setPreviewPlaying(true)}
                        onPause={() => setPreviewPlaying(false)}
                        onEnded={handlePreviewEnded}
                      />
                      {previewSubtitlesVisible && currentSubtitle && (
                        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center sm:inset-x-4 sm:bottom-4">
                          <div className="max-w-[88%] rounded-md bg-black/65 px-3 py-1.5 text-center text-xs font-medium leading-relaxed text-white shadow-lg sm:px-4 sm:py-2 sm:text-sm">
                            {currentSubtitle.speaker ? `${currentSubtitle.speaker}：` : ''}{currentSubtitle.text}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 px-6 text-center text-sm text-white/70">
                      {previewLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Film className="h-8 w-8 opacity-60" />}
                      <span>{previewLoading ? '正在读取视频素材' : '选择一个已完成视频片段后预览'}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="rounded-lg border bg-background/60 p-3">
                    <p className="truncate text-sm font-medium">{selectedClip ? `${String(selectedClip.storyboardIndex + 1).padStart(2, '0')} ${selectedClip.name}` : '未选择片段'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedClip ? `${selectedClip.durationSec.toFixed(1)} 秒 · ${selectedClip.enabled ? '已启用' : '未启用'}` : '时间线暂无可预览内容'}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <Button size="icon" variant="outline" onClick={() => selectClipByOffset(-1)} disabled={timelineClips.length <= 1}>
                        <SkipBack className="h-4 w-4" />
                      </Button>
                      <Button className="flex-1" onClick={() => void togglePreviewPlayback()} disabled={!previewUrl}>
                        {previewPlaying ? <Pause className="mr-1 h-4 w-4" /> : <Play className="mr-1 h-4 w-4" />}
                        {previewPlaying ? '暂停' : '播放'}
                      </Button>
                      <Button size="icon" variant="outline" onClick={() => selectClipByOffset(1)} disabled={timelineClips.length <= 1}>
                        <SkipForward className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-lg border bg-background/60 p-3">
                    <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>时间定位</span>
                      <span>{formatTimelineTime(timelineTotalSec)}</span>
                    </div>
                    <Slider
                      value={[playheadSec]}
                      min={0}
                      max={Math.max(timelineTotalSec, 1)}
                      step={0.1}
                      onValueChange={([value]) => handlePlayheadChange(value)}
                    />
                  </div>

                  <div className="rounded-lg border bg-background/60 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium">剪辑工具</span>
                      <span className="text-muted-foreground">
                        切点 {selectedClip ? `${selectedClipLocalPlayheadSec.toFixed(1)}s / ${selectedClip.durationSec.toFixed(1)}s` : '--'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Button size="sm" variant="outline" onClick={splitSelectedClipAtPlayhead} disabled={!canSplitSelectedClip}>
                        <Scissors className="mr-1 h-4 w-4" />
                        切一刀
                      </Button>
                      <Button size="sm" variant="outline" onClick={duplicateSelectedClip} disabled={!selectedClip}>
                        <Copy className="mr-1 h-4 w-4" />
                        复制
                      </Button>
                      <Button size="sm" variant="outline" onClick={removeSelectedClipFromTimeline} disabled={!selectedClip?.enabled}>
                        <Trash2 className="mr-1 h-4 w-4" />
                        移出
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg border bg-background/60 p-3">
                      <p className="text-muted-foreground">字幕块</p>
                      <p className="mt-1 text-lg font-semibold">{timeline.items.filter((item) => item.type === 'subtitle').length}</p>
                    </div>
                    <div className="rounded-lg border bg-background/60 p-3">
                      <p className="text-muted-foreground">音频块</p>
                      <p className="mt-1 text-lg font-semibold">{timeline.items.filter((item) => item.type === 'sfx' || item.type === 'bgm' || item.type === 'original-audio' || item.type === 'tts').length}</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="surface-panel border-white/70">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Layers3 className="h-4 w-4" />
                  多轨时间线
                </CardTitle>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" onClick={() => adjustTimelineZoom(-1)}>
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <span className="w-16 text-center text-xs text-muted-foreground">{timeline.scalePxPerSec}px/s</span>
                  <Button size="icon" variant="ghost" onClick={() => adjustTimelineZoom(1)}>
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border bg-background/70">
                <div
                  className="min-w-[620px] p-3 sm:min-w-[760px]"
                  style={{ width: Math.max(620, timelineTotalSec * timeline.scalePxPerSec + 180) }}
                >
                  <div className="mb-2 grid grid-cols-[88px_1fr] items-end gap-2 sm:grid-cols-[112px_1fr] sm:gap-3">
                    <div className="text-xs text-muted-foreground">轨道</div>
                    <div className="relative h-6 border-b border-dashed">
                      {Array.from({ length: Math.max(2, Math.ceil(timelineTotalSec / 5) + 1) }).map((_, index) => {
                        const second = index * 5;
                        return (
                          <div
                            key={second}
                            className="absolute bottom-0 top-1 w-px bg-border"
                            style={{ left: second * timeline.scalePxPerSec }}
                          >
                            <span className="absolute -top-1 left-1 whitespace-nowrap text-[10px] text-muted-foreground">
                              {formatTimelineTime(second)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {timeline.tracks.map((track) => {
                      const trackItems = timeline.items.filter((item) => item.trackId === track.id);
                      return (
                        <div key={track.id} className="grid grid-cols-[88px_1fr] gap-2 sm:grid-cols-[112px_1fr] sm:gap-3">
                          <div className="flex h-12 items-center gap-2 rounded-md border bg-muted/30 px-2 text-xs">
                            {track.type === 'video' ? <Film className="h-3.5 w-3.5" /> : track.type === 'subtitle' ? <Subtitles className="h-3.5 w-3.5" /> : <AudioLines className="h-3.5 w-3.5" />}
                            <span className="truncate">{track.name}</span>
                          </div>
                          <div
                            className="relative h-12 rounded-md border bg-muted/20"
                            onClick={(event) => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              const nextPlayhead = clampNumber(
                                (event.clientX - rect.left) / timeline.scalePxPerSec,
                                0,
                                Math.max(timelineTotalSec, 0),
                              );
                              handlePlayheadChange(Number(nextPlayhead.toFixed(2)));
                            }}
                          >
                            <div
                              className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-red-500"
                              style={{ left: playheadSec * timeline.scalePxPerSec }}
                            />
                            {trackItems.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                draggable={item.type === 'clip'}
                                className={cn(
                                  'absolute top-1 flex h-10 min-w-12 items-center gap-1 overflow-hidden rounded-md border px-2 text-left text-xs shadow-sm transition hover:brightness-105',
                                  getItemTone(item),
                                  selectedItem?.id === item.id && 'ring-2 ring-amber-400',
                                  draggingClipId === item.clipId && 'opacity-60',
                                )}
                                style={{
                                  left: item.startSec * timeline.scalePxPerSec,
                                  width: Math.max(48, item.durationSec * timeline.scalePxPerSec),
                                }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  selectTimelineItem(item);
                                }}
                                onDragStart={(event) => {
                                  if (item.type !== 'clip' || !item.clipId) return;
                                  setDraggingClipId(item.clipId);
                                  event.dataTransfer.setData('text/plain', item.clipId);
                                  event.dataTransfer.effectAllowed = 'move';
                                }}
                                onDragOver={(event) => {
                                  if (item.type === 'clip') event.preventDefault();
                                }}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  const sourceClipId = event.dataTransfer.getData('text/plain') || draggingClipId;
                                  if (sourceClipId && item.clipId) reorderClipBefore(sourceClipId, item.clipId);
                                  setDraggingClipId(null);
                                }}
                                onDragEnd={() => setDraggingClipId(null)}
                                title={`${item.label} · ${formatTimelineTime(item.startSec)} - ${formatTimelineTime(item.startSec + item.durationSec)}`}
                              >
                                {getItemIcon(item)}
                                <span className="truncate">{item.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                点击轨道可定位播放头，拖拽视频块可排序；当前已支持切分、复制、移出、裁剪入点/时长、字幕块拆分合并、音量、原声、BGM 和音效。
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2 xl:col-span-1">
          <Card className="surface-panel border-white/70">
            <CardHeader className="pb-3">
              <div className="space-y-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <SlidersHorizontal className="h-4 w-4" />
                  工作台面板
                </CardTitle>
                <div className="grid grid-cols-4 gap-1 rounded-lg border bg-background/60 p-1">
                  {[
                    { key: 'edit' as const, label: '剪辑', icon: Scissors },
                    { key: 'caption' as const, label: '字幕', icon: Subtitles },
                    { key: 'audio' as const, label: '音频', icon: Music },
                    { key: 'export' as const, label: '导出', icon: FileArchive },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <Button
                        key={item.key}
                        size="sm"
                        variant={inspectorMode === item.key ? 'default' : 'ghost'}
                        className="h-8 px-1 text-xs"
                        onClick={() => setInspectorMode(item.key)}
                      >
                        <Icon className="mr-1 h-3.5 w-3.5" />
                        {item.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedItem ? (
                <div className="rounded-lg border bg-background/60 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate font-medium">{selectedItem.label}</p>
                    <Badge variant="outline">{selectedItem.type}</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <span>开始 {formatTimelineTime(selectedItem.startSec)}</span>
                    <span>时长 {selectedItem.durationSec.toFixed(1)}s</span>
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border bg-background/60 p-3 text-sm text-muted-foreground">选择时间线上的一个片段开始调整。</p>
              )}

              {inspectorMode === 'caption' && selectedClip && selectedClipSubtitleCues.length > 0 && (
                <div className="space-y-2 rounded-lg border bg-background/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm">
                      <Subtitles className="h-4 w-4" />
                      本片字幕块
                    </span>
                    <Badge variant="outline">{selectedClipSubtitleCues.length}</Badge>
                  </div>
                  <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                    {selectedClipSubtitleCues.map((cue, index) => (
                      <button
                        key={cue.id}
                        type="button"
                        className={cn(
                          'grid w-full grid-cols-[68px_1fr] gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition hover:bg-muted/70',
                          selectedSubtitleCue?.id === cue.id && 'border-amber-400 bg-amber-500/10',
                        )}
                        onClick={() => selectSubtitleCue(cue)}
                      >
                        <span className="text-muted-foreground">
                          {String(index + 1).padStart(2, '0')} · {cue.startSec.toFixed(1)}s
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate">{cue.text || '空字幕'}</span>
                          <span className="block truncate text-[10px] text-muted-foreground">{cue.source || '手动/旧方案'}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {inspectorMode === 'caption' && selectedSubtitleCue && selectedClip && (
                <div className="space-y-3 rounded-lg border bg-background/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm">
                      <Subtitles className="h-4 w-4" />
                      字幕块
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {selectedSubtitleCue.startSec.toFixed(1)}s - {selectedSubtitleCue.endSec.toFixed(1)}s
                    </span>
                  </div>
                  <Badge className="w-fit" variant="outline">{selectedSubtitleCue.source || '手动/旧方案'}</Badge>
                  <Textarea
                    value={selectedSubtitleCue.text}
                    onChange={(event) => updateSubtitleCue(selectedSubtitleCue.id, { text: event.target.value })}
                    className="min-h-[78px] bg-background"
                  />
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <label className="space-y-2">
                      <span className="text-muted-foreground">开始 {selectedSubtitleCue.startSec.toFixed(1)}s</span>
                      <Slider
                        value={[selectedSubtitleCue.startSec]}
                        min={0}
                        max={Math.max(0.1, selectedClip.durationSec - 0.1)}
                        step={0.1}
                        onValueChange={([startSec]) => updateSubtitleCue(selectedSubtitleCue.id, { startSec })}
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-muted-foreground">结束 {selectedSubtitleCue.endSec.toFixed(1)}s</span>
                      <Slider
                        value={[selectedSubtitleCue.endSec]}
                        min={0.1}
                        max={Math.max(0.1, selectedClip.durationSec)}
                        step={0.1}
                        onValueChange={([endSec]) => updateSubtitleCue(selectedSubtitleCue.id, { endSec })}
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" onClick={() => selectSubtitleByOffset(-1)} disabled={selectedSubtitleIndex <= 0}>
                      <SkipBack className="mr-1 h-4 w-4" />
                      上一块
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => selectSubtitleByOffset(1)} disabled={selectedSubtitleIndex < 0 || selectedSubtitleIndex >= selectedClipSubtitleCues.length - 1}>
                      <SkipForward className="mr-1 h-4 w-4" />
                      下一块
                    </Button>
                    <Button size="sm" variant="outline" onClick={splitSelectedSubtitleCue}>
                      <Scissors className="mr-1 h-4 w-4" />
                      拆分
                    </Button>
                    <Button size="sm" variant="outline" onClick={mergeSelectedSubtitleCueWithNext} disabled={selectedSubtitleIndex < 0 || selectedSubtitleIndex >= selectedClipSubtitleCues.length - 1}>
                      <Layers3 className="mr-1 h-4 w-4" />
                      合并下一块
                    </Button>
                  </div>
                </div>
              )}

              {inspectorMode === 'edit' && selectedClip && (
                <>
                  <div className="space-y-2 rounded-lg border bg-background/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm">启用片段</span>
                      <Switch checked={selectedClip.enabled} onCheckedChange={(enabled) => updateClip(selectedClip.id, { enabled })} />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm">保留视频原声</span>
                      <Switch checked={selectedClip.keepOriginalAudio} onCheckedChange={(keepOriginalAudio) => updateClip(selectedClip.id, { keepOriginalAudio })} />
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border bg-background/60 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2"><Scissors className="h-4 w-4" />裁剪入点</span>
                      <span>{(selectedClip.sourceStartSec ?? 0).toFixed(1)}s</span>
                    </div>
                    <Slider
                      value={[selectedClip.sourceStartSec ?? 0]}
                      min={0}
                      max={120}
                      step={0.5}
                      onValueChange={([sourceStartSec]) => updateClipTrim(selectedClip, sourceStartSec, selectedClip.durationSec)}
                    />
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2"><Clock3 className="h-4 w-4" />输出时长</span>
                      <span>{selectedClip.durationSec.toFixed(1)}s</span>
                    </div>
                    <Slider
                      value={[selectedClip.durationSec]}
                      min={0.5}
                      max={60}
                      step={0.5}
                      onValueChange={([durationSec]) => updateClipTrim(selectedClip, selectedClip.sourceStartSec ?? 0, durationSec)}
                    />
                  </div>

                  <div className="space-y-3 rounded-lg border bg-background/60 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2"><Volume2 className="h-4 w-4" />片段音量</span>
                      <span>{Math.round(selectedClip.volume * 100)}%</span>
                    </div>
                    <Slider
                      value={[selectedClip.volume]}
                      min={0}
                      max={2}
                      step={0.05}
                      onValueChange={([volume]) => updateClip(selectedClip.id, { volume })}
                    />
                  </div>

                  <div className="space-y-2 rounded-lg border bg-background/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm">片段顺序</span>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => moveClip(selectedClip.id, -1)}>上移</Button>
                        <Button size="sm" variant="outline" onClick={() => moveClip(selectedClip.id, 1)}>下移</Button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button className="flex-1" size="sm" variant="outline" onClick={() => void previewClipAudio(selectedClip)}>
                        {previewing === selectedClip.id ? <Square className="mr-1 h-4 w-4" /> : <Play className="mr-1 h-4 w-4" />}
                        试听音频
                      </Button>
                      <Button className="flex-1" size="sm" variant="outline" onClick={() => void handleGenerateOneSfx(selectedClip)}>
                        <Wand2 className="mr-1 h-4 w-4" />
                        补音效
                      </Button>
                    </div>
                  </div>

                </>
              )}

              {inspectorMode === 'caption' && selectedClip && (
                <div className="space-y-2 rounded-lg border bg-background/60 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Subtitles className="h-4 w-4" />
                    字幕文本
                  </div>
                  <Textarea
                    value={selectedClip.subtitleText}
                    onChange={(event) => updateClipSubtitleText(selectedClip, event.target.value)}
                    className="min-h-[120px] bg-background"
                  />
                </div>
              )}

              {inspectorMode === 'audio' && (
                <p className="rounded-lg border bg-background/60 p-3 text-sm text-muted-foreground">
                  在这里统一处理 BGM、音效生成和 CC0 音频导入。
                </p>
              )}

              {inspectorMode === 'export' && (
                <p className="rounded-lg border bg-background/60 p-3 text-sm text-muted-foreground">
                  预检和合成任务集中在导出面板。
                </p>
              )}
            </CardContent>
          </Card>

          {inspectorMode === 'export' && <Card className="surface-panel border-white/70">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  {preflight.ok ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                  预检
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setPreflightOpen((value) => !value)}>
                  {preflightOpen ? '收起' : '展开'}
                </Button>
              </div>
            </CardHeader>
            {preflightOpen && (
              <CardContent className="space-y-2 text-sm">
                {preflight.errors.length === 0 && preflight.warnings.length === 0 && (
                  <p className="text-green-700">已通过，可以合成。未启用片段会留在方案里但不会进入本次输出。</p>
                )}
                {preflight.errors.map((issue) => (
                  <p key={issue.message} className="rounded-md bg-red-500/10 px-3 py-2 text-red-700">{issue.message}</p>
                ))}
                {preflight.warnings.map((issue) => (
                  <p key={issue.message} className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-700">{issue.message}</p>
                ))}
              </CardContent>
            )}
          </Card>}

          {inspectorMode === 'audio' && <Card className="surface-panel border-white/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Music className="h-4 w-4" />
                BGM
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {chapter.bgm ? (
                <div className="rounded-lg border bg-background/60 p-3">
                  <p className="font-medium">{chapter.bgm.name}</p>
                  <p className="text-xs text-muted-foreground">{chapter.bgm.blobKey ? '真实音频已就绪' : '只有风格，还没有音频'}</p>
                  <div className="mt-3 flex items-center gap-3">
                    <Volume2 className="h-4 w-4 text-muted-foreground" />
                    <Slider value={[chapter.bgm.volume]} min={0} max={1} step={0.05} onValueChange={([value]) => updateBgmVolume(value)} />
                    <span className="w-10 text-right text-xs">{Math.round(chapter.bgm.volume * 100)}%</span>
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border bg-background/60 p-3 text-sm text-muted-foreground">还没有 BGM。</p>
              )}
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed bg-background/60 p-3 text-sm text-muted-foreground hover:text-foreground">
                <Upload className="h-4 w-4" />
                上传 BGM
                <input type="file" accept="audio/*" className="hidden" onChange={(event) => void handleBgmUpload(event)} />
              </label>
              {!bgmGenerating && !hasBgm && !bgmPreview && (
                <Button className="w-full" variant="outline" onClick={() => void analyzeBgmOnly()} disabled={!chapter.analysis}>
                  <Wand2 className="mr-1 h-4 w-4" />AI 分析 BGM
                </Button>
              )}
              {bgmPreview && (
                <div className="rounded-lg border bg-background/70 p-3 text-xs">
                  <p className="font-medium">{bgmPreview.title}</p>
                  <p className="text-muted-foreground">{bgmPreview.style} / {bgmPreview.mood}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => void confirmBgmGeneration()}>生成</Button>
                    <Button size="sm" variant="ghost" onClick={cancelBgmPreview}>取消</Button>
                  </div>
                </div>
              )}
              {hasBgm && !bgmGenerating && (
                <Button className="w-full" variant="outline" onClick={() => void startBgmGeneration()}>重新生成 BGM</Button>
              )}
              {bgmGenerating && (
                <div className="space-y-2">
                  <Progress value={bgmProgress.progress} className="h-2" />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{bgmProgress.message}</span>
                    <Button size="sm" variant="ghost" onClick={cancelBgmGeneration}>取消</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>}

          {inspectorMode === 'audio' && <Card className="surface-panel border-white/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">音效生成</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input type="password" placeholder="ElevenLabs SFX API Key" value={elevenLabsSfxKey} onChange={(event) => setElevenLabsSfxKey(event.target.value)} />
              <Button className="w-full" onClick={() => void handleGenerateSfx()} disabled={sfxGenerating}>
                {sfxGenerating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1 h-4 w-4" />}
                生成缺失音效
              </Button>
              {sfxGenerating && (
                <div className="space-y-1">
                  <Progress value={sfxProgress.total ? (sfxProgress.done / sfxProgress.total) * 100 : 0} className="h-2" />
                  <p className="text-xs text-muted-foreground">{sfxProgress.done}/{sfxProgress.total}</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">优先使用 ElevenLabs 真实音效；没有 Key 时可用语音接口生成占位音效，最终成片建议替换为真实音效。</p>
            </CardContent>
          </Card>}

          {inspectorMode === 'audio' && <Card className="surface-panel border-white/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">CC0 素材导入</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant={cc0Import.type === 'sfx' ? 'default' : 'outline'}
                  onClick={() => setCc0Import((prev) => ({ ...prev, type: 'sfx' }))}
                >
                  音效
                </Button>
                <Button
                  size="sm"
                  variant={cc0Import.type === 'bgm' ? 'default' : 'outline'}
                  onClick={() => setCc0Import((prev) => ({ ...prev, type: 'bgm' }))}
                >
                  BGM
                </Button>
              </div>
              <Input
                placeholder="来源名称，例如 Pixabay"
                value={cc0Import.sourceName}
                onChange={(event) => setCc0Import((prev) => ({ ...prev, sourceName: event.target.value }))}
              />
              <Input
                placeholder="来源链接，可选"
                value={cc0Import.sourceUrl}
                onChange={(event) => setCc0Import((prev) => ({ ...prev, sourceUrl: event.target.value }))}
              />
              <Input
                placeholder="作者，可选"
                value={cc0Import.author}
                onChange={(event) => setCc0Import((prev) => ({ ...prev, author: event.target.value }))}
              />
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed bg-background/60 p-3 text-sm text-muted-foreground hover:text-foreground">
                <Upload className="h-4 w-4" />
                导入音频并保存 license.json 信息
                <input type="file" accept="audio/*" className="hidden" onChange={(event) => void handleCc0Import(event)} />
              </label>
              {(postProduction.cc0Assets?.length ?? 0) > 0 && (
                <div className="space-y-2 rounded-lg border bg-background/60 p-2 text-xs">
                  {postProduction.cc0Assets?.map((asset) => (
                    <div key={asset.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{asset.name} · {asset.license} · {asset.sourceName}</span>
                      {asset.type === 'bgm' && (
                        <Button size="sm" variant="ghost" onClick={() => handleCc0AsBgm(asset.id)}>设为 BGM</Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">只允许导入 CC0 / Public Domain 素材；许可证元数据会随项目状态保存。</p>
            </CardContent>
          </Card>}
        </div>
      </div>
    </div>
  );
}
