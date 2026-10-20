import type { ChatMessage } from '../../types'
import type { GroupEventDto, GroupMemberDto } from './api'

// Group messages reuse the 1:1 Signal machinery: the same per-device sessions,
// envelopes and local history. What makes them "group" messages:
//  - the plaintext is wrapped with the group id INSIDE the encryption, so a
//    recipient files it by what the sender wrote, and a server that relabels an
//    envelope with another groupId is caught (the ids must match);
//  - local history lives under the pseudo-peer `group:<id>` (encrypted at rest
//    like any conversation, and included in backups automatically).

export const GROUP_PEER_PREFIX = 'group:'

export const groupPeer = (groupId: string) => `${GROUP_PEER_PREFIX}${groupId}`
export const isGroupPeer = (peer: string) => peer.startsWith(GROUP_PEER_PREFIX)
export const groupIdOfPeer = (peer: string) => (isGroupPeer(peer) ? peer.slice(GROUP_PEER_PREFIX.length) : null)

type Wire = { iris: 'group'; v: 1; gid: string; m: string }

/** Wrap a message body (text, or a media envelope) for a group. */
export function encodeGroupPayload(groupId: string, inner: string): string {
  const wire: Wire = { iris: 'group', v: 1, gid: groupId, m: inner }
  return JSON.stringify(wire)
}

/** Inverse of encodeGroupPayload; null if `plaintext` isn't a group payload. */
export function decodeGroupPayload(plaintext: string): { groupId: string; inner: string } | null {
  if (!plaintext.startsWith('{')) return null
  try {
    const w = JSON.parse(plaintext) as Partial<Wire>
    if (w?.iris !== 'group' || w.v !== 1 || typeof w.gid !== 'string' || typeof w.m !== 'string') return null
    return { groupId: w.gid, inner: w.m }
  } catch {
    return null
  }
}

// ── system lines ("Alice added Bob") ────────────────────────────────

function name(username: string | null, me: string, members: Map<string, GroupMemberDto>): string {
  if (!username) return 'someone'
  if (username === me) return 'You'
  return members.get(username)?.preferredName || username
}

export function describeEvent(e: GroupEventDto, me: string, members: GroupMemberDto[]): string {
  const byName = new Map(members.map(m => [m.username, m]))
  const actor = name(e.actor, me, byName)
  const target = name(e.target, me, byName)
  switch (e.type) {
    case 'CREATED': return `${actor} created the group${e.detail ? ` "${e.detail}"` : ''}`
    case 'ADDED': return `${actor} added ${target}`
    case 'REMOVED': return `${actor} removed ${target}`
    case 'LEFT': return `${actor} left`
    case 'JOINED': return `${actor} joined via invite link`
    case 'RENAMED': return `${actor} renamed the group to "${e.detail ?? ''}"`
    case 'AVATAR': return `${actor} changed the group photo`
    case 'PROMOTED': return `${target} ${e.target === me ? 'are' : 'is'} now an admin`
    case 'DEMOTED': return `${target} ${e.target === me ? 'are' : 'is'} no longer an admin`
    default: return ''
  }
}

/** Events as timeline rows. Server-known metadata, so they're fetched, never stored. */
export function eventsAsMessages(events: GroupEventDto[], me: string, members: GroupMemberDto[]): ChatMessage[] {
  return events.map(e => ({
    id: null,
    clientId: `event-${e.id}`,
    from: e.actor,
    to: '',
    content: describeEvent(e, me, members),
    sentAt: e.at,
    system: true,
  }))
}

/** Local messages + system lines in one chronological timeline. */
export function mergeTimeline(messages: ChatMessage[], system: ChatMessage[]): ChatMessage[] {
  return [...messages, ...system].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
}

/**
 * "Read" for my messages = every other member has had the group open since.
 * Returns the epoch ms all other members have read up to (0 if none / unknown).
 */
export function readByAllAt(members: GroupMemberDto[], me: string, live: Record<string, number> = {}): number {
  const others = members.filter(m => m.username !== me)
  if (others.length === 0) return 0
  let min = Infinity
  for (const m of others) {
    const t = Math.max(m.lastReadAt ? Date.parse(m.lastReadAt) : 0, live[m.username] ?? 0)
    min = Math.min(min, t)
  }
  return Number.isFinite(min) ? min : 0
}
