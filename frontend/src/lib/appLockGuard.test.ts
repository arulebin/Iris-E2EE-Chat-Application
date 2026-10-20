import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FILE_PICK_MAX_MS, FILE_PICK_SETTLE_MS, HOLD_GRACE_MS, HOLD_MAX_MS,
  appLockHeld, beginFilePick, endFilePick, holdAppLock, lockSuspended,
  onCallActiveChange, resetAppLockHolds, setCallActive, withAppLockHold,
} from './appLockGuard'

// Node test env: minimal window/document stand-ins (EventTarget based).
const win = new EventTarget()
const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as "hidden" | "visible" })
const held = () => appLockHeld(Date.now())
const setVisibility = (v: "hidden" | "visible") => {
  doc.visibilityState = v
  doc.dispatchEvent(new Event("visibilitychange"))
}

beforeEach(() => {
  vi.stubGlobal("window", win)
  vi.stubGlobal("document", doc)
  vi.useFakeTimers()
  setVisibility("visible")
})
afterEach(() => { resetAppLockHolds(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('holdAppLock', () => {
  it('holds until released, then for the grace period', () => {
    expect(held()).toBe(false)
    const release = holdAppLock()
    expect(held()).toBe(true)
    release()
    expect(held()).toBe(true)
    vi.advanceTimersByTime(HOLD_GRACE_MS + 1)
    expect(held()).toBe(false)
  })

  it('release is idempotent and cannot release another hold', () => {
    const a = holdAppLock()
    const b = holdAppLock()
    a(); a(); a()
    vi.advanceTimersByTime(HOLD_GRACE_MS + 1)
    expect(held()).toBe(true) // b still active
    b()
    vi.advanceTimersByTime(HOLD_GRACE_MS + 1)
    expect(held()).toBe(false)
  })

  it('nested holds: held until the last one is released', () => {
    const outer = holdAppLock()
    const inner = holdAppLock()
    inner()
    vi.advanceTimersByTime(60_000)
    expect(held()).toBe(true)
    outer()
    vi.advanceTimersByTime(HOLD_GRACE_MS + 1)
    expect(held()).toBe(false)
  })

  it('a stuck hold expires on its own', () => {
    holdAppLock()
    vi.advanceTimersByTime(HOLD_MAX_MS - 1)
    expect(held()).toBe(true)
    vi.advanceTimersByTime(HOLD_GRACE_MS + 2)
    expect(held()).toBe(false)
  })
})

describe('withAppLockHold', () => {
  it('holds during the call and releases on success', async () => {
    let finish!: (v: number) => void
    const p = withAppLockHold(() => new Promise<number>(r => { finish = r }))
    expect(held()).toBe(true)
    finish(7)
    await expect(p).resolves.toBe(7)
    vi.advanceTimersByTime(HOLD_GRACE_MS + 1)
    expect(held()).toBe(false)
  })

  it('releases when the call throws', async () => {
    await expect(withAppLockHold(async () => { throw new Error('cancelled') })).rejects.toThrow('cancelled')
    vi.advanceTimersByTime(HOLD_GRACE_MS + 1)
    expect(held()).toBe(false)
  })

  it('releases when fn throws synchronously', async () => {
    await expect(withAppLockHold((() => { throw new Error('boom') }) as () => Promise<void>)).rejects.toThrow('boom')
    vi.advanceTimersByTime(HOLD_GRACE_MS + 1)
    expect(held()).toBe(false)
  })
})

describe('file picker holds', () => {
  const settle = () => vi.advanceTimersByTime(FILE_PICK_SETTLE_MS + HOLD_GRACE_MS + 1)

  it('holds from click and releases on change', () => {
    beginFilePick()
    expect(held()).toBe(true)
    endFilePick()
    settle()
    expect(held()).toBe(false)
  })

  it('cancel: no change event, release after the app comes back', () => {
    beginFilePick()
    setVisibility('hidden')
    vi.advanceTimersByTime(30_000)
    expect(held()).toBe(true)
    setVisibility('visible')
    expect(held()).toBe(true)          // still covers the late resume event
    vi.advanceTimersByTime(FILE_PICK_SETTLE_MS - 1)
    expect(held()).toBe(true)
    settle()
    expect(held()).toBe(false)
  })

  it('cancel on desktop: blur then focus', () => {
    beginFilePick()
    win.dispatchEvent(new Event('blur'))
    win.dispatchEvent(new Event('focus'))
    settle()
    expect(held()).toBe(false)
  })

  it('a stray focus before the app was left does not release', () => {
    beginFilePick()
    win.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(FILE_PICK_SETTLE_MS * 2)
    expect(held()).toBe(true)
    endFilePick()
  })

  it('going away again before the settle delay cancels the release', () => {
    beginFilePick()
    setVisibility('hidden')
    setVisibility('visible')
    vi.advanceTimersByTime(FILE_PICK_SETTLE_MS / 2)
    setVisibility('hidden')
    vi.advanceTimersByTime(FILE_PICK_SETTLE_MS * 2)
    expect(held()).toBe(true)
    endFilePick()
  })

  it('a second click replaces the first without leaking a hold', () => {
    beginFilePick()
    beginFilePick()
    endFilePick()
    settle()
    expect(held()).toBe(false)
  })

  it('never-ending pick expires', () => {
    beginFilePick()
    vi.advanceTimersByTime(FILE_PICK_MAX_MS + HOLD_GRACE_MS + 1)
    expect(held()).toBe(false)
  })

  it('endFilePick without a pick is a no-op', () => {
    endFilePick()
    expect(held()).toBe(false)
  })

  it('nests with another hold', () => {
    const camera = holdAppLock()
    beginFilePick()
    endFilePick()
    settle()
    expect(held()).toBe(true)
    camera()
  })
})

describe('call suspension', () => {
  it('suspends the lock while a call is active and notifies listeners', () => {
    const seen: boolean[] = []
    const off = onCallActiveChange(a => seen.push(a))
    expect(lockSuspended(Date.now())).toBe(false)
    setCallActive(true)
    setCallActive(true)
    expect(lockSuspended(Date.now())).toBe(true)
    setCallActive(false)
    expect(lockSuspended(Date.now())).toBe(false)
    off()
    setCallActive(true)
    expect(seen).toEqual([true, false])
  })
})
