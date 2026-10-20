import { fromBase64, toBase64, type KeyWrapper } from '@iris/core'
import type { IrisKeystoreNative } from '../../modules/iris-keystore/src'

/** The Keystore entry is gone (app data cleared, restored to another device): wrapped data is lost. */
export class KeystoreKeyMissingError extends Error {
  constructor(message = 'Keystore key for this alias is missing') {
    super(message)
    this.name = 'KeystoreKeyMissingError'
  }
}

/** Codes: AUTH_REQUIRED, KEY_INVALIDATED, CANCELED, LOCKOUT, FAILED, BAD_INPUT. */
export class KeystoreError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'KeystoreError'
    this.code = code
  }
}

function translate(err: unknown): never {
  const code = (err as { code?: string } | null)?.code
  if (code === 'KEY_MISSING') throw new KeystoreKeyMissingError()
  if (code) throw new KeystoreError(code, (err as Error).message)
  throw err
}

export type PlainKeyWrapper = KeyWrapper & {
  /** Destroy the wrapping key: everything wrapped under it becomes unreadable. */
  reset(): Promise<void>
  hasKey(): Promise<boolean>
  securityLevel(): Promise<string>
}

/**
 * KeyWrapper over an AES-256-GCM key in Android Keystore (StrongBox if available), one key per
 * alias (use one alias per local account). Wire format: iv(12) || ciphertext||tag.
 */
export function createKeystoreWrapper(alias: string, native: IrisKeystoreNative): PlainKeyWrapper {
  return {
    name: 'android-keystore',
    async wrap(plaintext) {
      try {
        return fromBase64(await native.wrap(alias, toBase64(plaintext)))
      } catch (e) {
        translate(e)
      }
    },
    async unwrap(wrapped) {
      try {
        return fromBase64(await native.unwrap(alias, toBase64(wrapped)))
      } catch (e) {
        translate(e)
      }
    },
    reset: () => native.reset(alias),
    hasKey: () => native.hasKey(alias),
    securityLevel: () => native.securityLevel(alias),
  }
}

export type AppLockWrapper = KeyWrapper & {
  status(): Promise<'available' | 'none_enrolled' | 'unsupported'>
  /** Show the system biometric / screen-lock prompt; opens the auth window of the lock key. */
  authenticate(title?: string, subtitle?: string): Promise<void>
  /** Create (replacing) the auth-required key. timeoutSeconds is the post-authentication window. */
  createKey(timeoutSeconds?: number): Promise<void>
  deleteKey(): Promise<void>
}

/**
 * Auth-bound KeyWrapper (app lock). wrap/unwrap reject with KeystoreError code AUTH_REQUIRED
 * unless the user authenticated within the window; KEY_INVALIDATED after biometric enrollment
 * changes. The lock UI itself comes later; this is the cryptographic primitive.
 */
export function createAppLockWrapper(alias: string, native: IrisKeystoreNative): AppLockWrapper {
  return {
    name: 'android-keystore-applock',
    status: () => native.lockStatus(),
    async authenticate(title = 'Unlock Iris', subtitle) {
      try {
        await native.lockAuthenticate(title, subtitle ?? null)
      } catch (e) {
        translate(e)
      }
    },
    async createKey(timeoutSeconds = 20) {
      try {
        await native.lockCreateKey(alias, timeoutSeconds)
      } catch (e) {
        translate(e)
      }
    },
    deleteKey: () => native.lockDeleteKey(alias),
    async wrap(plaintext) {
      try {
        return fromBase64(await native.lockWrap(alias, toBase64(plaintext)))
      } catch (e) {
        translate(e)
      }
    },
    async unwrap(wrapped) {
      try {
        return fromBase64(await native.lockUnwrap(alias, toBase64(wrapped)))
      } catch (e) {
        translate(e)
      }
    },
  }
}

/** Stack two wrappers: inner wraps first, outer wraps the result (app lock on top of Keystore). */
export function layerWrappers(inner: KeyWrapper, outer: KeyWrapper): KeyWrapper {
  return {
    name: `${outer.name}+${inner.name}`,
    async wrap(p) {
      return outer.wrap(await inner.wrap(p))
    },
    async unwrap(w) {
      return inner.unwrap(await outer.unwrap(w))
    },
  }
}
