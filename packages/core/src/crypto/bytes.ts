import type { Bytes } from './provider.ts'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const LOOKUP = new Int16Array(128).fill(-1)
for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i

/** Dependency-free base64 (no atob/btoa/Buffer), identical on web, Node and Hermes. */
export function toBase64(bytes: Bytes): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? B64[n & 63] : '='
  }
  return out
}

export function fromBase64(s: string): Bytes {
  const clean = s.replace(/[\s=]+$/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let acc = 0
  let n = 0
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i)
    const v = c < 128 ? LOOKUP[c] : -1
    if (v < 0) throw new Error('Invalid base64')
    acc = ((acc << 6) | v) & 0xffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[n++] = (acc >> bits) & 0xff
    }
  }
  return out.subarray(0, n)
}

export const utf8 = (s: string): Bytes => new TextEncoder().encode(s)

export function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((l, p) => l + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export const toHex = (b: Bytes): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

export function fromHex(h: string): Bytes {
  const c = h.replace(/\s+/g, '')
  const out = new Uint8Array(c.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(c.slice(i * 2, i * 2 + 2), 16)
  return out
}
