// Iris service worker — caching + push notifications

// Stamped with a fresh id by the Vite build (see vite.config.ts), so every deploy
// gets its own cache and activation drops the previous deploy's assets.
const CACHE_VERSION = 'iris-__BUILD_ID__'

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/iris-icon.svg',
  '/icon-192.png',
]

// ── lifecycle ────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  console.log('[SW] install')
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  console.log('[SW] activate')
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// ── caching ──────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  if (req.method !== 'GET') return

  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/ws/')) {
    return
  }

  if (url.origin !== self.location.origin) return

  // Network-first for HTML navigations. Each successful load refreshes the cached
  // shell, so the offline fallback always references assets of the current deploy
  // (a stale index.html would point at hashed bundles that were never cached).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE_VERSION).then((cache) => cache.put('/index.html', copy))
        }
        return res
      }).catch(() => caches.match('/index.html').then(r => r || Response.error()))
    )
    return
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy))
        }
        return res
      })
    })
  )
})

// ── push notifications ───────────────────────────────────────────

self.addEventListener('push', (event) => {
  let data = { title: 'Iris', body: 'New message' }
  try {
    if (event.data) data = event.data.json()
  } catch { /* keep defaults */ }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Iris', {
      body:     data.body || '',
      icon:     '/icon-192.png',
      badge:    '/favicon-32.png',
      tag:      'iris-message',
      renotify: true,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const c of clients) {
        if (c.url.includes(self.location.origin) && 'focus' in c) {
          return c.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow('/')
    })
  )
})
