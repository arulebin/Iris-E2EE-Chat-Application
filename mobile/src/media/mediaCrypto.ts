import { fromBase64, toBase64, type CryptoProvider } from '@iris/core'
import { IV_BYTES, MEDIA_CRYPTO_OVERHEAD } from './limits'

/**
 * Wire-compatible with frontend/src/crypto.ts encryptMediaBytes / decryptMediaBytes:
 *   key  = fresh random 32 bytes (AES-256-GCM), shipped as base64 inside the E2E envelope
 *   blob = iv(12) || ciphertext || tag(16)      (WebCrypto layout, no AAD)
 */
export async function encryptMediaBytes(
  provider: CryptoProvider,
  plaintext: Uint8Array,
): Promise<{ ciphertext: Uint8Array; key: string }> {
  const rawKey = provider.randomBytes(32)
  const iv = provider.randomBytes(IV_BYTES)
  const ct = await provider.aesGcmEncrypt(rawKey, iv, plaintext)
  const out = new Uint8Array(IV_BYTES + ct.length)
  out.set(iv, 0)
  out.set(ct, IV_BYTES)
  return { ciphertext: out, key: toBase64(rawKey) }
}

/** Throws on a wrong key or tampered blob (GCM auth failure). */
export async function decryptMediaBytes(
  provider: CryptoProvider,
  packed: Uint8Array,
  keyB64: string,
): Promise<Uint8Array> {
  if (packed.length < MEDIA_CRYPTO_OVERHEAD) throw new Error('Media blob too short')
  const key = fromBase64(keyB64)
  if (key.length !== 32) throw new Error('Bad media key')
  return provider.aesGcmDecrypt(key, packed.slice(0, IV_BYTES), packed.slice(IV_BYTES))
}
