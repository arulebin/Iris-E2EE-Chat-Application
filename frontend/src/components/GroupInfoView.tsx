import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { UserProfile } from "../types";
import type { ContactTrust } from "../lib/fingerprint";
import { groupApi, type GroupDto, type GroupMemberDto } from "../lib/groups/api";
import { uploadGroupAvatar } from "../lib/groups/avatar";
import { groupInviteUrl } from "../lib/groups/invite";
import { Avatar } from "./Avatar";
import { SafetyNumberView } from "./SafetyNumberView";
import { CameraIcon, CheckIcon, ShieldCheckIcon, XIcon } from "./icons";

type Props = {
  group: GroupDto;
  me: string;
  token: string;
  friends: UserProfile[];
  trust: Record<string, ContactTrust | undefined>;
  unavailable: string[];
  onClose: () => void;
  onChanged: (group: GroupDto) => void;
  onLeft: () => void;
};

export function GroupInfoView({ group, me, token, friends, trust, unavailable, onClose, onChanged, onLeft }: Props) {
  const isAdmin = group.myRole === "ADMIN";
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(group.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GroupMemberDto | null>(null);
  const [verifying, setVerifying] = useState<GroupMemberDto | null>(null);
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<Set<string>>(new Set());
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [copied, setCopied] = useState(false);

  async function run(action: () => Promise<GroupDto | undefined | void>) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next) onChanged(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const display = (m: GroupMemberDto) => (m.username === me ? "You" : m.preferredName || m.username);
  const inviteUrl = group.inviteToken ? groupInviteUrl(group.inviteToken) : null;
  const addable = friends.filter((f) => !group.members.some((m) => m.username === f.username));

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — long-press the link to copy it");
    }
  }

  async function shareInvite() {
    if (!inviteUrl) return;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) await nav.share({ title: group.name, text: `Join "${group.name}" on Iris`, url: inviteUrl }).catch(() => {});
    else void copyInvite();
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-bg">
      <header className="px-4 pt-5 pb-3 flex items-center gap-3 border-b border-muted-soft/30">
        <button onClick={onClose} className="text-navy hover:opacity-70 p-1" aria-label="Close">
          <XIcon />
        </button>
        <h2 className="text-lg font-bold text-navy">Group info</h2>
      </header>

      <div className="flex-1 overflow-y-auto pb-10">
        {/* Identity */}
        <section className="flex flex-col items-center gap-3 px-6 pt-6 pb-4">
          <label className={`relative ${isAdmin ? "cursor-pointer" : ""}`} aria-label="Group photo">
            <span className="block scale-[2] origin-center my-6">
              <Avatar name={group.name} avatarUrl={group.avatarUrl ?? undefined} size="lg" />
            </span>
            {isAdmin && (
              <>
                <span className="absolute -bottom-1 -right-3 bg-primary w-7 h-7 rounded-full flex items-center justify-center text-white shadow">
                  <CameraIcon className="w-4 h-4" />
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void run(async () => groupApi.update(token, group.id, { avatarUrl: await uploadGroupAvatar(file, token) }));
                  }}
                />
              </>
            )}
          </label>

          {editingName ? (
            <div className="flex items-center gap-2 w-full">
              <input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 64))}
                autoFocus
                className="flex-1 bg-card rounded-xl px-3 py-2 text-navy font-bold outline-none"
              />
              <button
                disabled={busy || !name.trim()}
                onClick={() => run(async () => {
                  const g = await groupApi.update(token, group.id, { name: name.trim() });
                  setEditingName(false);
                  return g;
                })}
                className="text-white bg-primary p-2 rounded-full disabled:opacity-50"
                aria-label="Save name"
              >
                <CheckIcon className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => isAdmin && setEditingName(true)}
              className={`text-2xl font-extrabold text-navy text-center ${isAdmin ? "hover:opacity-80" : "cursor-default"}`}
            >
              {group.name}
            </button>
          )}
          <p className="text-xs text-muted text-center">
            {group.members.length} members · messages are end-to-end encrypted for each member's devices
          </p>
        </section>

        {error && <p className="px-6 pb-3 text-sm text-danger text-center">{error}</p>}

        {/* Invite link */}
        {isAdmin && (
          <section className="mx-4 mb-4 rounded-2xl bg-card p-4">
            <p className="font-bold text-navy mb-1">Invite link</p>
            {inviteUrl ? (
              <>
                <p className="text-xs text-muted mb-3">Anyone with this link can join. Reset it to cut off the old one.</p>
                <div className="flex justify-center mb-3">
                  <div className="bg-white p-3 rounded-xl">
                    <QRCodeSVG value={inviteUrl} size={148} />
                  </div>
                </div>
                <p className="selectable text-xs text-navy break-all bg-bg rounded-lg px-3 py-2 mb-3">{inviteUrl}</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={copyInvite} className="text-xs font-bold text-primary bg-primary/10 px-3 py-1.5 rounded-full">
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button onClick={shareInvite} className="text-xs font-bold text-primary bg-primary/10 px-3 py-1.5 rounded-full">
                    Share
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => run(() => groupApi.resetInvite(token, group.id))}
                    className="text-xs font-bold text-navy bg-muted-soft/30 px-3 py-1.5 rounded-full"
                  >
                    Reset link
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => run(() => groupApi.disableInvite(token, group.id))}
                    className="text-xs font-bold text-danger bg-danger/10 px-3 py-1.5 rounded-full"
                  >
                    Turn off
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-muted mb-3">Let people join without being added one by one.</p>
                <button
                  disabled={busy}
                  onClick={() => run(() => groupApi.resetInvite(token, group.id))}
                  className="text-xs font-bold text-white bg-primary px-3 py-1.5 rounded-full"
                >
                  Create invite link
                </button>
              </>
            )}
          </section>
        )}

        {/* Members */}
        <section className="mx-4 mb-4 rounded-2xl bg-card py-2">
          <div className="flex items-center justify-between px-4 py-2">
            <p className="font-bold text-navy">Members</p>
            {isAdmin && (
              <button onClick={() => setAdding(true)} className="text-xs font-bold text-primary">
                Add members
              </button>
            )}
          </div>
          <ul>
            {group.members.map((m) => {
              const t = trust[m.username];
              return (
                <li key={m.username}>
                  <button
                    onClick={() => m.username !== me && setSelected(m)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-bg/60"
                  >
                    <Avatar name={m.preferredName || m.username} avatarUrl={m.avatarUrl ?? undefined} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-navy truncate flex items-center gap-1">
                        <span className="truncate">{display(m)}</span>
                        {t?.verified && !t.changed && (
                          <span className="text-online shrink-0" title="Safety number verified">
                            <ShieldCheckIcon className="w-4 h-4" />
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted truncate">
                        @{m.username}
                        {t?.changed && <span className="text-danger font-semibold"> · key changed</span>}
                        {unavailable.includes(m.username) && <span className="text-danger"> · can't receive messages</span>}
                      </p>
                    </div>
                    {m.role === "ADMIN" && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                        Admin
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Leave */}
        <section className="mx-4">
          {confirmLeave ? (
            <div className="rounded-2xl bg-danger/10 p-4">
              <p className="text-sm text-navy mb-3">
                Leave "{group.name}"? You'll stop receiving its messages. Your history on this device stays.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmLeave(false)} className="text-xs font-bold text-navy bg-card px-3 py-1.5 rounded-full">
                  Cancel
                </button>
                <button
                  disabled={busy}
                  onClick={() => run(async () => { await groupApi.removeMember(token, group.id, me); onLeft(); })}
                  className="text-xs font-bold text-white bg-danger px-3 py-1.5 rounded-full"
                >
                  Leave group
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmLeave(true)} className="w-full text-left rounded-2xl bg-card px-4 py-3 font-bold text-danger">
              Leave group
            </button>
          )}
        </section>
      </div>

      {/* Member actions */}
      {selected && (
        <div className="absolute inset-0 z-50 flex items-end bg-black/40" onClick={() => setSelected(null)}>
          <div className="w-full bg-bg rounded-t-3xl p-4 pb-8 flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
            <p className="font-bold text-navy px-2 pb-2">{display(selected)}</p>
            <button
              onClick={() => { setVerifying(selected); setSelected(null); }}
              className="text-left px-3 py-3 rounded-xl hover:bg-card font-semibold text-navy"
            >
              Verify safety number
            </button>
            {isAdmin && (
              <button
                disabled={busy}
                onClick={() => {
                  const target = selected;
                  setSelected(null);
                  void run(() => groupApi.setRole(token, group.id, target.username, target.role === "ADMIN" ? "MEMBER" : "ADMIN"));
                }}
                className="text-left px-3 py-3 rounded-xl hover:bg-card font-semibold text-navy"
              >
                {selected.role === "ADMIN" ? "Remove as admin" : "Make admin"}
              </button>
            )}
            {isAdmin && (
              <button
                disabled={busy}
                onClick={() => {
                  const target = selected;
                  setSelected(null);
                  void run(() => groupApi.removeMember(token, group.id, target.username));
                }}
                className="text-left px-3 py-3 rounded-xl hover:bg-card font-semibold text-danger"
              >
                Remove from group
              </button>
            )}
          </div>
        </div>
      )}

      {verifying && (
        <SafetyNumberView
          me={me}
          peer={verifying.username}
          peerName={verifying.preferredName || verifying.username}
          token={token}
          trust={trust[verifying.username]}
          onClose={() => setVerifying(null)}
        />
      )}

      {/* Add members */}
      {adding && (
        <div className="absolute inset-0 z-50 flex flex-col bg-bg">
          <header className="px-4 pt-5 pb-3 flex items-center gap-3 border-b border-muted-soft/30">
            <button onClick={() => { setAdding(false); setToAdd(new Set()); }} className="text-navy hover:opacity-70 p-1" aria-label="Close">
              <XIcon />
            </button>
            <h2 className="flex-1 text-lg font-bold text-navy">Add members</h2>
            <button
              disabled={busy || toAdd.size === 0}
              onClick={() => run(async () => {
                const g = await groupApi.addMembers(token, group.id, [...toAdd]);
                setAdding(false);
                setToAdd(new Set());
                return g;
              })}
              className="text-sm font-bold text-white bg-primary px-4 py-1.5 rounded-full disabled:opacity-50"
            >
              Add{toAdd.size ? ` (${toAdd.size})` : ""}
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {addable.length === 0 && (
              <p className="text-center text-muted text-sm py-12 px-6">
                All your connections are already here. Share the invite link to bring in others.
              </p>
            )}
            {addable.map((f) => {
              const on = toAdd.has(f.username);
              return (
                <button
                  key={f.username}
                  onClick={() => setToAdd((prev) => {
                    const next = new Set(prev);
                    if (on) next.delete(f.username); else next.add(f.username);
                    return next;
                  })}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-card/60 text-left"
                  aria-pressed={on}
                >
                  <Avatar name={f.preferredName || f.username} avatarUrl={f.avatarUrl} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-navy truncate">{f.preferredName || f.username}</p>
                    <p className="text-xs text-muted truncate">@{f.username}</p>
                  </div>
                  <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${on ? "bg-primary border-primary text-white" : "border-muted-soft"}`}>
                    {on && <CheckIcon className="w-3.5 h-3.5" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
