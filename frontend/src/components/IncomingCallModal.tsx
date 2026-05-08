// ── Color helper (same as Avatar) ──────────────────────────────────────────
function colorForName(name: string): string {
  const palette = [
    "#3b82f6", "#10b981", "#f59e0b", "#ec4899",
    "#8b5cf6", "#14b8a6", "#f43f5e", "#6366f1",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

type Props = {
  from: string;
  onAccept: () => void;
  onReject: () => void;
};

export function IncomingCallModal({ from, onAccept, onReject }: Props) {
  const initial = (from[0] ?? "?").toUpperCase();

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-between"
      style={{ background: "#0b0f14" }}
    >
      {/* Top section — caller info */}
      <div className="flex flex-col items-center pt-20 flex-1 justify-center">
        {/* Animated rings */}
        <div className="relative flex items-center justify-center mb-8">
          <div
            className="absolute rounded-full animate-ping"
            style={{
              width: 140,
              height: 140,
              background: colorForName(from),
              opacity: 0.15,
              animationDuration: "2s",
            }}
          />
          <div
            className="absolute rounded-full animate-ping"
            style={{
              width: 110,
              height: 110,
              background: colorForName(from),
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
              background: colorForName(from),
            }}
          >
            {initial}
          </div>
        </div>

        <p className="text-white text-2xl font-semibold tracking-wide">{from}</p>
        <p className="text-white/50 text-sm mt-2 animate-pulse">
          Incoming video call…
        </p>

        {/* E2EE badge */}
        <div
          className="flex items-center gap-1.5 mt-6 px-3 py-1.5 rounded-full"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className="w-3.5 h-3.5 text-emerald-400" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span className="text-emerald-400 text-[11px] font-medium">End-to-end encrypted</span>
        </div>
      </div>

      {/* Bottom section — accept / reject */}
      <div className="flex items-center justify-center gap-16 pb-16">
        {/* Reject */}
        <button
          onClick={onReject}
          className="flex flex-col items-center gap-2"
          aria-label="Reject call"
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-90"
            style={{ background: "#ef4444" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 text-white"
              style={{ transform: "rotate(135deg)" }}>
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </div>
          <span className="text-white/70 text-xs font-medium">Decline</span>
        </button>

        {/* Accept */}
        <button
          onClick={onAccept}
          className="flex flex-col items-center gap-2"
          aria-label="Accept call"
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-90"
            style={{ background: "#22c55e" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 text-white">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </div>
          <span className="text-white/70 text-xs font-medium">Accept</span>
        </button>
      </div>
    </div>
  );
}
