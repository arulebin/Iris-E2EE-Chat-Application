import * as Notifications from 'expo-notifications'
import { createMMKV } from 'react-native-mmkv'
import { IrisKeystore } from '../../modules/iris-keystore/src'
import { nativeCryptoProvider } from '../crypto/provider'
import { createAppLockWrapper, createKeystoreWrapper, KeystoreKeyMissingError } from './keystore'
import { openEncryptedKV, type MmkvFactory } from './kv'
import { isScreenSecure } from './screenSecurity'
import { createWrappedTokenStore } from './tokenStore'

/** On-device smoke test of the native adapters (no network, no account). Rows: name, ok, detail. */
export async function runPlatformSmoke(log: (name: string, ok: boolean, detail?: string) => void) {
  const step = async (name: string, fn: () => Promise<string | void>) => {
    try {
      log(name, true, (await fn()) ?? undefined)
    } catch (e) {
      log(name, false, String((e as Error)?.stack ?? e).slice(0, 300))
    }
  }
  if (!IrisKeystore) return log('IrisKeystore native module present', false)
  const alias = 'smoke-' + Date.now()
  const w = createKeystoreWrapper(alias, IrisKeystore)
  const secret = Uint8Array.from({ length: 32 }, (_, i) => i * 7)

  await step('keystore wrap/unwrap roundtrip', async () => {
    const wrapped = await w.wrap(secret)
    const back = await w.unwrap(wrapped)
    if (back.length !== 32 || back.some((b, i) => b !== secret[i])) throw new Error('mismatch')
    if (wrapped.length !== 12 + 32 + 16) throw new Error('unexpected blob length ' + wrapped.length)
    return 'blob ' + wrapped.length + 'B, level=' + (await w.securityLevel())
  })
  await step('keystore reset -> KEY_MISSING', async () => {
    const wrapped = await w.wrap(secret)
    await w.reset()
    try {
      await w.unwrap(wrapped)
    } catch (e) {
      if (e instanceof KeystoreKeyMissingError) return
      throw e
    }
    throw new Error('unwrap succeeded after reset')
  })
  await step('encrypted MMKV (key wrapped by Keystore) persists + reopens', async () => {
    const mk: MmkvFactory = cfg => createMMKV(cfg) as never
    const w2 = createKeystoreWrapper(alias + '-kv', IrisKeystore!)
    const kv = await openEncryptedKV({ wrapper: w2, crypto: nativeCryptoProvider(), createMmkv: mk, id: alias })
    await kv.set('x', { n: 1, b: new Uint8Array([1, 2, 3]) })
    const kv2 = await openEncryptedKV({ wrapper: w2, crypto: nativeCryptoProvider(), createMmkv: mk, id: alias })
    const got = await kv2.get<{ n: number; b: Uint8Array }>('x')
    if (got?.n !== 1 || got.b[2] !== 3) throw new Error('bad read ' + JSON.stringify(got))
    await w2.reset()
  })
  await step('token store wrapped at rest', async () => {
    const mk: MmkvFactory = cfg => createMMKV(cfg) as never
    const w3 = createKeystoreWrapper(alias + '-tok', IrisKeystore!)
    const kv = await openEncryptedKV({ wrapper: w3, crypto: nativeCryptoProvider(), createMmkv: mk, id: alias + 't' })
    const ts = createWrappedTokenStore(kv, w3)
    await ts.set('access-token', 'refresh-token')
    const ts2 = createWrappedTokenStore(kv, w3)
    if ((await ts2.getRefresh()) !== 'refresh-token' || (await ts2.getAccess()) !== 'access-token') throw new Error('mismatch')
    const raw = JSON.stringify(await kv.get('auth.refresh'))
    if (raw.includes('refresh-token')) throw new Error('plaintext token in storage')
    await ts.clear()
    await w3.reset()
  })
  await step('app lock status', async () => {
    const l = createAppLockWrapper(alias, IrisKeystore!)
    return await l.status()
  })
  await step('app lock key requires auth (wrap -> AUTH_REQUIRED)', async () => {
    const l = createAppLockWrapper(alias + '-lock', IrisKeystore!)
    await l.createKey(5)
    try {
      await l.wrap(secret)
    } catch (e) {
      await l.deleteKey()
      if ((e as { code?: string }).code === 'AUTH_REQUIRED') return 'AUTH_REQUIRED as expected'
      throw e
    }
    await l.deleteKey()
    throw new Error('wrap succeeded without authentication')
  })
  await step('FLAG_SECURE default on', async () => {
    if (!isScreenSecure()) throw new Error('not secure')
  })
  await step('FCM device token (needs google-services.json + POST_NOTIFICATIONS)', async () => {
    const t = await Notifications.getDevicePushTokenAsync()
    return String(t.type) + ' ' + String(t.data).slice(0, 12) + '...'
  })
}
