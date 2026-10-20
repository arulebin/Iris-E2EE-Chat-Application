import { execFileSync } from 'node:child_process'
import { webcrypto } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as ls from '@privacyresearch/libsignal-protocol-typescript'
import { createLibsignalWebCrypto } from '@iris/core'
import { createPureJsProvider } from './pureJsProvider.ts'

const { KeyHelper, SessionBuilder, SessionCipher, SignalProtocolAddress, Direction } = ls

/** Minimal in-memory StorageType for one party. */
class MemStore {
  private d = new Map<string, unknown>()
  constructor(private identity: ls.KeyPairType, private regId: number) {}
  async getIdentityKeyPair() { return this.identity }
  async getLocalRegistrationId() { return this.regId }
  async isTrustedIdentity() { return true }
  async saveIdentity(id: string, key: ArrayBuffer) { this.d.set('id' + id, key); return false }
  async loadPreKey(id: string | number) { return this.d.get('pk' + id) as ls.KeyPairType | undefined }
  async storePreKey(id: string | number, kp: ls.KeyPairType) { this.d.set('pk' + id, kp) }
  async removePreKey(id: string | number) { this.d.delete('pk' + id) }
  async loadSignedPreKey(id: string | number) { return this.d.get('spk' + id) as ls.KeyPairType | undefined }
  async storeSignedPreKey(id: string | number, kp: ls.KeyPairType) { this.d.set('spk' + id, kp) }
  async removeSignedPreKey(id: string | number) { this.d.delete('spk' + id) }
  async loadSession(id: string) { return this.d.get('s' + id) as string | undefined }
  async storeSession(id: string, rec: string) { this.d.set('s' + id, rec) }
  async removeSession(id: string) { this.d.delete('s' + id) }
  async removeAllSessions() {}
  Direction = Direction
}

async function party() {
  const identity = await KeyHelper.generateIdentityKeyPair()
  const regId = KeyHelper.generateRegistrationId()
  const store = new MemStore(identity, regId)
  const spk = await KeyHelper.generateSignedPreKey(identity, 1)
  const pk = await KeyHelper.generatePreKey(2)
  await store.storeSignedPreKey(1, spk.keyPair)
  await store.storePreKey(2, pk.keyPair)
  return {
    store,
    bundle: {
      identityKey: identity.pubKey,
      registrationId: regId,
      signedPreKey: { keyId: 1, publicKey: spk.keyPair.pubKey, signature: spk.signature },
      preKey: { keyId: 2, publicKey: pk.keyPair.pubKey },
    },
  }
}

describe('libsignal-protocol-typescript on an injected CryptoProvider', () => {
  it('X3DH + double ratchet round trip using the pure-JS provider via setWebCrypto', async () => {
    const provider = createPureJsProvider(a => webcrypto.getRandomValues(a))
    ls.setWebCrypto(createLibsignalWebCrypto(provider) as unknown as Crypto)
    try {
      const alice = await party()
      const bob = await party()
      const bobAddr = new SignalProtocolAddress('bob', 1)
      const aliceAddr = new SignalProtocolAddress('alice', 1)
      await new SessionBuilder(alice.store as unknown as ls.StorageType, bobAddr).processPreKey(bob.bundle)
      const aliceCipher = new SessionCipher(alice.store as unknown as ls.StorageType, bobAddr)
      const bobCipher = new SessionCipher(bob.store as unknown as ls.StorageType, aliceAddr)

      const first = await aliceCipher.encrypt(new TextEncoder().encode('hello bob').buffer)
      expect(first.type).toBe(3) // PreKeyWhisperMessage
      const got = await bobCipher.decryptPreKeyWhisperMessage(first.body!, 'binary')
      expect(new TextDecoder().decode(got)).toBe('hello bob')

      const reply = await bobCipher.encrypt(new TextEncoder().encode('hi alice').buffer)
      const got2 = await aliceCipher.decryptWhisperMessage(reply.body!, 'binary')
      expect(new TextDecoder().decode(got2)).toBe('hi alice')
    } finally {
      ls.setWebCrypto(webcrypto as unknown as Crypto)
    }
  })

  it('curve25519 asm.js works with WebAssembly removed (Hermes has none)', () => {
    const fixture = fileURLToPath(new URL('./nowasm.fixture.mjs', import.meta.url))
    const out = execFileSync(process.execPath, [fixture], { encoding: 'utf8' })
    expect(out).toContain('wasm=undefined')
    expect(out).toContain('signature-ok')
  })
})
