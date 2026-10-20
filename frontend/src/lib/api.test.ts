import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apiFetch, AuthExpiredError, AUTH_EXPIRED_EVENT, ensureFreshToken, getAccessToken,
  getRefreshToken, logoutSession, refreshAccessToken, setSession,
} from './api'
import { startHeartbeat, PING_FRAME } from './heartbeat'

// ── minimal browser globals for node ──────────────────────────────────────

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k) },
    setItem: (k, v) => { m.set(k, String(v)) },
  }
}

function jwt(expSecondsFromNow: number, sub = 'alice'): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '')
  return `${b64({ alg: 'HS512' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })}.sig`
}

type Call = { url: string; init?: RequestInit }
let calls: Call[]
let respond: (c: Call) => Response | Promise<Response>
let expiredEvents: number

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  const target = new EventTarget()
  vi.stubGlobal('window', target)
  vi.stubGlobal('navigator', {}) // no Web Locks: exercises the in-tab single-flight
  calls = []
  expiredEvents = 0
  target.addEventListener(AUTH_EXPIRED_EVENT, () => { expiredEvents++ })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const c = { url, init }
    calls.push(c)
    return respond(c)
  }))
})

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const authOf = (c: Call) => new Headers(c.init?.headers).get('Authorization')

describe('session refresh', () => {
  it('uses a fresh token as-is', async () => {
    const t = jwt(3600)
    setSession(t, 'r1')
    expect(await ensureFreshToken()).toBe(t)
    expect(calls).toHaveLength(0)
  })

  it('refreshes a nearly-expired token and stores the rotated pair', async () => {
    setSession(jwt(30), 'r1')
    const next = jwt(3600)
    respond = () => json(200, { token: next, refreshToken: 'r2' })
    expect(await ensureFreshToken()).toBe(next)
    expect(getRefreshToken()).toBe('r2')
    expect(JSON.parse(calls[0].init!.body as string).refreshToken).toBe('r1')
  })

  it('collapses concurrent refreshes into one request', async () => {
    setSession(jwt(-10), 'r1')
    const next = jwt(3600)
    respond = () => json(200, { token: next, refreshToken: 'r2' })
    const results = await Promise.all([refreshAccessToken(), refreshAccessToken(), ensureFreshToken()])
    expect(results).toEqual([next, next, next])
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1)
  })

  it('ends the session on a definitive 401', async () => {
    setSession(jwt(-10), 'r1')
    respond = () => new Response('nope', { status: 401 })
    await expect(refreshAccessToken()).rejects.toBeInstanceOf(AuthExpiredError)
    expect(getAccessToken()).toBeNull()
    expect(expiredEvents).toBe(1)
  })

  it('stays logged in when the network is down', async () => {
    const t = jwt(-10)
    setSession(t, 'r1')
    respond = () => { throw new TypeError('Failed to fetch') }
    await expect(refreshAccessToken()).rejects.toThrow(TypeError)
    expect(getAccessToken()).toBe(t)
    expect(expiredEvents).toBe(0)
  })

  it('on 409 (rotated by another tab) adopts the newer stored token', async () => {
    vi.useFakeTimers()
    setSession(jwt(-10), 'r1')
    const fromOtherTab = jwt(3600)
    respond = () => { setSession(fromOtherTab, 'r9'); return new Response('race', { status: 409 }) }
    const p = refreshAccessToken()
    await vi.advanceTimersByTimeAsync(1000)
    expect(await p).toBe(fromOtherTab)
  })

  it('a login from before refresh tokens keeps using its JWT', async () => {
    const t = jwt(-10)
    localStorage.setItem('token', t)
    expect(await ensureFreshToken()).toBe(t)
    expect(calls).toHaveLength(0)
  })
})

describe('apiFetch', () => {
  it('replaces a stale Authorization header with the current token', async () => {
    const t = jwt(3600)
    setSession(t, 'r1')
    respond = () => json(200, {})
    await apiFetch('/api/users', { headers: { Authorization: 'Bearer stale' } })
    expect(authOf(calls[0])).toBe(`Bearer ${t}`)
  })

  it('refreshes once on 401 and retries', async () => {
    setSession(jwt(3600), 'r1')
    const next = jwt(3600, 'alice')
    let apiHits = 0
    respond = (c) => {
      if (c.url.endsWith('/auth/refresh')) return json(200, { token: next, refreshToken: 'r2' })
      return ++apiHits === 1 ? new Response('', { status: 401 }) : json(200, { ok: true })
    }
    const res = await apiFetch('/api/users')
    expect(res.status).toBe(200)
    expect(authOf(calls[calls.length - 1])).toBe(`Bearer ${next}`)
  })

  it('returns the 401 when the refresh itself is refused', async () => {
    setSession(jwt(3600), 'r1')
    respond = () => new Response('', { status: 401 }) // API and refresh both refuse
    const res = await apiFetch('/api/users')
    expect(res.status).toBe(401)
    expect(expiredEvents).toBe(1)
  })

  it('passes non-API URLs through untouched', async () => {
    setSession(jwt(3600), 'r1')
    respond = () => new Response('blob')
    await apiFetch('https://localhost/_capacitor_file_/x.jpg')
    expect(authOf(calls[0])).toBeNull()
  })

  it('logout clears local tokens and revokes server-side', async () => {
    setSession(jwt(3600), 'r1')
    respond = () => new Response(null, { status: 204 })
    await logoutSession()
    expect(getAccessToken()).toBeNull()
    expect(calls[0].url).toMatch(/\/auth\/logout$/)
    expect(JSON.parse(calls[0].init!.body as string).refreshToken).toBe('r1')
  })
})

describe('heartbeat', () => {
  function fakeSocket() {
    return { readyState: 1, sent: [] as string[], closed: false,
      send(f: string) { this.sent.push(f) }, close() { this.closed = true } }
  }

  it('pings and tolerates a backend without pong support', () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    const ws = fakeSocket()
    const hb = startHeartbeat(ws as unknown as WebSocket)
    vi.advanceTimersByTime(25_000)
    expect(ws.sent).toEqual([PING_FRAME])
    vi.advanceTimersByTime(15_000)
    expect(ws.closed).toBe(false) // never saw a pong: old server, keep the socket
    hb.stop()
  })

  it('closes a socket that stops answering once pongs are known to work', () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    const ws = fakeSocket()
    const hb = startHeartbeat(ws as unknown as WebSocket)
    hb.probe(); hb.onPong()               // server answered once
    vi.advanceTimersByTime(25_000)        // next ping…
    vi.advanceTimersByTime(10_000)        // …unanswered
    expect(ws.closed).toBe(true)
    hb.stop()
  })
})
