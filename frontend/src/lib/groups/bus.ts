import type { ChatMessage } from '../../types'

// The chat WebSocket lives in App; group screens subscribe here instead of being
// threaded through App's state. App publishes; components listen while mounted.

export type GroupBusEvent =
  | { kind: 'message'; groupId: string; message: ChatMessage }
  | { kind: 'typing'; groupId: string; from: string; typing: boolean }
  | { kind: 'read'; groupId: string; by: string; at: number }
  | { kind: 'changed' }

type Listener = (e: GroupBusEvent) => void
const listeners = new Set<Listener>()

export function publishGroupEvent(e: GroupBusEvent): void {
  for (const l of [...listeners]) {
    try { l(e) } catch (err) { console.error('[groups] listener failed', err) }
  }
}

export function subscribeGroupEvents(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/**
 * Route one WS frame. Returns true if it was group traffic (the caller stops).
 * `typing` / `read` frames carry a `group` field only for groups.
 */
export function routeGroupFrame(data: { type?: string; group?: string; from?: string; state?: string; by?: string; at?: string }): boolean {
  if (data?.type === 'groups-changed') {
    publishGroupEvent({ kind: 'changed' })
    return true
  }
  if (data?.type === 'typing' && data.group && data.from) {
    publishGroupEvent({ kind: 'typing', groupId: data.group, from: data.from, typing: data.state !== 'stop' })
    return true
  }
  if (data?.type === 'group-read' && data.group && data.by) {
    publishGroupEvent({ kind: 'read', groupId: data.group, by: data.by, at: data.at ? Date.parse(data.at) : Date.now() })
    return true
  }
  return false
}
