import type { Bytes, CryptoProvider, HashName, RsaJwk } from './provider.ts'

/** Minimal structural view of SubtleCrypto so this works with WebCrypto, Node and quick-crypto. */
export type SubtleLike = {
  digest(alg: any, data: any): Promise<ArrayBuffer>
  importKey(format: any, keyData: any, alg: any, extractable: boolean, usages: any[]): Promise<any>
  deriveBits(alg: any, key: any, length: number): Promise<ArrayBuffer>
  encrypt(alg: any, key: any, data: any): Promise<ArrayBuffer>
  decrypt(alg: any, key: any, data: any): Promise<ArrayBuffer>
  sign(alg: any, key: any, data: any): Promise<ArrayBuffer>
  verify(alg: any, key: any, sig: any, data: any): Promise<boolean>
}

export type SubtleProviderOptions = {
  name: string
  subtle: SubtleLike
  getRandomValues: (a: Uint8Array) => Uint8Array
  /** Supply when the platform lacks CompressionStream (e.g. Hermes). */
  gzip?: (d: Bytes) => Promise<Bytes>
  gunzip?: (d: Bytes) => Promise<Bytes>
}

const u8 = (b: ArrayBuffer): Bytes => new Uint8Array(b)
const stripRsa = (j: RsaJwk, priv: boolean) => {
  const { kty, n, e, d, p, q, dp, dq, qi } = j
  return priv ? { kty, n, e, d, p, q, dp, dq, qi } : { kty, n, e }
}

/** CryptoProvider over any WebCrypto-shaped `subtle`. */
export function createSubtleProvider(o: SubtleProviderOptions): CryptoProvider {
  const { subtle } = o
  const aes = (name: 'AES-GCM' | 'AES-CBC', key: Bytes, usage: 'encrypt' | 'decrypt') =>
    subtle.importKey('raw', key, { name }, false, [usage])
  const rsa = (alg: 'RSA-OAEP' | 'RSA-PSS', jwk: RsaJwk, usage: string, priv: boolean) =>
    subtle.importKey('jwk', stripRsa(jwk, priv), { name: alg, hash: 'SHA-256' }, false, [usage])
  const gcm = (iv: Bytes, aad?: Bytes) => ({ name: 'AES-GCM', iv, ...(aad ? { additionalData: aad } : {}) })

  return {
    name: o.name,
    randomBytes: n => o.getRandomValues(new Uint8Array(n)),
    digest: async (h, d) => u8(await subtle.digest(h, d)),
    hmac: async (h: HashName, key, data) => {
      const k = await subtle.importKey('raw', key, { name: 'HMAC', hash: h }, false, ['sign'])
      return u8(await subtle.sign('HMAC', k, data))
    },
    hkdf: async (h, ikm, salt, info, len) => {
      const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
      return u8(await subtle.deriveBits({ name: 'HKDF', hash: h, salt, info }, k, len * 8))
    },
    pbkdf2: async (h, pw, salt, iterations, len) => {
      const k = await subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits'])
      return u8(await subtle.deriveBits({ name: 'PBKDF2', hash: h, salt, iterations }, k, len * 8))
    },
    aesGcmEncrypt: async (key, iv, pt, aad) => u8(await subtle.encrypt(gcm(iv, aad), await aes('AES-GCM', key, 'encrypt'), pt)),
    aesGcmDecrypt: async (key, iv, ct, aad) => u8(await subtle.decrypt(gcm(iv, aad), await aes('AES-GCM', key, 'decrypt'), ct)),
    aesCbcEncrypt: async (key, iv, pt) => u8(await subtle.encrypt({ name: 'AES-CBC', iv }, await aes('AES-CBC', key, 'encrypt'), pt)),
    aesCbcDecrypt: async (key, iv, ct) => u8(await subtle.decrypt({ name: 'AES-CBC', iv }, await aes('AES-CBC', key, 'decrypt'), ct)),
    rsaOaepEncrypt: async (jwk, pt) => u8(await subtle.encrypt({ name: 'RSA-OAEP' }, await rsa('RSA-OAEP', jwk, 'encrypt', false), pt)),
    rsaOaepDecrypt: async (jwk, ct) => u8(await subtle.decrypt({ name: 'RSA-OAEP' }, await rsa('RSA-OAEP', jwk, 'decrypt', true), ct)),
    rsaPssSign: async (jwk, data, saltLength) =>
      u8(await subtle.sign({ name: 'RSA-PSS', saltLength }, await rsa('RSA-PSS', jwk, 'sign', true), data)),
    rsaPssVerify: async (jwk, sig, data, saltLength) =>
      subtle.verify({ name: 'RSA-PSS', saltLength }, await rsa('RSA-PSS', jwk, 'verify', false), sig, data),
    gzip: o.gzip,
    gunzip: o.gunzip,
  }
}
