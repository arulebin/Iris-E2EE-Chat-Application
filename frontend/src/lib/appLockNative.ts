import { Capacitor, registerPlugin } from '@capacitor/core'
import { fromBase64, toBase64 } from '../crypto'
import {
  AppLockCanceledError,
  AppLockInvalidatedError,
  AppLockRequiredError,
} from './appLockCore'
import type { KeyWrapper } from './nativeKeystore'
import { authGuard } from './appLockGuard'

// Android side of the App lock: BiometricPrompt + an auth-required Keystore key.
// See android/.../AppLockPlugin.java.

export type NativeLockStatus = 'available' | 'none_enrolled' | 'unsupported'

type AppLockPlugin = {
  status(): Promise<{ status: NativeLockStatus }>
  authenticate(opts: { title: string; subtitle?: string }): Promise<void>
  createKey(opts: { alias: string; timeoutSeconds: number }): Promise<void>
  deleteKey(opts: { alias: string }): Promise<void>
  wrap(opts: { alias: string; data: string }): Promise<{ data: string }>
  unwrap(opts: { alias: string; data: string }): Promise<{ data: string }>
}

const Plugin = registerPlugin<AppLockPlugin>('AppLock')

/** How long after a successful prompt the Keystore lets the lock key be used. Just enough to unwrap the storage keys. */
const AUTH_WINDOW_SECONDS = 20

export const nativeAppLockPresent = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AppLock')

export async function nativeLockStatus(): Promise<NativeLockStatus> {
  if (!nativeAppLockPresent()) return 'unsupported'
  try {
    return (await Plugin.status()).status
  } catch {
    return 'unsupported'
  }
}

const codeOf = (err: unknown): string | undefined => (err as { code?: string })?.code

function mapError(err: unknown): unknown {
  switch (codeOf(err)) {
    case 'CANCELED': return new AppLockCanceledError('Authentication cancelled')
    case 'KEY_INVALIDATED':
    case 'KEY_MISSING': return new AppLockInvalidatedError('App lock key is no longer valid')
    case 'AUTH_REQUIRED': return new AppLockRequiredError('Authentication required')
    default: return err
  }
}

/** Show the system biometric / screen-lock prompt. Rejects with AppLockCanceledError if dismissed. */
export async function nativeAuthenticate(subtitle?: string): Promise<void> {
  authGuard.begin()
  try {
    await Plugin.authenticate({ title: 'Unlock Iris', subtitle })
  } catch (err) {
    throw mapError(err)
  } finally {
    authGuard.end(Date.now())
  }
}

/** Generate a fresh auth-required key (replacing any old one). */
export function nativeCreateKey(user: string): Promise<void> {
  return Plugin.createKey({ alias: user, timeoutSeconds: AUTH_WINDOW_SECONDS })
}

export function nativeDeleteKey(user: string): Promise<void> {
  return Plugin.deleteKey({ alias: user })
}

/**
 * The lock layer for one account. If the Keystore says the user hasn't
 * authenticated recently, prompt once and retry, so a lazily loaded key can't
 * fail just because the window lapsed.
 */
export function nativeLockLayer(user: string): KeyWrapper {
  async function call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (codeOf(err) !== 'AUTH_REQUIRED') throw mapError(err)
    }
    await nativeAuthenticate()
    try {
      return await fn()
    } catch (err) {
      throw mapError(err)
    }
  }
  return {
    wrap: raw => call(async () => (await Plugin.wrap({ alias: user, data: toBase64(raw) })).data),
    unwrap: blob => call(async () => fromBase64((await Plugin.unwrap({ alias: user, data: blob })).data)),
    reset: () => nativeDeleteKey(user),
  }
}
