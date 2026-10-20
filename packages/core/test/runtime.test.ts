import { webcrypto } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { KeyHelper, setWebCrypto } from '@privacyresearch/libsignal-protocol-typescript'
import {
  AuthExpiredError,
  HistoryStore,
  MemoryKV,
  MemorySyncStore,
  SignalStore,
  b64,
  createMutex,
  createSessionClient,
  decryptFromDevice,
  decryptMessage,
  deriveCredentials,
  encryptForDevice,
  encryptMessage,
  encryptMediaBytes,
  decryptMediaBytes,
  generatePreKeys,
  generateSignedPreKey,
  installLibsignalCrypto,
  isConfigured,
  openBackup,
  rsaPrivateFromJwk,
  rsaPublicFromJwk,
  sealBackup,
  startSession,
  toBase64,
  importRecoveryKey,
  type ChatMessage,
} from '../src/index.ts'
import { fakeWrapper, providers, setup, subtleProvider, pureProvider } from './env.ts'

describe.each(providers)('shared runtime on the %s', (_name, makeProvider) => {
  it('runs X3DH + the double ratchet between two wrapped stores and files history', async () => {
    const p = makeProvider()
    const mutex = createMutex()
    setup(p, { getLocks: () => mutex })
    installLibsignalCrypto()
    try {
      const make = async (user: string, deviceId: number) => {
        const store = new SignalStore(user, new MemoryKV(), fakeWrapper())
        const id = await KeyHelper.generateIdentityKeyPair()
        await store.setIdentityKeyPair(id)
        await store.setDevice({ deviceId, registrationId: KeyHelper.generateRegistrationId(), nextPreKeyId: 1, signedPreKeys: [] })
        return { store, id }
      }
      const alice = await make('alice', 1)
      const bob = await make('bob', 1)
      const spk = await generateSignedPreKey(bob.store, bob.id, 7)
      const [pk] = await generatePreKeys(bob.store, 8, 1)
      await startSession(alice.store, 'bob', {
        deviceId: 1, registrationId: (await bob.store.getLocalRegistrationId())!,
        identityKey: b64(bob.id.pubKey), signedPreKey: spk, preKey: pk,
      }, bob.id.pubKey)

      const first = await encryptForDevice(alice.store, 'bob', 1, 'hello bob 🔐')
      expect(first.type).toBe(3)
      expect(await decryptFromDevice(bob.store, 'alice', 1, first.type, first.body)).toBe('hello bob 🔐')
      const reply = await encryptForDevice(bob.store, 'alice', 1, 'hi alice')
      expect(reply.type).toBe(1)
      expect(await decryptFromDevice(alice.store, 'bob', 1, reply.type, reply.body)).toBe('hi alice')

      const history = new HistoryStore('alice', new MemoryKV(), fakeWrapper())
      const msgs: ChatMessage[] = Array.from({ length: 8 }, (_, i) => ({
        id: i + 1, from: 'bob', to: 'alice', content: `m${i}`, sentAt: `2024-01-01T00:00:0${i}Z`, v: 2,
      }))
      await Promise.all(msgs.map(m => history.upsertMessage('bob', m)))
      expect((await history.getMessages('bob')).map(m => m.content)).toEqual(msgs.map(m => m.content))
    } finally {
      setWebCrypto(webcrypto as unknown as Crypto)
    }
  }, 60_000)

  it('encrypts legacy messages and media and round-trips them', async () => {
    const p = makeProvider()
    setup(p)
    const { privateJwk, publicJwk } = await subtleProvider().rsaOaepGenerate!()
    const pub = rsaPublicFromJwk(p, publicJwk)
    const enc = await encryptMessage('héllo', pub, pub)
    expect(await decryptMessage(enc.ciphertext, enc.encryptedKeyForSender, rsaPrivateFromJwk(p, privateJwk))).toBe('héllo')

    const data = new Uint8Array(5000).map((_, i) => i % 256)
    const { ciphertext, key } = await encryptMediaBytes(data)
    expect(ciphertext.length).toBe(data.length + 28)
    expect(new Uint8Array(await decryptMediaBytes(ciphertext, key))).toEqual(data)
  })
})

describe('providers are interchangeable', () => {
  it('derives identical credentials', async () => {
    const salt = toBase64(new Uint8Array(16).fill(3))
    setup(subtleProvider())
    const a = await deriveCredentials('pw', salt)
    setup(pureProvider())
    const b = await deriveCredentials('pw', salt)
    expect(a.authKey).toBe(b.authKey)
    expect(toBase64(await a.master.hkdf(new Uint8Array(4), new Uint8Array(3), 32)))
      .toBe(toBase64(await b.master.hkdf(new Uint8Array(4), new Uint8Array(3), 32)))
  })

  it('opens a backup sealed by the other provider (gzip via zlib vs fflate)', async () => {
    const raw = new Uint8Array(32).map((_, i) => i + 1)
    const payload = { v: 1 as const, createdAt: 'x', conversations: { bob: [{ id: 1, from: 'a', to: 'b', content: 'hi'.repeat(300), sentAt: 's' }] } }
    setup(subtleProvider())
    const sealedA = await sealBackup(await importRecoveryKey(raw), 'alice', payload)
    setup(pureProvider())
    expect(await openBackup(await importRecoveryKey(raw), 'alice', sealedA)).toEqual(payload)
    const sealedB = await sealBackup(await importRecoveryKey(raw), 'alice', payload)
    setup(subtleProvider())
    expect(await openBackup(await importRecoveryKey(raw), 'alice', sealedB)).toEqual(payload)
  })

  it('stores uncompressed when the provider has no gzip, and refuses compressed ones it cannot read', async () => {
    const raw = new Uint8Array(32).fill(9)
    const payload = { v: 1 as const, createdAt: 'x', conversations: {} }
    const noGzip = { ...subtleProvider(), gzip: undefined, gunzip: undefined }
    setup(noGzip)
    const plainBlob = await sealBackup(await importRecoveryKey(raw), 'alice', payload)
    expect(plainBlob[4] & 1).toBe(0)
    setup(subtleProvider())
    const gz = await sealBackup(await importRecoveryKey(raw), 'alice', payload)
    expect(gz[4] & 1).toBe(1)
    setup(noGzip)
    await expect(openBackup(await importRecoveryKey(raw), 'alice', gz)).rejects.toThrow(/compressed/)
  })
})

describe('platform plumbing', () => {
  it('createMutex runs same-name tasks one at a time, in order', async () => {
    const m = createMutex()
    const order: string[] = []
    const task = (name: string, id: string, ms: number) => m.request(name, async () => {
      order.push(`${id}+`)
      await new Promise(r => setTimeout(r, ms))
      order.push(`${id}-`)
    })
    await Promise.all([task('a', '1', 20), task('a', '2', 1), task('b', '3', 1)])
    expect(order.filter(x => x[0] !== '3')).toEqual(['1+', '1-', '2+', '2-'])
    expect(order.indexOf('3+')).toBeLessThan(order.indexOf('1-'))
  })

  it('at-rest without any key source fails loudly instead of storing plaintext', async () => {
    setup(subtleProvider(), { storageKeys: { fromRaw: async () => { throw new Error('unused') } } })
    const store = new SignalStore('nobody', new MemoryKV(), null)
    await expect(store.getDevice()).rejects.toThrow(/No at-rest key wrapper/)
  })

  it('isConfigured is true after setup', () => {
    setup(subtleProvider())
    expect(isConfigured()).toBe(true)
  })
})

describe('session client (refresh rules)', () => {
  const jwt = (expInSeconds: number) => {
    const b = (o: object) => toBase64(new TextEncoder().encode(JSON.stringify(o))).replace(/=+$/, '')
    return `${b({ alg: 'x' })}.${b({ sub: 'alice', exp: Math.floor(Date.now() / 1000) + expInSeconds })}.sig`
  }

  it('refreshes once on 401, retries, and shares one refresh between concurrent calls', async () => {
    const store = new MemorySyncStore()
    const fresh = jwt(3600)
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) return new Response(JSON.stringify({ token: fresh, refreshToken: 'r2' }))
      const auth = new Headers(init?.headers).get('Authorization')
      return new Response('{}', { status: auth === `Bearer ${fresh}` ? 200 : 401 })
    })
    const c = createSessionClient({ apiBase: 'http://x', store, fetch: fetchMock })
    c.setSession(jwt(3599), 'r1')
    const results = await Promise.all([c.apiFetch('http://x/api/a'), c.apiFetch('http://x/api/b')])
    expect(results.map(r => r.status)).toEqual([200, 200])
    expect(fetchMock.mock.calls.filter(([u]) => u.endsWith('/auth/refresh'))).toHaveLength(1)
    expect(c.getRefreshToken()).toBe('r2')
  })

  it('a refused refresh (401) ends the session; a server error does not', async () => {
    const store = new MemorySyncStore()
    const expired = vi.fn()
    let status = 500
    const c = createSessionClient({
      apiBase: 'http://x', store, onExpired: expired,
      fetch: async (url: string) => new Response('{}', { status: url.endsWith('/auth/refresh') ? status : 401 }),
    })
    c.setSession(jwt(3599), 'r1')
    await c.apiFetch('http://x/api/a') // 401 -> refresh 500 -> original 401 returned, still logged in
    expect(c.getRefreshToken()).toBe('r1')
    expect(expired).not.toHaveBeenCalled()
    status = 401
    await expect(c.refreshAccessToken()).rejects.toBeInstanceOf(AuthExpiredError)
    expect(c.getRefreshToken()).toBeNull()
    expect(expired).toHaveBeenCalledOnce()
  })
})

