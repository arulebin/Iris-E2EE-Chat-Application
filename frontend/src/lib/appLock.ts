import { Capacitor } from '@capacitor/core'
import { AtRestCipher, dropAllStorageKeys } from './atRest'
import {
  addLock,
  getConfig,
  isLocked,
  lockUnwrap,
  removeLock,
  setConfig,
  type AppLockConfig,
  type LockTiming,
} from './appLockCore'
import {
  nativeAuthenticate,
  nativeAppLockPresent,
  nativeCreateKey,
  nativeDeleteKey,
  nativeLockLayer,
  nativeLockStatus,
} from './appLockNative'
import { clearWebLockSession, webAuthenticate, webLockAvailable, webPrfLayer, webRegister } from './appLockWeb'
import { nativeKeyWrapper, plainNativeKeyWrapper } from './nativeKeystore'
import { idbKV } from './signal/kv'
import {
  EscrowRateLimitedError,
  EscrowWrongPasswordError,
  escrowRetryIn,
  escrowStatus,
  getEscrowSessionMaster,
  openEscrows,
  recordEscrowFailure,
  recordEscrowSuccess,
  removeEscrow,
  writeEscrows,
  type EscrowStatus,
} from './appLockEscrow'
import { cachedAuthSalt, saltOfMaster } from '../crypto'

// Orchestration for the optional App lock: enabling / disabling it for an
// account (re-wrapping the at-rest storage keys), unlocking, and the
// "use password instead" escape hatch. Pure logic is in appLockCore.ts.

export type LockAvailability =
  | { available: true; kind: 'native' | 'web' }
  | { available: false; reason: 'none_enrolled' | 'unsupported' }

export async function appLockAvailability(): Promise<LockAvailability> {
  if (Capacitor.isNativePlatform()) {
    if (!nativeAppLockPresent()) return { available: false, reason: 'unsupported' }
    const s = await nativeLockStatus()
    return s === 'available' ? { available: true, kind: 'native' } : { available: false, reason: s }
  }
  return (await webLockAvailable())
    ? { available: true, kind: 'web' }
    : { available: false, reason: 'unsupported' }
}

/** The two at-rest storage-key prefixes of an account and their Keystore aliases. */
const slots = (user: string) => [
  { prefix: `sig:${user}:`, alias: user },
  { prefix: `hist:${user}:`, alias: `${user}#history` },
]

const SKW = 'skw'

// ── exclusive runner (web enable/disable remounts the app around the change) ──

type Runner = <T>(fn: () => Promise<T>) => Promise<T>
let runner: Runner = fn => fn()
/** AppLock.tsx registers how to unmount/remount the app around a storage-format change. */
export function setExclusiveRunner(r: Runner | null): void { runner = r ?? (fn => fn()) }

// ── lifecycle ────────────────────────────────────────────────────

/** Forget every in-memory secret tied to the lock (called when the lock engages). */
export function engageLock(): void {
  dropAllStorageKeys()
  clearWebLockSession()
}

/** Show the prompt for an already-enabled lock, then load the storage keys while the auth window is open. */
export async function unlockApp(user: string, cfg: AppLockConfig): Promise<void> {
  if (cfg.mode === 'native') await nativeAuthenticate()
  else await webAuthenticate(cfg)
  if (cfg.mode === 'gate') return
  await loadStorageKeys(user)
  await refreshEscrowInWindow(user)
}

/**
 * Eagerly unwrap both keys inside a freshly opened auth window. The stores
 * share these cached keys, so nothing will need a second prompt later.
 */
async function loadStorageKeys(user: string): Promise<void> {
  for (const { prefix, alias } of slots(user)) {
    await new AtRestCipher(idbKV, prefix, nativeKeyWrapper(alias)).getKey()
  }
}

// ── password escrow ──────────────────────────────────────────────

const escrowSlots = (user: string) =>
  slots(user).map(s => ({ prefix: s.prefix, base: plainNativeKeyWrapper(s.alias) }))

/** The raw storage key of a slot, through the (layered) wrapper: needs an open auth window when locked. */
const rawKeyOf = (user: string) => async (prefix: string): Promise<Uint8Array | null> => {
  const slot = slots(user).find(s => s.prefix === prefix)
  const blob = await idbKV.get<string>(prefix + SKW)
  const w = slot && nativeKeyWrapper(slot.alias)
  if (typeof blob !== 'string' || !w) return null
  return w.unwrap(blob)
}

/** Does the account have a password escrow for every storage key? (Decides which recovery flow the lock screen offers.) */
export async function hasEscrow(user: string): Promise<boolean> {
  return (await escrowStatus(idbKV, slots(user).map(s => s.prefix), null)) !== 'missing'
}

/** 'missing' (legacy / never set up), 'stale' (password changed since) or 'current'. */
export function getEscrowStatus(user: string): Promise<EscrowStatus> {
  return escrowStatus(idbKV, slots(user).map(s => s.prefix), cachedAuthSalt(user))
}

/**
 * Write (or rewrite) the escrow under `master`. Needs the lock authenticated
 * (the lock layer prompts if the window lapsed): used by Settings for users
 * who enabled the lock before escrow existed, and after a password change.
 */
export async function setupEscrow(user: string, master: CryptoKey): Promise<void> {
  const cfg = getConfig(user)
  if (!cfg || cfg.mode === 'gate') return
  await writeEscrows(idbKV, escrowSlots(user), master, rawKeyOf(user))
}

/** Inside a just-opened auth window: migrate / refresh the escrow if this session knows the password-derived secret. */
async function refreshEscrowInWindow(user: string): Promise<void> {
  try {
    const master = getEscrowSessionMaster(user)
    if (!master) return
    const salt = saltOfMaster(master)
    if (!salt) return
    if ((await escrowStatus(idbKV, slots(user).map(s => s.prefix), salt)) === 'current') return
    await setupEscrow(user, master)
  } catch (err) {
    console.warn('[app-lock] escrow refresh failed', err)   // best effort; Settings shows the gap
  }
}

async function removeAllEscrows(user: string): Promise<void> {
  for (const { prefix } of slots(user)) await removeEscrow(idbKV, prefix)
}

/**
 * Recovery with the Iris password, used when the lock key is invalidated or the
 * user taps "Use password instead". Opens the escrow (rate limited) and restores
 * the storage keys WITHOUT wiping anything:
 *  - Android: the keys are re-wrapped with the plain Keystore key only (the
 *    lock key is dead). Returns 'relock': call relockAfterRecovery() to enrol a
 *    fresh lock key, or abandonAppLock() to keep the lock off.
 *  - Web PRF: the keys go back to plain non-extractable storage keys and the
 *    lock is turned off. Returns 'off'.
 * Throws EscrowWrongPasswordError / EscrowRateLimitedError / EscrowMissingError.
 */
export async function recoverWithPassword(user: string, password: string): Promise<'relock' | 'off'> {
  const wait = escrowRetryIn(user)
  if (wait > 0) throw new EscrowRateLimitedError(wait)
  let raws: Map<string, Uint8Array>
  try {
    raws = await openEscrows(idbKV, escrowSlots(user), password)
  } catch (err) {
    if (err instanceof EscrowWrongPasswordError) {
      const w = recordEscrowFailure(user)
      if (w > 0) throw new EscrowRateLimitedError(w)
    }
    throw err
  }
  recordEscrowSuccess(user)
  try {
    dropAllStorageKeys()
    if (Capacitor.isNativePlatform()) {
      for (const { prefix, alias } of slots(user)) {
        await idbKV.set(prefix + SKW, await plainNativeKeyWrapper(alias)!.wrap(raws.get(prefix)!))
      }
      return 'relock'
    }
    for (const { prefix } of slots(user)) {
      const key = await crypto.subtle.importKey('raw', raws.get(prefix)! as Uint8Array<ArrayBuffer>, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
      await idbKV.set(prefix + 'sk', key)
      await idbKV.del(prefix + SKW)
    }
    await removeAllEscrows(user)
    setConfig(user, null)
    clearWebLockSession()
    return 'off'
  } finally {
    for (const r of raws.values()) r.fill(0)
  }
}

/**
 * Android, after recoverWithPassword: enrol a fresh lock key (biometric
 * prompt) and double-wrap the storage keys again. On failure the blobs stay
 * readable under the Keystore key and the escrow stays, so nothing is lost.
 */
export async function relockAfterRecovery(user: string): Promise<void> {
  await nativeCreateKey(user)
  const done: string[] = []
  try {
    await nativeAuthenticate('Confirm to re-enable app lock')
    const lock = nativeLockLayer(user)
    for (const { prefix, alias } of slots(user)) {
      const blob = await idbKV.get<string>(prefix + SKW)
      if (typeof blob !== 'string' || isLocked(blob)) continue
      await idbKV.set(prefix + SKW, await addLock(blob, plainNativeKeyWrapper(alias)!, lock))
      done.push(prefix)
    }
    dropAllStorageKeys()
    await loadStorageKeys(user)
  } catch (err) {
    try {
      const lock = nativeLockLayer(user)
      for (const { prefix, alias } of slots(user)) {
        if (!done.includes(prefix)) continue
        const blob = await idbKV.get<string>(prefix + SKW)
        if (typeof blob === 'string') await idbKV.set(prefix + SKW, await removeLock(blob, plainNativeKeyWrapper(alias)!, lock))
      }
    } catch (rollbackErr) {
      console.error('[app-lock] relock rollback failed; the password escrow still holds the keys', rollbackErr)
    }
    await nativeDeleteKey(user).catch(() => undefined)
    throw err
  }
}

/** After recoverWithPassword: keep App lock off (biometrics unavailable or declined). Data stays readable. */
export async function abandonAppLock(user: string): Promise<void> {
  for (const { prefix } of slots(user)) {
    const blob = await idbKV.get<string>(prefix + SKW)
    if (typeof blob === 'string' && isLocked(blob)) throw new Error('Storage keys are still locked; recover with the password first')
  }
  await removeAllEscrows(user)
  if (Capacitor.isNativePlatform()) await nativeDeleteKey(user).catch(() => undefined)
  setConfig(user, null)
  engageLock()
}

/**
 * Turn the lock on. Android: create the auth-required key, confirm with a
 * prompt, then double-wrap the existing storage keys. Web: register a platform
 * credential; with PRF, migrate the storage keys to PRF-wrapped ones.
 */
export async function enableAppLock(user: string, timing: LockTiming, escrowMaster: CryptoKey | null = null): Promise<AppLockConfig> {
  if (Capacitor.isNativePlatform()) return enableNative(user, timing, escrowMaster)
  return enableWeb(user, timing, escrowMaster)
}

async function enableNative(user: string, timing: LockTiming, escrowMaster: CryptoKey | null): Promise<AppLockConfig> {
  // Make sure both storage keys exist (single-wrapped) so there is something to escrow and lock.
  await loadStorageKeys(user)
  dropAllStorageKeys()
  await nativeCreateKey(user)
  const done: string[] = []
  try {
    await nativeAuthenticate('Confirm to turn on app lock')
    if (escrowMaster) {
      await writeEscrows(idbKV, escrowSlots(user), escrowMaster, async prefix => {
        const alias = slots(user).find(x => x.prefix === prefix)!.alias
        const blob = await idbKV.get<string>(prefix + SKW)
        return typeof blob === 'string' && !isLocked(blob) ? plainNativeKeyWrapper(alias)!.unwrap(blob) : null
      })
    }
    const cfg: AppLockConfig = { enabled: true, mode: 'native', timing }
    setConfig(user, cfg)   // from here on, newly created keys are double-wrapped too
    const lock = nativeLockLayer(user)
    for (const { prefix, alias } of slots(user)) {
      const base = plainNativeKeyWrapper(alias)!
      const blob = await idbKV.get<string>(prefix + SKW)
      if (typeof blob !== 'string' || isLocked(blob)) continue
      await idbKV.set(prefix + SKW, await addLock(blob, base, lock))
      done.push(prefix)
    }
    return cfg
  } catch (err) {
    // Put everything back the way it was; the lock key may still be authorised.
    try {
      const lock = nativeLockLayer(user)
      for (const { prefix, alias } of slots(user)) {
        if (!done.includes(prefix)) continue
        const blob = await idbKV.get<string>(prefix + SKW)
        if (typeof blob === 'string') await idbKV.set(prefix + SKW, await removeLock(blob, plainNativeKeyWrapper(alias)!, lock))
      }
    } catch (rollbackErr) {
      console.error('[app-lock] rollback failed', rollbackErr)
    }
    setConfig(user, null)
    await removeAllEscrows(user).catch(() => undefined)
    await nativeDeleteKey(user).catch(() => undefined)
    throw err
  }
}

async function enableWeb(user: string, timing: LockTiming, escrowMaster: CryptoKey | null): Promise<AppLockConfig> {
  const reg = await webRegister(user)
  const cfg: AppLockConfig = {
    enabled: true, mode: reg.prf ? 'prf' : 'gate', timing, credId: reg.credId, salt: reg.salt,
  }
  if (cfg.mode === 'gate') {
    setConfig(user, cfg)
    return cfg
  }
  // Config first: if the migration is interrupted, the next unlock finishes it
  // (AtRestCipher's Keystore-style migration is idempotent and crash-safe).
  setConfig(user, cfg)
  await runner(async () => {
    dropAllStorageKeys()
    for (const { prefix, alias } of slots(user)) {
      await new AtRestCipher(idbKV, prefix, nativeKeyWrapper(alias)).getKey()
    }
    dropAllStorageKeys()
    if (escrowMaster) {
      try {
        await writeEscrows(idbKV, escrowSlots(user), escrowMaster, rawKeyOf(user))
      } catch (err) {
        console.warn('[app-lock] could not write the password escrow', err)   // lock works; Settings offers to retry
      }
    }
  })
  return cfg
}

/** Turn the lock off: authenticate once, restore single-wrapped (native) / plain (web) storage keys. */
export async function disableAppLock(user: string): Promise<void> {
  const cfg = getConfig(user)
  if (!cfg) return
  if (cfg.mode === 'gate') {
    await webAuthenticate(cfg)
    setConfig(user, null)
    return
  }
  if (cfg.mode === 'native') {
    await nativeAuthenticate('Confirm to turn off app lock')
    const lock = nativeLockLayer(user)
    for (const { prefix, alias } of slots(user)) {
      const blob = await idbKV.get<string>(prefix + SKW)
      if (typeof blob === 'string' && isLocked(blob)) {
        await idbKV.set(prefix + SKW, await removeLock(blob, plainNativeKeyWrapper(alias)!, lock))
      }
    }
    await removeAllEscrows(user)
    setConfig(user, null)
    await nativeDeleteKey(user).catch(() => undefined)
    return
  }
  // web PRF: put the raw keys back as non-extractable CryptoKeys under the plain 'sk' slot.
  await webAuthenticate(cfg)
  const layer = webPrfLayer(() => cfg)
  await runner(async () => {
    dropAllStorageKeys()
    for (const { prefix } of slots(user)) {
      const blob = await idbKV.get<string>(prefix + SKW)
      if (typeof blob !== 'string') continue
      const raw = await lockUnwrap(blob, null, layer)
      const key = await crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
      raw.fill(0)
      await idbKV.set(prefix + 'sk', key)
      await idbKV.del(prefix + SKW)
    }
    await removeAllEscrows(user)
    setConfig(user, null)
    clearWebLockSession()
  })
}

/**
 * LEGACY "Use password instead", only for accounts without a password escrow
 * (see recoverWithPassword for the normal path): the lock key can't (or won't)
 * be used, so the data it protects is unrecoverable on this device. Destroy it, forget the lock, and
 * sign out; logging in again with the password rebuilds identity and history
 * from the encrypted server backup (the UnlockKeyView / restore flow).
 * Gate mode protects nothing cryptographically, so local data is kept.
 */
export async function passwordFallback(user: string): Promise<void> {
  const cfg = getConfig(user)
  if (cfg && cfg.mode !== 'gate') {
    for (const p of [`sig:${user}:`, `hist:${user}:`, `iris-msgs-v2:${user}:`]) {
      for (const k of await idbKV.keys(p)) await idbKV.del(k)
    }
    for (const { alias } of slots(user)) await plainNativeKeyWrapper(alias)?.reset().catch(() => undefined)
    if (Capacitor.isNativePlatform()) await nativeDeleteKey(user).catch(() => undefined)
  }
  setConfig(user, null)
  engageLock()
  try { localStorage.removeItem('token') } catch { /* ignore */ }
}
