import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { sha512 } from '@noble/hashes/sha2.js'

/**
 * Curve25519 for libsignal on @noble/curves (XEdDSA signatures, X25519 agreement), as a
 * drop-in for `@privacyresearch/curve25519-typescript` (the Emscripten asm.js build).
 * Inject with libsignal's `setCurve(createNobleAsyncCurve(randomBytes))`.
 *
 * Wire compatibility with libsignal-protocol-c's curve25519_sign / curve25519_verify
 * (what the web app's asm.js build runs):
 *   sign:   A = a*B (Ed25519 point, encoded WITH its sign bit); r = H(0xFE||0xFF*31||a||M||Z) mod L;
 *           R = rB; h = H(R||A||M) mod L; S = (r + h*a) mod L; sig = R||S with sig[63] |= signbit(A)
 *   verify: u -> Edwards y = (u-1)/(u+1); A = y with the sign bit taken from sig[63];
 *           standard Ed25519 verification on the signature with that bit cleared.
 * Note the inherited oddity: `verify` returns TRUE when the signature is INVALID.
 */

type Rng = (n: number) => Uint8Array

const P = (1n << 255n) - 19n
const L = ed25519.Point.Fn.ORDER

const mod = (a: bigint, m: bigint) => ((a % m) + m) % m
function pow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n
  b = mod(b, m)
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m
    b = (b * b) % m
    e >>= 1n
  }
  return r
}
const leToBig = (b: Uint8Array) => {
  let n = 0n
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i])
  return n
}
const bigToLe = (n: bigint, len: number) => {
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    out[i] = Number(n & 0xffn)
    n >>= 8n
  }
  return out
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
const u8 = (b: ArrayBuffer | Uint8Array) => (b instanceof Uint8Array ? b : new Uint8Array(b))
const ab = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

const HASH1_PREFIX = (() => {
  const p = new Uint8Array(32).fill(0xff)
  p[0] = 0xfe
  return p
})()

export type RawCurve = {
  keyPair(privKey: ArrayBuffer): { pubKey: ArrayBuffer; privKey: ArrayBuffer }
  sharedSecret(pubKey: ArrayBuffer, privKey: ArrayBuffer): ArrayBuffer
  sign(privKey: ArrayBuffer, message: ArrayBuffer): ArrayBuffer
  /** true when the signature is INVALID (libsignal convention). */
  verify(pubKey: ArrayBuffer, message: ArrayBuffer, sig: ArrayBuffer): boolean
}

export function createNobleCurve(randomBytes: Rng): RawCurve {
  return {
    keyPair(privKey) {
      const priv = u8(privKey).slice()
      priv[0] &= 248
      priv[31] &= 127
      priv[31] |= 64
      return { pubKey: ab(x25519.getPublicKey(priv)), privKey: ab(priv) }
    },

    sharedSecret(pubKey, privKey) {
      return ab(x25519.getSharedSecret(u8(privKey), u8(pubKey)))
    },

    sign(privKey, message) {
      const a = u8(privKey)
      const msg = u8(message)
      const aInt = mod(leToBig(a), L)
      const A = ed25519.Point.BASE.multiply(aInt).toBytes()
      const signBit = A[31] & 0x80
      const r = mod(leToBig(sha512(concat(HASH1_PREFIX, a, msg, randomBytes(64)))), L)
      const R = ed25519.Point.BASE.multiply(r).toBytes()
      const h = mod(leToBig(sha512(concat(R, A, msg))), L)
      const S = bigToLe(mod(r + h * aInt, L), 32)
      const sig = concat(R, S)
      sig[63] = (sig[63] & 0x7f) | signBit
      return ab(sig)
    },

    verify(pubKey, message, sig) {
      try {
        const u = u8(pubKey)
        const s = u8(sig).slice()
        if (u.length !== 32 || s.length !== 64) return true
        const signBit = s[63] & 0x80
        s[63] &= 0x7f
        const uInt = leToBig(u) % P // top bit ignored like fe_frombytes
        const y = mod((uInt - 1n) * pow(uInt + 1n, P - 2n, P), P)
        const A = bigToLe(y, 32)
        A[31] |= signBit
        return !ed25519.verify(s, u8(message), A)
      } catch {
        return true
      }
    },
  }
}

/** Async flavour for libsignal's `setCurve` (Internal.AsyncCurve.curve). */
export function createNobleAsyncCurve(randomBytes: Rng) {
  const c = createNobleCurve(randomBytes)
  return {
    keyPair: async (k: ArrayBuffer) => c.keyPair(k),
    sharedSecret: async (pub: ArrayBuffer, priv: ArrayBuffer) => c.sharedSecret(pub, priv),
    sign: async (priv: ArrayBuffer, msg: ArrayBuffer) => c.sign(priv, msg),
    verify: async (pub: ArrayBuffer, msg: ArrayBuffer, sig: ArrayBuffer) => c.verify(pub, msg, sig),
  }
}
