import { fromBase64, toBase64, utf8, type CryptoProvider, type KeyWrapper, type KV } from '@iris/core'

/** The slice of react-native-mmkv's MMKV instance we use (lets tests inject a fake). */
export interface MmkvLike {
  set(key: string, value: string): void
  getString(key: string): string | undefined
  remove(key: string): boolean
  getAllKeys(): string[]
}
export type MmkvFactory = (cfg: { id: string; encryptionKey?: string }) => MmkvLike

const U8 = '$u8'
const replacer = (_k: string, v: unknown) => (v instanceof Uint8Array ? { [U8]: toBase64(v) } : v)
const reviver = (_k: string, v: unknown) => {
  if (v && typeof v === 'object' && U8 in v && typeof (v as Record<string, unknown>)[U8] === 'string') {
    return fromBase64((v as Record<string, string>)[U8])
  }
  return v
}

/** KV over MMKV. Values: JSON-able data; Uint8Array (also nested) round-trips. */
export class MmkvKV implements KV {
  constructor(private readonly mmkv: MmkvLike) {}
  async get<T = unknown>(key: string): Promise<T | undefined> {
    const raw = this.mmkv.getString(key)
    return raw === undefined ? undefined : (JSON.parse(raw, reviver) as T)
  }
  async set(key: string, value: unknown): Promise<void> {
    if (value === undefined) return this.delete(key)
    this.mmkv.set(key, JSON.stringify(value, replacer))
  }
  async delete(key: string): Promise<void> {
    this.mmkv.remove(key)
  }
  async keys(prefix = ''): Promise<string[]> {
    return this.mmkv.getAllKeys().filter(k => k.startsWith(prefix))
  }
}

const WRAPPED_KEY = 'mmkv-key.wrapped'

/**
 * Encrypted KV: an MMKV instance whose encryption key is random and stored only in
 * wrapped form (KeyWrapper = Android Keystore) inside a small unencrypted boot instance.
 *
 * MMKV's AES key is limited to 16 bytes, so the key is 16 printable characters
 * (12 random bytes as base64 = 96 bits of entropy). Treat this as the storage-at-rest layer;
 * sensitive blobs (Signal store, message history) additionally get AES-256-GCM from core's
 * at-rest cipher with a 256-bit key wrapped by the same KeyWrapper.
 *
 * Throws KeystoreKeyMissingError if the Keystore entry vanished (data unrecoverable);
 * callers decide whether to wipe (forgetEncryptedKey) and start over.
 */
export async function openEncryptedKV(opts: {
  wrapper: KeyWrapper
  crypto: Pick<CryptoProvider, 'randomBytes'>
  createMmkv: MmkvFactory
  id?: string
  bootId?: string
}): Promise<MmkvKV> {
  const id = opts.id ?? 'iris-secure'
  const boot = opts.createMmkv({ id: opts.bootId ?? `${id}-boot` })
  const stored = boot.getString(WRAPPED_KEY)
  let keyStr: string
  if (stored) {
    keyStr = new TextDecoder().decode(await opts.wrapper.unwrap(fromBase64(stored)))
  } else {
    keyStr = toBase64(await opts.crypto.randomBytes(12))
    boot.set(WRAPPED_KEY, toBase64(await opts.wrapper.wrap(utf8(keyStr))))
  }
  return new MmkvKV(opts.createMmkv({ id, encryptionKey: keyStr }))
}

/** Forget the wrapped key so the next open generates a fresh one (the old encrypted file is garbage). */
export function forgetEncryptedKey(createMmkv: MmkvFactory, bootId = 'iris-secure-boot'): void {
  createMmkv({ id: bootId }).remove(WRAPPED_KEY)
}
