import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { disableBackup } = require('./withNoAndroidBackup.js')

const manifest = (appAttrs = {}) => ({ manifest: { $: {}, application: [{ $: { 'android:allowBackup': 'true', ...appAttrs } }] } })

describe('withNoAndroidBackup', () => {
  it('turns backup off and overrides library manifests', () => {
    const out = disableBackup(manifest())
    expect(out.manifest.application[0].$['android:allowBackup']).toBe('false')
    expect(out.manifest.application[0].$['tools:replace']).toBe('android:allowBackup')
    expect(out.manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools')
  })

  it('keeps existing tools:replace entries and is idempotent', () => {
    const once = disableBackup(manifest({ 'tools:replace': 'android:label' }))
    const twice = disableBackup(once)
    expect(twice.manifest.application[0].$['tools:replace']).toBe('android:label,android:allowBackup')
  })
})
