import { fromBase64, toBase64 } from '../crypto'
import { AppLockCanceledError, AppLockRequiredError, type AppLockConfig } from './appLockCore'
import type { KeyWrapper } from './nativeKeystore'

// Web side of the App lock: a WebAuthn platform authenticator (Windows Hello,
// Touch ID / Face ID, Android biometrics) with user verification required.
//
// If the authenticator supports the PRF extension, its secret output becomes a
// wrapping key for the at-rest storage keys (mode 'prf': a real cryptographic
// lock). Without PRF there is nothing to derive a key from, so the lock is only
// a UI gate (mode 'gate'): anyone who can run script in the page or read
// IndexedDB bypasses it. The settings text says so.
//
// Local only: assertions are never sent anywhere or verified server-side.

type PrfOutputs = { prf?: { enabled?: boolean; results?: { first?: BufferSource } } }

const te = new TextEncoder()

export async function webLockAvailable(): Promise<boolean> {
  try {
    if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials) return false
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n))

function mapError(err: unknown): unknown {
  const name = (err as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'AbortError') return new AppLockCanceledError('Authentication cancelled')
  return err
}

async function assert(credId: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array | null> {
  try {
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge: rand(32),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: credId, transports: ['internal'] }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null
    if (!cred) throw new AppLockCanceledError('No credential returned')
    const first = (cred.getClientExtensionResults() as PrfOutputs).prf?.results?.first
    if (!first) return null
    return ArrayBuffer.isView(first)
      ? new Uint8Array(first.buffer.slice(first.byteOffset, first.byteOffset + first.byteLength) as ArrayBuffer)
      : new Uint8Array(first as ArrayBuffer)
  } catch (err) {
    throw mapError(err)
  }
}

/**
 * Create the platform credential for `user`. Returns whether PRF works (probed
 * with a real assertion, since some browsers only report PRF output on get()).
 */
export async function webRegister(user: string): Promise<Pick<AppLockConfig, 'credId' | 'salt'> & { prf: boolean }> {
  const salt = rand(32)
  let created: PublicKeyCredential | null
  try {
    created = (await navigator.credentials.create({
      publicKey: {
        rp: { name: 'Iris', id: location.hostname },
        user: { id: rand(16), name: user, displayName: user },
        challenge: rand(32),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'discouraged',
        },
        extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null
  } catch (err) {
    throw mapError(err)
  }
  if (!created) throw new AppLockCanceledError('No credential created')
  const credId = new Uint8Array(created.rawId)
  const prfEnabled = (created.getClientExtensionResults() as PrfOutputs).prf?.enabled === true
  let prf = false
  if (prfEnabled) {
    // Proves the authenticator really returns a secret (and that the user can pass UV again).
    const out = await assert(credId, salt)
    prf = out !== null
    if (out) { sessionKey = await deriveKey(out); out.fill(0) }   // saves a second prompt while enabling
  }
  return { credId: toBase64(credId), salt: toBase64(salt), prf }
}

// The derived wrapping key is held only for an unlocked session; lock() clears it.
let sessionKey: CryptoKey | null = null

export const clearWebLockSession = () => { sessionKey = null }

async function deriveKey(prf: Uint8Array): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', prf as Uint8Array<ArrayBuffer>, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode('iris-applock-wrap-v1') },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

/** Run the WebAuthn prompt. In 'prf' mode this also (re)derives the session wrapping key. */
export async function webAuthenticate(cfg: AppLockConfig): Promise<void> {
  if (!cfg.credId || !cfg.salt) throw new AppLockRequiredError('No credential')
  const out = await assert(fromBase64(cfg.credId) as Uint8Array<ArrayBuffer>, fromBase64(cfg.salt) as Uint8Array<ArrayBuffer>)
  if (cfg.mode === 'prf') {
    if (!out) throw new AppLockRequiredError('Authenticator returned no PRF output')
    sessionKey = await deriveKey(out)
    out.fill(0)
  }
}

/** PRF wrapping layer. Prompts on first use per unlocked session. */
export function webPrfLayer(cfg: () => AppLockConfig | null): KeyWrapper {
  async function key(): Promise<CryptoKey> {
    if (sessionKey) return sessionKey
    const c = cfg()
    if (!c) throw new AppLockRequiredError('App lock is not configured')
    await webAuthenticate(c)
    return sessionKey!
  }
  const ad = te.encode('iris-applock-wrap')
  return {
    async wrap(raw) {
      const iv = rand(12)
      const ct = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: ad }, await key(), raw as Uint8Array<ArrayBuffer>))
      const out = new Uint8Array(12 + ct.length)
      out.set(iv); out.set(ct, 12)
      return toBase64(out)
    },
    async unwrap(blob) {
      const packed = fromBase64(blob)
      return new Uint8Array(await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: packed.slice(0, 12), additionalData: ad }, await key(), packed.slice(12)))
    },
    async reset() { /* the credential lives in the authenticator; nothing to destroy here */ },
  }
}
