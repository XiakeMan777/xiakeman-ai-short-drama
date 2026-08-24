/**
 * Community builds never embed provider credentials in frontend bundles.
 * Configure a video provider or license in the API settings panel instead.
 */
const SD2_BUILTIN_API_KEYS: string[] = [];

const SD2_BUILTIN_BASE_URL = "https://sd2.xiakeman.com";

let keyIndex = 0;

export function getNextSd2Key(): string {
  if (SD2_BUILTIN_API_KEYS.length === 0) return "";
  const key = SD2_BUILTIN_API_KEYS[keyIndex % SD2_BUILTIN_API_KEYS.length];
  keyIndex++;
  return key;
}

export function getRandomSd2Key(): string {
  if (SD2_BUILTIN_API_KEYS.length === 0) return "";
  const idx = Math.floor(Math.random() * SD2_BUILTIN_API_KEYS.length);
  return SD2_BUILTIN_API_KEYS[idx];
}

export { SD2_BUILTIN_API_KEYS, SD2_BUILTIN_BASE_URL };
