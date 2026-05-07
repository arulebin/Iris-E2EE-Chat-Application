import { useEffect, useRef, useState } from "react";
import { fetchMediaObjectURL } from "../lib/media";
import { XIcon } from "./icons";

type Props = {
  mediaId: string;
  mimeType: string | null | undefined;
  token: string;
  onClose: () => void;
  onConsumed: () => void; // fired after the bytes are loaded — caller should mark "viewed" locally
};

const IMAGE_DURATION_MS = 5000;

export function SnapViewer({ mediaId, mimeType, token, onClose, onConsumed }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0); // 0..1 for the image timer

  // Guards: the GET to /api/media/{id} causes the server to mark this snap as
  // consumed and delete the file. We must NEVER fire that fetch twice for the
  // same viewer mount — otherwise the second fetch hits 410 and the UI shows
  // "already viewed" right after opening.
  const fetchedRef = useRef(false);
  const consumedRef = useRef(false);
  // onConsumed is captured by ref so its identity changing across parent
  // renders doesn't re-run the fetch effect.
  const onConsumedRef = useRef(onConsumed);
  useEffect(() => {
    onConsumedRef.current = onConsumed;
  });

  const isVideo = !!mimeType?.startsWith("video/");

  // Fetch the bytes — server deletes the file as a side effect of this GET.
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    let cancelled = false;
    let createdUrl: string | null = null;
    fetchMediaObjectURL(mediaId, token)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setSrc(url);
        if (!consumedRef.current) {
          consumedRef.current = true;
          onConsumedRef.current?.();
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err?.message ?? "Failed to load";
        setError(
          msg.includes("410")
            ? "This snap has already been viewed."
            : msg
        );
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [mediaId, token]);

  // 5-second auto-close for images. Videos close when the user does (or playback ends).
  useEffect(() => {
    if (!src || isVideo) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min((now - start) / IMAGE_DURATION_MS, 1);
      setProgress(p);
      if (p >= 1) {
        onClose();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [src, isVideo, onClose]);

  return (
    <div
      className="fixed inset-0 bg-black z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-4 right-4 text-white/80 hover:text-white p-2 z-10"
        aria-label="Close"
      >
        <XIcon className="w-7 h-7" />
      </button>

      {error ? (
        <p className="text-white/80 text-center px-8">{error}</p>
      ) : !src ? (
        <p className="text-white/60 text-sm">Loading…</p>
      ) : isVideo ? (
        <video
          src={src}
          controls
          autoPlay
          playsInline
          onEnded={onClose}
          className="max-w-full max-h-full"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <img
          src={src}
          alt=""
          className="max-w-full max-h-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {/* Image timer bar */}
      {src && !isVideo && !error && (
        <div className="absolute top-0 inset-x-0 h-1 bg-white/20">
          <div
            className="h-full bg-white"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
