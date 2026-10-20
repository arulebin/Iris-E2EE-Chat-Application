import { AuthGuard } from './appLockCore'

/** Shared by the auth prompts (which pause the app) and the lock screen's lifecycle handlers. */
export const authGuard = new AuthGuard()

// ── "expected external activity" holds ───────────────────────────
// Things the user must finish outside the app (system camera, file picker,
// share sheet) pause/resume the activity. Those events must not count as
// leaving the app, or the lock would unmount it and lose the pending work.

/** Safety net: a hold that is never released expires, so the lock can't be disabled for good. */
export const HOLD_MAX_MS = 10 * 60_000
/** After a hold ends, resume events that arrive slightly late are still ignored. */
export const HOLD_GRACE_MS = 1500

type Hold = { until: number }
const active = new Set<Hold>()
let lastRelease = -Infinity

/**
 * Take a hold; pause/resume events during it don't count as leaving the app.
 * Returns a release function (idempotent). Expires on its own after `maxMs`.
 * Holds nest: the app is held until every one is released.
 */
export function holdAppLock(maxMs: number = HOLD_MAX_MS): () => void {
  const hold: Hold = { until: Date.now() + maxMs }
  active.add(hold)
  const timer = setTimeout(release, maxMs)
  function release() {
    clearTimeout(timer)
    if (!active.delete(hold)) return
    lastRelease = Date.now()
  }
  return release
}

/** Run `fn` under a hold that is always released, whether it resolves or throws. */
export async function withAppLockHold<T>(fn: () => Promise<T>, maxMs?: number): Promise<T> {
  const release = holdAppLock(maxMs)
  try {
    return await fn()
  } finally {
    release()
  }
}

export function appLockHeld(now: number): boolean {
  for (const h of active) {
    if (now < h.until) return true
  }
  return now - lastRelease < HOLD_GRACE_MS
}

/** Test helper. */
export function resetAppLockHolds(): void {
  active.clear()
  lastRelease = -Infinity
  endFilePick()
  setCallActive(false)
}

// ── file pickers ─────────────────────────────────────────────────
// <input type="file"> gives no "dialog closed" signal on cancel (no change
// event). Hold from the click; release on change, or once the window comes
// back (focus / visible) after having left, which covers cancel.

export const FILE_PICK_SETTLE_MS = 2000
export const FILE_PICK_MAX_MS = 5 * 60_000

let endPick: (() => void) | null = null

/** Call from the input's onClick (also fires for programmatic .click()). */
export function beginFilePick(): void {
  endFilePick()
  const release = holdAppLock(FILE_PICK_MAX_MS)
  let left = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const gone = () => { left = true; clearTimeout(timer) }
  const back = () => {
    if (!left || document.visibilityState === 'hidden') return
    clearTimeout(timer)
    timer = setTimeout(endFilePick, FILE_PICK_SETTLE_MS)
  }
  const onVis = () => (document.visibilityState === 'hidden' ? gone() : back())
  window.addEventListener('blur', gone)
  window.addEventListener('focus', back)
  document.addEventListener('visibilitychange', onVis)
  endPick = () => {
    clearTimeout(timer)
    window.removeEventListener('blur', gone)
    window.removeEventListener('focus', back)
    document.removeEventListener('visibilitychange', onVis)
    release()
  }
}

/** Call from the input's onChange (a file was chosen) or on any other known end. Idempotent. */
export function endFilePick(): void {
  const end = endPick
  endPick = null
  end?.()
}

// ── calls ────────────────────────────────────────────────────────
// The call lives inside <App/> (useCall), so locking, which unmounts the app,
// would kill the call. While a call is ringing out or connected, going to the
// background/PiP therefore doesn't lock.

let callActive = false
const callListeners = new Set<(active: boolean) => void>()

export function setCallActive(on: boolean): void {
  if (callActive === on) return
  callActive = on
  callListeners.forEach(fn => fn(on))
}

export const isCallActive = (): boolean => callActive

export function onCallActiveChange(fn: (active: boolean) => void): () => void {
  callListeners.add(fn)
  return () => { callListeners.delete(fn) }
}

/** True while the lock must not treat pause/resume as leaving the app. */
export const lockSuspended = (now: number): boolean =>
  authGuard.suspended(now) || appLockHeld(now) || callActive
