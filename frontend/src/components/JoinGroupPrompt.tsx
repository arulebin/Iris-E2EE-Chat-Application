import { useEffect, useState } from "react";
import { groupApi, type GroupDto, type InvitePreview } from "../lib/groups/api";
import { Avatar } from "./Avatar";

type Props = {
  token: string;
  inviteToken: string;
  onJoined: (group: GroupDto) => void;
  onClose: () => void;
};

// Opened from a ?group=<token> invite link: show what you'd join, then join.
export function JoinGroupPrompt({ token, inviteToken, onJoined, onClose }: Props) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    groupApi.previewInvite(token, inviteToken)
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "This invite link is no longer valid"); });
    return () => { cancelled = true; };
  }, [token, inviteToken]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      onJoined(await groupApi.join(token, inviteToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join the group");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={onClose}>
      <div className="w-full max-w-sm bg-bg rounded-3xl p-6 flex flex-col items-center gap-3 text-center" onClick={(e) => e.stopPropagation()}>
        {preview ? (
          <>
            <Avatar name={preview.name} avatarUrl={preview.avatarUrl ?? undefined} size="lg" />
            <p className="text-xl font-extrabold text-navy">{preview.name}</p>
            <p className="text-sm text-muted">{preview.memberCount} member{preview.memberCount === 1 ? "" : "s"}</p>
            <p className="text-xs text-muted leading-relaxed">
              Members will be able to see your name and profile photo. Messages are end-to-end encrypted.
            </p>
          </>
        ) : !error ? (
          <p className="text-muted text-sm py-6">Loading invite…</p>
        ) : null}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2 w-full mt-2">
          <button onClick={onClose} className="flex-1 text-sm font-bold text-navy bg-card py-2.5 rounded-full">
            {preview ? "Not now" : "Close"}
          </button>
          {preview && (
            <button
              disabled={busy}
              onClick={preview.alreadyMember ? () => groupApi.get(token, preview.groupId).then(onJoined).catch(() => onClose()) : join}
              className="iris-fill flex-1 text-sm font-bold text-white py-2.5 rounded-full disabled:opacity-60"
            >
              {preview.alreadyMember ? "Open group" : busy ? "Joining…" : "Join group"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
