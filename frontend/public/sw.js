// Iris service worker — caching + push notifications

const CACHE_VERSION = 'iris-v1'

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/iris-icon.svg',
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

  // Network-first for HTML navigations
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then(r => r || Response.error()))
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
      icon:     '/iris-icon.svg',
      badge:    '/iris-icon.svg',
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
