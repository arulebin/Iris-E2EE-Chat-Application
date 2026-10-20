import type { Bytes, CryptoProvider } from './provider.ts'

export const utf8Decode = (b: Bytes): string => new TextDecoder().decode(b)

/** A standalone ArrayBuffer holding exactly these bytes (libsignal and Blob want ArrayBuffers). */
export function toArrayBuffer(b: Bytes): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

/**
 * AES-GCM open that always fails with an Error named 'OperationError' (what WebCrypto
 * throws for a wrong key or a tampered blob). Callers across the app match on that name
 * to tell "wrong password" from other failures, and non-WebCrypto backends throw
 * differently.
 */
export async function gcmOpen(p: CryptoProvider, key: Bytes, iv: Bytes, ct: Bytes, aad?: Bytes): Promise<Bytes> {
  try {
    return await p.aesGcmDecrypt(key, iv, ct, aad)
  } catch (cause) {
    if ((cause as { name?: string } | null)?.name === 'OperationError') throw cause
    const err = new Error('The operation failed for an operation-specific reason', { cause })
    err.name = 'OperationError'
    throw err
  }
}

/** iv ‖ AES-GCM(ct ‖ tag): the packing used by every Iris blob. */
export async function gcmSealPacked(p: CryptoProvider, key: Bytes, plaintext: Bytes, aad?: Bytes): Promise<Bytes> {
  const iv = p.randomBytes(12)
  const ct = await p.aesGcmEncrypt(key, iv, plaintext, aad)
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv, 0)
  out.set(ct, iv.length)
  return out
}

export function gcmOpenPacked(p: CryptoProvider, key: Bytes, packed: Bytes, aad?: Bytes): Promise<Bytes> {
  return gcmOpen(p, key, packed.slice(0, 12), packed.slice(12), aad)
}

/** RFC 4122 v4 UUID from provider randomness (no global crypto.randomUUID needed). */
export function randomUUID(p: CryptoProvider): string {
  const b = p.randomBytes(16)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Uniform-enough random uint32 from provider randomness. */
export function randomUint32(p: CryptoProvider): number {
  const b = p.randomBytes(4)
  return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0
}

/** libsignal speaks "binary strings" (one char per byte); the wire speaks base64. */
export function binaryStringToBytes(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

export function bytesToBinaryString(b: Bytes): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return s
}
