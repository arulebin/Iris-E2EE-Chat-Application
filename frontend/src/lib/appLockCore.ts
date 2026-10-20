import { LOCK_TIMINGS, type LockMode, type LockTiming } from '@iris/core'

// The App lock's per-account config (localStorage + change event). Everything
// platform-independent (timing machine, errors, double-wrap layering) lives in
// @iris/core/appLockLayer and is re-exported here for existing importers.

export {
  AppLockCanceledError, AppLockInvalidatedError, AppLockRequiredError, AuthGuard, LOCK_MARK, LOCK_TIMINGS,
  LockMachine, addLock, isLocked, layeredWrapper, lockUnwrap, lockWrap, removeLock, timingMs,
} from '@iris/core'
export type { LockMode, LockTiming } from '@iris/core'

// ── config ───────────────────────────────────────────────────────

export type AppLockConfig = {
  enabled: boolean
  mode: LockMode
  timing: LockTiming
  /** WebAuthn credential id (base64), web only. */
  credId?: string
  /** PRF salt (base64), web only. */
  salt?: string
}

const CONFIG_PREFIX = 'iris-applock:'
const CHANGE_EVENT = 'iris-applock-change'

export function getConfig(user: string | null): AppLockConfig | null {
  if (!user) return null
  try {
    const raw = localStorage.getItem(CONFIG_PREFIX + user)
    if (!raw) return null
    const c = JSON.parse(raw) as Partial<AppLockConfig>
    if (!c.enabled || (c.mode !== 'native' && c.mode !== 'prf' && c.mode !== 'gate')) return null
    const timing = LOCK_TIMINGS.some(t => t.id === c.timing) ? c.timing! : 'immediately'
    return { ...c, enabled: true, mode: c.mode, timing }
  } catch {
    return null
  }
}

export function setConfig(user: string, config: AppLockConfig | null): void {
  try {
    if (config) localStorage.setItem(CONFIG_PREFIX + user, JSON.stringify(config))
    else localStorage.removeItem(CONFIG_PREFIX + user)
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function onConfigChange(fn: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, fn)
  return () => window.removeEventListener(CHANGE_EVENT, fn)
}

