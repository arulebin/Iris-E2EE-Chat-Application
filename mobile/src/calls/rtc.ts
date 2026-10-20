// react-native-webrtc adapter for the engine's RtcDriver.
import {
  MediaStream, RTCPeerConnection, mediaDevices,
  type MediaStreamTrack,
} from 'react-native-webrtc'
import type {
  Facing, PeerConnectionLike, PeerHandlers, RtcDriver, StreamLike, TrackLike,
} from './types'

export type IceConfig = { iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> }

const FALLBACK_ICE: IceConfig = {
  // STUN only connects peers that can reach each other directly. Cross-network
  // calls need the TURN relay from GET /api/turn/credentials.
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }],
}

export type RtcDriverOptions = {
  apiBase: string
  getToken: () => string | null | Promise<string | null>
  fetchImpl?: typeof fetch
  log?: (...a: unknown[]) => void
}

/** GET /api/turn/credentials -> Cloudflare ICE servers (TURN). STUN fallback if unavailable. */
export async function fetchIceConfig(o: RtcDriverOptions): Promise<IceConfig> {
  try {
    const token = await o.getToken()
    const res = await (o.fetchImpl ?? fetch)(`${o.apiBase}/api/turn/credentials`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (res.ok) {
      const cfg = (await res.json()) as IceConfig
      if (Array.isArray(cfg?.iceServers) && cfg.iceServers.length) return cfg
    }
  } catch (e) {
    o.log?.('[call] TURN credentials failed', e)
  }
  o.log?.('[call] using STUN-only fallback; cross-network calls need TURN')
  return FALLBACK_ICE
}

const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
const video = (facing: Facing) => ({
  facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 },
})

export function createRnWebrtcDriver(o: RtcDriverOptions): RtcDriver {
  return {
    async getUserMedia(opts) {
      const stream = await mediaDevices.getUserMedia({
        audio: opts.audio ? AUDIO : false,
        video: opts.video ? video(opts.video.facing) : false,
      })
      return stream as unknown as StreamLike
    },

    async createPeerConnection(h: PeerHandlers): Promise<PeerConnectionLike> {
      const cfg = await fetchIceConfig(o)
      const pc = new RTCPeerConnection({ ...cfg, bundlePolicy: 'max-bundle' })
      const remote = new MediaStream()
      const publish = () => h.onRemoteStream(new MediaStream(remote.getTracks()) as unknown as StreamLike)

      pc.addEventListener('icecandidate', (e) => {
        if (e.candidate) h.onIceCandidate(e.candidate.toJSON())
      })
      pc.addEventListener('track', (e) => {
        const track = e.track as MediaStreamTrack
        if (!remote.getTracks().includes(track)) remote.addTrack(track)
        track.addEventListener?.('ended', () => { remote.removeTrack(track); publish() })
        publish()
      })
      pc.addEventListener('connectionstatechange', () => h.onConnectionState(pc.connectionState))
      return pc as unknown as PeerConnectionLike
    },

    cloneStream(s: StreamLike) {
      return new MediaStream(s.getTracks() as unknown as MediaStreamTrack[]) as unknown as StreamLike
    },

    switchCamera(track: TrackLike) {
      ;(track as unknown as MediaStreamTrack)._switchCamera()
    },
  }
}
