import { describe, expect, it } from 'vitest'
import { mediaBackAction, shouldLeaveOrphanedMediaScreen, type MediaScreen } from './mediaBack'

describe('back in the media flow', () => {
  it('viewer closes itself back to the chat', () => {
    expect(mediaBackAction({ screen: 'viewer', canPopInFlow: false })).toBe('close-viewer')
    expect(mediaBackAction({ screen: 'viewer', canPopInFlow: true })).toBe('close-viewer')
  })

  it('preview goes back to the picker it came from, or to the chat', () => {
    expect(mediaBackAction({ screen: 'preview', canPopInFlow: true })).toBe('pop')
    expect(mediaBackAction({ screen: 'preview', canPopInFlow: false })).toBe('close-flow')
  })

  it('picker clears a selection before leaving', () => {
    expect(mediaBackAction({ screen: 'picker', canPopInFlow: false, selecting: true })).toBe('clear-selection')
    expect(mediaBackAction({ screen: 'picker', canPopInFlow: false })).toBe('close-flow')
    expect(mediaBackAction({ screen: 'picker', canPopInFlow: true })).toBe('pop') // opened from the camera
  })

  it('never leaves the app from any media screen', () => {
    for (const screen of ['camera', 'picker', 'preview', 'viewer'] as MediaScreen[]) {
      for (const canPopInFlow of [true, false]) {
        for (const selecting of [true, false]) {
          expect(['close-viewer', 'clear-selection', 'pop', 'close-flow']).toContain(mediaBackAction({ screen, canPopInFlow, selecting }))
        }
      }
    }
  })
})

describe('orphaned preview / viewer', () => {
  it('leaves once, only while focused and not already leaving', () => {
    expect(shouldLeaveOrphanedMediaScreen({ hasData: false, focused: true, leaving: false })).toBe(true)
    // After Send: the draft is discarded and the screen is already closing -> no second back.
    expect(shouldLeaveOrphanedMediaScreen({ hasData: false, focused: true, leaving: true })).toBe(false)
    // Re-render during the exit animation (no longer focused) -> no second back.
    expect(shouldLeaveOrphanedMediaScreen({ hasData: false, focused: false, leaving: false })).toBe(false)
    expect(shouldLeaveOrphanedMediaScreen({ hasData: true, focused: true, leaving: false })).toBe(false)
  })
})
