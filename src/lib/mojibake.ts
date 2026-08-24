const replacementCharacter = '\uFFFD';
const variantCache = new Map<string, string[]>();

let utf8Encoder: TextEncoder | undefined;
let gb18030Decoder: TextDecoder | undefined;

function getUtf8AsGb18030Mojibake(text: string): string | undefined {
  try {
    utf8Encoder ??= new TextEncoder();
    gb18030Decoder ??= new TextDecoder('gb18030');
    return gb18030Decoder.decode(utf8Encoder.encode(text));
  } catch {
    return undefined;
  }
}

export function getTextMojibakeVariants(text: string): string[] {
  const cached = variantCache.get(text);
  if (cached) return cached;

  const variants: string[] = [];
  const addVariant = (variant: string | undefined) => {
    if (variant && !variants.includes(variant)) variants.push(variant);
  };

  addVariant(text);
  const mojibake = getUtf8AsGb18030Mojibake(text);
  addVariant(mojibake);
  addVariant(mojibake?.replaceAll(replacementCharacter, ''));

  variantCache.set(text, variants);
  return variants;
}

export function includesAnyTextVariant(source: string, texts: string[]): boolean {
  return texts.some((text) => getTextMojibakeVariants(text).some((variant) => source.includes(variant)));
}

export function startsWithAnyTextVariant(source: string, texts: string[]): boolean {
  return texts.some((text) => getTextMojibakeVariants(text).some((variant) => source.startsWith(variant)));
}
