import { webcrypto } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createSubtleProvider } from '@iris/core'
import { cases, runConformance, summarize } from './suite.ts'
import { createPureJsProvider } from './pureJsProvider.ts'

const rnd = (a: Uint8Array) => webcrypto.getRandomValues(a)

const providers = {
  // Reference: Node's OpenSSL-backed WebCrypto. Anything the app does on web must pass here.
  'node webcrypto (reference)': createSubtleProvider({
    name: 'node-webcrypto',
    subtle: webcrypto.subtle,
    getRandomValues: rnd,
    gzip: async d => new Uint8Array(gzipSync(d)),
    gunzip: async d => new Uint8Array(gunzipSync(d)),
  }),
  // Fallback stack proposed for gaps on React Native.
  'pure-js fallback': createPureJsProvider(rnd),
}

for (const [label, provider] of Object.entries(providers)) {
  describe(label, () => {
    for (const c of cases) {
      it(`${c.group}: ${c.name}`, { timeout: 120_000 }, async () => {
        await c.run(provider)
      })
    }
  })
}

describe('runConformance', () => {
  it('reports all-pass for the reference provider', async () => {
    const rs = await runConformance(providers['node webcrypto (reference)'])
    expect(summarize(rs).fail).toBe(0)
    expect(summarize(rs).pass).toBe(cases.length)
  })

  it('reports a failure instead of throwing for a broken provider', async () => {
    const broken = { ...providers['node webcrypto (reference)'], digest: async () => new Uint8Array(32) }
    const rs = await runConformance(broken, { skipSlow: true })
    expect(summarize(rs).fail).toBeGreaterThan(0)
  })
})

describe('benchmarks (informational)', () => {
  it('PBKDF2 600k: native vs pure-JS timings on this machine', { timeout: 120_000 }, async () => {
    const pw = new TextEncoder().encode('benchmark')
    const salt = new Uint8Array(16)
    const out: Record<string, number> = {}
    for (const [label, p] of Object.entries(providers)) {
      const t0 = performance.now()
      await p.pbkdf2('SHA-256', pw, salt, 600_000, 32)
      out[label] = Math.round(performance.now() - t0)
    }
    console.log('PBKDF2-SHA256 600k iterations (ms):', JSON.stringify(out))
    expect(Object.keys(out).length).toBe(2)
  })
})
