import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { getUsername } from "../lib/auth";
import { getConfig, LockMachine, onConfigChange, timingMs } from "../lib/appLockCore";
import { engageLock, setExclusiveRunner } from "../lib/appLock";
import { appLockHeld, authGuard } from "../lib/appLockGuard";
import { AppLockScreen } from "./AppLockScreen";
import { IrisMark } from "./icons";

const currentUser = () => {
  try {
    return getUsername(localStorage.getItem("token"));
  } catch {
    return null;
  }
};

/**
 * Top-level wrapper for the optional App lock (off by default).
 *
 * Locked  -> children are UNMOUNTED: no message is decrypted or rendered, the
 *            WebSocket (owned by <App/>) is closed, the loaded storage keys are
 *            dropped, so unlocking again needs a fresh authentication.
 * Leaving the app -> an opaque cover goes up immediately (recents thumbnail);
 *            the lock engages on return if the chosen delay has elapsed.
 *
 * Disconnecting while locked is deliberate: envelopes queue server-side and are
 * deleted only on ack, which App sends after decrypting and persisting, so
 * nothing is lost, and the locked app can't decrypt incoming messages into
 * memory. Push notifications (generic text) still arrive. Cost: contacts see
 * you offline, and a call that rings while locked is missed unless the push
 * is tapped and unlocked in time.
 */
export function AppLock({ children }: { children: ReactNode }) {
  const [machine] = useState(() => {
    const cfg = getConfig(currentUser());
    return new LockMachine(timingMs(cfg?.timing ?? "immediately"), !!cfg);
  });
  const [locked, setLocked] = useState(machine.locked);
  const [covered, setCovered] = useState(false);
  const [paused, setPaused] = useState(false);   // app unmounted around a storage-format change
  const [generation, setGeneration] = useState(0);

  const engage = useCallback(() => {
    machine.lock();
    engageLock();
    setCovered(false);
    setLocked(true);
  }, [machine]);

  useEffect(
    () =>
      onConfigChange(() => {
        // Lock turned off (e.g. "use password instead") while the screen was up: nothing to guard any more.
        if (!getConfig(currentUser())) {
          machine.unlock();
          setLocked(false);
        }
      }),
    [machine],
  );

  // Web enable/disable of the PRF lock changes the storage-key format: the app
  // must not hold keys or write while it happens.
  useEffect(() => {
    setExclusiveRunner(async (fn) => {
      setPaused(true);
      await new Promise((r) => setTimeout(r, 60));   // let React unmount the app
      try {
        return await fn();
      } finally {
        setGeneration((g) => g + 1);
        setPaused(false);
      }
    });
    return () => setExclusiveRunner(null);
  }, []);

  useEffect(() => {
    const onHide = () => {
      const now = Date.now();
      const cfg = getConfig(currentUser());
      if (!cfg || authGuard.suspended(now) || appLockHeld(now)) return;
      machine.setTimeout(timingMs(cfg.timing));
      machine.background(now);
      setCovered(true);
    };
    const onShow = () => {
      const now = Date.now();
      const cfg = getConfig(currentUser());
      if (!cfg || authGuard.suspended(now) || appLockHeld(now)) {
        machine.discardBackground();
        setCovered(false);
        return;
      }
      machine.setTimeout(timingMs(cfg.timing));
      if (machine.foreground(now)) engage();
      else setCovered(false);
    };

    if (Capacitor.isNativePlatform()) {
      const subs = [
        CapApp.addListener("pause", onHide),
        CapApp.addListener("resume", onShow),
      ];
      return () => { subs.forEach((s) => void s.then((h) => h.remove())); };
    }
    const onVis = () => (document.visibilityState === "hidden" ? onHide() : onShow());
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [machine, engage]);

  const user = currentUser();
  const cfg = getConfig(user);

  if (locked && user && cfg) {
    return (
      <AppLockScreen
        user={user}
        config={cfg}
        onUnlocked={() => {
          machine.unlock();
          setLocked(false);
        }}
      />
    );
  }

  return (
    <>
      {!paused && <Fragment key={generation}>{children}</Fragment>}
      {covered && (
        <div
          aria-hidden
          className="fixed inset-0 z-[9999] bg-bg flex items-center justify-center"
        >
          <IrisMark className="w-16 h-16" />
        </div>
      )}
    </>
  );
}
