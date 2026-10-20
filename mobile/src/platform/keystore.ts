import { fromBase64, toBase64, utf8, KeystoreKeyMissingError, type KeyWrapper } from '@iris/core'
import type { IrisKeystoreNative } from '../../modules/iris-keystore/src'

export { KeystoreKeyMissingError }

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
  readonly name: string
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
        return await native.wrap(alias, toBase64(plaintext))
      } catch (e) {
        translate(e)
      }
    },
    async unwrap(wrapped) {
      try {
        return fromBase64(await native.unwrap(alias, wrapped))
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
  readonly name: string
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
    reset: () => native.lockDeleteKey(alias),
    async wrap(plaintext) {
      try {
        return await native.lockWrap(alias, toBase64(plaintext))
      } catch (e) {
        translate(e)
      }
    },
    async unwrap(wrapped) {
      try {
        return fromBase64(await native.lockUnwrap(alias, wrapped))
      } catch (e) {
        translate(e)
      }
    },
  }
}

/** Stack two wrappers: inner wraps first, outer wraps the result (app lock on top of Keystore). */
export function layerWrappers(inner: KeyWrapper, outer: KeyWrapper): KeyWrapper {
  return {
    async wrap(p) {
      return outer.wrap(utf8(await inner.wrap(p)))
    },
    async unwrap(w) {
      return inner.unwrap(new TextDecoder().decode(await outer.unwrap(w)))
    },
    async reset() {
      await outer.reset()
      await inner.reset()
    },
  }
}
