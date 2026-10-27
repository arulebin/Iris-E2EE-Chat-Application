import { describe, expect, it } from 'vitest'
import type { CallSnapshot } from './engine'
import { controlsAutoHideWanted, createControlsAutoHide, minimiseTarget, pipWanted } from './controls'

/** Manual clock: timers fire only when advance() passes them. */
function fakeTimers() {
  let now = 0
  let seq = 0
  const pending = new Map<number, { at: number; cb: () => void }>()
  return {
    set(cb: () => void, ms: number) { const id = ++seq; pending.set(id, { at: now + ms, cb }); return id },
    clear(h: unknown) { pending.delete(h as number) },
    advance(ms: number) {
      now += ms
      for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) { pending.delete(id); t.cb() }
      }
    },
    get count() { return pending.size },
  }
}

function setup() {
  const t = fakeTimers()
  const changes: boolean[] = []
  const c = createControlsAutoHide(v => changes.push(v), 4000, t)
  return { t, c, changes }
}

describe('call controls auto-hide', () => {
  it('stays visible while auto-hide is off (voice call)', () => {
    const { t, c } = setup()
    t.advance(60_000)
    expect(c.visible).toBe(true)
    c.tap()
    t.advance(60_000)
    expect(c.visible).toBe(true)
  })

  it('hides after 4 s without interaction', () => {
    const { t, c, changes } = setup()
    c.setEnabled(true)
    t.advance(3999)
    expect(c.visible).toBe(true)
    t.advance(1)
    expect(c.visible).toBe(false)
    expect(changes).toEqual([false])
  })

  it('a tap while hidden shows them and restarts the timer', () => {
    const { t, c } = setup()
    c.setEnabled(true)
    t.advance(4000)
    c.tap()
    expect(c.visible).toBe(true)
    t.advance(3000)
    expect(c.visible).toBe(true)
    t.advance(1000)
    expect(c.visible).toBe(false)
  })

  it('a tap while visible hides them at once', () => {
    const { t, c } = setup()
    c.setEnabled(true)
    t.advance(1000)
    c.tap()
    expect(c.visible).toBe(false)
    expect(t.count).toBe(0)
  })

  it('using a control keeps them up for another full delay', () => {
    const { t, c } = setup()
    c.setEnabled(true)
    t.advance(3500)
    c.interact()
    t.advance(3500)
    expect(c.visible).toBe(true)
    t.advance(500)
    expect(c.visible).toBe(false)
  })

  it('turning auto-hide off (call becomes voice) shows them and cancels the timer', () => {
    const { t, c } = setup()
    c.setEnabled(true)
    t.advance(4000)
    expect(c.visible).toBe(false)
    c.setEnabled(false)
    expect(c.visible).toBe(true)
    expect(t.count).toBe(0)
  })

  it('dispose cancels a pending hide', () => {
    const { t, c } = setup()
    c.setEnabled(true)
    c.dispose()
    t.advance(10_000)
    expect(c.visible).toBe(true)
  })
})

const snap = (state: CallSnapshot['state']) => ({ state })
const active = (mode: 'audio' | 'video') =>
  snap({ kind: 'active', peer: 'bob', mode, callId: 'c1', role: 'caller', startedAt: 0 })

describe('auto-hide gating', () => {
  it('only in an active video call with video on screen', () => {
    expect(controlsAutoHideWanted(active('video'), true)).toBe(true)
    expect(controlsAutoHideWanted(active('video'), false)).toBe(false)
    expect(controlsAutoHideWanted(active('audio'), true)).toBe(false)
    expect(controlsAutoHideWanted(snap({ kind: 'outgoing', to: 'bob', mode: 'video', callId: 'c1' }), true)).toBe(false)
  })
})

describe('picture-in-picture gating', () => {
  it('is armed only during an active video call', () => {
    expect(pipWanted(active('video'))).toBe(true)
    expect(pipWanted(active('audio'))).toBe(false)
    expect(pipWanted(snap({ kind: 'idle' }))).toBe(false)
    expect(pipWanted(snap({ kind: 'outgoing', to: 'bob', mode: 'video', callId: 'c1' }))).toBe(false)
    expect(pipWanted(snap({ kind: 'incoming', from: 'bob', offer: null, mode: 'video', callId: 'c1' }))).toBe(false)
  })

  it('minimise uses PiP for video calls and the in-app window otherwise', () => {
    expect(minimiseTarget(active('video'), true)).toBe('pip')
    expect(minimiseTarget(active('video'), false)).toBe('in-app')
    expect(minimiseTarget(active('audio'), true)).toBe('in-app')
    expect(minimiseTarget(snap({ kind: 'outgoing', to: 'bob', mode: 'video', callId: 'c1' }), true)).toBe('in-app')
  })
})
