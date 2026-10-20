import type { KV } from '@iris/core'

/** The slice of expo-notifications we use (injectable for tests). */
export interface NotificationsLike {
  getPermissionsAsync(): Promise<{ status: string }>
  requestPermissionsAsync(): Promise<{ status: string }>
  getDevicePushTokenAsync(): Promise<{ type: string; data: unknown }>
  setNotificationChannelAsync(id: string, cfg: Record<string, unknown>): Promise<unknown>
  addPushTokenListener?(cb: (t: { data: unknown }) => void): { remove(): void }
}

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>

const TOKEN_KEY = 'push.fcm-token'
/** Lets the backend send this app data-only call pushes (legacy clients omit it and get notifications). */
export const APP_ID = 'com.iris.chat.mobile'

// Channel ids must match what the backend puts in AndroidNotification.channelId.
export async function ensureChannels(n: NotificationsLike, importance: { HIGH: number; MAX: number }) {
  await n.setNotificationChannelAsync('messages', {
    name: 'Messages',
    description: 'New message alerts',
    importance: importance.HIGH,
    lockscreenVisibility: 0, // private: generic text on the lock screen
    vibrationPattern: [0, 250, 250, 250],
  })
  await n.setNotificationChannelAsync('calls', {
    name: 'Calls',
    description: 'Incoming voice and video calls',
    importance: importance.MAX,
    lockscreenVisibility: 0,
    vibrationPattern: [0, 250, 250, 250],
  })
}

/**
 * FCM registration. Payloads stay generic; no sender or content reaches Google. Registers the
 * raw FCM token (getDevicePushTokenAsync, not an Expo push token) with POST /api/push/fcm-token,
 * exactly like frontend/src/lib/nativePush.ts.
 */
export function createPush(deps: {
  notifications: NotificationsLike
  importance: { HIGH: number; MAX: number }
  /** Authed fetch bound to the API base URL. */
  fetch: Fetcher
  kv: KV
  isDevice?: boolean
}) {
  const send = async (token: string) => {
    const res = await deps.fetch('/api/push/fcm-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, app: APP_ID }),
    })
    if (!res.ok) throw new Error('Failed to register device for notifications')
    await deps.kv.set(TOKEN_KEY, token)
  }
  return {
    async enable(): Promise<string> {
      if (deps.isDevice === false) throw new Error('Push needs a physical device')
      let perm = await deps.notifications.getPermissionsAsync()
      if (perm.status !== 'granted') perm = await deps.notifications.requestPermissionsAsync()
      if (perm.status !== 'granted') throw new Error(`Permission ${perm.status}`)
      await ensureChannels(deps.notifications, deps.importance)
      const t = await deps.notifications.getDevicePushTokenAsync()
      const token = String(t.data)
      await send(token)
      return token
    },
    /** Re-register when FCM rotates the token. Returns an unsubscribe. */
    watchRotation(): () => void {
      const sub = deps.notifications.addPushTokenListener?.(t => {
        void send(String(t.data)).catch(() => {})
      })
      return () => sub?.remove()
    },
    async isRegistered(): Promise<boolean> {
      if (!(await deps.kv.get<string>(TOKEN_KEY))) return false
      return (await deps.notifications.getPermissionsAsync()).status === 'granted'
    },
    /** Logout: stop receiving this account's alerts (best effort; the server also prunes dead tokens). */
    async disable(): Promise<void> {
      const token = await deps.kv.get<string>(TOKEN_KEY)
      await deps.kv.delete(TOKEN_KEY)
      if (token) {
        await deps
          .fetch('/api/push/fcm-token', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          })
          .catch(() => {})
      }
    },
  }
}
