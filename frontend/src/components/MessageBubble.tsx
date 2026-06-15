import { useEffect, useState } from "react";
import { CheckIcon, EyeOffIcon, ReplyIcon, TimerIcon } from "./icons";
import { fetchMediaObjectURL } from "../lib/media";

export type ChatMessage = import("../types").ChatMessage;

type Props = {
  content: string;
  isOwn: boolean;
  mediaId?: string | null;
  mimeType?: string | null;
  viewOnce?: boolean;
  viewedAt?: string | null;
  token?: string | null;
  onOpenSnap?: () => void;
  replyTo?: ChatMessage | null;
  onReply?: () => void;
  timestamp?: string;
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
    fetchMediaObjectURL(mediaId, token)
      .then((url) => {
        if (cancelled) return;
        setSrc(url);
      })
      .catch((err) => !cancelled && setError(err.message ?? "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, [mediaId, token]);

  if (error) {
    return <div className="text-xs text-danger italic">[{error}]</div>;
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
    ? "bg-primary text-white rounded-br-md"
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

function ReplyPreview({ replyTo, isOwnBubble }: { replyTo: ChatMessage; isOwnBubble: boolean }) {
  const isMedia = !!replyTo.mediaId;
  const isVideo = replyTo.mimeType?.startsWith("video/");
  const preview = isMedia
    ? replyTo.viewOnce
      ? `Snap · ${isVideo ? "video" : "photo"}`
      : isVideo
      ? "Video"
      : "Photo"
    : replyTo.content || "";

  // Quoted-reply box with a color-coded left border, tuned per bubble color.
  const containerClass = isOwnBubble
    ? "bg-white/15 border-white/70 text-white"
    : "bg-navy/5 border-primary text-navy";

  const nameColor = isOwnBubble ? "text-white/90" : "text-primary";

  return (
    <div className={`text-xs rounded border-l-[4px] px-2 py-1 mb-1 max-w-full ${containerClass}`}>
      <p className={`font-semibold truncate ${nameColor}`}>{replyTo.from}</p>
      <p className="truncate opacity-80">{preview || "…"}</p>
    </div>
  );
}

function ReplyButton({ onReply }: { onReply: () => void }) {
  return (
    <button
      type="button"
      onClick={onReply}
      aria-label="Reply"
      className="opacity-40 hover:opacity-100 text-muted hover:text-navy p-1 transition shrink-0 self-center"
    >
      <ReplyIcon className="w-4 h-4" />
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
  replyTo,
  onReply,
  timestamp,
}: Props) {
  const hasMedia = !!mediaId && !!token;

  // Snap (view-once) media — render a placeholder that opens the fullscreen viewer.
  if (hasMedia && viewOnce) {
    const viewed = !!viewedAt;
    const canOpen = !isOwn && !viewed;
    const align = isOwn ? "self-end flex-row" : "self-start flex-row-reverse";
    return (
      <div className={`flex items-stretch gap-1 ${align} max-w-[85%]`}>
        {onReply && <ReplyButton onReply={onReply} />}
        <div className="flex flex-col gap-1 max-w-full">
          {replyTo && <ReplyPreview replyTo={replyTo} isOwnBubble={isOwn} />}
          <div className="relative">
            <SnapPlaceholder
              isOwn={isOwn}
              viewed={viewed}
              canOpen={canOpen}
              mimeType={mimeType}
              onOpen={onOpenSnap}
            />
            {timestamp && (
              <span className={`text-[10px] mt-1 absolute ${isOwn ? "right-2 text-white/70" : "left-2 text-navy/70"} bottom-1`}>
                {timestamp}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Regular media — inline image or video bubble, optional caption below.
  if (hasMedia) {
    const align = isOwn ? "self-end flex-row" : "self-start flex-row-reverse";
    return (
      <div className={`flex items-stretch gap-1 ${align} max-w-[85%]`}>
        {onReply && <ReplyButton onReply={onReply} />}
        <div className="flex flex-col gap-1 max-w-full">
          {replyTo && <ReplyPreview replyTo={replyTo} isOwnBubble={isOwn} />}
          <div onClick={() => onOpenSnap && onOpenSnap()} className="cursor-pointer">
            <MediaContent mediaId={mediaId!} mimeType={mimeType} token={token!} />
          </div>
          {content && (
            <div
              className={`px-3 py-2 rounded-2xl text-[14px] leading-snug shadow-sm wrap-break-word relative pb-5 ${
                isOwn
                  ? "bg-primary text-white rounded-br-md"
                  : "bg-card text-navy rounded-bl-md"
              }`}
            >
              {content}
              {timestamp && (
                <span className={`text-[10px] absolute bottom-1 right-3 ${isOwn ? "text-white/60" : "text-navy/50"}`}>
                  {timestamp}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isOwn) {
    return (
      <div className="flex items-stretch gap-1 self-end max-w-[85%]">
        {onReply && <ReplyButton onReply={onReply} />}
        <div className="flex flex-col bg-primary text-white p-1.5 rounded-2xl rounded-br-md shadow-sm min-w-[80px] relative">
          {replyTo && <ReplyPreview replyTo={replyTo} isOwnBubble />}
          <div className="text-[15px] leading-snug wrap-break-word px-2 pb-3">
            {content}
            <div className="text-[10px] text-white/60 absolute bottom-1.5 right-3 flex items-center gap-1">
              {timestamp}
              <CheckIcon className="w-3 h-3 text-white/80" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-stretch gap-1 self-start max-w-[85%] flex-row-reverse">
      {onReply && <ReplyButton onReply={onReply} />}
      <div className="flex flex-col bg-card text-navy p-1.5 rounded-2xl rounded-bl-md shadow-sm min-w-[80px] relative">
        {replyTo && <ReplyPreview replyTo={replyTo} isOwnBubble={false}/>}
        <div className="text-[15px] leading-snug wrap-break-word px-2 pb-4">
          {content}
        </div>
        {timestamp && (
          <div className="text-[10px] text-navy/50 absolute bottom-1.5 right-3">
            {timestamp}
          </div>
        )}
      </div>
    </div>
  );
}
