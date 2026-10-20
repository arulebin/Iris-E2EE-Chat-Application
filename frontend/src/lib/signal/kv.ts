import { del, get, keys, set } from 'idb-keyval'
import { MemoryKV, type KV } from '@iris/core'

export type { KV }

/** IndexedDB-backed KV (the web's @iris/core KV adapter). `del` is kept as an alias of `delete` for older callers. */
export const idbKV: KV & { del(key: string): Promise<void> } = {
  get: <T>(key: string) => get<T>(key),
  set: (key, value) => set(key, value),
  delete: (key) => del(key),
  del: (key) => del(key),
  keys: async (prefix = '') => (await keys()).filter((k): k is string => typeof k === 'string' && k.startsWith(prefix)),
}

export function memoryKV(): KV {
  return new MemoryKV()
}
