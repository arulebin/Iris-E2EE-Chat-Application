import { useState } from "react";
import { dismissRestore, restoreBackup } from "../lib/backup";

type Props = {
  me: string;
  token: string;
  onDone: (restored: number) => void;
};

/** Offered once on a new device when an encrypted history backup exists. */
export function RestoreBackupPrompt({ me, token, onDone }: Props) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await restoreBackup(me, token, key));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    await dismissRestore(me);
    onDone(0);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-title"
        onSubmit={restore}
        className="bg-card w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-6 flex flex-col gap-3"
      >
        <h2 id="restore-title" className="font-bold text-navy">Restore your messages?</h2>
        <p className="text-sm text-muted leading-snug">
          This is a new device, so your earlier secure messages aren't here. Enter
          your recovery key to restore them from your encrypted backup.
        </p>
        <input
          value={key}
          onChange={e => setKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="Recovery key"
          aria-label="Recovery key"
          className="bg-transparent border border-muted-soft rounded-xl px-3 py-2 font-mono text-navy outline-none focus:border-primary"
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={skip}
            disabled={busy}
            className="px-4 py-2 rounded-full text-sm font-semibold border border-muted-soft text-navy hover:opacity-80"
          >
            Skip
          </button>
          <button
            type="submit"
            disabled={busy || key.trim() === ""}
            className="px-4 py-2 rounded-full text-sm font-semibold bg-primary hover:bg-primary-hover text-white disabled:opacity-50"
          >
            {busy ? "Restoring…" : "Restore"}
          </button>
        </div>
      </form>
    </div>
  );
}
