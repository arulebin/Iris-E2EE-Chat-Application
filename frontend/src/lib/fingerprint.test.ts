import { describe, expect, it } from 'vitest'
import { FingerprintGenerator } from '@privacyresearch/libsignal-protocol-typescript'
import { identitySafetyNumber } from './fingerprint'

const key = (seed: number) => Uint8Array.from({ length: 33 }, (_, i) => (i * 31 + seed) & 0xff).buffer

describe('identity safety numbers', () => {
  it('match the library FingerprintGenerator (Signal v0)', async () => {
    // Few iterations: the library's pure-JS SHA-512 is what made 5200 unusable.
    for (const iterations of [1, 3]) {
      const expected = await new FingerprintGenerator(iterations).createFor('alice', key(1), 'bob', key(2))
      expect(await identitySafetyNumber('alice', key(1), 'bob', key(2), iterations)).toBe(expected)
    }
  })

  it('is the same from both sides', async () => {
    const a = await identitySafetyNumber('alice', key(1), 'bob', key(2), 5)
    const b = await identitySafetyNumber('bob', key(2), 'alice', key(1), 5)
    expect(a).toBe(b)
    expect(a).toMatch(/^\d{60}$/)
  })

  it('computes the full 5200 rounds quickly on WebCrypto', async () => {
    const t0 = performance.now()
    await identitySafetyNumber('alice', key(1), 'bob', key(2))
    expect(performance.now() - t0).toBeLessThan(5000)
  })
})
