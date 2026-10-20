import { useEffect, useState } from "react";
import { apiBase } from "./config";
import { apiFetch } from "./api";

// Profile pictures require the JWT, so <img src> can't load them directly.
// Fetch once per filename with the token and hand out a shared object URL.
const cache = new Map<string, Promise<string>>();

function fetchProfileObjectURL(filename: string, token: string): Promise<string> {
  const hit = cache.get(filename);
  if (hit) return hit;
  const promise = apiFetch(`${apiBase}/api/media/profile/${encodeURIComponent(filename)}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(async (res) => {
    if (!res.ok) throw new Error(`Profile image fetch failed: ${res.status}`);
    return URL.createObjectURL(await res.blob());
  });
  promise.catch(() => cache.delete(filename)); // allow a retry after a failure
  cache.set(filename, promise);
  return promise;
}

/** Resolve an avatarUrl (absolute URL or stored filename) to something <img> can display. */
export function useProfileImage(avatarUrl: string | undefined | null): string | undefined {
  const isAbsolute = !!avatarUrl && /^(https?:|blob:|data:)/.test(avatarUrl);
  const [resolved, setResolved] = useState<string | undefined>(isAbsolute ? avatarUrl! : undefined);

  useEffect(() => {
    if (!avatarUrl) { setResolved(undefined); return; }
    if (isAbsolute) { setResolved(avatarUrl); return; }
    const token = localStorage.getItem("token");
    if (!token) { setResolved(undefined); return; }
    let cancelled = false;
    fetchProfileObjectURL(avatarUrl, token)
      .then((url) => { if (!cancelled) setResolved(url); })
      .catch(() => { if (!cancelled) setResolved(undefined); });
    return () => { cancelled = true; };
  }, [avatarUrl, isAbsolute]);

  return resolved;
}
