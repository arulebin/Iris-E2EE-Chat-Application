import { MEDIA_CRYPTO_OVERHEAD } from "./crypto/account.ts";

// 50MB cap matches the backend's MediaController.MAX_BYTES. That limit applies to
// the uploaded *ciphertext*, so the plaintext cap leaves room for the IV + GCM tag.
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
export const MAX_PLAINTEXT_BYTES = MAX_MEDIA_BYTES - MEDIA_CRYPTO_OVERHEAD;

// ── encrypted media envelope ─────────────────────────────────────
// A media message's `content` is encryptMessage(JSON.stringify(envelope)), so the
// blob key and real type are protected by the same E2E layer as text messages.

export type MediaEnvelope = {
  iris: "media";
  v: 1;
  key: string;     // base64 raw AES-256-GCM key
  mime: string;    // real MIME type, e.g. "video/mp4"
  caption: string;
};

export function buildMediaEnvelope(key: string, mime: string, caption = ""): string {
  const envelope: MediaEnvelope = { iris: "media", v: 1, key, mime, caption };
  return JSON.stringify(envelope);
}

/** Returns the envelope if `plaintext` is one, else null (e.g. an old plain caption). */
export function parseMediaEnvelope(plaintext: string): MediaEnvelope | null {
  if (!plaintext.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(plaintext) as Partial<MediaEnvelope>;
    if (parsed.iris !== "media" || typeof parsed.key !== "string") return null;
    return {
      iris: "media",
      v: 1,
      key: parsed.key,
      mime: typeof parsed.mime === "string" ? parsed.mime : "application/octet-stream",
      caption: typeof parsed.caption === "string" ? parsed.caption : "",
    };
  } catch {
    return null;
  }
}
