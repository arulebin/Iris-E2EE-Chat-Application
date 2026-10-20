import { describe, expect, it } from 'vitest'
import { MAIN_STACK_SETTINGS } from './stack'

describe('main stack', () => {
  it('always has the chat list at the bottom, also under deep-linked screens', () => {
    expect(MAIN_STACK_SETTINGS.initialRouteName).toBe('index')
  })
})
