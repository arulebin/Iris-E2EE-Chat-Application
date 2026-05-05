// Iris service worker — Step PWA 2 (offline-capable shell)

const CACHE_VERSION = 'iris-v1'

// Files to grab on install. Just the app shell — JS bundles will be added
// to the cache lazily on first fetch.
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/iris-icon.svg',
]

self.addEventListener('install', (event) => {
  console.log('[SW] install')
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  console.log('[SW] activate')
  // Delete any old cache versions left over from previous SW versions.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  // Never cache non-GET (POST/PUT/DELETE/etc.) — let them go straight to network.
  if (req.method !== 'GET') return

  // Network-only for backend calls + WebSocket (don't pollute cache, don't serve stale).
  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/ws/')) {
    return  // returning without calling event.respondWith lets the browser do its default (network)
  }

  // Cross-origin requests (e.g. to localhost:8080) — let the browser handle them.
  if (url.origin !== self.location.origin) return

  // Network-first for HTML navigations: try fresh, fall back to cached shell offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then(r => r || Response.error()))
    )
    return
  }

  // ── push notifications ───────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'Iris', body: 'New message' }
  try {
    if (event.data) data = event.data.json()
  } catch { /* keep defaults */ }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Iris', {
      body:    data.body || '',
      icon:    '/iris-icon.svg',
      badge:   '/iris-icon.svg',
      tag:     'iris-message',     // collapses bursts of pushes into one
      renotify: true,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      // If a tab is already open, focus it
      for (const c of clients) {
        if (c.url.includes(self.location.origin) && 'focus' in c) {
          return c.focus()
        }
      }
      // Otherwise open a new one
      if (self.clients.openWindow) return self.clients.openWindow('/')
    })
  )
})

  // Cache-first for everything else (icons, manifest, static assets).
  // On a cache miss, fetch + populate the cache for next time.
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
