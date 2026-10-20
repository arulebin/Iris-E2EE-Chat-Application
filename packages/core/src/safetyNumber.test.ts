import { webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FingerprintGenerator } from '@privacyresearch/libsignal-protocol-typescript'
import { createSubtleProvider } from './crypto/subtleProvider.ts'
import { fromBase64, toBase64 } from './crypto/bytes.ts'
import { formatSafetyNumber, identitySafetyNumber, computeSafetyNumber } from './safetyNumber.ts'

const c = createSubtleProvider({
  name: 'node-webcrypto',
  subtle: webcrypto.subtle,
  getRandomValues: a => webcrypto.getRandomValues(a),
})
const key = (seed: number) => Uint8Array.from({ length: 33 }, (_, i) => (i * 31 + seed) & 0xff)

describe('safety numbers (copied from frontend/src/lib/fingerprint.ts)', () => {
  it('matches the libsignal FingerprintGenerator', async () => {
    for (const iterations of [1, 3]) {
      const expected = await new FingerprintGenerator(iterations).createFor('alice', key(1).buffer, 'bob', key(2).buffer)
      expect(await identitySafetyNumber(c, 'alice', key(1), 'bob', key(2), iterations)).toBe(expected)
    }
  })

  it('is the same from both sides and 60 digits', async () => {
    const a = await identitySafetyNumber(c, 'alice', key(1), 'bob', key(2), 5)
    const b = await identitySafetyNumber(c, 'bob', key(2), 'alice', key(1), 5)
    expect(a).toBe(b)
    expect(a).toMatch(/^\d{60}$/)
  })

  it('legacy RSA number is order independent', async () => {
    const jwk = { kty: 'RSA', n: 'sXch', e: 'AQAB' }
    const jwk2 = { kty: 'RSA', n: 'qrstu', e: 'AQAB' }
    expect(await computeSafetyNumber(c, 'a', jwk, 'b', jwk2, 3)).toBe(await computeSafetyNumber(c, 'b', jwk2, 'a', jwk, 3))
  })

  it('runs the full 5200 rounds in reasonable time', async () => {
    const t0 = performance.now()
    await identitySafetyNumber(c, 'alice', key(1), 'bob', key(2))
    expect(performance.now() - t0).toBeLessThan(10_000)
  })

  it('formats in groups of five', () => {
    expect(formatSafetyNumber('1234567890')).toEqual(['12345', '67890'])
  })
})

describe('base64 helpers', () => {
  it('round-trips and agrees with Buffer', () => {
    for (let n = 0; n < 20; n++) {
      const b = webcrypto.getRandomValues(new Uint8Array(n))
      expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'))
      expect(Array.from(fromBase64(toBase64(b)))).toEqual(Array.from(b))
    }
  })
})
