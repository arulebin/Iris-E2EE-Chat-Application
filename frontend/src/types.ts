// Shared types used across the app + extracted components.
// The data types live in @iris/core (shared with the mobile app); CallState needs
// the DOM's RTCSessionDescriptionInit, so it stays here.
import type { CallMode } from '@iris/core'

export type { UserProfile, FriendRequest, ChatMessage, CallMode } from '@iris/core'

// callId ties every signal to one call, so stray or stale signals (another caller
// giving up, a previous call's late call-end) can't touch the current one.
export type CallState =
  | { kind: 'idle' }
  | { kind: 'outgoing'; to: string; mode: CallMode; callId: string }
  | { kind: 'incoming'; from: string; offer: RTCSessionDescriptionInit; mode: CallMode; callId: string }
  | { kind: 'active'; peer: string; mode: CallMode; callId: string; role: 'caller' | 'callee'; startedAt: number };
