import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { withAppLockHold } from "./appLockGuard";
import { apiBase, publicAppUrl } from "./config";
import { inviteUrl as coreInviteUrl } from "@iris/core";
import type { UserProfile } from "../types";

// Code normalisation / formatting is shared in @iris/core; the link builder binds the
// web's public URL, and the sharing + API calls stay here.
export { formatInviteCode, isLegacyShareId, normalizeInviteCode } from "@iris/core";

export function inviteUrl(code: string): string {
  return coreInviteUrl(code, publicAppUrl);
}

/** Android share sheet → Web Share API → clipboard. Resolves to what happened. */
export async function shareInvite(url: string): Promise<"shared" | "copied" | "cancelled"> {
  const text = "Add me on Iris — private, end-to-end encrypted chat";
  try {
    if (Capacitor.isNativePlatform()) {
      await withAppLockHold(() => Share.share({ title: "Add me on Iris", text, url, dialogTitle: "Share invite" }));
      return "shared";
    }
    if (navigator.share) {
      await withAppLockHold(() => navigator.share({ title: "Add me on Iris", text, url }));
      return "shared";
    }
  } catch (err) {
    // User closed the sheet — not an error worth surfacing.
    if (err instanceof Error && /cancel|abort/i.test(err.name + err.message)) return "cancelled";
  }
  await navigator.clipboard.writeText(url);
  return "copied";
}

export type InviteLookup =
  | { ok: true; profile: UserProfile }
  | { ok: false; reason: "not-found" | "rate-limited" | "error" };

export async function lookupInvite(code: string, token: string): Promise<InviteLookup> {
  try {
    const res = await fetch(`${apiBase}/api/users/by-invite/${encodeURIComponent(code)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return { ok: true, profile: await res.json() };
    if (res.status === 429) return { ok: false, reason: "rate-limited" };
    return { ok: false, reason: "not-found" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** Sends a connection request via an invite code. Returns an error message, or null on success. */
export async function requestByInvite(code: string, token: string): Promise<string | null> {
  const res = await fetch(`${apiBase}/api/friends/request`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ toInviteCode: code }),
  });
  if (res.ok) return null;
  if (res.status === 429) return "Too many attempts — try again in a few minutes.";
  if (res.status === 409) return "You've blocked this person. Unblock them in Settings first.";
  if (res.status === 404) return "That invite is no longer valid.";
  return "Couldn't send the request.";
}
