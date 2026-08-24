const TRUSTED_DIRECT_IMAGE_HOSTS = new Set([
  'api.xiakeman.com',
]);

const TRUSTED_DIRECT_VIDEO_HOSTS = new Set([
  'sd2.xiakeman.com',
]);

function getUrlHostname(url: string): string | null {
  try {
    return new URL(url, typeof window !== 'undefined' ? window.location.href : undefined).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isTrustedHost(url: string, hosts: ReadonlySet<string>): boolean {
  const hostname = getUrlHostname(url);
  return !!hostname && hosts.has(hostname);
}

export function isTrustedDirectImageUrl(url: string): boolean {
  return isTrustedHost(url, TRUSTED_DIRECT_IMAGE_HOSTS);
}

export function isTrustedDirectVideoUrl(url: string): boolean {
  return isTrustedHost(url, TRUSTED_DIRECT_VIDEO_HOSTS);
}
