import {
  createBytesKeyring,
  createBytesStorageKeys,
  createJwkRsaCache,
  type MasterKeyring,
  type RsaKeyCache,
  type StorageKeys,
} from './crypto/keys.ts'
import type { CryptoProvider } from './crypto/provider.ts'
import { MemoryKV, MemorySyncStore, type KeyWrapper, type KV, type LockManagerLike, type SyncStore } from './storage.ts'

/**
 * Everything platform-specific the shared logic needs, injected once at startup with
 * `configureCore`. Core code never touches DOM / IndexedDB / localStorage / Capacitor.
 *
 *  web (frontend/src/lib/corePlatform.ts)       RN (phase 3)
 *  crypto      WebCrypto via createSubtleProvider   quick-crypto (+ pure-JS gaps)
 *  kv          idb-keyval                           MMKV / SQLite
 *  flags       localStorage                         MMKV
 *  getLocks    navigator.locks                      createMutex()
 *  keyWrapperFor  Android Keystore (+App lock)      Keystore / Keychain
 *  masterKeys / storageKeys / rsaKeys  non-extractable CryptoKeys in IndexedDB
 */
export type CorePlatform = {
  crypto: CryptoProvider
  /** Backend origin, '' for same-origin relative URLs. */
  apiBase: string
  /** fetch() for authenticated API calls: attaches the freshest token, refreshes once on 401. */
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>
  /** Plain fetch for unauthenticated endpoints; looked up per call so test stubs work. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  /** Persist a new session (access + refresh token). */
  setSession: (token: string, refreshToken?: string | null) => void
  /** Default KV for device state (Signal store, history, pins, backup flags). */
  kv: KV
  /** Small synchronous flags (downgrade guards). */
  flags: SyncStore
  /** Exclusive named locks; null = none (callers then run unserialised or chain in-process). */
  getLocks: () => LockManagerLike | null
  /** At-rest wrapper for a local account alias (`alice`, `alice#history`), or null. */
  keyWrapperFor: (alias: string) => KeyWrapper | null
  masterKeys: MasterKeyring
  storageKeys: StorageKeys
  rsaKeys: RsaKeyCache
  /** Human label for this device, shown in the device list. */
  deviceLabel: () => string
}

let current: CorePlatform | null = null

/** Merge `overrides` over the defaults (in-memory KV/flags, bytes-based key seams) and install. */
export function configureCore(overrides: Partial<CorePlatform> & Pick<CorePlatform, 'crypto'>): CorePlatform {
  const crypto = overrides.crypto
  const kv = overrides.kv ?? new MemoryKV()
  const platform: CorePlatform = {
    apiBase: '',
    apiFetch: (url, init) => fetch(url, init),
    fetch: (url, init) => fetch(url, init),
    setSession: () => {},
    flags: new MemorySyncStore(),
    getLocks: () => null,
    keyWrapperFor: () => null,
    masterKeys: createBytesKeyring(crypto),
    storageKeys: createBytesStorageKeys(crypto),
    rsaKeys: createJwkRsaCache(crypto, () => platform.kv),
    deviceLabel: () => 'Device',
    ...overrides,
    kv,
  }
  current = platform
  return platform
}

export function getPlatform(): CorePlatform {
  if (!current) throw new Error('@iris/core is not configured: call configureCore() at startup')
  return current
}

export const isConfigured = (): boolean => current !== null
