/**
 * The cryptographic primitives Iris needs, as byte-in / byte-out operations.
 *
 * Why not just pass SubtleCrypto around? Because the platforms differ in what
 * they can do (see docs/mobile-architecture.md):
 *   - web: WebCrypto (native, non-extractable keys)
 *   - RN:  react-native-quick-crypto's subtle (native OpenSSL) for most things,
 *          pure-JS (@noble / fflate) for the gaps
 * A byte-level interface lets an adapter pick the best backend per operation,
 * and lets one conformance suite (@iris/crypto-conformance) validate every backend.
 *
 * Long-lived secrets (legacy RSA private key, master key) are NOT modelled here as
 * CryptoKey handles; at-rest protection is the KeyWrapper's job.
 */

export type Bytes = Uint8Array
export type HashName = 'SHA-256' | 'SHA-512'

/** RSA key in JWK form (the format Iris stores and the server publishes). */
export type RsaJwk = {
  kty: 'RSA'
  n: string
  e: string
  d?: string
  p?: string
  q?: string
  dp?: string
  dq?: string
  qi?: string
}

export interface CryptoProvider {
  /** Human-readable backend name, for diagnostics. */
  readonly name: string

  randomBytes(length: number): Bytes
  digest(hash: HashName, data: Bytes): Promise<Bytes>
  hmac(hash: HashName, key: Bytes, data: Bytes): Promise<Bytes>
  /** RFC 5869. */
  hkdf(hash: HashName, ikm: Bytes, salt: Bytes, info: Bytes, lengthBytes: number): Promise<Bytes>
  /** RFC 8018 with HMAC-<hash> PRF. Iris uses SHA-256 with 600_000 iterations. */
  pbkdf2(hash: HashName, password: Bytes, salt: Bytes, iterations: number, lengthBytes: number): Promise<Bytes>

  /** AES-GCM, 128-bit tag appended to the ciphertext (WebCrypto layout). */
  aesGcmEncrypt(key: Bytes, iv: Bytes, plaintext: Bytes, aad?: Bytes): Promise<Bytes>
  aesGcmDecrypt(key: Bytes, iv: Bytes, ciphertext: Bytes, aad?: Bytes): Promise<Bytes>
  /** AES-CBC with PKCS#7 padding (libsignal message encryption). */
  aesCbcEncrypt(key: Bytes, iv: Bytes, plaintext: Bytes): Promise<Bytes>
  aesCbcDecrypt(key: Bytes, iv: Bytes, ciphertext: Bytes): Promise<Bytes>

  /** Legacy v1 paths only. RSA-OAEP, SHA-256 for hash and MGF1, empty label. */
  rsaOaepEncrypt(publicJwk: RsaJwk, plaintext: Bytes): Promise<Bytes>
  rsaOaepDecrypt(privateJwk: RsaJwk, ciphertext: Bytes): Promise<Bytes>
  /** Legacy identity cross-signature. RSA-PSS, SHA-256, MGF1-SHA-256, explicit salt length. */
  rsaPssSign(privateJwk: RsaJwk, data: Bytes, saltLength: number): Promise<Bytes>
  rsaPssVerify(publicJwk: RsaJwk, signature: Bytes, data: Bytes, saltLength: number): Promise<boolean>

  /** Optional (backups). Callers fall back to uncompressed when absent. */
  gzip?(data: Bytes): Promise<Bytes>
  gunzip?(data: Bytes): Promise<Bytes>
}
