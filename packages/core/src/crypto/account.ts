import { getPlatform } from '../platform.ts'
import { fromBase64, toBase64, utf8 } from './bytes.ts'
import { rsaPublicFromJwk, type MasterKey, type RsaPrivateKey, type RsaPublicKey } from './keys.ts'
import type { Bytes, RsaJwk } from './provider.ts'
import { gcmOpenPacked, gcmSealPacked, utf8Decode } from './util.ts'

export { fromBase64, toBase64 }

const PBKDF2_ITERATIONS = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12

// ── password-derived secrets ───────────────────────────────────────
//
// v2 (current): ONE slow PBKDF2 over (password, authSalt) yields a master secret,
// which HKDF splits into two independent 256-bit outputs:
//   authKey = HKDF(master, info="iris-auth-v2")             → the login credential the server sees
//   KEK     = HKDF(master, salt=keySalt, info="iris-kek-v2") → wraps the RSA private-key backup
// HKDF outputs under different `info` are independent, so knowing authKey tells the
// server nothing about the KEK — to unwrap the backup it would have to brute-force the
// password through 600k PBKDF2 rounds per guess.
//
// v1 (legacy, migration only): the raw password WAS the login credential and the KEK
// was PBKDF2(password, keySalt) — so the server could unwrap every backup.

const AUTH_INFO = utf8('iris-auth-v2')
const KEK_INFO = utf8('iris-kek-v2')

export type Credentials = {
  authKey: string     // base64, sent to the server in place of the password
  master: MasterKey   // HKDF-only handle (web: non-extractable CryptoKey); never leaves the device
}

// Which authSalt each master secret was derived with (needed to tag local escrow blobs).
const masterSalts = new WeakMap<MasterKey, string>()
export const saltOfMaster = (master: MasterKey): string | null => masterSalts.get(master) ?? null

const authSaltCacheKey = (username: string) => `iris-authsalt:${username}`
/** The account's authSalt as last seen on this device (not secret); lets the password unlock local data offline. */
export function cachedAuthSalt(username: string): string | null {
  try { return getPlatform().flags.getItem(authSaltCacheKey(username)) } catch { return null }
}
export function cacheAuthSalt(username: string, authSalt: string): void {
  try { getPlatform().flags.setItem(authSaltCacheKey(username), authSalt) } catch { /* ignore */ }
}

export function newSalt(): string {
  return toBase64(getPlatform().crypto.randomBytes(SALT_BYTES))
}

export async function deriveCredentials(password: string, authSaltB64: string): Promise<Credentials> {
  const p = getPlatform()
  const masterBits = await p.crypto.pbkdf2('SHA-256', utf8(password), fromBase64(authSaltB64), PBKDF2_ITERATIONS, 32)
  const master = await p.masterKeys.create(masterBits)
  masterBits.fill(0)
  masterSalts.set(master, authSaltB64)
  const authBits = await master.hkdf(new Uint8Array(0), AUTH_INFO, 32)
  return { authKey: toBase64(authBits), master }
}

/** v2 KEK: HKDF from the master secret. */
function deriveKek(master: MasterKey, keySalt: Bytes): Promise<Bytes> {
  return master.hkdf(keySalt, KEK_INFO, 32)
}

/** v1 KEK: PBKDF2 straight from the password. Only used to unwrap a legacy backup during upgrade. */
function deriveLegacyKek(password: string, salt: Bytes): Promise<Bytes> {
  return getPlatform().crypto.pbkdf2('SHA-256', utf8(password), salt, PBKDF2_ITERATIONS, 32)
}

/**
 * AES-GCM encrypt the JWK string under the KEK.
 * Returns base64(IV || ciphertext) — the IV is prepended so unwrap can find it.
 */
async function wrapPrivateJwk(jwkString: string, kek: Bytes): Promise<string> {
  return toBase64(await gcmSealPacked(getPlatform().crypto, kek, utf8(jwkString)))
}

/**
 * Inverse of wrapPrivateJwk. Throws OperationError if the KEK doesn't match
 * (wrong password) or the blob has been tampered with — AES-GCM's auth tag catches both.
 */
async function unwrapPrivateJwk(packedB64: string, kek: Bytes): Promise<string> {
  return utf8Decode(await gcmOpenPacked(getPlatform().crypto, kek, fromBase64(packedB64)))
}

// ── key management ─────────────────────────────────────────────────

type ServerKeys = {
  publicKey: string | null
  encryptedPrivateKey: string | null
  keySalt: string | null
}

async function fetchMyKeys(token: string): Promise<ServerKeys> {
  const p = getPlatform()
  const res = await p.apiFetch(`${p.apiBase}/api/keys/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Failed to fetch own keys: ${res.status}`)
  return await res.json() as ServerKeys
}

/**
 * Decrypt the server-stored, KEK-wrapped private key, cache it on this device, and
 * import both halves. Used by the normal restore branch AND by the conflict (409)
 * path, so a second device always converges on the ONE server keypair.
 * Throws OperationError if the password is wrong (AES-GCM auth failure).
 */
async function restoreFromBackup(
  username: string,
  keys: ServerKeys,
  master: MasterKey,
): Promise<{ privateKey: RsaPrivateKey; publicKey: RsaPublicKey }> {
  const p = getPlatform()
  const kek = await deriveKek(master, fromBase64(keys.keySalt!))
  const privateJwk = JSON.parse(await unwrapPrivateJwk(keys.encryptedPrivateKey!, kek)) as RsaJwk
  const publicJwk = JSON.parse(keys.publicKey!) as RsaJwk
  const privateKey = await p.rsaKeys.save(username, privateJwk, publicJwk)
  return { privateKey, publicKey: rsaPublicFromJwk(p.crypto, publicJwk) }
}

/**
 * Three-branch keypair recovery:
 *   1. this device has both halves  → fast-path, no server / password needed.
 *   2. device empty, server has backup → derive KEK from the master secret, decrypt privkey, cache it.
 *   3. Nothing anywhere            → generate, encrypt privkey under the KEK, upload everything.
 *
 * `master` (from deriveCredentials) is required for branches 2 and 3; pass null
 * only when you're confident the device cache is populated (e.g. page reload with existing token).
 */
export async function ensureKeyPair(username: string, master: MasterKey | null, token: string): Promise<{
  privateKey: RsaPrivateKey
  publicKey: RsaPublicKey
}> {
  const p = getPlatform()

  // Branch 1: cache-only fast path (the web cache also upgrades older plain-JWK entries on sight).
  const cached = await p.rsaKeys.load(username)
  if (cached) return { privateKey: cached.privateKey, publicKey: rsaPublicFromJwk(p.crypto, cached.publicJwk) }

  // Branches 2 & 3 both need to derive a KEK
  if (!master) throw new Error('Password required to unlock or create keypair — log in again')

  const myKeys = await fetchMyKeys(token)

  // Branch 2: server has a backup → unlock it (recovers the SAME key on every device)
  if (myKeys.publicKey && myKeys.encryptedPrivateKey && myKeys.keySalt) {
    return restoreFromBackup(username, myKeys, master)
  }

  // Branch 3: cold start — generate, upload, and ONLY persist locally once the
  // server has accepted. Writing the cache before the upload (the old behaviour) meant a
  // failed POST left an un-backed-up local key that Branch 1 would then serve
  // forever while the server stayed empty — the root cause of cross-device divergence.
  if (!p.crypto.rsaOaepGenerate) throw new Error('This device cannot create a legacy RSA key')
  const { privateJwk, publicJwk } = await p.crypto.rsaOaepGenerate()

  const keySalt = newSalt()
  const kek = await deriveKek(master, fromBase64(keySalt))
  const encryptedPrivateKey = await wrapPrivateJwk(JSON.stringify(privateJwk), kek)

  const res = await p.apiFetch(`${p.apiBase}/api/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      publicKey: JSON.stringify(publicJwk),
      encryptedPrivateKey,
      keySalt,
    }),
  })

  // 409 = this account already published a key (another device, or a near-simultaneous
  // race). Our freshly generated keypair is the wrong one — throw it away and recover
  // the authoritative key from the server so BOTH devices end up on a single keypair.
  if (res.status === 409) {
    const recovered = await fetchMyKeys(token)
    if (!(recovered.publicKey && recovered.encryptedPrivateKey && recovered.keySalt)) {
      throw new Error('Server reported a key conflict but has no recoverable backup')
    }
    return restoreFromBackup(username, recovered, master)
  }
  if (!res.ok) throw new Error(`Failed to upload keys: ${res.status}`)

  // Server accepted — now it's safe to cache the keypair locally.
  const privateKey = await p.rsaKeys.save(username, privateJwk, publicJwk)
  return { privateKey, publicKey: rsaPublicFromJwk(p.crypto, publicJwk) }
}

// ── v1 → v2 account upgrade ────────────────────────────────────────

export type AuthSaltInfo = { version: number; authSalt: string | null }

const upgradedMarkFor = (username: string) => `iris-cred-v2-${username}`

/** Remember that this account is v2, so this device never again sends its raw password. */
export function markUpgraded(username: string): void {
  try { getPlatform().flags.setItem(upgradedMarkFor(username), '1') } catch { /* storage blocked — guard just won't apply */ }
}

/**
 * Pre-login lookup of the account's credential version + salt. A malicious server
 * could answer "v1" for a v2 account to trick the client into sending the raw
 * password; once this device has seen the account at v2, refuse that downgrade.
 */
export async function fetchAuthSalt(username: string): Promise<AuthSaltInfo> {
  const p = getPlatform()
  const res = await p.fetch(`${p.apiBase}/auth/salt/${encodeURIComponent(username)}`)
  if (!res.ok) throw new Error(`Failed to start login: ${res.status}`)
  const info = await res.json() as AuthSaltInfo
  let upgradedHere = false
  try { upgradedHere = p.flags.getItem(upgradedMarkFor(username)) === '1' } catch { /* ignore */ }
  if (info.version < 2 && upgradedHere) {
    throw new Error("The server asked for this account's legacy password login, which this device already upgraded. Refusing to send your password.")
  }
  if (info.version >= 2 && !info.authSalt) throw new Error('Server returned no salt for this account')
  if (info.version >= 2 && info.authSalt) cacheAuthSalt(username, info.authSalt)
  return info
}

/**
 * One-time migration for a v1 account, run right after a successful legacy login
 * (or a legacy unlock). Unwraps the old PBKDF2(password)-wrapped backup, re-wraps
 * the SAME private key under the new HKDF KEK, and has the server atomically swap
 * in bcrypt(authKey) + the new backup. Returns the v2 master secret.
 *
 * Throws OperationError if the password doesn't match (legacy unwrap or server check).
 */
export async function upgradeLegacyAccount(username: string, password: string, token: string): Promise<MasterKey> {
  const p = getPlatform()
  const myKeys = await fetchMyKeys(token)
  const authSalt = newSalt()
  const { authKey, master } = await deriveCredentials(password, authSalt)

  let rewrapped: ServerKeys = { publicKey: null, encryptedPrivateKey: null, keySalt: null }
  if (myKeys.publicKey && myKeys.encryptedPrivateKey && myKeys.keySalt) {
    const legacyKek = await deriveLegacyKek(password, fromBase64(myKeys.keySalt))
    const privateJwkString = await unwrapPrivateJwk(myKeys.encryptedPrivateKey, legacyKek)
    const keySalt = newSalt()
    const kek = await deriveKek(master, fromBase64(keySalt))
    rewrapped = {
      publicKey: myKeys.publicKey, // echoed verbatim — the server rejects any other key
      encryptedPrivateKey: await wrapPrivateJwk(privateJwkString, kek),
      keySalt,
    }

    // Seed an empty device with the key now. The keypair doesn't change in this
    // migration, so caching it before the server call can't cause divergence — and
    // it keeps the session usable even if the upgrade request fails.
    if (!(await p.rsaKeys.load(username))) {
      await p.rsaKeys.save(username, JSON.parse(privateJwkString) as RsaJwk, JSON.parse(myKeys.publicKey) as RsaJwk)
    }
  }

  const res = await p.apiFetch(`${p.apiBase}/api/credentials/upgrade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword: password, authKey, authSalt, ...rewrapped }),
  })

  // 409 = another device finished the upgrade first. Its authSalt is authoritative;
  // re-derive against it so both devices share one master secret.
  if (res.status === 409) {
    markUpgraded(username)
    const info = await fetchAuthSalt(username)
    return (await deriveCredentials(password, info.authSalt!)).master
  }
  if (res.status === 403) {
    // Same signal the AES-GCM unwrap gives for a wrong password, so callers handle both alike.
    const err = new Error('Wrong password')
    err.name = 'OperationError'
    throw err
  }
  if (!res.ok) throw new Error(`Account upgrade failed: ${res.status}`)

  // The upgrade ends every other login of the account; this device gets a fresh pair
  // so it isn't logged out by its own action. (Older servers return an empty body.)
  try {
    const data = (await res.json()) as { token?: string; refreshToken?: string }
    if (data.token && data.refreshToken) p.setSession(data.token, data.refreshToken)
  } catch { /* no body: keep the current session */ }

  markUpgraded(username)
  cacheAuthSalt(username, authSalt)
  return master
}

/**
 * Fetch and import another user's public key.
 */
export async function fetchPublicKey(username: string, token: string): Promise<RsaPublicKey> {
  const p = getPlatform()
  const res = await p.apiFetch(`${p.apiBase}/api/keys/${encodeURIComponent(username)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Failed to fetch public key for ${username}: ${res.status}`)
  const jwk = JSON.parse(await res.text()) as RsaJwk
  return rsaPublicFromJwk(p.crypto, jwk)
}

// ── encryption / decryption ────────────────────────────────────────

export type EncryptedMessage = {
  ciphertext: string                  // base64(iv || aes-gcm ciphertext)
  encryptedKeyForSender: string       // base64(aes key, encrypted with my RSA pub)
  encryptedKeyForRecipient: string    // base64(aes key, encrypted with their RSA pub)
}

/**
 * Hybrid encrypt: AES-GCM for content, RSA-OAEP for the AES key.
 * The AES key is wrapped twice — once for the sender, once for the recipient —
 * so both sides can decrypt later.
 */
export async function encryptMessage(
  plaintext: string,
  myPublicKey: RsaPublicKey,
  recipientPublicKey: RsaPublicKey,
): Promise<EncryptedMessage> {
  const c = getPlatform().crypto
  // 1. A fresh AES key for this single message, 2. AES-GCM with a random 12-byte IV
  const aesKey = c.randomBytes(32)
  const combined = await gcmSealPacked(c, aesKey, utf8(plaintext))
  // 3. Wrap the AES key for both parties
  const wrappedForSender = await myPublicKey.encrypt(aesKey)
  const wrappedForRecipient = await recipientPublicKey.encrypt(aesKey)
  aesKey.fill(0)

  return {
    ciphertext: toBase64(combined),
    encryptedKeyForSender: toBase64(wrappedForSender),
    encryptedKeyForRecipient: toBase64(wrappedForRecipient),
  }
}

/**
 * Decrypt with the matching RSA private key.
 * `encryptedKey` must be the one that was wrapped for *this* user.
 */
export async function decryptMessage(
  ciphertextB64: string,
  encryptedKeyB64: string,
  privateKey: RsaPrivateKey,
): Promise<string> {
  const c = getPlatform().crypto
  const aesKey = await privateKey.decrypt(fromBase64(encryptedKeyB64))
  const pt = await gcmOpenPacked(c, aesKey, fromBase64(ciphertextB64))
  return utf8Decode(pt)
}

// ── helpers for the Signal-protocol layer (lib/signal) ─────────────

/**
 * Wrap arbitrary secret bytes under a KEK derived from the login master secret.
 * `info` domain-separates each use (the RSA backup uses 'iris-kek-v2'), so the
 * same password never yields the same key for two different secrets.
 * Returns { wrapped: base64(iv ‖ ct), salt: base64 }.
 */
export async function wrapWithMaster(
  master: MasterKey, plaintext: Bytes, info: string,
): Promise<{ wrapped: string; salt: string }> {
  const c = getPlatform().crypto
  const salt = c.randomBytes(SALT_BYTES)
  const kek = await master.hkdf(salt, utf8(info), 32)
  return { wrapped: toBase64(await gcmSealPacked(c, kek, plaintext)), salt: toBase64(salt) }
}

/** Inverse of wrapWithMaster. Throws OperationError for a wrong password / tampered blob. */
export async function unwrapWithMaster(
  master: MasterKey, wrappedB64: string, saltB64: string, info: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const c = getPlatform().crypto
  const kek = await master.hkdf(fromBase64(saltB64), utf8(info), 32)
  const pt = await gcmOpenPacked(c, kek, fromBase64(wrappedB64))
  return new Uint8Array(pt)
}

const PSS_SALT_LENGTH = 32

/**
 * Sign with the account's legacy RSA key (RSA-PSS). The cached key is decrypt-only,
 * so this unwraps the server backup with the master secret, uses the JWK once, and
 * drops it. Used to cross-sign the new identity key.
 */
export async function signWithLegacyKey(master: MasterKey, token: string, data: Bytes): Promise<string> {
  const c = getPlatform().crypto
  const keys = await fetchMyKeys(token)
  if (!keys.encryptedPrivateKey || !keys.keySalt) throw new Error('No legacy key backup to sign with')
  const kek = await deriveKek(master, fromBase64(keys.keySalt))
  const jwk = JSON.parse(await unwrapPrivateJwk(keys.encryptedPrivateKey, kek)) as RsaJwk
  return toBase64(await c.rsaPssSign(jwk, data, PSS_SALT_LENGTH))
}

/** Verify a signWithLegacyKey signature against a public RSA JWK. */
export async function verifyLegacySignature(jwk: { kty?: string; n?: string; e?: string }, data: Bytes, sigB64: string): Promise<boolean> {
  try {
    return await getPlatform().crypto.rsaPssVerify(jwk as RsaJwk, fromBase64(sigB64), data, PSS_SALT_LENGTH)
  } catch {
    return false
  }
}

// ── media (photos / videos / snaps) ────────────────────────────────

/** Bytes AES-GCM adds to a media blob: 12-byte IV + 16-byte auth tag. */
export const MEDIA_CRYPTO_OVERHEAD = IV_BYTES + 16

/**
 * Encrypt media bytes under a fresh, single-use AES-256-GCM key.
 * Returns iv || ciphertext (what gets uploaded) and the raw key as base64 —
 * the key never reaches the server in the clear; it rides inside the
 * E2E-encrypted chat message.
 */
export async function encryptMediaBytes(
  plaintext: ArrayBuffer | Bytes,
): Promise<{ ciphertext: Uint8Array<ArrayBuffer>; key: string }> {
  const c = getPlatform().crypto
  const key = c.randomBytes(32)
  const pt = plaintext instanceof Uint8Array ? plaintext : new Uint8Array(plaintext)
  const combined = await gcmSealPacked(c, key, pt)
  return { ciphertext: new Uint8Array(combined), key: toBase64(key) }
}

/** Inverse of encryptMediaBytes. Throws OperationError on a wrong key or tampered blob. */
export async function decryptMediaBytes(packed: ArrayBuffer | Bytes, keyB64: string): Promise<ArrayBuffer> {
  const c = getPlatform().crypto
  const combined = packed instanceof Uint8Array ? packed : new Uint8Array(packed)
  const pt = await gcmOpenPacked(c, fromBase64(keyB64), combined)
  return pt.buffer.slice(pt.byteOffset, pt.byteOffset + pt.byteLength) as ArrayBuffer
}
