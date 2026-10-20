import { Capacitor, registerPlugin } from '@capacitor/core'
import { KeystoreKeyMissingError, type KeyWrapper } from '@iris/core'
import { fromBase64, toBase64 } from '../crypto'
import { appLockWrapper } from './appLockWrapper'

// Android Keystore wrapping for the Signal storage key (native app only).
//
// In a browser the storage key is a non-extractable CryptoKey kept in
// IndexedDB — the best the web offers. In the Android app the raw key bytes are
// instead wrapped by a hardware-backed, non-exportable Keystore key, and only
// the wrapped blob is stored. Copying the app's IndexedDB off the device (a
// backup, a rooted dump) then yields nothing usable without that device's
// Keystore. See android/.../KeystorePlugin.java.

// KeyWrapper (and KeystoreKeyMissingError) are defined in @iris/core; this file is
// the Capacitor Keystore implementation of it.
export type { KeyWrapper }
export { KeystoreKeyMissingError }

type KeystorePlugin = {
  wrap(opts: { alias: string; data: string }): Promise<{ data: string }>
  unwrap(opts: { alias: string; data: string }): Promise<{ data: string }>
  reset(opts: { alias: string }): Promise<void>
}

const Keystore = registerPlugin<KeystorePlugin>('Keystore')

export const nativeKeystoreAvailable = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Keystore')

/**
 * The wrapper stores use for one alias (one per local account): the Keystore
 * wrapper, with the optional App lock layered on top (lib/appLockWrapper), or
 * null off-device when no lock layer applies.
 */
export function nativeKeyWrapper(alias: string): KeyWrapper | null {
  return appLockWrapper(alias, plainNativeKeyWrapper(alias))
}

/** The bare Keystore wrapper for one alias (no App lock), or null off-device. */
export function plainNativeKeyWrapper(alias: string): KeyWrapper | null {
  if (!nativeKeystoreAvailable()) return null
  return {
    async wrap(raw) {
      return (await Keystore.wrap({ alias, data: toBase64(raw) })).data
    },
    async unwrap(wrapped) {
      try {
        return fromBase64((await Keystore.unwrap({ alias, data: wrapped })).data)
      } catch (err) {
        if ((err as { code?: string })?.code === 'KEY_MISSING') {
          throw new KeystoreKeyMissingError('Keystore key for this account is missing')
        }
        throw err
      }
    },
    reset: () => Keystore.reset({ alias }),
  }
}
