import { Capacitor } from '@capacitor/core'
import { getConfig, layeredWrapper } from './appLockCore'
import { nativeLockLayer } from './appLockNative'
import { webPrfLayer } from './appLockWeb'
import type { KeyWrapper } from './nativeKeystore'

/** "alice" and "alice#history" are the two Keystore aliases of account alice. */
export const userOfAlias = (alias: string): string => alias.split('#')[0]

/**
 * Put the account's App lock (when enabled) on top of `base` (the Android
 * Keystore wrapper, or null on the web). Called by every store that wants an
 * at-rest wrapper, so the lock applies to Signal state and message history alike.
 *
 * Android: always returns a wrapper (the base one), re-checking the config on
 * every call, so turning the lock on/off needs no restart.
 * Web: a wrapper exists only while the PRF lock is enabled (AtRestCipher picks
 * its storage format from "wrapper or not" at construction, so toggling it
 * remounts the app; see AppLock.tsx).
 */
export function appLockWrapper(alias: string, base: KeyWrapper | null): KeyWrapper | null {
  const user = userOfAlias(alias)
  const native = Capacitor.isNativePlatform()
  if (!base && getConfig(user)?.mode !== 'prf') return null

  const locking = () => {
    const c = getConfig(user)
    return !!c && (native ? c.mode === 'native' : c.mode === 'prf')
  }
  const layer = (): KeyWrapper | null => {
    if (native) return nativeLockLayer(user)
    // Reading a locked blob works as long as a PRF credential is configured.
    return webPrfLayer(() => getConfig(user))
  }
  return layeredWrapper(base, layer, locking)
}
