import { webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { KeyHelper, setWebCrypto } from '@privacyresearch/libsignal-protocol-typescript'
import {
  MemoryKV,
  SignalClient,
  SignalStore,
  b64,
  createMutex,
  encodeGroupPayload,
  encryptForDevice,
  generatePreKeys,
  generateSignedPreKey,
  getMessages,
  installLibsignalCrypto,
  startSession,
  type V2Meta,
} from '../src/index.ts'
import { fakeWrapper, setup, subtleProvider } from './env.ts'

// The push path and the socket path may both hand the same envelope to open(): only the
// call that really decrypted it reports `fresh` (and may notify); the other gets the stored copy.
describe('SignalClient.open idempotency', () => {
  it('decrypts once, reports fresh once, and files group messages under the group', async () => {
    const mutex = createMutex()
    setup(subtleProvider(), { getLocks: () => mutex })
    installLibsignalCrypto()
    try {
      const make = async (user: string, deviceId: number) => {
        const store = new SignalStore(user, new MemoryKV(), fakeWrapper())
        const id = await KeyHelper.generateIdentityKeyPair()
        await store.setIdentityKeyPair(id)
        await store.setDevice({ deviceId, registrationId: KeyHelper.generateRegistrationId(), nextPreKeyId: 1, signedPreKeys: [] })
        return { store, id }
      }
      const alice = await make('open-alice', 1)
      const bob = await make('open-bob', 2)
      const spk = await generateSignedPreKey(bob.store, bob.id, 3)
      const [pk] = await generatePreKeys(bob.store, 4, 1)
      await startSession(alice.store, 'open-bob', {
        deviceId: 2, registrationId: (await bob.store.getLocalRegistrationId())!,
        identityKey: b64(bob.id.pubKey), signedPreKey: spk, preKey: pk,
      }, bob.id.pubKey)

      const client = new SignalClient(
        { me: 'open-bob', store: bob.store, deviceId: 2, identityKey: bob.id.pubKey, freshDevice: false }, 't', () => null)
      const meta = (id: number, groupId: string | null = null): V2Meta => ({
        id, from: 'open-alice', to: groupId ? '' : 'open-bob', sentAt: '2026-01-01T00:00:00Z', v: 2, senderDeviceId: 1, groupId,
      })

      const e1 = await encryptForDevice(alice.store, 'open-bob', 2, 'hi bob')
      const first = await client.open({ envType: e1.type, body: e1.body, message: meta(10) })
      expect(first).toMatchObject({ peer: 'open-alice', fresh: true, message: { content: 'hi bob' } })
      // Redelivery of the same envelope (socket after push, or vice versa): no second decrypt.
      const again = await client.open({ envType: e1.type, body: e1.body, message: meta(10) })
      expect(again).toMatchObject({ peer: 'open-alice', fresh: false, message: { content: 'hi bob' } })
      expect((await getMessages('open-bob', 'open-alice')).length).toBe(1)

      const e2 = await encryptForDevice(alice.store, 'open-bob', 2, encodeGroupPayload('g1', 'hello group'))
      const [a, b] = await Promise.all([
        client.open({ envType: e2.type, body: e2.body, message: meta(11, 'g1') }),
        client.open({ envType: e2.type, body: e2.body, message: meta(11, 'g1') }),
      ])
      expect([a.fresh, b.fresh].sort()).toEqual([false, true])
      expect(a.peer).toBe('group:g1')
      expect(a.message.content).toBe('hello group')
      expect(b.message.content).toBe('hello group')
      client.dispose()
    } finally {
      setWebCrypto(webcrypto as unknown as Crypto)
    }
  }, 60_000)
})
