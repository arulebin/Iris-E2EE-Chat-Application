/**
 * Reconnecting chat socket with application-level heartbeat. Platform-neutral:
 * the WebSocket constructor and timers are injected, and the platform calls
 * `wake()` on "app foregrounded" / "network back".
 *
 * Mirrors frontend/src/App.tsx (WS lifecycle) + lib/heartbeat.ts:
 *  - ping every 25 s, pong must arrive within 10 s (only enforced once the server has
 *    answered once, so older backends without heartbeat support aren't killed);
 *  - exponential backoff 1 s -> 30 s; reset on open and on wake;
 *  - sockets that close without ever opening count as failed handshakes; after 2 the URL
 *    is resolved with `forceRefresh` so a rejected token is renewed instead of retried.
 */
import type { SocketHandle, SocketHandlers } from './transport.ts'

export const PING_FRAME = '{"type":"ping"}'
export const HEARTBEAT_INTERVAL_MS = 25_000
export const HEARTBEAT_TIMEOUT_MS = 10_000

export type MinimalWebSocket = {
  readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number; reason: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
}
export type WebSocketCtor = new (url: string) => MinimalWebSocket

export type RealtimeOptions = {
  /** Full ws(s) URL including auth, or null when signed out / no token (then no reconnect is scheduled). */
  resolveUrl(forceRefresh: boolean): Promise<string | null>
  WebSocketImpl: WebSocketCtor
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown
  clearTimeoutImpl?: (h: unknown) => void
  setIntervalImpl?: (fn: () => void, ms: number) => unknown
  clearIntervalImpl?: (h: unknown) => void
  minRetryMs?: number
  maxRetryMs?: number
}

export type RealtimeSocket = SocketHandle & {
  /** Network back / app foregrounded: probe an open socket, otherwise reconnect immediately. */
  wake(): void
  readonly isOpen: boolean
}

const OPEN = 1
const CONNECTING = 0

export function createRealtime(opts: RealtimeOptions, handlers: SocketHandlers): RealtimeSocket {
  const st = opts.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms))
  const ct = opts.clearTimeoutImpl ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>))
  const si = opts.setIntervalImpl ?? ((fn, ms) => setInterval(fn, ms))
  const ci = opts.clearIntervalImpl ?? (h => clearInterval(h as ReturnType<typeof setInterval>))
  const minRetry = opts.minRetryMs ?? 1_000
  const maxRetry = opts.maxRetryMs ?? 30_000

  let destroyed = false
  let ws: MinimalWebSocket | null = null
  let retryDelay = minRetry
  let retryTimer: unknown = null
  let failedHandshakes = 0
  let connecting = false
  // heartbeat state of the current socket
  let hbInterval: unknown = null
  let hbWaiting: unknown = null
  let hbSupported = false

  const stopHeartbeat = () => {
    if (hbInterval != null) ci(hbInterval)
    if (hbWaiting != null) ct(hbWaiting)
    hbInterval = hbWaiting = null
    hbSupported = false
  }
  const ping = (sock: MinimalWebSocket) => {
    if (sock.readyState !== OPEN || hbWaiting != null) return
    sock.send(PING_FRAME)
    hbWaiting = st(() => {
      hbWaiting = null
      if (hbSupported) sock.close(4000, 'heartbeat timeout')
    }, HEARTBEAT_TIMEOUT_MS)
  }
  const onPong = () => {
    hbSupported = true
    if (hbWaiting != null) {
      ct(hbWaiting)
      hbWaiting = null
    }
  }

  const scheduleReconnect = () => {
    if (destroyed) return
    if (retryTimer != null) ct(retryTimer)
    retryTimer = st(() => {
      retryTimer = null
      retryDelay = Math.min(retryDelay * 2, maxRetry)
      void connect()
    }, retryDelay)
  }

  async function connect(): Promise<void> {
    if (destroyed || connecting) return
    connecting = true
    let url: string | null
    try {
      url = await opts.resolveUrl(failedHandshakes >= 2)
    } catch {
      connecting = false
      scheduleReconnect() // transient failure (offline): keep backing off
      return
    }
    connecting = false
    if (destroyed || !url) return
    const sock = new opts.WebSocketImpl(url)
    ws = sock
    let opened = false
    sock.onopen = () => {
      opened = true
      failedHandshakes = 0
      retryDelay = minRetry
      stopHeartbeat()
      hbInterval = si(() => ping(sock), HEARTBEAT_INTERVAL_MS)
      handlers.onOpen?.()
    }
    sock.onmessage = ev => {
      const frame = typeof ev.data === 'string' ? ev.data : String(ev.data)
      // Cheap pre-check so the common non-pong frames aren't parsed twice.
      if (frame.length < 40 && frame.includes('"pong"')) {
        try {
          if ((JSON.parse(frame) as { type?: string }).type === 'pong') return onPong()
        } catch {
          /* not JSON, fall through */
        }
      }
      handlers.onMessage(frame)
    }
    sock.onerror = ev => handlers.onError?.(ev)
    sock.onclose = ev => {
      if (ws === sock) stopHeartbeat()
      if (!opened) failedHandshakes++
      // Only act if the ref still points at THIS socket (a replaced socket's late close must not
      // orphan the live one).
      if (ws !== sock) return
      ws = null
      handlers.onClose?.(ev.code, ev.reason)
      scheduleReconnect()
    }
  }

  void connect()

  return {
    get isOpen() {
      return ws?.readyState === OPEN
    },
    send(frame) {
      if (ws?.readyState !== OPEN) throw new Error('Not connected')
      ws.send(frame)
    },
    wake() {
      if (destroyed) return
      if (ws?.readyState === OPEN) {
        ping(ws)
        return
      }
      if (ws?.readyState === CONNECTING || connecting) return
      ws = null // a CLOSING socket is abandoned; its onclose won't reconnect
      if (retryTimer != null) {
        ct(retryTimer)
        retryTimer = null
      }
      retryDelay = minRetry
      void connect()
    },
    close() {
      destroyed = true
      if (retryTimer != null) ct(retryTimer)
      stopHeartbeat()
      const s = ws
      ws = null
      s?.close()
    },
  }
}
