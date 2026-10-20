import type { CryptoProvider } from '@iris/core'

/**
 * Wiring the host app provides once at startup (e.g. in the root layout / auth provider):
 *
 *   configureMedia({ apiBase: API_BASE, getToken: () => session.accessToken(), refreshToken: () => session.refresh() })
 */
export interface MediaConfig {
  /** Backend origin, no trailing slash (same value the web client calls `apiBase`). */
  apiBase: string
  /** Current bearer token. Called before every request attempt. */
  getToken: () => Promise<string> | string
  /** Optional: called once after a 401 to refresh the token, then the request is retried. */
  refreshToken?: () => Promise<void>
  /** Optional override; defaults to the react-native-quick-crypto provider. */
  crypto?: CryptoProvider
}

let current: MediaConfig | null = null

export function configureMedia(cfg: MediaConfig): void {
  current = { ...cfg, apiBase: cfg.apiBase.replace(/\/+$/, '') }
}

export function mediaConfig(): MediaConfig {
  if (!current) throw new Error('configureMedia() has not been called')
  return current
}

export function mediaCrypto(): CryptoProvider {
  if (current?.crypto) return current.crypto
  // Lazy require keeps this module importable in non-native contexts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('../crypto/provider') as typeof import('../crypto/provider')).nativeCryptoProvider()
}
