import { Capacitor } from '@capacitor/core'

// Invite links must point at the public web app. In the Android app the page
// origin is https://localhost, which would send the recipient to their OWN phone.
const DEFAULT_PUBLIC_URL = 'https://iris-chat-web.vercel.app'

export function publicAppUrl(): string {
  const configured = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined
  if (configured) return configured.replace(/\/$/, '')
  return Capacitor.isNativePlatform() ? DEFAULT_PUBLIC_URL : window.location.origin
}

export const groupInviteUrl = (token: string) => `${publicAppUrl()}/?group=${encodeURIComponent(token)}`

/** The `?group=<token>` an invite link opened the app with, if any. */
export function inviteTokenFromLocation(search: string = window.location.search): string | null {
  const t = new URLSearchParams(search).get('group')
  return t && /^[A-Za-z0-9_-]{16,64}$/.test(t) ? t : null
}
