import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { get, set } from "idb-keyval";
import {
  ensureKeyPair,
  encryptMessage,
  decryptMessage,
} from "./crypto";
import { isSendBlocked, noteIdentitySeen, resolveContactKeys } from "./lib/fingerprint";
import { initSignal } from "./lib/signal/device";
import { SignalClient, type SendExtras, type V2Meta } from "./lib/signal/client";
import { NotV2Error } from "./lib/signal/messaging";
import { getLegacyCache, getMessages, isEmpty as v2HistoryEmpty, mergeHistory, migrateHistory, patchMessage, setLegacyCache } from "./lib/messageStore";
import { fetchBackupMeta, isRestoreDismissed, maybeAutoBackup } from "./lib/backup";
import { disableNotifications, enableNotifications, hasExistingSubscription } from "./push";
import type { CallSignal } from "./webrtc";
import type { ChatMessage, UserProfile, FriendRequest } from "./types";
import { getUsername, getTokenExpiryMs, isTokenExpired } from "./lib/auth";
import { logIn, signUp, unlockKeyMaterial } from "./lib/credentials";
import { uploadMedia, buildMediaEnvelope, parseMediaEnvelope } from "./lib/media";
import { apiBase, wsURL } from "./lib/config";

import { AppShell } from "./components/AppShell";
import { Splash } from "./components/Splash";
import { AuthView } from "./components/AuthView";
import { ChatListView } from "./components/ChatListView";
import { ConversationView } from "./components/ConversationView";
import { SettingsView } from "./components/SettingsView";
import { CallLayer } from "./components/call/CallLayer";
import { useCall } from "./lib/call/useCall";
import { UnlockKeyView } from "./components/UnlockKeyView";
import { BackupSettings } from "./components/BackupSettings";
import { DevicesSettings } from "./components/DevicesSettings";
import { RestoreBackupPrompt } from "./components/RestoreBackupPrompt";

// Shown in place of a message we can't open with the current key. Kept as a
// constant so the cache layer can recognise (and refuse to persist) failures.
const UNDECRYPTABLE = "🔒 Encrypted with a different key — can't be read on this device";

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
  const [authBusy, setAuthBusy] = useState(false);

  // ── chat state ──────────────────────────────────────────────────
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [meProfile, setMeProfile] = useState<UserProfile | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // ── crypto state ────────────────────────────────────────────────
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [myPublicKey, setMyPublicKey] = useState<CryptoKey | null>(null);
  // The open contact's keys, tagged with whom they belong to so a stale key can
  // never pair with a newly opened conversation (see the derivation below).
  const [contactKeys, setContactKeys] =
    useState<{ peer: string; rsaKey: CryptoKey | null; identityKey: ArrayBuffer | null } | null>(null);
  // Set when the keypair can't be unlocked because no password is in memory
  // (e.g. reopening the app on a persisted token with IndexedDB evicted), which
  // routes the user to UnlockKeyView instead of a silently-broken session.
  const [needsKeyPassword, setNeedsKeyPassword] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  // In-memory secret (derived from the password at login/unlock) that unwraps the
  // private-key backup. Never persisted and never sent to the server.
  const [keyMaterial, setKeyMaterial] = useState<CryptoKey | null>(null);

  // ── Signal-protocol state (v2, forward-secret messaging) ────────
  // The client lives in a ref (it's read by the long-lived WS handler); the device
  // id is state so the socket reconnects as that device once it's registered.
  const signalRef = useRef<SignalClient | null>(null);
  const [signalDeviceId, setSignalDeviceId] = useState<number | null>(null);
  const [offerRestore, setOfferRestore] = useState(false);
  // Bumped after a backup restore so the open conversation reloads local history.
  const [historyVersion, setHistoryVersion] = useState(0);

  // ── push / brave state ──────────────────────────────────────────
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [isBrave, setIsBrave] = useState(false);

  // ── call state (all call logic lives in useCall) ──────────────
  const handleSignalRef = useRef<((s: CallSignal) => Promise<void>) | null>(null);
  const callSocketOpenRef = useRef<(() => void) | null>(null);
  const call = useCall({ token, wsRef, onAccepted: (peer) => selectRecipientRef.current?.(peer) });
  const callState = call.state;
  const selectRecipientRef = useRef<((user: string) => void) | null>(null);

  // ── friend requests ─────────────────────────────────────────────
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  // Open conversation's live status (all metadata the server already relays).
  // Keyed by peer, like contactKeys, so switching chats needs no reset.
  const [peerLive, setPeerLive] = useState<{ peer: string; online: boolean; typing: boolean; readAt: number }>(
    { peer: "", online: false, typing: false, readAt: 0 });
  const updatePeerLive = useCallback((peer: string, patch: Partial<{ online: boolean; typing: boolean; readAt: number }>) => {
    setPeerLive((prev) => ({ ...(prev.peer === peer ? prev : { peer, online: false, typing: false, readAt: 0 }), ...patch }));
  }, []);
  const typingSentAtRef = useRef(0);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── routing (React Router) ───────────────────────────────────────
  const navigate = useNavigate();
  const location = useLocation();
  const chatMatch = /^\/chat\/(.+)$/.exec(location.pathname);
  const recipient = chatMatch ? decodeURIComponent(chatMatch[1]) : "";
  const recipientPublicKey = contactKeys?.peer === recipient ? contactKeys.rsaKey : null;
  const recipientIdentity = contactKeys?.peer === recipient ? contactKeys.identityKey : null;
  const view = location.pathname === "/settings" ? "settings"
             : chatMatch                          ? "chat"
             :                                     "list";

  const [showSplash, setShowSplash] = useState(true);

  // Refs read by the long-lived ws.onmessage handler. Synced by a deps-less effect
  // below so the WS effect's deps stay [token] (no reconnect on sidebar clicks).
  const recipientRef = useRef<string>("");
  const decryptIncomingRef = useRef<((m: ChatMessage) => Promise<ChatMessage>) | null>(null);
  const meRef = useRef<string | null>(null);
  const handleDeviceRevokedRef = useRef<(() => Promise<void>) | null>(null);
  const refreshFriendsRef = useRef<(() => void) | null>(null);

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
    setAuthBusy(true);
    try {
      // The password stays in the browser: it's stretched into an authKey (sent
      // to the server) and a separate key-unlock secret (kept in memory).
      const session = mode === "signup"
        ? await signUp(username, password)
        : await logIn(username, password);
      localStorage.setItem("token", session.token);
      setKeyMaterial(session.master);
      setPassword("");
      setToken(session.token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleUnlock(pw: string) {
    if (!token || !me) return;
    setKeyError(null);
    setUnlocking(true);
    try {
      setKeyMaterial(await unlockKeyMaterial(me, pw, token));
    } catch (err: unknown) {
      const wrongPassword = err instanceof Error && err.name === "OperationError";
      setKeyError(wrongPassword
        ? "That password didn't unlock your messages. Try again."
        : err instanceof Error ? err.message : "Couldn't unlock your messages");
    } finally {
      setUnlocking(false);
    }
  }

  function handleLogout() {
    if (token) void disableNotifications(token);
    localStorage.removeItem("token");
    setToken(null);
    setMessages([]);
    setUsers([]);
    setPrivateKey(null);
    setMyPublicKey(null);
    setContactKeys(null);
    setKeyMaterial(null);
    setNeedsKeyPassword(false);
    setKeyError(null);
    signalRef.current?.dispose();
    signalRef.current = null;
    setSignalDeviceId(null);
    setOfferRestore(false);
    navigate("/");
    wsRef.current?.close();
  }

  // This device was removed from the account (on another device). Forget its
  // Signal state — including the identity copy — so setting it up again needs
  // the password, not just the still-valid login token.
  async function handleDeviceRevoked() {
    const client = signalRef.current;
    signalRef.current = null;
    client?.dispose();
    await client?.ctx.store.wipe();
    setSignalDeviceId(null);
    setKeyMaterial(null);
    setKeyError("This device was removed from your account. Enter your password to set it up again.");
    setNeedsKeyPassword(true);
  }

  async function handleEnableNotifications() {
    if (!token) return;
    setPushError(null);
    try {
      await enableNotifications(token);
      setPushEnabled(true);
    } catch (err: unknown) {
      setPushError(err instanceof Error ? err.message : "Failed to enable notifications");
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
      setTimeout(() => {
        localStorage.removeItem("token");
        setToken(null);
      }, 0);
    }
  }, [token]);

  // `keyMaterial` IS a dep: on a persisted-token boot it starts null, and the
  // UnlockKeyView sets it later — re-running this effect to unlock the key.
  // Branch 1 (key already in IndexedDB) makes the common reload path a cheap no-op.
  useEffect(() => {
    if (!token || !me) return;
    let cancelled = false;
    ensureKeyPair(me, keyMaterial, token)
      .then(({ privateKey, publicKey }) => {
        if (cancelled) return;
        setPrivateKey(privateKey);
        setMyPublicKey(publicKey);
        setNeedsKeyPassword(false);
        setKeyError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = String(err?.message ?? err);
        const needsPassword = /Password required/.test(message); // IDB empty + no password yet
        const wrongPassword = err?.name === "OperationError";    // backup wouldn't decrypt
        if (needsPassword || wrongPassword) {
          setNeedsKeyPassword(true);
          setKeyError(wrongPassword ? "That password didn't unlock your messages. Try again." : null);
        } else {
          console.error("Key setup failed:", err);
        }
      });
    return () => { cancelled = true; };
  }, [token, me, keyMaterial]);

  // Signal device setup, after the legacy key (it cross-signs the new identity).
  // Re-runs on unlock (keyMaterial) — cheap when the device is already set up.
  useEffect(() => {
    if (!token || !me || !privateKey) return;
    let cancelled = false;
    initSignal(me, keyMaterial, token)
      .then(async (ctx) => {
        if (cancelled) return;
        // Identity keys seen in incoming sessions go through the same pin check.
        ctx.store.onIdentity((contact, key) => noteIdentitySeen(me, contact, key, token).catch(console.error));
        signalRef.current?.dispose();
        signalRef.current = new SignalClient(ctx, token, () => wsRef.current);
        setSignalDeviceId(ctx.deviceId);
        maybeAutoBackup(me, token);
        // New device with empty history and a backup on the server → offer a restore.
        if (ctx.freshDevice && (await v2HistoryEmpty(me)) && !(await isRestoreDismissed(me))) {
          const meta = await fetchBackupMeta(token).catch(() => null);
          if (!cancelled && meta?.exists) setOfferRestore(true);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (/Password required/.test(String(err?.message ?? err))) {
          setNeedsKeyPassword(true);
        } else {
          // Not fatal: this device keeps working with legacy (v1) encryption.
          console.error("Secure-messaging setup failed; using legacy encryption", err);
        }
      });
    return () => { cancelled = true; };
  }, [token, me, privateKey, keyMaterial]);

  // Encrypt any plaintext history left by older builds, including conversations
  // that are never opened again (opened ones are migrated on first read anyway).
  useEffect(() => {
    if (!me) return;
    migrateHistory(me).catch((err) => console.error("History encryption migration failed", err));
  }, [me]);

  useEffect(() => {
    if (!token) return;

    if (me) {
      get<UserProfile[]>(`users_list_${me}`).then((cached) => {
        if (cached && cached.length > 0) {
          setUsers((prev) => prev.length === 0 ? cached : prev);
        }
      }).catch(console.error);
    }

    fetch(`${apiBase}/api/users`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((list: UserProfile[]) => {
        setUsers(list);
        if (me) set(`users_list_${me}`, list).catch(console.error);
      })
      .catch(() => { /* offline silently handled */ });

    fetch(`${apiBase}/api/users/${me}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(res => res.ok ? res.json() : undefined)
      .then(profile => {
        if (profile) setMeProfile(profile);
      }).catch(console.error);

    // check URL for ?add=<shareId> parameter
    const params = new URLSearchParams(window.location.search);
    const shareIdToAdd = params.get("add");
    if (shareIdToAdd) {
      fetch(`${apiBase}/api/users/by-share/${shareIdToAdd}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(res => res.ok ? res.json() : null)
        .then(profile => {
          if (profile) {
            setUsers(prev =>
              prev.find(u => u.username === profile.username) ? prev : [profile, ...prev]
            );
            setContactKeys(null);
            setMessages([]);
            setReplyTo(null);
            navigate(`/chat/${encodeURIComponent(profile.username)}`, { replace: true });
          } else {
            navigate("/", { replace: true });
          }
        })
        .catch(console.error);
    }

    // fetch pending friend requests
    fetch(`${apiBase}/api/friends/requests/incoming`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.ok ? res.json() : [])
      .then(setFriendRequests)
      .catch(console.error);
  }, [token, me, navigate]);

  // ── decrypt one incoming/historical message ─────────────────────
  const decryptIncoming = useCallback(
    async (msg: ChatMessage): Promise<ChatMessage> => {
      // v2 rows are metadata only; their content comes from local history.
      if (!privateKey || msg.v === 2) return msg;
      const encryptedKey =
        msg.from === me ? msg.encryptedKeyForSender : msg.encryptedKeyForRecipient;
      if (!encryptedKey) return msg;
      try {
        const plaintext = await decryptMessage(msg.content, encryptedKey, privateKey);
        // E2E media: the decrypted content is an envelope carrying the blob key,
        // the real MIME type, and the caption.
        const envelope = msg.mediaId ? parseMediaEnvelope(plaintext) : null;
        if (envelope) {
          return { ...msg, content: envelope.caption, mediaKey: envelope.key, mimeType: envelope.mime };
        }
        return { ...msg, content: plaintext };
      } catch (err) {
        console.error("Decryption failed", err);
        return { ...msg, content: UNDECRYPTABLE };
      }
    },
    [privateKey, me],
  );

  // Fetch + decrypt conversation history when recipient changes
  useEffect(() => {
    if (!token || !recipient.trim() || !privateKey || !me) return;

    let cancelled = false;
    // Offline-first: the display cache (legacy) merged with local v2 history,
    // which is authoritative for forward-secret messages.
    Promise.all([getLegacyCache(me, recipient), getMessages(me, recipient)]).then(([cached, localV2]) => {
      const local = mergeHistory(cached.filter((m) => m.v !== 2), localV2);
      if (!cancelled && local.length > 0) {
        setMessages((prev) => prev.length === 0 ? local : prev);
      }
    }).catch(console.error);

    fetch(`${apiBase}/api/messages?with=${encodeURIComponent(recipient)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then(async (history: ChatMessage[]) => {
        const decrypted = await Promise.all(history.map(decryptIncoming));
        const merged = mergeHistory(decrypted, await getMessages(me, recipient));
        if (cancelled) return;
        setMessages(merged);
        const readTimes = history
          .filter((m) => m.from === me && m.readAt)
          .map((m) => Date.parse(m.readAt!));
        updatePeerLive(recipient, { readAt: readTimes.length ? Math.max(...readTimes) : 0 });
        if (history.some((m) => m.from === recipient && !m.readAt)) sendRead(recipient);
        // Don't poison the cache with decrypt failures — otherwise broken bubbles
        // persist and reappear even after the key is fixed. Only cache clean decrypts.
        const legacy = decrypted.filter((m) => m.v !== 2);
        if (!legacy.some((m) => m.content === UNDECRYPTABLE)) {
          setLegacyCache(me, recipient, legacy).catch(console.error);
        }
      })
      .catch(() => { /* serve via offline cache silently */ });
    return () => { cancelled = true; };
  }, [token, recipient, privateKey, decryptIncoming, me, historyVersion, updatePeerLive]);

  // Resolve the open conversation's keys from the route, so a reload or deep
  // link to /chat/:user works the same as tapping the contact in the list.
  useEffect(() => {
    if (!token || !me || !recipient) return;
    let cancelled = false;
    resolveContactKeys(me, recipient, token)
      .then(({ rsaKey, identityKey }) => {
        if (!cancelled) setContactKeys({ peer: recipient, rsaKey, identityKey });
      })
      .catch((err) => console.error(`No key for ${recipient}:`, err));
    return () => { cancelled = true; };
  }, [token, me, recipient]);

  // Tell the server we've seen `peer`'s messages (only while actually looking).
  function sendRead(peer: string) {
    if (!peer || document.hidden || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "read", from: peer }));
  }

  function sendTyping(state: "start" | "stop") {
    if (!recipient || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "typing", to: recipient, state }));
  }

  // Throttled "typing" while the user types; "stop" after a pause.
  function handleInputChange(value: string) {
    setInput(value);
    if (!value.trim()) {
      if (typingSentAtRef.current) { typingSentAtRef.current = 0; sendTyping("stop"); }
      return;
    }
    if (Date.now() - typingSentAtRef.current > 2500) {
      typingSentAtRef.current = Date.now();
      sendTyping("start");
    }
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = setTimeout(() => {
      typingSentAtRef.current = 0;
      sendTyping("stop");
    }, 3000);
  }

  // New conversation → ask whether the peer is online.
  useEffect(() => {
    if (recipient && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "presence-query", user: recipient }));
    }
  }, [recipient]);

  // Add (or update in place) one message in the open conversation.
  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => {
      const i = prev.findIndex((m) =>
        (message.id != null && m.id === message.id) || (!!message.clientId && m.clientId === message.clientId));
      return i < 0 ? [...prev, message] : prev.map((m, j) => (j === i ? message : m));
    });
  }, []);

  // Re-pull the friend list and pending requests (server nudges with "friends-changed").
  const refreshFriends = useCallback(() => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    fetch(`${apiBase}/api/users`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((list: UserProfile[] | null) => {
        if (!list) return;
        setUsers(list);
        if (me) set(`users_list_${me}`, list).catch(console.error);
      })
      .catch(console.error);
    fetch(`${apiBase}/api/friends/requests/incoming`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((reqs: FriendRequest[] | null) => { if (reqs) setFriendRequests(reqs); })
      .catch(console.error);
  }, [token, me]);

  // Sync refs read by ws.onmessage
  useEffect(() => {
    recipientRef.current = recipient;
    decryptIncomingRef.current = decryptIncoming;
    meRef.current = me;
    handleDeviceRevokedRef.current = handleDeviceRevoked;
    refreshFriendsRef.current = refreshFriends;
  });

  // WebSocket lifecycle: connects on login, reconnects with exponential backoff on drop
  useEffect(() => {
    if (!token) return;

    let destroyed = false;
    let retryDelay = 1_000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (destroyed) return;
      // Connecting AS a Signal device lets the server route per-device envelopes here.
      const device = signalDeviceId ? `&device=${signalDeviceId}` : "";
      const ws = new WebSocket(wsURL(`/ws/chat?token=${token}${device}`));
      wsRef.current = ws;

      ws.onopen = () => {
        retryDelay = 1_000;
        ws.send(JSON.stringify({
          type: "visibility",
          state: document.hidden ? "hidden" : "visible",
        }));
        // Pull envelopes queued while this device was offline.
        if (signalDeviceId) ws.send(JSON.stringify({ type: "sync" }));
        if (recipientRef.current) ws.send(JSON.stringify({ type: "presence-query", user: recipientRef.current }));
        callSocketOpenRef.current?.();
      };

      ws.onmessage = async (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && typeof data.type === "string" && data.type.startsWith("call-")) {
            await handleSignalRef.current?.(data as CallSignal);
            return;
          }
          if (signalRef.current?.handleReply(data)) return;
          if (data?.type === "device-revoked") {
            await handleDeviceRevokedRef.current?.();
            return;
          }
          if (data?.type === "friends-changed") {
            refreshFriendsRef.current?.();
            return;
          }
          if (data?.type === "presence") {
            if (data.user === recipientRef.current) updatePeerLive(data.user, { online: !!data.online });
            return;
          }
          if (data?.type === "typing") {
            if (data.from !== recipientRef.current) return;
            const peer = data.from as string;
            const typing = data.state !== "stop";
            updatePeerLive(peer, { typing });
            if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
            // A lost "stop" mustn't leave "typing..." up forever.
            if (typing) peerTypingTimerRef.current = setTimeout(() => updatePeerLive(peer, { typing: false }), 6000);
            return;
          }
          if (data?.type === "read-receipt") {
            if (data.by === recipientRef.current) updatePeerLive(data.by, { readAt: Date.now() });
            return;
          }
          if (data?.type === "envelope") {
            const client = signalRef.current;
            if (!client) return; // not acked → redelivered on the next sync
            const { peer, message } = await client.open(data as { envType: number; body: string; message: V2Meta });
            // Persisted before the ack, so a crash can't lose a forward-secret message.
            ws.send(JSON.stringify({ type: "ack", ids: [data.envelopeId] }));
            if (peer === recipientRef.current) {
              appendMessage(message);
              if (message.from === peer) { updatePeerLive(peer, { typing: false }); sendRead(peer); }
            }
            return;
          }
          const msg = data as ChatMessage;
          const currentMe = meRef.current;
          const currentRecipient = recipientRef.current;
          const isCurrentChat =
            (msg.from === currentMe && msg.to === currentRecipient) ||
            (msg.from === currentRecipient && msg.to === currentMe);
          if (isCurrentChat && decryptIncomingRef.current) {
            if (msg.from === currentRecipient) { updatePeerLive(currentRecipient, { typing: false }); sendRead(currentRecipient); }
            const decrypted = await decryptIncomingRef.current(msg);
            setMessages((prev) => {
              const next = [...prev, decrypted];
              // Skip caching if this message failed to decrypt (see history effect).
              if (currentMe && currentRecipient && decrypted.content !== UNDECRYPTABLE) {
                setLegacyCache(currentMe, currentRecipient, next).catch(console.error);
              }
              return next;
            });
          }
        } catch {
          // ignore non-JSON
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!destroyed) {
          retryTimer = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, 30_000);
            connect();
          }, retryDelay);
        }
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [token, signalDeviceId, appendMessage, updatePeerLive]);

  // ── recipient selection (from list view) ────────────────────────
  function selectRecipient(user: string) {
    setContactKeys(null);
    setMessages([]);
    setReplyTo(null);
    navigate(`/chat/${encodeURIComponent(user)}`);
  }

  /**
   * Try the forward-secret (v2) path. Returns the sent message, or null when the
   * recipient has no Signal devices (or this device isn't set up yet) and the
   * caller should fall back to a legacy send.
   * TODO(remove-legacy): once every client is v2, make this the only path.
   */
  async function sendV2(plaintext: string, extras: SendExtras): Promise<ChatMessage | null> {
    const client = signalRef.current;
    if (!client || !recipientIdentity) return null;
    try {
      const sent = await client.send(recipient, recipientIdentity, plaintext, extras);
      appendMessage(sent);
      return sent;
    } catch (err) {
      if (err instanceof NotV2Error) return null;
      throw err;
    }
  }

  // Legacy (v1): AES key RSA-wrapped for both accounts. Still E2E, no forward secrecy.
  function sendLegacy(enc: Awaited<ReturnType<typeof encryptMessage>>, extras: SendExtras) {
    if (wsRef.current?.readyState !== WebSocket.OPEN) throw new Error("Not connected");
    wsRef.current.send(
      JSON.stringify({
        to: recipient,
        content: enc.ciphertext,
        encryptedKeyForSender: enc.encryptedKeyForSender,
        encryptedKeyForRecipient: enc.encryptedKeyForRecipient,
        ...extras,
      }),
    );
  }

  // ── send chat message ───────────────────────────────────────────
  async function send() {
    if (input.trim() === "" || recipient.trim() === "") return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    // Never encrypt to a key the user hasn't accepted after a key change.
    if (!me || await isSendBlocked(me, recipient)) return;

    const text = input;
    const extras: SendExtras = { replyToId: replyTo?.id ?? null };
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    typingSentAtRef.current = 0;
    sendTyping("stop");
    try {
      if (!(await sendV2(text, extras))) {
        if (!myPublicKey || !recipientPublicKey) return;
        sendLegacy(await encryptMessage(text, myPublicKey, recipientPublicKey), extras);
      }
      setInput("");
      setReplyTo(null);
    } catch (err) {
      console.error("Send failed", err);
    }
  }

  // ── send a photo or video ───────────────────────────────────────
  // End-to-end: the file is AES-GCM encrypted in the browser and uploaded as an
  // opaque blob. Its key + real MIME type travel in an envelope that is encrypted
  // exactly like a text message, so the server only ever sees ciphertext and a
  // coarse "image/*" / "video/*" hint.
  // viewOnce=true marks the message as a snap; the server will delete the
  // encrypted file on the recipient's first GET.
  async function sendMedia(file: File, viewOnce: boolean) {
    if (!token || !recipient || wsRef.current?.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }
    if (!me || await isSendBlocked(me, recipient)) {
      throw new Error("Contact's security key changed — accept it before sending");
    }
    if (!(signalRef.current && recipientIdentity) && !(myPublicKey && recipientPublicKey)) {
      throw new Error("Encryption keys not ready");
    }
    const { mediaId, mimeType, wireMimeType, key } = await uploadMedia(file, token);
    // The blob key + real type ride inside the message, so they get the same
    // protection (v2: forward secrecy) as text.
    const envelope = buildMediaEnvelope(key, mimeType);
    const extras: SendExtras = { mediaId, mimeType: wireMimeType, viewOnce, replyToId: replyTo?.id ?? null };
    if (!(await sendV2(envelope, extras))) {
      if (!myPublicKey || !recipientPublicKey) throw new Error("Encryption keys not ready");
      sendLegacy(await encryptMessage(envelope, myPublicKey, recipientPublicKey), extras);
    }
    setReplyTo(null);
  }

  // After the recipient consumes a snap, flip its viewedAt locally so the
  // bubble switches to "Snap viewed" without waiting for a refetch.
  function markSnapViewed(key: string) {
    const matches = (m: ChatMessage) => `${m.from}|${m.sentAt}|${m.mediaId ?? ""}` === key;
    if (me && recipient) {
      patchMessage(me, recipient, (m) => matches(m) && !m.viewedAt, { viewedAt: new Date().toISOString() })
        .catch(console.error);
    }
    setMessages((prev) => {
      const next = prev.map((m) =>
        `${m.from}|${m.sentAt}|${m.mediaId ?? ""}` === key
          ? { ...m, viewedAt: m.viewedAt ?? new Date().toISOString() }
          : m,
      );
      if (me && recipient) {
        setLegacyCache(me, recipient, next).catch(console.error);
      }
      return next;
    });
  }

  // Keep the long-lived socket handlers pointed at the current call controller.
  useEffect(() => {
    handleSignalRef.current = call.handleSignal;
    callSocketOpenRef.current = call.onSocketOpen;
    selectRecipientRef.current = selectRecipient;
  });

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
      // Going to the background is a good moment for the (at most daily) backup.
      if (document.hidden && me) maybeAutoBackup(me, token);
      if (!document.hidden && recipientRef.current) sendRead(recipientRef.current);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [token, me]);

  // ── render ──────────────────────────────────────────────────────

  if (showSplash) return <Splash />;

  if (!token) {
    return (
      <AuthView
        mode={mode}
        username={username}
        password={password}
        error={error}
        busy={authBusy}
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

  // Logged in, but the private key couldn't be unlocked without a password
  // (persisted token + evicted IndexedDB). Recover by re-entering it — this runs
  // the password-derived restore and reuses the SAME key, never generates a new one.
  if (needsKeyPassword) {
    return (
      <UnlockKeyView
        me={me}
        error={keyError}
        busy={unlocking}
        onUnlock={handleUnlock}
        onLogout={handleLogout}
      />
    );
  }

  async function handleAcceptRequest(id: number) {
    if (!token) return;
    const res = await fetch(`${apiBase}/api/friends/requests/${id}/accept`, {
      method: "PUT", headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setFriendRequests(prev => prev.filter(r => r.id !== id));
      // refresh user list so the new friend appears
      fetch(`${apiBase}/api/users`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : [])
        .then(setUsers).catch(console.error);
    }
  }

  async function handleRejectRequest(id: number) {
    if (!token) return;
    const res = await fetch(`${apiBase}/api/friends/requests/${id}/reject`, {
      method: "PUT", headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setFriendRequests(prev => prev.filter(r => r.id !== id));
  }

  async function handleSendRequest(shareId: string) {
    if (!token) return;
    await fetch(`${apiBase}/api/friends/request`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ toShareId: shareId }),
    });
  }

  const handleUpdateProfile = async (preferredName: string, file: File | null) => {
    if (!token) return;
    
    let avatarUrl = meProfile?.avatarUrl;
    
    if (file) {
      const formData = new FormData();
      formData.append("file", file);
      
      const res = await fetch(`${apiBase}/api/media/profile`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error("Failed to upload profile picture");
      const data = await res.json();
      avatarUrl = data.mediaId;
    }

    const res2 = await fetch(`${apiBase}/api/users/profile`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ preferredName, avatarUrl }),
    });

    if (!res2.ok) throw new Error("Failed to update profile");
    
    const updatedProfile = await res2.json();
    setMeProfile(updatedProfile);
  };

  return (
    <AppShell>
      <CallLayer call={call} profileOf={(u) => users.find((x) => x.username === u)} />

      {view === "settings" && (
        <SettingsView
          me={me}
          meProfile={meProfile}
          shareId={meProfile?.shareId}
          pushEnabled={pushEnabled}
          pushError={pushError}
          isBrave={isBrave}
          onBack={() => navigate(-1)}
          onEnableNotifications={handleEnableNotifications}
          onLogout={handleLogout}
          onUpdateProfile={handleUpdateProfile}
        >
          {me && (
            <>
              <BackupSettings me={me} token={token} onRestored={() => setHistoryVersion((v) => v + 1)} />
              <DevicesSettings me={me} token={token} currentDeviceId={signalDeviceId} />
            </>
          )}
        </SettingsView>
      )}

      {offerRestore && me && (
        <RestoreBackupPrompt
          me={me}
          token={token}
          onDone={(restored) => {
            setOfferRestore(false);
            if (restored > 0) setHistoryVersion((v) => v + 1);
          }}
        />
      )}

      {view === "chat" && recipient && (
        <ConversationView
          peer={recipient}
          peerProfile={users.find(u => u.username === recipient)}
          online={peerLive.peer === recipient && peerLive.online}
          typing={peerLive.peer === recipient && peerLive.typing}
          peerReadAt={peerLive.peer === recipient ? peerLive.readAt : 0}
          me={me}
          token={token}
          messages={messages}
          input={input}
          onInputChange={handleInputChange}
          onSend={send}
          onSendMedia={sendMedia}
          onMarkSnapViewed={markSnapViewed}
          recipientPublicKeyReady={!!recipientPublicKey || (!!recipientIdentity && signalDeviceId !== null)}
          replyTo={replyTo}
          onStartReply={setReplyTo}
          onCancelReply={() => setReplyTo(null)}
          callState={callState}
          onStartVoiceCall={() => void call.startCall(recipient, "audio")}
          onStartVideoCall={() => void call.startCall(recipient, "video")}
          onHangUp={call.hangUp}
          onBack={() => navigate(-1)}
        />
      )}

      {(view === "list" || (view === "chat" && !recipient)) && (
        <ChatListView
          me={me}
          users={users}
          recipient={recipient}
          onSelectUser={selectRecipient}
          onOpenSettings={() => navigate("/settings")}
          friendRequests={friendRequests}
          onAcceptRequest={handleAcceptRequest}
          onRejectRequest={handleRejectRequest}
          onSendRequest={handleSendRequest}
        />
      )}
    </AppShell>
  );
}

export default App;
