import { SessionBuilder, SessionCipher, SignalProtocolAddress } from '@privacyresearch/libsignal-protocol-typescript'
import { signalApi, type BundleDto } from './api'
import { ab } from './device'
import { bytesEqual, type SignalStore } from './store'
import type { SignalContext } from './device'

// Sesame-lite fan-out: one logical message → one Double-Ratchet ciphertext per
// target device (every device of the recipient + every OTHER device of mine, so
// my devices stay in sync). The server checks the device set and stores each
// ciphertext only until its device acknowledges it.

export type WireEnvelope = { user: string; deviceId: number; type: number; body: string }

/** The recipient has no Signal devices — caller falls back to a legacy (v1) send. */
export class NotV2Error extends Error {}

/** A device presented an identity key other than the contact's (pinned) one. */
export class IdentityMismatchError extends Error {
  readonly contact: string
  readonly identityKey: ArrayBuffer
  constructor(contact: string, identityKey: ArrayBuffer) {
    super(`${contact}'s identity key changed`)
    this.contact = contact
    this.identityKey = identityKey
  }
}

// ── padding: hide exact message length (Signal-style 160-byte buckets) ──

const PAD_BLOCK = 160

export function pad(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const len = Math.ceil((bytes.length + 1) / PAD_BLOCK) * PAD_BLOCK
  const out = new Uint8Array(len)
  out.set(bytes, 0)
  out[bytes.length] = 0x80
  return out
}

export function unpad(bytes: Uint8Array): Uint8Array {
  for (let i = bytes.length - 1; i >= 0; i--) {
    if (bytes[i] === 0x80) return bytes.slice(0, i)
    if (bytes[i] !== 0) break
  }
  throw new Error('Invalid message padding')
}

// The library speaks "binary strings" (one char per byte); the wire speaks base64.
const binaryToB64 = (s: string) => btoa(s)
const b64ToBinary = (s: string) => atob(s)

// ── downgrade guard ─────────────────────────────────────────────────
// Once a contact has been seen with Signal devices, refuse to silently fall back to
// the legacy scheme if the server later claims they have none.

const v2SeenKey = (me: string, peer: string) => `iris-v2-seen:${me}:${peer}`

function markV2Seen(me: string, peer: string) {
  try { localStorage.setItem(v2SeenKey(me, peer), '1') } catch { /* storage blocked */ }
}

export function wasV2Seen(me: string, peer: string): boolean {
  try { return localStorage.getItem(v2SeenKey(me, peer)) === '1' } catch { return false }
}

// ── sessions ────────────────────────────────────────────────────────

export function bundleToDevice(b: BundleDto) {
  return {
    identityKey: ab(b.identityKey),
    registrationId: b.registrationId,
    signedPreKey: { keyId: b.signedPreKey.keyId, publicKey: ab(b.signedPreKey.publicKey), signature: ab(b.signedPreKey.signature) },
    preKey: b.preKey ? { keyId: b.preKey.keyId, publicKey: ab(b.preKey.publicKey) } : undefined,
  }
}

/** Build a session from a prekey bundle (X3DH). The library verifies the signed-prekey signature. */
export async function startSession(store: SignalStore, user: string, bundle: BundleDto, expectedIdentity: ArrayBuffer): Promise<void> {
  const device = bundleToDevice(bundle)
  if (!bytesEqual(device.identityKey, expectedIdentity)) throw new IdentityMismatchError(user, device.identityKey)
  await new SessionBuilder(store, new SignalProtocolAddress(user, bundle.deviceId)).processPreKey(device)
}

export async function encryptForDevice(store: SignalStore, user: string, deviceId: number, plaintext: string): Promise<WireEnvelope> {
  const cipher = new SessionCipher(store, new SignalProtocolAddress(user, deviceId))
  const result = await cipher.encrypt(pad(new TextEncoder().encode(plaintext)).buffer)
  if (!result.body) throw new Error('Encryption produced no ciphertext')
  return { user, deviceId, type: result.type, body: binaryToB64(result.body) }
}

export async function decryptFromDevice(store: SignalStore, user: string, deviceId: number, type: number, body: string): Promise<string> {
  const cipher = new SessionCipher(store, new SignalProtocolAddress(user, deviceId))
  const raw = type === 3
    ? await cipher.decryptPreKeyWhisperMessage(b64ToBinary(body), 'binary')
    : await cipher.decryptWhisperMessage(b64ToBinary(body), 'binary')
  return new TextDecoder().decode(unpad(new Uint8Array(raw)))
}

async function hasSession(store: SignalStore, user: string, deviceId: number): Promise<boolean> {
  return new SessionCipher(store, new SignalProtocolAddress(user, deviceId)).hasOpenSession()
}

export async function forgetSession(store: SignalStore, user: string, deviceId: number): Promise<void> {
  await store.removeSession(new SignalProtocolAddress(user, deviceId).toString())
}

/**
 * Encrypt `plaintext` for every device of `peer` and every other device of mine.
 * `peerIdentity` is the contact's identity key as accepted by the pinning layer;
 * a bundle carrying any other identity aborts the send.
 */
export async function encryptFanout(
  ctx: SignalContext, token: string, peer: string, peerIdentity: ArrayBuffer | null, plaintext: string,
): Promise<WireEnvelope[]> {
  const [peerDevices, myDevices] = await Promise.all([
    signalApi.devicesOf(token, peer),
    signalApi.devicesOf(token, ctx.me),
  ])
  if (peerDevices.length === 0) {
    // TODO(remove-legacy): with every client on v2 this becomes a hard error.
    if (wasV2Seen(ctx.me, peer)) {
      throw new Error(`${peer}'s secure devices are unavailable — refusing to downgrade encryption`)
    }
    throw new NotV2Error(`${peer} has no Signal devices`)
  }
  markV2Seen(ctx.me, peer)
  if (!peerIdentity) throw new Error(`${peer}'s identity key isn't loaded yet`)

  const targets = [
    ...peerDevices.map(d => ({ user: peer, deviceId: d.deviceId, identity: peerIdentity })),
    ...myDevices.filter(d => d.deviceId !== ctx.deviceId).map(d => ({ user: ctx.me, deviceId: d.deviceId, identity: ctx.identityKey })),
  ]

  // `peerIdentity` is what the pinning layer accepted; an unaccepted change is
  // blocked before we get here. So if open sessions saw a different identity, the
  // user accepted a new key — drop the old sessions instead of encrypting to them.
  const seen = await ctx.store.loadRemoteIdentity(peer)
  if (seen && !bytesEqual(seen, peerIdentity)) await ctx.store.forgetContact(peer)

  const envelopes: WireEnvelope[] = []
  for (const t of targets) {
    if (!(await hasSession(ctx.store, t.user, t.deviceId))) {
      await startSession(ctx.store, t.user, await signalApi.bundle(token, t.user, t.deviceId), t.identity)
    }
    envelopes.push(await encryptForDevice(ctx.store, t.user, t.deviceId, plaintext))
  }
  return envelopes
}
