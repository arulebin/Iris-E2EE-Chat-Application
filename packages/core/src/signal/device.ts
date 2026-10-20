import * as libsignalNs from '@privacyresearch/libsignal-protocol-typescript'
import { KeyHelper, type KeyPairType } from '@privacyresearch/libsignal-protocol-typescript'
import { signWithLegacyKey, unwrapWithMaster, wrapWithMaster } from '../crypto/account.ts'
import { fromBase64, toBase64 } from '../crypto/bytes.ts'
import type { MasterKey } from '../crypto/keys.ts'
import { randomUint32 } from '../crypto/util.ts'
import { getPlatform } from '../platform.ts'
import type { KV } from '../storage.ts'
import { HttpError, signalApi, type PreKeyDto, type SignedPreKeyDto } from './api.ts'
import { bytesEqual, SignalStore, type DeviceState } from './store.ts'

// Per-device Signal setup.
//
// ONE identity key pair per ACCOUNT, shared by all of the user's devices (like
// Signal's linked devices) and backed up on the server wrapped under a KEK
// derived from the login master secret — the same password-only scheme that
// protects the legacy RSA key, with its own HKDF label. Each DEVICE gets its own
// registration id, signed prekey and one-time prekeys, so sessions (and their
// forward secrecy) are per device.

const IDENTITY_INFO = 'iris-identity-v2'
const PREKEY_BATCH = 100
const PREKEY_LOW_WATER = 25
const MAX_KEY_ID = 0xffffff
const SIGNED_PREKEY_ROTATE_MS = 7 * 24 * 3600_000
const SIGNED_PREKEY_KEEP = 3   // old signed prekeys kept so in-flight first messages still decrypt

export type SignalContext = {
  me: string
  store: SignalStore
  deviceId: number
  identityKey: ArrayBuffer
  /** True when this device was registered during this init — the moment to offer a backup restore. */
  freshDevice: boolean
}

export const ab = (b64: string): ArrayBuffer => fromBase64(b64).buffer
export const b64 = (buf: ArrayBuffer): string => toBase64(new Uint8Array(buf))

export function needsPasswordError(): Error {
  // Matched by App's key-unlock flow (same wording as ensureKeyPair).
  return new Error('Password required to set up secure messaging on this device — log in again')
}

// The package is CommonJS with `exports.default = init`. Bundlers disagree on what
// a default import of that resolves to: vitest/Vite dev give the function, while the
// production (rolldown) build gave the whole exports object — so `libsignal()` threw
// "default is not a function" only in shipped builds. Resolve it explicitly.
type InitCurve = typeof libsignalNs.default
const initCurve: InitCurve = (() => {
  const ns = libsignalNs as unknown as { default: InitCurve | { default: InitCurve } }
  return typeof ns.default === 'function' ? ns.default : ns.default.default
})()

let curvePromise: ReturnType<InitCurve> | null = null
async function derivePublicKey(privKey: ArrayBuffer): Promise<ArrayBuffer> {
  curvePromise ??= initCurve()
  const { Curve } = await curvePromise
  return Curve.createKeyPair(privKey).pubKey
}

function randomKeyId(): number {
  return 1 + (randomUint32(getPlatform().crypto) % (MAX_KEY_ID - PREKEY_BATCH * 50))
}

// ── key generation (pure-ish: only touches the local store) ───────────

export async function generateSignedPreKey(store: SignalStore, identity: KeyPairType, keyId: number): Promise<SignedPreKeyDto> {
  const spk = await KeyHelper.generateSignedPreKey(identity, keyId)
  await store.storeSignedPreKey(keyId, spk.keyPair)
  return { keyId, publicKey: b64(spk.keyPair.pubKey), signature: b64(spk.signature) }
}

/** Generate and locally store `count` one-time prekeys starting at `startId`. Local first: a published key must always be decryptable. */
export async function generatePreKeys(store: SignalStore, startId: number, count: number): Promise<PreKeyDto[]> {
  const out: PreKeyDto[] = []
  for (let i = 0; i < count; i++) {
    const keyId = ((startId + i - 1) % MAX_KEY_ID) + 1
    const pk = await KeyHelper.generatePreKey(keyId)
    await store.storePreKey(keyId, pk.keyPair)
    out.push({ keyId, publicKey: b64(pk.keyPair.pubKey) })
  }
  return out
}

// ── identity ─────────────────────────────────────────────────────────

async function unwrapIdentity(master: MasterKey, rec: { identityKey: string; encryptedIdentityKey: string; identityKeySalt: string }): Promise<KeyPairType> {
  const privKey = (await unwrapWithMaster(master, rec.encryptedIdentityKey, rec.identityKeySalt, IDENTITY_INFO)).buffer
  const pubKey = ab(rec.identityKey)
  // The wrapped private key is authenticated by AES-GCM, but the public half isn't —
  // make sure the server didn't pair our private key with someone else's public key.
  if (!bytesEqual(await derivePublicKey(privKey), pubKey)) throw new Error('Server identity key does not match the backup')
  return { pubKey, privKey }
}

async function obtainIdentity(store: SignalStore, master: MasterKey | null, token: string): Promise<KeyPairType> {
  const local = await store.getIdentityKeyPair()
  if (local) return local

  const server = await signalApi.myIdentity(token)
  if (server.identityKey && server.encryptedIdentityKey && server.identityKeySalt) {
    if (!master) throw needsPasswordError()
    const pair = await unwrapIdentity(master, {
      identityKey: server.identityKey,
      encryptedIdentityKey: server.encryptedIdentityKey,
      identityKeySalt: server.identityKeySalt,
    })
    await store.setIdentityKeyPair(pair)
    return pair
  }

  // First Signal device of this account: create the identity and publish it.
  if (!master) throw needsPasswordError()
  const pair = await KeyHelper.generateIdentityKeyPair()
  const { wrapped, salt } = await wrapWithMaster(master, new Uint8Array(pair.privKey), IDENTITY_INFO)
  // Cross-sign with the legacy RSA key so contacts that pinned it can move their
  // pin to the new identity without a scary "key changed" warning.
  let crossSignature: string | null = null
  try {
    crossSignature = await signWithLegacyKey(master, token, new Uint8Array(pair.pubKey))
  } catch (err) {
    console.warn('Identity cross-signature unavailable; contacts will see a key change', err)
  }
  try {
    await signalApi.publishIdentity(token, {
      identityKey: b64(pair.pubKey), encryptedIdentityKey: wrapped, identityKeySalt: salt, crossSignature,
    })
  } catch (err) {
    // 409: another device of this account published first — adopt that identity.
    if (err instanceof HttpError && err.status === 409) return obtainIdentity(store, master, token)
    throw err
  }
  await store.setIdentityKeyPair(pair)
  return pair
}

// ── device registration ──────────────────────────────────────────────

async function registerDevice(store: SignalStore, identity: KeyPairType, token: string): Promise<DeviceState> {
  const registrationId = KeyHelper.generateRegistrationId()
  const spkId = randomKeyId()
  const signedPreKey = await generateSignedPreKey(store, identity, spkId)
  const firstPreKeyId = randomKeyId()
  const preKeys = await generatePreKeys(store, firstPreKeyId, PREKEY_BATCH)

  let deviceId: number | null = null
  for (let attempt = 0; attempt < 3 && deviceId === null; attempt++) {
    try {
      deviceId = (await signalApi.registerDevice(token, { registrationId, label: getPlatform().deviceLabel(), signedPreKey, preKeys })).deviceId
    } catch (err) {
      // 409 "retry": two devices raced for the same id.
      if (!(err instanceof HttpError && err.status === 409) || attempt === 2) throw err
    }
  }
  const state: DeviceState = {
    deviceId: deviceId!,
    registrationId,
    nextPreKeyId: firstPreKeyId + PREKEY_BATCH,
    signedPreKeys: [{ keyId: spkId, createdAt: Date.now() }],
  }
  // Only remembered once the server accepted it (same lesson as the RSA key).
  await store.setDevice(state)
  return state
}

/** Keep enough one-time prekeys on the server and rotate the signed prekey weekly. */
export async function maintainPreKeys(ctx: SignalContext, token: string): Promise<void> {
  const state = await ctx.store.getDevice()
  if (!state) return
  const { count } = await signalApi.preKeyCount(token, state.deviceId)
  if (count < PREKEY_LOW_WATER) {
    const preKeys = await generatePreKeys(ctx.store, state.nextPreKeyId, PREKEY_BATCH)
    state.nextPreKeyId = ((state.nextPreKeyId + PREKEY_BATCH - 1) % MAX_KEY_ID) + 1
    await ctx.store.setDevice(state)
    await signalApi.uploadPreKeys(token, state.deviceId, preKeys)
  }

  const newest = state.signedPreKeys[state.signedPreKeys.length - 1]
  if (!newest || Date.now() - newest.createdAt > SIGNED_PREKEY_ROTATE_MS) {
    const identity = await ctx.store.getIdentityKeyPair()
    if (!identity) return
    const keyId = randomKeyId()
    const spk = await generateSignedPreKey(ctx.store, identity, keyId)
    state.signedPreKeys.push({ keyId, createdAt: Date.now() })
    while (state.signedPreKeys.length > SIGNED_PREKEY_KEEP) {
      const old = state.signedPreKeys.shift()!
      await ctx.store.removeSignedPreKey(old.keyId)
    }
    await ctx.store.setDevice(state)
    await signalApi.rotateSignedPreKey(token, state.deviceId, spk)
  }
}

/**
 * Bring this device up for Signal messaging:
 *   1. identity: local → else unwrap the server backup → else create + publish
 *   2. device:   local → else register (fresh prekeys)
 * `master` is only needed when the identity isn't cached locally yet; without it
 * this throws the "Password required" error that routes to the unlock screen.
 */
export function initSignal(me: string, master: MasterKey | null, token: string, kv: KV = getPlatform().kv): Promise<SignalContext> {
  // Serialised per account (and across tabs where Web Locks exist) so two
  // overlapping inits — StrictMode double effects, two tabs — can't both
  // register this browser as a new device.
  const run = () => initSignalOnce(me, master, token, kv)
  const locks = getPlatform().getLocks()
  const queued = (initQueue.get(me) ?? Promise.resolve()).catch(() => undefined)
    .then(() => (locks ? locks.request(`iris-signal-init:${me}`, run) : run()))
  initQueue.set(me, queued)
  return queued
}

const initQueue = new Map<string, Promise<unknown>>()

async function initSignalOnce(me: string, master: MasterKey | null, token: string, kv: KV): Promise<SignalContext> {
  const store = new SignalStore(me, kv)
  let device = await store.getDevice()
  const identity = await obtainIdentity(store, master, token)
  let freshDevice = false
  if (!device) {
    device = await registerDevice(store, identity, token)
    freshDevice = true
  }
  const ctx: SignalContext = { me, store, deviceId: device.deviceId, identityKey: identity.pubKey, freshDevice }
  maintainPreKeys(ctx, token).catch(err => console.warn('Prekey maintenance failed', err))
  return ctx
}
