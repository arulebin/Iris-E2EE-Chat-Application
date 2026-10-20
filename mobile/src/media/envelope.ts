import type { MediaEnvelope } from './types'

/**
 * Same wire shape as frontend/src/lib/media.ts buildMediaEnvelope: key order iris, v, key, mime, caption.
 * Optional hints are appended only when present, so a plain envelope is byte-identical to web's.
 */
export function buildMediaEnvelope(
  key: string,
  mime: string,
  caption = '',
  extra: Partial<Pick<MediaEnvelope, 'name' | 'size' | 'w' | 'h' | 'dur' | 'bh'>> = {},
): string {
  const env: MediaEnvelope = { iris: 'media', v: 1, key, mime, caption }
  if (extra.name) env.name = extra.name
  if (extra.size != null) env.size = extra.size
  if (extra.w != null) env.w = Math.round(extra.w)
  if (extra.h != null) env.h = Math.round(extra.h)
  if (extra.dur != null) env.dur = Math.round(extra.dur * 10) / 10
  if (extra.bh) env.bh = extra.bh
  return JSON.stringify(env)
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)

/** Returns the envelope if `plaintext` is one, else null (e.g. a plain text message). Mirrors web parseMediaEnvelope. */
export function parseMediaEnvelope(plaintext: string): MediaEnvelope | null {
  if (!plaintext.startsWith('{')) return null
  try {
    const p = JSON.parse(plaintext) as Partial<Record<keyof MediaEnvelope, unknown>>
    if (p.iris !== 'media' || typeof p.key !== 'string') return null
    const env: MediaEnvelope = {
      iris: 'media',
      v: 1,
      key: p.key,
      mime: typeof p.mime === 'string' ? p.mime : 'application/octet-stream',
      caption: typeof p.caption === 'string' ? p.caption : '',
    }
    if (typeof p.name === 'string') env.name = p.name
    const size = num(p.size)
    if (size != null) env.size = size
    const w = num(p.w)
    if (w != null) env.w = w
    const h = num(p.h)
    if (h != null) env.h = h
    const dur = num(p.dur)
    if (dur != null) env.dur = dur
    if (typeof p.bh === 'string' && p.bh.length <= 64) env.bh = p.bh
    return env
  } catch {
    return null
  }
}
