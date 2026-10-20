// Back from the app's root screen (the chat list) must put Iris in the background like WhatsApp does, not
// finish the activity: finishing tears the React context down, so the next launch is a cold start, and an
// app opened from a notification (whose task root is not a launcher intent) is even finished on Android 12+.
// React Native calls invokeDefaultOnBackPressed() only when JS did not handle back (no screen to pop, no
// sheet / modal / viewer open), so this is exactly "back on the root screen".
//
// The Expo template already moves the task back, but only up to Android 11 (R); this makes it unconditional.
const { withMainActivity } = require('expo/config-plugins')

const MARKER = '// iris: back on the root screen backgrounds the app'

const KOTLIN_METHOD = `  ${MARKER}
  override fun invokeDefaultOnBackPressed() {
      // moveTaskToBack() returns false when this activity is not the task's root; only then finish it.
      if (!moveTaskToBack(false)) {
          super.invokeDefaultOnBackPressed()
      }
  }`

/** Pure transform of MainActivity.kt (exported for tests). */
function patchMainActivity(src) {
  if (src.includes(MARKER)) return src
  // Replace the template's override (with its KDoc, if any) …
  const existing = /(\s*\/\*\*(?:(?!\*\/)[\s\S])*?\*\/\s*)?\n\s*override fun invokeDefaultOnBackPressed\(\)\s*\{/m
  const m = existing.exec(src)
  if (m) {
    const start = m.index
    let i = src.indexOf('{', start + m[0].length - 1)
    let depth = 0
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}' && --depth === 0) break
    }
    if (depth !== 0) throw new Error('withBackToBackground: could not parse invokeDefaultOnBackPressed')
    return src.slice(0, start) + '\n\n' + KOTLIN_METHOD + src.slice(i + 1)
  }
  // … or add it before the class's closing brace.
  const end = src.lastIndexOf('}')
  if (end < 0) throw new Error('withBackToBackground: MainActivity has no class body')
  return src.slice(0, end).replace(/\s*$/, '') + '\n\n' + KOTLIN_METHOD + '\n}\n'
}

function withBackToBackground(config) {
  return withMainActivity(config, cfg => {
    if (cfg.modResults.language !== 'kt') throw new Error('withBackToBackground: expected a Kotlin MainActivity')
    cfg.modResults.contents = patchMainActivity(cfg.modResults.contents)
    return cfg
  })
}

module.exports = withBackToBackground
module.exports.patchMainActivity = patchMainActivity
