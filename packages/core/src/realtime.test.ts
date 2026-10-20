import { describe, expect, it, vi } from 'vitest'
import { createRealtime, HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS, PING_FRAME, type MinimalWebSocket } from './realtime.ts'

class FakeWS implements MinimalWebSocket {
  static all: FakeWS[] = []
  readyState = 0
  sent: string[] = []
  closed: { code?: number; reason?: string } | null = null
  onopen: MinimalWebSocket['onopen'] = null
  onmessage: MinimalWebSocket['onmessage'] = null
  onclose: MinimalWebSocket['onclose'] = null
  onerror: MinimalWebSocket['onerror'] = null
  constructor(public url: string) { FakeWS.all.push(this) }
  send(d: string) { this.sent.push(d) }
  close(code?: number, reason?: string) { this.closed = { code, reason }; this.readyState = 3; this.onclose?.({ code: code ?? 1000, reason: reason ?? '' }) }
  open() { this.readyState = 1; this.onopen?.({}) }
  drop() { this.readyState = 3; this.onclose?.({ code: 1006, reason: '' }) }
  msg(d: string) { this.onmessage?.({ data: d }) }
}

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

function setup(resolveUrl: ReturnType<typeof vi.fn<(f: boolean) => Promise<string | null>>> = vi.fn(async (_f: boolean) => "wss://h/ws?token=t" as string | null)) {
  FakeWS.all = []
  vi.useFakeTimers()
  const onMessage = vi.fn()
  const onOpen = vi.fn()
  const onClose = vi.fn()
  const rt = createRealtime({ resolveUrl, WebSocketImpl: FakeWS as never }, { onMessage, onOpen, onClose })
  return { rt, resolveUrl, onMessage, onOpen, onClose }
}

describe('createRealtime', () => {
  it('connects, delivers frames, swallows pongs', async () => {
    const { rt, onMessage, onOpen } = setup()
    await flush()
    const ws = FakeWS.all[0]
    ws.open()
    expect(onOpen).toHaveBeenCalled()
    ws.msg('{"type":"pong"}')
    ws.msg('{"type":"message","x":1}')
    expect(onMessage).toHaveBeenCalledTimes(1)
    rt.send('hello')
    expect(ws.sent).toContain('hello')
    rt.close()
    vi.useRealTimers()
  })

  it('pings every 25s; closes with 4000 if pong is missing once supported', async () => {
    const { rt } = setup()
    await flush()
    const ws = FakeWS.all[0]
    ws.open()
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
    expect(ws.sent).toEqual([PING_FRAME])
    ws.msg('{"type":"pong"}') // server supports heartbeat
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
    expect(ws.sent.filter(s => s === PING_FRAME)).toHaveLength(2)
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS)
    expect(ws.closed?.code).toBe(4000)
    rt.close()
    vi.useRealTimers()
  })

  it('does not kill the socket for a missing pong until the server has answered once', async () => {
    const { rt } = setup()
    await flush()
    const ws = FakeWS.all[0]
    ws.open()
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS + 1)
    expect(ws.closed).toBeNull()
    rt.close()
    vi.useRealTimers()
  })

  it('reconnects with exponential backoff and resets on open', async () => {
    const { rt, resolveUrl } = setup()
    await flush()
    FakeWS.all[0].open()
    FakeWS.all[0].drop()
    await vi.advanceTimersByTimeAsync(999)
    expect(FakeWS.all).toHaveLength(1) // first retry after 1s, then 2s, 4s (mirrors web)
    await vi.advanceTimersByTimeAsync(2)
    expect(FakeWS.all).toHaveLength(2)
    FakeWS.all[1].drop() // never opened: failed handshake 1
    await vi.advanceTimersByTimeAsync(2001)
    expect(FakeWS.all).toHaveLength(3)
    FakeWS.all[2].drop() // failed handshake 2 -> next resolve forces refresh
    await vi.advanceTimersByTimeAsync(4001)
    expect(resolveUrl).toHaveBeenLastCalledWith(true)
    rt.close()
    vi.useRealTimers()
  })

  it('wake() reconnects immediately when down, pings when up', async () => {
    const { rt } = setup()
    await flush()
    const ws = FakeWS.all[0]
    ws.open()
    rt.wake()
    expect(ws.sent).toEqual([PING_FRAME])
    ws.drop()
    rt.wake()
    await flush()
    expect(FakeWS.all).toHaveLength(2)
    rt.close()
    vi.useRealTimers()
  })

  it('stays down when signed out (resolveUrl -> null) and retries when it throws', async () => {
    const r1 = setup(vi.fn(async () => null))
    await flush()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWS.all).toHaveLength(0)
    r1.rt.close()
    vi.useRealTimers()

    let n = 0
    const r2 = setup(vi.fn(async () => { if (n++ === 0) throw new Error('offline'); return 'wss://h/ws' }))
    await flush()
    await vi.advanceTimersByTimeAsync(2001)
    expect(FakeWS.all).toHaveLength(1)
    r2.rt.close()
    vi.useRealTimers()
  })

  it('close() stops reconnecting', async () => {
    const { rt } = setup()
    await flush()
    FakeWS.all[0].open()
    rt.close()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWS.all).toHaveLength(1)
    vi.useRealTimers()
  })
})
