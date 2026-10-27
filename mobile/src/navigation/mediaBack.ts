/**
 * Back inside the media flow (app/media: camera, picker, preview, viewer). Every media screen handles back
 * itself and always consumes it, so back there can never fall through to MainActivity's "back on the root
 * screen" fallback (which puts Iris in the background): one step back inside the flow, else back to the chat.
 *
 *  - viewer  -> its close animation, then the chat
 *  - preview -> the picker / camera it came from, or the chat (system document picker)
 *  - picker  -> clears a multi-selection first; then the camera it came from, or the chat
 *  - camera  -> the picker it came from, or the chat
 */
export type MediaScreen = 'camera' | 'picker' | 'preview' | 'viewer'

export type MediaBackAction = 'close-viewer' | 'clear-selection' | 'pop' | 'close-flow'

export function mediaBackAction(o: {
  screen: MediaScreen
  /** Another media screen is under this one in the media stack. */
  canPopInFlow: boolean
  /** Picker only: items are selected. */
  selecting?: boolean
}): MediaBackAction {
  if (o.screen === 'viewer') return 'close-viewer'
  if (o.screen === 'picker' && o.selecting) return 'clear-selection'
  return o.canPopInFlow ? 'pop' : 'close-flow'
}

/**
 * A preview / viewer whose draft or session is gone (sent, or the process was restarted) leaves the flow once,
 * and only while it is the focused screen and not already leaving: otherwise the re-render during its own exit
 * animation fired a second back that popped the chat (and then the chat list) as well.
 */
export function shouldLeaveOrphanedMediaScreen(o: { hasData: boolean; focused: boolean; leaving: boolean }): boolean {
  return !o.hasData && o.focused && !o.leaving
}
