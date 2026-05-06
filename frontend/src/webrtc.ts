// WebRTC helpers — peer connection setup + signal types

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
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

  pc.ontrack = (e) => {
    if (e.streams[0]) onTrack(e.streams[0])
  }

  pc.onconnectionstatechange = () => {
    console.log('[WebRTC] state:', pc.connectionState)
  }

  return pc
}
