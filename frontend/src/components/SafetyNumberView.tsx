import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  formatSafetyNumber,
  loadSafetyNumber,
  setVerified,
  type ContactTrust,
  type SafetyNumber,
} from "../lib/fingerprint";
import { ShieldCheckIcon, XIcon } from "./icons";

type Props = {
  me: string;
  peer: string;
  peerName: string;
  token: string;
  trust: ContactTrust | undefined;
  onClose: () => void;
};

export function SafetyNumberView({ me, peer, peerName, token, trust, onClose }: Props) {
  const [loaded, setLoaded] = useState<SafetyNumber | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const safety = await loadSafetyNumber(me, peer, token);
        if (!cancelled) setLoaded(safety);
      } catch (err) {
        console.error("Safety number failed", err);
        if (!cancelled) setError("Couldn't load encryption keys for this chat.");
      }
    })();
    return () => { cancelled = true; };
  }, [me, peer, token]);

  // The number shown must belong to the pinned key — otherwise "verified" would
  // be attached to a key the user hasn't accepted yet.
  const matchesPin = !!loaded && !!trust && !trust.changed && trust.fingerprint === loaded.peerFingerprint;
  const verified = matchesPin && trust.verified;

  async function toggleVerified() {
    if (!loaded) return;
    await setVerified(me, peer, loaded.peerFingerprint, !verified);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="safety-number-title"
        className="bg-card w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-6 flex flex-col items-center gap-4 max-h-full overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-full flex items-center justify-between">
          <h2 id="safety-number-title" className="font-bold text-navy">Verify safety number</h2>
          <button onClick={onClose} className="text-navy hover:opacity-70" aria-label="Close">
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {error && <p className="text-sm text-danger text-center">{error}</p>}

        {!error && !loaded && <p className="text-sm text-muted py-12">Computing…</p>}

        {loaded && (
          <>
            <div className="bg-white p-2 rounded-xl shadow-sm border border-muted-soft">
              <QRCodeSVG value={loaded.qrValue} size={180} fgColor="#5b5bd6" />
            </div>

            <div className="grid grid-cols-4 gap-x-4 gap-y-1 font-mono text-navy text-base tracking-wider">
              {formatSafetyNumber(loaded.digits).map((group, i) => (
                <span key={i}>{group}</span>
              ))}
            </div>

            <p className="text-sm text-muted text-center">
              Compare these numbers with {peerName} in person or on a call. If they
              match on both devices, your messages can't be read by anyone else —
              not even the Iris server.
            </p>

            {verified && (
              <p className="flex items-center gap-1.5 text-sm font-semibold text-online">
                <ShieldCheckIcon className="w-4 h-4" /> Verified
              </p>
            )}

            {!matchesPin && (
              <p className="text-sm text-danger text-center">
                {peerName}'s key changed. Accept the new key in the chat before verifying.
              </p>
            )}

            <button
              onClick={toggleVerified}
              disabled={!matchesPin}
              className={
                verified
                  ? "w-full py-2.5 rounded-full text-sm font-semibold border border-muted-soft text-navy hover:opacity-80"
                  : "w-full py-2.5 rounded-full text-sm font-semibold bg-primary hover:bg-primary-hover text-white disabled:opacity-50"
              }
            >
              {verified ? "Clear verification" : "Mark as verified"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
