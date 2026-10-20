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
  // Optional additive hints written by the mobile app (older clients ignore them):
  name?: string;   // original file name (documents)
  size?: number;   // plaintext bytes
  w?: number;      // pixel size, for the bubble's aspect ratio before download
  h?: number;
  dur?: number;    // video seconds
  bh?: string;     // BlurHash placeholder
};

/** The optional hints of an envelope (what ChatMessage.mediaMeta carries). */
export type MediaMeta = Pick<MediaEnvelope, "name" | "size" | "w" | "h" | "dur" | "bh">;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

export function mediaMetaOf(e: MediaEnvelope): MediaMeta | undefined {
  const meta: MediaMeta = {};
  if (e.name !== undefined) meta.name = e.name;
  if (e.size !== undefined) meta.size = e.size;
  if (e.w !== undefined) meta.w = e.w;
  if (e.h !== undefined) meta.h = e.h;
  if (e.dur !== undefined) meta.dur = e.dur;
  if (e.bh !== undefined) meta.bh = e.bh;
  return Object.keys(meta).length ? meta : undefined;
}

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
    const env: MediaEnvelope = {
      iris: "media",
      v: 1,
      key: parsed.key,
      mime: typeof parsed.mime === "string" ? parsed.mime : "application/octet-stream",
      caption: typeof parsed.caption === "string" ? parsed.caption : "",
    };
    if (typeof parsed.name === "string") env.name = parsed.name;
    const size = num(parsed.size); if (size !== undefined) env.size = size;
    const w = num(parsed.w); if (w !== undefined) env.w = w;
    const h = num(parsed.h); if (h !== undefined) env.h = h;
    const dur = num(parsed.dur); if (dur !== undefined) env.dur = dur;
    if (typeof parsed.bh === "string" && parsed.bh.length <= 64) env.bh = parsed.bh;
    return env;
  } catch {
    return null;
  }
}
