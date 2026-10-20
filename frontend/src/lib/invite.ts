import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { apiBase, publicAppUrl } from "./config";
import type { UserProfile } from "../types";

// Invite codes are 10 Crockford-base32 chars, shown as XXXXX-XXXXX (see the
// backend's InviteCodes). The server is the authority; these helpers only tidy
// input and build links.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canonical code from typed text, a scanned QR or a full invite URL; null if it can't be one. */
export function normalizeInviteCode(input: string): string | null {
  let s = input.trim();
  const at = s.indexOf("add=");
  if (at >= 0) s = s.slice(at + 4).split("&")[0];
  let out = "";
  for (let c of s.toUpperCase()) {
    if (c === "-" || c === " ") continue;
    if (c === "O") c = "0";
    else if (c === "I" || c === "L") c = "1";
    if (!ALPHABET.includes(c)) return null;
    out += c;
  }
  return out.length === 10 ? out : null;
}

export function formatInviteCode(code: string): string {
  return code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

/** Old links carried the UUID share id; those still resolve for public profiles. */
export function isLegacyShareId(value: string): boolean {
  return UUID.test(value);
}

export function inviteUrl(code: string): string {
  return `${publicAppUrl}/?add=${encodeURIComponent(formatInviteCode(code))}`;
}

/** Android share sheet → Web Share API → clipboard. Resolves to what happened. */
export async function shareInvite(url: string): Promise<"shared" | "copied" | "cancelled"> {
  const text = "Add me on Iris — private, end-to-end encrypted chat";
  try {
    if (Capacitor.isNativePlatform()) {
      await Share.share({ title: "Add me on Iris", text, url, dialogTitle: "Share invite" });
      return "shared";
    }
    if (navigator.share) {
      await navigator.share({ title: "Add me on Iris", text, url });
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
