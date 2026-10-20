import { apiBase } from "./config";
import { MEDIA_CRYPTO_OVERHEAD, decryptMediaBytes, encryptMediaBytes } from "../crypto";

// 50MB cap matches the backend's MediaController.MAX_BYTES. That limit applies to
// the uploaded *ciphertext*, so the plaintext cap leaves room for the IV + GCM tag.
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MAX_PLAINTEXT_BYTES = MAX_MEDIA_BYTES - MEDIA_CRYPTO_OVERHEAD;

export type UploadedMedia = {
  mediaId: string;
  /** Real type (e.g. "image/jpeg") — only ever sent inside the encrypted envelope. */
  mimeType: string;
  /** Coarse type the server may see ("image/*" or "video/*") — keeps list previews working. */
  wireMimeType: string;
  /** base64 AES-256-GCM key for this blob — only ever sent inside the encrypted envelope. */
  key: string;
  size: number;
};

/**
 * Encrypt an image or video in the browser and upload the ciphertext.
 * The server stores an opaque blob; it never sees the bytes, the key, or the exact type.
 */
export async function uploadMedia(file: File, token: string): Promise<UploadedMedia> {
  if (file.size > MAX_PLAINTEXT_BYTES) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB) — max is 50MB`);
  }
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
    throw new Error("Only images and videos can be sent");
  }

  const { ciphertext, key } = await encryptMediaBytes(await file.arrayBuffer());

  const form = new FormData();
  form.append("file", new Blob([ciphertext], { type: "application/octet-stream" }), "media.bin");

  const res = await fetch(`${apiBase}/api/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!res.ok) {
    if (res.status === 413) throw new Error("File too large");
    throw new Error(`Upload failed: ${res.status}`);
  }
  const { mediaId } = (await res.json()) as { mediaId: string };
  return {
    mediaId,
    mimeType: file.type,
    wireMimeType: file.type.startsWith("video/") ? "video/*" : "image/*",
    key,
    size: file.size,
  };
}

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

const mediaCache = new Map<string, Promise<string>>();

/**
 * Fetch an authenticated media blob and return an object URL.
 * With `mediaKey` the blob is E2E ciphertext and is decrypted here; without it
 * we expect a legacy (server-encrypted-at-rest) file the server serves as plaintext.
 * Caller is responsible for URL.revokeObjectURL when done (or rely on browser cleanup).
 */
export function fetchMediaObjectURL(
  mediaId: string,
  token: string,
  mediaKey?: string | null,
  mimeType?: string | null,
): Promise<string> {
  if (mediaCache.has(mediaId)) {
    return mediaCache.get(mediaId)!;
  }

  const promise = fetch(`${apiBase}/api/media/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(async (res) => {
    if (!res.ok) throw new Error(`Media fetch failed: ${res.status}`);

    if (mediaKey) {
      const plaintext = await decryptMediaBytes(await res.arrayBuffer(), mediaKey);
      return URL.createObjectURL(
        new Blob([plaintext], { type: mimeType ?? "application/octet-stream" }),
      );
    }

    // No key but the server says it's opaque → E2E media we can't unlock here
    // (message failed to decrypt, e.g. a different keypair on this device).
    if ((res.headers.get("Content-Type") ?? "").startsWith("application/octet-stream")) {
      throw new Error("Can't decrypt this media on this device");
    }
    return URL.createObjectURL(await res.blob());
  }).catch((err) => {
    mediaCache.delete(mediaId);
    throw err;
  });

  mediaCache.set(mediaId, promise);
  return promise;
}
