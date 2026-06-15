import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { initTheme } from './lib/theme'

initTheme()

// Register the service worker (the brain that powers offline + push).
// Browsers ignore this if 'serviceWorker' isn't supported (very rare).
if ('serviceWorker' in navigator) {
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
      <App />
    </BrowserRouter>
  </StrictMode>,
)
