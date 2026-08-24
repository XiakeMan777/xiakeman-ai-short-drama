import type { Asset, AssetSource, ImageConcept } from '@/types';

export interface StoryboardReferenceReadingInput {
  refId?: string;
  type: 'scene' | 'character' | 'prop';
  name: string;
  concept?: ImageConcept;
  assetSource?: AssetSource;
  variantKey?: string;
  outfitSeq?: number;
  isNoFaceCharacterVisual?: boolean;
}

export interface StoryboardReferenceReadingContract {
  readFor: string;
  doNotUseFor: string;
  mustKeep: string[];
}

const STYLE_TRANSFER_GUARD = 'Do not inherit photographic realism, actor likeness style, real skin pores, DSLR lighting, film-still grading, portrait retouching, or reference-image render style; convert only the locked identity/shape/material into the project style.';

function hasNoFacePromptSignal(text: string | undefined) {
  const normalized = (text ?? '').toLowerCase();
  const hasExplicitNoFaceBodySignal = /\bno\s+face\b(?!\s+(?:change|shape|identity|drift|swap|redesign|replacement|distortion|mutation))/i.test(normalized);
  return normalized.includes('no-face')
    || hasExplicitNoFaceBodySignal
    || normalized.includes('blank head')
    || normalized.includes('no facial features')
    || normalized.includes('无脸')
    || normalized.includes('无头')
    || normalized.includes('空白头模')
    || normalized.includes('不得出现真人脸');
}

export function isNoFaceCharacterReferenceAsset(asset: Pick<Asset, 'type' | 'concept' | 'optimizedPrompt' | 'description'> | undefined) {
  if (!asset || asset.type !== 'character' || asset.concept === 'portrait_closeup') return false;
  return hasNoFacePromptSignal(asset.optimizedPrompt) || hasNoFacePromptSignal(asset.description);
}

export function buildStoryboardReferenceReadingContract(
  reference: StoryboardReferenceReadingInput,
): StoryboardReferenceReadingContract {
  if (reference.type === 'scene') {
    return {
      readFor: 'SCENE LOCK: read spatial layout, scale, material, lighting direction, entrance/exit, action zone, and camera axis.',
      doNotUseFor: `Do not paste the scene reference as a poster, collage, or replacement for current shot blocking. ${STYLE_TRANSFER_GUARD}`,
      mustKeep: ['spatial layout', 'material', 'lighting direction', 'camera axis'],
    };
  }

  if (reference.type === 'prop') {
    return {
      readFor: 'PROP LOCK: read prop shape, material, color, scale, state, holder relation, and how it can be handled in the current shot.',
      doNotUseFor: `Do not expand the prop into unrelated plot action or duplicate it as decorative clutter. ${STYLE_TRANSFER_GUARD}`,
      mustKeep: ['prop shape', 'material', 'color', 'state', 'holder relation'],
    };
  }

  if (reference.isNoFaceCharacterVisual) {
    return {
      readFor: 'NO-FACE OUTFIT/BODY ONLY: read clothing version, body proportion, outfit silhouette, material, accessories, and equipment.',
      doNotUseFor: `Do not read face, facial features, hairstyle, skin tone, portrait identity, or official-person likeness from this no-face reference. ${STYLE_TRANSFER_GUARD}`,
      mustKeep: ['clothing version', 'body proportion', 'outfit silhouette', 'material', 'accessories', 'equipment'],
    };
  }

  if (reference.assetSource === 'volc_virtual_human') {
    return {
      readFor: 'OFFICIAL IDENTITY ASSET: read portrait identity only; use it as the official face/identity anchor for the character.',
      doNotUseFor: `Do not use the official portrait for clothing version, body proportion, material, hairstyle redesign, or outfit detail; use the no-face outfit/body reference when available. ${STYLE_TRANSFER_GUARD}`,
      mustKeep: ['official portrait identity', 'face identity'],
    };
  }

  if (reference.concept === 'landscape_outfit_turnaround') {
    const version = reference.variantKey ?? (typeof reference.outfitSeq === 'number' ? `outfit-${reference.outfitSeq}` : 'selected outfit');
    return {
      readFor: `OUTFIT VERSION LOCK (${version}): FACE HERO CLOSE-UP locks same identity anchors, not rendering style; FRONT VIEW and BACK VIEW lock body proportion and clothing silhouette; COSTUME / SUIT DETAIL VIEW locks material and outfit details.`,
      doNotUseFor: `Do not mix this outfit version with the base outfit, do not redesign the costume, and do not paste the character sheet layout into the storyboard. ${STYLE_TRANSFER_GUARD}`,
      mustKeep: ['same identity', 'outfit version consistency', 'body proportion', 'clothing silhouette', 'material details'],
    };
  }

  if (reference.concept === 'landscape_turnaround') {
    return {
      readFor: 'CHARACTER SHEET LOCK: FACE HERO CLOSE-UP locks face identity anchors, not rendering style; FRONT VIEW and BACK VIEW lock body proportion and base outfit silhouette; COSTUME / SUIT DETAIL VIEW locks material/details.',
      doNotUseFor: `Do not paste the character sheet layout, module labels, front/back panels, or reference-board background into the storyboard. ${STYLE_TRANSFER_GUARD}`,
      mustKeep: ['face identity', 'body proportion', 'base outfit silhouette', 'material details'],
    };
  }

  if (reference.concept === 'portrait_outfit') {
    const version = reference.variantKey ?? (typeof reference.outfitSeq === 'number' ? `outfit-${reference.outfitSeq}` : 'selected outfit');
    return {
      readFor: `OUTFIT PORTRAIT LOCK (${version}): read the selected outfit version while preserving the same character identity anchors and body proportion; do not read rendering style.`,
      doNotUseFor: `Do not treat this as a new character, base outfit replacement, or storyboard action frame. ${STYLE_TRANSFER_GUARD}`,
      mustKeep: ['same character identity', 'selected outfit version', 'body proportion'],
    };
  }

  return {
    readFor: 'CHARACTER IDENTITY LOCK: read face identity anchors, age feel, key visual anchors, and performance direction for this character; do not read rendering style.',
    doNotUseFor: `Do not redesign facial features, hairstyle, costume, body proportion, or treat the portrait as a full scene frame. ${STYLE_TRANSFER_GUARD}`,
    mustKeep: ['face identity', 'visual anchors', 'performance direction'],
  };
}
