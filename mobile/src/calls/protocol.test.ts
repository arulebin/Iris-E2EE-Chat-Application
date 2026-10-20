// Pins the wire format to what the web client (frontend/src/webrtc.ts) and the Java
// CallRelay speak, plus the pure helpers ported from the web client.
import { describe, expect, it } from 'vitest'
import { decodeSignal, encodeSignal, belongsToCall, currentCall, endNotice, formatDuration } from './signals'
import { grade, sampleStats } from './quality'
import { clampToViewport, dismissZone, overDismiss, snapToCorner, snapToEdge } from './snap'
import type { CallSignal, CallState } from './types'

describe('wire format (compatible with the web client)', () => {
  it('encodes every signal as flat JSON with type/to/callId', () => {
    const offer: CallSignal = { type: 'call-offer', to: 'bob', callId: 'c1', mode: 'video', payload: { type: 'offer', sdp: 'x' } }
    expect(JSON.parse(encodeSignal(offer))).toEqual({
      type: 'call-offer', to: 'bob', callId: 'c1', mode: 'video', payload: { type: 'offer', sdp: 'x' },
    })
    const reneg: CallSignal = { type: 'call-offer', to: 'bob', callId: 'c1', reneg: true, payload: { type: 'offer', sdp: 'x' } }
    expect(JSON.parse(encodeSignal(reneg)).reneg).toBe(true)
    const st: CallSignal = { type: 'call-state', to: 'bob', callId: 'c1', muted: true, cameraOff: false, video: true }
    expect(JSON.parse(encodeSignal(st))).toEqual({ type: 'call-state', to: 'bob', callId: 'c1', muted: true, cameraOff: false, video: true })
  })

  it('decodes frames the server relays (from is stamped by the relay)', () => {
    const frame = '{"type":"call-end","from":"bob","callId":"c1","reason":"answered-elsewhere","to":"me"}'
    expect(decodeSignal(frame)).toMatchObject({ type: 'call-end', from: 'bob', reason: 'answered-elsewhere' })
  })

  it('ignores non-call frames and garbage', () => {
    expect(decodeSignal('{"type":"message","body":"hi"}')).toBeNull()
    expect(decodeSignal('not json')).toBeNull()
    expect(decodeSignal('null')).toBeNull()
  })
})

const VP = { w: 400, h: 800 }
const TILE = { w: 100, h: 150 }
const still = { x: 0, y: 0 }

describe('snap', () => {
  it('settles in the nearest corner, inside the margin', () => {
    expect(snapToCorner({ x: 10, y: 20 }, still, TILE, VP)).toEqual({ x: 12, y: 12 })
    expect(snapToCorner({ x: 280, y: 600 }, still, TILE, VP)).toEqual({ x: 288, y: 638 })
  })
  it('a flick carries the tile to the far corner', () => {
    expect(snapToCorner({ x: 100, y: 20 }, { x: 2, y: 0 }, TILE, VP).x).toBe(288)
  })
  it('respects safe-area insets', () => {
    const insets = { top: 40, right: 0, bottom: 30, left: 0 }
    expect(snapToCorner({ x: 0, y: 0 }, still, TILE, VP, insets)).toEqual({ x: 12, y: 52 })
  })
  it('edge snap keeps the vertical position but clamps it', () => {
    expect(snapToEdge({ x: 50, y: 300 }, still, TILE, VP)).toEqual({ x: 12, y: 300 })
  })
  it('clamps a dragged tile to the viewport', () => {
    expect(clampToViewport({ x: -50, y: 2000 }, TILE, VP)).toEqual({ x: 0, y: 650 })
  })
  it('detects drops on the bottom-centre dismiss target', () => {
    const zone = dismissZone(VP)
    expect(overDismiss({ x: zone.cx - 50, y: zone.cy - 75 }, TILE, zone)).toBe(true)
    expect(overDismiss({ x: 12, y: 12 }, TILE, zone)).toBe(false)
  })
})

describe('signals helpers', () => {
  const active: CallState = { kind: 'active', peer: 'bob', mode: 'video', callId: 'c1', role: 'caller', startedAt: 0 }
  it('only accepts signals from our peer for our call', () => {
    expect(belongsToCall(active, 'bob', 'c1')).toBe(true)
    expect(belongsToCall(active, 'bob', 'old')).toBe(false)
    expect(belongsToCall(active, 'eve', 'c1')).toBe(false)
    expect(belongsToCall(active, 'bob', undefined)).toBe(true)
    expect(belongsToCall({ kind: 'idle' }, 'bob', 'c1')).toBe(false)
  })
  it('knows the current call', () => {
    expect(currentCall({ kind: 'incoming', from: 'b', offer: null, mode: 'video', callId: 'y' })).toEqual({ peer: 'b', callId: 'y' })
  })
  it('explains why a call ended', () => {
    expect(endNotice('busy', 'bob', 'outgoing')).toBe('bob is on another call')
    expect(endNotice('canceled', 'bob', 'incoming')).toBe('Missed call from bob')
    expect(endNotice('handled-elsewhere', 'bob', 'incoming')).toBeNull()
  })
  it('formats durations', () => {
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(3725)).toBe('1:02:05')
  })
})

describe('quality', () => {
  const pair = (rtt: number) => ({ type: 'candidate-pair', nominated: true, currentRoundTripTime: rtt })
  const inbound = (received: number, lost: number) => ({ type: 'inbound-rtp', packetsReceived: received, packetsLost: lost })
  it('grades by loss and rtt', () => {
    const a = sampleStats([pair(0.05), inbound(1000, 0)])
    expect(grade(a, sampleStats([pair(0.05), inbound(1100, 1)]))).toBe('good')
    expect(grade(a, sampleStats([pair(0.05), inbound(1100, 5)]))).toBe('fair')
    expect(grade(a, sampleStats([pair(0.05), inbound(1100, 20)]))).toBe('poor')
    expect(grade(a, sampleStats([pair(0.7), inbound(1100, 0)]))).toBe('poor')
  })
})
