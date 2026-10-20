import { PushNotifications } from '@capacitor/push-notifications'
import { apiBase } from './config'

// Android app push via Firebase Cloud Messaging. Android WebViews have no Web
// Push, so the native shell registers an FCM token instead and the backend
// fans notifications out to both kinds. Payloads stay generic ("New message" /
// "Incoming call") — no sender or content ever reaches Google's servers.

const TOKEN_KEY = 'iris-fcm-token'

function readStoredToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

function writeStoredToken(value: string | null) {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* storage unavailable — we just re-register next time */ }
}

// Channel ids must match what the backend puts in AndroidNotification.channelId.
async function ensureChannels() {
  await PushNotifications.createChannel({
    id: 'messages',
    name: 'Messages',
    description: 'New message alerts',
    importance: 4,     // high: heads-up
    visibility: 0,     // private: generic text on the lock screen
    vibration: true,
  })
  await PushNotifications.createChannel({
    id: 'calls',
    name: 'Calls',
    description: 'Incoming voice and video calls',
    importance: 5,     // max
    visibility: 0,
    vibration: true,
  })
}

// Resolves with the FCM token from the next 'registration' event.
function nextRegistrationToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const handles: Array<Promise<{ remove: () => Promise<void> }>> = []
    const cleanup = () => handles.forEach((h) => h.then((x) => x.remove()))
    handles.push(PushNotifications.addListener('registration', (t) => { cleanup(); resolve(t.value) }))
    handles.push(PushNotifications.addListener('registrationError', (e) => {
      cleanup()
      reject(new Error(e.error || 'Push registration failed'))
    }))
  })
}

// Without google-services.json in the APK, PushNotifications.register() crashes
// the app (FirebaseApp isn't initialised), so builds opt in explicitly.
const FCM_CONFIGURED = import.meta.env.VITE_ANDROID_PUSH === 'true'

export async function enableNativeNotifications(authToken: string): Promise<void> {
  if (!FCM_CONFIGURED) {
    throw new Error("Notifications aren't set up in this build (Firebase config missing)")
  }
  let perm = await PushNotifications.checkPermissions()
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await PushNotifications.requestPermissions()
  }
  if (perm.receive !== 'granted') throw new Error(`Permission ${perm.receive}`)

  await ensureChannels()
  const tokenPromise = nextRegistrationToken()
  await PushNotifications.register()
  const fcmToken = await tokenPromise

  const res = await fetch(`${apiBase}/api/push/fcm-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ token: fcmToken }),
  })
  if (!res.ok) throw new Error('Failed to register device for notifications')
  writeStoredToken(fcmToken)
}

export async function hasNativeRegistration(): Promise<boolean> {
  if (!readStoredToken()) return false
  const perm = await PushNotifications.checkPermissions()
  return perm.receive === 'granted'
}

/** Called on logout so this device stops receiving the account's alerts. */
export async function disableNativeNotifications(authToken: string): Promise<void> {
  const fcmToken = readStoredToken()
  writeStoredToken(null)
  if (fcmToken) {
    await fetch(`${apiBase}/api/push/fcm-token`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ token: fcmToken }),
    }).catch(() => { /* best effort — the server also prunes dead tokens */ })
  }
  await PushNotifications.unregister().catch(() => {})
}
