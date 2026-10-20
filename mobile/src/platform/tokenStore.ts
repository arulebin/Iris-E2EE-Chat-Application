import { utf8, type KeyWrapper, type KV, type TokenStore } from '@iris/core'

/**
 * Access + refresh tokens persisted ONLY as Keystore-wrapped blobs (never plain AsyncStorage /
 * plain MMKV). The KV may itself be encrypted; the wrapper makes the tokens device-bound
 * regardless. The access token is also cached in memory.
 */
export function createWrappedTokenStore(kv: KV, wrapper: KeyWrapper, prefix = 'auth.'): TokenStore {
  let access: string | null | undefined
  let refresh: string | null | undefined
  const read = async (name: string): Promise<string | null> => {
    const blob = await kv.get<string>(prefix + name)
    if (!blob) return null
    try {
      return new TextDecoder().decode(await wrapper.unwrap(blob))
    } catch (e) {
      // Key lost: the stored token is unrecoverable; treat as signed out.
      if ((e as Error)?.name === 'KeystoreKeyMissingError') return null
      throw e
    }
  }
  const write = async (name: string, value: string) =>
    kv.set(prefix + name, await wrapper.wrap(utf8(value)))

  return {
    async getAccess() {
      if (access === undefined) access = await read('access')
      return access
    },
    async getRefresh() {
      if (refresh === undefined) refresh = await read('refresh')
      return refresh
    },
    async set(a, r) {
      access = a // visible to readers immediately; persistence follows
      refresh = r
      await write('refresh', r) // refresh first: if we die in between, the old access expires harmlessly
      await write('access', a)
      access = a
    },
    async clear() {
      access = null
      refresh = null
      await kv.delete(prefix + 'access')
      await kv.delete(prefix + 'refresh')
    },
  }
}
