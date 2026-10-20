/**
 * Async key-value store. Web: IndexedDB (idb-keyval). Mobile: MMKV (synchronous
 * under the hood, wrapped async) or SQLite. Values are JSON-ish data or Uint8Array;
 * adapters must round-trip both.
 */
export interface KV {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  /** Keys starting with `prefix` (all keys when omitted). */
  keys(prefix?: string): Promise<string[]>
}

/**
 * Wraps/unwraps small secrets (the at-rest data key) under a device-bound key that
 * never leaves secure hardware where possible. The wrapped form is a STRING (that
 * is what gets persisted under `<prefix>skw`), so the on-disk format is the same on
 * every platform.
 *  - Android: Keystore (StrongBox when present); iOS: Keychain / Secure Enclave
 *  - web: no wrapper (the storage key is a non-extractable CryptoKey, see atRest.ts)
 * `unwrap` may reject when the user must authenticate (biometric prompt).
 */
export interface KeyWrapper {
  wrap(raw: Uint8Array): Promise<string>
  unwrap(wrapped: string): Promise<Uint8Array>
  /** Destroy the wrapping key: everything wrapped under it becomes unreadable. */
  reset(): Promise<void>
}

/** The Keystore entry is gone (app data cleared, restored to another device): wrapped data is lost. */
export class KeystoreKeyMissingError extends Error {
  constructor(message = 'Keystore key for this alias is missing') {
    super(message)
    this.name = 'KeystoreKeyMissingError'
  }
}

/** In-memory KV for tests and ephemeral sessions. */
export class MemoryKV implements KV {
  private m = new Map<string, unknown>()
  async get<T>(key: string) {
    return this.m.get(key) as T | undefined
  }
  async set(key: string, value: unknown) {
    this.m.set(key, value)
  }
  async delete(key: string) {
    this.m.delete(key)
  }
  async keys(prefix = '') {
    return [...this.m.keys()].filter(k => k.startsWith(prefix))
  }
}

/**
 * Small SYNCHRONOUS string store for flags and session tokens (web: localStorage,
 * RN: MMKV). Implementations may throw (storage blocked); callers handle it.
 */
export interface SyncStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export class MemorySyncStore implements SyncStore {
  private m = new Map<string, string>()
  getItem(key: string) {
    return this.m.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.m.set(key, String(value))
  }
  removeItem(key: string) {
    this.m.delete(key)
  }
}

/**
 * Named exclusive lock (the shape of the Web Locks API's `request`). Web passes
 * `navigator.locks` (also serialises across tabs); RN / tests use `createMutex()`.
 */
export interface LockManagerLike {
  request<T>(name: string, fn: () => Promise<T>): Promise<T>
}

/** In-process named mutex: callers with the same name run one at a time, in order. */
export function createMutex(): LockManagerLike {
  const chains = new Map<string, Promise<unknown>>()
  return {
    request<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const run = (chains.get(name) ?? Promise.resolve()).then(fn, fn)
      const settled = run.catch(() => undefined)
      chains.set(name, settled)
      void settled.then(() => {
        if (chains.get(name) === settled) chains.delete(name)
      })
      return run
    },
  }
}
