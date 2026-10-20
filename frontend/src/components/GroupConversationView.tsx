import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, UserProfile } from "../types";
import type { SignalClient } from "../lib/signal/client";
import { groupApi, type GroupDto, type GroupEventDto } from "../lib/groups/api";
import { subscribeGroupEvents } from "../lib/groups/bus";
import { eventsAsMessages, groupPeer, mergeTimeline, readByAllAt } from "../lib/groups/payload";
import { useMemberKeys } from "../lib/groups/useMemberKeys";
import { getMessages } from "../lib/messageStore";
import { acknowledgeKeyChange } from "../lib/fingerprint";
import { buildMediaEnvelope, uploadMedia } from "../lib/media";
import { Avatar } from "./Avatar";
import { BackIcon, MoreIcon } from "./icons";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { GroupInfoView } from "./GroupInfoView";

type Props = {
  group: GroupDto;
  me: string;
  token: string;
  friends: UserProfile[];
  getSignal: () => SignalClient | null;
  getSocket: () => WebSocket | null;
  onBack: () => void;
  /** I left (or was removed from) the group. */
  onLeft: () => void;
  onGroupChanged: (group: GroupDto) => void;
};

const sameMessage = (a: ChatMessage, b: ChatMessage) =>
  (a.id != null && a.id === b.id) || (!!a.clientId && a.clientId === b.clientId);

export function GroupConversationView({ group, me, token, friends, getSignal, getSocket, onBack, onLeft, onGroupChanged }: Props) {
  const groupId = group.id;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<GroupEventDto[]>([]);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [liveReads, setLiveReads] = useState<Record<string, number>>({});
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const typingSentAt = useRef(0);
  const typingStop = useRef<ReturnType<typeof setTimeout> | null>(null);

  const memberNames = useMemo(() => group.members.map((m) => m.username), [group.members]);
  const keys = useMemberKeys(me, token, memberNames);
  const byName = useMemo(() => new Map(group.members.map((m) => [m.username, m])), [group.members]);

  const send = useCallback((frame: object) => {
    const ws = getSocket();
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  }, [getSocket]);

  const markRead = useCallback(() => {
    if (!document.hidden) send({ type: "read", group: groupId });
  }, [send, groupId]);

  // Local (encrypted-at-rest) history is the only copy of group messages.
  // (Mounted with key={group.id}, so switching groups starts from empty state.)
  useEffect(() => {
    let cancelled = false;
    getMessages(me, groupPeer(groupId)).then((list) => { if (!cancelled) setMessages(list); }).catch(console.error);
    return () => { cancelled = true; };
  }, [me, groupId]);

  const loadEvents = useCallback(() => {
    groupApi.events(token, groupId).then(setEvents).catch(() => { /* offline: no system lines */ });
  }, [token, groupId]);

  useEffect(() => { loadEvents(); }, [loadEvents]);
  useEffect(() => { markRead(); }, [markRead]);

  useEffect(() => {
    const onVisible = () => { if (!document.hidden) markRead(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead]);

  useEffect(() => subscribeGroupEvents((e) => {
    if (e.kind === "changed") { loadEvents(); return; }
    if (!("groupId" in e) || e.groupId !== groupId) return;
    if (e.kind === "message") {
      setMessages((prev) => {
        const i = prev.findIndex((m) => sameMessage(m, e.message));
        return i < 0 ? [...prev, e.message] : prev.map((m, j) => (j === i ? e.message : m));
      });
      if (e.message.from !== me) {
        setTyping((prev) => { const next = { ...prev }; delete next[e.message.from]; return next; });
        markRead();
      }
    } else if (e.kind === "typing") {
      setTyping((prev) => {
        const next = { ...prev };
        if (e.typing) next[e.from] = Date.now(); else delete next[e.from];
        return next;
      });
    } else if (e.kind === "read") {
      setLiveReads((prev) => ({ ...prev, [e.by]: e.at }));
    }
  }), [groupId, me, loadEvents, markRead]);

  // A lost "stop" mustn't leave "typing…" up forever.
  useEffect(() => {
    if (Object.keys(typing).length === 0) return;
    const id = setInterval(() => {
      setTyping((prev) => {
        const cutoff = Date.now() - 6000;
        const next = Object.fromEntries(Object.entries(prev).filter(([, t]) => t > cutoff));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 2000);
    return () => clearInterval(id);
  }, [typing]);

  const displayName = useCallback((u: string) => byName.get(u)?.preferredName || u, [byName]);

  const timeline = useMemo(
    () => mergeTimeline(messages, eventsAsMessages(events, me, group.members)),
    [messages, events, me, group.members],
  );

  const typers = Object.keys(typing).filter((u) => u !== me).map(displayName);
  const subtitle = typers.length
    ? `${typers.slice(0, 2).join(", ")}${typers.length > 2 ? ` +${typers.length - 2}` : ""} typing…`
    : `${group.members.length} member${group.members.length === 1 ? "" : "s"}`;

  const blockedNames = keys.blocked.map(displayName);
  const notMember = group.myRole == null;

  function handleInput(value: string) {
    setInput(value);
    if (!value.trim()) {
      if (typingSentAt.current) { typingSentAt.current = 0; send({ type: "typing", group: groupId, state: "stop" }); }
      return;
    }
    if (Date.now() - typingSentAt.current > 2500) {
      typingSentAt.current = Date.now();
      send({ type: "typing", group: groupId, state: "start" });
    }
    if (typingStop.current) clearTimeout(typingStop.current);
    typingStop.current = setTimeout(() => {
      typingSentAt.current = 0;
      send({ type: "typing", group: groupId, state: "stop" });
    }, 3000);
  }

  function clientOrThrow(): SignalClient {
    const client = getSignal();
    if (!client) throw new Error("Secure messaging isn't set up on this device yet — try again in a moment");
    if (!keys.ready) throw new Error("Still loading members' security keys…");
    if (keys.blocked.length) throw new Error("A member's security key changed — accept it before sending");
    return client;
  }

  function appendSent(msg: ChatMessage) {
    setMessages((prev) => (prev.some((m) => sameMessage(m, msg)) ? prev : [...prev, msg]));
  }

  async function handleSend() {
    const text = input;
    if (!text.trim()) return;
    setSendError(null);
    if (typingStop.current) clearTimeout(typingStop.current);
    typingSentAt.current = 0;
    send({ type: "typing", group: groupId, state: "stop" });
    try {
      const sent = await clientOrThrow().sendGroup(groupId, keys.recipients, text, { replyToId: replyTo?.id ?? null });
      appendSent(sent);
      setInput("");
      setReplyTo(null);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Couldn't send");
    }
  }

  async function handleSendMedia(file: File) {
    setSendError(null);
    const client = clientOrThrow();
    const { mediaId, mimeType, wireMimeType, key } = await uploadMedia(file, token);
    const sent = await client.sendGroup(groupId, keys.recipients, buildMediaEnvelope(key, mimeType), {
      mediaId, mimeType: wireMimeType, replyToId: replyTo?.id ?? null,
    });
    appendSent(sent);
    setReplyTo(null);
  }

  const disabledHint = notMember
    ? "You're no longer a member of this group."
    : blockedNames.length
    ? `${blockedNames.join(", ")}'s security key changed — review it to keep chatting.`
    : !keys.ready
    ? "Loading members' security keys…"
    : null;

  return (
    <div className="flex flex-col h-full bg-bg relative">
      <header className="flex items-center gap-3 px-3 py-3 border-b border-muted-soft/30 bg-bg">
        <button onClick={onBack} className="p-1 text-navy hover:opacity-70" aria-label="Back">
          <BackIcon />
        </button>
        <button onClick={() => setShowInfo(true)} className="flex items-center gap-3 flex-1 min-w-0 text-left" aria-label="Group info">
          <Avatar name={group.name} avatarUrl={group.avatarUrl ?? undefined} size="md" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-navy truncate">{group.name}</p>
            <p className="text-xs text-muted truncate">{subtitle}</p>
          </div>
        </button>
        <button onClick={() => setShowInfo(true)} className="p-1 text-navy hover:opacity-70" aria-label="Group info">
          <MoreIcon />
        </button>
      </header>

      {blockedNames.length > 0 && !notMember && (
        <div className="mx-3 mt-3 rounded-2xl bg-danger/10 border border-danger/30 px-4 py-3 text-sm text-navy">
          <p className="font-semibold">Security key changed</p>
          <p className="text-xs text-muted mt-0.5">
            {blockedNames.join(", ")} {blockedNames.length === 1 ? "has" : "have"} a new security key. This can mean they
            reinstalled Iris — or that someone is intercepting. Sending is paused until you accept.
          </p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setShowInfo(true)}
              className="text-xs font-bold text-primary bg-primary/10 px-3 py-1.5 rounded-full"
            >
              Review
            </button>
            <button
              onClick={() => keys.blocked.forEach((m) => acknowledgeKeyChange(me, m).catch(console.error))}
              className="text-xs font-bold text-white bg-danger px-3 py-1.5 rounded-full"
            >
              Accept new key{keys.blocked.length > 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}

      <MessageList
        messages={timeline}
        me={me}
        token={token}
        onMarkSnapViewed={() => {}}
        onStartReply={setReplyTo}
        peerReadAt={readByAllAt(group.members, me, liveReads)}
        senderName={displayName}
      />

      {sendError && <p className="px-4 pb-1 text-xs text-danger">{sendError}</p>}

      <MessageInput
        value={input}
        onChange={handleInput}
        onSend={handleSend}
        onSendMedia={(file) => handleSendMedia(file)}
        disabled={!!disabledHint}
        disabledHint={disabledHint}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        allowSnaps={false}
      />

      {showInfo && (
        <GroupInfoView
          group={group}
          me={me}
          token={token}
          friends={friends}
          trust={keys.trust}
          unavailable={keys.unavailable}
          onClose={() => setShowInfo(false)}
          onChanged={onGroupChanged}
          onLeft={onLeft}
        />
      )}
    </div>
  );
}
