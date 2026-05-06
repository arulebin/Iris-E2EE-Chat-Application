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

function getUsername(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub as string;
  } catch {
    return null;
  }
}

function App() {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("token"),
  );
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
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
  // Holds the latest closure of handleSignal so ws.onmessage can call it
  // without forward-reference or stale-closure problems.
  const handleSignalRef = useRef<((s: CallSignal) => Promise<void>) | null>(null)


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
  useEffect(() => {
    if (!token || !me) return;
    ensureKeyPair(me, token)
      .then(({ privateKey, publicKey }) => {
        setPrivateKey(privateKey);
        setMyPublicKey(publicKey);
      })
      .catch((err) => console.error("Key setup failed:", err));
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

  // ── WebSocket: re-create when token, recipient, me, or privateKey changes ─
  useEffect(() => {
    if (!token) return;
    const ws = new WebSocket(`ws://localhost:8080/ws/chat?token=${token}`);
    wsRef.current = ws;
    ws.onopen = () => console.log("connected");
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
        const isCurrentChat =
          (msg.from === me && msg.to === recipient) ||
          (msg.from === recipient && msg.to === me);
        if (isCurrentChat) {
          const decrypted = await decryptIncoming(msg);
          setMessages((prev) => [...prev, decrypted]);
        }
      } catch {
        // ignore non-JSON
      }
    };
    return () => ws.close();
  }, [token, recipient, me, decryptIncoming]);

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

  /** alice initiates a call to the current recipient */
  async function startCall() {
    if (!recipient || !wsRef.current) return
    let stream = localStream
    if (!stream) {
      stream = await startCamera()
      if (!stream) return
    }

    const pc = createPeerConnection(wsRef.current, recipient, setRemoteStream)
    pcRef.current = pc
    stream.getTracks().forEach((t) => pc.addTrack(t, stream!))

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    wsRef.current.send(
      JSON.stringify({ type: "call-offer", to: recipient, payload: offer })
    )
  }

  /** bob's side: handle an incoming offer/answer/ice/end */
  async function handleSignal(signal: CallSignal) {
    if (!wsRef.current) return

    if (signal.type === "call-offer") {
      // Make sure we have a camera stream before answering
      let stream = localStream
      if (!stream) {
        stream = await startCamera()
        if (!stream) return
      }

      const pc = createPeerConnection(wsRef.current, signal.from!, setRemoteStream)
      pcRef.current = pc
      stream.getTracks().forEach((t) => pc.addTrack(t, stream!))

      await pc.setRemoteDescription(signal.payload)

      // Drain any ICE candidates that arrived before the remote description
      for (const c of pendingIceRef.current) {
        try { await pc.addIceCandidate(c) } catch (e) { console.error("addIceCandidate", e) }
      }
      pendingIceRef.current = []

      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      wsRef.current.send(
        JSON.stringify({ type: "call-answer", to: signal.from, payload: answer })
      )
    } else if (signal.type === "call-answer") {
      await pcRef.current?.setRemoteDescription(signal.payload)
      for (const c of pendingIceRef.current) {
        try { await pcRef.current?.addIceCandidate(c) } catch (e) { console.error("addIceCandidate", e) }
      }
      pendingIceRef.current = []
    } else if (signal.type === "call-ice") {
      const pc = pcRef.current
      if (pc && pc.remoteDescription) {
        try { await pc.addIceCandidate(signal.payload) } catch (e) { console.error("addIceCandidate", e) }
      } else {
        // queue until remote description is set
        pendingIceRef.current.push(signal.payload)
      }
    } else if (signal.type === "call-end") {
      hangUp(false)
    }
  }

  /** Tear down the call locally; optionally tell the other side. */
  function hangUp(notifyRemote: boolean) {
    if (notifyRemote && recipient && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "call-end", to: recipient }))
    }
    pcRef.current?.close()
    pcRef.current = null
    pendingIceRef.current = []
    setRemoteStream(null)
    stopCamera()
  }

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
          <button
            onClick={handleLogout}
            className="text-sm text-slate-500 hover:text-slate-900 text-left"
          >
            Log out
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <div className="flex-1 flex flex-col">
        <header className="border-b border-slate-200 bg-white px-6 py-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {recipient
              ? `Chat with ${recipient}`
              : "Select someone to chat with"}
          </h2>
          {recipient && (
            <div className="flex gap-2">
              {pcRef.current || remoteStream ? (
                <button
                  onClick={() => hangUp(true)}
                  className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-lg text-sm"
                >
                  Hang up
                </button>
              ) : (
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
            </div>
          )}
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
