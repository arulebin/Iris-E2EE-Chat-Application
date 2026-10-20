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

export function inviteUrl(code: string, publicAppUrl: string): string {
  return `${publicAppUrl}/?add=${encodeURIComponent(formatInviteCode(code))}`;
}
