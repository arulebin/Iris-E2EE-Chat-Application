import { KeystoreKeyMissingError, type KeyWrapper } from './nativeKeystore'
import type { KV } from './signal/kv'

// AES-GCM encryption at rest for locally persisted secrets (Signal state, message
// history). One "storage key" per (KV, prefix):
//  - Web: a non-extractable CryptoKey kept in IndexedDB ('<prefix>sk'). That
//    doesn't stop a script running in the page (it can ask Web Crypto to
//    decrypt), but raw key material never sits in storage in the clear.
//  - Android app: random key bytes wrapped by a hardware-backed Android Keystore
//    key; only the wrapped blob is stored ('<prefix>skw'). A copy of IndexedDB
//    taken off the device is useless without that device's Keystore.
// Each ciphertext is bound to its storage slot (AAD), so values can't be swapped
// between keys. Existing native installs are migrated from 'sk' to 'skw'.

const IV_BYTES = 12
const SK = 'sk'     // web: non-extractable CryptoKey (also the pre-Keystore native format)
const SKW = 'skw'   // native: Keystore-wrapped raw key bytes

// One key load per (kv, prefix), shared by every cipher instance: two instances
// racing to create or migrate the key would otherwise each write their own and
// orphan whatever the loser encrypted.
const storageKeys = new WeakMap<KV, Map<string, Promise<CryptoKey>>>()

const importStorageKey = (raw: Uint8Array<ArrayBuffer>) =>
  crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])

async function seal(key: CryptoKey, slot: string, plaintext: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ad = new TextEncoder().encode(slot)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ad }, key, plaintext)
  const packed = new Uint8Array(IV_BYTES + ct.byteLength)
  packed.set(iv, 0)
  packed.set(new Uint8Array(ct), IV_BYTES)
  return packed
}

function open(key: CryptoKey, slot: string, packed: Uint8Array): Promise<ArrayBuffer> {
  const ad = new TextEncoder().encode(slot)
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: packed.slice(0, IV_BYTES), additionalData: ad }, key, packed.slice(IV_BYTES),
  )
}

export class AtRestCipher {
  private readonly kv: KV
  /** Key slots live at `${prefix}sk` / `${prefix}skw`; migration and resets scan this prefix. */
  private readonly prefix: string
  private readonly wrapper: KeyWrapper | null

  constructor(kv: KV, prefix: string, wrapper: KeyWrapper | null) {
    this.kv = kv
    this.prefix = prefix
    this.wrapper = wrapper
  }

  getKey(): Promise<CryptoKey> {
    let perKv = storageKeys.get(this.kv)
    if (!perKv) storageKeys.set(this.kv, (perKv = new Map()))
    let pending = perKv.get(this.prefix)
    if (!pending) {
      pending = this.wrapper ? this.loadWrappedKey(this.wrapper) : this.loadPlainKey()
      // Don't cache a failure (e.g. a transient Keystore error) — let the next call retry.
      pending.catch(() => perKv.delete(this.prefix))
      perKv.set(this.prefix, pending)
    }
    return pending
  }

  /** Encrypt `plaintext` for storage at `slot` (the AAD). */
  async seal(slot: string, plaintext: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    return seal(await this.getKey(), slot, plaintext)
  }

  /** Decrypt a value stored at `slot`; rejects if it wasn't sealed for that slot under this key. */
  async open(slot: string, packed: Uint8Array): Promise<ArrayBuffer> {
    return open(await this.getKey(), slot, packed)
  }

  /** Forget the cached key (after its slots were deleted), so the next use creates a fresh one. */
  forget(): void {
    storageKeys.get(this.kv)?.delete(this.prefix)
  }

  /** Destroy the Keystore wrapping key too, so any copy of the old blobs is dead. */
  async resetWrapper(): Promise<void> {
    await this.wrapper?.reset().catch(err => console.warn('[at-rest] Keystore reset failed', err))
  }

  /** Web: a non-extractable key stored as-is in IndexedDB. */
  private async loadPlainKey(): Promise<CryptoKey> {
    const existing = await this.kv.get<CryptoKey>(this.prefix + SK)
    if (existing) return existing
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await this.kv.set(this.prefix + SK, key)
    return key
  }

  /** Native: raw key bytes wrapped by the Keystore; migrates a pre-Keystore 'sk' if present. */
  private async loadWrappedKey(wrapper: KeyWrapper): Promise<CryptoKey> {
    let key: CryptoKey | null = null
    const wrapped = await this.kv.get<string>(this.prefix + SKW)
    if (wrapped) {
      try {
        const raw = await wrapper.unwrap(wrapped)
        key = await importStorageKey(new Uint8Array(raw))
        raw.fill(0)
      } catch (err) {
        if (!(err instanceof KeystoreKeyMissingError)) throw err
        // The Keystore entry is gone, so everything under it is unreadable for
        // good. Start over under a fresh key.
        console.warn('[at-rest] Keystore key missing; resetting', this.prefix)
        for (const k of await this.kv.keys(this.prefix)) await this.kv.del(k)
      }
    }
    if (!key) {
      const raw = crypto.getRandomValues(new Uint8Array(32))
      const blob = await wrapper.wrap(raw)
      key = await importStorageKey(raw)
      raw.fill(0)
      // Written BEFORE migrating, so a crash mid-migration resumes with this same key.
      await this.kv.set(this.prefix + SKW, blob)
    }

    const legacy = await this.kv.get<CryptoKey>(this.prefix + SK)
    if (legacy) await this.migrateFrom(legacy, key)
    return key
  }

  /**
   * Re-encrypt every value under the prefix from the old non-extractable key to
   * the new Keystore-backed one. Idempotent and crash-safe: each value is tried
   * with the new key first (already migrated → skip), rewritten in a single put,
   * and the old key is deleted only after every value has been handled.
   */
  private async migrateFrom(oldKey: CryptoKey, newKey: CryptoKey): Promise<void> {
    for (const slot of await this.kv.keys(this.prefix)) {
      if (slot === this.prefix + SK || slot === this.prefix + SKW) continue
      const packed = await this.kv.get<Uint8Array>(slot)
      if (!(packed instanceof Uint8Array)) continue
      try {
        await open(newKey, slot, packed)
        continue  // already migrated on an earlier, interrupted run
      } catch { /* not under the new key yet */ }
      let pt: Uint8Array<ArrayBuffer>
      try {
        pt = new Uint8Array(await open(oldKey, slot, packed))
      } catch (err) {
        // Unreadable under both keys: it was already corrupt. Drop it rather than block the migration.
        console.warn('[at-rest] dropping unreadable value during Keystore migration', slot, err)
        await this.kv.del(slot)
        continue
      }
      // A failed write propagates: the old key is still there, so the next start resumes.
      await this.kv.set(slot, await seal(newKey, slot, pt))
      pt.fill(0)
    }
    await this.kv.del(this.prefix + SK)
  }
}
