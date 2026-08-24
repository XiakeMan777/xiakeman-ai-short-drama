// ---------------------------------------------------------------------------
// Reference Token System (@image#N:filename & @图N)
// ---------------------------------------------------------------------------
// New format (preferred): @image#1:Clipboard_Screenshot.png
// Legacy format (backward compatible): @图1, @1
//
// The new format carries the filename in the token itself, making it
// self-describing and easier to parse for API integration.
// ---------------------------------------------------------------------------

export interface ReferenceTokenMatch {
  /** Start index in the text */
  start: number;
  /** End index in the text (exclusive) */
  end: number;
  /** The matched text (e.g. "@image#1:file.png") */
  text: string;
  /** The referenced image number (1-based) */
  imageNumber: number;
  /** Optional filename extracted from the token */
  filename?: string;
  /** Media type: image or audio */
  mediaType?: "image" | "audio";
}

// ---------------------------------------------------------------------------
// Token Detection
// ---------------------------------------------------------------------------

/**
 * Check if a character is an ASCII digit.
 */
function isAsciiDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

/**
 * Try to parse an image token starting at `index` where text[index] === "@".
 * Format: @image#N or @image#N:filename
 * Returns null if no match.
 */
function tryParseImageToken(
  text: string,
  index: number,
  maxImageCount?: number
): ReferenceTokenMatch | null {
  // Must start with "@image#"
  if (text.substring(index, index + 7) !== "@image#") return null;

  const digitsStart = index + 7;
  let digitsEnd = digitsStart;

  // Collect digits
  while (digitsEnd < text.length && isAsciiDigit(text[digitsEnd])) {
    digitsEnd += 1;
  }

  if (digitsEnd === digitsStart) return null; // No digits after #

  const numberStr = text.slice(digitsStart, digitsEnd);
  const imageNumber = Number(numberStr);

  const maxRef = maxImageCount ?? 99;
  if (imageNumber < 1 || imageNumber > maxRef) return null;

  let end = digitsEnd;
  let filename: string | undefined;

  // Optional ":filename" suffix
  if (end < text.length && text[end] === ":") {
    const filenameStart = end + 1;
    let filenameEnd = filenameStart;
    // Filename: any non-whitespace characters (supports Chinese, Unicode, etc.)
    // Stop at whitespace so that Chinese text typed after a chip doesn't get swallowed.
    while (
      filenameEnd < text.length &&
      !/\s/.test(text[filenameEnd])
    ) {
      filenameEnd += 1;
    }
    if (filenameEnd > filenameStart) {
      filename = text.slice(filenameStart, filenameEnd);
    }
    end = filenameEnd;
  }

  return {
    start: index,
    end,
    text: text.slice(index, end),
    imageNumber,
    filename,
    mediaType: "image" as const,
  };
}

/**
 * Try to parse an audio token starting at `index` where text[index] === "@".
 * Format: @audio#N or @audio#N:filename
 * Returns null if no match.
 */
function tryParseAudioToken(
  text: string,
  index: number,
  maxAudioCount?: number
): ReferenceTokenMatch | null {
  // Must start with "@audio#"
  if (text.substring(index, index + 7) !== "@audio#") return null;

  const digitsStart = index + 7;
  let digitsEnd = digitsStart;

  // Collect digits
  while (digitsEnd < text.length && isAsciiDigit(text[digitsEnd])) {
    digitsEnd += 1;
  }

  if (digitsEnd === digitsStart) return null; // No digits after #

  const numberStr = text.slice(digitsStart, digitsEnd);
  const audioNumber = Number(numberStr);

  const maxRef = maxAudioCount ?? 99;
  if (audioNumber < 1 || audioNumber > maxRef) return null;

  let end = digitsEnd;
  let filename: string | undefined;

  // Optional ":filename" suffix
  if (end < text.length && text[end] === ":") {
    const filenameStart = end + 1;
    let filenameEnd = filenameStart;
    // Filename: any non-whitespace characters (supports Chinese, Unicode, etc.)
    // Stop at whitespace so that Chinese text typed after a chip doesn't get swallowed.
    while (
      filenameEnd < text.length &&
      !/\s/.test(text[filenameEnd])
    ) {
      filenameEnd += 1;
    }
    if (filenameEnd > filenameStart) {
      filename = text.slice(filenameStart, filenameEnd);
    }
    end = filenameEnd;
  }

  return {
    start: index,
    end,
    text: text.slice(index, end),
    imageNumber: audioNumber,
    filename,
    mediaType: "audio" as const,
  };
}

/**
 * Try to parse a legacy token starting at `index` where text[index] === "@".
 * Legacy formats: @图N or @N
 * Returns null if no match.
 */
function tryParseLegacyFormat(
  text: string,
  index: number,
  maxImageCount?: number
): ReferenceTokenMatch | null {
  const maxRef = maxImageCount ?? 99;

  // Check for @图N format
  const hasTu = text[index + 1] === "图";
  const digitsStart = hasTu ? index + 2 : index + 1;
  let digitsEnd = digitsStart;

  // Collect all consecutive digits
  while (digitsEnd < text.length && isAsciiDigit(text[digitsEnd])) {
    digitsEnd += 1;
  }

  if (digitsEnd === digitsStart) return null; // No digits

  // Greedy match: find the largest valid number <= maxReferenceNumber
  let bestEnd = -1;
  let bestValue = 0;
  let rollingValue = 0;

  for (let cursor = digitsStart; cursor < digitsEnd; cursor += 1) {
    rollingValue = rollingValue * 10 + Number(text[cursor]);
    if (rollingValue >= 1 && rollingValue <= maxRef) {
      bestEnd = cursor + 1;
      bestValue = rollingValue;
    }
    if (rollingValue > maxRef) break;
  }

  if (bestEnd <= 0) return null;

  return {
    start: index,
    end: bestEnd,
    text: text.slice(index, bestEnd),
    imageNumber: bestValue,
  };
}

/**
 * Find all reference tokens in the given text.
 * Supports image format (@image#N:filename), audio format (@audio#N:filename),
 * and legacy (@图N, @N).
 * New format takes precedence if both could match at the same position.
 */
export function findReferenceTokens(
  text: string,
  maxImageCount?: number,
  maxAudioCount?: number
): ReferenceTokenMatch[] {
  const matches: ReferenceTokenMatch[] = [];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "@") continue;

    // Try audio token first (longer prefix)
    const audioMatch = tryParseAudioToken(text, index, maxAudioCount);
    if (audioMatch) {
      matches.push(audioMatch);
      index = audioMatch.end - 1; // Skip past this token
      continue;
    }

    // Try image token
    const imageMatch = tryParseImageToken(text, index, maxImageCount);
    if (imageMatch) {
      matches.push(imageMatch);
      index = imageMatch.end - 1; // Skip past this token
      continue;
    }

    // Fall back to legacy format
    const legacyMatch = tryParseLegacyFormat(text, index, maxImageCount);
    if (legacyMatch) {
      matches.push(legacyMatch);
      index = legacyMatch.end - 1;
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Token Insertion
// ---------------------------------------------------------------------------

/**
 * Build an image reference token string.
 * @image#N:filename — filename is included when available.
 */
export function buildReferenceToken(
  imageNumber: number,
  filename?: string
): string {
  if (filename && filename.trim()) {
    return `@image#${imageNumber}:${filename.trim()}`;
  }
  return `@image#${imageNumber}`;
}

/**
 * Build an audio reference token string.
 * @audio#N:filename — filename is included when available.
 */
export function buildAudioReferenceToken(
  audioNumber: number,
  filename?: string
): string {
  if (filename && filename.trim()) {
    return `@audio#${audioNumber}:${filename.trim()}`;
  }
  return `@audio#${audioNumber}`;
}

/**
 * Insert a reference token at the cursor position.
 * Automatically adds spaces around the token if needed.
 */
export function insertReferenceToken(
  text: string,
  cursor: number,
  marker: string
): { text: string; cursor: number } {
  const before = text.slice(0, cursor);
  const after = text.slice(cursor);

  // Token requires a leading space when preceded by a non-whitespace character.
  const needsLeadingSpace =
    before.length > 0 && !/\s/.test(before[before.length - 1]);

  // Trailing space: always add one after the token. Even at end-of-text,
  // a trailing space is needed so that if the user types non-whitespace
  // text immediately after the chip, the filename parser in
  // findReferenceTokens() can correctly terminate the filename.
  // Without this, "@image#1:图片你好" would parse "图片你好" as the filename,
  // swallowing user-typed "你好" into the chip label.
  const needsTrailingSpace =
    after.length > 0 ? !/\s/.test(after[0]) : true;

  const insertion = `${needsLeadingSpace ? " " : ""}${marker}${needsTrailingSpace ? " " : ""}`;

  const newText = text.slice(0, cursor) + insertion + text.slice(cursor);
  const newCursor = cursor + insertion.length;

  return { text: newText, cursor: newCursor };
}

// ---------------------------------------------------------------------------
// Token Removal
// ---------------------------------------------------------------------------

/**
 * Replace reference tokens in prompt with human-readable labels for AI submission.
 * Supports image (@image#N:filename), audio (@audio#N:filename), and legacy (@图N, @N).
 * Tokens are replaced with [参考图N] / [参考音频N] so the AI prompt remains coherent
 * and the model knows it has reference images to use.
 */
export function stripReferenceMarkers(text: string): string {
  return text
    .replace(/@image#(\d+)(?::\S+)?/g, "[参考图$1]")
    .replace(/@audio#(\d+)(?::\S+)?/g, "[参考音频$1]")
    .replace(/@图(\d+)/g, "[参考图$1]")
    .replace(/@(\d+)/g, "[参考图$1]")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Reference Collection
// ---------------------------------------------------------------------------

/**
 * Collect all referenced image numbers from the text.
 * Returns sorted unique numbers (1-based).
 */
export function collectReferencedImageNumbers(
  text: string,
  maxImageCount?: number
): number[] {
  const tokens = findReferenceTokens(text, maxImageCount);
  const numbers = new Set(tokens.filter((t) => t.mediaType !== "audio").map((t) => t.imageNumber));
  return Array.from(numbers).sort((a, b) => a - b);
}

/**
 * Collect all referenced audio numbers from the text.
 * Returns sorted unique numbers (1-based).
 */
export function collectReferencedAudioNumbers(
  text: string,
  maxAudioCount?: number
): number[] {
  const tokens = findReferenceTokens(text, undefined, maxAudioCount);
  const numbers = new Set(tokens.filter((t) => t.mediaType === "audio").map((t) => t.imageNumber));
  return Array.from(numbers).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Token Removal by Number
// ---------------------------------------------------------------------------

/**
 * Remove a specific reference token by image number from the text.
 * Removes the token and cleans up surrounding whitespace.
 * Returns the new text.
 */
export function removeReferenceTokenByNumber(
  text: string,
  imageNumber: number
): string {
  const tokens = findReferenceTokens(text);
  let result = text;
  // Process in reverse order to preserve indices
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token.imageNumber === imageNumber && token.mediaType !== "audio") {
      const before = result.slice(0, token.start);
      const after = result.slice(token.end);
      // Clean up extra spaces
      result = (before + after).replace(/\s{2,}/g, " ").trim();
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Prompt Sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize prompt text for storyboard generation.
 * Remove potentially problematic characters while preserving reference tokens.
 */
export function sanitizePromptText(text: string): string {
  return text.trim().replace(/[\r\n]+/g, " ");
}



