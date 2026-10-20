import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CallEngine, DISCONNECT_GRACE_MS, RECONNECT_GIVE_UP_MS, RING_TIMEOUT_MS } from './engine'
import { FakeDriver, FakeTransport } from './testing'
import type { CallSignal } from './types'

let driver: FakeDriver
let transport: FakeTransport
let engine: CallEngine
let ids = 0

const flush = () => vi.advanceTimersByTimeAsync(0)
const state = () => engine.getSnapshot().state

beforeEach(() => {
  vi.useFakeTimers()
  ids = 0
  driver = new FakeDriver()
  transport = new FakeTransport()
  engine = new CallEngine({ driver, uuid: () => `call-${++ids}` })
  engine.attachTransport(transport)
})
afterEach(() => { vi.useRealTimers() })

const offerFrom = (from: string, callId: string, mode: 'audio' | 'video' = 'video'): CallSignal =>
  ({ type: 'call-offer', from, to: 'me', callId, mode, payload: { type: 'offer', sdp: 'remote-offer' } })

async function dial(peer = 'bob', mode: 'audio' | 'video' = 'audio') {
  await engine.startCall(peer, mode)
  await flush()
}

async function dialAndConnect(peer = 'bob', mode: 'audio' | 'video' = 'audio') {
  await dial(peer, mode)
  transport.deliver({ type: 'call-answer', from: peer, to: 'me', callId: 'call-1', payload: { type: 'answer', sdp: 'a' } })
  await flush()
  driver.peer.setConnection('connected')
}

async function receiveAndAnswer(from = 'bob', mode: 'audio' | 'video' = 'video', callId = 'in-1') {
  transport.deliver(offerFrom(from, callId, mode))
  await flush()
  await engine.accept()
  await flush()
  driver.peer.setConnection('connected')
}

describe('outgoing call', () => {
  it('sends an offer carrying callId and mode, then goes active on answer', async () => {
    await dial('bob', 'video')
    expect(state()).toMatchObject({ kind: 'outgoing', to: 'bob', mode: 'video', callId: 'call-1' })
    const [offer] = transport.ofType('call-offer')
    expect(offer).toMatchObject({ to: 'bob', callId: 'call-1', mode: 'video', payload: { type: 'offer' } })
    expect(offer.reneg).toBeUndefined()
    expect(driver.mediaRequests[0]).toEqual({ audio: true, video: { facing: 'user' } })

    transport.deliver({ type: 'call-answer', from: 'bob', to: 'me', callId: 'call-1', payload: { type: 'answer', sdp: 'a' } })
    await flush()
    expect(state()).toMatchObject({ kind: 'active', peer: 'bob', role: 'caller' })
    expect(driver.peer.remoteDescription).toEqual({ type: 'answer', sdp: 'a' })
    // Announces mute/camera state to the peer once connected.
    expect(transport.ofType('call-state')[0]).toMatchObject({ to: 'bob', callId: 'call-1', muted: false })
  })

  it('forwards local ICE candidates tagged with the callId', async () => {
    await dial()
    driver.peer.handlers.onIceCandidate({ candidate: 'cand', sdpMid: '0', sdpMLineIndex: 0 })
    expect(transport.ofType('call-ice')[0]).toMatchObject({ to: 'bob', callId: 'call-1', payload: { candidate: 'cand' } })
  })

  it('times out after 45s with no-answer and tells the peer', async () => {
    await dial()
    await vi.advanceTimersByTimeAsync(RING_TIMEOUT_MS)
    expect(state().kind).toBe('idle')
    expect(transport.ofType('call-end')[0]).toMatchObject({ to: 'bob', callId: 'call-1', reason: 'no-answer' })
    expect(engine.getSnapshot().notice).toBe("bob didn't answer")
    expect(engine.getSnapshot().summary).toMatchObject({ outcome: 'no-answer', direction: 'outgoing' })
  })

  it('cancel while ringing sends call-end canceled and stops the camera', async () => {
    await dial('bob', 'video')
    const local = engine.getSnapshot().localStream!
    engine.hangUp()
    expect(transport.ofType('call-end')[0]).toMatchObject({ reason: 'canceled' })
    expect(local.getTracks().every((t) => t.readyState === 'ended')).toBe(true)
    expect(state().kind).toBe('idle')
  })

  it('reports busy from the callee', async () => {
    await dial()
    transport.deliver({ type: 'call-end', from: 'bob', to: 'me', callId: 'call-1', reason: 'busy' })
    expect(state().kind).toBe('idle')
    expect(engine.getSnapshot().notice).toBe('bob is on another call')
    expect(engine.getSnapshot().summary?.outcome).toBe('busy')
  })

  it('reports decline from the callee', async () => {
    await dial()
    transport.deliver({ type: 'call-end', from: 'bob', to: 'me', callId: 'call-1', reason: 'declined' })
    expect(engine.getSnapshot().notice).toBe('bob declined the call')
    expect(engine.getSnapshot().summary?.outcome).toBe('declined')
  })

  it('ends with a permission notice when the mic is denied, without sending an offer', async () => {
    driver.denyMedia = true
    await dial()
    expect(state().kind).toBe('idle')
    expect(transport.ofType('call-offer')).toHaveLength(0)
    expect(engine.getSnapshot().notice).toMatch(/Allow microphone/)
  })

  it('ignores signals from other peers or other callIds', async () => {
    await dialAndConnect()
    transport.deliver({ type: 'call-end', from: 'eve', to: 'me', callId: 'call-1', reason: 'hangup' })
    transport.deliver({ type: 'call-end', from: 'bob', to: 'me', callId: 'old', reason: 'hangup' })
    expect(state().kind).toBe('active')
  })
})

describe('incoming call', () => {
  it('rings, then answers with an audio+video stream and an answer signal', async () => {
    transport.deliver(offerFrom('bob', 'in-1', 'video'))
    expect(state()).toMatchObject({ kind: 'incoming', from: 'bob', mode: 'video', callId: 'in-1' })
    await engine.accept()
    await flush()
    expect(driver.mediaRequests[0].video).toEqual({ facing: 'user' })
    expect(driver.peer.remoteDescription).toEqual({ type: 'offer', sdp: 'remote-offer' })
    expect(transport.ofType('call-answer')[0]).toMatchObject({ to: 'bob', callId: 'in-1', payload: { type: 'answer' } })
    expect(state()).toMatchObject({ kind: 'active', role: 'callee' })
  })

  it('can answer a video call with the camera off', async () => {
    transport.deliver(offerFrom('bob', 'in-1', 'video'))
    await engine.accept(false)
    await flush()
    expect(driver.mediaRequests[0].video).toBe(false)
    expect(engine.getSnapshot().cameraOff).toBe(true)
  })

  it('declines with reason declined', async () => {
    transport.deliver(offerFrom('bob', 'in-1'))
    engine.reject()
    expect(transport.ofType('call-end')[0]).toMatchObject({ to: 'bob', callId: 'in-1', reason: 'declined' })
    expect(state().kind).toBe('idle')
  })

  it('queues a decline made while the socket is down and sends it on reconnect', async () => {
    transport.deliver(offerFrom('bob', 'in-1'))
    transport.open = false
    engine.reject()
    expect(transport.sent).toHaveLength(0)
    transport.reconnect()
    expect(transport.ofType('call-end')[0]).toMatchObject({ callId: 'in-1', reason: 'declined' })
  })

  it('shows a missed call when the caller gives up', async () => {
    transport.deliver(offerFrom('bob', 'in-1'))
    transport.deliver({ type: 'call-end', from: 'bob', to: 'me', callId: 'in-1', reason: 'canceled' })
    expect(state().kind).toBe('idle')
    expect(engine.getSnapshot().notice).toBe('Missed call from bob')
    expect(engine.getSnapshot().summary?.outcome).toBe('missed')
  })

  it('rings out after 45s as a missed call', async () => {
    transport.deliver(offerFrom('bob', 'in-1'))
    await vi.advanceTimersByTimeAsync(RING_TIMEOUT_MS)
    expect(state().kind).toBe('idle')
    expect(engine.getSnapshot().summary?.outcome).toBe('missed')
  })

  it('does not accept twice', async () => {
    transport.deliver(offerFrom('bob', 'in-1'))
    await Promise.all([engine.accept(), engine.accept()])
    await flush()
    expect(driver.peers).toHaveLength(1)
    expect(transport.ofType('call-answer')).toHaveLength(1)
  })

  it('buffers ICE that arrives before the call is answered, then applies it', async () => {
    transport.deliver(offerFrom('bob', 'in-1'))
    transport.deliver({ type: 'call-ice', from: 'bob', to: 'me', callId: 'in-1', payload: { candidate: 'early' } })
    await engine.accept()
    await flush()
    expect(driver.peer.addedIce.map((c) => c.candidate)).toEqual(['early'])
  })

  it('stops if the caller cancels while the permission prompt is open', async () => {
    transport.deliver(offerFrom('bob', 'in-1'))
    const accepting = engine.accept()
    transport.deliver({ type: 'call-end', from: 'bob', to: 'me', callId: 'in-1', reason: 'canceled' })
    await accepting
    await flush()
    expect(state().kind).toBe('idle')
    expect(transport.ofType('call-answer')).toHaveLength(0)
    expect(driver.peers.every((p) => p.closed || p === undefined)).toBe(true)
  })
})

describe('busy', () => {
  it('answers a second caller with busy and keeps the live call', async () => {
    await dialAndConnect()
    transport.deliver(offerFrom('carol', 'c-9'))
    expect(transport.ofType('call-end').find((s) => s.to === 'carol')).toMatchObject({ callId: 'c-9', reason: 'busy' })
    expect(state()).toMatchObject({ kind: 'active', peer: 'bob' })
  })

  it('ignores a replay of the same offer (held offer redelivered on reconnect)', async () => {
    transport.deliver(offerFrom('bob', 'in-1'))
    transport.deliver(offerFrom('bob', 'in-1'))
    expect(transport.ofType('call-end')).toHaveLength(0)
    expect(state()).toMatchObject({ kind: 'incoming', callId: 'in-1' })
  })
})

describe('glare (both dial each other)', () => {
  it('yields our outgoing call and answers theirs, silently dropping ours', async () => {
    await dial('bob', 'audio')
    transport.deliver(offerFrom('bob', 'bobs-call', 'audio'))
    await flush()
    await flush()
    expect(state()).toMatchObject({ kind: 'active', peer: 'bob', callId: 'bobs-call', role: 'callee' })
    // We must not send a call-end for our own abandoned call (it would unpin the pair on the relay).
    expect(transport.ofType('call-end')).toHaveLength(0)
    expect(transport.ofType('call-answer')[0]).toMatchObject({ callId: 'bobs-call' })
    // A late "busy" for our abandoned call id must not hurt the live call.
    transport.deliver({ type: 'call-end', from: 'bob', to: 'me', callId: 'call-1', reason: 'busy' })
    expect(state().kind).toBe('active')
  })
})

describe('multi-device', () => {
  it('stops ringing when answered on another device', async () => {
    transport.deliver(offerFrom('bob', 'in-1'))
    transport.deliver({ type: 'call-end', from: 'bob', to: 'me', callId: 'in-1', reason: 'answered-elsewhere' })
    expect(state().kind).toBe('idle')
    expect(engine.getSnapshot().notice).toBe('Answered on another device')
  })

  it('stops silently when declined on another device', async () => {
    transport.deliver(offerFrom('bob', 'in-1'))
    transport.deliver({ type: 'call-end', from: 'bob', to: 'me', callId: 'in-1', reason: 'handled-elsewhere' })
    expect(state().kind).toBe('idle')
    expect(engine.getSnapshot().notice).toBeNull()
  })
})

describe('push-announced incoming (app was killed)', () => {
  it('shows ringing immediately and answers once the held offer arrives', async () => {
    engine.announceIncoming({ from: 'bob', callId: 'in-1', mode: 'video' })
    expect(state()).toMatchObject({ kind: 'incoming', offer: null })
    await engine.accept()
    expect(engine.getSnapshot().accepting).toBe(true)
    expect(driver.peers).toHaveLength(0)
    // socket connects, server replays the pending offer
    transport.deliver(offerFrom('bob', 'in-1', 'video'))
    await flush()
    await flush()
    expect(state()).toMatchObject({ kind: 'active', peer: 'bob' })
    expect(transport.ofType('call-answer')).toHaveLength(1)
  })

  it('a decline before the offer arrives is sent (queued until the socket is open)', async () => {
    transport.open = false
    engine.announceIncoming({ from: 'bob', callId: 'in-1', mode: 'audio' })
    engine.reject()
    transport.reconnect()
    expect(transport.ofType('call-end')[0]).toMatchObject({ to: 'bob', callId: 'in-1', reason: 'declined' })
  })

  it('gives up after 45s if the offer never shows (caller already hung up)', async () => {
    engine.announceIncoming({ from: 'bob', callId: 'in-1', mode: 'audio' })
    await vi.advanceTimersByTimeAsync(RING_TIMEOUT_MS)
    expect(state().kind).toBe('idle')
  })
})

describe('in-call controls', () => {
  it('mute toggles the track and tells the peer', async () => {
    await dialAndConnect()
    transport.sent.length = 0
    engine.toggleMute()
    expect(engine.getSnapshot().muted).toBe(true)
    expect(engine.getSnapshot().localStream!.getAudioTracks()[0].enabled).toBe(false)
    expect(transport.ofType('call-state')[0]).toMatchObject({ muted: true })
  })

  it('tracks remote mute / camera-off', async () => {
    await dialAndConnect()
    transport.deliver({ type: 'call-state', from: 'bob', to: 'me', callId: 'call-1', muted: true, cameraOff: true })
    expect(engine.getSnapshot().remote).toEqual({ muted: true, cameraOff: true })
  })

  it('upgrades voice to video: adds a track and renegotiates with reneg=true', async () => {
    await dialAndConnect('bob', 'audio')
    await engine.toggleCamera()
    const reneg = transport.ofType('call-offer').find((s) => s.reneg)
    expect(reneg).toMatchObject({ to: 'bob', callId: 'call-1', reneg: true })
    expect(state()).toMatchObject({ kind: 'active', mode: 'video' })
    expect(engine.getSnapshot().speakerOn).toBe(true)
    expect(transport.ofType('call-state').at(-1)).toMatchObject({ video: true })
  })

  it('follows the peer upgrading to video', async () => {
    await dialAndConnect('bob', 'audio')
    transport.deliver({ type: 'call-state', from: 'bob', to: 'me', callId: 'call-1', video: true })
    expect(state()).toMatchObject({ mode: 'video' })
  })

  it('camera off stops the track but keeps the sender; on again is replaceTrack only', async () => {
    await dialAndConnect('bob', 'video')
    const before = transport.ofType('call-offer').length
    await engine.toggleCamera()
    expect(engine.getSnapshot().cameraOff).toBe(true)
    await engine.toggleCamera()
    expect(engine.getSnapshot().cameraOff).toBe(false)
    expect(transport.ofType('call-offer').length).toBe(before) // no renegotiation
  })

  it('flips the camera through the driver and tracks facing', async () => {
    await dialAndConnect('bob', 'video')
    engine.flipCamera()
    expect(driver.flips).toBe(1)
    expect(engine.getSnapshot().facing).toBe('environment')
  })

  it('applies a peer renegotiation offer and answers it with reneg=true', async () => {
    await dialAndConnect('bob', 'audio')
    transport.deliver({ type: 'call-offer', from: 'bob', to: 'me', callId: 'call-1', reneg: true, payload: { type: 'offer', sdp: 'r' } })
    await flush()
    expect(transport.ofType('call-answer').at(-1)).toMatchObject({ reneg: true })
  })

  it('grades connection quality from getStats while active', async () => {
    await dialAndConnect()
    await vi.advanceTimersByTimeAsync(2100)
    expect(engine.getSnapshot().quality).toBe('good')
  })
})

describe('reconnection and ICE restart', () => {
  it('caller restarts ICE after the 3s grace when disconnected, and clears the banner on recovery', async () => {
    await dialAndConnect()
    const pc = driver.peer
    pc.setConnection('disconnected')
    expect(engine.getSnapshot().reconnecting).toBe(true)
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS)
    expect(pc.offers.at(-1)).toEqual({ iceRestart: true })
    expect(transport.ofType('call-offer').at(-1)).toMatchObject({ reneg: true })
    pc.setConnection('connected')
    expect(engine.getSnapshot().reconnecting).toBe(false)
    await vi.advanceTimersByTimeAsync(RECONNECT_GIVE_UP_MS)
    expect(state().kind).toBe('active')
  })

  it('restarts immediately on failed', async () => {
    await dialAndConnect()
    driver.peer.setConnection('failed')
    await flush()
    expect(driver.peer.offers.at(-1)).toEqual({ iceRestart: true })
  })

  it('callee asks the caller to restart (call-state restart) instead of offering', async () => {
    await receiveAndAnswer('bob', 'audio')
    driver.peer.setConnection('failed')
    await flush()
    expect(transport.ofType('call-state').at(-1)).toMatchObject({ restart: true })
    expect(driver.peer.offers).toHaveLength(0)
  })

  it('caller restarts when the callee asks', async () => {
    await dialAndConnect()
    transport.deliver({ type: 'call-state', from: 'bob', to: 'me', callId: 'call-1', restart: true })
    await flush()
    expect(driver.peer.offers.at(-1)).toEqual({ iceRestart: true })
  })

  it('drops the call after the 30s reconnect window', async () => {
    await dialAndConnect()
    driver.peer.setConnection('disconnected')
    await vi.advanceTimersByTimeAsync(RECONNECT_GIVE_UP_MS)
    expect(state().kind).toBe('idle')
    expect(transport.ofType('call-end').at(-1)).toMatchObject({ reason: 'failed' })
    expect(engine.getSnapshot().notice).toBe('Call dropped — connection lost')
  })

  it('a network change triggers an ICE restart immediately', async () => {
    await dialAndConnect()
    engine.networkChanged()
    await flush()
    expect(driver.peer.offers.at(-1)).toEqual({ iceRestart: true })
    expect(engine.getSnapshot().reconnecting).toBe(true)
  })

  it('re-pins with call-resume when the socket comes back mid-call and heals a broken link', async () => {
    await dialAndConnect()
    driver.peer.connectionState = 'disconnected'
    transport.reconnect()
    await flush()
    expect(transport.ofType('call-resume')[0]).toMatchObject({ to: 'bob', callId: 'call-1' })
    expect(driver.peer.offers.at(-1)).toEqual({ iceRestart: true })
  })

  it('does not send call-resume for a call that is only ringing in', async () => {
    transport.deliver(offerFrom('bob', 'in-1'))
    transport.reconnect()
    expect(transport.ofType('call-resume')).toHaveLength(0)
  })
})

describe('call summary', () => {
  it('records duration and outcome of a completed call', async () => {
    await dialAndConnect()
    await vi.advanceTimersByTimeAsync(65_000)
    engine.hangUp()
    expect(engine.getSnapshot().summary).toMatchObject({ outcome: 'completed', peer: 'bob', direction: 'outgoing', durationSec: 65 })
    engine.dismissSummary()
    expect(engine.getSnapshot().summary).toBeNull()
  })
})
