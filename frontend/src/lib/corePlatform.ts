import {
  configureCore,
  createSubtleProvider,
  type MasterKey,
  type MasterKeyring,
  type RsaJwk,
  type RsaKeyCache,
  type RsaPrivateKey,
  type StorageKey,
  type StorageKeys,
} from '@iris/core'
import { apiBase } from './config'
import { apiFetch, setSession } from './api'
import { nativeKeyWrapper } from './nativeKeystore'
import { idbKV } from './signal/kv'

// The web app's implementation of @iris/core's platform seams (see core/platform.ts).
// Every shared module in frontend/src imports this first, so core is configured no
// matter which entry point loads. Nothing here runs at import time except the
// configureCore call itself; the adapters only touch browser globals when used.
//
// Security properties kept from the pre-core code: the login master secret, the
// backup recovery key, the at-rest storage keys and the legacy RSA private key are
// all NON-EXTRACTABLE CryptoKeys; where they were persisted (IndexedDB structured
// clone) they still are, in the same slots and formats.

const subtle = (): SubtleCrypto => crypto.subtle

// ── CompressionStream gzip (backups) ───────────────────────────────

async function pipe(data: Uint8Array, stream: { writable: WritableStream<BufferSource>; readable: ReadableStream<Uint8Array> }) {
  const out = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream as never)
  return new Uint8Array(await new Response(out as ReadableStream<Uint8Array>).arrayBuffer())
}
const gzip = typeof CompressionStream !== 'undefined'
  ? (d: Uint8Array) => pipe(d, new CompressionStream('gzip'))
  : undefined
const gunzip = typeof DecompressionStream !== 'undefined'
  ? (d: Uint8Array) => pipe(d, new DecompressionStream('gzip'))
  : undefined

// ── master / HKDF keys: non-extractable CryptoKey, persisted by structured clone ──

class WebMasterKey implements MasterKey {
  readonly key: CryptoKey
  constructor(key: CryptoKey) { this.key = key }
  async hkdf(salt: Uint8Array, info: Uint8Array, lengthBytes: number) {
    const bits = await subtle().deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, info: info as Uint8Array<ArrayBuffer> },
      this.key, lengthBytes * 8,
    )
    return new Uint8Array(bits)
  }
}

const masterKeys: MasterKeyring = {
  create: async raw => new WebMasterKey(
    await subtle().importKey('raw', raw as Uint8Array<ArrayBuffer>, 'HKDF', false, ['deriveBits', 'deriveKey']),
  ),
  save: async (kv, slot, key) => {
    if (!(key instanceof WebMasterKey)) throw new Error('Unexpected master key type')
    await kv.set(slot, key.key)
  },
  load: async (kv, slot) => {
    const v = await kv.get<unknown>(slot)
    return v instanceof CryptoKey ? new WebMasterKey(v) : undefined
  },
}

// ── at-rest storage keys ───────────────────────────────────────────

const aesKey = (key: CryptoKey): StorageKey => ({
  encrypt: async (iv, aad, pt) => new Uint8Array(await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer>, additionalData: aad as Uint8Array<ArrayBuffer> }, key, pt as Uint8Array<ArrayBuffer>)),
  decrypt: async (iv, aad, ct) => new Uint8Array(await subtle().decrypt(
    { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer>, additionalData: aad as Uint8Array<ArrayBuffer> }, key, ct as Uint8Array<ArrayBuffer>)),
})

const storageKeys: StorageKeys = {
  fromRaw: async raw => aesKey(
    await subtle().importKey('raw', raw as Uint8Array<ArrayBuffer>, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),
  ),
  plain: {
    load: async (kv, slot) => {
      const existing = await kv.get<CryptoKey>(slot)
      return existing ? aesKey(existing) : undefined
    },
    create: async (kv, slot) => {
      const key = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      await kv.set(slot, key)
      return aesKey(key)
    },
  },
}

// ── legacy RSA pair: non-extractable private CryptoKey + public JWK in IndexedDB ──

const RSA_PARAMS: RsaHashedImportParams = { name: 'RSA-OAEP', hash: 'SHA-256' }
const privSlot = (u: string) => `iris-private-key-${u}`
const pubSlot = (u: string) => `iris-public-key-${u}`

const rsaPrivate = (key: CryptoKey): RsaPrivateKey => ({
  decrypt: async ct => new Uint8Array(await subtle().decrypt({ name: 'RSA-OAEP' }, key, ct as Uint8Array<ArrayBuffer>)),
})

/**
 * Import the private JWK as a NON-extractable CryptoKey and cache that in IDB.
 * IndexedDB structured-clones CryptoKeys, so the raw key material never sits in
 * storage where an injected script could read it — it can only ask Web Crypto to
 * decrypt while the page is open. If the browser refuses to store the key, the
 * session still works from memory; the user just unlocks again next launch.
 */
async function cachePrivateKey(dbKey: string, jwk: JsonWebKey): Promise<CryptoKey> {
  const key = await subtle().importKey('jwk', jwk, RSA_PARAMS, false, ['decrypt'])
  try {
    await idbKV.set(dbKey, key)
  } catch (err) {
    console.warn('Could not persist private key; it will be kept in memory only', err)
  }
  return key
}

const rsaKeys: RsaKeyCache = {
  async load(u) {
    // Older builds cached the private key as a plain JWK; convert those to a
    // non-extractable CryptoKey (overwriting the JWK) on sight.
    const existingPriv = await idbKV.get<CryptoKey | JsonWebKey>(privSlot(u))
    const existingPub = await idbKV.get<RsaJwk>(pubSlot(u))
    if (!(existingPriv && existingPub)) return null
    const key = existingPriv instanceof CryptoKey ? existingPriv : await cachePrivateKey(privSlot(u), existingPriv)
    return { privateKey: rsaPrivate(key), publicJwk: existingPub }
  },
  async save(u, privateJwk, publicJwk) {
    const key = await cachePrivateKey(privSlot(u), privateJwk as JsonWebKey)
    await idbKV.set(pubSlot(u), publicJwk)
    return rsaPrivate(key)
  },
  loadPublicJwk: u => idbKV.get<RsaJwk>(pubSlot(u)),
}

// ── device label ───────────────────────────────────────────────────

function deviceLabel(): string {
  const ua = navigator.userAgent
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Device'
  const app = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return `${app} on ${os}`
}

configureCore({
  crypto: createSubtleProvider({
    name: 'webcrypto',
    subtle: crypto.subtle,
    getRandomValues: a => crypto.getRandomValues(a as Uint8Array<ArrayBuffer>),
    gzip,
    gunzip,
  }),
  apiBase,
  apiFetch,
  fetch: (url, init) => fetch(url, init),
  setSession,
  kv: idbKV,
  flags: {
    getItem: k => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v),
    removeItem: k => localStorage.removeItem(k),
  },
  getLocks: () => (typeof navigator !== 'undefined' ? navigator.locks ?? null : null),
  keyWrapperFor: alias => nativeKeyWrapper(alias),
  masterKeys,
  storageKeys,
  rsaKeys,
  deviceLabel,
})
