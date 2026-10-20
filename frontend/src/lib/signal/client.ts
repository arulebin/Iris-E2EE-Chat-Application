import type { ChatMessage } from '../../types'
import { parseMediaEnvelope } from '../media'
import { getMessages, upsertMessage } from '../messageStore'
import { maintainPreKeys, type SignalContext } from './device'
import { decryptFromDevice, encryptFanout, forgetSession, NotV2Error, wasV2Seen, type WireEnvelope } from './messaging'
import { decodeGroupPayload, encodeGroupPayload, groupPeer } from '../groups/payload'
import { encryptGroupFanout, type GroupRecipient } from '../groups/fanout'

// App-facing glue between the Signal layer and the chat WebSocket.

export const UNDECRYPTABLE_V2 = "🔒 This message couldn't be decrypted on this device"

const REPLY_TIMEOUT_MS = 15_000
const MAX_ATTEMPTS = 3

/** Server metadata for a v2 message (OutgoingMessage with v = 2). */
export type V2Meta = Omit<ChatMessage, 'content'> & { id: number; content?: string }

type Reply =
  | { type: 'sent'; clientId: string; message: V2Meta }
  | { type: 'send-error'; clientId: string; reason: string; missing?: { user: string; deviceId: number }[]; extra?: { user: string; deviceId: number }[] }

export type SendExtras = {
  mediaId?: string | null
  mimeType?: string | null
  viewOnce?: boolean
  replyToId?: number | null
}

/** Turn decrypted plaintext + server metadata into the message the UI shows. */
export function toChatMessage(meta: V2Meta, plaintext: string): ChatMessage {
  const base: ChatMessage = { ...meta, content: plaintext, v: 2 }
  const envelope = meta.mediaId ? parseMediaEnvelope(plaintext) : null
  return envelope ? { ...base, content: envelope.caption, mediaKey: envelope.key, mimeType: envelope.mime } : base
}

// Serialise ratchet work across tabs of the same device: two tabs decrypting the
// same envelope would race on one session record. Web Locks where available.
function withDeviceLock<T>(me: string, fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  return locks ? locks.request(`iris-signal:${me}`, fn) : fn()
}

export class SignalClient {
  readonly ctx: SignalContext
  private readonly token: string
  private readonly getSocket: () => WebSocket | null
  private readonly pending = new Map<string, (reply: Reply) => void>()
  private maintenance: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: SignalContext, token: string, getSocket: () => WebSocket | null) {
    this.ctx = ctx
    this.token = token
    this.getSocket = getSocket
  }

  /** Feed every WS frame here; returns true if it was a reply to one of our sends. */
  handleReply(frame: { type?: string; clientId?: string }): boolean {
    if ((frame.type !== 'sent' && frame.type !== 'send-error') || !frame.clientId) return false
    const resolve = this.pending.get(frame.clientId)
    if (!resolve) return false
    this.pending.delete(frame.clientId)
    resolve(frame as Reply)
    return true
  }

  private await(clientId: string): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(clientId)
        reject(new Error('No confirmation from the server — check your connection'))
      }, REPLY_TIMEOUT_MS)
      this.pending.set(clientId, reply => {
        clearTimeout(timer)
        resolve(reply)
      })
    })
  }

  /**
   * Send one v2 message. Re-encrypts and retries when the server reports a stale
   * device list (Sesame-lite). Throws NotV2Error if the recipient has no Signal
   * devices — the caller then sends legacy. Persists and returns the sent message.
   */
  async send(peer: string, peerIdentity: ArrayBuffer | null, plaintext: string, extras: SendExtras = {}): Promise<ChatMessage> {
    return withDeviceLock(this.ctx.me, async () => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const envelopes: WireEnvelope[] = await encryptFanout(this.ctx, this.token, peer, peerIdentity, plaintext)
        const ws = this.getSocket()
        if (ws?.readyState !== WebSocket.OPEN) throw new Error('Not connected')
        const clientId = crypto.randomUUID()
        const reply = this.await(clientId)
        ws.send(JSON.stringify({
          type: 'chat', v: 2, to: peer, clientId, envelopes,
          mediaId: extras.mediaId ?? null,
          mimeType: extras.mimeType ?? null,
          viewOnce: extras.viewOnce ?? false,
          replyToId: extras.replyToId ?? null,
        }))
        const r = await reply

        if (r.type === 'sent') {
          const msg = toChatMessage(r.message, plaintext)
          await upsertMessage(this.ctx.me, peer, msg)
          return msg
        }
        if (r.reason === 'device-mismatch') {
          // Removed devices: drop their sessions. New devices: get a session next round.
          for (const d of r.extra ?? []) await forgetSession(this.ctx.store, d.user, d.deviceId)
          continue
        }
        if (r.reason === 'recipient-not-v2' && !wasV2Seen(this.ctx.me, peer)) throw new NotV2Error(`${peer} has no Signal devices`)
        throw new Error(`Message rejected by the server (${r.reason})`)
      }
      throw new Error('Could not reach all of the recipient\'s devices — try again')
    })
  }

  /**
   * Send one group message: a ciphertext for every device of every member (the
   * group id travels INSIDE the encryption, see lib/groups/payload). Same
   * stale-device retry as 1:1. Persists under `group:<id>` and returns it.
   */
  async sendGroup(groupId: string, members: GroupRecipient[], body: string, extras: SendExtras = {}): Promise<ChatMessage> {
    const plaintext = encodeGroupPayload(groupId, body)
    return withDeviceLock(this.ctx.me, async () => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const envelopes = await encryptGroupFanout(this.ctx, this.token, members, plaintext)
        const ws = this.getSocket()
        if (ws?.readyState !== WebSocket.OPEN) throw new Error('Not connected')
        const clientId = crypto.randomUUID()
        const reply = this.await(clientId)
        ws.send(JSON.stringify({
          type: 'chat', v: 2, groupId, clientId, envelopes,
          mediaId: extras.mediaId ?? null,
          mimeType: extras.mimeType ?? null,
          viewOnce: false,
          replyToId: extras.replyToId ?? null,
        }))
        const r = await reply

        if (r.type === 'sent') {
          const msg: ChatMessage = { ...toChatMessage(r.message, body), groupId }
          await upsertMessage(this.ctx.me, groupPeer(groupId), msg)
          return msg
        }
        if (r.reason === 'device-mismatch') {
          // Removed members/devices: drop their sessions. New ones: sessions next round.
          for (const d of r.extra ?? []) await forgetSession(this.ctx.store, d.user, d.deviceId)
          continue
        }
        if (r.reason === 'not-a-member') throw new Error("You're no longer a member of this group")
        if (r.reason === 'no-snaps-in-groups') throw new Error("Snaps can't be sent to groups")
        throw new Error(`Message rejected by the server (${r.reason})`)
      }
      throw new Error("Could not reach every member's devices — try again")
    })
  }

  /**
   * Open one delivered envelope, persist the result, and return it. Idempotent:
   * a message already in local history (redelivery, another tab) isn't decrypted
   * twice — which would fail, since its ratchet key is already used up.
   */
  async open(frame: { envType: number; body: string; message: V2Meta }): Promise<{ peer: string; message: ChatMessage }> {
    const meta = frame.message
    const groupId = meta.groupId ?? null
    const peer = groupId ? groupPeer(groupId) : meta.from === this.ctx.me ? meta.to : meta.from
    return withDeviceLock(this.ctx.me, async () => {
      const existing = (await getMessages(this.ctx.me, peer)).find(m => m.id === meta.id)
      if (existing) return { peer, message: existing }

      let message: ChatMessage
      try {
        if (meta.senderDeviceId == null) throw new Error('Envelope without sender device')
        const plaintext = await decryptFromDevice(this.ctx.store, meta.from, meta.senderDeviceId, frame.envType, frame.body)
        // The group id inside the ciphertext must match the server's label: a group
        // message relabelled into another group — or into a 1:1 chat — is rejected.
        const wrapped = decodeGroupPayload(plaintext)
        if ((wrapped?.groupId ?? null) !== groupId) throw new Error('Group label mismatch')
        message = wrapped ? { ...toChatMessage(meta, wrapped.inner), groupId } : toChatMessage(meta, plaintext)
      } catch (err) {
        console.error('Signal decrypt failed', err)
        message = { ...meta, content: UNDECRYPTABLE_V2, v: 2 }
      }
      await upsertMessage(this.ctx.me, peer, message)
      // A session-starting message used up one of our one-time prekeys.
      if (frame.envType === 3) this.scheduleMaintenance()
      return { peer, message }
    })
  }

  private scheduleMaintenance() {
    if (this.maintenance) return
    this.maintenance = setTimeout(() => {
      this.maintenance = null
      maintainPreKeys(this.ctx, this.token).catch(err => console.warn('Prekey maintenance failed', err))
    }, 5_000)
  }

  dispose() {
    if (this.maintenance) clearTimeout(this.maintenance)
    this.pending.clear()
  }
}
