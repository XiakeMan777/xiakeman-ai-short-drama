import type {
  CharacterVoiceReference,
  Project,
  StoryboardState,
  VideoApiConfig,
} from '@/types';
import { isSeedanceServiceBackend } from '@/lib/seedanceApi';

export const MAX_STORYBOARD_VOICE_REFERENCES = 3;

export type VoiceReferenceMediaType = 'video' | 'audio';

export interface ResolvedStoryboardVoiceReference {
  slot: number;
  mediaType: VoiceReferenceMediaType;
  characterName: string;
  displayName: string;
  language: CharacterVoiceReference['language'];
  voiceTags?: string;
  sampleText?: string;
  sourceWork?: string;
  sourceCharacter?: string;
  audioBlobKey?: string;
  audioFileName?: string;
  audioMimeType?: string;
  publicAudioUrl?: string;
  blackVideoBlobKey?: string;
  blackVideoFileName?: string;
  blackVideoMimeType?: string;
}

export function isCharacterVoiceReferenceEnabled(videoConfig?: Pick<VideoApiConfig, 'characterVoiceReferencesEnabled'>) {
  return videoConfig?.characterVoiceReferencesEnabled === true;
}

export function normalizeVoiceCharacterName(name: string) {
  return name.trim().replace(/\s+/g, '').toLowerCase();
}

export function getCharacterVoiceReferences(
  project: Pick<Project, 'characterVoiceReferences'> | null | undefined,
  characterName: string,
) {
  const target = normalizeVoiceCharacterName(characterName);
  return (project?.characterVoiceReferences ?? [])
    .filter((reference) => normalizeVoiceCharacterName(reference.characterName) === target)
    .sort((a, b) => Number(b.locked ?? false) - Number(a.locked ?? false) || b.updatedAt - a.updatedAt);
}

function collectStoryboardSpeakerNames(storyboard: StoryboardState) {
  const names: string[] = [];
  const seen = new Set<string>();
  const knownCharacters = storyboard.storyboard.characters ?? [];
  const knownByKey = new Map(
    knownCharacters
      .map((name) => [normalizeVoiceCharacterName(name), name.trim()] as const)
      .filter(([key, name]) => key && name),
  );
  const blockedSpeakerLabels = new Set([
    'TIME',
    'SHOT',
    'ACTION',
    'DIALOGUE',
    'SFX',
    'AUDIO',
    'TRANSITION',
    '对白',
    '台词',
    '画面',
    '镜头',
    '音效',
    '音乐',
    '转场',
  ]);

  const addName = (value: string | undefined) => {
    const candidate = (value ?? '').replace(/[“”"「」]/g, '').trim();
    if (!candidate || blockedSpeakerLabels.has(candidate) || blockedSpeakerLabels.has(candidate.toUpperCase())) return;
    const key = normalizeVoiceCharacterName(candidate);
    if (!key || seen.has(key)) return;
    const knownName = knownByKey.get(key);
    const resolvedName = knownName ?? candidate;
    seen.add(normalizeVoiceCharacterName(resolvedName));
    names.push(resolvedName);
  };

  const scriptText = [
    storyboard.correctedScript,
    storyboard.sourceExcerpt,
    storyboard.sourceExcerptSummary,
    storyboard.prompt?.rawText,
    storyboard.seedanceFinalVideoPrompt,
  ].filter(Boolean).join('\n');

  const labeledDialogueSpeakerPattern = /(?:对白|台词|DIALOGUE)\s*[：:]\s*([^：:\n]{1,16})\s*[：:]/gi;
  for (const match of scriptText.matchAll(labeledDialogueSpeakerPattern)) {
    addName(match[1]);
  }

  const dialogueSpeakerPattern = /(?:^|\n)\s*([^：:\n]{1,16})\s*[：:]/g;
  for (const match of scriptText.matchAll(dialogueSpeakerPattern)) {
    addName(match[1]);
  }

  for (const name of knownCharacters) {
    addName(name);
  }

  return names;
}

function pickUsableReference(references: CharacterVoiceReference[], backend?: VideoApiConfig['backend']) {
  return references.find((reference) => (
    reference.locked !== false
    && (
      isSeedanceServiceBackend(backend)
        ? !!(reference.audioBlobKey || reference.publicAudioUrl)
        : backend === 'volcengine'
          ? !!reference.publicAudioUrl
          : !!(reference.blackVideoBlobKey || reference.publicAudioUrl || reference.audioBlobKey)
    )
  ));
}

function resolveVoiceReferenceMediaType(
  reference: CharacterVoiceReference,
  backend?: VideoApiConfig['backend'],
): VoiceReferenceMediaType | null {
  if (isSeedanceServiceBackend(backend)) return (reference.audioBlobKey || reference.publicAudioUrl) ? 'audio' : null;
  if (backend === 'volcengine') return reference.publicAudioUrl ? 'audio' : null;
  if (reference.blackVideoBlobKey) return 'video';
  if (reference.publicAudioUrl || reference.audioBlobKey) return 'audio';
  return null;
}

export function resolveStoryboardVoiceReferences(input: {
  storyboard: StoryboardState;
  project: Pick<Project, 'characterVoiceReferences'> | null | undefined;
  videoConfig: Pick<VideoApiConfig, 'backend' | 'characterVoiceReferencesEnabled'>;
  maxCount?: number;
}): ResolvedStoryboardVoiceReference[] {
  if (!isCharacterVoiceReferenceEnabled(input.videoConfig)) return [];

  const maxCount = Math.max(0, Math.min(MAX_STORYBOARD_VOICE_REFERENCES, input.maxCount ?? MAX_STORYBOARD_VOICE_REFERENCES));
  if (maxCount === 0) return [];

  const picked: ResolvedStoryboardVoiceReference[] = [];
  const seen = new Set<string>();
  for (const characterName of collectStoryboardSpeakerNames(input.storyboard)) {
    const key = normalizeVoiceCharacterName(characterName);
    if (!key || seen.has(key)) continue;
    const reference = pickUsableReference(getCharacterVoiceReferences(input.project, characterName), input.videoConfig.backend);
    if (!reference) continue;
    const mediaType = resolveVoiceReferenceMediaType(reference, input.videoConfig.backend);
    if (!mediaType) continue;

    picked.push({
      slot: picked.length + 1,
      mediaType,
      characterName,
      displayName: reference.displayName || reference.sourceCharacter || characterName,
      language: reference.language,
      voiceTags: reference.voiceTags,
      sampleText: reference.sampleText,
      sourceWork: reference.sourceWork,
      sourceCharacter: reference.sourceCharacter,
      audioBlobKey: reference.audioBlobKey,
      audioFileName: reference.audioFileName,
      audioMimeType: reference.audioMimeType,
      publicAudioUrl: reference.publicAudioUrl,
      blackVideoBlobKey: reference.blackVideoBlobKey,
      blackVideoFileName: reference.blackVideoFileName,
      blackVideoMimeType: reference.blackVideoMimeType,
    });
    seen.add(key);
    if (picked.length >= maxCount) break;
  }

  return picked;
}

export function buildSeedanceVoiceReferencePromptBlock(references: readonly ResolvedStoryboardVoiceReference[]) {
  if (references.length === 0) return '';
  const lines = references.map((reference) => {
    const carrier = reference.mediaType === 'video' ? `参考 @视频${reference.slot}` : `参考 @音频${reference.slot}`;
    const tone = reference.voiceTags?.trim() ? `声线特征：${reference.voiceTags.trim()}。` : '';
    const sample = reference.sampleText?.trim() ? `试听台词气质：${reference.sampleText.trim().slice(0, 80)}。` : '';
    return `${carrier} = ${reference.characterName} 的配音参考，只读取声音、语速、情绪颗粒和口语节奏，不迁移角色外观；${tone}${sample}`;
  });
  return [
    '角色配音参考（最多 3 位，和实际提交顺序一致）：',
    '媒体编号规则：@图片、@视频、@音频是三套独立编号；小云雀按 @音频1..N 提交音频参考，不延续图片编号，也不按混合上传文件总顺序计数。',
    ...lines,
    '音画同步要求：当前分镜中这些角色开口时，口型、停顿和情绪强度贴近对应声线参考；未列入的角色按文本表演说明执行，不新增音频参考。',
  ].join('\n');
}
