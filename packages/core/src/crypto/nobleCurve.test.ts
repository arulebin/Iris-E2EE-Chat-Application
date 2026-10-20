import { webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Curve25519Wrapper } from '@privacyresearch/curve25519-typescript'
import { createNobleCurve } from './nobleCurve.ts'

const rnd = (n: number) => webcrypto.getRandomValues(new Uint8Array(n))
const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
const hex = (b: ArrayBuffer) => Buffer.from(b).toString('hex')

describe('noble curve25519 is wire-compatible with libsignal asm.js curve25519', async () => {
  const asm = await Curve25519Wrapper.create()
  const noble = createNobleCurve(rnd)

  it('keyPair and agreement match', () => {
    for (let i = 0; i < 20; i++) {
      const seed = ab(rnd(32))
      const a = asm.keyPair(seed)
      const n = noble.keyPair(seed)
      expect(hex(n.pubKey)).toBe(hex(a.pubKey))
      expect(hex(n.privKey)).toBe(hex(a.privKey))
      const other = asm.keyPair(ab(rnd(32)))
      expect(hex(noble.sharedSecret(other.pubKey, n.privKey))).toBe(hex(asm.sharedSecret(other.pubKey, a.privKey)))
    }
  })

  it('noble-signed verifies under asm.js and vice versa (both sign-bit values)', () => {
    let sawBit0 = false
    let sawBit1 = false
    for (let i = 0; i < 60; i++) {
      const kp = asm.keyPair(ab(rnd(32)))
      const msg = ab(rnd(1 + (i % 70)))
      const sigN = noble.sign(kp.privKey, msg)
      const sigA = asm.sign(kp.privKey, msg)
      if (new Uint8Array(sigN)[63] & 0x80) sawBit1 = true
      else sawBit0 = true
      expect(asm.verify(kp.pubKey, msg, sigN)).toBe(false) // false = valid
      expect(noble.verify(kp.pubKey, msg, sigA)).toBe(false)
      expect(noble.verify(kp.pubKey, msg, sigN)).toBe(false)
    }
    expect(sawBit0 && sawBit1).toBe(true)
  })

  it('rejects tampered messages, signatures and wrong keys (true = invalid)', () => {
    const kp = asm.keyPair(ab(rnd(32)))
    const other = asm.keyPair(ab(rnd(32)))
    const msg = ab(rnd(40))
    const sig = noble.sign(kp.privKey, msg)
    const bad = new Uint8Array(sig).slice()
    bad[5] ^= 1
    expect(noble.verify(kp.pubKey, msg, ab(bad))).toBe(true)
    expect(noble.verify(other.pubKey, msg, sig)).toBe(true)
    expect(noble.verify(kp.pubKey, ab(rnd(40)), sig)).toBe(true)
    expect(asm.verify(kp.pubKey, msg, ab(bad))).toBe(true)
  })
})
