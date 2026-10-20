import { useEffect, useMemo, useState } from 'react'
import { getTrust, resolveContactKeys, subscribeTrust, type ContactTrust } from '../fingerprint'
import type { GroupRecipient } from './fanout'

export type MemberKeys = {
  /** Every member (me included) with the identity key the pinning layer accepted. */
  recipients: GroupRecipient[]
  /** Members whose key changed and hasn't been accepted — the group is blocked until then. */
  blocked: string[]
  /** Per-member pin state, for verified badges and the safety-number screen. */
  trust: Record<string, ContactTrust | undefined>
  /** Members who can't receive group messages: no Signal identity yet, or keys failed to load. */
  unavailable: string[]
  ready: boolean
}

/**
 * Resolve every member's identity through the same pin check 1:1 chats use, so a
 * group can't be a side door around key-change warnings: if ANY member's key
 * changed, sending to the group is blocked until the user accepts it.
 */
export function useMemberKeys(me: string | null, token: string | null, members: string[]): MemberKeys {
  const others = useMemo(() => members.filter(m => m !== me).sort(), [members, me])
  const key = others.join('\n')
  const [identities, setIdentities] = useState<{ key: string; map: Record<string, ArrayBuffer | null>; failed: string[] }>()
  const [trust, setTrust] = useState<Record<string, ContactTrust | undefined>>({})

  useEffect(() => {
    if (!me || !token) return
    let cancelled = false
    const list = key ? key.split('\n') : []
    Promise.all(list.map(async (m) => {
      try {
        return { m, identity: (await resolveContactKeys(me, m, token)).identityKey, ok: true }
      } catch (err) {
        console.warn(`[groups] no keys for ${m}`, err)
        return { m, identity: null, ok: false }
      }
    })).then(results => {
      if (cancelled) return
      const map: Record<string, ArrayBuffer | null> = {}
      for (const r of results) map[r.m] = r.identity
      setIdentities({ key, map, failed: results.filter(r => !r.ok).map(r => r.m) })
    })
    return () => { cancelled = true }
  }, [me, token, key])

  useEffect(() => {
    if (!me) return
    let cancelled = false
    const list = key ? key.split('\n') : []
    Promise.all(list.map(async m => [m, await getTrust(me, m)] as const)).then(entries => {
      if (!cancelled) setTrust(Object.fromEntries(entries))
    })
    const unsubscribe = subscribeTrust((owner, contact, t) => {
      if (owner === me && list.includes(contact)) setTrust(prev => ({ ...prev, [contact]: t }))
    })
    return () => { cancelled = true; unsubscribe() }
  }, [me, key])

  const ready = identities?.key === key
  const map = ready ? identities!.map : {}
  return {
    recipients: others.map(user => ({ user, identity: map[user] ?? null })),
    blocked: others.filter(m => trust[m]?.changed),
    trust,
    // Group messages are Signal-only, so a legacy-only member (no identity) gets nothing.
    unavailable: ready ? others.filter(m => identities!.failed.includes(m) || !map[m]) : [],
    ready,
  }
}
