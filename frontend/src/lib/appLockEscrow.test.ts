import { describe, expect, it } from 'vitest'
import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  ESCROW_INFO,
  EscrowMissingError,
  EscrowWrongPasswordError,
  backoffAfter,
  deriveEscrowMaster,
  escrowRetryIn,
  escrowStatus,
  loadEscrow,
  openEscrow,
  openEscrows,
  recordEscrowFailure,
  recordEscrowSuccess,
  removeEscrow,
  sealEscrow,
  storeEscrow,
  writeEscrows,
} from './appLockEscrow'
import { newSalt } from '../crypto'
import { memoryKV } from './signal/kv'
import type { KeyWrapper } from './nativeKeystore'

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

function fakeKeystore(): KeyWrapper {
  return {
    async wrap(raw) { return 'ks.' + b64(raw.map(x => x ^ 0x5a)) },
    async unwrap(blob) { return unb64(blob.slice(3)).map(x => x ^ 0x5a) },
    async reset() {},
  }
}

const raw = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 3) & 0xff)
const memStore = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}

describe('escrow seal / open', () => {
  it('round-trips under the password-derived master', async () => {
    const salt = newSalt()
    const master = await deriveEscrowMaster('correct horse', salt)
    const blob = await sealEscrow(master, salt, 'sig:alice:', raw)
    expect(blob.as).toBe(salt)
    expect(await openEscrow(await deriveEscrowMaster('correct horse', salt), 'sig:alice:', blob)).toEqual(raw)
  }, 30_000)

  it('rejects a wrong password with EscrowWrongPasswordError', async () => {
    const salt = newSalt()
    const blob = await sealEscrow(await deriveEscrowMaster('right', salt), salt, 'sig:alice:', raw)
    await expect(openEscrow(await deriveEscrowMaster('wrong', salt), 'sig:alice:', blob)).rejects.toBeInstanceOf(EscrowWrongPasswordError)
  }, 30_000)

  it('is bound to its slot (AAD) and uses a fresh salt/iv every time', async () => {
    const salt = newSalt()
    const master = await deriveEscrowMaster('pw', salt)
    const a = await sealEscrow(master, salt, 'sig:alice:', raw)
    const b = await sealEscrow(master, salt, 'sig:alice:', raw)
    expect(a.salt).not.toBe(b.salt)
    expect(a.ct).not.toBe(b.ct)
    await expect(openEscrow(master, 'hist:alice:', a)).rejects.toBeInstanceOf(EscrowWrongPasswordError)
  }, 30_000)

  it('uses its own HKDF label, distinct from the login / backup ones', () => {
    expect(ESCROW_INFO).toBe('iris-local-escrow-v1')
    expect(['iris-auth-v2', 'iris-kek-v2', 'iris-identity-v2']).not.toContain(ESCROW_INFO)
  })
})

describe('escrow storage', () => {
  it('keeps the ciphertext Keystore-wrapped at rest and reads it back', async () => {
    const kv = memoryKV()
    const ks = fakeKeystore()
    const salt = newSalt()
    const master = await deriveEscrowMaster('pw', salt)
    const blob = await sealEscrow(master, salt, 'sig:alice:', raw)
    await storeEscrow(kv, 'sig:alice:', ks, blob)
    const stored = (await kv.get<{ ct: string; kw?: number }>('sig:alice:esc'))!
    expect(stored.kw).toBe(1)
    expect(stored.ct).not.toBe(blob.ct)   // a file dump holds only the Keystore-wrapped form
    expect(await loadEscrow(kv, 'sig:alice:', ks)).toEqual(blob)
    // without the Keystore (off-device dump) it can't even be parsed
    expect(await loadEscrow(kv, 'sig:alice:', null)).toBeNull()
  }, 30_000)

  it('writeEscrows / openEscrows for both slots, then removal', async () => {
    const kv = memoryKV()
    const ks = fakeKeystore()
    const salt = newSalt()
    const master = await deriveEscrowMaster('pw', salt)
    const slots = [{ prefix: 'sig:alice:', base: ks }, { prefix: 'hist:alice:', base: ks }]
    const raws: Record<string, Uint8Array> = { 'sig:alice:': raw, 'hist:alice:': raw.map(x => x ^ 1) }
    await writeEscrows(kv, slots, master, async p => raws[p].slice())
    expect(await escrowStatus(kv, slots.map(s => s.prefix), salt)).toBe('current')
    const opened = await openEscrows(kv, slots, 'pw')
    expect(opened.get('sig:alice:')).toEqual(raws['sig:alice:'])
    expect(opened.get('hist:alice:')).toEqual(raws['hist:alice:'])
    await expect(openEscrows(kv, slots, 'nope')).rejects.toBeInstanceOf(EscrowWrongPasswordError)
    await removeEscrow(kv, 'hist:alice:')
    expect(await escrowStatus(kv, slots.map(s => s.prefix), salt)).toBe('missing')
    await expect(openEscrows(kv, slots, 'pw')).rejects.toBeInstanceOf(EscrowMissingError)
  }, 60_000)

  it('password change: stale escrow is re-encrypted under the new derivation', async () => {
    const kv = memoryKV()
    const slots = [{ prefix: 'sig:alice:', base: null }]
    const salt1 = newSalt()
    await writeEscrows(kv, slots, await deriveEscrowMaster('old', salt1), async () => raw.slice())
    const salt2 = newSalt()
    expect(await escrowStatus(kv, ['sig:alice:'], salt2)).toBe('stale')
    await writeEscrows(kv, slots, await deriveEscrowMaster('new', salt2), async () => raw.slice())
    expect(await escrowStatus(kv, ['sig:alice:'], salt2)).toBe('current')
    expect((await openEscrows(kv, slots, 'new')).get('sig:alice:')).toEqual(raw)
    await expect(openEscrows(kv, slots, 'old')).rejects.toBeInstanceOf(EscrowWrongPasswordError)
  }, 60_000)
})

describe('rate limit', () => {
  it('backoff schedule is free, then exponential, capped', () => {
    expect([0, 1, 2].map(backoffAfter)).toEqual([0, 0, 0])
    expect(backoffAfter(3)).toBe(BACKOFF_BASE_MS)
    expect(backoffAfter(4)).toBe(BACKOFF_BASE_MS * 2)
    expect(backoffAfter(5)).toBe(BACKOFF_BASE_MS * 4)
    expect(backoffAfter(40)).toBe(BACKOFF_MAX_MS)
  })

  it('locks out after repeated failures, persists, and clears on success', () => {
    const store = memStore()
    const t0 = 1_000_000
    expect(recordEscrowFailure('alice', t0, store)).toBe(0)
    expect(recordEscrowFailure('alice', t0, store)).toBe(0)
    expect(escrowRetryIn('alice', t0, store)).toBe(0)
    expect(recordEscrowFailure('alice', t0, store)).toBe(BACKOFF_BASE_MS)
    expect(escrowRetryIn('alice', t0 + 1000, store)).toBe(BACKOFF_BASE_MS - 1000)
    expect(escrowRetryIn('alice', t0 + BACKOFF_BASE_MS, store)).toBe(0)
    expect(recordEscrowFailure('alice', t0 + BACKOFF_BASE_MS, store)).toBe(BACKOFF_BASE_MS * 2)
    expect(escrowRetryIn('bob', t0, store)).toBe(0)   // per account
    recordEscrowSuccess('alice', store)
    expect(escrowRetryIn('alice', t0, store)).toBe(0)
    expect(recordEscrowFailure('alice', t0, store)).toBe(0)   // counter restarted
  })

  it('a clock set far backwards cannot lock the user out beyond the cap', () => {
    const store = memStore()
    for (let i = 0; i < 30; i++) recordEscrowFailure('alice', 5_000_000, store)
    expect(escrowRetryIn('alice', 0, store)).toBe(BACKOFF_MAX_MS)
  })
})
