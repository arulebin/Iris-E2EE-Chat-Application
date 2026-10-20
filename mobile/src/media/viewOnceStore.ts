import { useSyncExternalStore } from 'react'
import { createMMKV, type MMKV } from 'react-native-mmkv'

/**
 * Local (per-device) state for view-once media. The server enforces the real guarantee (it deletes the blob
 * after the recipient's first GET and answers 410 afterwards); this store drives the bubble UI and blocks
 * re-opening instantly without a network round trip.
 *
 *   unopened  -> never opened on this device
 *   opened    -> viewed (or the viewer was started; the single GET may already have consumed it)
 *   expired   -> server says it is gone (410) / sent by us (cannot be viewed by the sender)
 */
export type ViewOnceState = 'unopened' | 'opened' | 'expired'

let kv: MMKV | null = null
const store = (): MMKV => (kv ??= createMMKV({ id: 'iris-media-viewonce' }))
const listeners = new Set<() => void>()
const memory = new Map<string, ViewOnceState>()

const key = (mediaId: string) => `vo:${mediaId}`

export function getViewOnceState(mediaId: string): ViewOnceState {
  const m = memory.get(mediaId)
  if (m) return m
  const v = store().getString(key(mediaId))
  const s: ViewOnceState = v === 'opened' || v === 'expired' ? v : 'unopened'
  memory.set(mediaId, s)
  return s
}

function setState(mediaId: string, s: ViewOnceState): void {
  memory.set(mediaId, s)
  store().set(key(mediaId), s)
  listeners.forEach(l => l())
}

/** Mark as opened BEFORE the single GET goes out, so a crash mid-view can never re-open it. */
export function markViewOnceOpened(mediaId: string): void {
  if (getViewOnceState(mediaId) === 'unopened') setState(mediaId, 'opened')
}

export function markViewOnceExpired(mediaId: string): void {
  setState(mediaId, 'expired')
}

export function useViewOnceState(mediaId: string): ViewOnceState {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => getViewOnceState(mediaId),
    () => 'unopened' as ViewOnceState,
  )
}
