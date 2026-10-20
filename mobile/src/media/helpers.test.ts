import { describe, expect, it } from 'vitest'
import {
  bubbleSize, checkPlaintextSize, clampZoom, dragToZoom, extensionForMime, extensionOf, fitWithin, formatBytes,
  formatDuration, guessMime, kindFromMime, ringDash, safeFileName, wireMimeFor,
} from './helpers'
import { MAX_PLAINTEXT_BYTES } from './limits'

describe('helpers', () => {
  it('formats bytes and durations', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB')
    expect(formatDuration(5)).toBe('0:05')
    expect(formatDuration(75)).toBe('1:15')
    expect(formatDuration(3725)).toBe('1:02:05')
  })

  it('classifies mime types and the coarse wire type', () => {
    expect(kindFromMime('image/png')).toBe('image')
    expect(kindFromMime('video/mp4')).toBe('video')
    expect(kindFromMime('application/pdf')).toBe('file')
    expect(wireMimeFor('video/quicktime')).toBe('video/*')
    expect(wireMimeFor('image/heic')).toBe('image/*')
    expect(wireMimeFor('application/pdf')).toBe('application/octet-stream')
  })

  it('maps extensions and mime types', () => {
    expect(extensionOf('file:///a/b/c.JPG?x=1')).toBe('jpg')
    expect(extensionOf('file:///a.b/c')).toBe('')
    expect(guessMime('x.mov')).toBe('video/quicktime')
    expect(guessMime('x.unknownext')).toBe('application/octet-stream')
    expect(extensionForMime('image/jpeg')).toBe('jpg')
    expect(extensionForMime('foo/bar')).toBe('bin')
  })

  it('sanitises received file names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd')
    expect(safeFileName('a:b*c?.pdf')).toBe('a_b_c_.pdf')
    expect(safeFileName('...')).toBe('file')
    expect(safeFileName('')).toBe('file')
  })

  it('fits images without upscaling', () => {
    expect(fitWithin(4000, 3000, 2560)).toEqual({ width: 2560, height: 1920 })
    expect(fitWithin(1000, 800, 2560)).toEqual({ width: 1000, height: 800 })
    expect(fitWithin(3000, 6000, 2560)).toEqual({ width: 1280, height: 2560 })
  })

  it('clamps bubble sizes', () => {
    expect(bubbleSize(1000, 1000, 240)).toEqual({ width: 240, height: 240 })
    const tall = bubbleSize(100, 1000, 240)
    expect(tall.height).toBe(300)
    expect(tall.width).toBeGreaterThanOrEqual(132)
    expect(bubbleSize(undefined, undefined, 240)).toEqual({ width: 240, height: 240 })
    expect(bubbleSize(4000, 100, 240).height).toBeGreaterThanOrEqual(108)
  })

  it('enforces the 50MB ciphertext cap on the plaintext', () => {
    expect(() => checkPlaintextSize(MAX_PLAINTEXT_BYTES)).not.toThrow()
    expect(() => checkPlaintextSize(MAX_PLAINTEXT_BYTES + 1)).toThrow(/too large/)
  })

  it('computes ring dashes and zoom', () => {
    expect(ringDash(100, 0.25)).toEqual({ dasharray: 100, dashoffset: 75 })
    expect(ringDash(100, 2).dashoffset).toBe(0)
    expect(clampZoom(10, 1, 5)).toBe(5)
    expect(clampZoom(0.5, 1, 5)).toBe(1)
    expect(dragToZoom(1, 0, 1000, 1, 8)).toBe(1)
    expect(dragToZoom(1, 500, 1000, 1, 8)).toBeCloseTo(8)
    expect(dragToZoom(1, 250, 1000, 1, 8)).toBeCloseTo(Math.sqrt(8))
    expect(dragToZoom(1, -100, 1000, 1, 8)).toBe(1)
  })
})
