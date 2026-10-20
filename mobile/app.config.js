// Build-time overrides on top of app.json (kept tiny on purpose).
//   IRIS_OTA_CHANNEL=staging   -> binary polls the "staging" update channel
//   IRIS_DISTRIBUTION=play     -> binary is Play-installed: no APK-download prompt
module.exports = ({ config }) => {
  const channel = process.env.IRIS_OTA_CHANNEL
  if (channel) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(channel)) throw new Error('invalid IRIS_OTA_CHANNEL')
    config.updates = {
      ...config.updates,
      requestHeaders: { ...(config.updates && config.updates.requestHeaders), 'expo-channel-name': channel },
    }
  }
  const distribution = process.env.IRIS_DISTRIBUTION
  if (distribution) {
    if (distribution !== 'play' && distribution !== 'sideload') throw new Error('IRIS_DISTRIBUTION must be play|sideload')
    config.extra = { ...config.extra, iris: { ...(config.extra && config.extra.iris), distribution } }
  }
  return config
}
