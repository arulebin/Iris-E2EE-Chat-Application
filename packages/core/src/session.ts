import { getTokenExpiryMs } from './auth.ts'
import type { LockManagerLike, SyncStore } from './storage.ts'

// Session tokens + the one fetch everything API-bound goes through.
//
// The access JWT is short-lived (1 h). A rotating refresh token renews it, so a
// login lasts until logout / 30 days idle instead of silently dying after an hour.
// Callers may still pass their own `Authorization` header (many do, from React
// state); apiFetch always replaces it with the freshest token, so a stale prop can
// never cause a 401.
//
// This is the web app's original lib/api.ts, parameterised over the platform pieces
// (token store, locks, fetch, "session expired" notification). It differs from the
// simpler `createAuthedFetch` in transport.ts by the rules the server needs: refresh
// is serialised across tabs (a rotated token reused by a second tab looks like
// theft), a 409 means "rotated moments ago", and only a 401 ends the session.

const ACCESS_KEY = 'token'
const REFRESH_KEY = 'iris-refresh-token'
const DEVICE_KEY = 'iris-session-device'

/** The login is over (refresh token missing, revoked or reused). */
export class AuthExpiredError extends Error {
  constructor() {
    super('Your session has expired — please log in again')
    this.name = 'AuthExpiredError'
  }
}

export type SessionClientOptions = {
  apiBase: string
  /** Where tokens live (web: localStorage). Reads are guarded; writes may throw. */
  store: SyncStore
  /** Cross-tab lock for refresh; null/undefined = run directly. Looked up per call. */
  getLocks?: () => LockManagerLike | null | undefined
  /** Looked up per call so test stubs of the global fetch apply. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  /** Called when the login is over, after local session state was cleared. */
  onExpired?: () => void
}

export function createSessionClient(opts: SessionClientOptions) {
  const doFetch = opts.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init))
  const store = opts.store

  function read(key: string): string | null {
    try { return store.getItem(key) } catch { return null }
  }

  const getAccessToken = (): string | null => read(ACCESS_KEY)
  const getRefreshToken = (): string | null => read(REFRESH_KEY)

  function setSession(token: string, refreshToken?: string | null): void {
    store.setItem(ACCESS_KEY, token)
    if (refreshToken) store.setItem(REFRESH_KEY, refreshToken)
  }

  function clearSession(): void {
    store.removeItem(ACCESS_KEY)
    store.removeItem(REFRESH_KEY)
    store.removeItem(DEVICE_KEY)
  }

  /** Lets the server tie this login to its Signal device (removing the device logs it out). */
  function setSessionDevice(deviceId: number | null): void {
    if (deviceId == null) store.removeItem(DEVICE_KEY)
    else store.setItem(DEVICE_KEY, String(deviceId))
  }

  function expire(): never {
    clearSession()
    opts.onExpired?.()
    throw new AuthExpiredError()
  }

  let inflight: Promise<string> | null = null

  /**
   * Single-flight refresh. Serialised across tabs with a lock where available.
   * Network failures throw a plain Error (stay logged in, retry later); only a
   * definitive server "no" ends the session.
   */
  function refreshAccessToken(): Promise<string> {
    inflight ??= (async () => {
      const before = getAccessToken()
      const run = () => doRefresh(before)
      const locks = opts.getLocks?.()
      return locks ? locks.request('iris-refresh', run) : run()
    })().finally(() => { inflight = null })
    return inflight
  }

  async function doRefresh(accessBefore: string | null): Promise<string> {
    // Another tab may have refreshed while we waited for the lock.
    const current = getAccessToken()
    if (current && current !== accessBefore && isFresh(current)) return current

    for (let attempt = 0; attempt < 2; attempt++) {
      const refreshToken = getRefreshToken()
      if (!refreshToken) expire()
      const deviceId = Number(read(DEVICE_KEY)) || undefined
      const res = await doFetch(`${opts.apiBase}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken, deviceId }),
      })
      if (res.ok) {
        const data = (await res.json()) as { token: string; refreshToken: string }
        setSession(data.token, data.refreshToken)
        return data.token
      }
      if (res.status === 409) {
        // Rotated moments ago (another tab/process). Use its result if it landed.
        await new Promise(r => setTimeout(r, 750))
        const latest = getAccessToken()
        if (latest && latest !== accessBefore && isFresh(latest)) return latest
        continue
      }
      if (res.status === 401) expire() // the only definitive "no"; 5xx/400/offline never log out
      throw new Error(`Session refresh failed (${res.status})`)
    }
    throw new Error('Session refresh failed')
  }

  function isFresh(token: string, minValidityMs = 60_000): boolean {
    const exp = getTokenExpiryMs(token)
    return exp === null || exp - Date.now() > minValidityMs
  }

  /**
   * A usable access token, refreshing first if it expires within a minute. Returns
   * null if there's no session. Throws AuthExpiredError if the login is over, or a
   * plain Error if the network is down (the current token is still worth trying).
   */
  async function ensureFreshToken(): Promise<string | null> {
    const token = getAccessToken()
    if (!token) return null
    if (isFresh(token)) return token
    if (!getRefreshToken()) return token // pre-refresh login: use it until it fails
    return refreshAccessToken()
  }

  function withAuth(init: RequestInit | undefined, token: string | null): RequestInit {
    const headers = new Headers(init?.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return { ...init, headers }
  }

  /**
   * fetch() for API calls: attaches the freshest access token, and on a 401 refreshes
   * once and retries. Non-API URLs (e.g. Capacitor file paths) pass straight through.
   */
  async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
    if (!url.includes('/api/')) return doFetch(url, init)

    let token: string | null
    try {
      token = await ensureFreshToken()
    } catch {
      token = getAccessToken()
    }
    const res = await doFetch(url, withAuth(init, token))
    if (res.status !== 401 || !getRefreshToken()) return res

    try {
      token = await refreshAccessToken()
    } catch {
      return res
    }
    return doFetch(url, withAuth(init, token))
  }

  /** Tell the server this login is over. Best effort; local state is cleared regardless. */
  async function logoutSession(): Promise<void> {
    const refreshToken = getRefreshToken()
    clearSession()
    if (!refreshToken) return
    try {
      await doFetch(`${opts.apiBase}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        keepalive: true,
      })
    } catch {
      // offline: the server-side session stays until revoked; local state is already gone
    }
  }

  return {
    getAccessToken, getRefreshToken, setSession, clearSession, setSessionDevice,
    refreshAccessToken, ensureFreshToken, apiFetch, logoutSession,
  }
}

export type SessionClient = ReturnType<typeof createSessionClient>
