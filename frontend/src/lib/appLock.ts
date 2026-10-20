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
  // Eagerly unwrap both keys inside the freshly opened auth window. The stores
  // share these cached keys, so nothing will need a second prompt later.
  for (const { prefix, alias } of slots(user)) {
    await new AtRestCipher(idbKV, prefix, nativeKeyWrapper(alias)).getKey()
  }
}

/**
 * Turn the lock on. Android: create the auth-required key, confirm with a
 * prompt, then double-wrap the existing storage keys. Web: register a platform
 * credential; with PRF, migrate the storage keys to PRF-wrapped ones.
 */
export async function enableAppLock(user: string, timing: LockTiming): Promise<AppLockConfig> {
  if (Capacitor.isNativePlatform()) return enableNative(user, timing)
  return enableWeb(user, timing)
}

async function enableNative(user: string, timing: LockTiming): Promise<AppLockConfig> {
  await nativeCreateKey(user)
  const done: string[] = []
  try {
    await nativeAuthenticate('Confirm to turn on app lock')
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
    await nativeDeleteKey(user).catch(() => undefined)
    throw err
  }
}

async function enableWeb(user: string, timing: LockTiming): Promise<AppLockConfig> {
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
    setConfig(user, null)
    clearWebLockSession()
  })
}

/**
 * "Use password instead": the lock key can't (or won't) be used, so the data it
 * protects is unrecoverable on this device. Destroy it, forget the lock, and
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
