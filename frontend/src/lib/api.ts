import { apiBase } from "./config";
import { getTokenExpiryMs } from "./auth";

// Session tokens + the one fetch everything API-bound goes through.
//
// The access JWT is short-lived (1 h). A rotating refresh token renews it, so a
// login lasts until logout / 30 days idle instead of silently dying after an hour.
// Callers may still pass their own `Authorization` header (many do, from React
// state); apiFetch always replaces it with the freshest token, so a stale prop can
// never cause a 401.

const ACCESS_KEY = "token";
const REFRESH_KEY = "iris-refresh-token";
const DEVICE_KEY = "iris-session-device";
export const AUTH_EXPIRED_EVENT = "iris:auth-expired";

/** The login is over (refresh token missing, expired, revoked or reused). */
export class AuthExpiredError extends Error {
  constructor() {
    super("Your session has expired — please log in again");
    this.name = "AuthExpiredError";
  }
}

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function getAccessToken(): string | null { return read(ACCESS_KEY); }
export function getRefreshToken(): string | null { return read(REFRESH_KEY); }

export function setSession(token: string, refreshToken?: string | null): void {
  localStorage.setItem(ACCESS_KEY, token);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearSession(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(DEVICE_KEY);
}

/** Lets the server tie this login to its Signal device (removing the device logs it out). */
export function setSessionDevice(deviceId: number | null): void {
  if (deviceId == null) localStorage.removeItem(DEVICE_KEY);
  else localStorage.setItem(DEVICE_KEY, String(deviceId));
}

function expire(): never {
  clearSession();
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  throw new AuthExpiredError();
}

let inflight: Promise<string> | null = null;

/**
 * Single-flight refresh. Serialised across tabs with a Web Lock where available:
 * two tabs rotating the same refresh token would otherwise look like token theft.
 * Network failures throw a plain Error (stay logged in, retry later); only a
 * definitive server "no" ends the session.
 */
export function refreshAccessToken(): Promise<string> {
  inflight ??= (async () => {
    const before = getAccessToken();
    const run = () => doRefresh(before);
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    return locks ? locks.request("iris-refresh", run) : run();
  })().finally(() => { inflight = null; });
  return inflight;
}

async function doRefresh(accessBefore: string | null): Promise<string> {
  // Another tab may have refreshed while we waited for the lock.
  const current = getAccessToken();
  if (current && current !== accessBefore && isFresh(current)) return current;

  for (let attempt = 0; attempt < 2; attempt++) {
    const refreshToken = getRefreshToken();
    if (!refreshToken) expire();
    const deviceId = Number(read(DEVICE_KEY)) || undefined;
    const res = await fetch(`${apiBase}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken, deviceId }),
    });
    if (res.ok) {
      const data = (await res.json()) as { token: string; refreshToken: string };
      setSession(data.token, data.refreshToken);
      return data.token;
    }
    if (res.status === 409) {
      // Rotated moments ago (another tab/process). Use its result if it landed.
      await new Promise((r) => setTimeout(r, 750));
      const latest = getAccessToken();
      if (latest && latest !== accessBefore && isFresh(latest)) return latest;
      continue;
    }
    if (res.status === 401 || res.status === 400) expire();
    throw new Error(`Session refresh failed (${res.status})`);
  }
  throw new Error("Session refresh failed");
}

function isFresh(token: string, minValidityMs = 60_000): boolean {
  const exp = getTokenExpiryMs(token);
  return exp === null || exp - Date.now() > minValidityMs;
}

/**
 * A usable access token, refreshing first if it expires within a minute. Returns
 * null if there's no session. Throws AuthExpiredError if the login is over, or a
 * plain Error if the network is down (the current token is still worth trying).
 */
export async function ensureFreshToken(): Promise<string | null> {
  const token = getAccessToken();
  if (!token) return null;
  if (isFresh(token)) return token;
  if (!getRefreshToken()) return token; // pre-refresh login: use it until it fails
  return refreshAccessToken();
}

function withAuth(init: RequestInit | undefined, token: string | null): RequestInit {
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

/**
 * fetch() for API calls: attaches the freshest access token, and on a 401 refreshes
 * once and retries. Non-API URLs (e.g. Capacitor file paths) pass straight through.
 */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!url.includes("/api/")) return fetch(url, init);

  let token: string | null;
  try {
    token = await ensureFreshToken();
  } catch {
    token = getAccessToken();
  }
  const res = await fetch(url, withAuth(init, token));
  if (res.status !== 401 || !getRefreshToken()) return res;

  try {
    token = await refreshAccessToken();
  } catch {
    return res;
  }
  return fetch(url, withAuth(init, token));
}

/** Tell the server this login is over. Best effort; local state is cleared regardless. */
export async function logoutSession(): Promise<void> {
  const refreshToken = getRefreshToken();
  clearSession();
  if (!refreshToken) return;
  try {
    await fetch(`${apiBase}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      keepalive: true,
    });
  } catch {
    // offline: the token simply expires
  }
}
