import { del, get, set } from 'idb-keyval'
import { apiBase } from './config'
import { apiFetch } from './api'
import { exportAll, importAll } from './messageStore'
import type { ChatMessage } from '../types'

// End-to-end encrypted message-history backup.
//
// Forward secrecy means a new device can't get old messages from the server, so
// history is backed up as ONE opaque blob encrypted under a random 256-bit
// RECOVERY KEY. The key is shown to the user once (52 base32 characters) and is
// never sent anywhere; this device keeps only a non-extractable HKDF handle to it
// so it can refresh the backup without asking again. The password is deliberately
// NOT involved: a server that learns or guesses the password still can't open the
// backup.
//
// Blob layout: "IRB1" ‖ flags(1) ‖ salt(16) ‖ iv(12) ‖ AES-256-GCM(ct ‖ tag)
//   flags bit 0 = gzip-compressed plaintext; AAD = "iris-backup-v1:<username>"
// Plaintext: JSON { v: 1, createdAt, conversations: { peer: ChatMessage[] } }
// It includes each message's media key, but not the media itself — snaps and
// photos still on the server can be opened again; deleted ones can't.

const MAGIC = new TextEncoder().encode('IRB1')
const SALT_BYTES = 16
const IV_BYTES = 12
const FLAG_GZIP = 1
const HKDF_INFO = new TextEncoder().encode('iris-backup-v1')
const KEY_BYTES = 32
const AUTO_BACKUP_MS = 24 * 3600_000

// Crockford base32: no I/L/O/U, so it's hard to misread when typed back in.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const localKeyFor = (me: string) => `iris-backup-key:${me}`
const lastBackupFor = (me: string) => `iris-backup-last:${me}`
const dismissedFor = (me: string) => `iris-backup-restore-dismissed:${me}`

// ── recovery key encoding ───────────────────────────────────────────

export function formatRecoveryKey(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out.match(/.{1,4}/g)!.join(' ')
}

export function parseRecoveryKey(input: string): Uint8Array<ArrayBuffer> {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  const out = new Uint8Array(KEY_BYTES)
  let bits = 0, value = 0, n = 0
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch)
    if (v < 0) throw new Error('That recovery key contains an invalid character')
    value = (value << 5) | v
    bits += 5
    if (bits >= 8) {
      if (n >= KEY_BYTES) throw new Error('That recovery key is too long')
      out[n++] = (value >>> (bits - 8)) & 0xff
      bits -= 8
    }
  }
  if (n !== KEY_BYTES) throw new Error('That recovery key is incomplete')
  return out
}

async function importRecoveryKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey', 'deriveBits'])
}

/**
 * Public, non-secret id of a recovery key (HKDF output under its own label). Sent
 * with each upload so a device can tell that another device replaced the backup
 * with a NEW recovery key, rather than silently overwriting it with the old one.
 */
async function recoveryKeyId(base: CryptoKey): Promise<string> {
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('iris-backup-keyid-v1') },
    base, 128,
  )
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('')
}

/** The server's backup was made with a different recovery key (set up on another device). */
export class BackupKeyChangedError extends Error {
  constructor() {
    super('Backups were set up again on another device with a new recovery key. Enter that key to keep backing up here.')
  }
}

async function deriveBlobKey(base: CryptoKey, salt: Uint8Array<ArrayBuffer>, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: HKDF_INFO }, base, { name: 'AES-GCM', length: 256 }, false, [usage])
}

// ── compression (when the platform has it) ──────────────────────────

async function gzip(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof CompressionStream === 'undefined') return null
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser can\'t read compressed backups')
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// ── seal / open (pure: no storage, no network) ─────────────────────

export type BackupPayload = { v: 1; createdAt: string; conversations: Record<string, ChatMessage[]> }

export async function sealBackup(base: CryptoKey, me: string, payload: BackupPayload): Promise<Uint8Array<ArrayBuffer>> {
  const json = new TextEncoder().encode(JSON.stringify(payload))
  const compressed = await gzip(json)
  const plaintext = compressed ?? json
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveBlobKey(base, salt, 'encrypt')
  const ad = new TextEncoder().encode(`iris-backup-v1:${me}`)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ad }, key, plaintext))

  const out = new Uint8Array(MAGIC.length + 1 + SALT_BYTES + IV_BYTES + ct.length)
  let o = 0
  out.set(MAGIC, o); o += MAGIC.length
  out[o++] = compressed ? FLAG_GZIP : 0
  out.set(salt, o); o += SALT_BYTES
  out.set(iv, o); o += IV_BYTES
  out.set(ct, o)
  return out
}

/** Throws OperationError when the recovery key is wrong (or the blob was tampered with / is another account's). */
export async function openBackup(base: CryptoKey, me: string, blob: Uint8Array<ArrayBuffer>): Promise<BackupPayload> {
  if (blob.length < MAGIC.length + 1 + SALT_BYTES + IV_BYTES + 16 || !MAGIC.every((b, i) => blob[i] === b)) {
    throw new Error('Not an Iris backup')
  }
  let o = MAGIC.length
  const flags = blob[o++]
  const salt = blob.slice(o, o + SALT_BYTES); o += SALT_BYTES
  const iv = blob.slice(o, o + IV_BYTES); o += IV_BYTES
  const key = await deriveBlobKey(base, salt, 'decrypt')
  const ad = new TextEncoder().encode(`iris-backup-v1:${me}`)
  let plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: ad }, key, blob.slice(o)))
  if (flags & FLAG_GZIP) plaintext = await gunzip(plaintext)
  const payload = JSON.parse(new TextDecoder().decode(plaintext)) as BackupPayload
  if (payload?.v !== 1 || typeof payload.conversations !== 'object') throw new Error('Unsupported backup format')
  return payload
}

// ── server ──────────────────────────────────────────────────────────

export type BackupMeta = { exists: boolean; size?: number; updatedAt?: string; keyId?: string }

export async function fetchBackupMeta(token: string): Promise<BackupMeta> {
  const res = await apiFetch(`${apiBase}/api/backup/meta`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Backup status failed: ${res.status}`)
  return res.json()
}

// ── the user-facing operations ──────────────────────────────────────

export async function isBackupEnabled(me: string): Promise<boolean> {
  return !!(await get(localKeyFor(me)))
}

export async function lastBackupAt(me: string): Promise<number | null> {
  return (await get<number>(lastBackupFor(me))) ?? null
}

/**
 * Turn backups on: create a fresh recovery key, keep a non-extractable handle,
 * and upload the first backup. Returns the key for the user to write down —
 * it's the only time it can be shown. Replaces any existing server backup, so the
 * UI must confirm that first when one exists.
 */
export async function enableBackup(me: string, token: string): Promise<string> {
  const raw = crypto.getRandomValues(new Uint8Array(KEY_BYTES))
  const display = formatRecoveryKey(raw)
  await set(localKeyFor(me), await importRecoveryKey(raw))
  raw.fill(0)
  await backupNow(me, token, { replace: true })
  return display
}

export async function backupNow(me: string, token: string, opts: { replace?: boolean } = {}): Promise<void> {
  const base = await get<CryptoKey>(localKeyFor(me))
  if (!base) throw new Error('Backups are off on this device')
  const keyId = await recoveryKeyId(base)
  if (!opts.replace) {
    const meta = await fetchBackupMeta(token)
    if (meta.exists && meta.keyId && meta.keyId !== keyId) throw new BackupKeyChangedError()
  }
  const blob = await sealBackup(base, me, { v: 1, createdAt: new Date().toISOString(), conversations: await exportAll(me) })
  const res = await apiFetch(`${apiBase}/api/backup`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'X-Backup-Key-Id': keyId },
    body: blob,
  })
  if (res.status === 413) throw new Error('Your message history is too large to back up (25 MB limit)')
  if (!res.ok) throw new Error(`Backup upload failed: ${res.status}`)
  await set(lastBackupFor(me), Date.now())
}

/**
 * Restore from the server backup with a recovery key. Messages are merged into
 * local history (nothing local is lost). On success the key is remembered so
 * this device keeps the backup up to date. Returns the number of messages restored.
 */
export async function restoreBackup(me: string, token: string, recoveryKey: string): Promise<number> {
  const base = await importRecoveryKey(parseRecoveryKey(recoveryKey))
  const res = await apiFetch(`${apiBase}/api/backup`, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 404) throw new Error('There is no backup for this account')
  if (!res.ok) throw new Error(`Backup download failed: ${res.status}`)
  let payload: BackupPayload
  try {
    payload = await openBackup(base, me, new Uint8Array(await res.arrayBuffer()))
  } catch (err) {
    if (err instanceof Error && err.name === 'OperationError') throw new Error("That recovery key doesn't open this backup", { cause: err })
    throw err
  }
  const count = await importAll(me, payload.conversations)
  await set(localKeyFor(me), base)
  await set(dismissedFor(me), true)
  return count
}

export async function disableBackup(me: string, token: string): Promise<void> {
  const res = await apiFetch(`${apiBase}/api/backup`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok && res.status !== 404) throw new Error(`Couldn't delete the backup: ${res.status}`)
  await del(localKeyFor(me))
  await del(lastBackupFor(me))
}

/** Back up in the background at most once a day; failures are only logged. */
export async function maybeAutoBackup(me: string, token: string): Promise<void> {
  if (!(await isBackupEnabled(me))) return
  const last = await lastBackupAt(me)
  if (last && Date.now() - last < AUTO_BACKUP_MS) return
  await backupNow(me, token).catch(err => console.warn('Automatic backup failed', err))
}

export async function isRestoreDismissed(me: string): Promise<boolean> {
  return !!(await get(dismissedFor(me)))
}

export async function dismissRestore(me: string): Promise<void> {
  await set(dismissedFor(me), true)
}
