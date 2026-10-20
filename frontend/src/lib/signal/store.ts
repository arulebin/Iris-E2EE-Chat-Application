import type { KeyPairType, SessionRecordType, StorageType } from '@privacyresearch/libsignal-protocol-typescript'
import { fromBase64, toBase64 } from '../../crypto'
import { KeystoreKeyMissingError, nativeKeyWrapper, type KeyWrapper } from '../nativeKeystore'
import type { KV } from './kv'

// Persistent Signal-protocol state for ONE local account on THIS device:
// identity key pair, registration id, signed + one-time prekeys, sessions.
//
// Everything is encrypted at rest under an AES-GCM "storage key":
//  - Web: a non-extractable CryptoKey kept in IndexedDB ('sk'). That doesn't stop
//    a script running in the page (it can ask Web Crypto to decrypt), but raw key
//    material never sits in storage in the clear.
//  - Android app: random key bytes wrapped by a hardware-backed Android Keystore
//    key; only the wrapped blob is stored ('skw'). A copy of IndexedDB taken off
//    the device is useless without that device's Keystore.
// Existing native installs are migrated from 'sk' to 'skw' on first load.

export type DeviceState = {
  deviceId: number
  registrationId: number
  nextPreKeyId: number
  signedPreKeys: { keyId: number; createdAt: number }[]   // newest last
}

/** Fired when a contact's identity key is seen in a session — feeds TOFU pinning. */
export type IdentityListener = (contact: string, identityKey: ArrayBuffer) => void | Promise<void>

const IV_BYTES = 12
const SK = 'sk'     // web: non-extractable CryptoKey (also the pre-Keystore native format)
const SKW = 'skw'   // native: Keystore-wrapped raw key bytes

// One storage-key load per (kv, account), shared by every SignalStore instance:
// two instances racing to create or migrate the key would otherwise each write
// their own and orphan whatever the loser encrypted.
const storageKeys = new WeakMap<KV, Map<string, Promise<CryptoKey>>>()

const importStorageKey = (raw: Uint8Array<ArrayBuffer>) =>
  crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])

async function seal(key: CryptoKey, slot: string, plaintext: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  // AAD binds each ciphertext to its slot, so values can't be swapped between keys.
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

// ── (de)serialisation: JSON with ArrayBuffers as base64 ─────────────

function encode(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v instanceof ArrayBuffer ? { $ab: toBase64(new Uint8Array(v)) }
    : ArrayBuffer.isView(v) ? { $ab: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) }
    : v)
}

function decode<T>(json: string): T {
  return JSON.parse(json, (_k, v) =>
    v && typeof v === 'object' && typeof v.$ab === 'string' ? fromBase64(v.$ab).buffer : v) as T
}

export function bytesEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false
  const x = new Uint8Array(a), y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

/** "alice.3" → "alice" (usernames may themselves contain dots). */
function nameOf(encodedAddress: string): string {
  const i = encodedAddress.lastIndexOf('.')
  return i < 0 ? encodedAddress : encodedAddress.slice(0, i)
}

export class SignalStore implements StorageType {
  readonly me: string
  private readonly kv: KV
  private readonly prefix: string
  private readonly wrapper: KeyWrapper | null
  private identityListener: IdentityListener | null = null

  /**
   * `wrapper` defaults to the Android Keystore in the native app and null (plain
   * non-extractable CryptoKey) elsewhere; tests can inject one.
   */
  constructor(me: string, kv: KV, wrapper: KeyWrapper | null = nativeKeyWrapper(me)) {
    this.me = me
    this.kv = kv
    this.prefix = `sig:${me}:`
    this.wrapper = wrapper
  }

  onIdentity(listener: IdentityListener | null): void {
    this.identityListener = listener
  }

  // ── encrypted at-rest primitives ─────────────────────────────────

  private getStorageKey(): Promise<CryptoKey> {
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
        // good. Start over: the device re-registers (with the password), and
        // history comes back from the encrypted backup.
        console.warn('[signal-store] Keystore key missing; resetting local Signal state')
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
   * Re-encrypt every stored value from the old non-extractable key to the new
   * Keystore-backed one. Idempotent and crash-safe: each value is tried with the
   * new key first (already migrated → skip), rewritten in a single put, and the
   * old key is deleted only after every value has been handled.
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
        // Unreadable under both keys: it was already corrupt. Drop it rather than
        // block the migration (sessions/prekeys re-establish themselves).
        console.warn('[signal-store] dropping unreadable value during Keystore migration', slot, err)
        await this.kv.del(slot)
        continue
      }
      // A failed write propagates: the old key is still there, so the next start resumes.
      await this.kv.set(slot, await seal(newKey, slot, pt))
      pt.fill(0)
    }
    await this.kv.del(this.prefix + SK)
  }

  private async put(name: string, value: unknown): Promise<void> {
    const key = await this.getStorageKey()
    const slot = this.prefix + name
    await this.kv.set(slot, await seal(key, slot, new TextEncoder().encode(encode(value))))
  }

  private async load<T>(name: string): Promise<T | undefined> {
    // Key first: loading it may migrate or reset stored values, so read after.
    const key = await this.getStorageKey()
    const packed = await this.kv.get<Uint8Array>(this.prefix + name)
    if (!packed) return undefined
    const pt = await open(key, this.prefix + name, packed)
    return decode<T>(new TextDecoder().decode(pt))
  }

  private remove(name: string): Promise<void> {
    return this.kv.del(this.prefix + name)
  }

  // ── device / identity (ours) ─────────────────────────────────────

  getDevice(): Promise<DeviceState | undefined> { return this.load<DeviceState>('device') }
  setDevice(d: DeviceState): Promise<void> { return this.put('device', d) }

  setIdentityKeyPair(pair: KeyPairType): Promise<void> { return this.put('identity', pair) }
  getIdentityKeyPair = (): Promise<KeyPairType | undefined> => this.load<KeyPairType>('identity')

  getLocalRegistrationId = async (): Promise<number | undefined> => (await this.getDevice())?.registrationId

  /** Forget everything for this account on this device (device removed / reset). */
  async wipe(): Promise<void> {
    for (const k of await this.kv.keys(this.prefix)) await this.kv.del(k)
    storageKeys.get(this.kv)?.delete(this.prefix)
    // Also destroy the Keystore key, so any copy of the old blobs is dead too.
    await this.wrapper?.reset().catch(err => console.warn('[signal-store] Keystore reset failed', err))
  }

  // ── remote identities ────────────────────────────────────────────

  /**
   * Trust decisions live in the pinning layer (lib/fingerprint), which can warn
   * and block sending; here we only refuse what is never legitimate: a "device of
   * mine" presenting an identity key that isn't my account's.
   */
  isTrustedIdentity = async (identifier: string, identityKey: ArrayBuffer): Promise<boolean> => {
    if (identifier !== this.me) return true
    const mine = await this.getIdentityKeyPair()
    return !!mine && bytesEqual(mine.pubKey, identityKey)
  }

  saveIdentity = async (encodedAddress: string, publicKey: ArrayBuffer): Promise<boolean> => {
    const name = nameOf(encodedAddress)
    if (name === this.me) {
      // The library doesn't await isTrustedIdentity on the receive path, so enforce here (this IS awaited).
      const mine = await this.getIdentityKeyPair()
      if (!mine || !bytesEqual(mine.pubKey, publicKey)) throw new Error('Own device presented a foreign identity key')
      return false
    }
    const prior = await this.load<ArrayBuffer>(`ik:${name}`)
    const changed = !!prior && !bytesEqual(prior, publicKey)
    if (!prior || changed) await this.put(`ik:${name}`, publicKey)
    await this.identityListener?.(name, publicKey)
    return changed
  }

  /** Identity key last seen in a session with `contact`. */
  loadRemoteIdentity(contact: string): Promise<ArrayBuffer | undefined> {
    return this.load<ArrayBuffer>(`ik:${contact}`)
  }

  // ── prekeys ──────────────────────────────────────────────────────

  loadPreKey = (keyId: string | number): Promise<KeyPairType | undefined> => this.load<KeyPairType>(`pk:${keyId}`)
  storePreKey = (keyId: string | number, keyPair: KeyPairType): Promise<void> => this.put(`pk:${keyId}`, keyPair)
  removePreKey = (keyId: string | number): Promise<void> => this.remove(`pk:${keyId}`)

  loadSignedPreKey = (keyId: string | number): Promise<KeyPairType | undefined> => this.load<KeyPairType>(`spk:${keyId}`)
  storeSignedPreKey = (keyId: string | number, keyPair: KeyPairType): Promise<void> => this.put(`spk:${keyId}`, keyPair)
  removeSignedPreKey = (keyId: string | number): Promise<void> => this.remove(`spk:${keyId}`)

  // ── sessions ─────────────────────────────────────────────────────

  loadSession = (encodedAddress: string): Promise<SessionRecordType | undefined> => this.load<SessionRecordType>(`sess:${encodedAddress}`)
  storeSession = (encodedAddress: string, record: SessionRecordType): Promise<void> => this.put(`sess:${encodedAddress}`, record)
  removeSession(encodedAddress: string): Promise<void> { return this.remove(`sess:${encodedAddress}`) }

  /** Drop every session with `contact` and the identity they were built on. */
  async forgetContact(contact: string): Promise<void> {
    const sessionPrefix = `${this.prefix}sess:`
    for (const k of await this.kv.keys(sessionPrefix)) {
      if (nameOf(k.slice(sessionPrefix.length)) === contact) await this.kv.del(k)
    }
    await this.remove(`ik:${contact}`)
  }
}
