import { get, set } from 'idb-keyval'
import { apiBase } from './config'

// Key verification: safety numbers + trust-on-first-use pinning.
//
// The server hands out everyone's public key, so on its own nothing stops it from
// swapping in a key it controls (a MITM). Two defences live here:
//   1. Pinning — the first key we see for a contact is remembered; any later
//      change is surfaced to the user and blocks sending until acknowledged.
//   2. Safety numbers — a 60-digit code derived from BOTH keys that the two
//      people compare out-of-band (in person, QR, call). Matching numbers prove
//      neither side was handed a substituted key.

const RSA_PARAMS: RsaHashedImportParams = { name: 'RSA-OAEP', hash: 'SHA-256' }

// Signal-style: iterate the hash so brute-forcing a key with a colliding
// (truncated) fingerprint is expensive. Version byte lets us change the scheme later.
const SAFETY_VERSION = 0
const SAFETY_ITERATIONS = 5200
const PIN_PREFIX = 'iris-key-pin-v1'

// ── canonical key bytes ─────────────────────────────────────────────

/**
 * RFC 7638 thumbprint input: only the required RSA members, lexicographic order,
 * no whitespace. Optional JWK fields (alg, ext, key_ops) vary between browsers
 * and must not change the fingerprint.
 */
function canonicalJwk(jwk: JsonWebKey): Uint8Array<ArrayBuffer> {
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) throw new Error('Expected an RSA public JWK')
  return new TextEncoder().encode(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n }))
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((len, p) => len + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** Stable SHA-256 key fingerprint (hex) — what gets pinned per contact. */
export async function keyFingerprint(jwk: JsonWebKey): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', canonicalJwk(jwk))))
}

// ── safety numbers ──────────────────────────────────────────────────

/** 30 digits for one party: iterated SHA-512 over (version ‖ key ‖ username). */
async function partyDigits(username: string, jwk: JsonWebKey): Promise<string> {
  const key = canonicalJwk(jwk)
  const id = new TextEncoder().encode(username)
  let hash = new Uint8Array(
    await crypto.subtle.digest('SHA-512', concat(new Uint8Array([0, SAFETY_VERSION]), key, id))
  )
  for (let i = 1; i < SAFETY_ITERATIONS; i++) {
    hash = new Uint8Array(await crypto.subtle.digest('SHA-512', concat(hash, key)))
  }
  // 6 chunks of 5 bytes → each mod 100000 → 5 digits, as Signal does.
  let digits = ''
  for (let i = 0; i < 30; i += 5) {
    let chunk = 0
    for (let j = 0; j < 5; j++) chunk = chunk * 256 + hash[i + j]
    digits += String(chunk % 100000).padStart(5, '0')
  }
  return digits
}

/**
 * 60-digit safety number for a conversation. Order-independent: both people
 * see the same digits because the halves are sorted by username.
 */
export async function computeSafetyNumber(
  userA: string, jwkA: JsonWebKey,
  userB: string, jwkB: JsonWebKey,
): Promise<string> {
  const [a, b] = await Promise.all([partyDigits(userA, jwkA), partyDigits(userB, jwkB)])
  return userA <= userB ? a + b : b + a
}

/** "12345 67890 …" — 12 groups of 5, the way it's read aloud. */
export function formatSafetyNumber(digits: string): string[] {
  return digits.match(/.{1,5}/g) ?? []
}

// ── public key fetching ─────────────────────────────────────────────

/** Server-published public JWK for `username` (unauthenticated identity claim). */
export async function fetchPublicJwk(username: string, token: string): Promise<JsonWebKey> {
  const res = await fetch(`${apiBase}/api/keys/${encodeURIComponent(username)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Failed to fetch public key for ${username}: ${res.status}`)
  return JSON.parse(await res.text()) as JsonWebKey
}

/**
 * My own public JWK, preferring the copy cached on THIS device. Using the
 * server's copy of my own key would let a lying server hide the swap from the
 * safety number, so the server is only a fallback.
 */
export async function loadOwnPublicJwk(me: string, token: string): Promise<JsonWebKey> {
  const local = await get<JsonWebKey>(`iris-public-key-${me}`)
  return local ?? fetchPublicJwk(me, token)
}

// ── trust store (TOFU pins) ─────────────────────────────────────────

export type ContactTrust = {
  fingerprint: string          // currently accepted key
  verified: boolean            // safety number compared and confirmed
  changed: boolean             // key differs from pin; send blocked until acknowledged
  pendingFingerprint?: string  // the new key, while `changed`
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
  await set(pinKey(owner, contact), trust)
  listeners.forEach(l => l(owner, contact, trust))
}

export function getTrust(owner: string, contact: string): Promise<ContactTrust | undefined> {
  return get<ContactTrust>(pinKey(owner, contact))
}

/**
 * Compare a freshly fetched fingerprint against the pin:
 *   no pin   → pin it (trust on first use)
 *   match    → unchanged
 *   mismatch → flag `changed`, drop `verified`, keep the OLD pin until the user
 *              acknowledges — so a reload can't silently accept the new key.
 */
export async function checkPin(owner: string, contact: string, fingerprint: string): Promise<ContactTrust> {
  const existing = await getTrust(owner, contact)
  if (!existing) {
    const trust: ContactTrust = { fingerprint, verified: false, changed: false, pinnedAt: Date.now() }
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
  const trust: ContactTrust = { ...existing, changed: true, verified: false, pendingFingerprint: fingerprint }
  await saveTrust(owner, contact, trust)
  return trust
}

/** User accepted the new key: it becomes the pin (unverified). */
export async function acknowledgeKeyChange(owner: string, contact: string): Promise<void> {
  const existing = await getTrust(owner, contact)
  if (!existing?.changed || !existing.pendingFingerprint) return
  await saveTrust(owner, contact, {
    fingerprint: existing.pendingFingerprint,
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
 * Fetches the JWK itself because imported public keys are non-extractable,
 * so a CryptoKey can't be fingerprinted after the fact.
 */
export async function fetchPinnedPublicKey(owner: string, contact: string, token: string): Promise<{
  key: CryptoKey
  jwk: JsonWebKey
  trust: ContactTrust
}> {
  const jwk = await fetchPublicJwk(contact, token)
  const trust = await checkPin(owner, contact, await keyFingerprint(jwk))
  const key = await crypto.subtle.importKey('jwk', jwk, RSA_PARAMS, false, ['encrypt'])
  return { key, jwk, trust }
}
