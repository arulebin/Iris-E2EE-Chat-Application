import { describe, expect, it, vi } from 'vitest'
import { MemoryKV, fromBase64, toBase64, type KeyWrapper } from '@iris/core'
import type { IrisKeystoreNative } from '../../modules/iris-keystore/src'
import { createAppLockWrapper, createKeystoreWrapper, KeystoreError, KeystoreKeyMissingError, layerWrappers } from './keystore'
import { forgetEncryptedKey, MmkvKV, openEncryptedKV, type MmkvFactory, type MmkvLike } from './kv'
import { createLifecycle } from './lifecycle'
import { createPush, type NotificationsLike } from './push'
import { createWrappedTokenStore } from './tokenStore'
import { createRnTransport, toWsUrl } from './transport'

// ---- fakes ----

class FakeMmkv implements MmkvLike {
  m = new Map<string, string>()
  set(k: string, v: string) { this.m.set(k, v) }
  getString(k: string) { return this.m.get(k) }
  remove(k: string) { return this.m.delete(k) }
  getAllKeys() { return [...this.m.keys()] }
}

/** XOR "cipher" standing in for the Keystore; enough to prove plaintext never lands in storage. */
function fakeWrapper(): KeyWrapper & { lost: boolean } {
  const w = {
    name: 'fake',
    lost: false,
    async wrap(p: Uint8Array) {
      return toBase64(Uint8Array.from(p, b => b ^ 0x5a))
    },
    async unwrap(c: string) {
      if (w.lost) throw new KeystoreKeyMissingError()
      return Uint8Array.from(fromBase64(c), b => b ^ 0x5a)
    },
    async reset() {},
  }
  return w
}

function fakeNative(): IrisKeystoreNative & { reject: (code: string) => void } {
  let failWith: string | null = null
  const fail = () => {
    if (failWith) throw Object.assign(new Error('native ' + failWith), { code: failWith })
  }
  const b64 = (s: string) => s
  return {
    reject: c => { failWith = c },
    wrap: async (_a, d) => { fail(); return b64(d) },
    unwrap: async (_a, d) => { fail(); return b64(d) },
    reset: async () => {},
    hasKey: async () => true,
    securityLevel: async () => 'tee',
    lockStatus: async () => 'available',
    lockAuthenticate: async () => { fail() },
    lockCreateKey: async () => {},
    lockDeleteKey: async () => {},
    lockWrap: async (_a, d) => { fail(); return d },
    lockUnwrap: async (_a, d) => { fail(); return d },
  }
}

// ---- tests ----

describe('MmkvKV', () => {
  it('round-trips JSON and Uint8Array (nested), lists keys by prefix, deletes', async () => {
    const kv = new MmkvKV(new FakeMmkv())
    await kv.set('a:1', { n: 1, bytes: new Uint8Array([1, 2, 3]), s: 'x' })
    await kv.set('a:2', new Uint8Array([9]))
    await kv.set('b:1', true)
    const got = await kv.get<{ n: number; bytes: Uint8Array; s: string }>('a:1')
    expect(got?.n).toBe(1)
    expect(got?.bytes).toBeInstanceOf(Uint8Array)
    expect([...got!.bytes]).toEqual([1, 2, 3])
    expect([...(await kv.get<Uint8Array>('a:2'))!]).toEqual([9])
    expect((await kv.keys('a:')).sort()).toEqual(['a:1', 'a:2'])
    await kv.delete('a:1')
    expect(await kv.get('a:1')).toBeUndefined()
    await kv.set('b:1', undefined)
    expect(await kv.keys()).toEqual(['a:2'])
  })
})

describe('openEncryptedKV', () => {
  const crypto = { randomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => i + 1) }
  const mk = () => {
    const instances = new Map<string, FakeMmkv>()
    const cfgs: Array<{ id: string; encryptionKey?: string }> = []
    const createMmkv: MmkvFactory = cfg => {
      cfgs.push(cfg)
      if (!instances.has(cfg.id)) instances.set(cfg.id, new FakeMmkv())
      return instances.get(cfg.id)!
    }
    return { createMmkv, instances, cfgs }
  }

  it('generates a 16-char key, stores it only wrapped, and reuses it on reopen', async () => {
    const { createMmkv, instances, cfgs } = mk()
    const wrapper = fakeWrapper()
    const kv1 = await openEncryptedKV({ wrapper, crypto, createMmkv })
    await kv1.set('k', 'v')
    const key1 = cfgs.find(c => c.encryptionKey)!.encryptionKey!
    expect(key1).toHaveLength(16)
    const boot = instances.get('iris-secure-boot')!.getString('mmkv-key.wrapped')!
    expect(boot).not.toContain(key1) // wrapped, not plaintext
    cfgs.length = 0
    await openEncryptedKV({ wrapper, crypto, createMmkv })
    expect(cfgs.find(c => c.encryptionKey)!.encryptionKey).toBe(key1)
  })

  it('surfaces KeystoreKeyMissingError when the wrapping key is gone; forget allows a fresh start', async () => {
    const { createMmkv } = mk()
    const wrapper = fakeWrapper()
    await openEncryptedKV({ wrapper, crypto, createMmkv })
    wrapper.lost = true
    await expect(openEncryptedKV({ wrapper, crypto, createMmkv })).rejects.toBeInstanceOf(KeystoreKeyMissingError)
    forgetEncryptedKey(createMmkv)
    wrapper.lost = false
    await expect(openEncryptedKV({ wrapper, crypto, createMmkv })).resolves.toBeInstanceOf(MmkvKV)
  })
})

describe('keystore wrappers', () => {
  it('wrap/unwrap bytes through the base64 native surface', async () => {
    const w = createKeystoreWrapper('acct', fakeNative())
    const p = Uint8Array.from([0, 1, 2, 254, 255])
    expect([...(await w.unwrap(await w.wrap(p)))]).toEqual([...p])
  })

  it('maps KEY_MISSING to KeystoreKeyMissingError and other codes to KeystoreError', async () => {
    const n = fakeNative()
    const w = createKeystoreWrapper('acct', n)
    n.reject('KEY_MISSING')
    await expect(w.unwrap('AAAA')).rejects.toBeInstanceOf(KeystoreKeyMissingError)
    n.reject('AUTH_REQUIRED')
    const lock = createAppLockWrapper('acct', n)
    await expect(lock.unwrap('AAAA')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    await expect(lock.unwrap('AAAA')).rejects.toBeInstanceOf(KeystoreError)
  })

  it('layers app lock over keystore and unwraps in reverse order', async () => {
    const order: string[] = []
    const mkw = (name: string): KeyWrapper => ({
      wrap: async p => { order.push('wrap:' + name); return name + ':' + toBase64(p) },
      unwrap: async c => { order.push('unwrap:' + name); return fromBase64(c.slice(name.length + 1)) },
      reset: async () => {},
    })
    const l = layerWrappers(mkw('inner'), mkw('outer'))
    const w = await l.wrap(Uint8Array.from([7]))
    expect([...(await l.unwrap(w))]).toEqual([7])
    expect(order).toEqual(['wrap:inner', 'wrap:outer', 'unwrap:outer', 'unwrap:inner'])
  })
})

describe('createWrappedTokenStore', () => {
  it('stores tokens only wrapped; survives a new instance; clear wipes', async () => {
    const kv = new MemoryKV()
    const wrapper = fakeWrapper()
    const s1 = createWrappedTokenStore(kv, wrapper)
    await s1.set('access.jwt.value', 'refresh-secret')
    for (const k of await kv.keys()) {
      const raw = JSON.stringify(await kv.get(k))
      expect(raw).not.toContain('refresh-secret')
      expect(raw).not.toContain('access.jwt.value')
    }
    const s2 = createWrappedTokenStore(kv, wrapper)
    expect(await s2.getAccess()).toBe('access.jwt.value')
    expect(await s2.getRefresh()).toBe('refresh-secret')
    await s2.clear()
    expect(await s2.getAccess()).toBeNull()
    expect(await createWrappedTokenStore(kv, wrapper).getRefresh()).toBeNull()
  })

  it('treats a lost Keystore key as signed out instead of throwing', async () => {
    const kv = new MemoryKV()
    const wrapper = fakeWrapper()
    await createWrappedTokenStore(kv, wrapper).set('a', 'r')
    wrapper.lost = true
    const s = createWrappedTokenStore(kv, wrapper)
    expect(await s.getRefresh()).toBeNull()
    expect(await s.getAccess()).toBeNull()
  })
})

describe('lifecycle', () => {
  it('fires on active only, and on offline->online only', () => {
    let appCb: (s: string) => void = () => {}
    let netCb: (s: { isConnected: boolean | null; isInternetReachable?: boolean | null }) => void = () => {}
    const remove = vi.fn()
    const lc = createLifecycle(
      { addEventListener: (_t, cb) => ((appCb = cb), { remove }) },
      { addEventListener: cb => ((netCb = cb), () => {}) },
    )
    const fg = vi.fn()
    const on = vi.fn()
    const off = lc.onForeground(fg)
    lc.onOnline(on)
    appCb('background'); appCb('inactive')
    expect(fg).not.toHaveBeenCalled()
    appCb('active')
    expect(fg).toHaveBeenCalledTimes(1)
    netCb({ isConnected: true, isInternetReachable: true }) // first online reading
    netCb({ isConnected: true, isInternetReachable: true })
    expect(on).toHaveBeenCalledTimes(1)
    netCb({ isConnected: false })
    netCb({ isConnected: true, isInternetReachable: null })
    expect(on).toHaveBeenCalledTimes(2)
    off()
    expect(remove).toHaveBeenCalled()
  })
})

describe('createRnTransport', () => {
  const jwt = (exp: number) => {
    const b = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    return `${b({ alg: 'none' })}.${b({ exp })}.s`
  }
  const lifecycle = () => ({ onForeground: vi.fn(() => () => {}), onOnline: vi.fn(() => () => {}) })

  it('request(): JSON in/out, anonymous skips bearer', async () => {
    const tokens = createWrappedTokenStore(new MemoryKV(), fakeWrapper())
    await tokens.set(jwt(Date.now() / 1000 + 3600), 'r')
    const f = vi.fn(async (_u: string, init?: RequestInit) =>
      new Response(JSON.stringify({ auth: new Headers(init?.headers).get('Authorization') }), { status: 200 }))
    const t = createRnTransport({ baseUrl: 'https://api', tokens, lifecycle: lifecycle(), fetchImpl: f as never })
    const a = await t.request<{ auth: string | null }>({ method: 'POST', path: '/api/x', body: { a: 1 } })
    expect(a.ok && a.data.auth).toMatch(/^Bearer /)
    expect((f.mock.calls[0][1] as RequestInit).body).toBe('{"a":1}')
    const b = await t.request<{ auth: string | null }>({ method: 'POST', path: '/auth/login', anonymous: true })
    expect(b.data.auth).toBeNull()
  })

  it('connect(): wss URL with token and device, wake wiring, close unsubscribes', async () => {
    const tokens = createWrappedTokenStore(new MemoryKV(), fakeWrapper())
    await tokens.set(jwt(Date.now() / 1000 + 3600), 'r')
    const urls: string[] = []
    class WS {
      readyState = 1; onopen = null; onmessage = null; onclose = null; onerror = null
      constructor(u: string) { urls.push(u) }
      send() {} close() {}
    }
    const lc = lifecycle()
    const t = createRnTransport({ baseUrl: 'https://api.example', tokens, lifecycle: lc, WebSocketImpl: WS as never, getDeviceId: () => 3 })
    const h = t.connect({ onMessage() {} })
    await new Promise(r => setTimeout(r, 10))
    expect(urls[0]).toMatch(/^wss:\/\/api\.example\/ws\/chat\?token=.+&device=3$/)
    expect(lc.onForeground).toHaveBeenCalled()
    expect(lc.onOnline).toHaveBeenCalled()
    h.close()
  })

  it('toWsUrl', () => {
    expect(toWsUrl('http://h:8080/', '/ws/chat')).toBe('ws://h:8080/ws/chat')
  })
})

describe('createPush', () => {
  const mkNotifications = (status = 'granted'): NotificationsLike & { channels: string[] } => {
    const channels: string[] = []
    return {
      channels,
      getPermissionsAsync: async () => ({ status }),
      requestPermissionsAsync: async () => ({ status: 'granted' }),
      getDevicePushTokenAsync: async () => ({ type: 'android', data: 'fcm-token-1' }),
      setNotificationChannelAsync: async id => { channels.push(id) },
    }
  }

  it('creates channels, registers the raw FCM token, and unregisters on disable', async () => {
    const calls: Array<{ path: string; method?: string; body?: string }> = []
    const fetch = async (path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method, body: init?.body as string })
      return new Response('{}', { status: 200 })
    }
    const n = mkNotifications()
    const push = createPush({ notifications: n, importance: { HIGH: 4, MAX: 5 }, fetch, kv: new MemoryKV() })
    expect(await push.enable()).toBe('fcm-token-1')
    expect(n.channels).toEqual(['messages', 'calls'])
    expect(calls[0]).toEqual({ path: '/api/push/fcm-token', method: 'POST', body: '{"token":"fcm-token-1","app":"com.iris.chat.mobile"}' })
    expect(await push.isRegistered()).toBe(true)
    await push.disable()
    expect(calls[1]).toMatchObject({ method: 'DELETE', body: '{"token":"fcm-token-1"}' })
    expect(await push.isRegistered()).toBe(false)
  })

  it('sends the Signal device id only from a binary that decrypts data pushes', async () => {
    const bodies: string[] = []
    const fetch = async (_path: string, init?: RequestInit) => {
      bodies.push(init?.body as string)
      return new Response('{}', { status: 200 })
    }
    const base = { notifications: mkNotifications(), importance: { HIGH: 4, MAX: 5 }, fetch, kv: new MemoryKV(), getDeviceId: () => 7 }
    await createPush({ ...base, dataPush: true }).enable()
    expect(JSON.parse(bodies[0]!)).toEqual({ token: 'fcm-token-1', app: 'com.iris.chat.mobile', deviceId: 7 })
    // Older binary (no native notifier): no device id, so the server keeps sending visible notifications.
    await createPush({ ...base, dataPush: false }).enable()
    expect(JSON.parse(bodies[1]!)).toEqual({ token: 'fcm-token-1', app: 'com.iris.chat.mobile' })
    // Device not registered yet: same, until the next registration.
    await createPush({ ...base, dataPush: true, getDeviceId: () => null }).enable()
    expect(JSON.parse(bodies[2]!)).toEqual({ token: 'fcm-token-1', app: 'com.iris.chat.mobile' })
  })

  it('rejects when permission denied or server refuses', async () => {
    const denied: NotificationsLike = { ...mkNotifications('denied'), requestPermissionsAsync: async () => ({ status: 'denied' }) }
    await expect(
      createPush({ notifications: denied, importance: { HIGH: 4, MAX: 5 }, fetch: async () => new Response('', { status: 200 }), kv: new MemoryKV() }).enable(),
    ).rejects.toThrow(/Permission denied/)
    await expect(
      createPush({ notifications: mkNotifications(), importance: { HIGH: 4, MAX: 5 }, fetch: async () => new Response('', { status: 500 }), kv: new MemoryKV() }).enable(),
    ).rejects.toThrow(/Failed to register/)
  })
})
