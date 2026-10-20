import { AuthExpiredError, createSessionClient } from "@iris/core";
import { apiBase } from "./config";

// Session tokens + the one fetch everything API-bound goes through. The logic
// (refresh rotation, 401 retry, cross-tab lock, 409 handling) is shared in
// @iris/core/session; this file binds it to the browser: tokens in localStorage,
// refresh serialised with Web Locks, and a window event when the login is over.

export const AUTH_EXPIRED_EVENT = "iris:auth-expired";

export { AuthExpiredError };

// Looked up per call (not captured) so the globals can be absent or stubbed.
const client = createSessionClient({
  apiBase,
  store: {
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v),
    removeItem: (k) => localStorage.removeItem(k),
  },
  getLocks: () => (typeof navigator !== "undefined" ? navigator.locks : null),
  onExpired: () => window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT)),
});

export const getAccessToken = client.getAccessToken;
export const getRefreshToken = client.getRefreshToken;
export const setSession = client.setSession;
export const clearSession = client.clearSession;
export const setSessionDevice = client.setSessionDevice;
export const refreshAccessToken = client.refreshAccessToken;
export const ensureFreshToken = client.ensureFreshToken;
export const apiFetch = client.apiFetch;
export const logoutSession = client.logoutSession;
