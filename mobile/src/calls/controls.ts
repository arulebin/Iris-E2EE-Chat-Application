// Pure call-screen rules (no React Native imports, unit tested in controls.test.ts):
// when the controls of a video call hide by themselves, and when the system picture-in-picture
// window may be used.
import type { CallSnapshot } from './engine'

export const CONTROLS_HIDE_MS = 4000

type Timers = {
  set(cb: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: Timers = {
  set: (cb, ms) => setTimeout(cb, ms),
  clear: h => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/**
 * Visibility of the call controls. With auto-hide on (a video call showing video), they hide after
 * `delayMs` without interaction; tapping the video shows them again (and restarts the timer), tapping it
 * while they are shown hides them at once. Any control used counts as interaction. With auto-hide off
 * (voice call, ringing, no video on screen) they are always shown.
 */
export function createControlsAutoHide(onChange: (visible: boolean) => void, delayMs = CONTROLS_HIDE_MS, timers: Timers = realTimers) {
  let visible = true
  let enabled = false
  let handle: unknown = null

  const set = (v: boolean) => {
    if (v === visible) return
    visible = v
    onChange(v)
  }
  const disarm = () => {
    if (handle != null) timers.clear(handle)
    handle = null
  }
  const arm = () => {
    disarm()
    if (enabled) handle = timers.set(() => { handle = null; set(false) }, delayMs)
  }

  return {
    get visible() { return visible },
    /** Auto-hide allowed right now. Turning it off shows the controls and stops the timer. */
    setEnabled(on: boolean) {
      if (on === enabled) return
      enabled = on
      if (on) arm()
      else { disarm(); set(true) }
    },
    /** Tap on the video: toggle (show + restart the timer, or hide now). */
    tap() {
      if (enabled && visible) { disarm(); set(false); return }
      set(true)
      arm()
    },
    /** A control was used: keep them shown for another full delay. */
    interact() {
      set(true)
      arm()
    },
    dispose: disarm,
  }
}

/** Controls hide only in an active video call that is showing video (never in voice calls or while ringing). */
export function controlsAutoHideWanted(s: Pick<CallSnapshot, 'state'>, videoOnScreen: boolean): boolean {
  return s.state.kind === 'active' && s.state.mode === 'video' && videoOnScreen
}

/**
 * Android picture-in-picture is armed (home gesture / minimise enter it) only during an active video call.
 * Outside a call — or in a voice call, which has nothing to show in a small window — going home must leave
 * the app normally.
 */
export function pipWanted(s: Pick<CallSnapshot, 'state'>): boolean {
  return s.state.kind === 'active' && s.state.mode === 'video'
}

/** What the call screen's minimise button does: the system PiP window for video calls, else the in-app window. */
export function minimiseTarget(s: Pick<CallSnapshot, 'state'>, pipAvailable: boolean): 'pip' | 'in-app' {
  return pipAvailable && pipWanted(s) ? 'pip' : 'in-app'
}
