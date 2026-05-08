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

export function SnapViewer({ mediaId, mimeType, token, onClose, onConsumed }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const consumedRef = useRef(false);
  // onConsumed is captured by ref so its identity changing across parent
  // renders doesn't re-run the fetch effect.
  const onConsumedRef = useRef(onConsumed);
  useEffect(() => {
    onConsumedRef.current = onConsumed;
  });

  const isVideo = !!mimeType?.startsWith("video/");

  // Fetch the bytes — server deletes the file as a side effect of this GET.
  // The mediaCache singleton ensures that even in React 18 Strict Mode
  // double-renders we don't accidentally drop the image or fire duplicate fetches.
  useEffect(() => {
    let cancelled = false;
    fetchMediaObjectURL(mediaId, token)
      .then((url) => {
        if (cancelled) return;
        setSrc(url);
        if (onConsumedRef.current && !consumedRef.current) {
          consumedRef.current = true;
          onConsumedRef.current();
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err?.message ?? "Failed to load";
        setError(
          msg.includes("410") || msg.includes("404")
            ? "This snap has already been viewed."
            : msg
        );
      });
    return () => {
      cancelled = true;
    };
  }, [mediaId, token]);

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
    </div>
  );
}
