import NetInfo from '@react-native-community/netinfo'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { AppState } from 'react-native'
import { createMMKV } from 'react-native-mmkv'
import { type KeyWrapper, type KV, type TokenStore } from '@iris/core'
import { IrisKeystore } from '../../modules/iris-keystore/src'
import { nativeCryptoProvider } from '../crypto/provider'
import { createAppLockWrapper, createKeystoreWrapper } from './keystore'
import { openEncryptedKV, type MmkvFactory } from './kv'
import { createLifecycle } from './lifecycle'
import { createPush, type NotificationsLike } from './push'
import { createWrappedTokenStore } from './tokenStore'
import { createRnTransport, type RnTransport } from './transport'

export * from './keystore'
export * from './kv'
export * from './lifecycle'
export * from './push'
export * from './screenSecurity'
export * from './tokenStore'
export * from './transport'

/** Production API; dev builds point elsewhere with EXPO_PUBLIC_API_BASE (e.g. http://localhost:8080 over `adb reverse`). */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE || 'https://129-225-92-235.sslip.io'

const mmkvFactory: MmkvFactory = cfg => createMMKV(cfg) as never

export function keystoreAvailable(): boolean {
  return IrisKeystore != null
}

export type Platform = {
  kv: KV
  keyWrapper: KeyWrapper
  appLock: ReturnType<typeof createAppLockWrapper>
  tokens: TokenStore
  transport: RnTransport
  push: ReturnType<typeof createPush>
}

/**
 * Wire every adapter for one local account. `alias` selects the Keystore keys (one per account).
 * Opens the encrypted MMKV, so it is async and may throw KeystoreKeyMissingError (data lost).
 */
export async function createPlatform(opts: {
  alias?: string
  baseUrl?: string
  getDeviceId?: () => number | null | undefined
  onSignedOut?: () => void
}): Promise<Platform> {
  if (!IrisKeystore) throw new Error('IrisKeystore native module missing (needs a dev-client build)')
  const alias = opts.alias ?? 'default'
  const keyWrapper = createKeystoreWrapper(alias, IrisKeystore)
  const appLock = createAppLockWrapper(alias, IrisKeystore)
  const kv = await openEncryptedKV({ wrapper: keyWrapper, crypto: nativeCryptoProvider(), createMmkv: mmkvFactory, id: `iris-secure-${alias}`, bootId: `iris-secure-${alias}-boot` })
  const tokens = createWrappedTokenStore(kv, keyWrapper)
  const transport = createRnTransport({
    baseUrl: opts.baseUrl ?? API_BASE_URL,
    tokens,
    lifecycle: createLifecycle(AppState, { addEventListener: cb => NetInfo.addEventListener(cb) }),
    getDeviceId: opts.getDeviceId,
    onSignedOut: opts.onSignedOut,
  })
  const push = createPush({
    notifications: Notifications as unknown as NotificationsLike,
    importance: {
      HIGH: Notifications.AndroidImportance.HIGH,
      MAX: Notifications.AndroidImportance.MAX,
    },
    fetch: transport.fetch,
    kv,
    isDevice: Device.isDevice,
  })
  return { kv, keyWrapper, appLock, tokens, transport, push }
}
export * from './libsignal'
