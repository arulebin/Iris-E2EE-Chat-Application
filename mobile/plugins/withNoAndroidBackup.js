// Iris keeps message history, Signal sessions and wrapped keys in app storage. Android's auto backup would
// copy that storage to the user's Google account, so it stays off (the Capacitor app did the same).
// `android.allowBackup: false` in app.json alone fails the manifest merge, because a dependency
// (TAndroidLame, used for voice notes) declares allowBackup="true"; tools:replace makes ours win.
const { withAndroidManifest } = require('expo/config-plugins')

/** Pure transform of the parsed manifest (exported for tests). */
function disableBackup(manifest) {
  manifest.manifest.$['xmlns:tools'] = manifest.manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools'
  const app = manifest.manifest.application[0]
  app.$['android:allowBackup'] = 'false'
  const replace = new Set((app.$['tools:replace'] || '').split(',').map(s => s.trim()).filter(Boolean))
  replace.add('android:allowBackup')
  app.$['tools:replace'] = [...replace].join(',')
  return manifest
}

module.exports = config => withAndroidManifest(config, cfg => {
  cfg.modResults = disableBackup(cfg.modResults)
  return cfg
})
module.exports.disableBackup = disableBackup
