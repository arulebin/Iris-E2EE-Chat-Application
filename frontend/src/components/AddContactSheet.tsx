import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import type { UserProfile } from "../types";
import { formatInviteCode, lookupInvite, normalizeInviteCode, requestByInvite } from "../lib/invite";

type Props = {
  token: string;
  /** Pre-filled from an opened invite link (?add=CODE). */
  initialCode?: string;
  /** Usernames already connected — those get "Message" instead of "Connect". */
  connected: string[];
  onClose: () => void;
  onOpenChat: (username: string) => void;
};

// BarcodeDetector ships in Chrome on Android (incl. the app's WebView) and macOS,
// not on Windows/Linux desktop — there the sheet falls back to typing the code.
type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;
const BarcodeDetectorImpl = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;

function QrScanner({ onResult, onError }: { onResult: (text: string) => void; onError: (msg: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Latest callbacks without restarting the camera when the parent re-renders.
  const cb = useRef({ onResult, onError });
  useEffect(() => { cb.current = { onResult, onError }; });

  useEffect(() => {
    if (!BarcodeDetectorImpl) return;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let done = false;
    const detector = new BarcodeDetectorImpl({ formats: ["qr_code"] });

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(s => {
        if (done) { s.getTracks().forEach(t => t.stop()); return; }
        stream = s;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = s;
        const tick = async () => {
          if (done) return;
          try {
            if (v.readyState >= 2) {
              const codes = await detector.detect(v);
              if (codes[0]?.rawValue) { done = true; cb.current.onResult(codes[0].rawValue); return; }
            }
          } catch { /* transient decode errors: keep scanning */ }
          timer = window.setTimeout(tick, 250);
        };
        tick();
      })
      .catch(err => cb.current.onError(err?.name === "NotAllowedError" ? "Camera permission denied." : "Camera unavailable."));

    return () => {
      done = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div className="relative w-full aspect-square max-w-xs rounded-2xl overflow-hidden bg-black">
      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
      <div className="absolute inset-8 border-2 border-white/80 rounded-2xl pointer-events-none" />
    </div>
  );
}

/** Add someone with their invite code, link, or QR — the only way to reach private profiles. */
export function AddContactSheet({ token, initialCode, connected, onClose, onOpenChat }: Props) {
  const [input, setInput] = useState(initialCode ? formatInviteCode(normalizeInviteCode(initialCode) ?? initialCode) : "");
  const [scanning, setScanning] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "looking" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function lookup(raw: string) {
    const c = normalizeInviteCode(raw);
    setProfile(null);
    if (!c) { setError("That doesn't look like an invite code (10 letters/numbers)."); return; }
    setError(null);
    setStatus("looking");
    const result = await lookupInvite(c, token);
    setStatus("idle");
    if (result.ok) { setCode(c); setProfile(result.profile); return; }
    setError(
      result.reason === "rate-limited" ? "Too many attempts — try again in a few minutes."
      : result.reason === "not-found" ? "No one found for that invite. It may have been reset."
      : "Couldn't check that invite. Check your connection.",
    );
  }

  // Opened from a link: look it up straight away.
  const autoLooked = useRef(false);
  useEffect(() => {
    if (initialCode && !autoLooked.current) {
      autoLooked.current = true;
      void lookup(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  async function send() {
    if (!code) return;
    setStatus("sending");
    const err = await requestByInvite(code, token);
    if (err) { setError(err); setStatus("idle"); } else setStatus("sent");
  }

  const isConnected = profile ? connected.includes(profile.username) : false;

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-bg">
      <header className="px-4 pt-5 pb-3 flex items-center gap-3 border-b border-muted-soft/30">
        <button onClick={onClose} className="text-navy hover:opacity-70 p-1" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <h2 className="text-lg font-bold text-navy">Add with invite</h2>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col items-center gap-4">
        {scanning ? (
          <>
            <QrScanner
              onResult={text => { setScanning(false); setInput(text); void lookup(text); }}
              onError={msg => { setScanning(false); setError(msg); }}
            />
            <button onClick={() => setScanning(false)} className="text-sm font-semibold text-muted">
              Enter code instead
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted text-center">
              Paste an invite link or type the code someone shared with you.
            </p>
            <form
              className="w-full flex gap-2"
              onSubmit={e => { e.preventDefault(); void lookup(input); }}
            >
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="XXXXX-XXXXX"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="flex-1 bg-card rounded-xl px-3 py-2.5 text-navy font-mono tracking-widest outline-none placeholder:text-muted"
              />
              <button
                type="submit"
                disabled={!input.trim() || status === "looking"}
                className="bg-primary text-white font-bold px-4 rounded-xl disabled:opacity-50"
              >
                {status === "looking" ? "…" : "Find"}
              </button>
            </form>
            {BarcodeDetectorImpl && (
              <button
                onClick={() => { setError(null); setProfile(null); setScanning(true); }}
                className="w-full bg-primary/10 text-primary font-bold py-2.5 rounded-xl"
              >
                Scan QR code
              </button>
            )}
          </>
        )}

        {error && <p className="text-sm text-danger text-center">{error}</p>}

        {profile && (
          <div className="w-full bg-card rounded-2xl p-4 shadow-sm dark:border dark:border-muted-soft flex items-center gap-3">
            <Avatar name={profile.preferredName || profile.username} avatarUrl={profile.avatarUrl} size="md" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-navy truncate">{profile.preferredName || profile.username}</p>
              <p className="text-xs text-muted truncate">@{profile.username}</p>
            </div>
            {isConnected ? (
              <button
                onClick={() => onOpenChat(profile.username)}
                className="text-xs font-bold text-primary bg-primary/10 px-3 py-1.5 rounded-full"
              >
                Message
              </button>
            ) : status === "sent" ? (
              <span className="text-xs text-muted bg-muted-soft/30 px-3 py-1.5 rounded-full">Sent</span>
            ) : (
              <button
                onClick={send}
                disabled={status === "sending"}
                className="text-xs font-bold text-white bg-primary px-3 py-1.5 rounded-full active:scale-95 transition-transform disabled:opacity-50"
              >
                {status === "sending" ? "Sending…" : "Connect"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
