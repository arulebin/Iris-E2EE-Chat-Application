import { useState, useRef, useEffect } from "react";
import { get } from "idb-keyval";
import { Avatar } from "./Avatar";
import type { UserProfile, FriendRequest, ChatMessage } from "../types";
import {
  ChatBubbleIcon,
  IrisMark,
  NewChatIcon,
  SearchIcon,
  SettingsIcon,
} from "./icons";

type Preview = { text: string; time: string; fromMe: boolean };

// Short, messenger-style relative time for the list ("14:32", "Yesterday", "Mon", "3 Jun").
function relativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    if (now.getTime() - d.getTime() < 7 * 86400000)
      return d.toLocaleDateString([], { weekday: "short" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function previewText(m: ChatMessage): string {
  if (m.mediaId) {
    if (m.viewOnce) return "📷 Snap";
    return m.mimeType?.startsWith("video/") ? "🎥 Video" : "📷 Photo";
  }
  return m.content;
}

type Props = {
  me: string | null;
  users: UserProfile[];
  recipient: string;
  onSelectUser: (username: string) => void;
  onOpenSettings: () => void;
  friendRequests: FriendRequest[];
  onAcceptRequest: (id: number) => void;
  onRejectRequest: (id: number) => void;
  onSendRequest: (shareId: string) => Promise<void>;
};

type Tab = "messages" | "groups";

export function ChatListView({
  me,
  users,
  recipient,
  onSelectUser,
  onOpenSettings,
  friendRequests,
  onAcceptRequest,
  onRejectRequest,
  onSendRequest,
}: Props) {
  const activeTab: Tab = "messages";
  const [showSearch, setShowSearch] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pull the last message of each conversation from the local (already-decrypted)
  // IndexedDB cache so the list shows a real preview + timestamp like a native app.
  useEffect(() => {
    if (!me || users.length === 0) return;
    let cancelled = false;
    (async () => {
      const map: Record<string, Preview> = {};
      await Promise.all(
        users.map(async (u) => {
          try {
            const hist = await get<ChatMessage[]>(`chat_history_${me}_${u.username}`);
            if (!hist || hist.length === 0) return;
            const last = hist[hist.length - 1];
            map[u.username] = { text: previewText(last), time: last.sentAt, fromMe: last.from === me };
          } catch {
            /* no cached history for this user */
          }
        }),
      );
      if (!cancelled) setPreviews(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [me, users]);

  // Most-recent conversation first; users without history keep their original order below.
  const sortedUsers = [...users].sort((a, b) => {
    const ta = previews[a.username]?.time;
    const tb = previews[b.username]?.time;
    if (ta && tb) return tb.localeCompare(ta);
    if (ta) return -1;
    if (tb) return 1;
    return 0;
  });

  useEffect(() => {
    if (showSearch) setTimeout(() => searchInputRef.current?.focus(), 50);
    else { setSearchQuery(""); setSearchResults([]); }
  }, [showSearch]);

  function handleSearchInput(q: string) {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) setSearchResults(await res.json());
      } finally {
        setSearching(false);
      }
    }, 350);
  }

  async function handleSendRequest(user: UserProfile) {
    if (!user.shareId) return;
    await onSendRequest(user.shareId);
    setSentRequests(prev => new Set(prev).add(user.username));
  }

  const pendingCount = friendRequests.length;

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Top bar */}
      <header className="px-5 pt-6 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IrisMark className="w-7 h-7" />
          <h1 className="text-3xl font-extrabold tracking-tight iris-wordmark">Iris</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Friend requests bell */}
          <button
            onClick={() => setShowRequests(true)}
            className="relative text-navy hover:opacity-70"
            aria-label="Friend requests"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
              <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
              <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
              <line x1="6" x2="6" y1="1" y2="4" />
              <line x1="10" x2="10" y1="1" y2="4" />
              <line x1="14" x2="14" y1="1" y2="4" />
            </svg>
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-danger text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {pendingCount > 9 ? "9+" : pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowSearch(true)}
            className="text-navy hover:opacity-70"
            aria-label="Search"
          >
            <SearchIcon />
          </button>
          <button
            onClick={onOpenSettings}
            className="text-navy hover:opacity-70"
            aria-label="Settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      <p className="px-5 pb-3 text-xs text-muted">
        Signed in as <span className="font-semibold text-navy">{me}</span>
      </p>

      {/* Pill tabs */}
      <div className="px-5 pb-3">
        <div className="bg-muted-soft/40 rounded-full p-1 flex">
          <button
            className={`flex-1 py-2 text-sm font-bold rounded-full transition ${
              activeTab === "messages" ? "bg-primary text-white shadow" : "text-navy"
            }`}
          >
            Messages
          </button>
          <button
            className="flex-1 py-2 text-sm font-bold rounded-full text-muted cursor-not-allowed"
            disabled
            title="Groups coming soon"
          >
            Groups
          </button>
        </div>
      </div>

      {/* User list */}
      <div className="flex-1 overflow-y-auto px-2">
        {users.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-8 py-20 text-center">
            <ChatBubbleIcon className="w-14 h-14 text-muted mb-4" />
            <p className="text-muted text-base leading-snug">
              No conversations yet.
              <br />
              Tap <span className="font-semibold text-navy">+</span> to find someone.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1 py-2">
            {sortedUsers.map((u) => {
              const pv = previews[u.username];
              return (
                <li key={u.username}>
                  <button
                    onClick={() => onSelectUser(u.username)}
                    className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-2xl transition ${
                      recipient === u.username ? "bg-card shadow-sm" : "hover:bg-card/60 active:bg-card/80"
                    }`}
                  >
                    <Avatar name={u.preferredName || u.username} avatarUrl={u.avatarUrl} size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-navy truncate flex-1">{u.preferredName || u.username}</p>
                        {pv && (
                          <span className="text-[11px] text-muted shrink-0 font-medium">
                            {relativeTime(pv.time)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted truncate">
                        {pv ? (
                          <>
                            {pv.fromMe && <span className="text-muted">You: </span>}
                            {pv.text}
                          </>
                        ) : (
                          "Tap to open chat"
                        )}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => setShowSearch(true)}
        className="iris-fill absolute bottom-6 right-6 sm:bottom-8 sm:right-8 w-14 h-14 text-white rounded-full shadow-lg flex items-center justify-center transition-transform active:scale-90"
        aria-label="New chat"
      >
        <NewChatIcon />
      </button>

      {/* ── Search / New Chat sheet ── */}
      {showSearch && (
        <div className="absolute inset-0 z-40 flex flex-col bg-bg">
          <header className="px-4 pt-5 pb-3 flex items-center gap-3 border-b border-muted-soft/30">
            <button onClick={() => setShowSearch(false)} className="text-navy hover:opacity-70 p-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </button>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => handleSearchInput(e.target.value)}
              placeholder="Search by username or name…"
              className="flex-1 bg-card rounded-xl px-3 py-2 text-navy text-sm outline-none placeholder:text-muted"
            />
          </header>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {searching && (
              <p className="text-center text-muted text-sm py-8">Searching…</p>
            )}
            {!searching && searchQuery && searchResults.length === 0 && (
              <p className="text-center text-muted text-sm py-8">No users found.</p>
            )}
            {!searching && searchResults.map(u => {
              const alreadyConnected = users.some(c => c.username === u.username);
              const requested = sentRequests.has(u.username);
              return (
                <div key={u.username} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-card/60">
                  <Avatar name={u.preferredName || u.username} avatarUrl={u.avatarUrl} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-navy truncate">{u.preferredName || u.username}</p>
                    <p className="text-xs text-muted truncate">@{u.username}</p>
                  </div>
                  {alreadyConnected ? (
                    <button
                      onClick={() => { onSelectUser(u.username); setShowSearch(false); }}
                      className="text-xs font-bold text-primary bg-primary/10 px-3 py-1.5 rounded-full"
                    >
                      Message
                    </button>
                  ) : requested ? (
                    <span className="text-xs text-muted bg-muted-soft/30 px-3 py-1.5 rounded-full">Sent</span>
                  ) : (
                    <button
                      onClick={() => handleSendRequest(u)}
                      className="text-xs font-bold text-white bg-primary px-3 py-1.5 rounded-full active:scale-95 transition-transform"
                    >
                      Connect
                    </button>
                  )}
                </div>
              );
            })}
            {!searchQuery && (
              <p className="text-center text-muted text-sm py-12">Type to search for people.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Friend requests sheet ── */}
      {showRequests && (
        <div className="absolute inset-0 z-40 flex flex-col bg-bg">
          <header className="px-4 pt-5 pb-3 flex items-center gap-3 border-b border-muted-soft/30">
            <button onClick={() => setShowRequests(false)} className="text-navy hover:opacity-70 p-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </button>
            <h2 className="text-lg font-bold text-navy">Connection Requests</h2>
          </header>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {friendRequests.length === 0 ? (
              <p className="text-center text-muted text-sm py-12">No pending requests.</p>
            ) : (
              <ul className="flex flex-col gap-1 py-2">
                {friendRequests.map(req => (
                  <li key={req.id} className="flex items-center gap-3 px-3 py-3 rounded-2xl bg-card shadow-sm">
                    <Avatar name={req.fromUser} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-navy truncate">{req.fromUser}</p>
                      <p className="text-xs text-muted">Wants to connect</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => onRejectRequest(req.id)}
                        className="text-xs font-bold text-muted bg-muted-soft/30 px-3 py-1.5 rounded-full"
                      >
                        Decline
                      </button>
                      <button
                        onClick={() => onAcceptRequest(req.id)}
                        className="text-xs font-bold text-white bg-primary px-3 py-1.5 rounded-full active:scale-95 transition-transform"
                      >
                        Accept
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
