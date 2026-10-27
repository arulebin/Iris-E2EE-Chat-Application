// Picture-in-picture entered / left is only reported to the Activity (onPictureInPictureModeChanged); Expo's
// activity lifecycle listeners have no such hook. Forward it to the iris-calls module (com.iris.calls.PipState),
// which tells JS so the PiP window draws only the call and expanding it returns to the call screen.
const { withMainActivity } = require('expo/config-plugins')

const MARKER = '// iris: forward picture-in-picture changes to the calls module'

const KOTLIN_METHOD = `  ${MARKER}
  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: android.content.res.Configuration) {
      super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
      com.iris.calls.PipState.changed(isInPictureInPictureMode)
  }`

/** Pure transform of MainActivity.kt (exported for tests): adds the override before the class's closing brace. */
function patchMainActivity(src) {
  if (src.includes(MARKER)) return src
  if (/override fun onPictureInPictureModeChanged\(/.test(src)) {
    throw new Error('withPipModeCallback: MainActivity already overrides onPictureInPictureModeChanged')
  }
  const end = src.lastIndexOf('}')
  if (end < 0) throw new Error('withPipModeCallback: MainActivity has no class body')
  return src.slice(0, end).replace(/\s*$/, '') + '\n\n' + KOTLIN_METHOD + '\n}\n'
}

function withPipModeCallback(config) {
  return withMainActivity(config, cfg => {
    if (cfg.modResults.language !== 'kt') throw new Error('withPipModeCallback: expected a Kotlin MainActivity')
    cfg.modResults.contents = patchMainActivity(cfg.modResults.contents)
    return cfg
  })
}

module.exports = withPipModeCallback
module.exports.patchMainActivity = patchMainActivity
