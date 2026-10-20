import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { apiBase } from "../lib/config";
import { useProfileImage } from "../lib/profileImage";
import { inviteUrl, normalizeInviteCode, shareInvite } from "../lib/invite";

type Props = {
  token: string;
  avatarUrl?: string;
};

type Privacy = { privateProfile: boolean; invitesEnabled: boolean; inviteCode: string | null };

function Toggle({ on, label, onChange, disabled }: {
  on: boolean; label: string; onChange: () => void; disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={`relative shrink-0 w-11 h-6 rounded-full transition disabled:opacity-50 ${on ? "bg-primary" : "bg-muted-soft"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

/** Settings → Profile privacy, invite link/QR, and blocked people. */
export function PrivacySettings({ token, avatarUrl }: Props) {
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const qrAvatarSrc = useProfileImage(avatarUrl);
  const auth = { Authorization: `Bearer ${token}` };

  const loadBlocked = useCallback(() =>
    fetch(`${apiBase}/api/blocks`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : []))
      .then((list: { username: string }[]) => setBlocked(list.map(b => b.username)))
      .catch(() => {}), [token]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBase}/api/privacy`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(p => { if (!cancelled && p) setPrivacy(p); })
      .catch(() => {});
    loadBlocked();
    return () => { cancelled = true; };
  }, [token, loadBlocked]);

  async function update(body: Partial<Pick<Privacy, "privateProfile" | "invitesEnabled">>) {
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/privacy`, {
        method: "PUT",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) setPrivacy(await res.json());
    } finally {
      setBusy(false);
    }
  }

  async function resetCode() {
    setConfirmReset(false);
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/privacy/invite/reset`, { method: "POST", headers: auth });
      if (res.ok) {
        setPrivacy(await res.json());
        setNote("New invite link created. The old link and QR code no longer work.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function unblock(username: string) {
    await fetch(`${apiBase}/api/blocks/${encodeURIComponent(username)}`, { method: "DELETE", headers: auth });
    loadBlocked();
  }

  const code = privacy?.inviteCode ? normalizeInviteCode(privacy.inviteCode) : null;
  const link = code ? inviteUrl(code) : null;

  async function share() {
    if (!link) return;
    const outcome = await shareInvite(link);
    if (outcome === "copied") setNote("Invite link copied.");
  }

  return (
    <>
      <section>
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Who can find you</p>
        <div className="bg-card rounded-2xl px-4 py-3 shadow-sm dark:border dark:border-muted-soft flex items-center justify-between gap-4">
          <div>
            <p className="text-navy text-sm font-semibold">Private profile</p>
            <p className="text-xs text-muted leading-snug mt-0.5">
              Hide from search. People can only add you with your invite link or code, and only
              your connections see your name and photo.
            </p>
          </div>
          <Toggle
            on={!!privacy?.privateProfile}
            label="Private profile"
            disabled={!privacy || busy}
            onChange={() => privacy && update({ privateProfile: !privacy.privateProfile })}
          />
        </div>
      </section>

      <section>
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Invite link</p>
        <div className="bg-card rounded-2xl p-5 shadow-sm dark:border dark:border-muted-soft flex flex-col items-center gap-4">
          <div className="w-full flex items-center justify-between gap-4">
            <p className="text-navy text-sm font-semibold">Allow invites</p>
            <Toggle
              on={!!privacy?.invitesEnabled}
              label="Allow invites"
              disabled={!privacy || busy}
              onChange={() => privacy && update({ invitesEnabled: !privacy.invitesEnabled })}
            />
          </div>

          {privacy && !privacy.invitesEnabled && (
            <p className="text-xs text-muted text-center leading-snug">
              Invites are off — nobody can add you with a link or code.
              {privacy.privateProfile ? " With a private profile, only people you send requests to can connect." : ""}
            </p>
          )}

          {link && code && (
            <>
              <div className="bg-white p-2 rounded-xl shadow-sm border border-muted-soft">
                <QRCodeSVG
                  value={link}
                  size={180}
                  fgColor="#5b5bd6"
                  imageSettings={qrAvatarSrc ? { src: qrAvatarSrc, height: 44, width: 44, excavate: true } : undefined}
                />
              </div>
              <div className="text-center">
                <p className="text-xs text-muted">Your invite code</p>
                <p className="font-mono text-lg font-bold tracking-widest text-navy select-all">{privacy?.inviteCode}</p>
              </div>
              <div className="w-full flex gap-2">
                <button
                  onClick={share}
                  className="flex-1 bg-primary text-white font-bold py-2 rounded-xl hover:bg-primary/90"
                >
                  Share invite
                </button>
                <button
                  onClick={() => navigator.clipboard.writeText(link).then(() => setNote("Invite link copied."))}
                  className="flex-1 bg-primary/10 text-primary font-bold py-2 rounded-xl"
                >
                  Copy link
                </button>
              </div>
              {confirmReset ? (
                <div className="w-full flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted">Old link and QR will stop working.</span>
                  <span className="flex gap-2 shrink-0">
                    <button onClick={() => setConfirmReset(false)} className="font-bold text-muted px-2 py-1">Cancel</button>
                    <button onClick={resetCode} className="font-bold text-danger px-2 py-1">Reset</button>
                  </span>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmReset(true)}
                  disabled={busy}
                  className="text-xs font-semibold text-danger hover:underline disabled:opacity-50"
                >
                  Reset invite link
                </button>
              )}
            </>
          )}
          {note && <p className="text-xs text-muted text-center">{note}</p>}
        </div>
      </section>

      <section>
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Blocked</p>
        <div className="bg-card rounded-2xl px-4 py-2 shadow-sm dark:border dark:border-muted-soft">
          {blocked.length === 0 ? (
            <p className="text-sm text-muted py-1.5">You haven't blocked anyone.</p>
          ) : (
            <ul className="divide-y divide-muted-soft/30">
              {blocked.map(u => (
                <li key={u} className="flex items-center justify-between py-2">
                  <span className="text-sm text-navy font-semibold truncate">@{u}</span>
                  <button onClick={() => unblock(u)} className="text-xs font-bold text-primary px-2 py-1">
                    Unblock
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
