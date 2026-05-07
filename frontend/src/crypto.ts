import { get, set } from 'idb-keyval'


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

// ── password-derived key encryption (for backing up the RSA privkey) ─

/**
 * Derive a 256-bit AES-GCM key from (password, salt) via PBKDF2-SHA256.
 * The returned key is non-extractable — it can encrypt/decrypt but never leaves Web Crypto.
 */
async function deriveKek(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
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

/**
 * Three-branch keypair recovery:
 *   1. IDB has both halves         → fast-path, no server / password needed.
 *   2. IDB empty, server has backup → derive KEK from password, decrypt privkey, save to IDB.
 *   3. Nothing anywhere            → generate, encrypt privkey under password, upload everything.
 *
 * The password is required for branches 2 and 3; pass an empty string only when
 * you're confident IDB is populated (e.g. page reload with existing token).
 */
export async function ensureKeyPair(username: string, password: string, token: string): Promise<{
  privateKey: CryptoKey
  publicKey: CryptoKey
}> {
  const privDbKey = `iris-private-key-${username}`
  const pubDbKey  = `iris-public-key-${username}`

  // Branch 1: IDB-only fast path
  const existingPriv = await get<JsonWebKey>(privDbKey)
  const existingPub  = await get<JsonWebKey>(pubDbKey)
  if (existingPriv && existingPub) {
    return {
      privateKey: await crypto.subtle.importKey('jwk', existingPriv, RSA_PARAMS, false, ['decrypt']),
      publicKey:  await crypto.subtle.importKey('jwk', existingPub,  RSA_PARAMS, false, ['encrypt']),
    }
  }

  // Branches 2 & 3 both need to derive a KEK
  if (!password) throw new Error('Password required to unlock or create keypair — log in again')

  const meRes = await fetch('/api/keys/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!meRes.ok) throw new Error(`Failed to fetch own keys: ${meRes.status}`)
  const myKeys = await meRes.json() as ServerKeys

  // Branch 2: server has a backup → unlock it
  if (myKeys.publicKey && myKeys.encryptedPrivateKey && myKeys.keySalt) {
    const salt = base64ToUint8(myKeys.keySalt)
    const kek = await deriveKek(password, salt)
    const privateJwkString = await unwrapPrivateJwk(myKeys.encryptedPrivateKey, kek)
    const privateJwk = JSON.parse(privateJwkString) as JsonWebKey
    const publicJwk  = JSON.parse(myKeys.publicKey)  as JsonWebKey
    await set(privDbKey, privateJwk)
    await set(pubDbKey,  publicJwk)
    return {
      privateKey: await crypto.subtle.importKey('jwk', privateJwk, RSA_PARAMS, false, ['decrypt']),
      publicKey:  await crypto.subtle.importKey('jwk', publicJwk,  RSA_PARAMS, false, ['encrypt']),
    }
  }

  // Branch 3: cold start — generate and back up
  const pair = await crypto.subtle.generateKey(RSA_PARAMS, true, ['encrypt', 'decrypt']) as CryptoKeyPair
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const publicJwk  = await crypto.subtle.exportKey('jwk', pair.publicKey)
  await set(privDbKey, privateJwk)
  await set(pubDbKey,  publicJwk)

  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(SALT_BYTES)))
  const kek = await deriveKek(password, salt)
  const encryptedPrivateKey = await wrapPrivateJwk(JSON.stringify(privateJwk), kek)

  const res = await fetch('/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      publicKey: JSON.stringify(publicJwk),
      encryptedPrivateKey,
      keySalt: uint8ToBase64(salt),
    }),
  })
  if (!res.ok) throw new Error(`Failed to upload keys: ${res.status}`)

  return {
    privateKey: await crypto.subtle.importKey('jwk', privateJwk, RSA_PARAMS, false, ['decrypt']),
    publicKey:  await crypto.subtle.importKey('jwk', publicJwk,  RSA_PARAMS, false, ['encrypt']),
  }
}

/**
 * Fetch and import another user's public key.
 */
export async function fetchPublicKey(username: string, token: string): Promise<CryptoKey> {
  const res = await fetch(`/api/keys/${encodeURIComponent(username)}`, {
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
