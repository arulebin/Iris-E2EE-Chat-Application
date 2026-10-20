import { get, keys, update } from 'idb-keyval'
import type { ChatMessage } from '../types'

// Authoritative local history for v2 (Signal-protocol) messages.
//
// With forward secrecy the server can't hand a v2 message out again: its
// envelopes are deleted once delivered, and the ratchet keys are gone. So the
// decrypted message is persisted here the moment it's sent or received, and this
// store — not the server — is the source of truth for v2 history. It's also what
// the encrypted backup exports. (Legacy v1 messages stay re-fetchable from the
// server and keep using the separate display cache in App.)

const PREFIX = 'iris-msgs-v2:'
const keyFor = (me: string, peer: string) => `${PREFIX}${me}:${peer}`

const sameMessage = (a: ChatMessage, b: ChatMessage) =>
  (a.id != null && a.id === b.id) || (!!a.clientId && a.clientId === b.clientId)

const bySentAt = (a: ChatMessage, b: ChatMessage) => a.sentAt.localeCompare(b.sentAt)

/** Insert or merge one message (matched by server id, else by clientId). */
export function upsertMessage(me: string, peer: string, msg: ChatMessage): Promise<void> {
  return update<ChatMessage[]>(keyFor(me, peer), (list = []) => {
    const i = list.findIndex(m => sameMessage(m, msg))
    const next = i < 0 ? [...list, msg] : list.map((m, j) => (j === i ? { ...m, ...msg } : m))
    return next.sort(bySentAt)
  })
}

export function upsertMany(me: string, peer: string, msgs: ChatMessage[]): Promise<void> {
  return update<ChatMessage[]>(keyFor(me, peer), (list = []) => {
    const next = [...list]
    for (const msg of msgs) {
      const i = next.findIndex(m => sameMessage(m, msg))
      if (i < 0) next.push(msg)
      else next[i] = { ...next[i], ...msg }
    }
    return next.sort(bySentAt)
  })
}

export async function getMessages(me: string, peer: string): Promise<ChatMessage[]> {
  return (await get<ChatMessage[]>(keyFor(me, peer))) ?? []
}

export async function hasMessage(me: string, peer: string, id: number): Promise<boolean> {
  return (await getMessages(me, peer)).some(m => m.id === id)
}

/** Patch fields (e.g. viewedAt) on a stored message without touching the rest. */
export function patchMessage(me: string, peer: string, match: (m: ChatMessage) => boolean, patch: Partial<ChatMessage>): Promise<void> {
  return update<ChatMessage[]>(keyFor(me, peer), (list = []) => list.map(m => (match(m) ? { ...m, ...patch } : m)))
}

/** Every v2 conversation of `me` — the backup payload. */
export async function exportAll(me: string): Promise<Record<string, ChatMessage[]>> {
  const prefix = `${PREFIX}${me}:`
  const out: Record<string, ChatMessage[]> = {}
  for (const k of await keys()) {
    if (typeof k !== 'string' || !k.startsWith(prefix)) continue
    const list = await get<ChatMessage[]>(k)
    if (list?.length) out[k.slice(prefix.length)] = list
  }
  return out
}

export async function importAll(me: string, conversations: Record<string, ChatMessage[]>): Promise<number> {
  let count = 0
  for (const [peer, list] of Object.entries(conversations)) {
    if (!Array.isArray(list)) continue
    // Only settled messages: a pending clientId-only entry from another device can't be reconciled here.
    const settled = list.filter(m => m && m.id != null && typeof m.sentAt === 'string')
    await upsertMany(me, peer, settled)
    count += settled.length
  }
  return count
}

export async function isEmpty(me: string): Promise<boolean> {
  const prefix = `${PREFIX}${me}:`
  return !(await keys()).some(k => typeof k === 'string' && k.startsWith(prefix))
}

/**
 * Combine the server's conversation list with local v2 history for display:
 *   - legacy (v1) rows come from the server (already decrypted by the caller)
 *   - v2 rows are metadata only on the server; their content comes from the
 *     local store, with server-side fields (viewedAt) refreshed. A v2 row with no
 *     local copy predates this device (and wasn't restored) — it's skipped.
 *   - local messages the server hasn't confirmed yet are kept.
 */
export function mergeHistory(server: ChatMessage[], localV2: ChatMessage[]): ChatMessage[] {
  const localById = new Map(localV2.filter(m => m.id != null).map(m => [m.id!, m]))
  const serverIds = new Set(server.map(m => m.id))
  const merged: ChatMessage[] = []
  for (const m of server) {
    if (m.v === 2) {
      const local = localById.get(m.id!)
      if (local) merged.push({ ...local, viewedAt: m.viewedAt ?? local.viewedAt })
    } else {
      merged.push(m)
    }
  }
  for (const m of localV2) {
    if (m.id == null || !serverIds.has(m.id)) merged.push(m)
  }
  return merged.sort(bySentAt)
}
