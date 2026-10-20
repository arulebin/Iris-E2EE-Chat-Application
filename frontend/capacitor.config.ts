import type { CapacitorConfig } from '@capacitor/cli'

// Native shell around the Vite build. The bundle is served from
// https://localhost inside the WebView, so the backend must be reached by an
// absolute URL — build with `npm run build:android`, which reads .env.android.
const config: CapacitorConfig = {
  appId: 'com.iris.chat',
  appName: 'Iris',
  webDir: 'dist',
  android: {
    // Never load the app over cleartext or mix in http content.
    allowMixedContent: false,
  },
}

export default config
