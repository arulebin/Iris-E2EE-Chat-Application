import { Capacitor } from "@capacitor/core";

// Public backend HTTP origin. Set VITE_API_BASE_URL on Vercel to your tunnel URL.
// Empty string means relative paths — same-origin via Vite proxy in dev or nginx in Docker.
export const apiBase: string =
  (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

/**
 * Public web address used in invite links and QR codes. In the Android app the
 * page origin is https://localhost, which would send recipients to their own
 * phone — so native builds default to the hosted site. Override with VITE_PUBLIC_APP_URL.
 */
export const publicAppUrl: string = (
  import.meta.env.VITE_PUBLIC_APP_URL ??
  (Capacitor.isNativePlatform() || typeof location === "undefined"
    ? "https://iris-chat-web.vercel.app"
    : location.origin)
).replace(/\/$/, "");

/**
 * Build a fully-qualified WebSocket URL.
 * Priority:
 *   1. VITE_WS_BASE_URL if set (e.g. wss://iris-backend.example.com)
 *   2. Derived from VITE_API_BASE_URL (swap http→ws)
 *   3. Derived from window.location (relative — only useful when same-origin)
 */
export function wsURL(path: string): string {
  const explicit = import.meta.env.VITE_WS_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "") + path;
  if (apiBase) return apiBase.replace(/^http/, "ws") + path;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${path}`;
}
