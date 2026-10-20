import { useCallback, useEffect, useState } from "react";
import {
  backupNow,
  BackupKeyChangedError,
  disableBackup,
  enableBackup,
  fetchBackupMeta,
  isBackupEnabled,
  lastBackupAt,
  restoreBackup,
  type BackupMeta,
} from "../lib/backup";

type Props = {
  me: string;
  token: string;
  /** Called after a restore so open chats reload from local history. */
  onRestored: (count: number) => void;
};

type Status = { enabled: boolean; last: number | null; server: BackupMeta | null };

function when(ts: number | string | null | undefined): string {
  if (!ts) return "never";
  return new Date(ts).toLocaleString();
}

/**
 * Settings → Message backup. Forward-secret messages can't be re-downloaded on a
 * new device, so history is backed up E2E-encrypted under a recovery key that
 * only the user holds.
 */
export function BackupSettings({ me, token, onRestored }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);

  const refresh = useCallback(async () => {
    const [enabled, last, server] = await Promise.all([
      isBackupEnabled(me),
      lastBackupAt(me),
      fetchBackupMeta(token).catch(() => null),
    ]);
    setStatus({ enabled, last, server });
  }, [me, token]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([isBackupEnabled(me), lastBackupAt(me), fetchBackupMeta(token).catch(() => null)])
      .then(([enabled, last, server]) => { if (!cancelled) setStatus({ enabled, last, server }); });
    return () => { cancelled = true; };
  }, [me, token]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
      refresh().catch(() => {});
    }
  }

  const turnOn = () => run(async () => {
    setConfirmReplace(false);
    setShownKey(await enableBackup(me, token));
  });

  const backUp = () => run(async () => {
    try {
      await backupNow(me, token);
      setInfo("Backup updated.");
    } catch (err) {
      if (err instanceof BackupKeyChangedError) setRestoring(true);
      throw err;
    }
  });

  const restore = () => run(async () => {
    const count = await restoreBackup(me, token, keyInput);
    setKeyInput("");
    setRestoring(false);
    setInfo(`Restored ${count} message${count === 1 ? "" : "s"}.`);
    onRestored(count);
  });

  const turnOff = () => run(async () => {
    await disableBackup(me, token);
    setShownKey(null);
    setInfo("Backup deleted.");
  });

  const serverHasBackup = !!status?.server?.exists;

  return (
    <section>
      <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
        Message backup
      </p>
      <div className="bg-card rounded-2xl px-4 py-3 shadow-sm dark:border dark:border-muted-soft flex flex-col gap-3 text-sm">
        <p className="text-muted leading-snug">
          Messages are end-to-end encrypted with forward secrecy, so a new device
          starts empty. An encrypted backup — locked with a recovery key only you
          have — lets you bring your history along.
        </p>

        {!status && <p className="text-muted">Checking…</p>}

        {shownKey && (
          <div role="alert" className="rounded-xl border border-primary/40 bg-primary/10 p-3 flex flex-col gap-2">
            <p className="font-semibold text-navy">Your recovery key</p>
            <p className="font-mono text-navy text-base break-all select-all tracking-wider">{shownKey}</p>
            <p className="text-xs text-navy-muted leading-snug">
              Write this down and keep it somewhere safe. It's shown only once, and
              without it the backup can't be opened — not even by Iris.
            </p>
            <button
              onClick={() => setShownKey(null)}
              className="self-start px-3 py-1.5 rounded-full text-xs font-semibold bg-primary hover:bg-primary-hover text-white"
            >
              I've saved it
            </button>
          </div>
        )}

        {status && status.enabled && (
          <>
            <p className="text-navy">
              Backups are on. Last backup from this device: <span className="font-semibold">{when(status.last)}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={backUp}
                disabled={busy}
                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-primary hover:bg-primary-hover text-white disabled:opacity-50"
              >
                {busy ? "Working…" : "Back up now"}
              </button>
              <button
                onClick={turnOff}
                disabled={busy}
                className="px-3 py-1.5 rounded-full text-xs font-semibold border border-muted-soft text-danger hover:opacity-80 disabled:opacity-50"
              >
                Turn off and delete backup
              </button>
            </div>
          </>
        )}

        {status && !status.enabled && (
          <>
            {serverHasBackup && (
              <p className="text-navy">
                A backup from {when(status.server?.updatedAt)} exists. Restore it with your recovery key.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {serverHasBackup && (
                <button
                  onClick={() => setRestoring(r => !r)}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold bg-primary hover:bg-primary-hover text-white disabled:opacity-50"
                >
                  Restore from backup
                </button>
              )}
              <button
                onClick={() => (serverHasBackup ? setConfirmReplace(true) : turnOn())}
                disabled={busy}
                className={serverHasBackup
                  ? "px-3 py-1.5 rounded-full text-xs font-semibold border border-muted-soft text-navy hover:opacity-80 disabled:opacity-50"
                  : "px-3 py-1.5 rounded-full text-xs font-semibold bg-primary hover:bg-primary-hover text-white disabled:opacity-50"}
              >
                {serverHasBackup ? "Start a new backup" : busy ? "Working…" : "Turn on backup"}
              </button>
            </div>
          </>
        )}

        {confirmReplace && (
          <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 flex flex-col gap-2">
            <p className="text-navy">
              This replaces the existing backup with a new one under a new recovery
              key. History only on your other devices won't be in it.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmReplace(false)} className="px-3 py-1.5 rounded-full text-xs font-semibold border border-muted-soft text-navy">
                Cancel
              </button>
              <button onClick={turnOn} disabled={busy} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-danger hover:bg-danger-hover text-white disabled:opacity-50">
                Replace backup
              </button>
            </div>
          </div>
        )}

        {restoring && (
          <form
            className="flex flex-col gap-2"
            onSubmit={e => { e.preventDefault(); restore(); }}
          >
            <label className="text-xs text-muted" htmlFor="recovery-key">Recovery key</label>
            <input
              id="recovery-key"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="XXXX XXXX XXXX …"
              className="bg-transparent border border-muted-soft rounded-xl px-3 py-2 font-mono text-navy outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={busy || keyInput.trim() === ""}
              className="self-start px-3 py-1.5 rounded-full text-xs font-semibold bg-primary hover:bg-primary-hover text-white disabled:opacity-50"
            >
              {busy ? "Restoring…" : "Restore"}
            </button>
          </form>
        )}

        {info && <p className="text-xs text-online">{info}</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </section>
  );
}
