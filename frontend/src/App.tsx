import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { get, set } from "idb-keyval";
import {
  ensureKeyPair,
  fetchPublicKey,
  encryptMessage,
  decryptMessage,
} from "./crypto";
import { enableNotifications, hasExistingSubscription } from "./push";
import { createPeerConnection, type CallSignal } from "./webrtc";
import type { ChatMessage, CallState, CallMode, UserProfile, FriendRequest } from "./types";
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
import { VideoCallScreen } from "./components/VideoCallScreen";

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
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [meProfile, setMeProfile] = useState<UserProfile | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  // ── friend requests ─────────────────────────────────────────────
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);

  // ── routing (React Router) ───────────────────────────────────────
  const navigate = useNavigate();
  const location = useLocation();
  const chatMatch = /^\/chat\/(.+)$/.exec(location.pathname);
  const recipient = chatMatch ? decodeURIComponent(chatMatch[1]) : "";
  const view = location.pathname === "/settings" ? "settings"
             : chatMatch                          ? "chat"
             :                                     "list";

  const [showSplash, setShowSplash] = useState(true);
  const [callMinimized, setCallMinimized] = useState(false);

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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  function handleLogout() {
    localStorage.removeItem("token");
    setToken(null);
    setMessages([]);
    setUsers([]);
    setPrivateKey(null);
    setMyPublicKey(null);
    setRecipientPublicKey(null);
    navigate("/");
    wsRef.current?.close();
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
            setRecipientPublicKey(null);
            setMessages([]);
            setReplyTo(null);
            navigate(`/chat/${encodeURIComponent(profile.username)}`, { replace: true });
            fetchPublicKey(profile.username, token!)
              .then(key => setRecipientPublicKey(key))
              .catch(console.error);
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

  // WebSocket lifecycle: connects on login, reconnects with exponential backoff on drop
  useEffect(() => {
    if (!token) return;

    let destroyed = false;
    let retryDelay = 1_000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (destroyed) return;
      const ws = new WebSocket(wsURL(`/ws/chat?token=${token}`));
      wsRef.current = ws;

      ws.onopen = () => {
        retryDelay = 1_000;
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
  }, [token]);

  // ── recipient selection (from list view) ────────────────────────
  async function selectRecipient(user: string) {
    setRecipientPublicKey(null);
    setMessages([]);
    setReplyTo(null);
    navigate(`/chat/${encodeURIComponent(user)}`);
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
      });
      setLocalStream(stream);
      return stream;
    } catch (err) {
      console.error("Camera/mic permission denied or unavailable", err);
      return null;
    }
  }

  async function startMicrophone() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      setLocalStream(stream);
      return stream;
    } catch (err) {
      console.error("Microphone permission denied or unavailable", err);
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
    setCallMinimized(false);
    setIsMuted(false);
    setIsCameraOff(false);
  }

  function toggleMute() {
    if (!localStream) return;
    const audioTracks = localStream.getAudioTracks();
    const next = !isMuted;
    audioTracks.forEach((t) => (t.enabled = !next));
    setIsMuted(next);
  }

  function toggleCamera() {
    if (!localStream) return;
    const videoTracks = localStream.getVideoTracks();
    const next = !isCameraOff;
    videoTracks.forEach((t) => (t.enabled = !next));
    setIsCameraOff(next);
  }

  async function flipCamera() {
    if (!localStream) return;
    const currentTrack = localStream.getVideoTracks()[0];
    if (!currentTrack) return;
    const settings = currentTrack.getSettings();
    const newFacing = settings.facingMode === "environment" ? "user" : "environment";
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: newFacing } },
        audio: false,
      });
      const newTrack = newStream.getVideoTracks()[0];
      localStream.removeTrack(currentTrack);
      localStream.addTrack(newTrack);
      currentTrack.stop();
      const pc = pcRef.current;
      if (pc) {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) await sender.replaceTrack(newTrack);
      }
      setLocalStream(new MediaStream([...localStream.getTracks()]));
    } catch (err) {
      console.error("Flip camera failed (device may only have one camera)", err);
    }
  }

  async function startCall(mode: CallMode) {
    if (!recipient || !wsRef.current) return;
    if (callState.kind !== "idle") return;
    setCallState({ kind: "outgoing", to: recipient, mode });

    let stream = localStream;
    if (!stream) {
      stream = mode === "video" ? await startCamera() : await startMicrophone();
      if (!stream) {
        setCallState({ kind: "idle" });
        return;
      }
    }

    const pc = await createPeerConnection(wsRef.current, recipient, token, setRemoteStream);
    pcRef.current = pc;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream!));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsRef.current.send(JSON.stringify({ type: "call-offer", to: recipient, payload: offer, mode }));
  }

  async function acceptCall() {
    if (callState.kind !== "incoming") return;
    if (!wsRef.current) return;
    const { from, offer, mode } = callState;

    let stream = localStream;
    if (!stream) {
      stream = mode === "video" ? await startCamera() : await startMicrophone();
      if (!stream) {
        wsRef.current.send(JSON.stringify({ type: "call-end", to: from }));
        setCallState({ kind: "idle" });
        return;
      }
    }

    const pc = await createPeerConnection(wsRef.current, from, token, setRemoteStream);
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
    setCallState({ kind: "active", peer: from, mode });
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
      const mode: CallMode = (signal.type === "call-offer" && signal.mode) ? signal.mode : "video";
      setCallState({ kind: "incoming", from: signal.from!, offer: signal.payload, mode });
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
        setCallState({ kind: "active", peer: callState.to, mode: callState.mode });
      }
      return;
    }
    if (signal.type === "call-ice") {
      const pc = pcRef.current;
      if (pc && pc.remoteDescription) {
        // PC exists and remote description is set — add directly
        try { await pc.addIceCandidate(signal.payload); } catch (e) { console.error("addIceCandidate", e); }
      } else {
        // Either: (a) PC hasn't been created yet (incoming call not yet
        // accepted), or (b) remote description hasn't been set yet.
        // Queue for later — acceptCall / call-answer handler will flush.
        pendingIceRef.current.push(signal.payload);
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
      {callNotice && <CallNoticeBanner message={callNotice} />}

      {callState.kind === "incoming" && (
        <IncomingCallModal
          from={callState.from}
          mode={callState.mode}
          onAccept={acceptCall}
          onReject={rejectCall}
        />
      )}

      {(callState.kind === "outgoing" || callState.kind === "active") && !callMinimized && (
        <VideoCallScreen
          peer={callState.kind === "outgoing" ? callState.to : callState.peer}
          callKind={callState.kind}
          callMode={callState.mode}
          localStream={localStream}
          remoteStream={remoteStream}
          onHangUp={hangUp}
          onMinimize={() => setCallMinimized(true)}
          onToggleMute={toggleMute}
          onToggleCamera={toggleCamera}
          onFlipCamera={flipCamera}
          isMuted={isMuted}
          isCameraOff={isCameraOff}
        />
      )}

      {(callState.kind === "outgoing" || callState.kind === "active") && callMinimized && (
        <div
          className="fixed bottom-20 left-4 right-4 z-50 bg-[#0b0f14] rounded-2xl shadow-2xl flex items-center gap-3 px-4 py-3 border border-white/10"
          onClick={() => setCallMinimized(false)}
          style={{ cursor: "pointer" }}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-base shrink-0"
            style={{ background: "#3b82f6" }}
          >
            {(callState.kind === "outgoing" ? callState.to : callState.peer)[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold truncate">
              {callState.kind === "outgoing" ? callState.to : callState.peer}
            </p>
            <p className="text-white/50 text-xs">
              {callState.kind === "active" ? "Tap to return" : "Calling…"}
            </p>
          </div>
          <button
            onClick={e => { e.stopPropagation(); hangUp(); }}
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "#ef4444" }}
            aria-label="End call"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" style={{ transform: "rotate(135deg)" }}>
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
        </div>
      )}

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
        />
      )}

      {view === "chat" && recipient && (
        <ConversationView
          peer={recipient}
          peerProfile={users.find(u => u.username === recipient)}
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
          onStartVoiceCall={() => startCall("audio")}
          onStartVideoCall={() => startCall("video")}
          onHangUp={hangUp}
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
