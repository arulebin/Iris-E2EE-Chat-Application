// Platform-neutral call state machine. Port of frontend/src/lib/call/useCall.ts
// without React or the DOM: all platform behaviour (WebRTC, WebSocket, native
// audio) comes in through RtcDriver / CallSignalingTransport, so the whole thing
// is unit-testable with fakes.
//
// Everything that runs outside a user action — socket messages, timers, peer
// connection callbacks — reads the *current* call from `this.state`, never from
// a closure, and re-checks the callId after every await (the user can hang up,
// or the caller can give up, while we wait for a permission prompt or TURN).

import { grade, sampleStats, type LinkSample, type Quality } from './quality'
import { belongsToCall, currentCall, endNotice } from './signals'
import type {
  CallMode, CallSignal, CallSignalingTransport, CallState, CallSummary, Facing, IceCandidateInit,
  PeerConnectionLike, RemoteState, RtcDriver, SessionDescription, StreamLike, TransceiverLike,
} from './types'

export const RING_TIMEOUT_MS = 45_000
export const DISCONNECT_GRACE_MS = 3_000
export const RECONNECT_GIVE_UP_MS = 30_000
export const STATS_INTERVAL_MS = 2_000
const NOTICE_MS = 4_000

export type CallSnapshot = {
  state: CallState
  localStream: StreamLike | null
  remoteStream: StreamLike | null
  notice: string | null
  /** Set when a call ends; shown as the "call ended" screen until dismissed. */
  summary: CallSummary | null
  muted: boolean
  cameraOff: boolean
  speakerOn: boolean
  facing: Facing
  remote: RemoteState
  reconnecting: boolean
  quality: Quality
  minimized: boolean
  previewHidden: boolean
  /** The user pressed Answer; media/negotiation is in flight (or waiting for the held offer). */
  accepting: boolean
}

export type EngineDeps = {
  driver: RtcDriver
  uuid: () => string
  now?: () => number
  log?: (...args: unknown[]) => void
}

type Meta = { peer: string; direction: 'outgoing' | 'incoming'; mode: CallMode; connectedAt: number | null }

const INITIAL: CallSnapshot = {
  state: { kind: 'idle' },
  localStream: null, remoteStream: null, notice: null, summary: null,
  muted: false, cameraOff: false, speakerOn: false, facing: 'user',
  remote: { muted: false, cameraOff: false }, reconnecting: false, quality: 'unknown',
  minimized: false, previewHidden: false, accepting: false,
}

type Timer = ReturnType<typeof setTimeout>

export class CallEngine {
  private snap: CallSnapshot = INITIAL
  private listeners = new Set<() => void>()
  private transport: CallSignalingTransport | null = null
  private transportOff: Array<() => void> = []

  private pc: PeerConnectionLike | null = null
  private local: StreamLike | null = null
  private pendingIce: IceCandidateInit[] = []
  private makingOffer = false
  private meta: Meta | null = null
  /** call-end frames that could not be sent (socket down) — flushed on reconnect. */
  private outbox: CallSignal[] = []
  private pendingAccept: { callId: string; withVideo: boolean } | null = null
  private accepting: string | null = null
  /** Calls declined before their offer (and so the caller's name) reached us - answered with a decline when it does. */
  private declinedEarly = new Set<string>()

  private ringTimer: Timer | null = null
  private graceTimer: Timer | null = null
  private giveUpTimer: Timer | null = null
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private noticeTimer: Timer | null = null

  private readonly now: () => number
  private readonly log: (...a: unknown[]) => void

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? Date.now
    this.log = deps.log ?? (() => {})
  }

  // ── store plumbing ─────────────────────────────────────────────

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  getSnapshot = (): CallSnapshot => this.snap

  private set(patch: Partial<CallSnapshot>) {
    this.snap = { ...this.snap, ...patch }
    for (const l of [...this.listeners]) l()
  }

  private get state(): CallState { return this.snap.state }

  attachTransport(t: CallSignalingTransport | null) {
    for (const off of this.transportOff) off()
    this.transportOff = []
    this.transport = t
    if (!t) return
    this.transportOff.push(t.onSignal((s) => { void this.handleSignal(s) }))
    this.transportOff.push(t.onOpen(() => this.onSocketOpen()))
    if (t.isOpen()) this.onSocketOpen()
  }

  private send(sig: CallSignal) {
    const ok = this.transport?.send(sig) ?? false
    // Hang-ups/declines must not be lost to a flaky socket.
    if (!ok && sig.type === 'call-end') this.outbox.push(sig)
  }

  private clear(name: 'ringTimer' | 'graceTimer' | 'giveUpTimer') {
    const t = this[name]
    if (t) { clearTimeout(t); this[name] = null }
  }

  private hasLocalVideo() {
    return !!this.local?.getVideoTracks().some((t) => t.readyState === 'live')
  }

  private publishLocal() {
    this.set({ localStream: this.local ? this.deps.driver.cloneStream(this.local) : null })
  }

  private showNotice(message: string | null) {
    if (this.noticeTimer) clearTimeout(this.noticeTimer)
    this.noticeTimer = null
    this.set({ notice: message })
    if (message) this.noticeTimer = setTimeout(() => this.set({ notice: null }), NOTICE_MS)
  }

  dismissNotice() { this.showNotice(null) }
  dismissSummary() { if (this.snap.summary) this.set({ summary: null }) }
  setMinimized(minimized: boolean) { this.set({ minimized, previewHidden: minimized ? this.snap.previewHidden : false }) }
  setPreviewHidden(previewHidden: boolean) { this.set({ previewHidden }) }

  // ── helpers ────────────────────────────────────────────────────

  private sendState(extra: Partial<Extract<CallSignal, { type: 'call-state' }>> = {}) {
    const cur = currentCall(this.state)
    if (!cur) return
    this.send({
      type: 'call-state', to: cur.peer, callId: cur.callId,
      muted: this.snap.muted, cameraOff: this.snap.cameraOff || !this.hasLocalVideo(), video: this.hasLocalVideo(),
      ...extra,
    })
  }

  private async getMedia(mode: CallMode): Promise<StreamLike | null> {
    try {
      return await this.deps.driver.getUserMedia({
        audio: true,
        video: mode === 'video' ? { facing: this.snap.facing } : false,
      })
    } catch (err) {
      this.log('[call] getUserMedia failed', err)
      return null
    }
  }

  private outcomeOf(reason: string | undefined, phase: CallState['kind'], connected: boolean): CallSummary['outcome'] {
    if (connected) return reason === 'failed' ? 'failed' : 'completed'
    switch (reason) {
      case 'busy': return 'busy'
      case 'declined': return 'declined'
      case 'no-answer': return phase === 'incoming' ? 'missed' : 'no-answer'
      case 'canceled': return phase === 'incoming' ? 'missed' : 'canceled'
      case 'failed': return 'failed'
      default: return phase === 'incoming' ? 'missed' : 'other'
    }
  }

  /**
   * Tear everything down. `notice` is shown briefly (null = silent). `summary`
   * false skips the ended-screen (silent resets, glare yields).
   */
  private finish(notice: string | null, reason?: string, opts: { summary?: boolean } = {}) {
    const phase = this.state.kind
    const meta = this.meta
    this.clear('ringTimer'); this.clear('graceTimer'); this.clear('giveUpTimer')
    if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = null }
    try { this.pc?.close() } catch { /* already closed */ }
    this.pc = null
    this.pendingIce = []
    this.makingOffer = false
    this.local?.getTracks().forEach((t) => t.stop())
    this.local = null
    this.meta = null
    this.pendingAccept = null
    this.accepting = null

    let summary: CallSummary | null = null
    if (meta && phase !== 'idle' && opts.summary !== false) {
      const connected = meta.connectedAt !== null
      summary = {
        peer: meta.peer, direction: meta.direction, mode: this.mode(meta),
        durationSec: connected ? Math.max(0, Math.round((this.now() - meta.connectedAt!) / 1000)) : 0,
        outcome: this.outcomeOf(reason, phase, connected), reason, endedAt: this.now(),
      }
    }
    this.set({
      state: { kind: 'idle' }, localStream: null, remoteStream: null,
      muted: false, cameraOff: false, speakerOn: false, facing: 'user',
      remote: { muted: false, cameraOff: false }, reconnecting: false, quality: 'unknown',
      minimized: false, previewHidden: false, accepting: false,
      summary: summary ?? this.snap.summary,
    })
    if (notice) this.showNotice(notice)
  }

  private mode(meta: Meta): CallMode {
    const s = this.state
    return s.kind === 'active' ? s.mode : meta.mode
  }

  private async flushIce(pc: PeerConnectionLike) {
    const queued = this.pendingIce
    this.pendingIce = []
    for (const c of queued) {
      try { await pc.addIceCandidate(c) } catch (e) { this.log('[call] addIceCandidate', e) }
    }
  }

  private localDesc(pc: PeerConnectionLike): SessionDescription {
    const d = pc.localDescription!
    return d.toJSON ? d.toJSON() : { type: d.type, sdp: d.sdp }
  }

  /** In-call renegotiation (ICE restart, adding video). Callee is the "polite" peer. */
  private async renegotiate(opts?: { iceRestart?: boolean }) {
    const pc = this.pc
    const cur = currentCall(this.state)
    if (!pc || !cur) return
    try {
      this.makingOffer = true
      const offer = await pc.createOffer(opts)
      if (pc.signalingState !== 'stable') return
      await pc.setLocalDescription(offer)
      this.send({ type: 'call-offer', to: cur.peer, callId: cur.callId, payload: this.localDesc(pc), reneg: true })
    } catch (e) {
      this.log('[call] renegotiate', e)
    } finally {
      this.makingOffer = false
    }
  }

  /** Only the caller drives ICE restarts (avoids both sides offering at once); the callee asks. */
  private restartIce() {
    const s = this.state
    if (s.kind !== 'active') return
    if (s.role === 'caller') void this.renegotiate({ iceRestart: true })
    else this.sendState({ restart: true })
  }

  /** The device's network changed (Wi-Fi <-> mobile, new IP): heal media without waiting for ICE to notice. */
  networkChanged() {
    if (this.state.kind !== 'active') return
    this.set({ reconnecting: true })
    this.clear('graceTimer')
    this.restartIce()
    this.giveUpTimer ??= setTimeout(() => { this.giveUpTimer = null; this.endWith('failed') }, RECONNECT_GIVE_UP_MS)
  }

  private onPeerState(pcState: string) {
    if (pcState === 'connected') {
      this.clear('graceTimer'); this.clear('giveUpTimer')
      this.set({ reconnecting: false })
      return
    }
    if (pcState !== 'disconnected' && pcState !== 'failed') return
    if (this.state.kind !== 'active') {
      if (pcState === 'failed') this.endWith('failed')
      return
    }
    this.set({ reconnecting: true })
    // "disconnected" often heals by itself (Wi-Fi <-> mobile hand-over); give it a
    // moment before restarting ICE. "failed" never heals — restart right away.
    this.clear('graceTimer')
    if (pcState === 'failed') this.restartIce()
    else this.graceTimer = setTimeout(() => this.restartIce(), DISCONNECT_GRACE_MS)
    this.giveUpTimer ??= setTimeout(() => { this.giveUpTimer = null; this.endWith('failed') }, RECONNECT_GIVE_UP_MS)
  }

  /** End our side and tell the peer why. */
  private endWith(reason: string) {
    const s = this.state
    const cur = currentCall(s)
    if (cur) this.send({ type: 'call-end', to: cur.peer, callId: cur.callId, reason })
    this.finish(cur ? endNotice(reason, cur.peer, s.kind) : null, reason)
  }

  private async newPeer(): Promise<PeerConnectionLike> {
    const pc = await this.deps.driver.createPeerConnection({
      onIceCandidate: (payload) => {
        const cur = currentCall(this.state)
        if (cur) this.send({ type: 'call-ice', to: cur.peer, callId: cur.callId, payload })
      },
      onRemoteStream: (s) => this.set({ remoteStream: s }),
      onConnectionState: (s) => this.onPeerState(s),
    })
    this.pc = pc
    return pc
  }

  private becomeActive(s: { peer: string; mode: CallMode; callId: string }, role: 'caller' | 'callee') {
    const startedAt = this.now()
    if (this.meta) this.meta.connectedAt = startedAt
    this.set({ state: { kind: 'active', ...s, role, startedAt }, accepting: false })
    if (this.statsTimer) clearInterval(this.statsTimer)
    let prev: LinkSample | null = null
    this.statsTimer = setInterval(async () => {
      const pc = this.pc
      if (!pc) return
      try {
        const sample = sampleStats((await pc.getStats()).values())
        this.set({ quality: grade(prev, sample) })
        prev = sample
      } catch { /* closing */ }
    }, STATS_INTERVAL_MS)
  }

  // ── public actions ─────────────────────────────────────────────

  async startCall(peer: string, mode: CallMode): Promise<void> {
    if (!peer || this.state.kind !== 'idle') return
    const callId = this.deps.uuid()
    this.meta = { peer, direction: 'outgoing', mode, connectedAt: null }
    this.set({ state: { kind: 'outgoing', to: peer, mode, callId }, summary: null, speakerOn: mode === 'video' })

    const stream = await this.getMedia(mode)
    const still = this.state
    if (!stream || still.kind !== 'outgoing' || still.callId !== callId) {
      stream?.getTracks().forEach((t) => t.stop())
      if (!stream && still.kind === 'outgoing' && still.callId === callId) this.finish(endNotice('permission', peer, 'outgoing'), 'permission')
      return
    }
    this.local = stream
    this.publishLocal()

    const pc = await this.newPeer()
    const now = this.state
    if (now.kind !== 'outgoing' || now.callId !== callId) { pc.close(); this.pc = null; return } // hung up while fetching TURN
    stream.getTracks().forEach((t) => pc.addTrack(t, stream))
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    this.send({ type: 'call-offer', to: peer, callId, payload: this.localDesc(pc), mode })
    this.ringTimer = setTimeout(() => this.endWith('no-answer'), RING_TIMEOUT_MS)
  }

  /**
   * A push told us a call is ringing before the socket delivered the offer.
   * Shows the incoming UI right away; the offer fills in when the server replays it.
   */
  announceIncoming(info: { from?: string; callId: string; mode: CallMode }) {
    const cur = this.state
    if (cur.kind !== 'idle') return // already in (or ringing for) a call; the real offer path handles busy
    const from = info.from ?? ''
    this.meta = { peer: from, direction: 'incoming', mode: info.mode, connectedAt: null }
    this.set({ state: { kind: 'incoming', from, offer: null, mode: info.mode, callId: info.callId }, summary: null })
    this.startIncomingRing(info.callId)
  }

  private startIncomingRing(callId: string) {
    this.clear('ringTimer')
    this.ringTimer = setTimeout(() => {
      const s = this.state
      if (s.kind === 'incoming' && s.callId === callId) this.finish(endNotice('no-answer', s.from, 'incoming'), 'no-answer')
    }, RING_TIMEOUT_MS)
  }

  /** Accept the ringing call. A video call can be answered with the camera off (`withVideo` false). */
  async accept(withVideo = true): Promise<void> {
    const s = this.state
    if (s.kind !== 'incoming' || this.accepting === s.callId) return
    if (!s.offer) {
      // Announced by push, offer not here yet: remember the choice, finish when it arrives.
      this.pendingAccept = { callId: s.callId, withVideo }
      this.accepting = s.callId
      this.set({ accepting: true })
      return
    }
    this.accepting = s.callId
    this.set({ accepting: true })
    this.clear('ringTimer')
    const offer = s.offer
    const sendVideo = s.mode === 'video' && withVideo
    const stream = await this.getMedia(sendVideo ? 'video' : 'audio')
    const still = this.state
    if (still.kind !== 'incoming' || still.callId !== s.callId) {
      stream?.getTracks().forEach((t) => t.stop()) // caller gave up during the permission prompt
      return
    }
    if (!stream) {
      this.send({ type: 'call-end', to: s.from, callId: s.callId, reason: 'declined' })
      this.finish(endNotice('permission', s.from, 'incoming'), 'permission')
      return
    }
    this.local = stream
    this.set({ speakerOn: s.mode === 'video', cameraOff: s.mode === 'video' && !sendVideo })
    this.publishLocal()

    const pc = await this.newPeer()
    const now = this.state
    if (now.kind !== 'incoming' || now.callId !== s.callId) { pc.close(); this.pc = null; return } // canceled meanwhile
    stream.getTracks().forEach((t) => pc.addTrack(t, stream))
    await pc.setRemoteDescription(offer)
    await this.flushIce(pc)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    this.send({ type: 'call-answer', to: s.from, callId: s.callId, payload: this.localDesc(pc) })
    this.accepting = null
    this.becomeActive({ peer: s.from, mode: s.mode, callId: s.callId }, 'callee')
    this.sendState()
  }

  reject() {
    const s = this.state
    if (s.kind !== 'incoming') return
    if (s.from) {
      this.send({ type: 'call-end', to: s.from, callId: s.callId, reason: 'declined' })
    } else {
      // Announced by a push that carries no caller: we can only tell the relay once the offer names them.
      if (this.declinedEarly.size > 20) this.declinedEarly.clear()
      this.declinedEarly.add(s.callId)
    }
    this.finish(null, 'declined')
  }

  hangUp() {
    const s = this.state
    const cur = currentCall(s)
    if (!cur) return
    const reason = s.kind === 'outgoing' ? 'canceled' : 'hangup'
    this.send({ type: 'call-end', to: cur.peer, callId: cur.callId, reason })
    this.finish(null, reason)
  }

  toggleMute() {
    const next = !this.snap.muted
    this.local?.getAudioTracks().forEach((t) => { t.enabled = !next })
    this.set({ muted: next })
    this.sendState()
  }

  private videoTransceiver(): TransceiverLike | undefined {
    return this.pc?.getTransceivers()
      .find((t) => t.sender.track?.kind === 'video' || t.receiver.track?.kind === 'video')
  }

  /**
   * Camera on/off. Off stops the camera entirely (the privacy light goes out) but
   * keeps the video sender, so turning it back on is a cheap replaceTrack. When
   * there is nothing to send on yet — a voice call, or a video call answered with
   * the camera off (recvonly) — turning the camera on upgrades and renegotiates.
   */
  async toggleCamera(): Promise<void> {
    const pc = this.pc
    const stream = this.local
    if (!pc || !stream) return
    const live = stream.getVideoTracks()[0]
    if (live) {
      live.stop()
      stream.removeTrack(live)
      await this.videoTransceiver()?.sender.replaceTrack(null)
      this.set({ cameraOff: true })
      this.publishLocal()
      this.sendState()
      return
    }
    let track
    try {
      const v = await this.deps.driver.getUserMedia({ audio: false, video: { facing: this.snap.facing } })
      track = v.getVideoTracks()[0]
    } catch (err) {
      this.log('[call] camera unavailable', err)
      this.showNotice('Camera unavailable')
      return
    }
    if (this.pc !== pc) { track.stop(); return } // call ended meanwhile
    stream.addTrack(track)
    this.set({ cameraOff: false })
    this.publishLocal()
    const tr = this.videoTransceiver()
    if (tr) {
      const mustNegotiate = tr.direction === 'recvonly' || tr.direction === 'inactive'
      if (mustNegotiate) tr.direction = 'sendrecv'
      await tr.sender.replaceTrack(track)
      if (mustNegotiate) await this.renegotiate()
    } else {
      pc.addTrack(track, stream)
      await this.renegotiate()
    }
    const s = this.state
    if (s.kind === 'active' && s.mode === 'audio') {
      this.set({ state: { ...s, mode: 'video' }, speakerOn: true })
    }
    this.sendState({ video: true })
  }

  flipCamera() {
    const track = this.local?.getVideoTracks()[0]
    if (!track) return
    try {
      this.deps.driver.switchCamera(track)
      this.set({ facing: this.snap.facing === 'user' ? 'environment' : 'user' })
    } catch (err) {
      this.log('[call] flip camera failed (single camera?)', err)
    }
  }

  setSpeaker(on: boolean) { this.set({ speakerOn: on }) }
  toggleSpeaker() { this.setSpeaker(!this.snap.speakerOn) }

  // ── incoming signals ───────────────────────────────────────────

  async handleSignal(sig: CallSignal): Promise<void> {
    const cur = this.state

    if (sig.type === 'call-offer' && !sig.reneg) {
      if (!sig.from) return
      await this.handleNewOffer(sig as Extract<CallSignal, { type: 'call-offer' }>, cur)
      return
    }

    if (!belongsToCall(cur, sig.from, sig.callId)) return
    const pc = this.pc

    switch (sig.type) {
      case 'call-offer': { // renegotiation
        if (!pc || cur.kind !== 'active') return
        const polite = cur.role === 'callee'
        const collision = this.makingOffer || pc.signalingState !== 'stable'
        if (collision && !polite) return
        try {
          if (collision) await pc.setLocalDescription({ type: 'rollback' })
          await pc.setRemoteDescription(sig.payload)
          await this.flushIce(pc)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          this.send({ type: 'call-answer', to: cur.peer, callId: cur.callId, payload: this.localDesc(pc), reneg: true })
        } catch (e) {
          this.log('[call] apply renegotiation', e)
        }
        return
      }
      case 'call-answer': {
        if (!pc) return
        if (sig.reneg) {
          if (pc.signalingState === 'have-local-offer') {
            try { await pc.setRemoteDescription(sig.payload); await this.flushIce(pc) } catch (e) { this.log('[call] reneg answer', e) }
          }
          return
        }
        if (cur.kind !== 'outgoing') return
        this.clear('ringTimer')
        await pc.setRemoteDescription(sig.payload)
        await this.flushIce(pc)
        this.becomeActive({ peer: cur.to, mode: cur.mode, callId: cur.callId }, 'caller')
        this.sendState()
        return
      }
      case 'call-ice': {
        if (pc && pc.remoteDescription) {
          try { await pc.addIceCandidate(sig.payload) } catch (e) { this.log('[call] addIceCandidate', e) }
        } else {
          this.pendingIce.push(sig.payload)
        }
        return
      }
      case 'call-end': {
        this.finish(endNotice(sig.reason, currentCall(cur)!.peer, cur.kind), sig.reason)
        return
      }
      case 'call-state': {
        if (sig.restart && cur.kind === 'active' && cur.role === 'caller') void this.renegotiate({ iceRestart: true })
        this.set({ remote: { muted: sig.muted ?? this.snap.remote.muted, cameraOff: sig.cameraOff ?? this.snap.remote.cameraOff } })
        if (sig.video && cur.kind === 'active' && cur.mode === 'audio') {
          this.set({ state: { ...cur, mode: 'video' }, speakerOn: true })
        }
        return
      }
    }
  }

  private async handleNewOffer(sig: Extract<CallSignal, { type: 'call-offer' }>, cur: CallState, autoAccept = false) {
    const from = sig.from!
    const mode = sig.mode ?? 'video'

    if (sig.callId && this.declinedEarly.delete(sig.callId)) {
      this.send({ type: 'call-end', to: from, callId: sig.callId, reason: 'declined' })
      return
    }

    if (cur.kind === 'incoming' && cur.offer === null && (cur.callId === sig.callId || cur.from === from || cur.from === '')) {
      // The held offer for a call we already announced (push) — fill it in.
      const callId = sig.callId ?? cur.callId
      this.set({ state: { kind: 'incoming', from, offer: sig.payload, mode, callId } })
      if (this.meta) { this.meta.mode = mode; this.meta.peer = from }
      const pa = this.pendingAccept
      this.pendingAccept = null
      this.accepting = null
      if (pa) await this.accept(pa.withVideo)
      return
    }

    if (cur.kind === 'outgoing' && cur.to === from && sig.callId !== cur.callId) {
      // Glare: both of us dialled at once. The relay delivered their offer to us; yield
      // (drop our own ring silently) and answer theirs, so exactly one call survives.
      this.finish(null, undefined, { summary: false })
      await this.handleNewOffer(sig, this.state, true)
      return
    }

    if (cur.kind !== 'idle') {
      // Same call delivered twice (pending offer replayed on reconnect) -> ignore.
      if (belongsToCall(cur, from, sig.callId)) return
      this.send({ type: 'call-end', to: from, callId: sig.callId, reason: 'busy' })
      return
    }

    const callId = sig.callId ?? this.deps.uuid()
    this.meta = { peer: from, direction: 'incoming', mode, connectedAt: null }
    this.set({ state: { kind: 'incoming', from, offer: sig.payload, mode, callId }, summary: null })
    this.startIncomingRing(callId)
    if (autoAccept) await this.accept(mode === 'video')
  }

  /** The chat socket (re)connected: flush unsent hang-ups, re-pin to the call and heal ICE if needed. */
  onSocketOpen() {
    const queued = this.outbox
    this.outbox = []
    for (const sig of queued) this.send(sig)
    const cur = currentCall(this.state)
    if (!cur || this.state.kind === 'incoming') return
    this.send({ type: 'call-resume', to: cur.peer, callId: cur.callId })
    const pc = this.pc
    if (pc && this.state.kind === 'active' && pc.connectionState !== 'connected') this.restartIce()
  }

  /** Test/diagnostic helper. */
  get currentPeerConnection() { return this.pc }
}
