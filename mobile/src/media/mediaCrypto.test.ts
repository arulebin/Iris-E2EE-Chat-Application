import { describe, expect, it } from 'vitest'
import { createSubtleProvider, fromBase64, toBase64, type CryptoProvider } from '@iris/core'
import { decryptMediaBytes, encryptMediaBytes } from './mediaCrypto'
import { MEDIA_CRYPTO_OVERHEAD } from './limits'
import { buildMediaEnvelope, parseMediaEnvelope } from './envelope'

const subtle = globalThis.crypto.subtle
const provider: CryptoProvider = createSubtleProvider({
  name: 'node-webcrypto',
  subtle: subtle as never,
  getRandomValues: a => globalThis.crypto.getRandomValues(a as never) as unknown as Uint8Array,
})

// ---- Verbatim port of the web client (frontend/src/crypto.ts encryptMediaBytes/decryptMediaBytes) ----
async function webEncrypt(plaintext: ArrayBuffer) {
  const aesKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext)
  const combined = new Uint8Array(iv.length + ct.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ct), iv.length)
  const raw = await subtle.exportKey('raw', aesKey)
  return { ciphertext: combined, key: toBase64(new Uint8Array(raw)) }
}
async function webDecrypt(packed: Uint8Array, keyB64: string) {
  const k = await subtle.importKey('raw', fromBase64(keyB64) as never, { name: 'AES-GCM' }, false, ['decrypt'])
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, k, packed.slice(12)))
}

// ---- Fixture generated once by the web algorithm with a fixed key/iv (see git history for the script) ----
const FIXTURE = {
  key: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=',
  blob: 'oKGio6Slpqeoqaqr8KNUFd3CP2ZSbc0GgeRUpDG+yG0tGgWkxcdG3VKNZxVBsOCkgLPUEeEvCiwFbGGT3DHNMCRrGQ==',
  plaintext: 'SXJpcyB3ZWItY29tcGF0IGZpeHR1cmUg4pyTIADDvyBwYXlsb2Fk',
}

describe('media crypto wire compatibility', () => {
  it('decrypts a fixture produced by the web algorithm', async () => {
    const out = await decryptMediaBytes(provider, fromBase64(FIXTURE.blob), FIXTURE.key)
    expect(toBase64(out)).toBe(FIXTURE.plaintext)
  })

  it('round-trips with itself', async () => {
    const pt = new Uint8Array(100_000).map((_, i) => (i * 31) & 0xff)
    const { ciphertext, key } = await encryptMediaBytes(provider, pt)
    expect(ciphertext.length).toBe(pt.length + MEDIA_CRYPTO_OVERHEAD)
    expect(fromBase64(key).length).toBe(32)
    expect(await decryptMediaBytes(provider, ciphertext, key)).toEqual(pt)
  })

  it('our ciphertext is decryptable by the web algorithm', async () => {
    const pt = new TextEncoder().encode('from mobile to web')
    const { ciphertext, key } = await encryptMediaBytes(provider, pt)
    expect(await webDecrypt(ciphertext, key)).toEqual(pt)
  })

  it('web ciphertext is decryptable by ours', async () => {
    const pt = new TextEncoder().encode('from web to mobile')
    const { ciphertext, key } = await webEncrypt(pt.buffer as ArrayBuffer)
    expect(await decryptMediaBytes(provider, ciphertext, key)).toEqual(pt)
  })

  it('uses a fresh key and iv every time', async () => {
    const pt = new Uint8Array(32)
    const a = await encryptMediaBytes(provider, pt)
    const b = await encryptMediaBytes(provider, pt)
    expect(a.key).not.toBe(b.key)
    expect(a.ciphertext.slice(0, 12)).not.toEqual(b.ciphertext.slice(0, 12))
  })

  it('rejects tampering, wrong key and truncated blobs', async () => {
    const { ciphertext, key } = await encryptMediaBytes(provider, new Uint8Array([1, 2, 3, 4]))
    const bad = ciphertext.slice()
    bad[bad.length - 1] ^= 1
    await expect(decryptMediaBytes(provider, bad, key)).rejects.toBeTruthy()
    const other = await encryptMediaBytes(provider, new Uint8Array(1))
    await expect(decryptMediaBytes(provider, ciphertext, other.key)).rejects.toBeTruthy()
    await expect(decryptMediaBytes(provider, new Uint8Array(10), key)).rejects.toThrow()
    await expect(decryptMediaBytes(provider, ciphertext, toBase64(new Uint8Array(16)))).rejects.toThrow()
  })
})

describe('media envelope', () => {
  it('matches the web envelope byte-for-byte when no extras are given', () => {
    const web = JSON.stringify({ iris: 'media', v: 1, key: 'K', mime: 'image/jpeg', caption: 'hi' })
    expect(buildMediaEnvelope('K', 'image/jpeg', 'hi')).toBe(web)
  })

  it('round-trips with optional hints', () => {
    const s = buildMediaEnvelope('K', 'video/mp4', 'c', { w: 1080.4, h: 1920, dur: 12.34, bh: 'LEHV6nWB', size: 5, name: 'a.mp4' })
    expect(parseMediaEnvelope(s)).toEqual({
      iris: 'media', v: 1, key: 'K', mime: 'video/mp4', caption: 'c', w: 1080, h: 1920, dur: 12.3, bh: 'LEHV6nWB', size: 5, name: 'a.mp4',
    })
  })

  it('parses a web-built envelope and defaults missing fields', () => {
    expect(parseMediaEnvelope('{"iris":"media","v":1,"key":"abc"}')).toEqual({
      iris: 'media', v: 1, key: 'abc', mime: 'application/octet-stream', caption: '',
    })
  })

  it('returns null for non-envelopes', () => {
    expect(parseMediaEnvelope('hello')).toBeNull()
    expect(parseMediaEnvelope('{"iris":"other"}')).toBeNull()
    expect(parseMediaEnvelope('{"iris":"media"}')).toBeNull()
    expect(parseMediaEnvelope('{not json')).toBeNull()
  })

  it('drops junk hint types and oversize blurhash', () => {
    const e = parseMediaEnvelope(JSON.stringify({ iris: 'media', v: 1, key: 'k', w: 'x', h: -1, bh: 'x'.repeat(100) }))!
    expect(e.w).toBeUndefined()
    expect(e.h).toBeUndefined()
    expect(e.bh).toBeUndefined()
  })
})
