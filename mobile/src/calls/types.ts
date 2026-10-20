// Wire + state types for calls. The signal shapes are byte-compatible with the
// web client (frontend/src/webrtc.ts) and the Java CallRelay: every signal is a
// JSON object sent over the chat WebSocket, carries `to`, and (except for very
// old clients) a `callId`.

export type CallMode = 'audio' | 'video'

export type SessionDescription = { type: string; sdp?: string }
export type IceCandidateInit = {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

type SignalBase = { to: string; from?: string; callId?: string }

export type CallSignal =
  | (SignalBase & { type: 'call-offer'; payload: SessionDescription; mode?: CallMode; reneg?: boolean })
  | (SignalBase & { type: 'call-answer'; payload: SessionDescription; reneg?: boolean })
  | (SignalBase & { type: 'call-ice'; payload: IceCandidateInit })
  | (SignalBase & { type: 'call-end'; reason?: string })
  | (SignalBase & { type: 'call-state'; muted?: boolean; cameraOff?: boolean; video?: boolean; restart?: boolean })
  | (SignalBase & { type: 'call-resume' })

export const CALL_SIGNAL_TYPES = [
  'call-offer', 'call-answer', 'call-ice', 'call-end', 'call-state', 'call-resume',
] as const

export type EndReason =
  | 'hangup' | 'declined' | 'busy' | 'no-answer' | 'canceled'
  | 'answered-elsewhere' | 'handled-elsewhere' | 'failed' | 'permission'

/**
 * `incoming.offer` is null while the call is only *announced* (a push woke us and
 * the socket has not delivered the held offer yet). Accept is queued until it lands.
 */
export type CallState =
  | { kind: 'idle' }
  | { kind: 'outgoing'; to: string; mode: CallMode; callId: string }
  | { kind: 'incoming'; from: string; offer: SessionDescription | null; mode: CallMode; callId: string }
  | { kind: 'active'; peer: string; mode: CallMode; callId: string; role: 'caller' | 'callee'; startedAt: number }

export type RemoteState = { muted: boolean; cameraOff: boolean }

export type CallSummary = {
  peer: string
  direction: 'outgoing' | 'incoming'
  mode: CallMode
  /** Seconds of connected time (0 if never connected). */
  durationSec: number
  outcome: 'completed' | 'missed' | 'declined' | 'no-answer' | 'busy' | 'failed' | 'canceled' | 'other'
  reason?: string
  endedAt: number
}

// ── Minimal W3C-ish WebRTC surface the engine needs ────────────────────────
// react-native-webrtc implements these shapes; tests supply fakes.

export interface TrackLike {
  readonly kind: string
  enabled: boolean
  readonly readyState: string
  readonly muted?: boolean
  stop(): void
}

export interface StreamLike {
  getTracks(): TrackLike[]
  getAudioTracks(): TrackLike[]
  getVideoTracks(): TrackLike[]
  addTrack(t: TrackLike): void
  removeTrack(t: TrackLike): void
}

export interface SenderLike {
  readonly track: TrackLike | null
  replaceTrack(t: TrackLike | null): Promise<void>
}

export interface TransceiverLike {
  direction: string
  readonly sender: SenderLike
  readonly receiver: { readonly track: TrackLike | null }
}

export interface PeerConnectionLike {
  readonly signalingState: string
  readonly connectionState: string
  readonly remoteDescription: SessionDescription | null
  readonly localDescription: { toJSON?(): SessionDescription; type: string; sdp?: string } | null
  createOffer(opts?: { iceRestart?: boolean }): Promise<SessionDescription>
  createAnswer(): Promise<SessionDescription>
  setLocalDescription(d: SessionDescription | { type: 'rollback' }): Promise<void>
  setRemoteDescription(d: SessionDescription): Promise<void>
  addIceCandidate(c: IceCandidateInit): Promise<void>
  addTrack(t: TrackLike, s: StreamLike): unknown
  getTransceivers(): TransceiverLike[]
  getStats(): Promise<{ values(): Iterable<{ type: string; [k: string]: unknown }> }>
  close(): void
}

export interface PeerHandlers {
  onIceCandidate(c: IceCandidateInit): void
  /** Fresh stream object every time remote media changes (so views re-bind). */
  onRemoteStream(s: StreamLike): void
  onConnectionState(s: string): void
}

export type Facing = 'user' | 'environment'

export interface RtcDriver {
  getUserMedia(opts: { audio: boolean; video: false | { facing: Facing } }): Promise<StreamLike>
  /** Fetches ICE servers (TURN) and builds the connection. */
  createPeerConnection(h: PeerHandlers): Promise<PeerConnectionLike>
  /** New stream object holding the same tracks (render snapshots). */
  cloneStream(s: StreamLike): StreamLike
  /** Flip front/back in place (react-native-webrtc `_switchCamera`). */
  switchCamera(track: TrackLike): void
}

/** What the engine needs from the chat WebSocket. Wired by the platform layer. */
export interface CallSignalingTransport {
  /** Returns false when the socket is not open (signal dropped). */
  send(signal: CallSignal): boolean
  isOpen(): boolean
  /** Incoming call-* frames (already JSON-parsed, `from` set by the server). */
  onSignal(cb: (signal: CallSignal) => void): () => void
  /** Fires on every (re)connect of the socket. */
  onOpen(cb: () => void): () => void
}
