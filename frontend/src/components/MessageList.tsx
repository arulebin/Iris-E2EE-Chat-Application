import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";
import { MessageBubble } from "./MessageBubble";
import { SnapViewer } from "./SnapViewer";

type Props = {
  messages: ChatMessage[];
  me: string | null;
  token: string | null;
  onMarkSnapViewed: (key: string) => void; // key = sender|sentAt|mediaId — uniquely identifies a message
  onStartReply: (msg: ChatMessage) => void;
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return "";
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const isToday =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    const datePart = d.toLocaleDateString([], { month: "long", day: "numeric" }).toUpperCase();
    return isToday ? `TODAY, ${datePart}` : datePart;
  } catch {
    return "";
  }
}

export function MessageList({ messages, me, token, onMarkSnapViewed, onStartReply }: Props) {
  const messagesById = new Map<number, ChatMessage>();
  for (const m of messages) {
    if (m.id != null) messagesById.set(m.id, m);
  }
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [openSnap, setOpenSnap] = useState<ChatMessage | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-sm px-6 text-center">
        No messages yet — say hi.
      </div>
    );
  }

  // Group consecutive messages from the same sender so the timestamp prints once per cluster.
  const clusters: { from: string; items: ChatMessage[] }[] = [];
  for (const msg of messages) {
    const last = clusters[clusters.length - 1];
    if (last && last.from === msg.from) {
      last.items.push(msg);
    } else {
      clusters.push({ from: msg.from, items: [msg] });
    }
  }

  function snapKey(m: ChatMessage) {
    return `${m.from}|${m.sentAt}|${m.mediaId ?? ""}`;
  }

  return (
    <>
      <div className="selectable flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages[0] && (
          <div className="flex items-center gap-3 my-2">
            <div className="flex-1 h-px bg-muted-soft/50" />
            <span className="text-xs text-muted font-semibold tracking-wide">
              {formatDate(messages[0].sentAt)}
            </span>
            <div className="flex-1 h-px bg-muted-soft/50" />
          </div>
        )}

        {clusters.map((cluster, ci) => {
          const isOwn = cluster.from === me;
          // const last = cluster.items[cluster.items.length - 1];
          return (
            <div key={ci} className="flex flex-col gap-1.5">
              {cluster.items.map((msg, mi) => (
                <MessageBubble
                  key={mi}
                  content={msg.content}
                  isOwn={isOwn}
                  mediaId={msg.mediaId}
                  mimeType={msg.mimeType}
                  viewOnce={msg.viewOnce}
                  viewedAt={msg.viewedAt}
                  token={token}
                  onOpenSnap={() => setOpenSnap(msg)}
                  replyTo={msg.replyToId != null ? messagesById.get(msg.replyToId) ?? null : null}
                  onReply={() => onStartReply(msg)}
                  timestamp={formatTime(msg.sentAt)}
                />
              ))}
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {openSnap && openSnap.mediaId && token && (
        <SnapViewer
          mediaId={openSnap.mediaId}
          mimeType={openSnap.mimeType}
          token={token}
          onClose={() => setOpenSnap(null)}
          onConsumed={() => {
            if (openSnap.viewOnce) onMarkSnapViewed(snapKey(openSnap));
          }}
        />
      )}
    </>
  );
}
