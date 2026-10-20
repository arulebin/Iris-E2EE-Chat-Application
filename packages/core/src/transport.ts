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

/**
 * Refresh-token-aware fetch: attaches the bearer token and, on 401, performs ONE
 * single-flight refresh (concurrent callers share the same promise), retries the
 * request once, and clears tokens (calling onSignedOut) if the refresh fails.
 */
export function createAuthedFetch(opts: {
  baseUrl: string
  tokens: TokenStore
  fetchImpl?: typeof fetch
  refreshPath?: string
  onSignedOut?: () => void
}) {
  const f = opts.fetchImpl ?? fetch
  const refreshPath = opts.refreshPath ?? '/api/auth/refresh'
  let inflight: Promise<boolean> | null = null

  const refresh = (): Promise<boolean> => {
    if (!inflight) {
      inflight = (async () => {
        try {
          const refreshToken = await opts.tokens.getRefresh()
          if (!refreshToken) return false
          const res = await f(opts.baseUrl + refreshPath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          })
          if (!res.ok) return false
          const j = (await res.json()) as { token: string; refreshToken: string }
          await opts.tokens.set(j.token, j.refreshToken)
          return true
        } catch {
          return false
        } finally {
          inflight = null
        }
      })()
    }
    return inflight
  }

  return async (path: string, init: RequestInit = {}, anonymous = false): Promise<Response> => {
    const send = async () => {
      const headers = new Headers(init.headers)
      if (!anonymous) {
        const t = await opts.tokens.getAccess()
        if (t) headers.set('Authorization', `Bearer ${t}`)
      }
      return f(opts.baseUrl + path, { ...init, headers })
    }
    let res = await send()
    if (res.status === 401 && !anonymous) {
      if (await refresh()) res = await send()
      else {
        await opts.tokens.clear()
        opts.onSignedOut?.()
      }
    }
    return res
  }
}
