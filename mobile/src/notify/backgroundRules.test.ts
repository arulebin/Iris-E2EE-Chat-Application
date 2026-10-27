import { describe, expect, it } from 'vitest'
import { backgroundPromptNeeded, type BackgroundStatus } from './backgroundRules'

const st = (manufacturer: string, ignoring = false, autostart = false): BackgroundStatus => ({
  manufacturer, ignoringBatteryOptimizations: ignoring, hasAutostartSettings: autostart,
})

describe('background delivery prompt', () => {
  it('asks once on Xiaomi / OPPO style ROMs', () => {
    expect(backgroundPromptNeeded({ status: st('Xiaomi', false, true), notificationsOn: true, alreadyAsked: false })).toBe(true)
    expect(backgroundPromptNeeded({ status: st('OPPO'), notificationsOn: true, alreadyAsked: false })).toBe(true)
    expect(backgroundPromptNeeded({ status: st('xiaomi', false, true), notificationsOn: true, alreadyAsked: true })).toBe(false)
  })

  it('never on stock / AOSP builds', () => {
    expect(backgroundPromptNeeded({ status: st('Google'), notificationsOn: true, alreadyAsked: false })).toBe(false)
    expect(backgroundPromptNeeded({ status: st('samsung'), notificationsOn: true, alreadyAsked: false })).toBe(false)
  })

  it('not when notifications are off, the module is missing, or nothing is left to change', () => {
    expect(backgroundPromptNeeded({ status: st('xiaomi'), notificationsOn: false, alreadyAsked: false })).toBe(false)
    expect(backgroundPromptNeeded({ status: null, notificationsOn: true, alreadyAsked: false })).toBe(false)
    expect(backgroundPromptNeeded({ status: st('vivo', true, false), notificationsOn: true, alreadyAsked: false })).toBe(false)
  })
})
