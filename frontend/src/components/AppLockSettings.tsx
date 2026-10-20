import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { appLockAvailability, disableAppLock, enableAppLock, type LockAvailability } from "../lib/appLock";
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
    setBusy(true);
    try {
      if (on) await disableAppLock(me);
      else await enableAppLock(me, "1m");
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

  function changeTiming(t: LockTiming) {
    if (cfg) setConfig(me, { ...cfg, timing: t });
  }

  let description: string;
  if (native) {
    description =
      "Require your fingerprint, face or screen lock to open Iris. Your message keys are also locked in the phone's secure hardware, so they can't be used until you authenticate. Adding a new fingerprint resets the lock.";
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
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </section>
  );
}
