import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// "core has no DOM or Node imports" (docs/mobile-architecture.md, phase 2 acceptance).
// A cheap static guard: no platform globals or platform packages in packages/core/src.

const SRC = fileURLToPath(new URL('../src', import.meta.url))

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return files(p)
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : []
  })
}

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** Source with comments and string literals blanked out, so prose can mention these names. */
function code(src: string): string {
  return stripComments(src)
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""')
}

const FORBIDDEN: [string, RegExp][] = [
  ['window', /\bwindow\b/],
  ['document', /\bdocument\b/],
  ['indexedDB / idb-keyval', /\bindexedDB\b/],
  ['localStorage / sessionStorage', /\b(localStorage|sessionStorage)\b/],
  ['navigator', /\bnavigator\b/],
  ['Blob / FormData / File', /\b(Blob|FormData|File)\b/],
  ['CompressionStream', /\b(Compression|Decompression)Stream\b/],
  ['global crypto / atob / btoa', /(?<![.\w])(crypto\.(subtle|getRandomValues|randomUUID)|atob\(|btoa\()/],
  ['Buffer / process', /\b(Buffer|process)\./],
]

describe('@iris/core stays platform-neutral', () => {
  const sources = files(SRC)

  it('scans the source tree', () => {
    expect(sources.length).toBeGreaterThan(20)
  })

  for (const [label, re] of FORBIDDEN) {
    it(`does not use ${label}`, () => {
      const hits = sources.filter(f => re.test(code(readFileSync(f, 'utf8'))))
      expect(hits.map(f => f.slice(SRC.length + 1))).toEqual([])
    })
  }

  it('imports only relative modules, libsignal and fflate (no node: / DOM / Capacitor packages)', () => {
    const bad: string[] = []
    for (const f of sources) {
      for (const m of stripComments(readFileSync(f, 'utf8')).matchAll(/from\s+'([^']+)'/g)) {
        const spec = m[1]
        if (spec.startsWith('.') || spec === '@privacyresearch/libsignal-protocol-typescript' || spec === 'fflate') continue
        bad.push(`${f.slice(SRC.length + 1)}: ${spec}`)
      }
    }
    expect(bad).toEqual([])
  })
})
