/**
 * Community builds never embed provider credentials in frontend bundles.
 * Configure an image provider in the API settings panel instead.
 */
const YUNZHI_BUILTIN_API_KEYS: string[] = [];

const YUNZHI_BUILTIN_BASE_URL = "https://aiyunzhi.top";
const YUNZHI_BUILTIN_API_BASE_URL = "https://aiyunzhi.top/v1";

let keyIndex = 0;

export function getNextYunzhiKey(): string {
  if (YUNZHI_BUILTIN_API_KEYS.length === 0) return "";
  const key = YUNZHI_BUILTIN_API_KEYS[keyIndex % YUNZHI_BUILTIN_API_KEYS.length];
  keyIndex++;
  return key;
}

export function getRandomYunzhiKey(): string {
  if (YUNZHI_BUILTIN_API_KEYS.length === 0) return "";
  const idx = Math.floor(Math.random() * YUNZHI_BUILTIN_API_KEYS.length);
  return YUNZHI_BUILTIN_API_KEYS[idx];
}

export { YUNZHI_BUILTIN_API_KEYS, YUNZHI_BUILTIN_BASE_URL, YUNZHI_BUILTIN_API_BASE_URL };
