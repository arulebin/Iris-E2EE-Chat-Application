// Application-level heartbeat for the chat socket. Mobile networks (NAT timeouts,
// Doze, Wi-Fi ↔ cellular) leave sockets half-open: no `close` ever fires, and the
// server keeps treating the user as online — so it skips the push. A ping every
// 25 s that must be answered within 10 s turns that into a prompt reconnect.

export const PING_FRAME = '{"type":"ping"}'
const INTERVAL_MS = 25_000
const TIMEOUT_MS = 10_000

export type Heartbeat = {
  /** Call for every `{type:"pong"}` received. */
  onPong(): void
  /** Ping now (e.g. on resume) instead of waiting for the next tick. */
  probe(): void
  stop(): void
}

export function startHeartbeat(ws: WebSocket): Heartbeat {
  // Until the server has answered once, a missing pong may just mean an older
  // backend without heartbeat support — don't kill the socket over it.
  let supported = false
  let waiting: ReturnType<typeof setTimeout> | null = null

  const ping = () => {
    if (ws.readyState !== WebSocket.OPEN || waiting) return
    ws.send(PING_FRAME)
    waiting = setTimeout(() => {
      waiting = null
      if (supported) ws.close(4000, 'heartbeat timeout')
    }, TIMEOUT_MS)
  }
  const interval = setInterval(ping, INTERVAL_MS)

  return {
    onPong() {
      supported = true
      if (waiting) { clearTimeout(waiting); waiting = null }
    },
    probe: ping,
    stop() {
      clearInterval(interval)
      if (waiting) clearTimeout(waiting)
    },
  }
}
