import { webcrypto } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPureJsProvider } from '@iris/crypto-conformance/pure-js'
import {
  configureCore,
  createSubtleProvider,
  MemoryKV,
  toBase64,
  fromBase64,
  type CorePlatform,
  type CryptoProvider,
  type KeyWrapper,
  type StorageKey,
  type StorageKeys,
} from '../src/index.ts'

/** Node WebCrypto behind the CryptoProvider interface (what the web app uses). */
export function subtleProvider(): CryptoProvider {
  return createSubtleProvider({
    name: 'node-webcrypto',
    subtle: webcrypto.subtle,
    getRandomValues: a => webcrypto.getRandomValues(a as Uint8Array<ArrayBuffer>),
    gzip: async d => new Uint8Array(gzipSync(d)),
    gunzip: async d => new Uint8Array(gunzipSync(d)),
  })
}

/** @noble + node-forge + fflate: no WebCrypto at all (the React Native fallback). */
export function pureProvider(): CryptoProvider {
  return createPureJsProvider(a => webcrypto.getRandomValues(a as Uint8Array<ArrayBuffer>))
}

export const providers: [string, () => CryptoProvider][] = [
  ['subtle provider', subtleProvider],
  ['pure-js provider', pureProvider],
]

const aesKey = (key: any): StorageKey => ({
  encrypt: async (iv, aad, pt) => new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, pt)),
  decrypt: async (iv, aad, ct) => new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ct)),
})

/**
 * What the web adapter does: storage keys are non-extractable CryptoKeys, and the
 * plain ('sk') format keeps the CryptoKey itself in the KV. Lets Node tests read
 * and write the web's on-disk format.
 */
export function webLikeStorageKeys(): StorageKeys {
  return {
    fromRaw: async raw => aesKey(await webcrypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])),
    plain: {
      load: async (kv, slot) => {
        const k = await kv.get<CryptoKey>(slot)
        return k ? aesKey(k) : undefined
      },
      create: async (kv, slot) => {
        const k = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
        await kv.set(slot, k)
        return aesKey(k)
      },
    },
  }
}

export async function importRawAes(raw: Uint8Array): Promise<any> {
  return webcrypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** Deterministic stand-in for a Keystore: XOR + prefix. Same shape as what produced the fixtures. */
export function fakeWrapper(): KeyWrapper {
  const xor = (b: Uint8Array) => b.map(x => x ^ 0x5a)
  return {
    wrap: async raw => 'W:' + toBase64(xor(raw)),
    unwrap: async s => new Uint8Array(xor(fromBase64(s.slice(2)))),
    reset: async () => {},
  }
}

/** Fresh platform with an in-memory KV; pass overrides for fetch, wrappers, storage keys... */
export function setup(provider: CryptoProvider, overrides: Partial<CorePlatform> = {}): CorePlatform {
  return configureCore({ crypto: provider, kv: new MemoryKV(), storageKeys: webLikeStorageKeys(), ...overrides })
}

// ── fixtures written by the pre-core web code (see fixtures/README in the test) ──

export type Fixtures = Record<string, any>
export const fixtures: Fixtures = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/legacy-web-v1.json', import.meta.url)), 'utf8'),
)

/** Rebuild a KV from a fixture dump ({ $u8: base64 } marks Uint8Array values). */
export async function kvFromDump(dump: Record<string, unknown>): Promise<MemoryKV> {
  const kv = new MemoryKV()
  for (const [k, v] of Object.entries(dump)) {
    const isU8 = v && typeof v === 'object' && '$u8' in (v as object)
    await kv.set(k, isU8 ? fromBase64((v as { $u8: string }).$u8) : v)
  }
  return kv
}
