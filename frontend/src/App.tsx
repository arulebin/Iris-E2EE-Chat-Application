import { useEffect, useRef, useState, useCallback } from "react";
import {
  ensureKeyPair,
  fetchPublicKey,
  encryptMessage,
  decryptMessage,
} from "./crypto";
import { enableNotifications, hasExistingSubscription } from "./push";
import { createPeerConnection, type CallSignal } from "./webrtc";

type ChatMessage = {
  from: string;
  to: string;
  content: string;
  encryptedKeyForSender?: string | null;
  encryptedKeyForRecipient?: string | null;
  sentAt: string;
};

type CallState =
  | { kind: 'idle' }
  | { kind: 'outgoing'; to: string }                              
  | { kind: 'incoming'; from: string; offer: RTCSessionDescriptionInit }  
  | { kind: 'active'; peer: string }    

function getUsername(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub as string;
  } catch {
    return null;
  }
}

function getTokenExpiryMs(token: string | null): number | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isTokenExpired(token: string | null): boolean {
  const expiryMs = getTokenExpiryMs(token);
  return expiryMs === null || expiryMs <= Date.now();
}

function App() {
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

  const [users, setUsers] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [recipient, setRecipient] = useState("");
  const [input, setInput] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [myPublicKey, setMyPublicKey] = useState<CryptoKey | null>(null);
  const [recipientPublicKey, setRecipientPublicKey] =
    useState<CryptoKey | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [isBrave, setIsBrave] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])                          
  const handleSignalRef = useRef<((s: CallSignal) => Promise<void>) | null>(null)
  const [callState, setCallState] = useState<CallState>({ kind: 'idle' })
  const [callNotice, setCallNotice] = useState<string | null>(null)
  // Refs that mirror state used inside ws.onmessage — kept in sync via a deps-less
  // useEffect below. Using refs lets the WS effect's deps stay [token] so the
  // socket only reconnects on login/logout, not on every sidebar click.
  const recipientRef = useRef<string>("")
  const decryptIncomingRef = useRef<((m: ChatMessage) => Promise<ChatMessage>) | null>(null)
  const meRef = useRef<string | null>(null)
  const me = getUsername(token);

  // ── auth handlers ────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch(`http://localhost:8080/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) throw new Error((await res.text()) || `${mode} failed`);

      let token: string;
      if (mode === "signup") {
        const loginRes = await fetch("http://localhost:8080/auth/login", {
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
  useEffect(() => {
    hasExistingSubscription().then(setPushEnabled);
  }, [token]);

  // ── Brave detection: their default settings block FCM push ─────────
  useEffect(() => {
    const nav = navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } };
    nav.brave?.isBrave?.().then(setIsBrave).catch(() => {});
  }, []);

  // ── auto-logout when the JWT hits its exp timestamp ───────────────
  useEffect(() => {
    if (!token) return;
    const expiryMs = getTokenExpiryMs(token);
    if (expiryMs === null) return;
    const id = setTimeout(() => {
      localStorage.removeItem("token");
      setToken(null);
    }, Math.max(0, expiryMs - Date.now()));
    return () => clearTimeout(id);
  }, [token]);

  function handleLogout() {
    localStorage.removeItem("token");
    setToken(null);
    setMessages([]);
    setUsers([]);
    setRecipient("");
    setPrivateKey(null);
    setMyPublicKey(null);
    setRecipientPublicKey(null);
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

  // ── ensure keypair after login ───────────────────────────────────
  // password is read from closure; intentionally not in deps so the effect
  // doesn't re-fire on every keystroke. After login it's already set; on
  // page reload IDB usually fast-paths branch 1 before the password matters.
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

  // ── handler: pick a recipient (clears stale key + fetches the new one) ──
  async function selectRecipient(user: string) {
    setRecipient(user);
    setRecipientPublicKey(null); // clear synchronously so a fast send can't use stale key
    if (!token) return;
    try {
      const key = await fetchPublicKey(user, token);
      setRecipientPublicKey(key);
    } catch (err) {
      console.error(`No key for ${user}:`, err);
    }
  }

  // ── decrypt one incoming/historical message ──────────────────────
  const decryptIncoming = useCallback(
    async (msg: ChatMessage): Promise<ChatMessage> => {
      if (!privateKey) return msg;
      const encryptedKey =
        msg.from === me
          ? msg.encryptedKeyForSender
          : msg.encryptedKeyForRecipient;
      if (!encryptedKey) return msg; // legacy / unencrypted
      try {
        const plaintext = await decryptMessage(
          msg.content,
          encryptedKey,
          privateKey,
        );
        return { ...msg, content: plaintext };
      } catch (err) {
        console.error("Decryption failed", err);
        return { ...msg, content: "🔒 [unable to decrypt]" };
      }
    },
    [privateKey, me],
  );

  // ── fetch user list on login ─────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    fetch("http://localhost:8080/api/users", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((list: string[]) => setUsers(list))
      .catch(() => setUsers([]));
  }, [token]);

  // ── fetch + decrypt conversation history when recipient changes ─
  useEffect(() => {
    if (!token || !recipient.trim() || !privateKey) return;
    fetch(
      `http://localhost:8080/api/messages?with=${encodeURIComponent(recipient)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    )
      .then((res) => (res.ok ? res.json() : []))
      .then(async (history: ChatMessage[]) => {
        const decrypted = await Promise.all(history.map(decryptIncoming));
        setMessages(decrypted);
      })
      .catch(() => setMessages([]));
  }, [token, recipient, privateKey, decryptIncoming]);

  // Sync the refs the WebSocket handler reads from. Deps-less so it runs every
  // render — same pattern as handleSignalRef. Keeps the WS effect from needing
  // recipient / decryptIncoming / me in its deps.
  useEffect(() => {
    recipientRef.current = recipient;
    decryptIncomingRef.current = decryptIncoming;
    meRef.current = me;
  });

  // ── WebSocket: connects once on login, stays up until logout ────
  useEffect(() => {
    if (!token) return;
    const ws = new WebSocket(`ws://localhost:8080/ws/chat?token=${token}`);
    wsRef.current = ws;
    ws.onopen = () => {
      console.log("connected");
      // Tell the server our initial visibility so push fires correctly for backgrounded tabs
      ws.send(JSON.stringify({
        type: 'visibility',
        state: document.hidden ? 'hidden' : 'visible',
      }));
    };
    ws.onclose = () => console.log("closed");
    ws.onerror = (e) => console.error("error", e);
    ws.onmessage = async (e) => {
      try {
        const data = JSON.parse(e.data);

        // ── WebRTC signaling ──
        if (data && typeof data.type === "string" && data.type.startsWith("call-")) {
          await handleSignalRef.current?.(data as CallSignal);
          return;
        }

        // ── chat ──
        const msg = data as ChatMessage;
        const currentMe = meRef.current;
        const currentRecipient = recipientRef.current;
        const isCurrentChat =
          (msg.from === currentMe && msg.to === currentRecipient) ||
          (msg.from === currentRecipient && msg.to === currentMe);
        if (isCurrentChat && decryptIncomingRef.current) {
          const decrypted = await decryptIncomingRef.current(msg);
          setMessages((prev) => [...prev, decrypted]);
        }
      } catch {
        // ignore non-JSON
      }
    };
    return () => ws.close();
  }, [token]);

  async function send() {
    if (input.trim() === "" || recipient.trim() === "") return;
    if (!myPublicKey || !recipientPublicKey) {
      console.warn("keys not ready yet");
      return;
    }
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    try {
      const enc = await encryptMessage(input, myPublicKey, recipientPublicKey);
      wsRef.current.send(
        JSON.stringify({
          to: recipient,
          content: enc.ciphertext,
          encryptedKeyForSender: enc.encryptedKeyForSender,
          encryptedKeyForRecipient: enc.encryptedKeyForRecipient,
        }),
      );
      setInput("");
    } catch (err) {
      console.error("Encryption failed", err);
    }
  }

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream])

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream
    }
  }, [remoteStream])

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      })
      setLocalStream(stream)
      return stream
    } catch (err) {
      console.error('Camera/mic permission denied or unavailable', err)
      return null
    }
  }

  function stopCamera() {
    localStream?.getTracks().forEach(track => track.stop())
    setLocalStream(null)
  }

  // ── WebRTC call lifecycle ───────────────────────────────────────

  /** Local cleanup. Caller is responsible for notifying the other side via call-end. */
  function teardownCall() {
    pcRef.current?.close()
    pcRef.current = null
    pendingIceRef.current = []
    setRemoteStream(null)
    stopCamera()
    setCallState({ kind: 'idle' })
  }

  /** Outgoing: alice clicks 📞 Call. */
  async function startCall() {
    if (!recipient || !wsRef.current) return
    if (callState.kind !== 'idle') return

    setCallState({ kind: 'outgoing', to: recipient })

    let stream = localStream
    if (!stream) {
      stream = await startCamera()
      if (!stream) {
        setCallState({ kind: 'idle' })
        return
      }
    }

    const pc = createPeerConnection(wsRef.current, recipient, setRemoteStream)
    pcRef.current = pc
    stream.getTracks().forEach((t) => pc.addTrack(t, stream!))

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    wsRef.current.send(
      JSON.stringify({ type: 'call-offer', to: recipient, payload: offer })
    )
  }

  /** Incoming-accept: bob clicks Accept on the modal. */
  async function acceptCall() {
    if (callState.kind !== 'incoming') return
    if (!wsRef.current) return
    const { from, offer } = callState

    let stream = localStream
    if (!stream) {
      stream = await startCamera()
      if (!stream) {
        wsRef.current.send(JSON.stringify({ type: 'call-end', to: from }))
        setCallState({ kind: 'idle' })
        return
      }
    }

    const pc = createPeerConnection(wsRef.current, from, setRemoteStream)
    pcRef.current = pc
    stream.getTracks().forEach((t) => pc.addTrack(t, stream!))

    await pc.setRemoteDescription(offer)

    for (const c of pendingIceRef.current) {
      try { await pc.addIceCandidate(c) } catch (e) { console.error('addIceCandidate', e) }
    }
    pendingIceRef.current = []

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    wsRef.current.send(JSON.stringify({ type: 'call-answer', to: from, payload: answer }))
    setCallState({ kind: 'active', peer: from })
  }

  /** Incoming-reject: bob declines without ever setting up a peer connection. */
  function rejectCall() {
    if (callState.kind !== 'incoming') return
    wsRef.current?.send(JSON.stringify({ type: 'call-end', to: callState.from }))
    setCallState({ kind: 'idle' })
  }

  /** Cancel an outgoing attempt OR hang up an active call. */
  function hangUp() {
    if (callState.kind === 'outgoing' || callState.kind === 'active') {
      const peer = callState.kind === 'outgoing' ? callState.to : callState.peer
      wsRef.current?.send(JSON.stringify({ type: 'call-end', to: peer }))
    }
    teardownCall()
  }

  async function handleSignal(signal: CallSignal) {
    if (signal.type === 'call-offer') {
      // Busy: politely decline if a call is already in progress
      if (callState.kind !== 'idle') {
        wsRef.current?.send(JSON.stringify({ type: 'call-end', to: signal.from }))
        return
      }
      setCallState({ kind: 'incoming', from: signal.from!, offer: signal.payload })
      return
    }

    if (signal.type === 'call-answer') {
      const pc = pcRef.current
      if (!pc) return
      await pc.setRemoteDescription(signal.payload)
      for (const c of pendingIceRef.current) {
        try { await pc.addIceCandidate(c) } catch (e) { console.error('addIceCandidate', e) }
      }
      pendingIceRef.current = []
      if (callState.kind === 'outgoing') {
        setCallState({ kind: 'active', peer: callState.to })
      }
      return
    }

    if (signal.type === 'call-ice') {
      const pc = pcRef.current
      if (pc && pc.remoteDescription) {
        try { await pc.addIceCandidate(signal.payload) } catch (e) { console.error('addIceCandidate', e) }
      } else {
        pendingIceRef.current.push(signal.payload)
      }
      return
    }

    if (signal.type === 'call-end') {
      // Surface a reason for the caller / receiver so the UI doesn't just go silent
      if (callState.kind === 'outgoing') {
        setCallNotice(`${callState.to} is busy or declined the call`)
      } else if (callState.kind === 'incoming') {
        setCallNotice(`${callState.from} canceled the call`)
      } else if (callState.kind === 'active') {
        setCallNotice(`${callState.peer} ended the call`)
      }
      teardownCall()
      return
    }
  }

  // ── auto-dismiss the call notice after 4 seconds ─────────────────
  useEffect(() => {
    if (!callNotice) return
    const id = setTimeout(() => setCallNotice(null), 4000)
    return () => clearTimeout(id)
  }, [callNotice])

  // ── Page Visibility: tell the server when this tab is backgrounded ─
  useEffect(() => {
    if (!token) return
    const onVisibility = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'visibility',
          state: document.hidden ? 'hidden' : 'visible',
        }))
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [token])


  // Keep the ref updated with the latest closure so ws.onmessage uses fresh state.
  useEffect(() => {
    handleSignalRef.current = handleSignal
  })
  
  // ── LOGIN / SIGNUP VIEW ──────────────────────────────────────────
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
          <h1 className="text-3xl font-bold text-slate-900">Iris</h1>
          <p className="text-slate-500 mb-6 text-sm">
            Private chat for you and your circle.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mb-4">
            {mode === "login" ? "Log in" : "Create account"}
          </h2>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              required
              autoFocus
              className="px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 rounded-lg transition"
            >
              {mode === "login" ? "Log in" : "Sign up"}
            </button>
          </form>

          {error && <p className="text-red-600 text-sm mt-3">{error}</p>}

          <p className="text-sm text-slate-500 mt-6 text-center">
            {mode === "login" ? "No account? " : "Already have one? "}
            <button
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setError(null);
              }}
              className="text-indigo-600 hover:underline"
            >
              {mode === "login" ? "Sign up" : "Log in"}
            </button>
          </p>
        </div>
      </div>
    );
  }

  // ── CHAT VIEW (sidebar + main panel) ─────────────────────────────
  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* SIDEBAR */}
      <aside className="w-64 border-r border-slate-200 bg-white flex flex-col">
        <div className="p-4 border-b border-slate-200">
          <h1 className="text-xl font-bold text-slate-900">Iris</h1>
          <p className="text-xs text-slate-500">
            Signed in as <span className="font-medium">{me}</span>
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {users.length === 0 ? (
            <p className="text-sm text-slate-400 px-3 py-2">
              No other users yet
            </p>
          ) : (
            users.map((u) => (
              <button
                key={u}
                onClick={() => selectRecipient(u)}
                className={`w-full text-left px-3 py-2 rounded-lg transition ${
                  recipient === u
                    ? "bg-indigo-100 text-indigo-700 font-medium"
                    : "hover:bg-slate-100 text-slate-700"
                }`}
              >
                {u}
              </button>
            ))
          )}
        </nav>
        <div className="p-4 border-t border-slate-200 flex flex-col gap-2">
          {!pushEnabled && (
            <button
              onClick={handleEnableNotifications}
              className="text-sm text-indigo-600 hover:underline text-left"
            >
              🔔 Enable notifications
            </button>
          )}
          {pushEnabled && (
            <p className="text-xs text-slate-400">🔔 Notifications on</p>
          )}
          {pushError && <p className="text-xs text-red-500">{pushError}</p>}
          {isBrave && !pushEnabled && (
            <p className="text-xs text-slate-500 leading-snug">
              Brave: enable Google services for push at{" "}
              <span className="font-mono">brave://settings/privacy</span>
            </p>
          )}
          <button
            onClick={handleLogout}
            className="text-sm text-slate-500 hover:text-slate-900 text-left"
          >
            Log out
          </button>
        </div>
      </aside>

      {/* TRANSIENT CALL NOTICE (busy / declined / hung up) */}
      {callNotice && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-4 py-2 rounded-lg shadow-lg z-40 text-sm">
          {callNotice}
        </div>
      )}

      {/* INCOMING CALL MODAL */}
      {callState.kind === 'incoming' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4">
            <h2 className="text-lg font-semibold text-slate-900">
              📞 Incoming call from {callState.from}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Camera and microphone will turn on if you accept.
            </p>
            <div className="flex gap-2 mt-4 justify-end">
              <button
                onClick={rejectCall}
                className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium"
              >
                Reject
              </button>
              <button
                onClick={acceptCall}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN */}
      <div className="flex-1 flex flex-col">
        <header className="border-b border-slate-200 bg-white px-6 py-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {recipient
              ? `Chat with ${recipient}`
              : "Select someone to chat with"}
          </h2>
          <div className="flex gap-2">
            {callState.kind === 'idle' && recipient && (
              <>
                <button
                  onClick={startCall}
                  className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-lg text-sm"
                >
                  📞 Call {recipient}
                </button>
                {localStream && (
                  <button
                    onClick={stopCamera}
                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1 rounded-lg text-sm"
                  >
                    Camera off
                  </button>
                )}
              </>
            )}
            {callState.kind === 'outgoing' && (
              <button
                onClick={hangUp}
                className="bg-slate-500 hover:bg-slate-600 text-white px-3 py-1 rounded-lg text-sm"
              >
                Cancel call to {callState.to}…
              </button>
            )}
            {callState.kind === 'active' && (
              <button
                onClick={hangUp}
                className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-lg text-sm"
              >
                Hang up
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-6 py-4">
          {(localStream || remoteStream) && (
            <div className="max-w-2xl mx-auto mb-4 grid grid-cols-2 gap-2">
              {remoteStream && (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full rounded-lg bg-black aspect-video"
                />
              )}
              {localStream && (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full rounded-lg bg-black aspect-video"
                />
              )}
            </div>
          )}
          <ul className="flex flex-col gap-2 max-w-2xl mx-auto">
            {messages.map((m, i) => (
              <li
                key={i}
                className={`max-w-md px-3 py-2 rounded-2xl shadow-sm ${
                  m.from === me
                    ? "self-end bg-indigo-600 text-white rounded-br-sm"
                    : "self-start bg-white border border-slate-200 text-slate-800 rounded-bl-sm"
                }`}
              >
                {m.content}
              </li>
            ))}
          </ul>
        </main>

        {recipient && (
          <footer className="border-t border-slate-200 bg-white px-6 py-3">
            <div className="max-w-2xl mx-auto flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder={`Message ${recipient}`}
                disabled={!recipientPublicKey}
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
              />
              <button
                onClick={send}
                disabled={!recipientPublicKey || !myPublicKey}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-medium px-4 py-2 rounded-lg transition"
              >
                Send
              </button>
            </div>
            {!recipientPublicKey && (
              <p className="text-xs text-slate-400 max-w-2xl mx-auto mt-1">
                {recipient} hasn't uploaded a public key yet — ask them to log
                in.
              </p>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

export default App;
