/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public backend HTTP origin (e.g. https://iris-backend.example.com). Empty for same-origin (dev/Docker). */
  readonly VITE_API_BASE_URL?: string;
  /** Public backend WS origin (e.g. wss://iris-backend.example.com). Falls back to VITE_API_BASE_URL with http→ws. */
  readonly VITE_WS_BASE_URL?: string;
  /** Public web URL for invite links/QR (e.g. https://iris-chat-web.vercel.app). */
  readonly VITE_PUBLIC_APP_URL?: string;
  /** "true" when the Android build includes google-services.json (enables FCM push). */
  readonly VITE_ANDROID_PUSH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
