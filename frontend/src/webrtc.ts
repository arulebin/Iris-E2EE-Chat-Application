// WebRTC helpers — peer connection setup + signal types

import { apiBase } from './lib/config';

export type CallSignal =
  | { type: 'call-offer';  to: string; from?: string; payload: RTCSessionDescriptionInit; mode?: 'audio' | 'video' }
  | { type: 'call-answer'; to: string; from?: string; payload: RTCSessionDescriptionInit }
  | { type: 'call-ice';    to: string; from?: string; payload: RTCIceCandidateInit }
  | { type: 'call-end';    to: string; from?: string }

async function getIceServers(token: string): Promise<RTCConfiguration> {
  try {
    const res = await fetch(`${apiBase}/api/turn/credentials`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      return (await res.json()) as RTCConfiguration;
    }
  } catch (e) {
    console.error('[WebRTC] Failed to fetch TURN credentials:', e);
  }
  // Fallback to minimal STUN if backend missing/failing
  return {
    iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }]
  };
}

/**
 * Create a peer connection wired to:
 *   - send any local ICE candidates to the remote user via `ws`
 *   - call `onTrack` when remote media arrives
 */
export async function createPeerConnection(
  ws: WebSocket,
  remoteUser: string,
  token: string,
  onTrack: (stream: MediaStream) => void
): Promise<RTCPeerConnection> {
  const rtcConfig = await getIceServers(token);
  const pc = new RTCPeerConnection(rtcConfig)

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
