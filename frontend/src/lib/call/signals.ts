// Call-signal bookkeeping that doesn't need React: which incoming signals belong
// to the call we're in, and what to tell the user when a call ends.

import type { CallState } from '../../types'

export type EndReason =
  | 'hangup' | 'declined' | 'busy' | 'no-answer' | 'canceled'
  | 'answered-elsewhere' | 'handled-elsewhere' | 'failed' | 'permission'

/** The peer and call id of whatever call we're part of (ringing, connecting or live). */
export function currentCall(state: CallState): { peer: string; callId: string } | null {
  switch (state.kind) {
    case 'outgoing': return { peer: state.to, callId: state.callId }
    case 'incoming': return { peer: state.from, callId: state.callId }
    case 'active': return { peer: state.peer, callId: state.callId }
    default: return null
  }
}

/**
 * A non-offer signal is only ours if it comes from our peer for our call. Without
 * this, a stray call-end (another caller giving up while we're busy, or a stale
 * end from a previous call) would tear down the live call.
 * Signals without a callId come from older clients; match those on peer alone.
 */
export function belongsToCall(state: CallState, from: string | undefined, callId: string | undefined): boolean {
  const cur = currentCall(state)
  if (!cur || !from || from !== cur.peer) return false
  return callId === undefined || callId === cur.callId
}

/** Notice shown when a call ends, or null to end silently. */
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
