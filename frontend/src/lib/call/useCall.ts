import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createPeerConnection, type CallSignal } from '../../webrtc'
import { playRingback, playRingtone, stopTone } from '../sound'
import type { CallMode, CallState } from '../../types'
import { belongsToCall, currentCall, endNotice } from './signals'
import { grade, sampleStats, type LinkSample, type Quality } from './quality'
import { nativeCallSupported, onPipChange, setCallPip, setCallSpeaker, startCallAudio, stopCallAudio } from './native'

// One-to-one voice/video calls over WebRTC, signalled through the chat socket.
//
// Everything that runs outside a render — socket messages, timers, peer
// connection callbacks — reads the *current* call through refs (stateRef,
// localRef, pcRef …). Closures over React state went stale before: a "no answer"
// timer created when the call started saw no local stream and left the camera on.

const RING_TIMEOUT_MS = 45_000
const DISCONNECT_GRACE_MS = 3_000
const RECONNECT_GIVE_UP_MS = 30_000
const STATS_INTERVAL_MS = 2_000

const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
const videoConstraints = (facing: 'user' | 'environment'): MediaTrackConstraints => ({
  facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 },
})

export type RemoteState = { muted: boolean; cameraOff: boolean }

type Options = {
  token: string | null
  wsRef: RefObject<WebSocket | null>
  /** Called once an incoming call is accepted (e.g. to open that chat). */
  onAccepted?: (peer: string) => void
}

export function useCall({ token, wsRef, onAccepted }: Options) {
  const [state, setStateValue] = useState<CallState>({ kind: 'idle' })
  const stateRef = useRef<CallState>(state)
  const setState = (s: CallState) => { stateRef.current = s; setStateValue(s) }
  // Re-read after an await: TS would otherwise keep a narrowing from before it.
  const readState = (): CallState => stateRef.current

  // The live local stream (mutated as tracks come and go) + a render snapshot.
  const localRef = useRef<MediaStream | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const publishLocal = () => {
    const s = localRef.current
    setLocalStream(s ? new MediaStream(s.getTracks()) : null)
  }
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const pendingIce = useRef<RTCIceCandidateInit[]>([])
  const makingOffer = useRef(false)
  const tokenRef = useRef(token)
  const onAcceptedRef = useRef(onAccepted)
  useEffect(() => { tokenRef.current = token; onAcceptedRef.current = onAccepted })

  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const giveUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [notice, setNotice] = useState<string | null>(null)
  const [muted, setMutedValue] = useState(false)
  const mutedRef = useRef(false)
  const [cameraOff, setCameraOffValue] = useState(false)
  const cameraOffRef = useRef(false)
  const [speakerOn, setSpeakerValue] = useState(false)
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const facingRef = useRef<'user' | 'environment'>('user')
  const [remote, setRemote] = useState<RemoteState>({ muted: false, cameraOff: false })
  const [reconnecting, setReconnecting] = useState(false)
  const [quality, setQuality] = useState<Quality>('unknown')
  const [minimized, setMinimized] = useState(false)
  const [previewHidden, setPreviewHidden] = useState(false)
  const [pipActive, setPipActive] = useState(false)
  const audioSinkRef = useRef<HTMLAudioElement | null>(null)

  const setMuted = (v: boolean) => { mutedRef.current = v; setMutedValue(v) }
  const setCameraOff = (v: boolean) => { cameraOffRef.current = v; setCameraOffValue(v) }

  // ── plumbing ──────────────────────────────────────────────────

  const send = useCallback((sig: CallSignal) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(sig))
  }, [wsRef])

  const clearTimer = (t: RefObject<ReturnType<typeof setTimeout> | null>) => {
    if (t.current) { clearTimeout(t.current); t.current = null }
  }

  const hasLocalVideo = () => !!localRef.current?.getVideoTracks().some((t) => t.readyState === 'live')

  function sendState(extra: Partial<Extract<CallSignal, { type: 'call-state' }>> = {}) {
    const cur = currentCall(stateRef.current)
    if (!cur) return
    send({
      type: 'call-state', to: cur.peer, callId: cur.callId,
      muted: mutedRef.current, cameraOff: cameraOffRef.current || !hasLocalVideo(), video: hasLocalVideo(),
      ...extra,
    })
  }

  async function getMedia(mode: CallMode): Promise<MediaStream | null> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: AUDIO,
        video: mode === 'video' ? videoConstraints(facingRef.current) : false,
      })
    } catch (err) {
      console.error('[call] getUserMedia failed', err)
      return null
    }
  }

  /** Tear everything down. `message` is shown as a notice (null = silent). */
  function finish(message: string | null) {
    clearTimer(ringTimer); clearTimer(graceTimer); clearTimer(giveUpTimer)
    pcRef.current?.close()
    pcRef.current = null
    pendingIce.current = []
    makingOffer.current = false
    localRef.current?.getTracks().forEach((t) => t.stop())
    localRef.current = null
    setLocalStream(null)
    setRemoteStream(null)
    setMuted(false)
    setCameraOff(false)
    setSpeakerValue(false)
    setRemote({ muted: false, cameraOff: false })
    setReconnecting(false)
    setQuality('unknown')
    setMinimized(false)
    setPreviewHidden(false)
    stopCallAudio()
    setCallPip(false)
    setState({ kind: 'idle' })
    if (message) setNotice(message)
  }

  async function flushIce(pc: RTCPeerConnection) {
    const queued = pendingIce.current
    pendingIce.current = []
    for (const c of queued) {
      try { await pc.addIceCandidate(c) } catch (e) { console.warn('[call] addIceCandidate', e) }
    }
  }

  /** In-call renegotiation (ICE restart, adding video). Callee is the "polite" peer. */
  async function renegotiate(opts?: RTCOfferOptions) {
    const pc = pcRef.current
    const cur = currentCall(stateRef.current)
    if (!pc || !cur) return
    try {
      makingOffer.current = true
      const offer = await pc.createOffer(opts)
      if (pc.signalingState !== 'stable') return
      await pc.setLocalDescription(offer)
      send({ type: 'call-offer', to: cur.peer, callId: cur.callId, payload: pc.localDescription!.toJSON(), reneg: true })
    } catch (e) {
      console.warn('[call] renegotiate', e)
    } finally {
      makingOffer.current = false
    }
  }

  /** Only the caller drives ICE restarts (avoids both sides offering at once); the callee asks. */
  function restartIce() {
    const s = stateRef.current
    if (s.kind !== 'active') return
    if (s.role === 'caller') void renegotiate({ iceRestart: true })
    else sendState({ restart: true })
  }

  function onPeerState(pcState: RTCPeerConnectionState) {
    if (pcState === 'connected') {
      clearTimer(graceTimer); clearTimer(giveUpTimer)
      setReconnecting(false)
      return
    }
    if (pcState !== 'disconnected' && pcState !== 'failed') return
    if (stateRef.current.kind !== 'active') {
      if (pcState === 'failed') { endWith('failed'); }
      return
    }
    setReconnecting(true)
    // "disconnected" often heals by itself (Wi-Fi ↔ mobile hand-over); give it a
    // moment before restarting ICE. "failed" never heals — restart right away.
    clearTimer(graceTimer)
    if (pcState === 'failed') restartIce()
    else graceTimer.current = setTimeout(restartIce, DISCONNECT_GRACE_MS)
    giveUpTimer.current ??= setTimeout(() => { giveUpTimer.current = null; endWith('failed') }, RECONNECT_GIVE_UP_MS)
  }

  /** End our side and tell the peer why. */
  function endWith(reason: string) {
    const s = stateRef.current
    const cur = currentCall(s)
    if (cur) send({ type: 'call-end', to: cur.peer, callId: cur.callId, reason })
    finish(cur ? endNotice(reason, cur.peer, s.kind) : null)
  }

  async function newPeerConnection(peer: string, callId: string) {
    const pc = await createPeerConnection(send, peer, callId, tokenRef.current, setRemoteStream, onPeerState)
    pcRef.current = pc
    return pc
  }

  // ── public actions ────────────────────────────────────────────

  async function startCall(peer: string, mode: CallMode) {
    if (!peer || stateRef.current.kind !== 'idle') return
    const callId = crypto.randomUUID()
    setState({ kind: 'outgoing', to: peer, mode, callId })

    const stream = await getMedia(mode)
    const still = readState()
    if (!stream || still.kind !== 'outgoing' || still.callId !== callId) {
      stream?.getTracks().forEach((t) => t.stop())
      if (!stream && still.kind === 'outgoing' && still.callId === callId) finish(endNotice('permission', peer, 'outgoing'))
      return
    }
    localRef.current = stream
    publishLocal()
    setSpeakerValue(mode === 'video')
    startCallAudio(mode === 'video')

    const pc = await newPeerConnection(peer, callId)
    const now = readState()
    if (now.kind !== 'outgoing' || now.callId !== callId) { pc.close(); pcRef.current = null; return } // hung up while fetching TURN
    stream.getTracks().forEach((t) => pc.addTrack(t, stream))
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    send({ type: 'call-offer', to: peer, callId, payload: pc.localDescription!.toJSON(), mode })

    ringTimer.current = setTimeout(() => endWith('no-answer'), RING_TIMEOUT_MS)
  }

  /** Accept the ringing call. A video call can be answered with the camera off (`withVideo` false). */
  async function accept(withVideo = true) {
    const s = stateRef.current
    if (s.kind !== 'incoming') return
    clearTimer(ringTimer)
    const sendVideo = s.mode === 'video' && withVideo
    const stream = await getMedia(sendVideo ? 'video' : 'audio')
    const still = readState()
    if (still.kind !== 'incoming' || still.callId !== s.callId) {
      stream?.getTracks().forEach((t) => t.stop()) // caller gave up during the permission prompt
      return
    }
    if (!stream) {
      send({ type: 'call-end', to: s.from, callId: s.callId, reason: 'declined' })
      finish(endNotice('permission', s.from, 'incoming'))
      return
    }
    localRef.current = stream
    publishLocal()
    setSpeakerValue(s.mode === 'video')
    startCallAudio(s.mode === 'video')
    if (s.mode === 'video' && !sendVideo) setCameraOff(true)

    const pc = await newPeerConnection(s.from, s.callId)
    const now = readState()
    if (now.kind !== 'incoming' || now.callId !== s.callId) { pc.close(); pcRef.current = null; return } // canceled meanwhile
    stream.getTracks().forEach((t) => pc.addTrack(t, stream))
    await pc.setRemoteDescription(s.offer)
    await flushIce(pc)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    send({ type: 'call-answer', to: s.from, callId: s.callId, payload: pc.localDescription!.toJSON() })
    setState({ kind: 'active', peer: s.from, mode: s.mode, callId: s.callId, role: 'callee', startedAt: Date.now() })
    sendState()
    onAcceptedRef.current?.(s.from)
  }

  function reject() {
    const s = stateRef.current
    if (s.kind !== 'incoming') return
    send({ type: 'call-end', to: s.from, callId: s.callId, reason: 'declined' })
    finish(null)
  }

  function hangUp() {
    const s = stateRef.current
    const cur = currentCall(s)
    if (!cur) return
    send({ type: 'call-end', to: cur.peer, callId: cur.callId, reason: s.kind === 'outgoing' ? 'canceled' : 'hangup' })
    finish(null)
  }

  function toggleMute() {
    const next = !mutedRef.current
    localRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next))
    setMuted(next)
    sendState()
  }

  /** The video m-line, whether we're currently sending on it or only receiving. */
  function videoTransceiver(): RTCRtpTransceiver | undefined {
    return pcRef.current?.getTransceivers()
      .find((t) => t.sender.track?.kind === 'video' || t.receiver.track?.kind === 'video')
  }

  /**
   * Camera on/off. Off stops the camera entirely (the privacy light goes out) but
   * keeps the video sender, so turning it back on is a cheap replaceTrack. When
   * there's nothing to send on yet — a voice call, or a video call answered with
   * the camera off (recvonly) — turning the camera on upgrades and renegotiates.
   */
  async function toggleCamera() {
    const pc = pcRef.current
    const stream = localRef.current
    if (!pc || !stream) return
    const live = stream.getVideoTracks()[0]
    if (live) {
      live.stop()
      stream.removeTrack(live)
      await videoTransceiver()?.sender.replaceTrack(null)
      setCameraOff(true)
      publishLocal()
      sendState()
      return
    }
    let track: MediaStreamTrack
    try {
      const v = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(facingRef.current) })
      track = v.getVideoTracks()[0]
    } catch (err) {
      console.error('[call] camera unavailable', err)
      setNotice('Camera unavailable')
      return
    }
    stream.addTrack(track)
    setCameraOff(false)
    publishLocal()
    const tr = videoTransceiver()
    if (tr) {
      const mustNegotiate = tr.direction === 'recvonly' || tr.direction === 'inactive'
      if (mustNegotiate) tr.direction = 'sendrecv'
      await tr.sender.replaceTrack(track)
      tr.sender.setStreams?.(stream)
      if (mustNegotiate) await renegotiate()
    } else {
      pc.addTrack(track, stream)
      await renegotiate()
    }
    const s = stateRef.current
    if (s.kind === 'active' && s.mode === 'audio') {
      setState({ ...s, mode: 'video' })
      setSpeaker(true)
    }
    sendState({ video: true })
  }

  async function flipCamera() {
    const stream = localRef.current
    const current = stream?.getVideoTracks()[0]
    if (!stream || !current) return
    const next = facingRef.current === 'user' ? 'environment' : 'user'
    try {
      const v = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(next) })
      const track = v.getVideoTracks()[0]
      await videoTransceiver()?.sender.replaceTrack(track)
      current.stop()
      stream.removeTrack(current)
      stream.addTrack(track)
      facingRef.current = next
      setFacing(next)
      publishLocal()
    } catch (err) {
      console.warn('[call] flip camera failed (single camera?)', err)
    }
  }

  function setSpeaker(on: boolean) {
    setSpeakerValue(on)
    setCallSpeaker(on)
  }

  // ── incoming signals ──────────────────────────────────────────

  async function handleSignal(sig: CallSignal) {
    const cur = stateRef.current

    if (sig.type === 'call-offer' && !sig.reneg) {
      if (!sig.from) return
      if (cur.kind !== 'idle') {
        // Same call delivered twice (pending offer replayed on reconnect) → ignore.
        if (belongsToCall(cur, sig.from, sig.callId)) return
        send({ type: 'call-end', to: sig.from, callId: sig.callId, reason: 'busy' })
        return
      }
      const callId = sig.callId ?? crypto.randomUUID()
      setState({ kind: 'incoming', from: sig.from, offer: sig.payload, mode: sig.mode ?? 'video', callId })
      ringTimer.current = setTimeout(() => {
        const s = stateRef.current
        if (s.kind === 'incoming' && s.callId === callId) finish(endNotice('no-answer', s.from, 'incoming'))
      }, RING_TIMEOUT_MS)
      return
    }

    if (!belongsToCall(cur, sig.from, sig.callId)) return
    const pc = pcRef.current

    switch (sig.type) {
      case 'call-offer': { // renegotiation
        if (!pc || cur.kind !== 'active') return
        const polite = cur.role === 'callee'
        const collision = makingOffer.current || pc.signalingState !== 'stable'
        if (collision && !polite) return
        try {
          if (collision) await pc.setLocalDescription({ type: 'rollback' })
          await pc.setRemoteDescription(sig.payload)
          await flushIce(pc)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          send({ type: 'call-answer', to: cur.peer, callId: cur.callId, payload: pc.localDescription!.toJSON(), reneg: true })
        } catch (e) {
          console.warn('[call] apply renegotiation', e)
        }
        return
      }
      case 'call-answer': {
        if (!pc) return
        if (sig.reneg) {
          if (pc.signalingState === 'have-local-offer') {
            try { await pc.setRemoteDescription(sig.payload); await flushIce(pc) } catch (e) { console.warn('[call] reneg answer', e) }
          }
          return
        }
        if (cur.kind !== 'outgoing') return
        clearTimer(ringTimer)
        await pc.setRemoteDescription(sig.payload)
        await flushIce(pc)
        setState({ kind: 'active', peer: cur.to, mode: cur.mode, callId: cur.callId, role: 'caller', startedAt: Date.now() })
        sendState()
        return
      }
      case 'call-ice': {
        if (pc && pc.remoteDescription) {
          try { await pc.addIceCandidate(sig.payload) } catch (e) { console.warn('[call] addIceCandidate', e) }
        } else {
          pendingIce.current.push(sig.payload)
        }
        return
      }
      case 'call-end': {
        finish(endNotice(sig.reason, currentCall(cur)!.peer, cur.kind))
        return
      }
      case 'call-state': {
        if (sig.restart && cur.kind === 'active' && cur.role === 'caller') void renegotiate({ iceRestart: true })
        setRemote((r) => ({ muted: sig.muted ?? r.muted, cameraOff: sig.cameraOff ?? r.cameraOff }))
        if (sig.video && cur.kind === 'active' && cur.mode === 'audio') {
          setState({ ...cur, mode: 'video' })
          setSpeaker(true)
        }
        return
      }
    }
  }

  /** The chat socket (re)connected: re-pin this device to the call and heal ICE if needed. */
  function onSocketOpen() {
    const cur = currentCall(stateRef.current)
    if (!cur || stateRef.current.kind === 'incoming') return
    send({ type: 'call-resume', to: cur.peer, callId: cur.callId })
    const pc = pcRef.current
    if (pc && stateRef.current.kind === 'active' && pc.connectionState !== 'connected') restartIce()
  }

  // ── effects ───────────────────────────────────────────────────

  // Ring tones.
  useEffect(() => {
    if (state.kind === 'outgoing') playRingback()
    else if (state.kind === 'incoming') playRingtone()
    else stopTone()
    return () => stopTone()
  }, [state.kind])

  // One persistent remote-audio sink (rendered by CallLayer): keeps audio when minimized.
  useEffect(() => {
    if (audioSinkRef.current) audioSinkRef.current.srcObject = remoteStream
  }, [remoteStream])
  const remoteStreamRef = useRef(remoteStream)
  useEffect(() => { remoteStreamRef.current = remoteStream })
  const attachAudioSink = useCallback((el: HTMLAudioElement | null) => {
    audioSinkRef.current = el
    if (el) el.srcObject = remoteStreamRef.current
  }, [])

  // Notices fade after a few seconds.
  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(id)
  }, [notice])

  // Connection quality from getStats while connected.
  useEffect(() => {
    if (state.kind !== 'active') return
    let prev: LinkSample | null = null
    const id = setInterval(async () => {
      const pc = pcRef.current
      if (!pc) return
      try {
        const sample = sampleStats((await pc.getStats()).values() as Iterable<{ type: string }>)
        setQuality(grade(prev, sample))
        prev = sample
      } catch { /* closing */ }
    }, STATS_INTERVAL_MS)
    return () => clearInterval(id)
  }, [state.kind])

  // Android: system picture-in-picture for video calls when the app is left.
  const videoCall = state.kind === 'active' && state.mode === 'video'
  useEffect(() => {
    setCallPip(videoCall, { width: 9, height: 16 })
  }, [videoCall])
  useEffect(() => onPipChange(setPipActive), [])

  // Keep the screen on during video calls.
  useEffect(() => {
    if (!videoCall || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let released = false
    navigator.wakeLock.request('screen').then((l) => { if (released) void l.release(); else lock = l }).catch(() => {})
    return () => { released = true; void lock?.release() }
  }, [videoCall])

  // Closing the tab/app mid-call tells the peer instead of leaving them on "Reconnecting…".
  const inCall = state.kind !== 'idle'
  useEffect(() => {
    if (!inCall) return
    const onUnload = () => {
      const s = stateRef.current
      const cur = currentCall(s)
      if (!cur) return
      send({ type: 'call-end', to: cur.peer, callId: cur.callId, reason: s.kind === 'incoming' ? 'declined' : 'hangup' })
    }
    window.addEventListener('pagehide', onUnload)
    return () => window.removeEventListener('pagehide', onUnload)
  }, [inCall, send])

  return {
    state, localStream, remoteStream, notice, muted, cameraOff, speakerOn, facing,
    remote, reconnecting, quality, minimized, previewHidden, pipActive, attachAudioSink,
    speakerSupported: nativeCallSupported(),
    setMinimized, setPreviewHidden,
    startCall, accept, reject, hangUp, toggleMute, toggleCamera, flipCamera,
    toggleSpeaker: () => setSpeaker(!speakerOn),
    handleSignal, onSocketOpen,
  }
}

export type CallController = ReturnType<typeof useCall>
