import type { KeyPairType, SessionRecordType, StorageType } from '@privacyresearch/libsignal-protocol-typescript'
import { fromBase64, toBase64 } from '../../crypto'
import type { KV } from './kv'

// Persistent Signal-protocol state for ONE local account on THIS device:
// identity key pair, registration id, signed + one-time prekeys, sessions.
//
// Everything is encrypted at rest under a non-extractable AES-GCM "storage key"
// that also lives in IndexedDB. That doesn't stop a script running in the page
// (it can ask Web Crypto to decrypt), but raw key material never sits in storage
// in the clear, and swapping the storage-key provider (e.g. for an Android
// Keystore-backed one) is a one-place change.

export type DeviceState = {
  deviceId: number
  registrationId: number
  nextPreKeyId: number
  signedPreKeys: { keyId: number; createdAt: number }[]   // newest last
}

/** Fired when a contact's identity key is seen in a session — feeds TOFU pinning. */
export type IdentityListener = (contact: string, identityKey: ArrayBuffer) => void | Promise<void>

const IV_BYTES = 12

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
  private storageKey: Promise<CryptoKey> | null = null
  private identityListener: IdentityListener | null = null

  constructor(me: string, kv: KV) {
    this.me = me
    this.kv = kv
    this.prefix = `sig:${me}:`
  }

  onIdentity(listener: IdentityListener | null): void {
    this.identityListener = listener
  }

  // ── encrypted at-rest primitives ─────────────────────────────────

  private getStorageKey(): Promise<CryptoKey> {
    this.storageKey ??= (async () => {
      const existing = await this.kv.get<CryptoKey>(this.prefix + 'sk')
      if (existing) return existing
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      await this.kv.set(this.prefix + 'sk', key)
      return key
    })()
    return this.storageKey
  }

  private async put(name: string, value: unknown): Promise<void> {
    const key = await this.getStorageKey()
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    // AAD binds each ciphertext to its slot, so values can't be swapped between keys.
    const ad = new TextEncoder().encode(this.prefix + name)
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ad }, key, new TextEncoder().encode(encode(value)))
    const packed = new Uint8Array(IV_BYTES + ct.byteLength)
    packed.set(iv, 0)
    packed.set(new Uint8Array(ct), IV_BYTES)
    await this.kv.set(this.prefix + name, packed)
  }

  private async load<T>(name: string): Promise<T | undefined> {
    const packed = await this.kv.get<Uint8Array>(this.prefix + name)
    if (!packed) return undefined
    const key = await this.getStorageKey()
    const ad = new TextEncoder().encode(this.prefix + name)
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: packed.slice(0, IV_BYTES), additionalData: ad }, key, packed.slice(IV_BYTES),
    )
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
    this.storageKey = null
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
