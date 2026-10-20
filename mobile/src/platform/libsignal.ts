import { setCurve, setWebCrypto } from '@privacyresearch/libsignal-protocol-typescript'
import { createLibsignalWebCrypto, createNobleAsyncCurve, type CryptoProvider } from '@iris/core'

/**
 * Wire libsignal to the native provider (AES-CBC/HMAC/SHA-512 in OpenSSL) and to the
 * @noble/curves curve25519 (XEdDSA/X25519). The default asm.js curve25519 is 13-40x slower on
 * Hermes (sign 368 ms vs 21 ms, session setup 2.2 s vs 0.26 s measured on a Redmi Note 7 Pro),
 * and the noble implementation is cross-verified byte-compatible with it (core nobleCurve.test.ts).
 * Call once at startup, before any libsignal use.
 */
export function installLibsignal(provider: CryptoProvider): void {
  setWebCrypto(createLibsignalWebCrypto(provider) as unknown as Crypto)
  setCurve(createNobleAsyncCurve(n => provider.randomBytes(n)) as never)
}
