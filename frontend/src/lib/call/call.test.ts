import { describe, expect, it } from 'vitest'
import { clampToViewport, dismissZone, overDismiss, snapToCorner, snapToEdge } from './snap'
import { belongsToCall, currentCall, endNotice, formatDuration } from './signals'
import { grade, sampleStats } from './quality'
import type { CallState } from '../../types'

const VP = { w: 400, h: 800 }
const TILE = { w: 100, h: 150 }
const still = { x: 0, y: 0 }

describe('snap', () => {
  it('settles in the nearest corner, inside the margin', () => {
    expect(snapToCorner({ x: 10, y: 20 }, still, TILE, VP)).toEqual({ x: 12, y: 12 })
    expect(snapToCorner({ x: 280, y: 600 }, still, TILE, VP)).toEqual({ x: 288, y: 638 })
  })

  it('a flick carries the tile to the far corner', () => {
    // Released left of centre but thrown hard to the right.
    expect(snapToCorner({ x: 100, y: 20 }, { x: 2, y: 0 }, TILE, VP).x).toBe(288)
  })

  it('respects safe-area insets', () => {
    const insets = { top: 40, right: 0, bottom: 30, left: 0 }
    expect(snapToCorner({ x: 0, y: 0 }, still, TILE, VP, insets)).toEqual({ x: 12, y: 52 })
    expect(snapToCorner({ x: 300, y: 700 }, still, TILE, VP, insets).y).toBe(800 - 30 - 12 - 150)
  })

  it('edge snap keeps the vertical position but clamps it', () => {
    expect(snapToEdge({ x: 50, y: 300 }, still, TILE, VP)).toEqual({ x: 12, y: 300 })
    expect(snapToEdge({ x: 250, y: 900 }, still, TILE, VP)).toEqual({ x: 288, y: 638 })
  })

  it('clamps a dragged tile to the viewport', () => {
    expect(clampToViewport({ x: -50, y: 2000 }, TILE, VP)).toEqual({ x: 0, y: 650 })
  })

  it('detects drops on the bottom-centre dismiss target', () => {
    const zone = dismissZone(VP)
    const onTarget = { x: zone.cx - TILE.w / 2, y: zone.cy - TILE.h / 2 }
    expect(overDismiss(onTarget, TILE, zone)).toBe(true)
    expect(overDismiss({ x: 12, y: 12 }, TILE, zone)).toBe(false)
  })
})

describe('signals', () => {
  const active: CallState = { kind: 'active', peer: 'bob', mode: 'video', callId: 'c1', role: 'caller', startedAt: 0 }

  it('only accepts signals from our peer for our call', () => {
    expect(belongsToCall(active, 'bob', 'c1')).toBe(true)
    expect(belongsToCall(active, 'bob', 'old-call')).toBe(false) // stale end from a previous call
    expect(belongsToCall(active, 'eve', 'c1')).toBe(false) // someone else giving up while we're busy
    expect(belongsToCall({ kind: 'idle' }, 'bob', 'c1')).toBe(false)
  })

  it('accepts callId-less signals from older clients on peer alone', () => {
    expect(belongsToCall(active, 'bob', undefined)).toBe(true)
  })

  it('knows the current call for every phase', () => {
    expect(currentCall({ kind: 'outgoing', to: 'a', mode: 'audio', callId: 'x' })).toEqual({ peer: 'a', callId: 'x' })
    expect(currentCall({ kind: 'incoming', from: 'b', offer: { type: 'offer' }, mode: 'video', callId: 'y' })).toEqual({ peer: 'b', callId: 'y' })
    expect(currentCall({ kind: 'idle' })).toBeNull()
  })

  it('explains why a call ended', () => {
    expect(endNotice('busy', 'bob', 'outgoing')).toBe('bob is on another call')
    expect(endNotice('declined', 'bob', 'outgoing')).toBe('bob declined the call')
    expect(endNotice('no-answer', 'bob', 'outgoing')).toBe("bob didn't answer")
    expect(endNotice('no-answer', 'bob', 'incoming')).toBe('Missed call from bob')
    expect(endNotice('canceled', 'bob', 'incoming')).toBe('Missed call from bob')
    expect(endNotice('hangup', 'bob', 'active')).toBe('bob ended the call')
    expect(endNotice('handled-elsewhere', 'bob', 'incoming')).toBeNull()
  })

  it('formats call durations', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(3725)).toBe('1:02:05')
  })
})

describe('quality', () => {
  const pair = (rtt: number) => ({ type: 'candidate-pair', nominated: true, currentRoundTripTime: rtt })
  const inbound = (received: number, lost: number) => ({ type: 'inbound-rtp', packetsReceived: received, packetsLost: lost })

  it('reads rtt and packet counters', () => {
    expect(sampleStats([pair(0.05), inbound(100, 2), inbound(50, 1)])).toEqual({ rttMs: 50, packetsReceived: 150, packetsLost: 3 })
  })

  it('grades by loss in the last interval and rtt', () => {
    const a = sampleStats([pair(0.05), inbound(1000, 0)])
    expect(grade(a, sampleStats([pair(0.05), inbound(1100, 1)]))).toBe('good')
    expect(grade(a, sampleStats([pair(0.05), inbound(1100, 5)]))).toBe('fair')
    expect(grade(a, sampleStats([pair(0.05), inbound(1100, 20)]))).toBe('poor')
    expect(grade(a, sampleStats([pair(0.7), inbound(1100, 0)]))).toBe('poor')
    expect(grade(null, sampleStats([]))).toBe('unknown')
  })
})
