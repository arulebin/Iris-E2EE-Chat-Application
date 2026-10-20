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
 * Wraps/unwraps small secrets (the at-rest data key, the legacy RSA private key)
 * under a device-bound key that never leaves secure hardware where possible.
 *  - web: AES-GCM CryptoKey generated non-extractable, persisted in IndexedDB
 *  - Android: Keystore (StrongBox when present); iOS: Keychain / Secure Enclave
 * `unwrap` may reject when the user must authenticate (biometric prompt).
 */
export interface KeyWrapper {
  readonly name: string
  wrap(plaintext: Uint8Array): Promise<Uint8Array>
  unwrap(wrapped: Uint8Array): Promise<Uint8Array>
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
