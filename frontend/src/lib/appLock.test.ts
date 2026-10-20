import { beforeEach, describe, expect, it, vi } from 'vitest'

// Orchestration tests for App lock + password escrow, on Android-like fakes:
// an in-memory KV, an XOR "Keystore", and a fake auth-bound lock key that is
// invalidated when the test "enrolls a new fingerprint".

const h = vi.hoisted(() => {
  const state = {
    keyId: 1,            // current lock key generation
    deleted: false,
    authFails: false,    // next nativeAuthenticate rejects (cancel)
    authed: false,
    kv: null as unknown as import('./signal/kv').KV,
  }
  return { state }
})

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true },
  registerPlugin: () => ({}),
}))

vi.mock('./signal/kv', async () => {
  const actual = await vi.importActual<typeof import('./signal/kv')>('./signal/kv')
  h.state.kv = actual.memoryKV()
  return { ...actual, idbKV: h.state.kv }
})

vi.mock('./appLockWeb', () => ({
  clearWebLockSession: () => {},
  webAuthenticate: async () => {},
  webLockAvailable: async () => false,
  webPrfLayer: () => null,
  webRegister: async () => { throw new Error('n/a') },
}))

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

vi.mock('./appLockNative', async () => {
  const core = await vi.importActual<typeof import('./appLockCore')>('./appLockCore')
  return {
    nativeAppLockPresent: () => true,
    nativeLockStatus: async () => 'available',
    nativeAuthenticate: async () => {
      if (h.state.authFails) throw new core.AppLockCanceledError('cancelled')
      h.state.authed = true
    },
    nativeCreateKey: async () => { h.state.keyId++; h.state.deleted = false },
    nativeDeleteKey: async () => { h.state.deleted = true },
    nativeLockLayer: () => {
      const id = h.state.keyId   // a layer is bound to the key generation it was created for
      const check = () => {
        if (h.state.deleted || id !== h.state.keyId) throw new core.AppLockInvalidatedError('invalidated')
        if (!h.state.authed) throw new core.AppLockRequiredError('auth required')
      }
      return {
        async wrap(raw: Uint8Array) { check(); return `al${id}.` + b64(raw.map(x => x ^ 0xa5)) },
        async unwrap(blob: string) {
          check()
          if (!blob.startsWith(`al${id}.`)) throw new core.AppLockInvalidatedError('old key')
          return unb64(blob.slice(`al${id}.`.length)).map(x => x ^ 0xa5)
        },
        async reset() {},
      }
    },
  }
})

vi.mock('./nativeKeystore', async () => {
  const actual = await vi.importActual<typeof import('./nativeKeystore')>('./nativeKeystore')
  const core = await vi.importActual<typeof import('./appLockCore')>('./appLockCore')
  const native = await import('./appLockNative')
  const plain = (alias: string) => ({
    async wrap(raw: Uint8Array) { return `ks.${alias}.` + b64(raw.map(x => x ^ 0x5a)) },
    async unwrap(blob: string) { return unb64(blob.slice(`ks.${alias}.`.length)).map(x => x ^ 0x5a) },
    async reset() {},
  })
  return {
    ...actual,
    plainNativeKeyWrapper: plain,
    nativeKeyWrapper: (alias: string) => {
      const user = alias.split('#')[0]
      return core.layeredWrapper(plain(alias), () => native.nativeLockLayer(user), () => !!core.getConfig(user))
    },
  }
})

import {
  abandonAppLock, disableAppLock, enableAppLock, getEscrowStatus, hasEscrow, recoverWithPassword,
  relockAfterRecovery, setupEscrow, unlockApp,
} from './appLock'
import { AppLockInvalidatedError, getConfig, isLocked, setConfig } from './appLockCore'
import { AtRestCipher, dropAllStorageKeys } from './atRest'
import {
  EscrowRateLimitedError, EscrowWrongPasswordError, deriveEscrowMaster, setEscrowSessionMaster,
} from './appLockEscrow'
import { cacheAuthSalt, newSalt } from '../crypto'
import { nativeKeyWrapper } from './nativeKeystore'

const kv = h.state.kv
const user = 'alice'
const te = new TextEncoder()
const td = new TextDecoder()

const store: Record<string, string> = {}
Object.assign(globalThis, {
  window: Object.assign(new EventTarget(), {}),
  localStorage: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
  },
})

const cipher = (prefix: string, alias: string) => new AtRestCipher(kv, prefix, nativeKeyWrapper(alias))

async function seedData() {
  const sig = cipher('sig:alice:', 'alice')
  const hist = cipher('hist:alice:', 'alice#history')
  return {
    s: await sig.seal('sig:alice:x', te.encode('identity')),
    m: await hist.seal('hist:alice:y', te.encode('history')),
  }
}
async function readBack(sealed: { s: Uint8Array; m: Uint8Array }) {
  dropAllStorageKeys()
  return [
    td.decode(await cipher('sig:alice:', 'alice').open('sig:alice:x', sealed.s)),
    td.decode(await cipher('hist:alice:', 'alice#history').open('hist:alice:y', sealed.m)),
  ]
}

const PW = 'hunter2 hunter2'
let salt: string
let master: CryptoKey

beforeEach(async () => {
  for (const k of await kv.keys('')) await kv.del(k)
  for (const k of Object.keys(store)) delete store[k]
  setConfig(user, null)
  setEscrowSessionMaster(null, null)
  dropAllStorageKeys()
  Object.assign(h.state, { keyId: 1, deleted: false, authFails: false, authed: false })
  salt = newSalt()
  cacheAuthSalt(user, salt)
  master = await deriveEscrowMaster(PW, salt)
})

describe('enable', () => {
  it('double-wraps the keys and stores Keystore-wrapped escrow blobs', async () => {
    const sealed = await seedData()
    await enableAppLock(user, '1m', master)
    expect(isLocked((await kv.get<string>('sig:alice:skw'))!)).toBe(true)
    expect(isLocked((await kv.get<string>('hist:alice:skw'))!)).toBe(true)
    expect((await kv.get<{ kw?: number }>('sig:alice:esc'))?.kw).toBe(1)
    expect(await hasEscrow(user)).toBe(true)
    expect(await getEscrowStatus(user)).toBe('current')
    expect(await readBack(sealed)).toEqual(['identity', 'history'])
  }, 30_000)

  it('disabling removes the escrow', async () => {
    await seedData()
    await enableAppLock(user, '1m', master)
    await disableAppLock(user)
    expect(await kv.get('sig:alice:esc')).toBeUndefined()
    expect(await kv.get('hist:alice:esc')).toBeUndefined()
    expect(getConfig(user)).toBeNull()
  }, 30_000)
})

describe('invalidated lock key: password recovery without data loss', () => {
  it('recovers with the password, re-enrolls the lock, keeps all data', async () => {
    const sealed = await seedData()
    await enableAppLock(user, '1m', master)
    h.state.keyId++   // new fingerprint enrolled: the old lock key is dead
    h.state.authed = false
    dropAllStorageKeys()
    await expect(unlockApp(user, getConfig(user)!)).rejects.toBeInstanceOf(AppLockInvalidatedError)

    await expect(recoverWithPassword(user, 'not the password')).rejects.toBeInstanceOf(EscrowWrongPasswordError)
    // nothing was wiped by the failed attempt
    expect(await kv.get('sig:alice:skw')).toBeDefined()
    expect(await kv.get('sig:alice:esc')).toBeDefined()

    expect(await recoverWithPassword(user, PW)).toBe('relock')
    expect(isLocked((await kv.get<string>('sig:alice:skw'))!)).toBe(false)   // readable via the Keystore only, for now
    expect(getConfig(user)).not.toBeNull()

    await relockAfterRecovery(user)
    expect(isLocked((await kv.get<string>('sig:alice:skw'))!)).toBe(true)
    expect(isLocked((await kv.get<string>('hist:alice:skw'))!)).toBe(true)
    expect(await readBack(sealed)).toEqual(['identity', 'history'])
    expect(await hasEscrow(user)).toBe(true)   // still there for the next time
  }, 60_000)

  it('biometrics unavailable / declined: keep the lock off, data stays readable', async () => {
    const sealed = await seedData()
    await enableAppLock(user, '1m', master)
    h.state.keyId++
    expect(await recoverWithPassword(user, PW)).toBe('relock')
    h.state.authFails = true
    await expect(relockAfterRecovery(user)).rejects.toThrow()
    h.state.authFails = false
    await abandonAppLock(user)
    expect(getConfig(user)).toBeNull()
    expect(await kv.get('sig:alice:esc')).toBeUndefined()
    expect(await readBack(sealed)).toEqual(['identity', 'history'])
  }, 60_000)

  it('rate-limits wrong passwords with growing delays, even for the right password', async () => {
    await seedData()
    await enableAppLock(user, '1m', master)
    h.state.keyId++
    await expect(recoverWithPassword(user, 'bad1')).rejects.toBeInstanceOf(EscrowWrongPasswordError)
    await expect(recoverWithPassword(user, 'bad2')).rejects.toBeInstanceOf(EscrowWrongPasswordError)
    await expect(recoverWithPassword(user, 'bad3')).rejects.toBeInstanceOf(EscrowRateLimitedError)
    await expect(recoverWithPassword(user, PW)).rejects.toBeInstanceOf(EscrowRateLimitedError)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 6_000)
      expect(await recoverWithPassword(user, PW)).toBe('relock')
    } finally {
      vi.useRealTimers()
    }
  }, 60_000)

  it('legacy account without escrow: no recovery path (caller falls back to the destructive flow)', async () => {
    await seedData()
    await enableAppLock(user, '1m', null)
    expect(await hasEscrow(user)).toBe(false)
    expect(await getEscrowStatus(user)).toBe('missing')
    await expect(recoverWithPassword(user, PW)).rejects.toThrow()
  }, 30_000)
})

describe('migration and password change', () => {
  it('user who enabled the lock before escrow existed gets it at the next unlock when the session knows the password', async () => {
    await seedData()
    await enableAppLock(user, '1m', null)
    expect(await hasEscrow(user)).toBe(false)
    // cold start: lock screen, no session secret -> nothing to escrow with
    h.state.authed = false
    dropAllStorageKeys()
    await unlockApp(user, getConfig(user)!)
    expect(await hasEscrow(user)).toBe(false)
    // later the user logs in with the password; the next unlock fills the gap silently
    setEscrowSessionMaster(user, master)
    h.state.authed = false
    dropAllStorageKeys()
    await unlockApp(user, getConfig(user)!)
    expect(await getEscrowStatus(user)).toBe('current')
  }, 60_000)

  it('Settings path: setupEscrow for an existing lock, authenticating through the lock layer', async () => {
    await seedData()
    await enableAppLock(user, '1m', null)
    h.state.authed = true
    await setupEscrow(user, master)
    expect(await getEscrowStatus(user)).toBe('current')
  }, 30_000)

  it('password change: escrow turns stale and is re-encrypted at the next unlock; the old password stops working', async () => {
    const sealed = await seedData()
    await enableAppLock(user, '1m', master)
    const salt2 = newSalt()
    cacheAuthSalt(user, salt2)   // credentials flow cached the new salt
    const master2 = await deriveEscrowMaster('a brand new password', salt2)
    expect(await getEscrowStatus(user)).toBe('stale')

    setEscrowSessionMaster(user, master2)
    h.state.authed = false
    dropAllStorageKeys()
    await unlockApp(user, getConfig(user)!)
    expect(await getEscrowStatus(user)).toBe('current')

    h.state.keyId++
    await expect(recoverWithPassword(user, PW)).rejects.toBeInstanceOf(EscrowWrongPasswordError)
    localStorage.removeItem('iris-escrow-attempts:alice')
    expect(await recoverWithPassword(user, 'a brand new password')).toBe('relock')
    await relockAfterRecovery(user)
    expect(await readBack(sealed)).toEqual(['identity', 'history'])
  }, 90_000)
})
