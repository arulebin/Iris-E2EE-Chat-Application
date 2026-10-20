import { fromBase64 } from './crypto/bytes.ts'

/**
 * HTTP + realtime abstraction. The API client in @iris/core talks only to these,
 * so web (fetch + browser WebSocket) and RN (fetch + RN WebSocket, background-aware
 * reconnect) share all request logic.
 */
export type HttpRequest = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  headers?: Record<string, string>
  /** Skip the bearer token (login, refresh). */
  anonymous?: boolean
  signal?: AbortSignal
}
export type HttpResponse<T = unknown> = { status: number; ok: boolean; data: T }

export type SocketHandlers = {
  onOpen?(): void
  onMessage(frame: string): void
  onClose?(code: number, reason: string): void
  onError?(err: unknown): void
}
export type SocketHandle = { send(frame: string): void; close(): void }

export interface Transport {
  request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>>
  /** Open the realtime channel; implementations own reconnect and backoff. */
  connect(handlers: SocketHandlers): SocketHandle
}

/** Tokens the fetch wrapper needs. The platform persists them (KV / secure store). */
export interface TokenStore {
  getAccess(): Promise<string | null>
  getRefresh(): Promise<string | null>
  set(access: string, refresh: string): Promise<void>
  clear(): Promise<void>
}

/** Expiry (ms since epoch) of a JWT, or null if unreadable. */
export function jwtExpiryMs(token: string | null): number | null {
  if (!token) return null
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = new TextDecoder().decode(fromBase64(part))
    const exp = (JSON.parse(json) as { exp?: unknown }).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

export function isJwtFresh(token: string | null, minValidityMs = 60_000, now = Date.now()): boolean {
  const exp = jwtExpiryMs(token)
  return exp === null || exp - now > minValidityMs
}

export type RefreshResult = 'ok' | 'expired' | 'unavailable'

/**
 * Refresh-token-aware fetch (semantics mirror frontend/src/lib/api.ts):
 *  - attaches the freshest bearer token (proactively refreshing when it expires within a minute);
 *  - on 401 performs ONE single-flight refresh and retries once;
 *  - 409 from /auth/refresh means "rotated moments ago": wait and re-read the stored token;
 *  - ONLY a definitive 401 from /auth/refresh (or a missing refresh token) ends the session
 *    (tokens cleared, onSignedOut called). Network errors, 5xx and 400 never log out.
 */
export function createAuthedFetch(opts: {
  baseUrl: string
  tokens: TokenStore
  fetchImpl?: typeof fetch
  refreshPath?: string
  /** Lets the server tie the login to its Signal device. */
  getDeviceId?: () => Promise<number | null | undefined> | number | null | undefined
  onSignedOut?: () => void
  sleep?: (ms: number) => Promise<void>
}) {
  const f = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const refreshPath = opts.refreshPath ?? '/auth/refresh'
  const sleep = opts.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)))
  let inflight: Promise<RefreshResult> | null = null

  const expire = async (): Promise<RefreshResult> => {
    await opts.tokens.clear()
    opts.onSignedOut?.()
    return 'expired'
  }

  const doRefresh = async (before: string | null): Promise<RefreshResult> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const refreshToken = await opts.tokens.getRefresh()
      if (!refreshToken) return expire()
      let res: Response
      try {
        const deviceId = (await opts.getDeviceId?.()) ?? undefined
        res = await f(opts.baseUrl + refreshPath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken, deviceId }),
        })
      } catch {
        return 'unavailable'
      }
      if (res.ok) {
        const j = (await res.json()) as { token: string; refreshToken: string }
        await opts.tokens.set(j.token, j.refreshToken)
        return 'ok'
      }
      if (res.status === 409) {
        await sleep(750)
        const latest = await opts.tokens.getAccess()
        if (latest && latest !== before && isJwtFresh(latest)) return 'ok'
        continue
      }
      if (res.status === 401) return expire()
      return 'unavailable'
    }
    return 'unavailable'
  }

  /** Single-flight refresh. */
  const refresh = (): Promise<RefreshResult> => {
    inflight ??= (async () => doRefresh(await opts.tokens.getAccess()))().finally(() => {
      inflight = null
    })
    return inflight
  }

  /** A usable access token (refreshing first if it expires within a minute); null when signed out. */
  const ensureFreshToken = async (): Promise<string | null> => {
    const token = await opts.tokens.getAccess()
    if (!token) return null
    if (isJwtFresh(token)) return token
    if (!(await opts.tokens.getRefresh())) return token
    await refresh()
    return opts.tokens.getAccess()
  }

  const authed = async (path: string, init: RequestInit = {}, anonymous = false): Promise<Response> => {
    const send = async () => {
      const headers = new Headers(init.headers)
      if (!anonymous) {
        const t = await ensureFreshToken().catch(() => opts.tokens.getAccess())
        if (t) headers.set('Authorization', `Bearer ${t}`)
      }
      return f(opts.baseUrl + path, { ...init, headers })
    }
    const res = await send()
    if (res.status !== 401 || anonymous || !(await opts.tokens.getRefresh())) return res
    if ((await refresh()) === 'ok') return send()
    return res
  }
  return Object.assign(authed, { refresh, ensureFreshToken })
}
