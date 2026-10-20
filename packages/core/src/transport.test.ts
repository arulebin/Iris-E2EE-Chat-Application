import { describe, expect, it, vi } from 'vitest'
import { createAuthedFetch, isJwtFresh, jwtExpiryMs, type TokenStore } from './transport.ts'

const b64u = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (expSec: number) => `${b64u({ alg: 'none' })}.${b64u({ exp: expSec })}.sig`
const farFuture = () => jwt(Math.floor(Date.now() / 1000) + 3600)

function memTokens(access: string | null, refresh: string | null): TokenStore & { a: string | null; r: string | null } {
  const s = {
    a: access,
    r: refresh,
    getAccess: async () => s.a,
    getRefresh: async () => s.r,
    set: async (a: string, r: string) => { s.a = a; s.r = r },
    clear: async () => { s.a = null; s.r = null },
  }
  return s
}
const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('jwt helpers', () => {
  it('reads exp and freshness', () => {
    const t = jwt(2000)
    expect(jwtExpiryMs(t)).toBe(2_000_000)
    expect(isJwtFresh(t, 60_000, 1_000_000)).toBe(true)
    expect(isJwtFresh(t, 60_000, 1_950_000)).toBe(false)
    expect(isJwtFresh('garbage')).toBe(true) // unreadable = unknown, let the server decide
  })
})

describe('createAuthedFetch', () => {
  it('attaches bearer and passes through 200', async () => {
    const tokens = memTokens(farFuture(), 'r1')
    const f = vi.fn(async (_u: string, _i?: RequestInit) => json(200))
    const authed = createAuthedFetch({ baseUrl: 'https://x', tokens, fetchImpl: f as never })
    const res = await authed('/api/me')
    expect(res.status).toBe(200)
    const init = f.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${tokens.a}`)
  })

  it('refreshes once on 401 (single-flight) and retries', async () => {
    const tokens = memTokens(farFuture(), 'r1')
    const fresh = farFuture() + 'x'
    let refreshCalls = 0
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls++
        return json(200, { token: fresh, refreshToken: 'r2' })
      }
      const auth = new Headers(init?.headers).get('Authorization')
      return auth === `Bearer ${fresh}` ? json(200) : json(401)
    })
    const authed = createAuthedFetch({ baseUrl: 'https://x', tokens, fetchImpl: f as never })
    const [a, b] = await Promise.all([authed('/api/a'), authed('/api/b')])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(refreshCalls).toBe(1)
    expect(tokens.r).toBe('r2')
  })

  it('sends deviceId in the refresh body', async () => {
    const tokens = memTokens(farFuture(), 'r1')
    let body = ''
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) { body = String(init?.body); return json(200, { token: farFuture(), refreshToken: 'r2' }) }
      return json(new Headers(init?.headers).get('Authorization') === `Bearer ${tokens.a}` && tokens.r === 'r2' ? 200 : 401)
    })
    const authed = createAuthedFetch({ baseUrl: 'https://x', tokens, fetchImpl: f as never, getDeviceId: () => 7 })
    await authed('/api/a')
    expect(JSON.parse(body)).toEqual({ refreshToken: 'r1', deviceId: 7 })
  })

  it('ONLY a definitive 401 from /auth/refresh signs out', async () => {
    const tokens = memTokens(farFuture(), 'r1')
    const out = vi.fn()
    const f = vi.fn(async (url: string) => (url.endsWith('/auth/refresh') ? json(401) : json(401)))
    const authed = createAuthedFetch({ baseUrl: 'https://x', tokens, fetchImpl: f as never, onSignedOut: out })
    const res = await authed('/api/a')
    expect(res.status).toBe(401)
    expect(out).toHaveBeenCalledTimes(1)
    expect(tokens.r).toBeNull()
  })

  it.each([500, 503, 400])('refresh answering %i does not log out', async status => {
    const tokens = memTokens(farFuture(), 'r1')
    const out = vi.fn()
    const f = vi.fn(async (url: string) => (url.endsWith('/auth/refresh') ? json(status) : json(401)))
    const authed = createAuthedFetch({ baseUrl: 'https://x', tokens, fetchImpl: f as never, onSignedOut: out })
    const res = await authed('/api/a')
    expect(res.status).toBe(401) // caller sees the 401, session stays
    expect(out).not.toHaveBeenCalled()
    expect(tokens.r).toBe('r1')
  })

  it('network failure during refresh does not log out', async () => {
    const tokens = memTokens(farFuture(), 'r1')
    const out = vi.fn()
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) throw new TypeError('Network request failed')
      return json(401)
    })
    const authed = createAuthedFetch({ baseUrl: 'https://x', tokens, fetchImpl: f as never, onSignedOut: out })
    expect((await authed('/api/a')).status).toBe(401)
    expect(out).not.toHaveBeenCalled()
  })

  it('409 (rotated by another process) adopts the stored token after a pause', async () => {
    const tokens = memTokens(farFuture(), 'r1')
    const rotated = farFuture() + 'y'
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) return json(409)
      return new Headers(init?.headers).get('Authorization') === `Bearer ${rotated}` ? json(200) : json(401)
    })
    const sleep = vi.fn(async () => { tokens.a = rotated })
    const authed = createAuthedFetch({ baseUrl: 'https://x', tokens, fetchImpl: f as never, sleep })
    expect((await authed('/api/a')).status).toBe(200)
    expect(sleep).toHaveBeenCalledWith(750)
  })

  it('proactively refreshes an expiring access token', async () => {
    const tokens = memTokens(jwt(Math.floor(Date.now() / 1000) + 10), 'r1')
    const fresh = farFuture() + 'z'
    const seen: string[] = []
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) return json(200, { token: fresh, refreshToken: 'r2' })
      seen.push(new Headers(init?.headers).get('Authorization') ?? '')
      return json(200)
    })
    const authed = createAuthedFetch({ baseUrl: 'https://x', tokens, fetchImpl: f as never })
    await authed('/api/a')
    expect(seen).toEqual([`Bearer ${fresh}`])
  })

  it('anonymous requests never refresh or sign out', async () => {
    const tokens = memTokens(null, null)
    const out = vi.fn()
    const f = vi.fn(async () => json(401))
    const authed = createAuthedFetch({ baseUrl: 'https://x', tokens, fetchImpl: f as never, onSignedOut: out })
    expect((await authed('/auth/login', { method: 'POST' }, true)).status).toBe(401)
    expect(f).toHaveBeenCalledTimes(1)
    expect(out).not.toHaveBeenCalled()
  })
})
