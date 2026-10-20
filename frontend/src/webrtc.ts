// WebRTC helpers — peer connection setup + signal types

import { apiBase } from './lib/config';

// Every signal carries the callId of the call it belongs to. reneg marks an
// in-call renegotiation (ICE restart, voice→video upgrade) rather than a new call.
type SignalBase = { to: string; from?: string; callId?: string }
export type CallSignal =
  | (SignalBase & { type: 'call-offer'; payload: RTCSessionDescriptionInit; mode?: 'audio' | 'video'; reneg?: boolean })
  | (SignalBase & { type: 'call-answer'; payload: RTCSessionDescriptionInit; reneg?: boolean })
  | (SignalBase & { type: 'call-ice'; payload: RTCIceCandidateInit })
  | (SignalBase & { type: 'call-end'; reason?: string })
  | (SignalBase & { type: 'call-state'; muted?: boolean; cameraOff?: boolean; video?: boolean; restart?: boolean })
  | (SignalBase & { type: 'call-resume' })

async function getIceServers(token: string | null): Promise<RTCConfiguration> {
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
  // Fallback to public STUN if backend missing/failing.
  // NOTE: STUN alone only connects peers that can reach each other directly
  // (same LAN, or simple NATs). Cross-network calls need the TURN relay from
  // /api/turn/credentials — without it, the connection will end up "failed".
  console.warn('[WebRTC] Using STUN-only fallback — cross-network calls need a TURN server.');
  return {
    iceServers: [
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' },
    ],
  };
}

/**
 * Create a peer connection wired to:
 *   - send local ICE candidates to the remote user through `send` (which always
 *     uses the current socket, so a reconnect mid-call doesn't strand candidates)
 *   - call `onTrack` whenever remote media changes — with a fresh MediaStream
 *     object each time, so React re-renders when video is added mid-call
 */
export async function createPeerConnection(
  send: (signal: CallSignal) => void,
  remoteUser: string,
  callId: string,
  token: string | null,
  onTrack: (stream: MediaStream) => void,
  onStateChange?: (state: RTCPeerConnectionState) => void,
): Promise<RTCPeerConnection> {
  const rtcConfig = await getIceServers(token);
  const pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = (e) => {
    if (e.candidate) send({ type: 'call-ice', to: remoteUser, callId, payload: e.candidate.toJSON() });
  };

  const remote = new MediaStream();
  const publish = () => onTrack(new MediaStream(remote.getTracks()));

  pc.ontrack = (e) => {
    const track = e.track;
    if (!remote.getTracks().includes(track)) remote.addTrack(track);
    track.onended = () => { remote.removeTrack(track); publish(); };
    track.onunmute = publish;
    track.onmute = publish;
    publish();
  };

  pc.onconnectionstatechange = () => onStateChange?.(pc.connectionState);

  return pc;
}
