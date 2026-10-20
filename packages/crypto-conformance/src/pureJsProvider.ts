import { gcm, cbc } from '@noble/ciphers/aes.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { hmac } from '@noble/hashes/hmac.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { pbkdf2 } from '@noble/hashes/pbkdf2.js'
import { gunzipSync, gzipSync } from 'fflate'
import forge from 'node-forge'
import { fromBase64, toBase64, type Bytes, type CryptoProvider, type HashName, type RsaJwk } from '@iris/core'

/**
 * Pure-JS CryptoProvider: the fallback for any primitive a native backend lacks.
 * AES/SHA/HMAC/HKDF/PBKDF2 via @noble (audited, no native deps), gzip via fflate,
 * RSA (legacy paths only) via node-forge. Slow on Hermes for PBKDF2 and RSA, which
 * is why the native backend is preferred whenever it passes the conformance suite.
 */

const H = { 'SHA-256': sha256, 'SHA-512': sha512 } as const
const b64u = (s: string) => fromBase64(s.replace(/-/g, '+').replace(/_/g, '/'))
const toBig = (s: string) => new forge.jsbn.BigInteger(forge.util.bytesToHex(String.fromCharCode(...b64u(s))), 16)
const bin = (b: Bytes) => {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return s
}
const unbin = (s: string): Bytes => Uint8Array.from(s, c => c.charCodeAt(0))

function pubKey(j: RsaJwk) {
  return forge.pki.setRsaPublicKey(toBig(j.n), toBig(j.e))
}
function privKey(j: RsaJwk) {
  const need = ['d', 'p', 'q', 'dp', 'dq', 'qi'] as const
  for (const k of need) if (!j[k]) throw new Error('Incomplete RSA private JWK')
  return forge.pki.setRsaPrivateKey(toBig(j.n), toBig(j.e), toBig(j.d!), toBig(j.p!), toBig(j.q!), toBig(j.dp!), toBig(j.dq!), toBig(j.qi!))
}

export function createPureJsProvider(getRandomValues: (a: Uint8Array) => Uint8Array): CryptoProvider {
  return {
    name: 'pure-js (@noble + fflate + node-forge)',
    randomBytes: n => getRandomValues(new Uint8Array(n)),
    digest: async (h: HashName, d) => H[h](d),
    hmac: async (h: HashName, k, d) => hmac(H[h], k, d),
    hkdf: async (h: HashName, ikm, salt, info, len) => hkdf(H[h], ikm, salt, info, len),
    pbkdf2: async (h: HashName, pw, salt, c, len) => pbkdf2(H[h], pw, salt, { c, dkLen: len }),
    aesGcmEncrypt: async (k, iv, pt, aad) => gcm(k, iv, aad).encrypt(pt),
    aesGcmDecrypt: async (k, iv, ct, aad) => gcm(k, iv, aad).decrypt(ct),
    aesCbcEncrypt: async (k, iv, pt) => cbc(k, iv).encrypt(pt),
    aesCbcDecrypt: async (k, iv, ct) => cbc(k, iv).decrypt(ct),
    rsaOaepEncrypt: async (j, pt) =>
      unbin(pubKey(j).encrypt(bin(pt), 'RSA-OAEP', { md: forge.md.sha256.create(), mgf1: { md: forge.md.sha256.create() } })),
    rsaOaepDecrypt: async (j, ct) =>
      unbin(privKey(j).decrypt(bin(ct), 'RSA-OAEP', { md: forge.md.sha256.create(), mgf1: { md: forge.md.sha256.create() } })),
    rsaPssSign: async (j, data, saltLength) => {
      const md = forge.md.sha256.create()
      md.update(bin(data))
      const pss = forge.pss.create({ md: forge.md.sha256.create(), mgf: forge.mgf.mgf1.create(forge.md.sha256.create()), saltLength })
      return unbin(privKey(j).sign(md, pss))
    },
    rsaPssVerify: async (j, sig, data, saltLength) => {
      const md = forge.md.sha256.create()
      md.update(bin(data))
      const pss = forge.pss.create({ md: forge.md.sha256.create(), mgf: forge.mgf.mgf1.create(forge.md.sha256.create()), saltLength })
      try {
        return pubKey(j).verify(md.digest().getBytes(), bin(sig), pss)
      } catch {
        return false
      }
    },
    gzip: async d => gzipSync(d),
    gunzip: async d => gunzipSync(d),
  }
}

export { toBase64 }
