import { useCallback, useEffect, useRef, useState } from "react";
import { EyeIcon, EyeOffIcon, IrisMark, LockIcon } from "./icons";
import {
  AppLockCanceledError,
  AppLockInvalidatedError,
  type AppLockConfig,
} from "../lib/appLockCore";
import {
  abandonAppLock,
  hasEscrow,
  passwordFallback,
  recoverWithPassword,
  relockAfterRecovery,
  unlockApp,
} from "../lib/appLock";
import {
  EscrowRateLimitedError,
  EscrowWrongPasswordError,
  escrowRetryIn,
} from "../lib/appLockEscrow";

type Props = {
  user: string;
  config: AppLockConfig;
  onUnlocked: () => void;
};

const rings = (
  <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
    <div className="relative mt-[-22vh] w-[150vw] max-w-[640px] aspect-square">
      <span className="absolute inset-0 rounded-full border border-primary/10" />
      <span className="absolute inset-[13%] rounded-full border border-primary/10" />
      <span className="absolute inset-[26%] rounded-full border border-primary/[0.08]" />
    </div>
  </div>
);

// Full-screen lock. Nothing of the app is mounted behind it: messages are not
// decrypted or rendered until the unlock succeeds.
export function AppLockScreen({ user, config, onUnlocked }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [invalidated, setInvalidated] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState(false);
  const [escrow, setEscrow] = useState<boolean | null>(null);   // null while checking
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [retryAt, setRetryAt] = useState(() => {
    const wait = escrowRetryIn(user);   // a backoff from an earlier attempt survives restarts
    return wait > 0 ? Date.now() + wait : 0;
  });
  const [now, setNow] = useState(() => Date.now());
  // After the password worked: the data is safe; the lock key still has to be re-enrolled (or left off).
  const [recovered, setRecovered] = useState(false);
  const autoTried = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void hasEscrow(user).then((v) => { if (!cancelled) setEscrow(v); }, () => { if (!cancelled) setEscrow(false); });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (retryAt <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [retryAt]);
  const waitSeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));

  const unlock = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      await unlockApp(user, config);
      onUnlocked();
    } catch (err) {
      if (err instanceof AppLockInvalidatedError) {
        setInvalidated(true);
        setMessage("Your device's biometrics or screen lock changed, so the lock key was reset. Enter your password to continue; your messages are kept.");
      } else if (err instanceof AppLockCanceledError) {
        setMessage("Unlock cancelled.");
      } else {
        console.warn("[app-lock] unlock failed", err);
        setMessage("Couldn't unlock. Try again, or use your password.");
      }
      setBusy(false);
    }
  }, [user, config, onUnlocked]);

  // Prompt right away, once, like WhatsApp. (After a cancel the button retries.)
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    void unlock();
  }, [unlock]);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy || waitSeconds > 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await recoverWithPassword(user, password);
      setPassword("");
      if (result === "off") {
        onUnlocked();   // web: the lock was turned off, data restored
        return;
      }
      setRecovered(true);
      await relock();
    } catch (err) {
      if (err instanceof EscrowRateLimitedError) {
        setRetryAt(Date.now() + err.retryInMs);
        setNow(Date.now());
        setMessage("That password didn't work. Wait a moment before trying again.");
      } else if (err instanceof EscrowWrongPasswordError) {
        setMessage("That password didn't work. Try again.");
      } else {
        console.warn("[app-lock] password recovery failed", err);
        setMessage("Couldn't unlock with your password. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function relock() {
    setBusy(true);
    setMessage(null);
    try {
      await relockAfterRecovery(user);
      onUnlocked();
    } catch (err) {
      setMessage(err instanceof AppLockCanceledError
        ? "Fingerprint or face check was cancelled."
        : "Couldn't set up app lock again on this device.");
    } finally {
      setBusy(false);
    }
  }

  async function keepLockOff() {
    setBusy(true);
    try {
      await abandonAppLock(user);
      onUnlocked();
    } catch (err) {
      console.warn("[app-lock] couldn't turn app lock off", err);
      setMessage("Couldn't turn app lock off.");
    } finally {
      setBusy(false);
    }
  }

  async function signOutToPassword() {
    setBusy(true);
    try {
      await passwordFallback(user);
    } finally {
      window.location.reload();
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-bg flex flex-col items-center justify-center px-6">
      {rings}
      <div className="iris-rise relative z-10 flex flex-col items-center mb-7">
        <IrisMark className="w-14 h-14" />
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight iris-wordmark">Iris is locked</h1>
        <p className="mt-1.5 text-muted text-sm text-center max-w-xs">
          {config.mode === "gate"
            ? "Verify it's you to open your chats."
            : "Unlock to decrypt and view your messages."}
        </p>
      </div>

      <div
        className="iris-rise relative z-10 w-full max-w-sm bg-card border border-muted-soft/40 rounded-3xl shadow-sm p-6 flex flex-col gap-3"
        style={{ animationDelay: "0.14s" }}
      >
        {recovered ? (
          <>
            <p className="text-sm text-navy leading-snug">
              Your messages are unlocked. Confirm with your fingerprint or face to turn app lock back on, or leave it off for now.
            </p>
            {message && <p role="alert" className="text-danger text-sm text-center">{message}</p>}
            <button
              type="button"
              onClick={() => void relock()}
              disabled={busy}
              className="bg-primary hover:bg-primary-hover text-white font-bold py-2.5 rounded-xl disabled:opacity-60"
            >
              {busy ? "Waiting…" : "Turn app lock back on"}
            </button>
            <button
              type="button"
              onClick={() => void keepLockOff()}
              disabled={busy}
              className="text-muted hover:text-navy text-sm font-medium"
            >
              Keep app lock off
            </button>
          </>
        ) : escrow && (confirmPassword || invalidated) ? (
          <form onSubmit={submitPassword} className="flex flex-col gap-3">
            <p className="text-sm text-navy leading-snug">
              Enter your Iris password to unlock your messages. Nothing is erased.
            </p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                <LockIcon className="w-5 h-5" />
              </span>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                autoFocus
                autoComplete="current-password"
                className="w-full pl-10 pr-10 py-2.5 bg-bg border border-muted-soft rounded-xl text-navy placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-navy p-1"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
              </button>
            </div>
            <button
              type="submit"
              disabled={busy || waitSeconds > 0}
              className="bg-primary hover:bg-primary-hover text-white font-bold py-2.5 rounded-xl disabled:opacity-60"
            >
              {busy ? "Unlocking…" : waitSeconds > 0 ? `Try again in ${waitSeconds}s` : "Unlock"}
            </button>
            {message && <p role="alert" className="text-danger text-sm text-center">{message}</p>}
            {!invalidated && (
              <button
                type="button"
                onClick={() => { setConfirmPassword(false); setMessage(null); }}
                disabled={busy}
                className="text-muted hover:text-navy text-sm font-medium"
              >
                Back
              </button>
            )}
          </form>
        ) : !confirmPassword ? (
          <>
            {!invalidated && (
              <button
                type="button"
                onClick={unlock}
                disabled={busy}
                className="flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-white font-bold py-2.5 rounded-xl transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                <LockIcon className="w-5 h-5" />
                {busy ? "Waiting…" : "Unlock"}
              </button>
            )}
            {message && <p role="alert" className="text-danger text-sm text-center">{message}</p>}
            <button
              type="button"
              onClick={() => setConfirmPassword(true)}
              disabled={(busy && !invalidated) || escrow === null}
              className="text-muted hover:text-navy text-sm font-medium mt-1"
            >
              {invalidated ? "Continue" : "Use password instead"}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-navy leading-snug">
              {config.mode === "gate"
                ? "This signs you out of Iris and turns off app lock. Log in again with your password."
                : "Warning: this device has no password recovery set up for app lock. Continuing turns off app lock, signs you out and ERASES the encrypted data on this device, since only the lock could open it. Log in with your password to restore your identity and any backed-up history."}
            </p>
            <button
              type="button"
              onClick={() => void signOutToPassword()}
              disabled={busy}
              className="bg-danger text-white font-bold py-2.5 rounded-xl disabled:opacity-60"
            >
              {busy ? "Working…" : "Erase and sign out"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmPassword(false)}
              disabled={busy}
              className="text-muted hover:text-navy text-sm font-medium"
            >
              Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
