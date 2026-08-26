import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Check, ChevronDown, FileAudio, Loader2, Play, RefreshCw, Trash2, Upload, Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useCurrentProject } from '@/stores/projectStore';
import { deleteBlob, loadBlob, saveBlob } from '@/lib/imageStore';
import {
  getCharacterVoiceReferences,
  isCharacterVoiceReferenceEnabled,
} from '@/lib/characterVoiceReferences';
import { formatBytes } from '@/lib/lightweightImageCompression';
import { validateVoiceCloneSample } from '@/lib/mimoTtsClient';
import {
  fetchVoiceCorpusSamples,
  getVoiceCorpusStats,
  loadVoiceCorpusSampleBlob,
  recommendVoiceCorpusSamples,
  resolveVoiceMatchTarget,
  type VoiceAgeBand,
  type VoiceCorpusRecommendation,
  type VoiceCorpusSample,
  type VoiceGender,
  type VoiceMatchTarget,
} from '@/lib/voiceCorpusClient';
import type { CharacterProfile, CharacterVoiceReference, CharacterVoiceReferenceLanguage } from '@/types';

interface CharacterVoiceReferencePanelProps {
  characters: string[];
  characterProfiles?: CharacterProfile[];
  projectSummary?: string;
  projectStyle?: string;
  compact?: boolean;
}

function createReferenceId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function inferLanguageFromFileName(fileName: string): CharacterVoiceReferenceLanguage {
  const normalized = fileName.toUpperCase();
  if (/_CN[_\-.]/.test(normalized)) return 'CN';
  if (/_EN[_\-.]/.test(normalized)) return 'EN';
  if (/_JP[_\-.]/.test(normalized)) return 'JP';
  if (/_KR[_\-.]/.test(normalized)) return 'KR';
  return 'custom';
}

function normalizeCorpusLanguage(language?: string): CharacterVoiceReferenceLanguage {
  return language === 'CN' || language === 'EN' || language === 'JP' || language === 'KR' ? language : 'custom';
}

function inferSourceCharacterFromFileName(fileName: string) {
  const stem = fileName.replace(/\.[^.]+$/, '');
  const withoutIndex = stem.replace(/^\d+_/, '');
  const match = withoutIndex.match(/^(.+?)_(CN|EN|JP|KR)(?:_|$)/i);
  return (match?.[1] ?? withoutIndex).replace(/_/g, ' ').trim();
}

function getAudioMimeType(fileName: string, fallback?: string) {
  if (fallback) return fallback;
  if (/\.mp3$/i.test(fileName)) return 'audio/mpeg';
  if (/\.wav$/i.test(fileName)) return 'audio/wav';
  if (/\.m4a$/i.test(fileName)) return 'audio/mp4';
  return 'audio/wav';
}

async function readAudioDurationSec(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    return await new Promise<number | undefined>((resolve) => {
      audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : undefined);
      audio.onerror = () => resolve(undefined);
      audio.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function summarizeReference(reference?: CharacterVoiceReference) {
  if (!reference) return '未绑定';
  const parts = [
    reference.sourceCharacter,
    reference.language,
    reference.voiceTags,
    reference.audioBytes ? formatBytes(reference.audioBytes) : undefined,
    reference.audioBlobKey ? '本地音频已备好' : undefined,
    reference.publicAudioUrl ? '有公网音频 URL' : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
}

function findProfile(profiles: CharacterProfile[] | undefined, name: string) {
  return profiles?.find((profile) => profile.name === name);
}

function getReasonText(recommendation: VoiceCorpusRecommendation) {
  return recommendation.reasons.slice(0, 2).join(' · ');
}

const AGE_BAND_LABELS: Record<VoiceAgeBand, string> = {
  child: '儿童',
  teen: '少年/少女',
  young: '青年',
  mature: '成熟',
  elder: '长辈',
  nonhuman: '非人/AI',
};

function getGenderLabel(gender?: VoiceGender) {
  if (gender === 'male') return '男声';
  if (gender === 'female') return '女声';
  return '性别未判定';
}

function getMatchTargetText(target: VoiceMatchTarget) {
  const ageText = target.ageBands.map((band) => AGE_BAND_LABELS[band]).join('、');
  return [getGenderLabel(target.gender), ageText || undefined].filter(Boolean).join(' · ');
}

function getCorpusSampleMeta(sample: VoiceCorpusSample) {
  return [
    sample.gender ? `${sample.gender}声` : '性别未标',
    sample.ageAppearance || '年龄未标',
    sample.voiceTags || '内置声线样本',
  ].join(' · ');
}

function getVoiceSampleKey(sample: VoiceCorpusSample) {
  return (sample.sourceCharacter || sample.id).trim().toLowerCase();
}

function getVoiceReferenceKey(reference?: CharacterVoiceReference) {
  return (reference?.sourceCharacter || reference?.sourcePath || '').trim().toLowerCase();
}

export function CharacterVoiceReferencePanel({
  characters,
  characterProfiles,
  projectSummary,
  projectStyle,
  compact = false,
}: CharacterVoiceReferencePanelProps) {
  const { state, dispatch, currentProject } = useCurrentProject();
  const enabled = isCharacterVoiceReferenceEnabled(state.videoApiConfig);
  const [detailsExpanded, setDetailsExpanded] = useState(enabled);
  const [busyCharacter, setBusyCharacter] = useState<string | null>(null);
  const [voiceSamples, setVoiceSamples] = useState<VoiceCorpusSample[]>([]);
  const [voiceCorpusLoading, setVoiceCorpusLoading] = useState(false);
  const [voiceCorpusError, setVoiceCorpusError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const uniqueCharacters = useMemo(() => Array.from(new Set(characters.map((name) => name.trim()).filter(Boolean))), [characters]);
  const voiceCorpusStats = useMemo(() => getVoiceCorpusStats(voiceSamples), [voiceSamples]);
  const recommendationsByCharacter = useMemo(() => {
    const reservedKeys = new Map<string, string>();
    for (const characterName of uniqueCharacters) {
      const reference = getCharacterVoiceReferences(currentProject, characterName)[0];
      const key = getVoiceReferenceKey(reference);
      if (key) reservedKeys.set(key, characterName);
    }

    const usedKeys = new Map(reservedKeys);
    const result = new Map<string, VoiceCorpusRecommendation[]>();

    for (const characterName of uniqueCharacters) {
      const reference = getCharacterVoiceReferences(currentProject, characterName)[0];
      const currentKey = getVoiceReferenceKey(reference);
      const rawRecommendations = recommendVoiceCorpusSamples(
        voiceSamples,
        {
          characterName,
          profile: findProfile(characterProfiles, characterName),
          projectSummary,
          projectStyle,
        },
        voiceSamples.length || 5,
      );
      const recommendations = rawRecommendations
        .filter((recommendation) => {
          const key = getVoiceSampleKey(recommendation.sample);
          const owner = usedKeys.get(key);
          return !owner || owner === characterName || key === currentKey;
        })
        .slice(0, 5);

      recommendations.forEach((recommendation) => {
        usedKeys.set(getVoiceSampleKey(recommendation.sample), characterName);
      });
      if (currentKey) usedKeys.set(currentKey, characterName);
      result.set(characterName, recommendations);
    }

    return result;
  }, [characterProfiles, currentProject, projectStyle, projectSummary, uniqueCharacters, voiceSamples]);

  useEffect(() => {
    setDetailsExpanded(enabled);
  }, [enabled]);

  useEffect(() => {
    if (compact || !enabled) return;
    const controller = new AbortController();
    setVoiceCorpusLoading(true);
    setVoiceCorpusError(null);
    fetchVoiceCorpusSamples(controller.signal)
      .then(setVoiceSamples)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setVoiceCorpusError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setVoiceCorpusLoading(false);
    });
    return () => controller.abort();
  }, [compact, enabled]);

  const updateEnabled = (checked: boolean) => {
    dispatch({
      type: 'SET_VIDEO_API_CONFIG',
      config: { ...state.videoApiConfig, characterVoiceReferencesEnabled: checked },
    });
  };

  const upsertReference = (reference: CharacterVoiceReference) => {
    dispatch({ type: 'UPSERT_CHARACTER_VOICE_REFERENCE', reference });
  };

  const playBlob = async (blob: Blob, errorMessage: string) => {
    if (!blob) {
      toast.error(errorMessage);
      return;
    }
    audioRef.current?.pause();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audioRef.current = audio;
    await audio.play();
  };

  const playReference = async (reference: CharacterVoiceReference) => {
    if (!reference.audioBlobKey) return;
    const blob = await loadBlob(reference.audioBlobKey);
    if (!blob) {
      toast.error('声线参考音频读取失败');
      return;
    }
    await playBlob(blob, '声线参考音频读取失败');
  };

  const playCorpusSample = async (sample: VoiceCorpusSample) => {
    audioRef.current?.pause();
    const audio = new Audio(sample.audioUrl);
    audioRef.current = audio;
    await audio.play();
  };

  const updatePublicUrl = (characterName: string, value: string) => {
    const existing = getCharacterVoiceReferences(currentProject, characterName)[0];
    const now = Date.now();
    if (existing?.blackVideoBlobKey) void deleteBlob(existing.blackVideoBlobKey);
    upsertReference({
      id: existing?.id ?? createReferenceId(),
      characterName,
      displayName: existing?.displayName ?? `${characterName} 声线参考`,
      language: existing?.language ?? 'custom',
      sourceWork: existing?.sourceWork,
      sourceCharacter: existing?.sourceCharacter,
      voiceActor: existing?.voiceActor,
      voiceTags: existing?.voiceTags,
      sampleText: existing?.sampleText,
      sourcePath: existing?.sourcePath,
      audioBlobKey: existing?.audioBlobKey,
      audioFileName: existing?.audioFileName,
      audioMimeType: existing?.audioMimeType,
      audioBytes: existing?.audioBytes,
      audioDurationSec: existing?.audioDurationSec,
      blackVideoBlobKey: undefined,
      blackVideoFileName: undefined,
      blackVideoMimeType: undefined,
      blackVideoBytes: undefined,
      blackVideoDurationSec: undefined,
      publicAudioUrl: value.trim(),
      locked: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  };

  const bindAudioBlob = async (
    characterName: string,
    audioBlob: Blob,
    options: {
      displayName: string;
      language: CharacterVoiceReferenceLanguage;
      fileName: string;
      mimeType?: string;
      sourceWork?: string;
      sourceCharacter?: string;
      voiceActor?: string;
      voiceTags?: string;
      sampleText?: string;
      sourcePath?: string;
      publicAudioUrl?: string;
      successLabel?: string;
    },
  ) => {
    setBusyCharacter(characterName);
    try {
      const now = Date.now();
      const audioDurationSec = await readAudioDurationSec(audioBlob);
      const audioBlobKey = await saveBlob(audioBlob);
      const existing = getCharacterVoiceReferences(currentProject, characterName)[0];
      const reference: CharacterVoiceReference = {
        id: existing?.id ?? createReferenceId(),
        characterName,
        displayName: options.displayName,
        language: options.language,
        sourceWork: options.sourceWork,
        sourceCharacter: options.sourceCharacter,
        voiceActor: options.voiceActor,
        voiceTags: options.voiceTags,
        sampleText: options.sampleText,
        sourcePath: options.sourcePath,
        audioBlobKey,
        audioFileName: options.fileName,
        audioMimeType: getAudioMimeType(options.fileName, options.mimeType),
        audioBytes: audioBlob.size,
        audioDurationSec,
        publicAudioUrl: options.publicAudioUrl ?? existing?.publicAudioUrl,
        blackVideoBlobKey: undefined,
        blackVideoFileName: undefined,
        blackVideoMimeType: undefined,
        blackVideoBytes: undefined,
        blackVideoDurationSec: undefined,
        locked: true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      if (existing?.audioBlobKey && existing.audioBlobKey !== audioBlobKey) void deleteBlob(existing.audioBlobKey);
      if (existing?.blackVideoBlobKey) void deleteBlob(existing.blackVideoBlobKey);
      upsertReference(reference);
      toast.success(options.successLabel ?? `${characterName} 声线参考音频已绑定`);
    } finally {
      setBusyCharacter(null);
    }
  };

  const bindCorpusSample = async (characterName: string, sample: VoiceCorpusSample) => {
    const blob = await loadVoiceCorpusSampleBlob(sample);
    await bindAudioBlob(characterName, blob, {
      displayName: `${characterName} · ${sample.sourceCharacter ?? sample.displayName}`,
      language: normalizeCorpusLanguage(sample.language),
      fileName: sample.fileName,
      mimeType: blob.type,
      sourceWork: sample.sourceWork,
      sourceCharacter: sample.sourceCharacter,
      voiceActor: sample.voiceActor,
      voiceTags: sample.voiceTags,
      sampleText: sample.sampleText,
      sourcePath: sample.id,
      publicAudioUrl: sample.remoteAudioUrl,
      successLabel: `${characterName} 已绑定内置声线：${sample.sourceCharacter ?? sample.displayName}`,
    });
  };

  const uploadSample = async (characterName: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const validation = validateVoiceCloneSample(file);
    if (!validation.ok || !validation.mimeType) {
      toast.error(validation.error ?? '声样文件不可用');
      return;
    }

    await bindAudioBlob(characterName, file, {
      displayName: `${characterName} 声线参考`,
      language: inferLanguageFromFileName(file.name),
      fileName: file.name,
      mimeType: validation.mimeType,
      sourceCharacter: inferSourceCharacterFromFileName(file.name),
      voiceTags: '',
      sampleText: '',
    });
  };

  const deleteReference = async (reference: CharacterVoiceReference) => {
    if (reference.audioBlobKey) await deleteBlob(reference.audioBlobKey).catch(() => undefined);
    if (reference.blackVideoBlobKey) await deleteBlob(reference.blackVideoBlobKey).catch(() => undefined);
    dispatch({ type: 'DELETE_CHARACTER_VOICE_REFERENCE', referenceId: reference.id });
  };

  const readyCount = uniqueCharacters.filter((name) => {
    const reference = getCharacterVoiceReferences(currentProject, name)[0];
    return !!reference?.audioBlobKey || !!reference?.publicAudioUrl;
  }).length;

  const getMatchTarget = (characterName: string) => resolveVoiceMatchTarget({
    characterName,
    profile: findProfile(characterProfiles, characterName),
    projectSummary,
    projectStyle,
  });
  const showDetails = !compact && enabled && detailsExpanded;

  return (
    <section className={compact ? 'rounded-xl border border-cyan-200/70 bg-cyan-50/70 p-3 dark:border-cyan-400/25 dark:bg-cyan-500/10' : 'rounded-2xl border border-cyan-200/70 bg-cyan-50/70 p-4 shadow-sm dark:border-cyan-400/25 dark:bg-cyan-500/10'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-cyan-700 dark:text-cyan-200" />
            <h3 className="text-sm font-semibold text-cyan-950 dark:text-cyan-50">角色配音参考</h3>
            <Badge variant="outline" className="border-cyan-200 bg-white/70 text-cyan-800 dark:border-cyan-300/30 dark:bg-cyan-300/10 dark:text-cyan-100">
              {readyCount}/{uniqueCharacters.length}
            </Badge>
          </div>
          <p className="max-w-3xl text-xs leading-5 text-cyan-800/80 dark:text-cyan-100/80">
            内置声线库会按角色画像推荐候选；试听后点选绑定。开启后 Step4 会按当前视频模型允许的数量写入说话角色声线要求，Step5 再按同一顺序提交音频参考。
          </p>
          {showDetails && voiceCorpusStats.total > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1 text-[10px] text-cyan-900 dark:text-cyan-100">
              <span className="rounded-full border border-cyan-200 bg-white/75 px-2 py-0.5 dark:border-cyan-300/20 dark:bg-slate-950/25">声线库 {voiceCorpusStats.total} 条</span>
              <span className="rounded-full border border-cyan-200 bg-white/75 px-2 py-0.5 dark:border-cyan-300/20 dark:bg-slate-950/25">男 {voiceCorpusStats.male}</span>
              <span className="rounded-full border border-cyan-200 bg-white/75 px-2 py-0.5 dark:border-cyan-300/20 dark:bg-slate-950/25">女 {voiceCorpusStats.female}</span>
              <span className="rounded-full border border-cyan-200 bg-white/75 px-2 py-0.5 dark:border-cyan-300/20 dark:bg-slate-950/25">儿童 {voiceCorpusStats.ageBands.child}</span>
              <span className="rounded-full border border-cyan-200 bg-white/75 px-2 py-0.5 dark:border-cyan-300/20 dark:bg-slate-950/25">少年/少女 {voiceCorpusStats.ageBands.teen}</span>
              <span className="rounded-full border border-cyan-200 bg-white/75 px-2 py-0.5 dark:border-cyan-300/20 dark:bg-slate-950/25">青年 {voiceCorpusStats.ageBands.young}</span>
              <span className="rounded-full border border-cyan-200 bg-white/75 px-2 py-0.5 dark:border-cyan-300/20 dark:bg-slate-950/25">成熟 {voiceCorpusStats.ageBands.mature}</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!compact && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!enabled}
              aria-expanded={showDetails}
              onClick={() => setDetailsExpanded((value) => !value)}
              className="h-8 gap-1 rounded-full px-2 text-xs text-cyan-900 hover:bg-white/70 dark:text-cyan-100 dark:hover:bg-slate-950/25"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showDetails ? '' : '-rotate-90'}`} />
              {showDetails ? '收起' : '展开'}
            </Button>
          )}
          <div className="flex items-center gap-2 rounded-full border border-cyan-200 bg-white/75 px-3 py-1.5 dark:border-cyan-300/20 dark:bg-slate-950/30">
            <span className="text-xs text-cyan-900 dark:text-cyan-100">{enabled ? '已开启' : '已关闭'}</span>
            <Switch checked={enabled} onCheckedChange={updateEnabled} />
          </div>
        </div>
      </div>

      {showDetails && uniqueCharacters.length > 0 && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {uniqueCharacters.map((characterName) => {
            const reference = getCharacterVoiceReferences(currentProject, characterName)[0];
            const busy = busyCharacter === characterName;
            const recommendations = recommendationsByCharacter.get(characterName) ?? [];
            const matchTarget = getMatchTarget(characterName);
            return (
              <div key={characterName} className="rounded-xl border border-white/70 bg-white/80 p-3 dark:border-slate-700/60 dark:bg-slate-950/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{characterName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{summarizeReference(reference)}</p>
                    <p className={`mt-1 text-[10px] leading-4 ${matchTarget.confidence === 'low' ? 'text-amber-700 dark:text-amber-200' : 'text-cyan-800/80 dark:text-cyan-100/80'}`}>
                      匹配依据：{getMatchTargetText(matchTarget)}；{matchTarget.reasons.join(' · ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="试听已绑定声线"
                      disabled={!reference?.audioBlobKey || busy}
                      onClick={() => reference && void playReference(reference)}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                    {reference && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        title="清除声线参考"
                        disabled={busy}
                        onClick={() => void deleteReference(reference)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-cyan-950 dark:text-cyan-50">AI 推荐声线</p>
                    {voiceCorpusLoading && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        读取声线库
                      </span>
                    )}
                    {!voiceCorpusLoading && voiceSamples.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <RefreshCw className="h-3 w-3" />
                        {voiceSamples.length} 条内置声线
                      </span>
                    )}
                  </div>

                  {voiceCorpusError && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
                      {voiceCorpusError}
                    </div>
                  )}

                  {recommendations.map((recommendation) => {
                    const sample = recommendation.sample;
                    const selected = reference?.sourcePath === sample.id;
                    return (
                      <div
                        key={sample.id}
                        className={`rounded-lg border px-2.5 py-2 text-xs transition-colors ${
                          selected
                            ? 'border-cyan-300 bg-cyan-100/80 dark:border-cyan-300/40 dark:bg-cyan-300/15'
                            : 'border-white/80 bg-white/70 dark:border-slate-700/60 dark:bg-slate-950/25'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-foreground">
                              {sample.sourceCharacter ?? sample.displayName}
                              <span className="ml-1 text-[10px] font-normal text-muted-foreground">{sample.language}</span>
                            </p>
                            <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                              {getCorpusSampleMeta(sample)} · {getReasonText(recommendation)}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="试听候选"
                              onClick={() => void playCorpusSample(sample)}
                            >
                              <Play className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={selected ? 'secondary' : 'outline'}
                              className="h-7 gap-1 px-2 text-[10px]"
                              disabled={busy}
                              onClick={() => void bindCorpusSample(characterName, sample)}
                            >
                              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : selected ? <Check className="h-3 w-3" /> : null}
                              {selected ? '已选' : '选择'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <details className="mt-3 rounded-lg border border-dashed border-cyan-200/80 bg-white/55 px-3 py-2 dark:border-cyan-300/20 dark:bg-slate-950/20">
                  <summary className="cursor-pointer text-xs font-medium text-cyan-900 dark:text-cyan-100">
                    备用：手动上传或填写公网 URL
                  </summary>
                  <div className="mt-2 grid gap-2">
                    <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-lg border border-cyan-200 bg-cyan-600 px-3 text-xs font-medium text-white shadow-sm hover:bg-cyan-700 dark:border-cyan-300/20">
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      上传声样音频
                      <input
                        type="file"
                        accept="audio/mpeg,audio/mp3,audio/wav,.mp3,.wav"
                        className="hidden"
                        disabled={busy}
                        onChange={(event) => void uploadSample(characterName, event)}
                      />
                    </label>
                    <Input
                      value={reference?.publicAudioUrl ?? ''}
                      onChange={(event) => updatePublicUrl(characterName, event.target.value)}
                      placeholder="公网 reference_audio URL，可选"
                      className="h-8 bg-white/80 text-xs dark:bg-slate-950/30"
                    />
                    <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><FileAudio className="h-3 w-3" />小云雀/火山音频参考</span>
                    </div>
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
