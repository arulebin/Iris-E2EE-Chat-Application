import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.tsx'
import { AppLock } from './components/AppLock.tsx'
import { initTheme } from './lib/theme'
import { initScreenSecurity } from './lib/screenSecurity'

initTheme()
initScreenSecurity()

// Register the service worker (the brain that powers offline + push).
// Browsers ignore this if 'serviceWorker' isn't supported (very rare).
// Skipped in the native app: the bundle ships inside the APK, and Android
// WebViews have no Web Push, so a SW would only serve stale cached code.
if ('serviceWorker' in navigator && !Capacitor.isNativePlatform()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('[SW] registered, scope:', reg.scope))
      .catch((err) => console.error('[SW] registration failed:', err))
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppLock>
        <App />
      </AppLock>
    </BrowserRouter>
  </StrictMode>,
)
