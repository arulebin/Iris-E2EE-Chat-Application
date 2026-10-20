// Config plugin for the iris-calls native module: MainActivity must opt in to
// picture-in-picture and keep running through the PiP resize.
const { withAndroidManifest } = require('expo/config-plugins')

module.exports = function withIrisCalls(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0]
    const main = app?.activity?.find((a) => a.$['android:name'] === '.MainActivity')
    if (main) {
      main.$['android:supportsPictureInPicture'] = 'true'
      const changes = new Set((main.$['android:configChanges'] ?? '').split('|').filter(Boolean))
      for (const c of ['screenSize', 'smallestScreenSize', 'screenLayout', 'orientation']) changes.add(c)
      main.$['android:configChanges'] = [...changes].join('|')
    }
    return cfg
  })
}
