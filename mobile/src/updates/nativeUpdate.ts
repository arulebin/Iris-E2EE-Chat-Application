/**
 * Binary ("native") update check. Pure logic + one fetch; no React Native imports so it
 * can be unit-tested in plain Node.
 *
 * The server publishes `<updates base>/native.json` (written by `ota-publish.mjs native`).
 * That file is NOT signed, so it is treated as a hint only: the app never installs
 * anything. It can at most make us open (a) the Play Store listing, or (b) a GitHub
 * Releases page, and (b) is restricted to github.com/<owner>/<repo>/releases URLs so a
 * compromised server cannot point users at an arbitrary download.
 */
export type NativeUpdateInfo = {
  latestVersionCode: number
  latestVersion: string
  /** Installed binaries below this are told the update is required (blocking-style prompt). */
  minVersionCode: number
  apkUrl?: string
  playStoreUrl?: string
  notes?: string
}

export type Distribution = 'play' | 'sideload'

const GITHUB_RELEASES_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases(\/|$)/
const PLAY_URL_RE = /^(market:\/\/details\?id=|https:\/\/play\.google\.com\/store\/apps\/details\?id=)[A-Za-z0-9._]+/

export function isAllowedApkUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length < 512 && GITHUB_RELEASES_RE.test(url)
}

export function parseNativeInfo(raw: unknown): NativeUpdateInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const latest = r.latestVersionCode
  const min = r.minVersionCode ?? latest
  if (!Number.isInteger(latest) || !Number.isInteger(min)) return null
  return {
    latestVersionCode: latest as number,
    minVersionCode: min as number,
    latestVersion: typeof r.latestVersion === 'string' ? r.latestVersion.slice(0, 32) : String(latest),
    apkUrl: isAllowedApkUrl(r.apkUrl) ? r.apkUrl : undefined,
    playStoreUrl: typeof r.playStoreUrl === 'string' && PLAY_URL_RE.test(r.playStoreUrl) ? r.playStoreUrl : undefined,
    notes: typeof r.notes === 'string' ? r.notes.slice(0, 280) : undefined,
  }
}

export type NativeUpdateStatus = { available: boolean; required: boolean }

export function compareNative(installedVersionCode: number, info: NativeUpdateInfo): NativeUpdateStatus {
  return {
    available: installedVersionCode < info.latestVersionCode,
    required: installedVersionCode < info.minVersionCode,
  }
}

/** Where "Update" should send the user, or null when there is nothing safe to open. */
export function updateTarget(info: NativeUpdateInfo, distribution: Distribution, applicationId: string): string | null {
  if (distribution === 'play') return info.playStoreUrl ?? `market://details?id=${applicationId}`
  return info.apkUrl ?? null
}

export async function fetchNativeInfo(baseUrl: string, timeoutMs = 8000): Promise<NativeUpdateInfo | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl}/native.json`, { signal: ctl.signal, headers: { accept: 'application/json' } })
    if (!res.ok) return null
    return parseNativeInfo(await res.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
