import { useEffect, useRef, useState, useCallback } from "react";

// ── Inline SVG icons for call controls ─────────────────────────────────────

const MicIcon = ({ muted }: { muted: boolean }) =>
  muted ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <line x1="1" x2="23" y1="1" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.12 1.5-.35 2.18" />
      <line x1="12" x2="12" y1="19" y2="23" /><line x1="8" x2="16" y1="23" y2="23" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" /><line x1="8" x2="16" y1="22" y2="22" />
    </svg>
  );

const CamIcon = ({ off }: { off: boolean }) =>
  off ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <path d="M10.66 5H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8" />
      <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2l10 10Z" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <path d="m22 8-6 4 6 4V8Z" />
      <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
    </svg>
  );

const FlipCameraIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
    <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
    <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
    <circle cx="12" cy="12" r="3" />
    <path d="m18 22-3-3 3-3" />
    <path d="m6 2 3 3-3 3" />
  </svg>
);

const HangUpIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const SpeakerIcon = ({ on }: { on: boolean }) =>
  on ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" x2="17" y1="9" y2="15" />
      <line x1="17" x2="23" y1="9" y2="15" />
    </svg>
  );

// ── Call timer hook ────────────────────────────────────────────────────────

function useCallTimer(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setSeconds(0);
      startRef.current = null;
      return;
    }
    startRef.current = Date.now();
    const id = setInterval(() => {
      if (startRef.current) setSeconds(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

// ── Draggable PiP hook ─────────────────────────────────────────────────────

function useDraggable(initialCorner: "top-right" | "bottom-right" = "top-right") {
  const elRef = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [initialized, setInitialized] = useState(false);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const ref = useCallback((node: HTMLElement | null) => {
    elRef.current = node;
    if (node && !initialized) {
      const padding = 16;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = node.getBoundingClientRect();
      const x = vw - rect.width - padding;
      const y = initialCorner === "top-right" ? padding + 48 : vh - rect.height - padding - 120;
      setPos({ x, y });
      setInitialized(true);
    }
  }, [initialCorner, initialized]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !elRef.current) return;
    const el = elRef.current;
    const maxX = window.innerWidth - el.offsetWidth;
    const maxY = window.innerHeight - el.offsetHeight;
    const x = Math.max(0, Math.min(maxX, e.clientX - offset.current.x));
    const y = Math.max(0, Math.min(maxY, e.clientY - offset.current.y));
    setPos({ x, y });
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return { ref, pos, initialized, onPointerDown, onPointerMove, onPointerUp };
}

// ── Color helper for avatar ────────────────────────────────────────────────

function colorForName(name: string): string {
  const palette = [
    "#3b82f6", "#10b981", "#f59e0b", "#ec4899",
    "#8b5cf6", "#14b8a6", "#f43f5e", "#6366f1",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

// ── Main component ─────────────────────────────────────────────────────────

type Props = {
  peer: string;
  callKind: "outgoing" | "active";
  callMode: "audio" | "video";
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  reconnecting?: boolean;
  onHangUp: () => void;
  onMinimize: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleSpeaker: () => void;
  onFlipCamera: () => void;
  isMuted: boolean;
  isCameraOff: boolean;
  speakerOn: boolean;
};

export function VideoCallScreen({
  peer,
  callKind,
  callMode,
  localStream,
  remoteStream,
  reconnecting,
  onHangUp,
  onMinimize,
  onToggleMute,
  onToggleCamera,
  onToggleSpeaker,
  onFlipCamera,
  isMuted,
  isCameraOff,
  speakerOn,
}: Props) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timer = useCallTimer(callKind === "active");
  const pip = useDraggable("top-right");

  const connected = callKind === "active" && !!remoteStream;
  const isConnected = connected;

  // Status text shown over the avatar. Once connected we show the live timer.
  const centerStatus =
    callKind === "outgoing" ? "Calling…"
    : reconnecting          ? "Reconnecting…"
    : !connected            ? "Connecting…"
    :                         null;

  // Attach the remote video via a callback ref. Audio is handled by a single
  // app-level <audio> sink, so this element stays muted to avoid double audio.
  const remoteRef = useCallback(
    (node: HTMLVideoElement | null) => {
      if (node && remoteStream) node.srcObject = remoteStream;
      if (node) node.muted = true;
    },
    [remoteStream]
  );

  const localRef = useCallback(
    (node: HTMLVideoElement | null) => {
      if (node && localStream) node.srcObject = localStream;
    },
    [localStream]
  );

  // Auto-hide controls after 4s of inactivity during active call
  useEffect(() => {
    if (callKind !== "active") {
      setControlsVisible(true);
      return;
    }
    const resetTimer = () => {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 4000);
    };
    resetTimer();
    window.addEventListener("pointerdown", resetTimer);
    window.addEventListener("pointermove", resetTimer);
    return () => {
      window.removeEventListener("pointerdown", resetTimer);
      window.removeEventListener("pointermove", resetTimer);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [callKind]);

  // Toggle speaker handled in remoteRef callback

  const initial = (peer[0] ?? "?").toUpperCase();

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "#0b0f14" }}
    >
      {/* ── Remote video (full-screen background) ──────────────────── */}
      {isConnected && callMode === "video" ? (
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        /* ── Pre-connection state (calling / ringing) ──────────────── */
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {/* Animated rings */}
          <div className="relative flex items-center justify-center mb-8">
            <div
              className="absolute rounded-full animate-ping"
              style={{
                width: 140,
                height: 140,
                background: colorForName(peer),
                opacity: 0.15,
                animationDuration: "2s",
              }}
            />
            <div
              className="absolute rounded-full animate-ping"
              style={{
                width: 110,
                height: 110,
                background: colorForName(peer),
                opacity: 0.25,
                animationDuration: "2s",
                animationDelay: "0.4s",
              }}
            />
            {/* Avatar */}
            <div
              className="relative rounded-full flex items-center justify-center text-white font-bold text-4xl shadow-2xl"
              style={{
                width: 96,
                height: 96,
                background: colorForName(peer),
              }}
            >
              {initial}
            </div>
          </div>

          <p className="text-white text-2xl font-semibold tracking-wide">{peer}</p>
          <p className={`text-white/60 text-sm mt-2 ${centerStatus ? "animate-pulse" : "tabular-nums"}`}>
            {centerStatus ?? timer}
          </p>

          {/* E2EE badge */}
          <div className="flex items-center gap-1.5 mt-6 px-3 py-1.5 rounded-full"
            style={{ background: "rgba(255,255,255,0.08)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className="w-3.5 h-3.5 text-emerald-400" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span className="text-emerald-400 text-[11px] font-medium">End-to-end encrypted</span>
          </div>
        </div>
      )}

      {/* ── Top bar (fades with controls) ──────────────────────────── */}
      <div
        className="absolute top-0 left-0 right-0 z-10 flex items-center px-4 pt-[env(safe-area-inset-top,12px)] pb-3 transition-opacity duration-300"
        style={{
          background: "linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)",
          opacity: controlsVisible ? 1 : 0,
          pointerEvents: controlsVisible ? "auto" : "none",
        }}
      >
        <div className="flex-1 min-w-0 pt-3">
          <p className="text-white font-semibold text-base truncate">{peer}</p>
          {callKind === "active" && (
            <p className={`text-xs ${reconnecting ? "text-amber-400 animate-pulse" : "text-white/60 tabular-nums"}`}>
              {reconnecting ? "Reconnecting…" : timer}
            </p>
          )}
          {callKind === "outgoing" && (
            <p className="text-white/50 text-xs">Ringing…</p>
          )}
        </div>
        <button
          onClick={onMinimize}
          className="mt-3 p-2 rounded-full hover:bg-white/10 transition-colors"
          aria-label="Minimize call"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <polyline points="4 14 10 14 10 20" />
            <polyline points="20 10 14 10 14 4" />
            <line x1="10" x2="3" y1="14" y2="21" />
            <line x1="21" x2="14" y1="3" y2="10" />
          </svg>
        </button>
      </div>

      {/* ── Local video PiP (draggable) ────────────────────────────── */}
      {localStream && callMode === "video" && (
        <div
          ref={pip.ref}
          onPointerDown={pip.onPointerDown}
          onPointerMove={pip.onPointerMove}
          onPointerUp={pip.onPointerUp}
          className="absolute z-20 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/20 touch-none select-none"
          style={{
            width: 120,
            aspectRatio: "3/4",
            left: pip.pos.x,
            top: pip.pos.y,
            opacity: pip.initialized ? 1 : 0,
            transition: pip.initialized ? "none" : "opacity 0.3s",
            cursor: "grab",
          }}
        >
          {isCameraOff ? (
            <div className="w-full h-full bg-gray-800 flex items-center justify-center">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg"
                style={{ background: colorForName("me") }}
              >
                You
              </div>
            </div>
          ) : (
            <video
              ref={localRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />
          )}
        </div>
      )}

      {/* ── Bottom controls ────────────────────────────────────────── */}
      <div
        className="absolute bottom-0 left-0 right-0 z-10 flex flex-col items-center pb-[env(safe-area-inset-bottom,24px)] pt-8 transition-opacity duration-300"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.75), transparent)",
          opacity: controlsVisible ? 1 : 0,
          pointerEvents: controlsVisible ? "auto" : "none",
        }}
      >
        <div className="flex items-center justify-center gap-5 mb-4">
          {/* Mute */}
          <button
            onClick={onToggleMute}
            className="flex flex-col items-center gap-1.5"
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center transition-colors duration-200"
              style={{
                background: isMuted ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.15)",
                color: isMuted ? "#0b0f14" : "white",
                backdropFilter: "blur(20px)",
              }}
            >
              <MicIcon muted={isMuted} />
            </div>
            <span className="text-white/70 text-[10px] font-medium">
              {isMuted ? "Unmute" : "Mute"}
            </span>
          </button>

          {/* Camera (Video only) */}
          {callMode === "video" && (
            <button
              onClick={onToggleCamera}
              className="flex flex-col items-center gap-1.5"
              aria-label={isCameraOff ? "Turn camera on" : "Turn camera off"}
            >
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center transition-colors duration-200"
                style={{
                  background: isCameraOff ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.15)",
                  color: isCameraOff ? "#0b0f14" : "white",
                  backdropFilter: "blur(20px)",
                }}
              >
                <CamIcon off={isCameraOff} />
              </div>
              <span className="text-white/70 text-[10px] font-medium">
                {isCameraOff ? "Camera on" : "Camera off"}
              </span>
            </button>
          )}

          {/* Speaker */}
          <button
            onClick={onToggleSpeaker}
            className="flex flex-col items-center gap-1.5"
            aria-label={speakerOn ? "Speaker off" : "Speaker on"}
          >
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center transition-colors duration-200"
              style={{
                background: !speakerOn ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.15)",
                color: !speakerOn ? "#0b0f14" : "white",
                backdropFilter: "blur(20px)",
              }}
            >
              <SpeakerIcon on={speakerOn} />
            </div>
            <span className="text-white/70 text-[10px] font-medium">
              {speakerOn ? "Speaker" : "Speaker off"}
            </span>
          </button>

          {/* Flip Camera (Video only) */}
          {callMode === "video" && (
            <button
              onClick={onFlipCamera}
              className="flex flex-col items-center gap-1.5"
              aria-label="Flip camera"
            >
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{
                  background: "rgba(255,255,255,0.15)",
                  color: "white",
                  backdropFilter: "blur(20px)",
                }}
              >
                <FlipCameraIcon />
              </div>
              <span className="text-white/70 text-[10px] font-medium">Flip</span>
            </button>
          )}
        </div>

        {/* Hang up */}
        <button
          onClick={onHangUp}
          className="w-16 h-16 rounded-full flex items-center justify-center mb-2 transition-transform duration-150 active:scale-90"
          style={{ background: "#ef4444" }}
          aria-label="End call"
        >
          <div style={{ transform: "rotate(135deg)" }}>
            <HangUpIcon />
          </div>
        </button>
      </div>
    </div>
  );
}
