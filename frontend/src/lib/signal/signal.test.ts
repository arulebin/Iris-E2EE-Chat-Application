import { describe, expect, it } from 'vitest'
import { KeyHelper, type KeyPairType } from '@privacyresearch/libsignal-protocol-typescript'
import { memoryKV, type KV } from './kv'
import { SignalStore } from './store'
import { b64, generatePreKeys, generateSignedPreKey } from './device'
import { decryptFromDevice, encryptForDevice, IdentityMismatchError, pad, startSession, unpad } from './messaging'
import type { BundleDto } from './api'
import { formatRecoveryKey, openBackup, parseRecoveryKey, sealBackup } from '../backup'
import { mergeHistory } from '../messageStore'
import type { ChatMessage } from '../../types'

type Device = { store: SignalStore; kv: KV; deviceId: number; bundle: () => Promise<BundleDto> }

let nextKeyId = 1

/** A device with an identity (optionally shared with another device of the same account). */
async function makeDevice(user: string, deviceId: number, identity?: KeyPairType): Promise<Device> {
  const kv = memoryKV()
  const store = new SignalStore(user, kv)
  const id = identity ?? (await KeyHelper.generateIdentityKeyPair())
  await store.setIdentityKeyPair(id)
  await store.setDevice({ deviceId, registrationId: KeyHelper.generateRegistrationId(), nextPreKeyId: 1, signedPreKeys: [] })
  return {
    store, kv, deviceId,
    // Each call hands out a fresh bundle with a new one-time prekey, like the server does.
    bundle: async () => {
      const spk = await generateSignedPreKey(store, id, nextKeyId++)
      const [pk] = await generatePreKeys(store, nextKeyId++, 1)
      return {
        deviceId,
        registrationId: (await store.getLocalRegistrationId())!,
        identityKey: b64(id.pubKey),
        signedPreKey: spk,
        preKey: pk,
      }
    },
  }
}

async function identityOf(d: Device): Promise<ArrayBuffer> {
  return (await d.store.getIdentityKeyPair())!.pubKey
}

describe('Signal sessions', () => {
  it('establishes a session via X3DH and ratchets both ways', async () => {
    const alice = await makeDevice('alice', 1)
    const bob = await makeDevice('bob', 1)

    await startSession(alice.store, 'bob', await bob.bundle(), await identityOf(bob))
    const first = await encryptForDevice(alice.store, 'bob', 1, 'hello bob')
    expect(first.type).toBe(3) // PreKeyWhisperMessage
    expect(await decryptFromDevice(bob.store, 'alice', 1, first.type, first.body)).toBe('hello bob')

    const reply = await encryptForDevice(bob.store, 'alice', 1, 'hi alice')
    expect(reply.type).toBe(1)
    expect(await decryptFromDevice(alice.store, 'bob', 1, reply.type, reply.body)).toBe('hi alice')

    const second = await encryptForDevice(alice.store, 'bob', 1, 'second')
    expect(second.type).toBe(1) // session confirmed → plain WhisperMessage
    expect(await decryptFromDevice(bob.store, 'alice', 1, second.type, second.body)).toBe('second')
  })

  it('rejects a replayed message (its key is already consumed)', async () => {
    const alice = await makeDevice('alice', 1)
    const bob = await makeDevice('bob', 1)
    await startSession(alice.store, 'bob', await bob.bundle(), await identityOf(bob))
    const m = await encryptForDevice(alice.store, 'bob', 1, 'once')
    await decryptFromDevice(bob.store, 'alice', 1, m.type, m.body)
    await expect(decryptFromDevice(bob.store, 'alice', 1, m.type, m.body)).rejects.toThrow()
  })

  it('syncs to the sender\'s other device, which shares the account identity', async () => {
    const shared = await KeyHelper.generateIdentityKeyPair()
    const alice1 = await makeDevice('alice', 1, shared)
    const alice2 = await makeDevice('alice', 2, shared)
    await startSession(alice1.store, 'alice', await alice2.bundle(), shared.pubKey)
    const sync = await encryptForDevice(alice1.store, 'alice', 2, 'sent to bob')
    expect(await decryptFromDevice(alice2.store, 'alice', 1, sync.type, sync.body)).toBe('sent to bob')
  })

  it('refuses a "device of mine" with a foreign identity key', async () => {
    const shared = await KeyHelper.generateIdentityKeyPair()
    const alice1 = await makeDevice('alice', 1, shared)
    // A server-injected "alice device 9" with its own identity key.
    const impostor = await makeDevice('mallory', 9)
    await startSession(impostor.store, 'alice', await alice1.bundle(), shared.pubKey)
    const m = await encryptForDevice(impostor.store, 'alice', 1, 'trust me')
    await expect(decryptFromDevice(alice1.store, 'alice', 9, m.type, m.body)).rejects.toThrow(/foreign identity/)
  })

  it('aborts session setup when the bundle carries an unexpected identity', async () => {
    const alice = await makeDevice('alice', 1)
    const bob = await makeDevice('bob', 1)
    const mallory = await makeDevice('mallory', 1)
    await expect(startSession(alice.store, 'bob', await bob.bundle(), await identityOf(mallory)))
      .rejects.toBeInstanceOf(IdentityMismatchError)
  })

  it('works without a one-time prekey (server ran out)', async () => {
    const alice = await makeDevice('alice', 1)
    const bob = await makeDevice('bob', 1)
    const bundle = await bob.bundle()
    bundle.preKey = null
    await startSession(alice.store, 'bob', bundle, await identityOf(bob))
    const m = await encryptForDevice(alice.store, 'bob', 1, 'no opk')
    expect(await decryptFromDevice(bob.store, 'alice', 1, m.type, m.body)).toBe('no opk')
  })

  it('reports identities seen in incoming sessions to the pin listener', async () => {
    const alice = await makeDevice('alice', 1)
    const bob = await makeDevice('bob', 1)
    const seen: string[] = []
    bob.store.onIdentity(contact => { seen.push(contact) })
    await startSession(alice.store, 'bob', await bob.bundle(), await identityOf(bob))
    const m = await encryptForDevice(alice.store, 'bob', 1, 'hi')
    await decryptFromDevice(bob.store, 'alice', 1, m.type, m.body)
    expect(seen).toContain('alice')
  })

  it('forgetContact drops sessions so a new key gets a fresh one', async () => {
    const alice = await makeDevice('alice', 1)
    const bob = await makeDevice('bob', 1)
    await startSession(alice.store, 'bob', await bob.bundle(), await identityOf(bob))
    expect(await alice.store.loadSession('bob.1')).toBeTruthy()
    await alice.store.forgetContact('bob')
    expect(await alice.store.loadSession('bob.1')).toBeUndefined()
  })
})

describe('at-rest encryption', () => {
  it('never stores the identity private key in the clear', async () => {
    const dev = await makeDevice('alice', 1)
    const priv = new Uint8Array((await dev.store.getIdentityKeyPair())!.privKey)
    const raw = await dev.kv.get<Uint8Array>('sig:alice:identity')
    expect(raw).toBeInstanceOf(Uint8Array)
    const asText = Array.from(raw!).join(',')
    expect(asText.includes(Array.from(priv.slice(0, 16)).join(','))).toBe(false)
  })
})

describe('padding', () => {
  it('round-trips and hides the exact length', () => {
    for (const s of ['', 'a', 'x'.repeat(159), 'x'.repeat(160), 'emoji 🔒']) {
      const bytes = new TextEncoder().encode(s)
      const padded = pad(bytes)
      expect(padded.length % 160).toBe(0)
      expect(new TextDecoder().decode(unpad(padded))).toBe(s)
    }
  })
})

describe('history backup', () => {
  const payload = { v: 1 as const, createdAt: '2026-10-20T00:00:00Z', conversations: { bob: [{ id: 1, from: 'alice', to: 'bob', content: 'hi', sentAt: '2026-10-20T00:00:00Z', v: 2 }] } }

  async function keyFrom(raw: Uint8Array<ArrayBuffer>) {
    return crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey', 'deriveBits'])
  }

  it('formats and parses recovery keys (forgiving about case, spaces, I/O)', () => {
    const raw = crypto.getRandomValues(new Uint8Array(32))
    const shown = formatRecoveryKey(raw)
    expect(shown.replace(/ /g, '')).toHaveLength(52)
    expect(parseRecoveryKey(shown.toLowerCase())).toEqual(raw)
    expect(() => parseRecoveryKey(shown.slice(0, 20))).toThrow(/incomplete/)
  })

  it('seals and opens with the right key and account only', async () => {
    const raw = crypto.getRandomValues(new Uint8Array(32))
    const blob = await sealBackup(await keyFrom(raw), 'alice', payload)
    expect(await openBackup(await keyFrom(raw), 'alice', blob)).toEqual(payload)

    const wrong = crypto.getRandomValues(new Uint8Array(32))
    await expect(openBackup(await keyFrom(wrong), 'alice', blob)).rejects.toThrow()
    await expect(openBackup(await keyFrom(raw), 'mallory', blob)).rejects.toThrow()
  })
})

describe('mergeHistory', () => {
  const msg = (over: Partial<ChatMessage>): ChatMessage => ({ from: 'a', to: 'b', content: '', sentAt: '2026-01-01T00:00:00Z', ...over })

  it('takes v2 content from local history and keeps legacy rows from the server', () => {
    const server = [
      msg({ id: 1, content: 'legacy', sentAt: '2026-01-01T00:00:01Z' }),
      msg({ id: 2, v: 2, sentAt: '2026-01-01T00:00:02Z', viewedAt: '2026-01-02T00:00:00Z' }),
      msg({ id: 3, v: 2, sentAt: '2026-01-01T00:00:03Z' }), // predates this device, not restored
    ]
    const local = [
      msg({ id: 2, v: 2, content: 'secret', sentAt: '2026-01-01T00:00:02Z' }),
      msg({ clientId: 'c1', v: 2, content: 'pending', sentAt: '2026-01-01T00:00:04Z' }),
    ]
    const merged = mergeHistory(server, local)
    expect(merged.map(m => m.content)).toEqual(['legacy', 'secret', 'pending'])
    expect(merged[1].viewedAt).toBe('2026-01-02T00:00:00Z')
  })
})
