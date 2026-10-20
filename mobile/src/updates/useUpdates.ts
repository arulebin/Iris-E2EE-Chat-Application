import * as Application from 'expo-application'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Linking, Platform } from 'react-native'
import {
  compareNative,
  fetchNativeInfo,
  updateTarget,
  type Distribution,
  type NativeUpdateInfo,
  type NativeUpdateStatus,
} from './nativeUpdate'

/** Resume checks are throttled so foregrounding the app repeatedly doesn't hammer the server. */
export const CHECK_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000

let lastCheckAt = 0
let inFlight: Promise<void> | null = null

/**
 * Check for a new JS bundle and download it in the background. Never reloads: the bundle
 * is applied on the next cold start unless the user taps "Restart to update".
 * Silent on failure (offline, server down, signature rejected by the client).
 */
export function checkAndDownload(force = false): Promise<void> {
  if (!Updates.isEnabled) return Promise.resolve() // dev client / Expo Go
  if (inFlight) return inFlight
  if (!force && Date.now() - lastCheckAt < CHECK_MIN_INTERVAL_MS) return Promise.resolve()
  lastCheckAt = Date.now()
  inFlight = (async () => {
    try {
      const r = await Updates.checkForUpdateAsync()
      if (r.isAvailable) await Updates.fetchUpdateAsync()
    } catch (e) {
      console.warn('[ota] update check failed:', e instanceof Error ? e.message : 'unknown')
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

/** Checks on mount and on every foreground (throttled); exposes pending-update state. */
export function useOtaUpdates() {
  const u = Updates.useUpdates()
  useEffect(() => {
    void checkAndDownload()
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') void checkAndDownload()
    })
    return () => sub.remove()
  }, [])
  const restart = useCallback(() => Updates.reloadAsync(), [])
  return {
    /** A verified bundle is downloaded and will run on next cold start. */
    pending: u.isUpdatePending,
    downloading: u.isDownloading,
    checking: u.isChecking,
    restart,
    checkNow: () => checkAndDownload(true),
    current: u.currentlyRunning,
    lastError: u.checkError ?? u.downloadError,
  }
}

function updatesBaseUrl(): string | null {
  const url = Constants.expoConfig?.updates?.url
  return typeof url === 'string' ? url.replace(/\/manifest$/, '') : null
}

export function distribution(): Distribution {
  const d = (Constants.expoConfig?.extra as { iris?: { distribution?: string } } | undefined)?.iris?.distribution
  return d === 'play' ? 'play' : 'sideload'
}

/**
 * Native-binary update prompt hook. Android only. Does NOT install anything: "Update"
 * opens the Play listing (Play builds; Play also offers its own in-app update flow, see
 * docs/ota-updates.md) or the signed-APK GitHub Releases page (sideloaded builds).
 */
export function useNativeUpdate() {
  const [info, setInfo] = useState<NativeUpdateInfo | null>(null)
  const [status, setStatus] = useState<NativeUpdateStatus>({ available: false, required: false })
  const [dismissed, setDismissed] = useState(false)
  const last = useRef(0)

  useEffect(() => {
    if (Platform.OS !== 'android' || __DEV__) return
    const base = updatesBaseUrl()
    const installed = Number(Application.nativeBuildVersion)
    if (!base || !Number.isInteger(installed)) return
    const run = async () => {
      if (Date.now() - last.current < CHECK_MIN_INTERVAL_MS) return
      last.current = Date.now()
      const i = await fetchNativeInfo(base)
      if (!i) return
      setInfo(i)
      setStatus(compareNative(installed, i))
    }
    void run()
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') void run()
    })
    return () => sub.remove()
  }, [])

  const open = useCallback(async () => {
    if (!info) return
    const target = updateTarget(info, distribution(), Application.applicationId ?? 'com.iris.chat.mobile')
    if (target) await Linking.openURL(target)
  }, [info])

  return {
    info,
    available: status.available && !dismissed,
    required: status.required,
    open,
    dismiss: () => setDismissed(true),
  }
}
