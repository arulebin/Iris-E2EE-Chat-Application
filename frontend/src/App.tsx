import { useEffect, useRef, useState, useCallback } from "react";
import { get, set } from "idb-keyval";
import {
  ensureKeyPair,
  fetchPublicKey,
  encryptMessage,
  decryptMessage,
} from "./crypto";
import { enableNotifications, hasExistingSubscription } from "./push";
import { createPeerConnection, type CallSignal } from "./webrtc";
import type { ChatMessage, CallState } from "./types";
import { getUsername, getTokenExpiryMs, isTokenExpired } from "./lib/auth";
import { uploadMedia } from "./lib/media";
import { apiBase, wsURL } from "./lib/config";

import { AppShell } from "./components/AppShell";
import { Splash } from "./components/Splash";
import { AuthView } from "./components/AuthView";
import { ChatListView } from "./components/ChatListView";
import { ConversationView } from "./components/ConversationView";
import { SettingsView } from "./components/SettingsView";
import { IncomingCallModal } from "./components/IncomingCallModal";
import { CallNoticeBanner } from "./components/CallNoticeBanner";

type View = "list" | "chat" | "settings";

function App() {
  // ── auth state ──────────────────────────────────────────────────
  const [token, setToken] = useState<string | null>(() => {
    const stored = localStorage.getItem("token");
    if (isTokenExpired(stored)) {
      localStorage.removeItem("token");
      return null;
    }
    return stored;
  });
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // ── chat state ──────────────────────────────────────────────────
  const [users, setUsers] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [recipient, setRecipient] = useState("");
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // ── crypto state ────────────────────────────────────────────────
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [myPublicKey, setMyPublicKey] = useState<CryptoKey | null>(null);
  const [recipientPublicKey, setRecipientPublicKey] =
    useState<CryptoKey | null>(null);

  // ── push / brave state ──────────────────────────────────────────
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [isBrave, setIsBrave] = useState(false);

  // ── call state ──────────────────────────────────────────────────
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const handleSignalRef = useRef<((s: CallSignal) => Promise<void>) | null>(null);
  const [callState, setCallState] = useState<CallState>({ kind: "idle" });
  const [callNotice, setCallNotice] = useState<string | null>(null);

  // ── view routing ────────────────────────────────────────────────
  const [view, setView] = useState<View>("list");
  const [showSplash, setShowSplash] = useState(true);

  // Refs read by the long-lived ws.onmessage handler. Synced by a deps-less effect
  // below so the WS effect's deps stay [token] (no reconnect on sidebar clicks).
  const recipientRef = useRef<string>("");
  const decryptIncomingRef = useRef<((m: ChatMessage) => Promise<ChatMessage>) | null>(null);
  const meRef = useRef<string | null>(null);

  const me = getUsername(token);

  // ── splash for ~900ms on initial mount ──────────────────────────
  useEffect(() => {
    const id = setTimeout(() => setShowSplash(false), 900);
    return () => clearTimeout(id);
  }, []);

  // ── auth handlers ───────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch(`${apiBase}/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) throw new Error((await res.text()) || `${mode} failed`);

      let token: string;
      if (mode === "signup") {
        const loginRes = await fetch(`${apiBase}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        if (!loginRes.ok) throw new Error("Auto-login after signup failed");
        token = (await loginRes.json()).token;
      } else {
        token = (await res.json()).token;
      }
      localStorage.setItem("token", token);
      setToken(token);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    }
  }

  function handleLogout() {
    localStorage.removeItem("token");
    setToken(null);
    setMessages([]);
    setUsers([]);
    setRecipient("");
    setPrivateKey(null);
    setMyPublicKey(null);
    setRecipientPublicKey(null);
    setView("list");
    wsRef.current?.close();
  }

  async function handleEnableNotifications() {
    if (!token) return;
    setPushError(null);
    try {
      await enableNotifications(token);
      setPushEnabled(true);
    } catch (err: any) {
      setPushError(err.message ?? "Failed to enable notifications");
    }
  }

  // ── effects: push, brave, token expiry, keypair, users ──────────
  useEffect(() => {
    hasExistingSubscription().then(setPushEnabled);
  }, [token]);

  useEffect(() => {
    const nav = navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } };
    nav.brave?.isBrave?.().then(setIsBrave).catch(() => {});
  }, []);

  // We no longer auto-logout based on exp timestamp.
  // The token is persistent until manual logout.
  useEffect(() => {
    if (!token) return;
    const expiryMs = getTokenExpiryMs(token);
    if (expiryMs === null) return;
    const timeUntilExpiry = expiryMs - Date.now();
    if (timeUntilExpiry <= 0) {
      // Clean up if somehow an old expired token slipped through
      localStorage.removeItem("token");
      setToken(null);
    }
  }, [token]);

  // password is read from closure; intentionally not in deps so the effect
  // doesn't re-fire on every keystroke.
  useEffect(() => {
    if (!token || !me) return;
    ensureKeyPair(me, password, token)
      .then(({ privateKey, publicKey }) => {
        setPrivateKey(privateKey);
        setMyPublicKey(publicKey);
      })
      .catch((err) => console.error("Key setup failed:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, me]);

  useEffect(() => {
    if (!token) return;

    if (me) {
      get<string[]>(`users_list_${me}`).then((cached) => {
        if (cached && cached.length > 0) {
          setUsers((prev) => prev.length === 0 ? cached : prev);
        }
      }).catch(console.error);
    }

    fetch(`${apiBase}/api/users`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((list: string[]) => {
        setUsers(list);
        if (me) set(`users_list_${me}`, list).catch(console.error);
      })
      .catch(() => { /* offline silently handled */ });
  }, [token, me]);

  // ── decrypt one incoming/historical message ─────────────────────
  const decryptIncoming = useCallback(
    async (msg: ChatMessage): Promise<ChatMessage> => {
      if (!privateKey) return msg;
      const encryptedKey =
        msg.from === me ? msg.encryptedKeyForSender : msg.encryptedKeyForRecipient;
      if (!encryptedKey) return msg;
      try {
        const plaintext = await decryptMessage(msg.content, encryptedKey, privateKey);
        return { ...msg, content: plaintext };
      } catch (err) {
        console.error("Decryption failed", err);
        return { ...msg, content: "🔒 [unable to decrypt]" };
      }
    },
    [privateKey, me],
  );

  // Fetch + decrypt conversation history when recipient changes
  useEffect(() => {
    if (!token || !recipient.trim() || !privateKey || !me) return;

    const cacheKey = `chat_history_${me}_${recipient}`;
    get<ChatMessage[]>(cacheKey).then((cached) => {
      if (cached && cached.length > 0) {
        setMessages((prev) => prev.length === 0 ? cached : prev);
      }
    }).catch(console.error);

    fetch(`${apiBase}/api/messages?with=${encodeURIComponent(recipient)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then(async (history: ChatMessage[]) => {
        const decrypted = await Promise.all(history.map(decryptIncoming));
        setMessages(decrypted);
        set(cacheKey, decrypted).catch(console.error);
      })
      .catch(() => { /* serve via offline cache silently */ });
  }, [token, recipient, privateKey, decryptIncoming, me]);

  // Sync refs read by ws.onmessage
  useEffect(() => {
    recipientRef.current = recipient;
    decryptIncomingRef.current = decryptIncoming;
    meRef.current = me;
  });

  // WebSocket lifecycle: connects on login, stays up until logout
  useEffect(() => {
    if (!token) return;
    const ws = new WebSocket(wsURL(`/ws/chat?token=${token}`));
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "visibility",
        state: document.hidden ? "hidden" : "visible",
      }));
    };
    ws.onmessage = async (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data && typeof data.type === "string" && data.type.startsWith("call-")) {
          await handleSignalRef.current?.(data as CallSignal);
          return;
        }
        const msg = data as ChatMessage;
        const currentMe = meRef.current;
        const currentRecipient = recipientRef.current;
        const isCurrentChat =
          (msg.from === currentMe && msg.to === currentRecipient) ||
          (msg.from === currentRecipient && msg.to === currentMe);
        if (isCurrentChat && decryptIncomingRef.current) {
          const decrypted = await decryptIncomingRef.current(msg);
          setMessages((prev) => {
            const next = [...prev, decrypted];
            if (currentMe && currentRecipient) {
              set(`chat_history_${currentMe}_${currentRecipient}`, next).catch(console.error);
            }
            return next;
          });
        }
      } catch {
        // ignore non-JSON
      }
    };
    return () => ws.close();
  }, [token]);

  // ── recipient selection (from list view) ────────────────────────
  async function selectRecipient(user: string) {
    setRecipient(user);
    setRecipientPublicKey(null);
    setMessages([]);
    setReplyTo(null);
    setView("chat");
    if (!token) return;
    try {
      const key = await fetchPublicKey(user, token);
      setRecipientPublicKey(key);
    } catch (err) {
      console.error(`No key for ${user}:`, err);
    }
  }

  // ── send chat message ───────────────────────────────────────────
  async function send() {
    if (input.trim() === "" || recipient.trim() === "") return;
    if (!myPublicKey || !recipientPublicKey) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    try {
      const enc = await encryptMessage(input, myPublicKey, recipientPublicKey);
      wsRef.current.send(
        JSON.stringify({
          to: recipient,
          content: enc.ciphertext,
          encryptedKeyForSender: enc.encryptedKeyForSender,
          encryptedKeyForRecipient: enc.encryptedKeyForRecipient,
          replyToId: replyTo?.id ?? null,
        }),
      );
      setInput("");
      setReplyTo(null);
    } catch (err) {
      console.error("Encryption failed", err);
    }
  }

  // ── send a photo or video ───────────────────────────────────────
  // Server-side encryption at rest (master key on server). The text-encryption
  // fields are unused here — we send "" as content with no AES wrapper.
  // viewOnce=true marks the message as a snap; the server will delete the
  // encrypted file on the recipient's first GET.
  async function sendMedia(file: File, viewOnce: boolean) {
    if (!token || !recipient || wsRef.current?.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }
    const { mediaId, mimeType } = await uploadMedia(file, token);
    wsRef.current.send(
      JSON.stringify({
        to: recipient,
        content: "",
        encryptedKeyForSender: null,
        encryptedKeyForRecipient: null,
        mediaId,
        mimeType,
        viewOnce,
        replyToId: replyTo?.id ?? null,
      }),
    );
    setReplyTo(null);
  }

  // After the recipient consumes a snap, flip its viewedAt locally so the
  // bubble switches to "Snap viewed" without waiting for a refetch.
  function markSnapViewed(key: string) {
    setMessages((prev) => {
      const next = prev.map((m) =>
        `${m.from}|${m.sentAt}|${m.mediaId ?? ""}` === key
          ? { ...m, viewedAt: m.viewedAt ?? new Date().toISOString() }
          : m,
      );
      if (me && recipient) {
        set(`chat_history_${me}_${recipient}`, next).catch(console.error);
      }
      return next;
    });
  }

  // ── camera / call lifecycle ─────────────────────────────────────
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      setLocalStream(stream);
      return stream;
    } catch (err) {
      console.error("Camera/mic permission denied or unavailable", err);
      return null;
    }
  }

  function stopCamera() {
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
  }

  function teardownCall() {
    pcRef.current?.close();
    pcRef.current = null;
    pendingIceRef.current = [];
    setRemoteStream(null);
    stopCamera();
    setCallState({ kind: "idle" });
  }

  async function startCall() {
    if (!recipient || !wsRef.current) return;
    if (callState.kind !== "idle") return;
    setCallState({ kind: "outgoing", to: recipient });

    let stream = localStream;
    if (!stream) {
      stream = await startCamera();
      if (!stream) {
        setCallState({ kind: "idle" });
        return;
      }
    }

    const pc = createPeerConnection(wsRef.current, recipient, setRemoteStream);
    pcRef.current = pc;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream!));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsRef.current.send(JSON.stringify({ type: "call-offer", to: recipient, payload: offer }));
  }

  async function acceptCall() {
    if (callState.kind !== "incoming") return;
    if (!wsRef.current) return;
    const { from, offer } = callState;

    let stream = localStream;
    if (!stream) {
      stream = await startCamera();
      if (!stream) {
        wsRef.current.send(JSON.stringify({ type: "call-end", to: from }));
        setCallState({ kind: "idle" });
        return;
      }
    }

    const pc = createPeerConnection(wsRef.current, from, setRemoteStream);
    pcRef.current = pc;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream!));

    await pc.setRemoteDescription(offer);
    for (const c of pendingIceRef.current) {
      try { await pc.addIceCandidate(c); } catch (e) { console.error("addIceCandidate", e); }
    }
    pendingIceRef.current = [];

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    wsRef.current.send(JSON.stringify({ type: "call-answer", to: from, payload: answer }));
    setCallState({ kind: "active", peer: from });
  }

  function rejectCall() {
    if (callState.kind !== "incoming") return;
    wsRef.current?.send(JSON.stringify({ type: "call-end", to: callState.from }));
    setCallState({ kind: "idle" });
  }

  function hangUp() {
    if (callState.kind === "outgoing" || callState.kind === "active") {
      const peer = callState.kind === "outgoing" ? callState.to : callState.peer;
      wsRef.current?.send(JSON.stringify({ type: "call-end", to: peer }));
    }
    teardownCall();
  }

  async function handleSignal(signal: CallSignal) {
    if (signal.type === "call-offer") {
      if (callState.kind !== "idle") {
        wsRef.current?.send(JSON.stringify({ type: "call-end", to: signal.from }));
        return;
      }
      // If we get an offer while sitting on the list view, jump into the chat with the caller
      if (signal.from && signal.from !== recipient) {
        selectRecipient(signal.from);
      }
      setCallState({ kind: "incoming", from: signal.from!, offer: signal.payload });
      return;
    }
    if (signal.type === "call-answer") {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(signal.payload);
      for (const c of pendingIceRef.current) {
        try { await pc.addIceCandidate(c); } catch (e) { console.error("addIceCandidate", e); }
      }
      pendingIceRef.current = [];
      if (callState.kind === "outgoing") {
        setCallState({ kind: "active", peer: callState.to });
      }
      return;
    }
    if (signal.type === "call-ice") {
      const pc = pcRef.current;
      if (pc) {
        if (pc.remoteDescription) {
          try { await pc.addIceCandidate(signal.payload); } catch (e) { console.error("addIceCandidate", e); }
        } else {
          pendingIceRef.current.push(signal.payload);
        }
      }
      return;
    }
    if (signal.type === "call-end") {
      if (callState.kind === "outgoing") setCallNotice(`${callState.to} is busy or declined the call`);
      else if (callState.kind === "incoming") setCallNotice(`${callState.from} canceled the call`);
      else if (callState.kind === "active") setCallNotice(`${callState.peer} ended the call`);
      teardownCall();
      return;
    }
  }

  // Keep the ref pointing at the latest closure of handleSignal
  useEffect(() => {
    handleSignalRef.current = handleSignal;
  });

  // Auto-dismiss the call notice
  useEffect(() => {
    if (!callNotice) return;
    const id = setTimeout(() => setCallNotice(null), 4000);
    return () => clearTimeout(id);
  }, [callNotice]);

  // Page Visibility → push trigger
  useEffect(() => {
    if (!token) return;
    const onVisibility = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "visibility",
          state: document.hidden ? "hidden" : "visible",
        }));
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [token]);

  // ── render ──────────────────────────────────────────────────────

  if (showSplash) return <Splash />;

  if (!token) {
    return (
      <AuthView
        mode={mode}
        username={username}
        password={password}
        error={error}
        onUsernameChange={setUsername}
        onPasswordChange={setPassword}
        onSubmit={handleSubmit}
        onModeChange={(next) => {
          setMode(next);
          setError(null);
        }}
      />
    );
  }

  return (
    <AppShell>
      {callNotice && <CallNoticeBanner message={callNotice} />}

      {callState.kind === "incoming" && (
        <IncomingCallModal
          from={callState.from}
          onAccept={acceptCall}
          onReject={rejectCall}
        />
      )}

      {view === "settings" && (
        <SettingsView
          me={me}
          pushEnabled={pushEnabled}
          pushError={pushError}
          isBrave={isBrave}
          onBack={() => setView("list")}
          onEnableNotifications={handleEnableNotifications}
          onLogout={handleLogout}
        />
      )}

      {view === "chat" && recipient && (
        <ConversationView
          peer={recipient}
          me={me}
          token={token}
          messages={messages}
          input={input}
          onInputChange={setInput}
          onSend={send}
          onSendMedia={sendMedia}
          onMarkSnapViewed={markSnapViewed}
          recipientPublicKeyReady={!!recipientPublicKey}
          replyTo={replyTo}
          onStartReply={setReplyTo}
          onCancelReply={() => setReplyTo(null)}
          callState={callState}
          localStream={localStream}
          remoteStream={remoteStream}
          onStartCall={startCall}
          onHangUp={hangUp}
          onBack={() => {
            setView("list");
            setRecipient("");
            setReplyTo(null);
          }}
        />
      )}

      {(view === "list" || (view === "chat" && !recipient)) && (
        <ChatListView
          me={me}
          users={users}
          recipient={recipient}
          onSelectUser={selectRecipient}
          onOpenSettings={() => setView("settings")}
        />
      )}
    </AppShell>
  );
}

export default App;
