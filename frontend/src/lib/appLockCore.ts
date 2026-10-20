import type { KeyWrapper } from './nativeKeystore'

// Platform-independent pieces of the optional "App lock": the timing state
// machine, the per-account config, and the double-wrap layering of the at-rest
// storage keys. No Capacitor / WebAuthn imports here, so it's unit-testable.
// Platform glue lives in lib/appLock.ts.

// ── config ───────────────────────────────────────────────────────

export type LockTiming = 'immediately' | '1m' | '30m'

export const LOCK_TIMINGS: { id: LockTiming; label: string; ms: number }[] = [
  { id: 'immediately', label: 'Immediately', ms: 0 },
  { id: '1m', label: 'After 1 minute', ms: 60_000 },
  { id: '30m', label: 'After 30 minutes', ms: 30 * 60_000 },
]

export const timingMs = (t: LockTiming): number =>
  LOCK_TIMINGS.find(x => x.id === t)?.ms ?? 0

/**
 * native: Android Keystore key behind biometrics / screen lock (cryptographic).
 * prf:    WebAuthn PRF output wraps the storage key (cryptographic).
 * gate:   WebAuthn user verification only: a UI gate, NOT encryption.
 */
export type LockMode = 'native' | 'prf' | 'gate'

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

// ── errors ───────────────────────────────────────────────────────

/** The user dismissed the prompt. */
export class AppLockCanceledError extends Error {}
/** The lock key can't be used any more (new biometric enrolled, screen lock removed, key gone). Fall back to the password flow. */
export class AppLockInvalidatedError extends Error {}
/** No recent authentication / lock layer unavailable. */
export class AppLockRequiredError extends Error {}

// ── lock timing state machine ────────────────────────────────────

/**
 * Tracks when the app was backgrounded and decides, on return, whether it
 * must be locked. Starts locked (cold start). Fail-safe: a clock that went
 * backwards counts as "expired".
 */
export class LockMachine {
  private _locked: boolean
  private hiddenAt: number | null = null
  private timeoutMs: number

  constructor(timeoutMs: number, startLocked: boolean) {
    this.timeoutMs = timeoutMs
    this._locked = startLocked
  }

  get locked(): boolean { return this._locked }

  setTimeout(ms: number): void { this.timeoutMs = ms }

  /** The app went to the background (first call wins until foreground). */
  background(now: number): void {
    if (!this._locked && this.hiddenAt === null) this.hiddenAt = now
  }

  /** Forget a pending background timestamp (e.g. the pause was our own auth prompt). */
  discardBackground(): void { this.hiddenAt = null }

  /** The app is visible again. Returns whether it is now locked. */
  foreground(now: number): boolean {
    if (this.hiddenAt !== null) {
      const elapsed = now - this.hiddenAt
      this.hiddenAt = null
      if (elapsed < 0 || elapsed >= this.timeoutMs) this._locked = true
    }
    return this._locked
  }

  unlock(): void { this._locked = false; this.hiddenAt = null }
  lock(): void { this._locked = true; this.hiddenAt = null }
}

/**
 * The system auth prompt (and the device-credential screen) pause/resume the
 * activity. Those events must not count as "the user left the app".
 */
export class AuthGuard {
  private depth = 0
  private lastEnd = -Infinity
  private readonly graceMs: number
  constructor(graceMs = 1500) { this.graceMs = graceMs }

  begin(): void { this.depth++ }
  end(now: number): void { this.depth = Math.max(0, this.depth - 1); this.lastEnd = now }
  suspended(now: number): boolean { return this.depth > 0 || now - this.lastEnd < this.graceMs }
}

// ── layering the app-lock key over the at-rest wrapper ───────────

/** Blobs wrapped by the lock layer start with this; plain (single-wrapped) blobs don't. */
export const LOCK_MARK = 'L1:'

const te = new TextEncoder()
const td = new TextDecoder()

export const isLocked = (blob: string): boolean => blob.startsWith(LOCK_MARK)

/**
 * raw --lock.wrap--> text --base.wrap--> "L1:" + blob.
 * `base` is the Keystore wrapper (Android), or null on the web where the lock
 * layer (WebAuthn PRF) is the only wrapper.
 */
export async function lockWrap(raw: Uint8Array, base: KeyWrapper | null, lock: KeyWrapper): Promise<string> {
  const inner = await lock.wrap(raw)
  return LOCK_MARK + (base ? await base.wrap(te.encode(inner)) : inner)
}

/** Inverse of lockWrap. Needs a recent user authentication (the lock layer). */
export async function lockUnwrap(blob: string, base: KeyWrapper | null, lock: KeyWrapper): Promise<Uint8Array> {
  if (!isLocked(blob)) throw new Error('not an app-locked blob')
  const body = blob.slice(LOCK_MARK.length)
  const inner = base ? td.decode(await base.unwrap(body)) : body
  return lock.unwrap(inner)
}

/**
 * The KeyWrapper handed to AtRestCipher. Reads work for both formats (marker
 * decides); writes are double-wrapped while the lock is enabled.
 *  - `lock()` returns the lock layer, or null when unavailable.
 *  - `locking()` says whether NEW blobs should be double-wrapped.
 */
export function layeredWrapper(
  base: KeyWrapper | null,
  lock: () => KeyWrapper | null,
  locking: () => boolean,
): KeyWrapper {
  return {
    async wrap(raw) {
      const layer = locking() ? lock() : null
      if (layer) return lockWrap(raw, base, layer)
      if (!base) throw new AppLockRequiredError('App lock layer unavailable')
      return base.wrap(raw)
    },
    async unwrap(blob) {
      if (!isLocked(blob)) {
        if (!base) throw new AppLockRequiredError('Unexpected unlocked blob without a base wrapper')
        return base.unwrap(blob)
      }
      const layer = lock()
      if (!layer) throw new AppLockRequiredError('App lock layer unavailable')
      return lockUnwrap(blob, base, layer)
    },
    async reset() { await base?.reset() },
  }
}

/** Single-wrapped -> double-wrapped (enabling). Already-locked blobs pass through. */
export async function addLock(blob: string, base: KeyWrapper, lock: KeyWrapper): Promise<string> {
  if (isLocked(blob)) return blob
  const raw = await base.unwrap(blob)
  try { return await lockWrap(raw, base, lock) } finally { raw.fill(0) }
}

/** Double-wrapped -> single-wrapped (disabling). Plain blobs pass through. Needs authentication. */
export async function removeLock(blob: string, base: KeyWrapper, lock: KeyWrapper): Promise<string> {
  if (!isLocked(blob)) return blob
  const raw = await lockUnwrap(blob, base, lock)
  try { return await base.wrap(raw) } finally { raw.fill(0) }
}
