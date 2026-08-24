/**
 * Community builds never embed provider credentials in frontend bundles.
 * Configure a provider in the API settings panel instead.
 */
const GRSAI_BUILTIN_API_KEYS: string[] = [];

const GRSAI_BUILTIN_BASE_URL = "https://grsaiapi.com";
const GRSAI_BUILTIN_CHAT_BASE_URL = "https://grsaiapi.com/v1";

let keyIndex = 0;

export function getNextGrsaiKey(): string {
  if (GRSAI_BUILTIN_API_KEYS.length === 0) return "";
  const key = GRSAI_BUILTIN_API_KEYS[keyIndex % GRSAI_BUILTIN_API_KEYS.length];
  keyIndex++;
  return key;
}

export function getRandomGrsaiKey(): string {
  if (GRSAI_BUILTIN_API_KEYS.length === 0) return "";
  const idx = Math.floor(Math.random() * GRSAI_BUILTIN_API_KEYS.length);
  return GRSAI_BUILTIN_API_KEYS[idx];
}

export { GRSAI_BUILTIN_API_KEYS, GRSAI_BUILTIN_BASE_URL, GRSAI_BUILTIN_CHAT_BASE_URL };
