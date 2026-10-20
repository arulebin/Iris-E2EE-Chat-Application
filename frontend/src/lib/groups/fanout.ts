import { SessionCipher, SignalProtocolAddress } from '@privacyresearch/libsignal-protocol-typescript'
import { signalApi } from '../signal/api'
import type { SignalContext } from '../signal/device'
import { encryptForDevice, startSession, type WireEnvelope } from '../signal/messaging'
import { bytesEqual } from '../signal/store'

// Group fan-out: one Double-Ratchet ciphertext per device of every member (plus
// my other devices). Same sessions as 1:1 chats — a group message to Bob uses the
// session I already have with Bob's phone.

export type GroupRecipient = {
  user: string
  /** The member's identity key as accepted by the pinning layer (null = no Signal identity). */
  identity: ArrayBuffer | null
}

export type GroupTarget = { user: string; deviceId: number; identity: ArrayBuffer }

/**
 * Pure: which devices get a copy. Every device of every member except the one
 * sending; members without Signal devices are skipped (they can't receive v2).
 * A member WITH devices but no accepted identity is an error — encrypting to
 * an unverified key is exactly what pinning exists to prevent.
 */
export function groupTargets(
  me: string, myDeviceId: number, myIdentity: ArrayBuffer,
  members: GroupRecipient[], devicesByUser: Record<string, number[]>,
): GroupTarget[] {
  const out: GroupTarget[] = []
  const seen = new Set<string>()
  for (const m of members) {
    if (seen.has(m.user)) continue
    seen.add(m.user)
    const devices = devicesByUser[m.user] ?? []
    if (m.user === me) {
      for (const d of devices) if (d !== myDeviceId) out.push({ user: me, deviceId: d, identity: myIdentity })
      continue
    }
    if (devices.length === 0) continue
    if (!m.identity) throw new Error(`${m.user}'s security key isn't loaded yet`)
    for (const d of devices) out.push({ user: m.user, deviceId: d, identity: m.identity })
  }
  return out
}

async function hasSession(ctx: SignalContext, user: string, deviceId: number): Promise<boolean> {
  return new SessionCipher(ctx.store, new SignalProtocolAddress(user, deviceId)).hasOpenSession()
}

/** Encrypt `plaintext` (already group-wrapped) for every target device. */
export async function encryptGroupFanout(
  ctx: SignalContext, token: string, members: GroupRecipient[], plaintext: string,
): Promise<WireEnvelope[]> {
  const users = [...new Set([...members.map(m => m.user), ctx.me])]
  const lists = await Promise.all(users.map(u => signalApi.devicesOf(token, u).catch(() => [])))
  const devicesByUser: Record<string, number[]> = {}
  users.forEach((u, i) => { devicesByUser[u] = lists[i].map(d => d.deviceId) })

  const roster = members.some(m => m.user === ctx.me) ? members : [...members, { user: ctx.me, identity: ctx.identityKey }]
  const targets = groupTargets(ctx.me, ctx.deviceId, ctx.identityKey, roster, devicesByUser)

  // As in 1:1 sends: the identities passed in are what the user accepted, so
  // sessions built on any other identity are stale (a key change was accepted).
  for (const m of members) {
    if (m.user === ctx.me || !m.identity) continue
    const seen = await ctx.store.loadRemoteIdentity(m.user)
    if (seen && !bytesEqual(seen, m.identity)) await ctx.store.forgetContact(m.user)
  }

  const envelopes: WireEnvelope[] = []
  for (const t of targets) {
    if (!(await hasSession(ctx, t.user, t.deviceId))) {
      await startSession(ctx.store, t.user, await signalApi.bundle(token, t.user, t.deviceId), t.identity)
    }
    envelopes.push(await encryptForDevice(ctx.store, t.user, t.deviceId, plaintext))
  }
  return envelopes
}
