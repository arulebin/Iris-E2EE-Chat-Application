// Plain JS (outside the app's tsconfig, which has no Node types): the config plugin and the route files.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const root = p => fileURLToPath(new URL(`../${p}`, import.meta.url))
const { patchMainActivity } = require('./withBackToBackground.js')

// The Expo SDK 58 template's MainActivity (trimmed to what matters).
const TEMPLATE = `package com.iris.chat.mobile

import android.os.Build
import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  /**
   * Returns the name of the main component registered from JavaScript.
   */
  override fun getMainComponentName(): String = "main"

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
`

describe('back navigation', () => {
  it('keeps the chat list under deep-linked screens of the main stack', () => {
    expect(existsSync(root('app/(main)/index.tsx'))).toBe(true)
    expect(readFileSync(root('app/(main)/_layout.tsx'), 'utf8')).toMatch(/export const unstable_settings = MAIN_STACK_SETTINGS/)
  })

  it('backgrounds the app on every Android version when back reaches the root', () => {
    const out = patchMainActivity(TEMPLATE)
    expect(out).not.toContain('Build.VERSION.SDK_INT <= Build.VERSION_CODES.R')
    expect(out.match(/override fun invokeDefaultOnBackPressed/g)).toHaveLength(1)
    expect(out).toMatch(/if \(!moveTaskToBack\(false\)\) \{\s*super\.invokeDefaultOnBackPressed\(\)\s*\}/)
    expect(out).toContain('override fun getMainComponentName(): String = "main"')
    expect(out.trim().endsWith('}')).toBe(true)
    // Balanced braces and idempotent.
    expect(out.split('{').length).toBe(out.split('}').length)
    expect(patchMainActivity(out)).toBe(out)
  })

  it('adds the override when the template has none', () => {
    const bare = 'class MainActivity : ReactActivity() {\n  override fun getMainComponentName(): String = "main"\n}\n'
    const out = patchMainActivity(bare)
    expect(out).toMatch(/override fun invokeDefaultOnBackPressed\(\) \{\s*\/\/[^\n]*\n\s*if \(!moveTaskToBack\(false\)\)/)
    expect(out.split('{').length).toBe(out.split('}').length)
  })
})
