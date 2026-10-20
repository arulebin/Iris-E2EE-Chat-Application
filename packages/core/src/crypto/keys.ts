import type { KV } from '../storage.ts'
import { fromBase64, toBase64 } from './bytes.ts'
import type { Bytes, CryptoProvider, RsaJwk } from './provider.ts'
import { gcmOpen } from './util.ts'

/**
 * Key-material seams. On the web these are backed by non-extractable CryptoKeys
 * (some of them persisted in IndexedDB by structured clone, which is why they are
 * interfaces rather than bytes); the defaults here keep bytes in memory and are what
 * Node tests and React Native start from.
 */

// ── master / HKDF keys ────────────────────────────────────────────────

/** A secret that can only be used to derive other bytes (login master secret, recovery key). */
export interface MasterKey {
  hkdf(salt: Bytes, info: Bytes, lengthBytes: number): Promise<Bytes>
}

/** Creates MasterKeys and persists them (web: CryptoKey in IndexedDB; format is the adapter's own). */
export interface MasterKeyring {
  create(raw: Bytes): Promise<MasterKey>
  save(kv: KV, slot: string, key: MasterKey): Promise<void>
  load(kv: KV, slot: string): Promise<MasterKey | undefined>
}

class BytesMasterKey implements MasterKey {
  readonly raw: Bytes
  private readonly p: CryptoProvider
  constructor(p: CryptoProvider, raw: Bytes) {
    this.p = p
    this.raw = raw.slice()
  }
  hkdf(salt: Bytes, info: Bytes, len: number) {
    return this.p.hkdf('SHA-256', this.raw, salt, info, len)
  }
}

/**
 * Default keyring: key bytes live in memory; `save` stores them as base64 in the KV.
 * That is NOT hardware-protected - a mobile adapter should supply a keyring that wraps
 * them (Keystore / Keychain) before persisting.
 */
export function createBytesKeyring(p: CryptoProvider): MasterKeyring {
  return {
    create: async raw => new BytesMasterKey(p, raw),
    save: async (kv, slot, key) => {
      if (!(key instanceof BytesMasterKey)) throw new Error('This keyring cannot store that key')
      await kv.set(slot, toBase64(key.raw))
    },
    load: async (kv, slot) => {
      const v = await kv.get<unknown>(slot)
      return typeof v === 'string' ? new BytesMasterKey(p, fromBase64(v)) : undefined
    },
  }
}

// ── at-rest storage keys ──────────────────────────────────────────────

/** An AES-256-GCM key for at-rest blobs (web: a non-extractable CryptoKey). */
export interface StorageKey {
  encrypt(iv: Bytes, aad: Bytes, plaintext: Bytes): Promise<Bytes>
  decrypt(iv: Bytes, aad: Bytes, ciphertext: Bytes): Promise<Bytes>
}

/** Web-only 'sk' format: the storage key itself kept in the KV (as a non-extractable CryptoKey). */
export interface PlainKeyStore {
  load(kv: KV, slot: string): Promise<StorageKey | undefined>
  create(kv: KV, slot: string): Promise<StorageKey>
}

export interface StorageKeys {
  /** Import raw key bytes (Keystore-unwrapped) as a storage key. The adapter decides how long the bytes live. */
  fromRaw(raw: Bytes): Promise<StorageKey>
  /** The key-in-the-KV format. Absent where every storage key is wrapped (mobile). */
  plain?: PlainKeyStore
}

export function createBytesStorageKeys(p: CryptoProvider): StorageKeys {
  return {
    fromRaw: async raw => {
      const key = raw.slice()
      return {
        encrypt: (iv, aad, pt) => p.aesGcmEncrypt(key, iv, pt, aad),
        decrypt: (iv, aad, ct) => gcmOpen(p, key, iv, ct, aad),
      }
    },
  }
}

// ── legacy RSA (v1) key cache ─────────────────────────────────────────

export type RsaPublicKey = { encrypt(plaintext: Bytes): Promise<Bytes> }
export type RsaPrivateKey = { decrypt(ciphertext: Bytes): Promise<Bytes> }

export function rsaPublicFromJwk(p: CryptoProvider, jwk: RsaJwk): RsaPublicKey {
  return { encrypt: pt => p.rsaOaepEncrypt(jwk, pt) }
}

export function rsaPrivateFromJwk(p: CryptoProvider, jwk: RsaJwk): RsaPrivateKey {
  return { decrypt: ct => p.rsaOaepDecrypt(jwk, ct) }
}

/** This device's copy of the account's legacy RSA pair (web: non-extractable CryptoKey + public JWK in IndexedDB). */
export interface RsaKeyCache {
  /** Both halves cached, else null. May upgrade older cache formats on sight. */
  load(username: string): Promise<{ privateKey: RsaPrivateKey; publicJwk: RsaJwk } | null>
  /** Cache the pair and return a usable private handle. A failure to persist the private half is non-fatal. */
  save(username: string, privateJwk: RsaJwk, publicJwk: RsaJwk): Promise<RsaPrivateKey>
  loadPublicJwk(username: string): Promise<RsaJwk | undefined>
}

const privSlot = (u: string) => `iris-private-key-${u}`
const pubSlot = (u: string) => `iris-public-key-${u}`

/** Default cache: both JWKs in the KV. Mobile should wrap the private half; see MasterKeyring note. */
export function createJwkRsaCache(p: CryptoProvider, kv: () => KV): RsaKeyCache {
  return {
    async load(u) {
      const priv = await kv().get<RsaJwk>(privSlot(u))
      const pub = await kv().get<RsaJwk>(pubSlot(u))
      return priv && pub ? { privateKey: rsaPrivateFromJwk(p, priv), publicJwk: pub } : null
    },
    async save(u, privateJwk, publicJwk) {
      try {
        await kv().set(privSlot(u), privateJwk)
      } catch (err) {
        console.warn('Could not persist private key; it will be kept in memory only', err)
      }
      await kv().set(pubSlot(u), publicJwk)
      return rsaPrivateFromJwk(p, privateJwk)
    },
    loadPublicJwk: u => kv().get<RsaJwk>(pubSlot(u)),
  }
}
