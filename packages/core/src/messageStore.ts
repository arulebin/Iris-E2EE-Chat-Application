import { AtRestCipher } from './atRest.ts'
import { getPlatform } from './platform.ts'
import { createMutex, type KeyWrapper, type KV } from './storage.ts'
import type { ChatMessage } from './types.ts'

// Local message history, encrypted at rest.
//
// v2 (Signal-protocol) history is AUTHORITATIVE: with forward secrecy the server
// can't hand a v2 message out again (its envelopes are deleted once delivered,
// and the ratchet keys are gone), so the decrypted message is persisted here the
// moment it's sent or received. It's also what the encrypted backup exports.
// Legacy v1 messages stay re-fetchable from the server; their decrypted copies
// live in a separate display cache, also kept here.
//
// Each conversation is ONE AES-GCM blob under the account's history storage key
// (lib/atRest — non-extractable on the web, Android-Keystore-wrapped in the app).
// What stays in the clear, and why:
//  - the IndexedDB key names, which contain the account and peer usernames:
//    needed to address one conversation (and list them for backup) without
//    decrypting all the others. The server knows who talks to whom anyway.
// Everything else — content, captions, media keys, ids, timestamps, reply links —
// is inside the ciphertext. Plaintext arrays written by older builds are
// re-encrypted the first time they're read or written (see migrateAll).
//
// The history key is separate from the Signal-state key (its own slots and
// Keystore alias), so wiping Signal state on device removal leaves history as it
// was — the same semantics as before history was encrypted.

const V2_PREFIX = 'iris-msgs-v2:'

const sameMessage = (a: ChatMessage, b: ChatMessage) =>
  (a.id != null && a.id === b.id) || (!!a.clientId && a.clientId === b.clientId)

const bySentAt = (a: ChatMessage, b: ChatMessage) => a.sentAt.localeCompare(b.sentAt)

// Serialise read-modify-write per slot. The async crypto can't run inside an
// IndexedDB transaction, so idb's atomic update() no longer covers us: use the
// platform's locks (web: Web Locks, also across tabs) where available, else an
// in-process promise chain.
const fallbackLocks = createMutex()
function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = getPlatform().getLocks()
  if (locks) return locks.request(`iris-history:${name}`, fn)
  return fallbackLocks.request(name, fn)
}

export class HistoryStore {
  readonly me: string
  private readonly kv: KV
  private readonly cipher: AtRestCipher

  constructor(me: string, kv: KV, wrapper: KeyWrapper | null = getPlatform().keyWrapperFor(`${me}#history`)) {
    this.me = me
    this.kv = kv
    this.cipher = new AtRestCipher(kv, `hist:${me}:`, wrapper)
  }

  private v2Slot(peer: string) { return `${V2_PREFIX}${this.me}:${peer}` }
  private legacySlot(peer: string) { return `chat_history_${this.me}_${peer}` }

  /**
   * Read one conversation. Returns the list plus whether it was still plaintext.
   * A blob that won't decrypt (corrupt, or its key was lost) reads as empty —
   * it's unrecoverable, and the next write replaces it. Key-load failures (e.g. a
   * transient Keystore error) propagate, so nothing gets overwritten.
   */
  private async read(slot: string): Promise<{ list: ChatMessage[]; plaintext: boolean }> {
    await this.cipher.getKey()
    const stored = await this.kv.get<unknown>(slot)
    if (stored == null) return { list: [], plaintext: false }
    if (Array.isArray(stored)) return { list: stored as ChatMessage[], plaintext: true }
    if (!(stored instanceof Uint8Array)) return { list: [], plaintext: false }
    try {
      const pt = await this.cipher.open(slot, stored)
      return { list: JSON.parse(new TextDecoder().decode(pt)) as ChatMessage[], plaintext: false }
    } catch (err) {
      console.warn('[history] unreadable conversation, treating as empty', slot, err)
      return { list: [], plaintext: false }
    }
  }

  /** Single put: an interrupted write leaves the previous value (plaintext or not) intact. */
  private async write(slot: string, list: ChatMessage[]): Promise<void> {
    const sealed = await this.cipher.seal(slot, new TextEncoder().encode(JSON.stringify(list)))
    await this.kv.set(slot, sealed)
  }

  private mutate(slot: string, fn: (list: ChatMessage[]) => ChatMessage[]): Promise<void> {
    return withLock(slot, async () => {
      const { list } = await this.read(slot)
      await this.write(slot, fn(list))
    })
  }

  private async readMigrating(slot: string): Promise<ChatMessage[]> {
    const { list, plaintext } = await this.read(slot)
    if (plaintext) {
      await withLock(slot, async () => {
        // Re-check under the lock: another tab may have migrated or appended meanwhile.
        const again = await this.read(slot)
        if (again.plaintext) await this.write(slot, again.list)
      })
    }
    return list
  }

  // ── v2 history (authoritative) ──────────────────────────────────

  getMessages(peer: string): Promise<ChatMessage[]> {
    return this.readMigrating(this.v2Slot(peer))
  }

  /** Insert or merge one message (matched by server id, else by clientId). */
  upsertMessage(peer: string, msg: ChatMessage): Promise<void> {
    return this.upsertMany(peer, [msg])
  }

  upsertMany(peer: string, msgs: ChatMessage[]): Promise<void> {
    return this.mutate(this.v2Slot(peer), list => {
      const next = [...list]
      for (const msg of msgs) {
        const i = next.findIndex(m => sameMessage(m, msg))
        if (i < 0) next.push(msg)
        else next[i] = { ...next[i], ...msg }
      }
      return next.sort(bySentAt)
    })
  }

  patchMessage(peer: string, match: (m: ChatMessage) => boolean, patch: Partial<ChatMessage>): Promise<void> {
    return this.mutate(this.v2Slot(peer), list => list.map(m => (match(m) ? { ...m, ...patch } : m)))
  }

  /**
   * Scan a key prefix for this account's conversations. Usernames aren't
   * restricted, so a prefix like `iris-msgs-v2:bob:` also matches another local
   * account "bob:x". Encrypted blobs prove ownership by decrypting (the AAD binds
   * slot and key); a PLAINTEXT entry is only taken when the rest of the key has no
   * separator in it — ambiguous ones are left for the exact-slot lazy migration.
   */
  private async ownSlots(prefix: string, sep: string): Promise<{ slot: string; rest: string }[]> {
    const out: { slot: string; rest: string }[] = []
    for (const slot of await this.kv.keys(prefix)) {
      const rest = slot.slice(prefix.length)
      if (rest.includes(sep) && Array.isArray(await this.kv.get<unknown>(slot))) continue
      out.push({ slot, rest })
    }
    return out
  }

  /** Every v2 conversation — the backup payload (decrypted here, re-encrypted by lib/backup). */
  async exportAll(): Promise<Record<string, ChatMessage[]>> {
    const out: Record<string, ChatMessage[]> = {}
    for (const { slot, rest } of await this.ownSlots(`${V2_PREFIX}${this.me}:`, ':')) {
      const list = await this.readMigrating(slot)
      if (list.length) out[rest] = list
    }
    return out
  }

  async importAll(conversations: Record<string, ChatMessage[]>): Promise<number> {
    let count = 0
    for (const [peer, list] of Object.entries(conversations)) {
      if (!Array.isArray(list)) continue
      // Only settled messages: a pending clientId-only entry from another device can't be reconciled here.
      const settled = list.filter(m => m && m.id != null && typeof m.sentAt === 'string')
      await this.upsertMany(peer, settled)
      count += settled.length
    }
    return count
  }

  async isEmpty(): Promise<boolean> {
    return (await this.kv.keys(`${V2_PREFIX}${this.me}:`)).length === 0
  }

  // ── legacy (v1) display cache ───────────────────────────────────

  getLegacyCache(peer: string): Promise<ChatMessage[]> {
    return this.readMigrating(this.legacySlot(peer))
  }

  setLegacyCache(peer: string, list: ChatMessage[]): Promise<void> {
    const slot = this.legacySlot(peer)
    return withLock(slot, () => this.write(slot, list))
  }

  // ── migration ──────────────────────────────────────────────────

  /**
   * Encrypt every plaintext conversation left by older builds — including ones
   * that are never opened again. Idempotent; safe to run on every start.
   */
  async migrateAll(): Promise<number> {
    const slots = [
      ...(await this.ownSlots(`${V2_PREFIX}${this.me}:`, ':')),
      ...(await this.ownSlots(`chat_history_${this.me}_`, '_')),
    ]
    let migrated = 0
    for (const { slot } of slots) {
      if (Array.isArray(await this.kv.get<unknown>(slot))) {
        await this.readMigrating(slot)
        migrated++
      }
    }
    return migrated
  }
}

// ── module API: one store per local account, on the platform KV ───────────

const stores = new Map<string, HistoryStore>()
const historyFor = (me: string): HistoryStore => {
  let s = stores.get(me)
  if (!s) stores.set(me, (s = new HistoryStore(me, getPlatform().kv)))
  return s
}

export const getMessages = (me: string, peer: string) => historyFor(me).getMessages(peer)
export const upsertMessage = (me: string, peer: string, msg: ChatMessage) => historyFor(me).upsertMessage(peer, msg)
export const upsertMany = (me: string, peer: string, msgs: ChatMessage[]) => historyFor(me).upsertMany(peer, msgs)
export const patchMessage = (me: string, peer: string, match: (m: ChatMessage) => boolean, patch: Partial<ChatMessage>) =>
  historyFor(me).patchMessage(peer, match, patch)
export const exportAll = (me: string) => historyFor(me).exportAll()
export const importAll = (me: string, conversations: Record<string, ChatMessage[]>) => historyFor(me).importAll(conversations)
export const isEmpty = (me: string) => historyFor(me).isEmpty()
export const getLegacyCache = (me: string, peer: string) => historyFor(me).getLegacyCache(peer)
export const setLegacyCache = (me: string, peer: string, list: ChatMessage[]) => historyFor(me).setLegacyCache(peer, list)
export const migrateHistory = (me: string) => historyFor(me).migrateAll()

export async function hasMessage(me: string, peer: string, id: number): Promise<boolean> {
  return (await getMessages(me, peer)).some(m => m.id === id)
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
