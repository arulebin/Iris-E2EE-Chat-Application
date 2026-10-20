import { describe, expect, it } from 'vitest'
import { KeyHelper, type KeyPairType } from '@privacyresearch/libsignal-protocol-typescript'
import { memoryKV, type KV } from './kv'
import { SignalStore } from './store'
import { b64, generatePreKeys, generateSignedPreKey } from './device'
import { decryptFromDevice, encryptForDevice, IdentityMismatchError, pad, startSession, unpad } from './messaging'
import type { BundleDto } from './api'
import { formatRecoveryKey, openBackup, parseRecoveryKey, sealBackup } from '../backup'
import { HistoryStore, mergeHistory } from '../messageStore'
import { KeystoreKeyMissingError, type KeyWrapper } from '../nativeKeystore'
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

/** Stand-in for the Android Keystore: an in-memory AES key that can be "lost". */
function fakeKeystore() {
  let key: CryptoKey | null = null
  const ensure = async () =>
    (key ??= await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']))
  const wrapper: KeyWrapper & { lose(): void; resets: number } = {
    resets: 0,
    async wrap(raw) {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await ensure(), new Uint8Array(raw)))
      return b64(new Uint8Array([...iv, ...ct]).buffer)
    },
    async unwrap(wrapped) {
      if (!key) throw new KeystoreKeyMissingError('gone')
      const packed = Uint8Array.from(atob(wrapped), c => c.charCodeAt(0))
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12)))
    },
    async reset() { key = null; wrapper.resets++ },
    lose() { key = null },
  }
  return wrapper
}

describe('Android Keystore storage key', () => {
  it('stores only a wrapped key, never a CryptoKey', async () => {
    const kv = memoryKV()
    const store = new SignalStore('ks1', kv, fakeKeystore())
    await store.setDevice({ deviceId: 1, registrationId: 7, nextPreKeyId: 1, signedPreKeys: [] })
    expect(typeof (await kv.get('sig:ks1:skw'))).toBe('string')
    expect(await kv.get('sig:ks1:sk')).toBeUndefined()
    expect((await store.getDevice())?.registrationId).toBe(7)
  })

  it('migrates a pre-Keystore install and keeps every value readable', async () => {
    const kv = memoryKV()
    const id = await KeyHelper.generateIdentityKeyPair()
    const web = new SignalStore('ks2', kv, null)
    await web.setIdentityKeyPair(id)
    await web.setDevice({ deviceId: 3, registrationId: 42, nextPreKeyId: 9, signedPreKeys: [] })
    expect(await kv.get('sig:ks2:sk')).toBeDefined()

    const keystore = fakeKeystore()
    const native = new SignalStore('ks2', memoryKVView(kv), keystore)  // fresh key cache, same data
    expect((await native.getDevice())?.registrationId).toBe(42)
    expect(bytesOf((await native.getIdentityKeyPair())!.privKey)).toEqual(bytesOf(id.privKey))
    expect(await kv.get('sig:ks2:sk')).toBeUndefined()
    expect(typeof (await kv.get('sig:ks2:skw'))).toBe('string')
  })

  it('resumes an interrupted migration without losing values', async () => {
    const kv = memoryKV()
    const web = new SignalStore('ks3', kv, null)
    await web.setDevice({ deviceId: 1, registrationId: 5, nextPreKeyId: 1, signedPreKeys: [] })
    await web.setIdentityKeyPair(await KeyHelper.generateIdentityKeyPair())
    const keystore = fakeKeystore()

    // First run dies right after migrating the first value.
    const flaky = memoryKVView(kv)
    let sets = 0
    const crashing: KV = { ...flaky, set: async (k, v) => { if (++sets === 3) throw new Error('crash'); return flaky.set(k, v) } }
    await expect(new SignalStore('ks3', crashing, keystore).getDevice()).rejects.toThrow('crash')
    expect(await kv.get('sig:ks3:sk')).toBeDefined()   // old key kept until the end

    const again = new SignalStore('ks3', memoryKVView(kv), keystore)
    expect((await again.getDevice())?.registrationId).toBe(5)
    expect(await again.getIdentityKeyPair()).toBeDefined()
    expect(await kv.get('sig:ks3:sk')).toBeUndefined()
  })

  it('starts over when the Keystore key is lost, and wipe() resets it', async () => {
    const kv = memoryKV()
    const keystore = fakeKeystore()
    await new SignalStore('ks4', kv, keystore).setDevice({ deviceId: 1, registrationId: 5, nextPreKeyId: 1, signedPreKeys: [] })
    keystore.lose()
    const after = new SignalStore('ks4', memoryKVView(kv), keystore)
    expect(await after.getDevice()).toBeUndefined()   // old state unreadable → cleared, not crashing
    await after.setDevice({ deviceId: 2, registrationId: 6, nextPreKeyId: 1, signedPreKeys: [] })
    expect((await after.getDevice())?.deviceId).toBe(2)

    await after.wipe()
    expect(keystore.resets).toBe(1)
    expect(await kv.keys('sig:ks4:')).toEqual([])
  })
})

/** Same underlying data, new KV identity — so the store's per-KV key cache starts cold (like an app restart). */
function memoryKVView(kv: KV): KV {
  return { get: k => kv.get(k), set: (k, v) => kv.set(k, v), del: k => kv.del(k), keys: p => kv.keys(p) }
}

const bytesOf = (b: ArrayBuffer) => Array.from(new Uint8Array(b))

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

describe('encrypted local history', () => {
  const msg = (id: number, content: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
    ({ id, from: 'alice', to: 'bob', content, sentAt: `2026-10-20T10:00:0${id}Z`, v: 2, ...extra })
  const text = (raw: unknown) => new TextDecoder().decode(raw as Uint8Array)

  it('round-trips and never stores content or media keys in the clear', async () => {
    const kv = memoryKV()
    const h = new HistoryStore('eh1', kv, null)
    await h.upsertMany('bob', [msg(1, 'top secret', { mediaKey: 'MEDIAKEY123' })])
    await h.upsertMessage('bob', msg(2, 'second'))
    const raw = await kv.get<Uint8Array>('iris-msgs-v2:eh1:bob')
    expect(raw).toBeInstanceOf(Uint8Array)
    expect(text(raw)).not.toContain('top secret')
    expect(text(raw)).not.toContain('MEDIAKEY123')
    const back = await h.getMessages('bob')
    expect(back.map(m => m.content)).toEqual(['top secret', 'second'])
    expect(back[0].mediaKey).toBe('MEDIAKEY123')
    await h.patchMessage('bob', m => m.id === 1, { viewedAt: 'now' })
    expect((await h.getMessages('bob'))[0].viewedAt).toBe('now')
  })

  it('migrates plaintext from older builds, idempotently', async () => {
    const kv = memoryKV()
    await kv.set('iris-msgs-v2:eh2:bob', [msg(1, 'old plaintext')])
    await kv.set('chat_history_eh2_bob', [msg(5, 'legacy cache', { v: 1 })])
    const h = new HistoryStore('eh2', kv, null)
    expect(await h.migrateAll()).toBe(2)
    expect(await kv.get('iris-msgs-v2:eh2:bob')).toBeInstanceOf(Uint8Array)
    expect(await kv.get('chat_history_eh2_bob')).toBeInstanceOf(Uint8Array)
    expect(await h.migrateAll()).toBe(0)
    expect((await h.getMessages('bob'))[0].content).toBe('old plaintext')
    expect((await h.getLegacyCache('bob'))[0].content).toBe('legacy cache')
  })

  it('handles a mix of encrypted and plaintext conversations (interrupted migration)', async () => {
    const kv = memoryKV()
    const h = new HistoryStore('eh3', kv, null)
    await h.upsertMessage('bob', msg(1, 'encrypted already'))
    await kv.set('iris-msgs-v2:eh3:carol', [msg(2, 'still plaintext')])
    // An append to a plaintext conversation encrypts it in the same write.
    await kv.set('iris-msgs-v2:eh3:dave', [msg(3, 'plain')])
    await h.upsertMessage('dave', msg(4, 'new'))
    expect(await kv.get('iris-msgs-v2:eh3:dave')).toBeInstanceOf(Uint8Array)
    const all = await h.exportAll()
    expect(Object.keys(all).sort()).toEqual(['bob', 'carol', 'dave'])
    expect(all.dave.map(m => m.content)).toEqual(['plain', 'new'])
    expect(await kv.get('iris-msgs-v2:eh3:carol')).toBeInstanceOf(Uint8Array)
  })

  it('treats an unreadable blob as empty and recovers on the next write', async () => {
    const kv = memoryKV()
    const h = new HistoryStore('eh4', kv, null)
    await h.upsertMessage('bob', msg(1, 'x'))
    const raw = (await kv.get<Uint8Array>('iris-msgs-v2:eh4:bob'))!
    raw[raw.length - 1] ^= 0xff   // corrupt the auth tag
    await kv.set('iris-msgs-v2:eh4:bob', raw)
    expect(await h.getMessages('bob')).toEqual([])
    await h.upsertMessage('bob', msg(2, 'y'))
    expect((await h.getMessages('bob')).map(m => m.content)).toEqual(['y'])
  })

  it("doesn't touch another local account whose name shares the prefix", async () => {
    const kv = memoryKV()
    const other = new HistoryStore('bob:x', kv, null)
    await other.upsertMessage('alice', msg(1, 'theirs'))
    await kv.set('iris-msgs-v2:bob:x:carol', [msg(2, 'their plaintext')])
    const bob = new HistoryStore('bob', kv, null)
    await bob.upsertMessage('alice', msg(3, 'mine'))
    expect(Object.keys(await bob.exportAll())).toEqual(['alice'])
    await bob.migrateAll()
    expect(Array.isArray(await kv.get('iris-msgs-v2:bob:x:carol'))).toBe(true)   // left for its owner
    expect((await other.getMessages('carol'))[0].content).toBe('their plaintext')
    expect((await other.getMessages('alice'))[0].content).toBe('theirs')
  })

  it('serialises concurrent writes to one conversation', async () => {
    const h = new HistoryStore('eh6', memoryKV(), null)
    await Promise.all([1, 2, 3, 4, 5].map(i => h.upsertMessage('bob', msg(i, `m${i}`))))
    expect((await h.getMessages('bob')).length).toBe(5)
  })

  it('uses its own Keystore-wrapped key, untouched by wiping Signal state', async () => {
    const kv = memoryKV()
    const ks = fakeKeystore()
    const h = new HistoryStore('eh7', kv, ks)
    await h.upsertMessage('bob', msg(1, 'kept'))
    expect(typeof (await kv.get('hist:eh7:skw'))).toBe('string')
    expect(await kv.get('hist:eh7:sk')).toBeUndefined()
    const store = new SignalStore('eh7', kv, fakeKeystore())
    await store.setDevice({ deviceId: 1, registrationId: 1, nextPreKeyId: 1, signedPreKeys: [] })
    await store.wipe()
    expect((await h.getMessages('bob'))[0].content).toBe('kept')
  })
})
