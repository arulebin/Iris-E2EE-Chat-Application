import { MAX_PLAINTEXT_BYTES } from './limits'
import type { MediaKind } from './types'

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (x: number) => String(x).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

export function kindFromMime(mime: string): MediaKind {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return 'file'
}

/** What the server is allowed to see. Documents are opaque. */
export function wireMimeFor(mime: string): string {
  if (mime.startsWith('video/')) return 'video/*'
  if (mime.startsWith('image/')) return 'image/*'
  return 'application/octet-stream'
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm', '3gp': 'video/3gpp', mkv: 'video/x-matroska',
  pdf: 'application/pdf', txt: 'text/plain', zip: 'application/zip', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', csv: 'text/csv', json: 'application/json',
}
const MIME_EXT: Record<string, string> = {}
for (const [e, m] of Object.entries(EXT_MIME)) if (!(m in MIME_EXT)) MIME_EXT[m] = e

export function extensionOf(nameOrUri: string): string {
  const clean = nameOrUri.split(/[?#]/)[0] ?? ''
  const i = clean.lastIndexOf('.')
  const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
  return i > slash ? clean.slice(i + 1).toLowerCase() : ''
}

export function guessMime(nameOrUri: string, fallback = 'application/octet-stream'): string {
  return EXT_MIME[extensionOf(nameOrUri)] ?? fallback
}

export function extensionForMime(mime: string, fallback = 'bin'): string {
  return MIME_EXT[mime] ?? fallback
}

/** Strip path separators and control chars so a received name is safe to use as a file name. */
export function safeFileName(name: string, fallback = 'file'): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+/, '').trim().slice(0, 120)
  return cleaned || fallback
}

/** Scale (w,h) down so the longest edge is at most `maxEdge`. Never upscales. Integers. */
export function fitWithin(w: number, h: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(w, h)
  if (longest <= maxEdge || longest <= 0) return { width: Math.round(w), height: Math.round(h) }
  const k = maxEdge / longest
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
}

/** Bubble size for a thumbnail given source aspect, clamped like WhatsApp (no skinny strips). */
export function bubbleSize(w: number | undefined, h: number | undefined, maxW: number, maxH = maxW * 1.25) {
  const ar = w && h && w > 0 && h > 0 ? w / h : 1
  let width = maxW
  let height = width / ar
  if (height > maxH) {
    height = maxH
    width = Math.max(maxW * 0.55, height * ar)
  }
  if (height < maxW * 0.45) height = maxW * 0.45
  return { width: Math.round(width), height: Math.round(height) }
}

export function checkPlaintextSize(size: number): void {
  if (size > MAX_PLAINTEXT_BYTES) {
    throw new Error(`File too large (${(size / 1024 / 1024).toFixed(1)}MB) — max is 50MB`)
  }
}

/** SVG ring progress: dasharray/dashoffset for a given circumference. */
export function ringDash(circumference: number, progress: number): { dasharray: number; dashoffset: number } {
  const p = Math.min(1, Math.max(0, progress))
  return { dasharray: circumference, dashoffset: circumference * (1 - p) }
}

export function clampZoom(z: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, z))
}

/** Drag-up zoom while recording: finger travel (px, up positive) to a zoom factor via an exponential curve. */
export function dragToZoom(startZoom: number, travelUp: number, screenH: number, min: number, max: number): number {
  const t = Math.min(1, Math.max(0, travelUp / (screenH * 0.5)))
  const base = Math.max(startZoom, 1e-3)
  const target = base * Math.pow(Math.max(max, base) / base, t)
  return clampZoom(target, min, max)
}
