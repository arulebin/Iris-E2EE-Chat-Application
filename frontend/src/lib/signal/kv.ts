import { del, get, keys, set } from 'idb-keyval'

/** Minimal async key-value interface, so the Signal store can run on IndexedDB or in memory (tests). */
export interface KV {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
  keys(prefix: string): Promise<string[]>
}

export const idbKV: KV = {
  get: <T>(key: string) => get<T>(key),
  set: (key, value) => set(key, value),
  del: (key) => del(key),
  keys: async (prefix) => (await keys()).filter((k): k is string => typeof k === 'string' && k.startsWith(prefix)),
}

export function memoryKV(): KV {
  const m = new Map<string, unknown>()
  return {
    get: async <T>(key: string) => m.get(key) as T | undefined,
    set: async (key, value) => { m.set(key, value) },
    del: async (key) => { m.delete(key) },
    keys: async (prefix) => [...m.keys()].filter(k => k.startsWith(prefix)),
  }
}
