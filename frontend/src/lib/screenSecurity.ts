import { Capacitor, registerPlugin } from '@capacitor/core'

// Screenshot / screen-recording protection for the Android app (FLAG_SECURE).
// Browsers have no equivalent, so on the web every call here is a no-op.
//
// Several things can want the screen protected at once — the app-wide setting
// and an open snap — so callers take a hold with acquire() and give it back
// with the release function it returns. The flag is on while any hold exists.

type ScreenSecurityPlugin = {
  enable(): Promise<void>
  disable(): Promise<void>
}

const ScreenSecurity = registerPlugin<ScreenSecurityPlugin>('ScreenSecurity')

const PREF_KEY = 'iris-screen-security'

export const screenSecuritySupported = (): boolean => Capacitor.isNativePlatform()

let holds = 0
let settingRelease: (() => void) | null = null

function apply() {
  if (!screenSecuritySupported()) return
  const call = holds > 0 ? ScreenSecurity.enable() : ScreenSecurity.disable()
  call.catch((err) => console.warn('[screen-security]', err))
}

/** Take a hold on screen security. Call the returned function to release it (idempotent). */
export function acquireScreenSecurity(): () => void {
  holds++
  if (holds === 1) apply()
  let released = false
  return () => {
    if (released) return
    released = true
    holds--
    if (holds === 0) apply()
  }
}

/** The "Screen security" setting. Defaults to on, like Signal. */
export function getScreenSecurityPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setScreenSecurityPref(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off')
  } catch {
    // storage unavailable — still apply for this session
  }
  syncSetting(on)
}

function syncSetting(on: boolean) {
  if (on && !settingRelease) {
    settingRelease = acquireScreenSecurity()
  } else if (!on && settingRelease) {
    settingRelease()
    settingRelease = null
  }
}

/**
 * Apply the saved setting at startup. MainActivity turns FLAG_SECURE on before
 * the web layer loads, so with the setting off we explicitly clear it.
 */
export function initScreenSecurity() {
  if (!screenSecuritySupported()) return
  const on = getScreenSecurityPref()
  syncSetting(on)
  if (!on) apply()
}
