import type { CryptoProvider } from './provider.ts'

/**
 * A WebCrypto-shaped object for libsignal-protocol-typescript's `setWebCrypto`,
 * backed by a CryptoProvider. libsignal only needs: getRandomValues, SHA-512
 * digest, HMAC-SHA-256 sign, AES-CBC encrypt/decrypt (raw keys). On React Native
 * this lets libsignal use native code where available and @noble otherwise,
 * without relying on a global `crypto.subtle` being installed.
 *
 *   import { setWebCrypto } from '@privacyresearch/libsignal-protocol-typescript'
 *   setWebCrypto(createLibsignalWebCrypto(provider) as unknown as Crypto)
 */
type RawKey = { raw: Uint8Array; algorithm: { name: string; hash?: { name: string } | string } }

const view = (d: ArrayBuffer | ArrayBufferView): Uint8Array =>
  d instanceof Uint8Array ? d : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d)
const out = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
const hashName = (a: unknown): 'SHA-256' | 'SHA-512' => {
  const n = typeof a === 'string' ? a : (a as { name: string }).name
  if (n === 'SHA-256' || n === 'SHA-512') return n
  throw new Error(`libsignal shim: unsupported hash ${n}`)
}

export function createLibsignalWebCrypto(p: CryptoProvider) {
  return {
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      const v = view(array as unknown as ArrayBufferView)
      v.set(p.randomBytes(v.length))
      return array
    },
    subtle: {
      async importKey(format: string, key: ArrayBuffer | ArrayBufferView, algorithm: { name: string; hash?: unknown }): Promise<RawKey> {
        if (format !== 'raw') throw new Error('libsignal shim: only raw keys')
        return { raw: view(key).slice(), algorithm: algorithm as RawKey['algorithm'] }
      },
      async digest(alg: unknown, data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer> {
        return out(await p.digest(hashName(alg), view(data)))
      },
      async sign(alg: unknown, key: RawKey, data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer> {
        const h = hashName(key.algorithm.hash ?? (alg as { hash?: unknown }).hash)
        return out(await p.hmac(h, key.raw, view(data)))
      },
      async encrypt(alg: { name: string; iv: ArrayBuffer | ArrayBufferView }, key: RawKey, data: ArrayBuffer | ArrayBufferView) {
        if (alg.name !== 'AES-CBC') throw new Error(`libsignal shim: unsupported ${alg.name}`)
        return out(await p.aesCbcEncrypt(key.raw, view(alg.iv), view(data)))
      },
      async decrypt(alg: { name: string; iv: ArrayBuffer | ArrayBufferView }, key: RawKey, data: ArrayBuffer | ArrayBufferView) {
        if (alg.name !== 'AES-CBC') throw new Error(`libsignal shim: unsupported ${alg.name}`)
        return out(await p.aesCbcDecrypt(key.raw, view(alg.iv), view(data)))
      },
    },
  }
}
