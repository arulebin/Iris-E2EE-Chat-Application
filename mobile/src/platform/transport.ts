import {
  createAuthedFetch,
  createRealtime,
  type HttpRequest,
  type HttpResponse,
  type SocketHandle,
  type SocketHandlers,
  type TokenStore,
  type Transport,
  type WebSocketCtor,
} from '@iris/core'
import type { Lifecycle } from './lifecycle'

export type RnTransportOptions = {
  baseUrl: string
  tokens: TokenStore
  lifecycle: Lifecycle
  /** Default: global fetch / WebSocket. */
  fetchImpl?: typeof fetch
  WebSocketImpl?: WebSocketCtor
  /** Ties this login to its Signal device (refresh body + device query param on the socket). */
  getDeviceId?: () => number | null | undefined
  onSignedOut?: () => void
  wsPath?: string
}

export type RnTransport = Omit<Transport, 'connect'> & {
  /** Opens the realtime channel (25 s ping, backoff, wake on foreground / network back). */
  connect(handlers: SocketHandlers): SocketHandle & { readonly isOpen: boolean }
  /** fetch() with bearer token + single-flight refresh, for callers that need a raw Response. */
  fetch: ReturnType<typeof createAuthedFetch>
}

/** https://host -> wss://host + path */
export const toWsUrl = (baseUrl: string, path: string) => baseUrl.replace(/^http/, 'ws').replace(/\/$/, '') + path

export function createRnTransport(opts: RnTransportOptions): RnTransport {
  const authed = createAuthedFetch({
    baseUrl: opts.baseUrl,
    tokens: opts.tokens,
    fetchImpl: opts.fetchImpl,
    getDeviceId: opts.getDeviceId,
    onSignedOut: opts.onSignedOut,
  })

  return {
    fetch: authed,
    async request<T>(req: HttpRequest): Promise<HttpResponse<T>> {
      const headers: Record<string, string> = { ...req.headers }
      let body: string | undefined
      if (req.body !== undefined) {
        body = JSON.stringify(req.body)
        headers['Content-Type'] ??= 'application/json'
      }
      const res = await authed(req.path, { method: req.method, headers, body, signal: req.signal }, !!req.anonymous)
      const text = await res.text()
      let data: unknown = undefined
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          data = text
        }
      }
      return { status: res.status, ok: res.ok, data: data as T }
    },

    connect(handlers: SocketHandlers): SocketHandle & { readonly isOpen: boolean } {
      const rt = createRealtime(
        {
          WebSocketImpl: opts.WebSocketImpl ?? (WebSocket as unknown as WebSocketCtor),
          async resolveUrl(forceRefresh) {
            let token: string | null
            try {
              if (forceRefresh) await authed.refresh()
              token = await authed.ensureFreshToken()
            } catch {
              token = await opts.tokens.getAccess() // offline: try anyway, backoff continues
            }
            if (!token) return null // signed out (or refresh definitively refused)
            const device = opts.getDeviceId?.()
            return (
              toWsUrl(opts.baseUrl, opts.wsPath ?? '/ws/chat') +
              `?token=${encodeURIComponent(token)}` +
              (device ? `&device=${device}` : '')
            )
          },
        },
        handlers,
      )
      const offFg = opts.lifecycle.onForeground(() => rt.wake())
      const offNet = opts.lifecycle.onOnline(() => rt.wake())
      return {
        get isOpen() {
          return rt.isOpen
        },
        send: f => rt.send(f),
        close() {
          offFg()
          offNet()
          rt.close()
        },
      }
    },
  }
}
