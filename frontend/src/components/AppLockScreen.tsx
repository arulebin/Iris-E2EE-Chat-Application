import { useCallback, useEffect, useRef, useState } from "react";
import { IrisMark, LockIcon } from "./icons";
import {
  AppLockCanceledError,
  AppLockInvalidatedError,
  type AppLockConfig,
} from "../lib/appLockCore";
import { passwordFallback, unlockApp } from "../lib/appLock";

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
  const autoTried = useRef(false);

  const unlock = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      await unlockApp(user, config);
      onUnlocked();
    } catch (err) {
      if (err instanceof AppLockInvalidatedError) {
        setInvalidated(true);
        setMessage("Your device's biometrics or screen lock changed, so the lock key was reset. Use your password to continue.");
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
        {!confirmPassword ? (
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
              onClick={() => (invalidated ? void signOutToPassword() : setConfirmPassword(true))}
              disabled={busy && !invalidated}
              className="text-muted hover:text-navy text-sm font-medium mt-1"
            >
              Use password instead
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-navy leading-snug">
              {config.mode === "gate"
                ? "This signs you out of Iris and turns off app lock. Log in again with your password."
                : "This turns off app lock, signs you out and erases the encrypted data on this device, since only the lock could open it. Log in with your password to restore your identity and any backed-up history."}
            </p>
            <button
              type="button"
              onClick={() => void signOutToPassword()}
              disabled={busy}
              className="bg-danger text-white font-bold py-2.5 rounded-xl disabled:opacity-60"
            >
              {busy ? "Working…" : "Sign out and use password"}
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
