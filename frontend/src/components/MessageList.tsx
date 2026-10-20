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
  peerReadAt?: number; // epoch ms the peer last read the conversation
  // Groups: label each cluster from someone else with their name.
  senderName?: (username: string) => string | null;
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

export function MessageList({ messages, me, token, onMarkSnapViewed, onStartReply, peerReadAt = 0, senderName }: Props) {
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
  // System lines ("Alice added Bob") stand alone and break clusters.
  const clusters: { from: string; items: ChatMessage[]; system?: boolean }[] = [];
  for (const msg of messages) {
    const last = clusters[clusters.length - 1];
    if (msg.system) {
      clusters.push({ from: msg.from, items: [msg], system: true });
    } else if (last && !last.system && last.from === msg.from) {
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
          if (cluster.system) {
            return (
              <div key={ci} className="flex justify-center">
                <span className="text-[11px] text-muted bg-muted-soft/30 px-3 py-1 rounded-full text-center max-w-[85%]">
                  {cluster.items[0].content}
                </span>
              </div>
            );
          }
          const isOwn = cluster.from === me;
          const label = !isOwn && senderName ? senderName(cluster.from) : null;
          return (
            <div key={ci} className="flex flex-col gap-1.5">
              {label && <span className="text-[11px] font-semibold text-primary px-3 -mb-0.5">{label}</span>}
              {cluster.items.map((msg, mi) => (
                <MessageBubble
                  key={mi}
                  content={msg.content}
                  isOwn={isOwn}
                  mediaId={msg.mediaId}
                  mimeType={msg.mimeType}
                  mediaKey={msg.mediaKey}
                  viewOnce={msg.viewOnce}
                  viewedAt={msg.viewedAt}
                  token={token}
                  onOpenSnap={() => setOpenSnap(msg)}
                  replyTo={msg.replyToId != null ? messagesById.get(msg.replyToId) ?? null : null}
                  onReply={() => onStartReply(msg)}
                  timestamp={formatTime(msg.sentAt)}
                  read={isOwn && Date.parse(msg.sentAt) <= peerReadAt}
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
          mediaKey={openSnap.mediaKey}
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
