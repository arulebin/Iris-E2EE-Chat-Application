import { verifyLegacySignature } from './crypto/account.ts'
import { toHex, concat, utf8 } from './crypto/bytes.ts'
import { rsaPublicFromJwk, type RsaPublicKey } from './crypto/keys.ts'
import type { RsaJwk } from './crypto/provider.ts'
import { getPlatform } from './platform.ts'
import * as sn from './safetyNumber.ts'
import { signalApi } from './signal/api.ts'
import { ab } from './signal/device.ts'
import { SignalStore } from './signal/store.ts'

type PublicJwk = { kty?: string; n?: string; e?: string }

// Key verification: safety numbers + trust-on-first-use pinning.
//
// The server hands out everyone's public key, so on its own nothing stops it from
// swapping in a key it controls (a MITM). Two defences live here:
//   1. Pinning — the first key we see for a contact is remembered; any later
//      change is surfaced to the user and blocks sending until acknowledged.
//   2. Safety numbers — a 60-digit code derived from BOTH keys that the two
//      people compare out-of-band (in person, QR, call). Matching numbers prove
//      neither side was handed a substituted key.

const PIN_PREFIX = 'iris-key-pin-v1'

// The hashing itself (canonical key bytes, iterated SHA-512 safety numbers) lives in
// safetyNumber.ts over a CryptoProvider; these wrappers bind it to the platform one.

/** Stable SHA-256 key fingerprint (hex) — what gets pinned per contact. */
export function keyFingerprint(jwk: PublicJwk): Promise<string> {
  return sn.keyFingerprint(getPlatform().crypto, jwk)
}

/** 60-digit safety number from two Signal identity keys (halves sorted, as Signal does). */
export function identitySafetyNumber(
  localId: string, localKey: ArrayBuffer, remoteId: string, remoteKey: ArrayBuffer,
  iterations = sn.SAFETY_ITERATIONS,
): Promise<string> {
  return sn.identitySafetyNumber(getPlatform().crypto, localId, new Uint8Array(localKey), remoteId, new Uint8Array(remoteKey), iterations)
}

/**
 * 60-digit safety number for a conversation. Order-independent: both people
 * see the same digits because the halves are sorted by username.
 */
export function computeSafetyNumber(userA: string, jwkA: PublicJwk, userB: string, jwkB: PublicJwk): Promise<string> {
  return sn.computeSafetyNumber(getPlatform().crypto, userA, jwkA, userB, jwkB)
}

export const formatSafetyNumber = sn.formatSafetyNumber

// ── public key fetching ─────────────────────────────────────────────

/** Server-published public JWK for `username` (unauthenticated identity claim). */
export async function fetchPublicJwk(username: string, token: string): Promise<RsaJwk> {
  const { apiFetch, apiBase } = getPlatform()
  const res = await apiFetch(`${apiBase}/api/keys/${encodeURIComponent(username)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Failed to fetch public key for ${username}: ${res.status}`)
  return JSON.parse(await res.text()) as RsaJwk
}

/**
 * My own public JWK, preferring the copy cached on THIS device. Using the
 * server's copy of my own key would let a lying server hide the swap from the
 * safety number, so the server is only a fallback.
 */
export async function loadOwnPublicJwk(me: string, token: string): Promise<RsaJwk> {
  const local = await getPlatform().rsaKeys.loadPublicJwk(me)
  return local ?? fetchPublicJwk(me, token)
}

// ── trust store (TOFU pins) ─────────────────────────────────────────

// What a pin's fingerprint is OF. Pins made before Signal support have no `kind`
// and are RSA pins; they migrate to the identity key via its cross-signature.
export type PinKind = 'rsa' | 'identity'

export type ContactTrust = {
  fingerprint: string          // currently accepted key
  kind?: PinKind               // absent = 'rsa' (pre-Signal pins)
  verified: boolean            // safety number compared and confirmed
  changed: boolean             // key differs from pin; send blocked until acknowledged
  pendingFingerprint?: string  // the new key, while `changed`
  pendingKind?: PinKind
  pinnedAt: number
}

// Pins are scoped per local account so two logins in one browser don't share trust.
const pinKey = (owner: string, contact: string) => `${PIN_PREFIX}:${owner}:${contact}`

type Listener = (owner: string, contact: string, trust: ContactTrust | undefined) => void
const listeners = new Set<Listener>()

export function subscribeTrust(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

async function saveTrust(owner: string, contact: string, trust: ContactTrust) {
  await getPlatform().kv.set(pinKey(owner, contact), trust)
  listeners.forEach(l => l(owner, contact, trust))
}

export function getTrust(owner: string, contact: string): Promise<ContactTrust | undefined> {
  return getPlatform().kv.get<ContactTrust>(pinKey(owner, contact))
}

/**
 * Compare a freshly fetched fingerprint against the pin:
 *   no pin   → pin it (trust on first use)
 *   match    → unchanged
 *   mismatch → flag `changed`, drop `verified`, keep the OLD pin until the user
 *              acknowledges — so a reload can't silently accept the new key.
 */
export async function checkPin(owner: string, contact: string, fingerprint: string, kind: PinKind = 'rsa'): Promise<ContactTrust> {
  const existing = await getTrust(owner, contact)
  if (!existing) {
    const trust: ContactTrust = { fingerprint, kind, verified: false, changed: false, pinnedAt: Date.now() }
    await saveTrust(owner, contact, trust)
    return trust
  }
  if (existing.fingerprint === fingerprint) {
    if (!existing.changed) return existing
    // Key reverted to the pinned one — nothing to acknowledge any more.
    const trust: ContactTrust = { ...existing, changed: false, pendingFingerprint: undefined }
    await saveTrust(owner, contact, trust)
    return trust
  }
  if (existing.changed && existing.pendingFingerprint === fingerprint) return existing
  const trust: ContactTrust = { ...existing, changed: true, verified: false, pendingFingerprint: fingerprint, pendingKind: kind }
  await saveTrust(owner, contact, trust)
  return trust
}

/** User accepted the new key: it becomes the pin (unverified). */
export async function acknowledgeKeyChange(owner: string, contact: string): Promise<void> {
  const existing = await getTrust(owner, contact)
  if (!existing?.changed || !existing.pendingFingerprint) return
  await saveTrust(owner, contact, {
    fingerprint: existing.pendingFingerprint,
    kind: existing.pendingKind ?? existing.kind,
    verified: false,
    changed: false,
    pinnedAt: Date.now(),
  })
}

/** Mark verified — only valid for the exact key whose safety number was compared. */
export async function setVerified(owner: string, contact: string, fingerprint: string, verified: boolean): Promise<void> {
  const existing = await getTrust(owner, contact)
  if (!existing || existing.changed || existing.fingerprint !== fingerprint) return
  await saveTrust(owner, contact, { ...existing, verified })
}

/** True while an unacknowledged key change exists — callers must not encrypt to this contact. */
export async function isSendBlocked(owner: string, contact: string): Promise<boolean> {
  return (await getTrust(owner, contact))?.changed === true
}

/**
 * Drop-in replacement for fetchPublicKey that also runs the pin check.
 * Fetches the JWK itself so the key can be fingerprinted (imported public
 * keys are opaque handles).
 */
export async function fetchPinnedPublicKey(owner: string, contact: string, token: string): Promise<{
  key: RsaPublicKey
  jwk: RsaJwk
  trust: ContactTrust
}> {
  const jwk = await fetchPublicJwk(contact, token)
  const trust = await checkPin(owner, contact, await keyFingerprint(jwk))
  const key = rsaPublicFromJwk(getPlatform().crypto, jwk)
  return { key, jwk, trust }
}

// ── Signal identity keys ────────────────────────────────────────────
//
// With the Signal protocol a contact's long-term key is their account IDENTITY
// key (Curve25519), shared by all of their devices; that's what pins and safety
// numbers are about now. Each identity is cross-signed by the account's legacy
// RSA key, so a pin on the RSA key moves to the identity key silently — but only
// when the RSA key is exactly the one that was pinned and the signature checks.

const IDENTITY_FP_PREFIX = utf8('iris-ik-v1')

/** Stable SHA-256 fingerprint (hex) of a Curve25519 identity public key. */
export async function identityFingerprint(identityKey: ArrayBuffer): Promise<string> {
  return toHex(await getPlatform().crypto.digest('SHA-256', concat(IDENTITY_FP_PREFIX, new Uint8Array(identityKey))))
}

async function tryFetchPublicJwk(contact: string, token: string): Promise<RsaJwk | null> {
  try {
    return await fetchPublicJwk(contact, token)
  } catch {
    return null
  }
}

/** True when `rsaJwk` signed `identityKey` (the account binding both keys). */
async function crossSigned(rsaJwk: RsaJwk | null, identityKey: ArrayBuffer, crossSignature: string | null): Promise<boolean> {
  if (!rsaJwk || !crossSignature) return false
  return verifyLegacySignature(rsaJwk, new Uint8Array(identityKey), crossSignature)
}

/**
 * Pin (or check) a contact's identity key. If the existing pin is a legacy RSA
 * pin, migrate it — keeping `verified` — when the server's RSA key is the pinned
 * one and it cross-signed this identity. Anything else is a key change.
 */
async function pinIdentity(
  owner: string, contact: string, identityKey: ArrayBuffer,
  rsaJwk: RsaJwk | null, crossSignature: string | null,
): Promise<ContactTrust> {
  const fingerprint = await identityFingerprint(identityKey)
  const existing = await getTrust(owner, contact)
  if (existing && !existing.changed && (existing.kind ?? 'rsa') === 'rsa' && existing.fingerprint !== fingerprint) {
    const rsaMatchesPin = !!rsaJwk && (await keyFingerprint(rsaJwk)) === existing.fingerprint
    if (rsaMatchesPin && (await crossSigned(rsaJwk, identityKey, crossSignature))) {
      const migrated: ContactTrust = { ...existing, fingerprint, kind: 'identity', pinnedAt: Date.now() }
      await saveTrust(owner, contact, migrated)
      return migrated
    }
  }
  return checkPin(owner, contact, fingerprint, 'identity')
}

export type ContactKeys = {
  /** Legacy RSA key — only for v1 fallback, and only if bound to the pinned key. */
  rsaKey: RsaPublicKey | null
  /** Signal identity key, or null if the contact hasn't set up Signal yet. */
  identityKey: ArrayBuffer | null
  trust: ContactTrust
}

/**
 * Fetch a contact's keys and run them through pinning. Replaces
 * fetchPinnedPublicKey for chats: it pins the identity key when the contact has
 * one (migrating RSA pins), and only offers the RSA key for legacy sends when it
 * is the pinned key itself or is cross-bound to the pinned identity.
 */
export async function resolveContactKeys(owner: string, contact: string, token: string): Promise<ContactKeys> {
  const [identity, rsaJwk] = await Promise.all([
    signalApi.identityOf(token, contact),
    tryFetchPublicJwk(contact, token),
  ])

  if (!identity) {
    if (!rsaJwk) throw new Error(`${contact} hasn't set up encryption yet`)
    // Legacy-only contact. If we'd pinned an identity for them, this RSA-only answer
    // differs from the pin and is flagged as a change (identities are insert-once).
    const trust = await checkPin(owner, contact, await keyFingerprint(rsaJwk), 'rsa')
    const rsaKey = rsaPublicFromJwk(getPlatform().crypto, rsaJwk)
    return { rsaKey, identityKey: null, trust }
  }

  const identityKey = ab(identity.identityKey)
  const trust = await pinIdentity(owner, contact, identityKey, rsaJwk, identity.crossSignature)
  const rsaKey = rsaJwk && (await crossSigned(rsaJwk, identityKey, identity.crossSignature))
    ? rsaPublicFromJwk(getPlatform().crypto, rsaJwk)
    : null
  return { rsaKey, identityKey, trust }
}

/**
 * Called when an incoming Signal session reveals a contact's identity key, so a
 * key the server never advertised still hits the pin check.
 */
export async function noteIdentitySeen(owner: string, contact: string, identityKey: ArrayBuffer, token: string): Promise<void> {
  const fingerprint = await identityFingerprint(identityKey)
  const existing = await getTrust(owner, contact)
  if (existing && existing.kind === 'identity' && existing.fingerprint === fingerprint && !existing.changed) return
  const identity = await signalApi.identityOf(token, contact).catch(() => null)
  const rsaJwk = await tryFetchPublicJwk(contact, token)
  const advertised = identity ? ab(identity.identityKey) : null
  // Only the server's cross-signature for THIS identity can migrate an RSA pin.
  const crossSignature = advertised && (await identityFingerprint(advertised)) === fingerprint ? identity!.crossSignature : null
  await pinIdentity(owner, contact, identityKey, rsaJwk, crossSignature)
}

export type SafetyNumber = { digits: string; peerFingerprint: string; qrValue: string }

/**
 * Safety number for a chat. Uses both identity keys when both accounts have
 * Signal identities (Signal's own algorithm: 5200 × SHA-512 per side); otherwise
 * the legacy RSA-based number. My half comes from THIS device's copy of my key.
 */
export async function loadSafetyNumber(me: string, peer: string, token: string): Promise<SafetyNumber> {
  const [mine, theirs] = await Promise.all([
    new SignalStore(me, getPlatform().kv).getIdentityKeyPair().catch(() => undefined),
    signalApi.identityOf(token, peer).catch(() => null),
  ])
  if (mine && theirs) {
    const peerKey = ab(theirs.identityKey)
    const digits = await identitySafetyNumber(me, mine.pubKey, peer, peerKey)
    return { digits, peerFingerprint: await identityFingerprint(peerKey), qrValue: `iris-safety:v2:${digits}` }
  }
  const [myJwk, peerJwk] = await Promise.all([loadOwnPublicJwk(me, token), fetchPublicJwk(peer, token)])
  const [digits, peerFingerprint] = await Promise.all([
    computeSafetyNumber(me, myJwk, peer, peerJwk),
    keyFingerprint(peerJwk),
  ])
  return { digits, peerFingerprint, qrValue: `iris-safety:v1:${digits}` }
}
