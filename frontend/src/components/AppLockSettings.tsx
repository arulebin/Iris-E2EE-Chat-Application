import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  appLockAvailability,
  disableAppLock,
  enableAppLock,
  getEscrowStatus,
  setupEscrow,
  type LockAvailability,
} from "../lib/appLock";
import { verifyPassword } from "../lib/credentials";
import type { EscrowStatus } from "../lib/appLockEscrow";
import {
  AppLockCanceledError,
  getConfig,
  LOCK_TIMINGS,
  onConfigChange,
  setConfig,
  type AppLockConfig,
  type LockTiming,
} from "../lib/appLockCore";

// Settings > Privacy > App lock. Hidden entirely when the device offers nothing to lock with.
export function AppLockSettings({ me }: { me: string }) {
  const [avail, setAvail] = useState<LockAvailability | null>(null);
  const [cfg, setCfg] = useState<AppLockConfig | null>(() => getConfig(me));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Password prompt: needed to turn the lock on (escrow) and to add/refresh the escrow later.
  const [askPassword, setAskPassword] = useState<null | "enable" | "escrow">(null);
  const [password, setPassword] = useState("");
  const [escrow, setEscrow] = useState<EscrowStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!cfg || cfg.mode === "gate") return;
    void getEscrowStatus(me).then((s) => { if (!cancelled) setEscrow(s); }, () => {});
    return () => { cancelled = true; };
  }, [cfg, me]);

  useEffect(() => {
    let cancelled = false;
    void appLockAvailability().then((a) => { if (!cancelled) setAvail(a); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => onConfigChange(() => setCfg(getConfig(me))), [me]);

  // Offer it when available, or when it's already on (so it can still be turned off).
  if (!cfg && !(avail && avail.available)) {
    if (avail && !avail.available && avail.reason === "none_enrolled") {
      return (
        <section>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">App lock</p>
          <div className="bg-card rounded-2xl px-4 py-3 shadow-sm dark:border dark:border-muted-soft">
            <p className="text-xs text-muted leading-snug">
              Set up a screen lock (PIN, pattern or password) or a fingerprint in your phone's settings to use app lock.
            </p>
          </div>
        </section>
      );
    }
    return null;
  }

  const native = Capacitor.isNativePlatform();
  const on = !!cfg;

  async function toggle() {
    setError(null);
    if (!on) {
      setAskPassword("enable");   // the password is needed to set up recovery first
      return;
    }
    setBusy(true);
    try {
      await disableAppLock(me);
    } catch (err) {
      if (!(err instanceof AppLockCanceledError)) {
        console.warn("[app-lock] toggle failed", err);
        setError("Couldn't change app lock. Try again.");
      }
    } finally {
      setCfg(getConfig(me));
      setBusy(false);
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!askPassword || !password) return;
    setError(null);
    setBusy(true);
    try {
      const master = await verifyPassword(me, password);
      if (askPassword === "enable") await enableAppLock(me, "1m", master);
      else await setupEscrow(me, master);
      setPassword("");
      setAskPassword(null);
    } catch (err) {
      if (err instanceof AppLockCanceledError) {
        // dismissed the system prompt: keep the form
      } else if (err instanceof Error && err.name === "OperationError") {
        setError("That password isn't right.");
      } else {
        console.warn("[app-lock] toggle failed", err);
        setError("Couldn't change app lock. Check your connection and try again.");
      }
    } finally {
      setCfg(getConfig(me));
      if (getConfig(me)) void getEscrowStatus(me).then(setEscrow, () => {});
      setBusy(false);
    }
  }

  function changeTiming(t: LockTiming) {
    if (cfg) setConfig(me, { ...cfg, timing: t });
  }

  let description: string;
  if (native) {
    description =
      "Require your fingerprint, face or screen lock to open Iris. Your message keys are also locked in the phone's secure hardware, so they can't be used until you authenticate. If your biometrics change or stop working, your Iris password unlocks your messages and you can set the lock up again; nothing is erased.";
  } else if (cfg?.mode === "gate") {
    description =
      "This browser or device doesn't support the passkey feature needed to encrypt with it, so app lock is only a screen lock: it keeps people at your screen out, but does NOT encrypt your local data. Anyone who can read this browser's storage can bypass it.";
  } else if (cfg?.mode === "prf") {
    description =
      "Your local message storage is encrypted with a key that only your device's Windows Hello / Touch ID / Face ID passkey can release. Without it, a copy of this browser's storage can't be read.";
  } else {
    description =
      "Use your device's Windows Hello, Touch ID or Face ID to open Iris. If your browser supports it, your local message storage is also encrypted with a key tied to that passkey. If not, it is only a screen lock and does not encrypt anything; you'll be told which.";
  }

  return (
    <section>
      <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">App lock</p>
      <div className="bg-card rounded-2xl px-4 py-3 shadow-sm dark:border dark:border-muted-soft flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-navy text-sm font-semibold">
              {native ? "Unlock with fingerprint or face" : "Unlock with device passkey"}
            </p>
            <p className="text-xs text-muted leading-snug mt-0.5">{description}</p>
          </div>
          <button
            role="switch"
            aria-checked={on}
            aria-label="App lock"
            disabled={busy}
            onClick={toggle}
            className={`relative shrink-0 w-11 h-6 rounded-full transition disabled:opacity-60 ${on ? "bg-primary" : "bg-muted-soft"}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`}
            />
          </button>
        </div>

        {cfg && (
          <div>
            <p className="text-xs text-muted mb-1.5">Lock</p>
            <div className="bg-bg rounded-xl p-1 flex gap-1" role="radiogroup" aria-label="Lock timing">
              {LOCK_TIMINGS.map((t) => (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={cfg.timing === t.id}
                  onClick={() => changeTiming(t.id)}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                    cfg.timing === t.id ? "bg-primary text-white shadow" : "text-muted hover:text-navy"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {cfg && cfg.mode !== "gate" && escrow && escrow !== "current" && !askPassword && (
          <div className="bg-bg rounded-xl px-3 py-2 flex items-center justify-between gap-3">
            <p className="text-xs text-muted leading-snug">
              {escrow === "stale"
                ? "Your password changed. Refresh password recovery so it keeps working."
                : "Password recovery isn't set up. Without it, a change of biometrics erases the local data on this device."}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setError(null); setAskPassword("escrow"); }}
              className="shrink-0 text-xs font-bold text-primary"
            >
              {escrow === "stale" ? "Refresh" : "Set up"}
            </button>
          </div>
        )}
        {askPassword && (
          <form onSubmit={submitPassword} className="flex flex-col gap-2">
            <p className="text-xs text-muted leading-snug">
              Enter your Iris password. It never leaves this device here; it protects a recovery copy of your message keys so the password can unlock them if your biometrics fail.
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              autoFocus
              required
              className="w-full px-3 py-2 bg-bg border border-muted-soft rounded-xl text-navy text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy || !password}
                className="flex-1 bg-primary text-white text-sm font-bold py-2 rounded-xl disabled:opacity-60"
              >
                {busy ? "Working…" : askPassword === "enable" ? "Turn on app lock" : "Save"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => { setAskPassword(null); setPassword(""); setError(null); }}
                className="px-4 text-sm font-medium text-muted"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </section>
  );
}
