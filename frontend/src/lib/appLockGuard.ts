import { AuthGuard } from './appLockCore'

/** Shared by the auth prompts (which pause the app) and the lock screen's lifecycle handlers. */
export const authGuard = new AuthGuard()

let holds = 0
let lastRelease = -Infinity

/**
 * Take a hold while something the user must finish outside the app is open
 * (system camera, file picker): pause/resume events during a hold don't count
 * as leaving the app. Returns a release function (idempotent).
 */
export function holdAppLock(): () => void {
  holds++
  let released = false
  return () => {
    if (released) return
    released = true
    holds = Math.max(0, holds - 1)
    lastRelease = Date.now()
  }
}

export const appLockHeld = (now: number): boolean => holds > 0 || now - lastRelease < 1500
