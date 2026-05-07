/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public backend HTTP origin (e.g. https://iris-backend.example.com). Empty for same-origin (dev/Docker). */
  readonly VITE_API_BASE_URL?: string;
  /** Public backend WS origin (e.g. wss://iris-backend.example.com). Falls back to VITE_API_BASE_URL with http→ws. */
  readonly VITE_WS_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
