// Call-signal bookkeeping that doesn't need React (port of frontend/src/lib/call/signals.ts).
import type { CallSignal, CallState, EndReason } from './types'

export function currentCall(state: CallState): { peer: string; callId: string } | null {
  switch (state.kind) {
    case 'outgoing': return { peer: state.to, callId: state.callId }
    case 'incoming': return { peer: state.from, callId: state.callId }
    case 'active': return { peer: state.peer, callId: state.callId }
    default: return null
  }
}

/** A non-offer signal is only ours if it's from our peer for our call (callId-less = old client, match on peer). */
export function belongsToCall(state: CallState, from: string | undefined, callId: string | undefined): boolean {
  const cur = currentCall(state)
  if (!cur || !from || from !== cur.peer) return false
  return callId === undefined || callId === cur.callId
}

export function endNotice(reason: EndReason | string | undefined, peer: string, phase: CallState['kind']): string | null {
  switch (reason) {
    case 'busy': return `${peer} is on another call`
    case 'declined': return `${peer} declined the call`
    case 'no-answer': return phase === 'incoming' ? `Missed call from ${peer}` : `${peer} didn't answer`
    case 'answered-elsewhere': return 'Answered on another device'
    case 'handled-elsewhere': return null
    case 'failed': return 'Call dropped — connection lost'
    case 'permission': return 'Allow microphone and camera access to make calls'
    case 'canceled': return phase === 'incoming' ? `Missed call from ${peer}` : null
    default:
      if (phase === 'outgoing') return `${peer} declined the call`
      if (phase === 'incoming') return `Missed call from ${peer}`
      if (phase === 'active') return `${peer} ended the call`
      return null
  }
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

/** Wire encoding: plain JSON, identical to what the web client sends. */
export function encodeSignal(sig: CallSignal): string {
  return JSON.stringify(sig)
}

/** Parse a raw socket frame into a call signal, or null if it is not one. */
export function decodeSignal(raw: string): CallSignal | null {
  try {
    const v = JSON.parse(raw) as { type?: unknown }
    if (typeof v?.type === 'string' && v.type.startsWith('call-')) return v as CallSignal
  } catch { /* not JSON */ }
  return null
}
