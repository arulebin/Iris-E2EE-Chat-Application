import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { patchMainActivity } = require('./withPipModeCallback.js')
const { patchMainActivity: patchBack } = require('./withBackToBackground.js')

const TEMPLATE = `package com.iris.chat.mobile

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "main"
}
`

describe('PiP mode callback', () => {
  it('forwards onPictureInPictureModeChanged to the calls module', () => {
    const out = patchMainActivity(TEMPLATE)
    expect(out).toMatch(/override fun onPictureInPictureModeChanged\(isInPictureInPictureMode: Boolean, newConfig: android\.content\.res\.Configuration\)/)
    expect(out).toMatch(/super\.onPictureInPictureModeChanged\(isInPictureInPictureMode, newConfig\)\s*com\.iris\.calls\.PipState\.changed\(isInPictureInPictureMode\)/)
    expect(out.split('{').length).toBe(out.split('}').length)
    expect(out.trim().endsWith('}')).toBe(true)
    expect(patchMainActivity(out)).toBe(out)
  })

  it('composes with the back-to-background patch in either order', () => {
    const a = patchMainActivity(patchBack(TEMPLATE))
    const b = patchBack(patchMainActivity(TEMPLATE))
    for (const out of [a, b]) {
      expect(out.match(/override fun onPictureInPictureModeChanged/g)).toHaveLength(1)
      expect(out.match(/override fun invokeDefaultOnBackPressed/g)).toHaveLength(1)
      expect(out.split('{').length).toBe(out.split('}').length)
    }
  })

  it('is registered in app.json', () => {
    const app = JSON.parse(readFileSync(fileURLToPath(new URL('../app.json', import.meta.url)), 'utf8'))
    expect(app.expo.plugins).toContain('./plugins/withPipModeCallback')
  })
})
