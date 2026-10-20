import { deriveCredentials, fromBase64, saltOfMaster, toBase64 } from '../crypto'
import type { KeyWrapper } from './nativeKeystore'
import type { KV } from './signal/kv'

// Password escrow of the at-rest storage keys (App lock).
//
// With App lock on, the raw storage keys are wrapped by an auth-bound key that
// dies when biometrics change. To avoid losing the local data then, each raw
// key also gets an ESCROW copy: AES-GCM under a key derived from the Iris
// password (the same PBKDF2 master as login, split off with its own HKDF info
// label so it's independent of the login credential and the backup KEK).
//
// Stored locally only, never uploaded, at '<prefix>esc':
//   { v: 1, as, salt, iv, ct, kw? }
//   as   authSalt the master was derived with (not secret)
//   salt random 16-byte HKDF salt; iv 12 bytes; ct AES-GCM(raw key), AAD binds the slot
//   kw   1 when ct is additionally wrapped by the (non-auth) Android Keystore key,
//        so a file dump taken off the device is useless even to a password guesser.

export const ESCROW_INFO = 'iris-local-escrow-v1'
export const ESCROW_SLOT = 'esc'
const SALT_BYTES = 16
const IV_BYTES = 12

export type EscrowBlob = { v: 1; as: string; salt: string; iv: string; ct: string; kw?: 1 }

/** The password did not open the escrow. */
export class EscrowWrongPasswordError extends Error {}
/** Too many recent wrong passwords; try again later. */
export class EscrowRateLimitedError extends Error {
  readonly retryInMs: number
  constructor(retryInMs: number) {
    super(`Too many attempts. Try again in ${Math.ceil(retryInMs / 1000)} s.`)
    this.retryInMs = retryInMs
  }
}
/** No escrow stored for this account (legacy state). */
export class EscrowMissingError extends Error {}

const aadOf = (prefix: string) => new TextEncoder().encode(`iris-escrow-v1:${prefix}`)

async function escrowKey(master: CryptoKey, salt: Uint8Array<ArrayBuffer>, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(ESCROW_INFO) },
    master, { name: 'AES-GCM', length: 256 }, false, [usage],
  )
}

/** Encrypt a raw storage key under the master. `authSalt` is recorded so the right master can be re-derived later. */
export async function sealEscrow(master: CryptoKey, authSalt: string, prefix: string, raw: Uint8Array): Promise<EscrowBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadOf(prefix) },
    await escrowKey(master, salt, 'encrypt'), raw as Uint8Array<ArrayBuffer>,
  )
  return { v: 1, as: authSalt, salt: toBase64(salt), iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) }
}

/** Inverse of sealEscrow (blob.ct must not be Keystore-wrapped any more). Throws EscrowWrongPasswordError. */
export async function openEscrow(master: CryptoKey, prefix: string, blob: EscrowBlob): Promise<Uint8Array> {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(blob.iv), additionalData: aadOf(prefix) },
      await escrowKey(master, fromBase64(blob.salt), 'decrypt'), fromBase64(blob.ct),
    )
    return new Uint8Array(pt)
  } catch {
    throw new EscrowWrongPasswordError('Wrong password')
  }
}

/** Master secret for (password, authSalt): the login derivation, so one PBKDF2 serves both. */
export async function deriveEscrowMaster(password: string, authSalt: string): Promise<CryptoKey> {
  return (await deriveCredentials(password, authSalt)).master
}

// ── storage ──────────────────────────────────────────────────────

export async function storeEscrow(kv: KV, prefix: string, base: KeyWrapper | null, blob: EscrowBlob): Promise<void> {
  const out: EscrowBlob = base
    ? { ...blob, ct: await base.wrap(fromBase64(blob.ct)), kw: 1 }
    : { ...blob }
  await kv.set(prefix + ESCROW_SLOT, out)
}

export async function loadEscrow(kv: KV, prefix: string, base: KeyWrapper | null): Promise<EscrowBlob | null> {
  const b = await kv.get<EscrowBlob>(prefix + ESCROW_SLOT)
  if (!b || b.v !== 1) return null
  if (!b.kw) return b
  if (!base) return null
  return { v: 1, as: b.as, salt: b.salt, iv: b.iv, ct: toBase64(await base.unwrap(b.ct)) }
}

export async function removeEscrow(kv: KV, prefix: string): Promise<void> {
  await kv.del(prefix + ESCROW_SLOT)
}

/** Presence + authSalt tag of each slot's escrow, no Keystore access. */
export async function escrowTags(kv: KV, prefixes: string[]): Promise<(string | null)[]> {
  return Promise.all(prefixes.map(async p => {
    const b = await kv.get<EscrowBlob>(p + ESCROW_SLOT)
    return b && b.v === 1 ? b.as : null
  }))
}

export type EscrowStatus = 'missing' | 'stale' | 'current'

/** `current` when every slot has an escrow made under `authSalt` (or, with no salt given, any). */
export async function escrowStatus(kv: KV, prefixes: string[], authSalt: string | null): Promise<EscrowStatus> {
  const tags = await escrowTags(kv, prefixes)
  if (tags.some(t => t === null)) return 'missing'
  if (authSalt && tags.some(t => t !== authSalt)) return 'stale'
  return 'current'
}

type Slot = { prefix: string; base: KeyWrapper | null }

/** Escrow every slot's raw key under `master`. `getRaw` yields the raw key (may need user authentication). */
export async function writeEscrows(
  kv: KV,
  slots: Slot[],
  master: CryptoKey,
  getRaw: (prefix: string) => Promise<Uint8Array | null>,
): Promise<void> {
  const authSalt = saltOfMaster(master)
  if (!authSalt) throw new Error('Master secret has no known salt')
  for (const { prefix, base } of slots) {
    const raw = await getRaw(prefix)
    if (!raw) continue
    try {
      await storeEscrow(kv, prefix, base, await sealEscrow(master, authSalt, prefix, raw))
    } finally {
      raw.fill(0)
    }
  }
}

/**
 * Decrypt every slot's escrow with the password. Returns prefix -> raw key.
 * Each blob's own `as` salt is used (PBKDF2 runs once per distinct salt).
 */
export async function openEscrows(kv: KV, slots: Slot[], password: string): Promise<Map<string, Uint8Array>> {
  const masters = new Map<string, CryptoKey>()
  const out = new Map<string, Uint8Array>()
  try {
    for (const { prefix, base } of slots) {
      const blob = await loadEscrow(kv, prefix, base)
      if (!blob) throw new EscrowMissingError('No escrow for ' + prefix)
      let m = masters.get(blob.as)
      if (!m) masters.set(blob.as, (m = await deriveEscrowMaster(password, blob.as)))
      out.set(prefix, await openEscrow(m, prefix, blob))
    }
  } catch (err) {
    for (const r of out.values()) r.fill(0)
    throw err
  }
  return out
}

// ── local rate limit ─────────────────────────────────────────────
// Exponential backoff on wrong passwords, persisted so a restart doesn't reset
// it. It only slows guessing by someone holding an unlocked phone; an off-device
// copy of the data is protected by the Keystore wrap and PBKDF2 cost instead.

export const FREE_ATTEMPTS = 3
export const BACKOFF_BASE_MS = 5_000
export const BACKOFF_MAX_MS = 15 * 60_000

type AttemptState = { fails: number; until: number }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const attemptsKey = (user: string) => `iris-escrow-attempts:${user}`
const defaultStore = (): Store | null => { try { return localStorage } catch { return null } }

function readAttempts(user: string, store: Store | null): AttemptState {
  try {
    const raw = store?.getItem(attemptsKey(user))
    if (raw) {
      const s = JSON.parse(raw) as Partial<AttemptState>
      if (Number.isFinite(s.fails) && Number.isFinite(s.until)) return { fails: s.fails!, until: s.until! }
    }
  } catch { /* corrupt: treat as clean */ }
  return { fails: 0, until: 0 }
}

export const backoffAfter = (fails: number): number =>
  fails < FREE_ATTEMPTS ? 0 : Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (fails - FREE_ATTEMPTS))

/** Milliseconds the caller must still wait (0 = may try). */
export function escrowRetryIn(user: string, now: number = Date.now(), store: Store | null = defaultStore()): number {
  const { until } = readAttempts(user, store)
  // A clock moved far back must not lock the user out for longer than the cap.
  return Math.min(Math.max(0, until - now), BACKOFF_MAX_MS)
}

export function recordEscrowFailure(user: string, now: number = Date.now(), store: Store | null = defaultStore()): number {
  const s = readAttempts(user, store)
  const fails = s.fails + 1
  const wait = backoffAfter(fails)
  try { store?.setItem(attemptsKey(user), JSON.stringify({ fails, until: now + wait })) } catch { /* ignore */ }
  return wait
}

export function recordEscrowSuccess(user: string, store: Store | null = defaultStore()): void {
  try { store?.removeItem(attemptsKey(user)) } catch { /* ignore */ }
}

// ── session master (password-derived secret of the current login) ───
// App.tsx hands over the in-memory master so a lock that has no escrow yet (or
// a stale one after a password change) can be fixed up at the next unlock
// without asking for the password again.

let sessionMaster: { user: string; master: CryptoKey } | null = null
export function setEscrowSessionMaster(user: string | null, master: CryptoKey | null): void {
  sessionMaster = user && master ? { user, master } : null
}
export function getEscrowSessionMaster(user: string): CryptoKey | null {
  return sessionMaster && sessionMaster.user === user ? sessionMaster.master : null
}
