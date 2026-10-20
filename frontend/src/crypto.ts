import { get, set } from 'idb-keyval'
import { apiBase } from './lib/config'


const PBKDF2_ITERATIONS = 600_000 
const SALT_BYTES = 16
const IV_BYTES = 12
const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
}

const AES_PARAMS = { name: 'AES-GCM', length: 256 }

// ── tiny base64 helpers (the browser doesn't have a one-liner for ArrayBuffers) ──

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToUint8(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64)
  const buffer = new ArrayBuffer(binary.length)        // explicit ArrayBuffer (not ArrayBufferLike)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

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

const AUTH_INFO = new TextEncoder().encode('iris-auth-v2')
const KEK_INFO  = new TextEncoder().encode('iris-kek-v2')

export type Credentials = {
  authKey: string     // base64, sent to the server in place of the password
  master: CryptoKey   // non-extractable HKDF key; never leaves the browser
}

export function newSalt(): string {
  return uint8ToBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)))
}

export async function deriveCredentials(password: string, authSaltB64: string): Promise<Credentials> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const masterBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: base64ToUint8(authSaltB64), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    256
  )
  const master = await crypto.subtle.importKey('raw', masterBits, 'HKDF', false, ['deriveBits', 'deriveKey'])
  const authBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: AUTH_INFO },
    master,
    256
  )
  return { authKey: uint8ToBase64(new Uint8Array(authBits)), master }
}

/** v2 KEK: HKDF from the master secret. Non-extractable AES-GCM key. */
async function deriveKek(master: CryptoKey, keySalt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: keySalt, info: KEK_INFO },
    master,
    AES_PARAMS,
    false,
    ['encrypt', 'decrypt']
  )
}

/** v1 KEK: PBKDF2 straight from the password. Only used to unwrap a legacy backup during upgrade. */
async function deriveLegacyKek(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    AES_PARAMS,
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * AES-GCM encrypt the JWK string under the KEK.
 * Returns base64(IV || ciphertext) — the IV is prepended so unwrap can find it.
 */
async function wrapPrivateJwk(jwkString: string, kek: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ctBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    kek,
    new TextEncoder().encode(jwkString)
  )
  const combined = new Uint8Array(iv.length + ctBuffer.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ctBuffer), iv.length)
  return uint8ToBase64(combined)
}

/**
 * Inverse of wrapPrivateJwk. Throws OperationError if the KEK doesn't match
 * (wrong password) or the blob has been tampered with — AES-GCM's auth tag catches both.
 */
async function unwrapPrivateJwk(packedB64: string, kek: CryptoKey): Promise<string> {
  const combined = base64ToUint8(packedB64)
  const iv = combined.slice(0, IV_BYTES)
  const ct = combined.slice(IV_BYTES)
  const ptBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, ct)
  return new TextDecoder().decode(ptBuffer)
}

// ── key management ─────────────────────────────────────────────────

type ServerKeys = {
  publicKey: string | null
  encryptedPrivateKey: string | null
  keySalt: string | null
}

const privDbKeyFor = (username: string) => `iris-private-key-${username}`
const pubDbKeyFor  = (username: string) => `iris-public-key-${username}`

async function fetchMyKeys(token: string): Promise<ServerKeys> {
  const res = await fetch(`${apiBase}/api/keys/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Failed to fetch own keys: ${res.status}`)
  return await res.json() as ServerKeys
}

/**
 * Import the private JWK as a NON-extractable CryptoKey and cache that in IDB.
 * IndexedDB structured-clones CryptoKeys, so the raw key material never sits in
 * storage where an injected script could read it — it can only ask Web Crypto to
 * decrypt while the page is open. If the browser refuses to store the key, the
 * session still works from memory; the user just unlocks again next launch.
 */
async function cachePrivateKey(dbKey: string, jwk: JsonWebKey): Promise<CryptoKey> {
  const key = await crypto.subtle.importKey('jwk', jwk, RSA_PARAMS, false, ['decrypt'])
  try {
    await set(dbKey, key)
  } catch (err) {
    console.warn('Could not persist private key; it will be kept in memory only', err)
  }
  return key
}

/**
 * Decrypt the server-stored, KEK-wrapped private key, cache it in IDB, and import
 * both halves. Used by the normal restore branch AND by the conflict (409) path,
 * so a second device always converges on the ONE server keypair.
 * Throws OperationError if the password is wrong (AES-GCM auth failure).
 */
async function restoreFromBackup(
  keys: ServerKeys,
  master: CryptoKey,
  privDbKey: string,
  pubDbKey: string,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  const kek = await deriveKek(master, base64ToUint8(keys.keySalt!))
  const privateJwk = JSON.parse(await unwrapPrivateJwk(keys.encryptedPrivateKey!, kek)) as JsonWebKey
  const publicJwk  = JSON.parse(keys.publicKey!) as JsonWebKey
  const privateKey = await cachePrivateKey(privDbKey, privateJwk)
  await set(pubDbKey, publicJwk)
  return {
    privateKey,
    publicKey: await crypto.subtle.importKey('jwk', publicJwk, RSA_PARAMS, false, ['encrypt']),
  }
}

/**
 * Three-branch keypair recovery:
 *   1. IDB has both halves         → fast-path, no server / password needed.
 *   2. IDB empty, server has backup → derive KEK from the master secret, decrypt privkey, save to IDB.
 *   3. Nothing anywhere            → generate, encrypt privkey under the KEK, upload everything.
 *
 * `master` (from deriveCredentials) is required for branches 2 and 3; pass null
 * only when you're confident IDB is populated (e.g. page reload with existing token).
 */
export async function ensureKeyPair(username: string, master: CryptoKey | null, token: string): Promise<{
  privateKey: CryptoKey
  publicKey: CryptoKey
}> {
  const privDbKey = privDbKeyFor(username)
  const pubDbKey  = pubDbKeyFor(username)

  // Branch 1: IDB-only fast path. Older builds cached the private key as a plain
  // JWK; convert those to a non-extractable CryptoKey (overwriting the JWK) on sight.
  const existingPriv = await get<CryptoKey | JsonWebKey>(privDbKey)
  const existingPub  = await get<JsonWebKey>(pubDbKey)
  if (existingPriv && existingPub) {
    return {
      privateKey: existingPriv instanceof CryptoKey
        ? existingPriv
        : await cachePrivateKey(privDbKey, existingPriv),
      publicKey: await crypto.subtle.importKey('jwk', existingPub, RSA_PARAMS, false, ['encrypt']),
    }
  }

  // Branches 2 & 3 both need to derive a KEK
  if (!master) throw new Error('Password required to unlock or create keypair — log in again')

  const myKeys = await fetchMyKeys(token)

  // Branch 2: server has a backup → unlock it (recovers the SAME key on every device)
  if (myKeys.publicKey && myKeys.encryptedPrivateKey && myKeys.keySalt) {
    return restoreFromBackup(myKeys, master, privDbKey, pubDbKey)
  }

  // Branch 3: cold start — generate, upload, and ONLY persist locally once the
  // server has accepted. Writing IDB before the upload (the old behaviour) meant a
  // failed POST left an un-backed-up local key that Branch 1 would then serve
  // forever while the server stayed empty — the root cause of cross-device divergence.
  // The pair must be extractable once so the private half can be wrapped; only the
  // non-extractable re-import is kept.
  const pair = await crypto.subtle.generateKey(RSA_PARAMS, true, ['encrypt', 'decrypt']) as CryptoKeyPair
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const publicJwk  = await crypto.subtle.exportKey('jwk', pair.publicKey)

  const keySalt = newSalt()
  const kek = await deriveKek(master, base64ToUint8(keySalt))
  const encryptedPrivateKey = await wrapPrivateJwk(JSON.stringify(privateJwk), kek)

  const res = await fetch(`${apiBase}/api/keys`, {
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
    return restoreFromBackup(recovered, master, privDbKey, pubDbKey)
  }
  if (!res.ok) throw new Error(`Failed to upload keys: ${res.status}`)

  // Server accepted — now it's safe to cache the keypair locally.
  const privateKey = await cachePrivateKey(privDbKey, privateJwk)
  await set(pubDbKey, publicJwk)
  return {
    privateKey,
    publicKey: await crypto.subtle.importKey('jwk', publicJwk, RSA_PARAMS, false, ['encrypt']),
  }
}

// ── v1 → v2 account upgrade ────────────────────────────────────────

export type AuthSaltInfo = { version: number; authSalt: string | null }

const upgradedMarkFor = (username: string) => `iris-cred-v2-${username}`

/** Remember that this account is v2, so this device never again sends its raw password. */
export function markUpgraded(username: string): void {
  try { localStorage.setItem(upgradedMarkFor(username), '1') } catch { /* storage blocked — guard just won't apply */ }
}

/**
 * Pre-login lookup of the account's credential version + salt. A malicious server
 * could answer "v1" for a v2 account to trick the client into sending the raw
 * password; once this device has seen the account at v2, refuse that downgrade.
 */
export async function fetchAuthSalt(username: string): Promise<AuthSaltInfo> {
  const res = await fetch(`${apiBase}/auth/salt/${encodeURIComponent(username)}`)
  if (!res.ok) throw new Error(`Failed to start login: ${res.status}`)
  const info = await res.json() as AuthSaltInfo
  let upgradedHere = false
  try { upgradedHere = localStorage.getItem(upgradedMarkFor(username)) === '1' } catch { /* ignore */ }
  if (info.version < 2 && upgradedHere) {
    throw new Error("The server asked for this account's legacy password login, which this device already upgraded. Refusing to send your password.")
  }
  if (info.version >= 2 && !info.authSalt) throw new Error('Server returned no salt for this account')
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
export async function upgradeLegacyAccount(username: string, password: string, token: string): Promise<CryptoKey> {
  const myKeys = await fetchMyKeys(token)
  const authSalt = newSalt()
  const { authKey, master } = await deriveCredentials(password, authSalt)

  let rewrapped: ServerKeys = { publicKey: null, encryptedPrivateKey: null, keySalt: null }
  if (myKeys.publicKey && myKeys.encryptedPrivateKey && myKeys.keySalt) {
    const legacyKek = await deriveLegacyKek(password, base64ToUint8(myKeys.keySalt))
    const privateJwkString = await unwrapPrivateJwk(myKeys.encryptedPrivateKey, legacyKek)
    const keySalt = newSalt()
    const kek = await deriveKek(master, base64ToUint8(keySalt))
    rewrapped = {
      publicKey: myKeys.publicKey, // echoed verbatim — the server rejects any other key
      encryptedPrivateKey: await wrapPrivateJwk(privateJwkString, kek),
      keySalt,
    }

    // Seed an empty device with the key now. The keypair doesn't change in this
    // migration, so caching it before the server call can't cause divergence — and
    // it keeps the session usable even if the upgrade request fails.
    const privDbKey = privDbKeyFor(username)
    const pubDbKey  = pubDbKeyFor(username)
    if (!(await get(privDbKey)) || !(await get(pubDbKey))) {
      await cachePrivateKey(privDbKey, JSON.parse(privateJwkString) as JsonWebKey)
      await set(pubDbKey, JSON.parse(myKeys.publicKey) as JsonWebKey)
    }
  }

  const res = await fetch(`${apiBase}/api/credentials/upgrade`, {
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

  markUpgraded(username)
  return master
}

/**
 * Fetch and import another user's public key.
 */
export async function fetchPublicKey(username: string, token: string): Promise<CryptoKey> {
  const res = await fetch(`${apiBase}/api/keys/${encodeURIComponent(username)}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) throw new Error(`Failed to fetch public key for ${username}: ${res.status}`)
  const jwkString = await res.text()
  const jwk = JSON.parse(jwkString)
  return crypto.subtle.importKey('jwk', jwk, RSA_PARAMS, false, ['encrypt'])
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
  myPublicKey: CryptoKey,
  recipientPublicKey: CryptoKey
): Promise<EncryptedMessage> {
  // 1. Generate a fresh AES key for this single message
  const aesKey = await crypto.subtle.generateKey(AES_PARAMS, true, ['encrypt', 'decrypt'])

  // 2. Encrypt the content with AES-GCM (random 12-byte IV)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ctBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(plaintext)
  )

  // 3. Pack IV + ciphertext into one byte array for transport
  const combined = new Uint8Array(iv.length + ctBuffer.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ctBuffer), iv.length)

  // 4. Wrap the AES key for both parties
  const aesKeyRaw = await crypto.subtle.exportKey('raw', aesKey)
  const wrappedForSender    = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, myPublicKey,        aesKeyRaw)
  const wrappedForRecipient = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipientPublicKey, aesKeyRaw)

  return {
    ciphertext:               uint8ToBase64(combined),
    encryptedKeyForSender:    uint8ToBase64(new Uint8Array(wrappedForSender)),
    encryptedKeyForRecipient: uint8ToBase64(new Uint8Array(wrappedForRecipient)),
  }
}

/**
 * Decrypt with the matching RSA private key.
 * `encryptedKey` must be the one that was wrapped for *this* user.
 */
export async function decryptMessage(
  ciphertextB64: string,
  encryptedKeyB64: string,
  privateKey: CryptoKey
): Promise<string> {
  // 1. Unwrap the AES key with our RSA private key
  const aesKeyRaw = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    base64ToUint8(encryptedKeyB64)
  )
  const aesKey = await crypto.subtle.importKey('raw', aesKeyRaw, { name: 'AES-GCM' }, false, ['decrypt'])

  // 2. Split IV (first 12 bytes) from ciphertext
  const combined = base64ToUint8(ciphertextB64)
  const iv = combined.slice(0, 12)
  const ct = combined.slice(12)

  // 3. AES-GCM decrypt
  const ptBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct)
  return new TextDecoder().decode(ptBuffer)
}

// ── helpers for the Signal-protocol layer (lib/signal) ─────────────

export const toBase64 = uint8ToBase64
export const fromBase64 = base64ToUint8

/**
 * Wrap arbitrary secret bytes under a KEK derived from the login master secret.
 * `info` domain-separates each use (the RSA backup uses 'iris-kek-v2'), so the
 * same password never yields the same key for two different secrets.
 * Returns { wrapped: base64(iv ‖ ct), salt: base64 }.
 */
export async function wrapWithMaster(
  master: CryptoKey, plaintext: Uint8Array<ArrayBuffer>, info: string,
): Promise<{ wrapped: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const kek = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(info) },
    master, AES_PARAMS, false, ['encrypt'],
  )
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, plaintext)
  const packed = new Uint8Array(iv.length + ct.byteLength)
  packed.set(iv, 0)
  packed.set(new Uint8Array(ct), iv.length)
  return { wrapped: uint8ToBase64(packed), salt: uint8ToBase64(salt) }
}

/** Inverse of wrapWithMaster. Throws OperationError for a wrong password / tampered blob. */
export async function unwrapWithMaster(
  master: CryptoKey, wrappedB64: string, saltB64: string, info: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const kek = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: base64ToUint8(saltB64), info: new TextEncoder().encode(info) },
    master, AES_PARAMS, false, ['decrypt'],
  )
  const packed = base64ToUint8(wrappedB64)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, IV_BYTES) }, kek, packed.slice(IV_BYTES))
  return new Uint8Array(pt)
}

const PSS_PARAMS: RsaHashedImportParams = { name: 'RSA-PSS', hash: 'SHA-256' }
const PSS_SALT_LENGTH = 32

/**
 * Sign with the account's legacy RSA key (RSA-PSS). The cached CryptoKey is
 * decrypt-only, so this unwraps the server backup with the master secret, uses
 * the JWK once, and drops it. Used to cross-sign the new identity key.
 */
export async function signWithLegacyKey(master: CryptoKey, token: string, data: Uint8Array<ArrayBuffer>): Promise<string> {
  const keys = await fetchMyKeys(token)
  if (!keys.encryptedPrivateKey || !keys.keySalt) throw new Error('No legacy key backup to sign with')
  const kek = await deriveKek(master, base64ToUint8(keys.keySalt))
  const jwk = JSON.parse(await unwrapPrivateJwk(keys.encryptedPrivateKey, kek)) as JsonWebKey
  // Same RSA key, different algorithm: drop the OAEP-specific metadata.
  const { kty, n, e, d, p, q, dp, dq, qi } = jwk
  const signKey = await crypto.subtle.importKey('jwk', { kty, n, e, d, p, q, dp, dq, qi }, PSS_PARAMS, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: PSS_SALT_LENGTH }, signKey, data)
  return uint8ToBase64(new Uint8Array(sig))
}

/** Verify a signWithLegacyKey signature against a public RSA JWK. */
export async function verifyLegacySignature(jwk: JsonWebKey, data: Uint8Array<ArrayBuffer>, sigB64: string): Promise<boolean> {
  try {
    const { kty, n, e } = jwk
    const key = await crypto.subtle.importKey('jwk', { kty, n, e }, PSS_PARAMS, false, ['verify'])
    return await crypto.subtle.verify({ name: 'RSA-PSS', saltLength: PSS_SALT_LENGTH }, key, base64ToUint8(sigB64), data)
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
  plaintext: ArrayBuffer,
): Promise<{ ciphertext: Uint8Array<ArrayBuffer>; key: string }> {
  const aesKey = await crypto.subtle.generateKey(AES_PARAMS, true, ['encrypt', 'decrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ctBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext)

  const combined = new Uint8Array(new ArrayBuffer(iv.length + ctBuffer.byteLength))
  combined.set(iv, 0)
  combined.set(new Uint8Array(ctBuffer), iv.length)

  const rawKey = await crypto.subtle.exportKey('raw', aesKey)
  return { ciphertext: combined, key: uint8ToBase64(new Uint8Array(rawKey)) }
}

/** Inverse of encryptMediaBytes. Throws OperationError on a wrong key or tampered blob. */
export async function decryptMediaBytes(packed: ArrayBuffer, keyB64: string): Promise<ArrayBuffer> {
  const aesKey = await crypto.subtle.importKey(
    'raw',
    base64ToUint8(keyB64),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )
  const combined = new Uint8Array(packed)
  const iv = combined.slice(0, IV_BYTES)
  const ct = combined.slice(IV_BYTES)
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct)
}
