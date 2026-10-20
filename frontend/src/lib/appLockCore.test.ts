import { describe, expect, it } from 'vitest'
import {
  addLock,
  AppLockInvalidatedError,
  AppLockRequiredError,
  AuthGuard,
  isLocked,
  layeredWrapper,
  LOCK_MARK,
  LockMachine,
  removeLock,
  timingMs,
} from './appLockCore'
import { AtRestCipher } from './atRest'
import { memoryKV } from './signal/kv'
import type { KeyWrapper } from './nativeKeystore'

const MIN = 60_000

describe('LockMachine', () => {
  it('starts locked on a cold start and unlocks', () => {
    const m = new LockMachine(MIN, true)
    expect(m.locked).toBe(true)
    m.unlock()
    expect(m.locked).toBe(false)
  })

  it('locks immediately on return when timeout is 0', () => {
    const m = new LockMachine(timingMs('immediately'), false)
    m.background(1000)
    expect(m.foreground(1000)).toBe(true)
  })

  it('stays unlocked for a short absence and locks after the timeout', () => {
    const m = new LockMachine(timingMs('1m'), false)
    m.background(0)
    expect(m.foreground(59_999)).toBe(false)
    m.background(100_000)
    expect(m.foreground(100_000 + MIN)).toBe(true)
  })

  it('30 minute setting', () => {
    const m = new LockMachine(timingMs('30m'), false)
    m.background(0)
    expect(m.foreground(29 * MIN)).toBe(false)
    m.background(29 * MIN)
    expect(m.foreground(29 * MIN + 30 * MIN)).toBe(true)
  })

  it('uses the first background timestamp, not later ones', () => {
    const m = new LockMachine(MIN, false)
    m.background(0)
    m.background(50_000)       // duplicate pause event
    expect(m.foreground(61_000)).toBe(true)
  })

  it('fails safe when the clock goes backwards', () => {
    const m = new LockMachine(30 * MIN, false)
    m.background(10_000_000)
    expect(m.foreground(5_000)).toBe(true)
  })

  it('a foreground without a prior background changes nothing', () => {
    const m = new LockMachine(0, false)
    expect(m.foreground(1)).toBe(false)
  })

  it('ignores background events while locked, and stays locked until unlock()', () => {
    const m = new LockMachine(MIN, true)
    m.background(0)
    expect(m.foreground(1)).toBe(true)
    m.unlock()
    expect(m.foreground(2)).toBe(false)
  })

  it('discardBackground cancels a pending absence (auth-prompt pause)', () => {
    const m = new LockMachine(0, false)
    m.background(0)
    m.discardBackground()
    expect(m.foreground(10 * MIN)).toBe(false)
  })

  it('lock() forces a lock', () => {
    const m = new LockMachine(MIN, false)
    m.lock()
    expect(m.locked).toBe(true)
  })
})

describe('AuthGuard', () => {
  it('suspends during a prompt and for a grace period after', () => {
    const g = new AuthGuard(1500)
    expect(g.suspended(0)).toBe(false)
    g.begin()
    expect(g.suspended(10_000)).toBe(true)
    g.end(10_000)
    expect(g.suspended(11_000)).toBe(true)
    expect(g.suspended(11_600)).toBe(false)
  })
})

// ── double wrap ──────────────────────────────────────────────────

const te = new TextEncoder()
const td = new TextDecoder()
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

/** A fake wrapper that "encrypts" by XOR with a tag byte and a label, so layers are distinguishable. */
function fakeWrapper(label: string, xor: number): KeyWrapper & { calls: string[]; locked: boolean } {
  const w = {
    calls: [] as string[],
    locked: false,
    async wrap(raw: Uint8Array) {
      w.calls.push('wrap')
      if (w.locked) throw new AppLockRequiredError('locked')
      return `${label}.` + b64(raw.map(b => b ^ xor))
    },
    async unwrap(blob: string) {
      w.calls.push('unwrap')
      if (w.locked) throw new AppLockRequiredError('locked')
      if (!blob.startsWith(`${label}.`)) throw new Error('wrong key')
      return unb64(blob.slice(label.length + 1)).map(b => b ^ xor)
    },
    async reset() { w.calls.push('reset') },
  }
  return w
}

describe('double wrap', () => {
  const raw = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 1)

  it('wraps with both layers and unwraps back', async () => {
    const base = fakeWrapper('ks', 0x5a)
    const lock = fakeWrapper('al', 0xa5)
    const w = layeredWrapper(base, () => lock, () => true)
    const blob = await w.wrap(raw)
    expect(blob.startsWith(LOCK_MARK)).toBe(true)
    // neither layer alone yields the secret
    expect(await base.unwrap(blob.slice(LOCK_MARK.length))).not.toEqual(raw)
    expect(await w.unwrap(blob)).toEqual(raw)
  })

  it('needs the lock layer: a locked lock layer blocks unwrap, base alone is not enough', async () => {
    const base = fakeWrapper('ks', 0x5a)
    const lock = fakeWrapper('al', 0xa5)
    const w = layeredWrapper(base, () => lock, () => true)
    const blob = await w.wrap(raw)
    lock.locked = true   // auth window expired
    await expect(w.unwrap(blob)).rejects.toBeInstanceOf(AppLockRequiredError)
    lock.locked = false
    expect(await w.unwrap(blob)).toEqual(raw)
  })

  it('refuses a locked blob when no lock layer is available', async () => {
    const base = fakeWrapper('ks', 0x5a)
    const lock = fakeWrapper('al', 0xa5)
    const blob = await layeredWrapper(base, () => lock, () => true).wrap(raw)
    await expect(layeredWrapper(base, () => null, () => false).unwrap(blob)).rejects.toBeInstanceOf(AppLockRequiredError)
  })

  it('reads old single-wrapped blobs and writes single when the lock is off', async () => {
    const base = fakeWrapper('ks', 0x5a)
    const lock = fakeWrapper('al', 0xa5)
    const off = layeredWrapper(base, () => lock, () => false)
    const blob = await off.wrap(raw)
    expect(isLocked(blob)).toBe(false)
    const on = layeredWrapper(base, () => lock, () => true)
    expect(await on.unwrap(blob)).toEqual(raw)
    expect(lock.calls).toEqual([])
  })

  it('addLock / removeLock round-trip, idempotent, and leaves the secret intact', async () => {
    const base = fakeWrapper('ks', 0x5a)
    const lock = fakeWrapper('al', 0xa5)
    const single = await base.wrap(raw)
    const locked = await addLock(single, base, lock)
    expect(isLocked(locked)).toBe(true)
    expect(await addLock(locked, base, lock)).toBe(locked)
    const back = await removeLock(locked, base, lock)
    expect(isLocked(back)).toBe(false)
    expect(await base.unwrap(back)).toEqual(raw)
    expect(await removeLock(back, base, lock)).toBe(back)
  })

  it('removeLock needs authentication', async () => {
    const base = fakeWrapper('ks', 0x5a)
    const lock = fakeWrapper('al', 0xa5)
    const locked = await addLock(await base.wrap(raw), base, lock)
    lock.locked = true
    await expect(removeLock(locked, base, lock)).rejects.toBeInstanceOf(AppLockRequiredError)
  })

  it('a destroyed lock key (invalidated) makes locked blobs unrecoverable, surfaced as an error', async () => {
    const base = fakeWrapper('ks', 0x5a)
    const lock = fakeWrapper('al', 0xa5)
    const locked = await addLock(await base.wrap(raw), base, lock)
    const dead: KeyWrapper = {
      wrap: async () => { throw new AppLockInvalidatedError('x') },
      unwrap: async () => { throw new AppLockInvalidatedError('x') },
      reset: async () => {},
    }
    await expect(layeredWrapper(base, () => dead, () => true).unwrap(locked)).rejects.toBeInstanceOf(AppLockInvalidatedError)
  })

  it('web style: lock layer without a base wrapper', async () => {
    const lock = fakeWrapper('prf', 0x33)
    const w = layeredWrapper(null, () => lock, () => true)
    const blob = await w.wrap(raw)
    expect(blob).toBe(LOCK_MARK + 'prf.' + b64(raw.map(b => b ^ 0x33)))
    expect(await w.unwrap(blob)).toEqual(raw)
    await expect(layeredWrapper(null, () => lock, () => false).wrap(raw)).rejects.toBeInstanceOf(AppLockRequiredError)
  })

  it('drives AtRestCipher end to end: data written single-wrapped stays readable after addLock', async () => {
    const kv = memoryKV()
    const base = fakeWrapper('ks', 0x5a)
    const lock = fakeWrapper('al', 0xa5)
    const slot = 'sig:alice:x'
    const w = layeredWrapper(base, () => lock, () => locking)
    let locking = false

    const c1 = new AtRestCipher(kv, 'sig:alice:', w)
    const sealed = await c1.seal(slot, te.encode('secret'))
    // enable: convert the stored blob
    locking = true
    const blob = (await kv.get<string>('sig:alice:skw'))!
    await kv.set('sig:alice:skw', await addLock(blob, base, lock))
    expect(isLocked((await kv.get<string>('sig:alice:skw'))!)).toBe(true)

    // lock engages: a fresh cipher (no cached key) can't read until auth succeeds
    lock.locked = true
    const c2 = new AtRestCipher(kv, 'sig:alice:', w)
    c2.forget()
    await expect(c2.open(slot, sealed)).rejects.toBeInstanceOf(AppLockRequiredError)
    lock.locked = false
    expect(td.decode(await c2.open(slot, sealed))).toBe('secret')

    // disable: back to single wrap, still readable
    const blob2 = (await kv.get<string>('sig:alice:skw'))!
    await kv.set('sig:alice:skw', await removeLock(blob2, base, lock))
    locking = false
    c2.forget()
    lock.locked = true   // no auth needed any more
    expect(td.decode(await new AtRestCipher(kv, 'sig:alice:', w).open(slot, sealed))).toBe('secret')
  })
})
