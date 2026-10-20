import { useCallback, useEffect, useState } from 'react'
import { get, set } from 'idb-keyval'
import { getMessages } from '../messageStore'
import { groupApi, type GroupDto } from './api'
import { subscribeGroupEvents } from './bus'
import { groupPeer } from './payload'

export type GroupPreview = { text: string; time: string; from: string }

function previewOf(m: { mediaId?: string | null; mimeType?: string | null; content: string }): string {
  if (m.mediaId) return m.mimeType?.startsWith('video/') ? '🎥 Video' : '📷 Photo'
  return m.content
}

/**
 * The account's groups, kept fresh: fetched on login, re-fetched when the server
 * nudges ("groups-changed"), cached for offline start. Previews come from local
 * (encrypted-at-rest) history, newest group first.
 */
export function useGroups(token: string | null, me: string | null) {
  const [groups, setGroups] = useState<GroupDto[]>([])
  const [previews, setPreviews] = useState<Record<string, GroupPreview>>({})

  const refresh = useCallback(async () => {
    if (!token || !me) return
    try {
      const list = await groupApi.mine(token)
      setGroups(list)
      // Metadata only (names, members) — the same things the server already holds.
      set(`groups_list_${me}`, list).catch(() => {})
    } catch { /* offline: keep the cached list */ }
  }, [token, me])

  useEffect(() => {
    if (!token || !me) return
    let cancelled = false
    get<GroupDto[]>(`groups_list_${me}`).then(cached => {
      if (!cancelled && cached?.length) setGroups(prev => (prev.length ? prev : cached))
    }).catch(() => {})
    groupApi.mine(token).then(list => {
      if (cancelled) return
      setGroups(list)
      set(`groups_list_${me}`, list).catch(() => {})
    }).catch(() => { /* offline: keep the cached list */ })
    return () => { cancelled = true }
  }, [token, me])

  useEffect(() => {
    if (!me) return
    let cancelled = false;
    (async () => {
      const map: Record<string, GroupPreview> = {}
      await Promise.all(groups.map(async g => {
        try {
          const hist = await getMessages(me, groupPeer(g.id))
          const last = hist[hist.length - 1]
          if (last) map[g.id] = { text: previewOf(last), time: last.sentAt, from: last.from }
        } catch { /* no history yet */ }
      }))
      if (!cancelled) setPreviews(map)
    })()
    return () => { cancelled = true }
  }, [groups, me])

  useEffect(() => subscribeGroupEvents(e => {
    if (e.kind === 'changed') void refresh()
    if (e.kind === 'message') {
      setPreviews(prev => ({ ...prev, [e.groupId]: { text: previewOf(e.message), time: e.message.sentAt, from: e.message.from } }))
    }
  }), [refresh])

  const sorted = [...groups].sort((a, b) => {
    const ta = previews[a.id]?.time ?? a.createdAt
    const tb = previews[b.id]?.time ?? b.createdAt
    return tb.localeCompare(ta)
  })

  // Logged out: nothing to show (the state is refetched for the next account).
  return { groups: token && me ? sorted : [], previews, refresh, setGroups }
}
