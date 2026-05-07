// 50MB cap matches the backend's MediaController.MAX_BYTES.
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

export type UploadedMedia = {
  mediaId: string;
  mimeType: string;
  size: number;
};

/** Upload an image or video; the server encrypts at rest. Returns a mediaId. */
export async function uploadMedia(file: File, token: string): Promise<UploadedMedia> {
  if (file.size > MAX_MEDIA_BYTES) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB) — max is 50MB`);
  }
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
    throw new Error("Only images and videos can be sent");
  }

  const form = new FormData();
  form.append("file", file);

  const res = await fetch("/api/media", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!res.ok) {
    if (res.status === 413) throw new Error("File too large");
    throw new Error(`Upload failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch an authenticated media blob and return an object URL.
 * Caller is responsible for URL.revokeObjectURL when done.
 */
export async function fetchMediaObjectURL(mediaId: string, token: string): Promise<string> {
  const res = await fetch(`/api/media/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Media fetch failed: ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
