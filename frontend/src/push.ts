/**
 * Convert a URL-safe base64 string (VAPID format) to the Uint8Array
 * that PushManager.subscribe expects as `applicationServerKey`.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buffer = new ArrayBuffer(raw.length)              // explicit ArrayBuffer (not ArrayBufferLike)
  const out = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/**
 * Request notification permission, subscribe to push, upload to backend.
 * Resolves successfully only if the user granted permission AND we got a subscription
 * AND the backend accepted it.
 */
export async function enableNotifications(token: string): Promise<PushSubscription> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications are not supported in this browser')
  }

  // 1. Ask the user
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(`Permission ${permission}`)
  }

  // 2. Wait for service worker to be active and controlling
  const reg = await navigator.serviceWorker.ready

  // 3. Get the VAPID public key from our backend
  const keyRes = await fetch('/api/push/vapid-public-key', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!keyRes.ok) throw new Error('Failed to fetch VAPID public key')
  const vapidKey = await keyRes.text()

  // 4. Subscribe (or reuse an existing subscription)
  const existing = await reg.pushManager.getSubscription()
  const subscription = existing ?? await reg.pushManager.subscribe({
    userVisibleOnly: true,                                  // required by browsers
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  })

  // 5. Send subscription to backend (its toJSON() matches our DTO shape)
  const upRes = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(subscription.toJSON()),
  })
  if (!upRes.ok) throw new Error('Failed to upload subscription')

  return subscription
}

/**
 * Returns true if a PushSubscription already exists in the browser.
 * Used to decide whether to show the "Enable notifications" button.
 */
export async function hasExistingSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  return sub !== null
}
