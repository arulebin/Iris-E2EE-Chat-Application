// WebRTC helpers — peer connection setup + signal types
//
// NOTE: For production, replace the free TURN credentials below with a paid
// TURN service (e.g. Twilio NTS, Cloudflare Calls, or Metered paid plan).
// Free TURN relays have limited bandwidth and may stop working without notice.

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    {
      urls: 'turn:a.relay.metered.ca:80',
      username: 'e8dd65b92af4d3283aaceab8',
      credential: 'kMuv3T3wQHOVFdxS'
    },
    {
      urls: 'turn:a.relay.metered.ca:80?transport=tcp',
      username: 'e8dd65b92af4d3283aaceab8',
      credential: 'kMuv3T3wQHOVFdxS'
    },
    {
      urls: 'turn:a.relay.metered.ca:443',
      username: 'e8dd65b92af4d3283aaceab8',
      credential: 'kMuv3T3wQHOVFdxS'
    },
    {
      urls: 'turns:a.relay.metered.ca:443?transport=tcp',
      username: 'e8dd65b92af4d3283aaceab8',
      credential: 'kMuv3T3wQHOVFdxS'
    }
  ],
}

export type CallSignal =
  | { type: 'call-offer';  to: string; from?: string; payload: RTCSessionDescriptionInit }
  | { type: 'call-answer'; to: string; from?: string; payload: RTCSessionDescriptionInit }
  | { type: 'call-ice';    to: string; from?: string; payload: RTCIceCandidateInit }
  | { type: 'call-end';    to: string; from?: string }

/**
 * Create a peer connection wired to:
 *   - send any local ICE candidates to the remote user via `ws`
 *   - call `onTrack` when remote media arrives
 */
export function createPeerConnection(
  ws: WebSocket,
  remoteUser: string,
  onTrack: (stream: MediaStream) => void
): RTCPeerConnection {
  const pc = new RTCPeerConnection(ICE_SERVERS)

  pc.onicecandidate = (e) => {
    if (e.candidate && ws.readyState === WebSocket.OPEN) {
      const signal: CallSignal = {
        type: 'call-ice',
        to: remoteUser,
        payload: e.candidate.toJSON(),
      }
      ws.send(JSON.stringify(signal))
    }
  }

  const stream = new MediaStream()

  pc.ontrack = (e) => {
    if (e.streams && e.streams[0]) {
      onTrack(e.streams[0])
    } else {
      stream.addTrack(e.track)
      onTrack(stream)
    }
  }

  pc.onconnectionstatechange = () => {
    console.log('[WebRTC] connection state:', pc.connectionState)
  }
  
  pc.oniceconnectionstatechange = () => {
    console.log('[WebRTC] ice state:', pc.iceConnectionState)
  }

  pc.onicegatheringstatechange = () => {
    console.log('[WebRTC] gathering state:', pc.iceGatheringState)
  }

  return pc
}
