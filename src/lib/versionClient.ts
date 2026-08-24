import { BUILD_INFO } from '@/lib/buildInfo'

export interface VersionManifest {
  version: string
  buildTime: string
  buildLabel: string
}

const VERSION_CHECK_INTERVAL_MS = 90_000
const VERSION_REQUEST_TIMEOUT_MS = 8_000

function getVersionManifestUrl() {
  return new URL(`${import.meta.env.BASE_URL}version.json`, window.location.origin).toString()
}

export function getCurrentBuildLabel() {
  return BUILD_INFO.buildLabel
}

export function getVersionCheckIntervalMs() {
  return VERSION_CHECK_INTERVAL_MS
}

export async function fetchVersionManifest(): Promise<VersionManifest | null> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), VERSION_REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(getVersionManifestUrl(), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      return null
    }

    const manifest = (await response.json()) as Partial<VersionManifest>
    if (!manifest.buildLabel || !manifest.version || !manifest.buildTime) {
      return null
    }

    return {
      version: manifest.version,
      buildTime: manifest.buildTime,
      buildLabel: manifest.buildLabel,
    }
  } catch {
    return null
  } finally {
    window.clearTimeout(timeout)
  }
}
