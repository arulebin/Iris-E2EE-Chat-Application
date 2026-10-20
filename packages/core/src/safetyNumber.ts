import { concat, toHex, utf8 } from './crypto/bytes.ts'
import type { Bytes, CryptoProvider } from './crypto/provider.ts'

/**
 * Safety numbers and key fingerprints. Copied (not moved) from
 * frontend/src/lib/fingerprint.ts; the only change is that hashing goes through a
 * CryptoProvider instead of the global `crypto.subtle`, so the same code runs on
 * web, Node and React Native. Output is byte-for-byte identical.
 */

export const SAFETY_VERSION = 0
export const SAFETY_ITERATIONS = 5200

type PublicJwk = { kty?: string; n?: string; e?: string }

/** RFC 7638 thumbprint input: required RSA members only, lexicographic order. */
function canonicalJwk(jwk: PublicJwk): Bytes {
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) throw new Error('Expected an RSA public JWK')
  return utf8(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n }))
}

/** 6 chunks of 5 bytes, each mod 100000, as 5 digits (Signal's encoding). */
function digitsOf(hash: Bytes): string {
  let digits = ''
  for (let i = 0; i < 30; i += 5) {
    let chunk = 0
    for (let j = 0; j < 5; j++) chunk = chunk * 256 + hash[i + j]
    digits += String(chunk % 100000).padStart(5, '0')
  }
  return digits
}

/** Stable SHA-256 key fingerprint (hex) of an RSA public JWK; what gets pinned per contact. */
export async function keyFingerprint(c: CryptoProvider, jwk: PublicJwk): Promise<string> {
  return toHex(await c.digest('SHA-256', canonicalJwk(jwk)))
}

/** Signal fingerprint (version 0) for one identity: 30 digits. */
async function identityDigits(c: CryptoProvider, identifier: string, identityKey: Bytes, iterations: number): Promise<string> {
  const key = identityKey
  let hash = concat(new Uint8Array([SAFETY_VERSION & 0xff, SAFETY_VERSION >> 8]), key, utf8(identifier))
  for (let i = 0; i < iterations; i++) hash = await c.digest('SHA-512', concat(hash, key))
  return digitsOf(hash)
}

/** 60-digit safety number from two Signal identity keys (halves sorted, as Signal does). */
export async function identitySafetyNumber(
  c: CryptoProvider,
  localId: string, localKey: Bytes, remoteId: string, remoteKey: Bytes,
  iterations = SAFETY_ITERATIONS,
): Promise<string> {
  const halves = await Promise.all([
    identityDigits(c, localId, localKey, iterations),
    identityDigits(c, remoteId, remoteKey, iterations),
  ])
  return halves.sort().join('')
}

async function partyDigits(c: CryptoProvider, username: string, jwk: PublicJwk, iterations: number): Promise<string> {
  const key = canonicalJwk(jwk)
  let hash = await c.digest('SHA-512', concat(new Uint8Array([0, SAFETY_VERSION]), key, utf8(username)))
  for (let i = 1; i < iterations; i++) hash = await c.digest('SHA-512', concat(hash, key))
  return digitsOf(hash)
}

/** Legacy RSA-based 60-digit safety number; order-independent (halves sorted by username). */
export async function computeSafetyNumber(
  c: CryptoProvider,
  userA: string, jwkA: PublicJwk,
  userB: string, jwkB: PublicJwk,
  iterations = SAFETY_ITERATIONS,
): Promise<string> {
  const [a, b] = await Promise.all([partyDigits(c, userA, jwkA, iterations), partyDigits(c, userB, jwkB, iterations)])
  return userA <= userB ? a + b : b + a
}

/** "12345 67890 ..." as 12 groups of 5, the way it is read aloud. */
export function formatSafetyNumber(digits: string): string[] {
  return digits.match(/.{1,5}/g) ?? []
}
