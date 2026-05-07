import { useEffect, useState } from "react";
import { CheckIcon, EyeOffIcon, TimerIcon } from "./icons";
import { fetchMediaObjectURL } from "../lib/media";

type Props = {
  content: string;
  isOwn: boolean;
  mediaId?: string | null;
  mimeType?: string | null;
  viewOnce?: boolean;
  viewedAt?: string | null;
  token?: string | null;
  onOpenSnap?: () => void;
};

function MediaContent({
  mediaId,
  mimeType,
  token,
}: {
  mediaId: string;
  mimeType: string | null | undefined;
  token: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
      })
      .catch((err) => !cancelled && setError(err.message ?? "Failed to load"));
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [mediaId, token]);

  if (error) {
    return <div className="text-xs text-red-300 italic">[{error}]</div>;
  }
  if (!src) {
    return (
      <div className="w-48 h-48 bg-muted-soft/50 rounded-lg animate-pulse" />
    );
  }
  if (mimeType?.startsWith("video/")) {
    return (
      <video
        src={src}
        controls
        playsInline
        className="max-w-full max-h-80 rounded-lg block"
      />
    );
  }
  return (
    <img
      src={src}
      alt=""
      className="max-w-full max-h-80 rounded-lg block"
    />
  );
}

function SnapPlaceholder({
  isOwn,
  viewed,
  canOpen,
  mimeType,
  onOpen,
}: {
  isOwn: boolean;
  viewed: boolean;
  canOpen: boolean;
  mimeType: string | null | undefined;
  onOpen?: () => void;
}) {
  const label = viewed
    ? "Snap viewed"
    : isOwn
    ? `Snap sent · ${mimeType?.startsWith("video/") ? "video" : "photo"}`
    : `Tap to view · ${mimeType?.startsWith("video/") ? "video" : "photo"}`;

  const baseClass = isOwn
    ? "bg-navy text-white rounded-br-md"
    : "bg-card text-navy rounded-bl-md";

  return (
    <button
      type="button"
      disabled={!canOpen}
      onClick={() => canOpen && onOpen?.()}
      className={`flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold shadow-sm transition ${baseClass} ${
        canOpen ? "hover:opacity-90 cursor-pointer" : "opacity-70 cursor-default"
      }`}
    >
      {viewed ? <EyeOffIcon className="w-5 h-5" /> : <TimerIcon className="w-5 h-5" />}
      <span>{label}</span>
    </button>
  );
}

export function MessageBubble({
  content,
  isOwn,
  mediaId,
  mimeType,
  viewOnce,
  viewedAt,
  token,
  onOpenSnap,
}: Props) {
  const hasMedia = !!mediaId && !!token;

  // Snap (view-once) media — render a placeholder that opens the fullscreen viewer.
  // Sender never opens; recipient opens once. After view, both sides show "viewed".
  if (hasMedia && viewOnce) {
    const viewed = !!viewedAt;
    const canOpen = !isOwn && !viewed;
    const align = isOwn ? "self-end" : "self-start";
    return (
      <div className={`flex flex-col gap-1 ${align} max-w-[80%]`}>
        <SnapPlaceholder
          isOwn={isOwn}
          viewed={viewed}
          canOpen={canOpen}
          mimeType={mimeType}
          onOpen={onOpenSnap}
        />
      </div>
    );
  }

  // Regular media — inline image or video bubble, optional caption below.
  if (hasMedia) {
    const align = isOwn ? "self-end" : "self-start";
    return (
      <div className={`flex flex-col gap-1 ${align} max-w-[80%]`}>
        <MediaContent mediaId={mediaId!} mimeType={mimeType} token={token!} />
        {content && (
          <div
            className={`px-3 py-2 rounded-2xl text-[14px] leading-snug shadow-sm wrap-break-word ${
              isOwn
                ? "bg-navy text-white rounded-br-md"
                : "bg-card text-navy rounded-bl-md"
            }`}
          >
            {content}
          </div>
        )}
      </div>
    );
  }

  if (isOwn) {
    return (
      <div className="flex items-end gap-1.5 self-end max-w-[80%]">
        <CheckIcon className="w-4 h-4 text-primary shrink-0 mb-2" />
        <div className="bg-navy text-white px-4 py-2.5 rounded-2xl rounded-br-md text-[15px] leading-snug shadow-sm wrap-break-word">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="self-start max-w-[80%]">
      <div className="bg-card text-navy px-4 py-2.5 rounded-2xl rounded-bl-md text-[15px] leading-snug shadow-sm wrap-break-word">
        {content}
      </div>
    </div>
  );
}
