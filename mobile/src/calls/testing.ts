// Fakes for exercising CallEngine without WebRTC or a socket (used by the unit tests).
import type {
  CallSignal, CallSignalingTransport, Facing, IceCandidateInit, PeerConnectionLike, PeerHandlers,
  RtcDriver, SenderLike, SessionDescription, StreamLike, TrackLike, TransceiverLike,
} from './types'

export class FakeTrack implements TrackLike {
  enabled = true
  readyState = 'live'
  constructor(readonly kind: string) {}
  stop() { this.readyState = 'ended' }
}

export class FakeStream implements StreamLike {
  constructor(public tracks: TrackLike[] = []) {}
  getTracks() { return [...this.tracks] }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio') }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video') }
  addTrack(t: TrackLike) { this.tracks.push(t) }
  removeTrack(t: TrackLike) { this.tracks = this.tracks.filter((x) => x !== t) }
}

class FakeSender implements SenderLike {
  track: TrackLike | null
  constructor(track: TrackLike | null) { this.track = track }
  async replaceTrack(t: TrackLike | null) { this.track = t }
}

export class FakePeer implements PeerConnectionLike {
  signalingState = 'stable'
  connectionState = 'new'
  remoteDescription: SessionDescription | null = null
  localDescription: { type: string; sdp?: string } | null = null
  closed = false
  transceivers: TransceiverLike[] = []
  addedIce: IceCandidateInit[] = []
  offers: Array<{ iceRestart?: boolean } | undefined> = []
  rollbacks = 0
  private n = 0

  constructor(readonly handlers: PeerHandlers) {}

  async createOffer(opts?: { iceRestart?: boolean }) { this.offers.push(opts); return { type: 'offer', sdp: `offer-${++this.n}` } }
  async createAnswer() { return { type: 'answer', sdp: `answer-${++this.n}` } }
  async setLocalDescription(d: SessionDescription | { type: 'rollback' }) {
    if (d.type === 'rollback') { this.rollbacks++; this.signalingState = 'stable'; return }
    this.localDescription = d as SessionDescription
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'
  }
  async setRemoteDescription(d: SessionDescription) {
    this.remoteDescription = d
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'
  }
  async addIceCandidate(c: IceCandidateInit) { this.addedIce.push(c) }
  addTrack(t: TrackLike, _s: StreamLike) {
    this.transceivers.push({ direction: 'sendrecv', sender: new FakeSender(t), receiver: { track: new FakeTrack(t.kind) } })
  }
  getTransceivers() { return this.transceivers }
  async getStats() {
    return { values: () => [{ type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.05 }, { type: 'inbound-rtp', packetsReceived: 100, packetsLost: 0 }] }
  }
  close() { this.closed = true; this.connectionState = 'closed' }

  /** Test helper: drive the connection state like the real stack would. */
  setConnection(s: string) { this.connectionState = s; this.handlers.onConnectionState(s) }
}

export class FakeDriver implements RtcDriver {
  peers: FakePeer[] = []
  mediaRequests: Array<{ audio: boolean; video: false | { facing: Facing } }> = []
  denyMedia = false
  flips = 0
  async getUserMedia(opts: { audio: boolean; video: false | { facing: Facing } }) {
    this.mediaRequests.push(opts)
    if (this.denyMedia) throw new Error('NotAllowedError')
    const tracks: TrackLike[] = []
    if (opts.audio) tracks.push(new FakeTrack('audio'))
    if (opts.video) tracks.push(new FakeTrack('video'))
    return new FakeStream(tracks)
  }
  async createPeerConnection(h: PeerHandlers) {
    const p = new FakePeer(h)
    this.peers.push(p)
    return p
  }
  cloneStream(s: StreamLike) { return new FakeStream(s.getTracks()) }
  switchCamera(_t: TrackLike) { this.flips++ }
  get peer() { return this.peers[this.peers.length - 1] }
}

export class FakeTransport implements CallSignalingTransport {
  sent: CallSignal[] = []
  open = true
  private sig = new Set<(s: CallSignal) => void>()
  private opens = new Set<() => void>()
  send(s: CallSignal) { if (!this.open) return false; this.sent.push(s); return true }
  isOpen() { return this.open }
  onSignal(cb: (s: CallSignal) => void) { this.sig.add(cb); return () => { this.sig.delete(cb) } }
  onOpen(cb: () => void) { this.opens.add(cb); return () => { this.opens.delete(cb) } }
  deliver(s: CallSignal) { for (const cb of [...this.sig]) cb(s) }
  reconnect() { this.open = true; for (const cb of [...this.opens]) cb() }
  ofType<T extends CallSignal['type']>(type: T) { return this.sent.filter((s) => s.type === type) as Array<Extract<CallSignal, { type: T }>> }
}
