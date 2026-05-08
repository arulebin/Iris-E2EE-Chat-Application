// WebRTC helpers — peer connection setup + signal types

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:openrelay.metered.ca:80' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
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

  let stream = new MediaStream()

  pc.ontrack = (e) => {
    if (e.streams && e.streams[0]) {
      onTrack(e.streams[0])
    } else {
      stream.addTrack(e.track)
      onTrack(stream)
    }
  }

  pc.onconnectionstatechange = () => {
    console.log('[WebRTC] state:', pc.connectionState)
  }

  return pc
}
