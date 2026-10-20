import { useState } from "react";
import type { UserProfile } from "../types";
import { groupApi, type GroupDto } from "../lib/groups/api";
import { uploadGroupAvatar } from "../lib/groups/avatar";
import { Avatar } from "./Avatar";
import { BackIcon, CameraIcon, CheckIcon } from "./icons";

type Props = {
  token: string;
  friends: UserProfile[];
  onCreated: (group: GroupDto) => void;
  onClose: () => void;
};

const MAX_MEMBERS = 64;

// Pick connections → name the group (optional photo) → create.
export function CreateGroupSheet({ token, friends, onCreated, onClose }: Props) {
  const [step, setStep] = useState<"members" | "details">("members");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = friends.filter((f) => {
    const q = filter.trim().toLowerCase();
    return !q || f.username.toLowerCase().includes(q) || (f.preferredName ?? "").toLowerCase().includes(q);
  });

  function toggle(username: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else if (next.size + 1 < MAX_MEMBERS) next.add(username);
      return next;
    });
  }

  function pickAvatar(file: File | undefined) {
    if (!file) return;
    setAvatar(file);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
  }

  async function create() {
    if (!name.trim()) { setError("Give the group a name"); return; }
    setBusy(true);
    setError(null);
    try {
      let group = await groupApi.create(token, name.trim(), [...selected]);
      if (avatar) group = await groupApi.update(token, group.id, { avatarUrl: await uploadGroupAvatar(avatar, token) });
      onCreated(group);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the group");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-bg">
      <header className="px-4 pt-5 pb-3 flex items-center gap-3 border-b border-muted-soft/30">
        <button
          onClick={step === "details" ? () => setStep("members") : onClose}
          className="text-navy hover:opacity-70 p-1"
          aria-label="Back"
        >
          <BackIcon />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-navy">{step === "members" ? "New group" : "Name your group"}</h2>
          <p className="text-xs text-muted">
            {step === "members" ? `${selected.size} selected` : `${selected.size + 1} members including you`}
          </p>
        </div>
        {step === "members" && (
          <button
            onClick={() => setStep("details")}
            className="text-sm font-bold text-white bg-primary px-4 py-1.5 rounded-full active:scale-95 transition-transform"
          >
            Next
          </button>
        )}
      </header>

      {step === "members" ? (
        <>
          <div className="px-4 py-3">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search connections…"
              className="w-full bg-card rounded-xl px-3 py-2 text-navy text-sm outline-none placeholder:text-muted"
            />
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-4">
            {friends.length === 0 && (
              <p className="text-center text-muted text-sm py-12 px-6">
                You can add people you're connected with. You can also create the group now and share its invite link.
              </p>
            )}
            {visible.map((f) => {
              const on = selected.has(f.username);
              return (
                <button
                  key={f.username}
                  onClick={() => toggle(f.username)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-card/60 text-left"
                  aria-pressed={on}
                >
                  <Avatar name={f.preferredName || f.username} avatarUrl={f.avatarUrl} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-navy truncate">{f.preferredName || f.username}</p>
                    <p className="text-xs text-muted truncate">@{f.username}</p>
                  </div>
                  <span
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      on ? "bg-primary border-primary text-white" : "border-muted-soft"
                    }`}
                  >
                    {on && <CheckIcon className="w-3.5 h-3.5" />}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col items-center gap-5">
          <label className="relative cursor-pointer" aria-label="Group photo">
            {preview ? (
              <img src={preview} alt="" className="w-24 h-24 rounded-full object-cover" />
            ) : (
              <span className="w-24 h-24 rounded-full bg-card flex items-center justify-center text-muted">
                <CameraIcon className="w-8 h-8" />
              </span>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => pickAvatar(e.target.files?.[0])}
            />
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 64))}
            placeholder="Group name"
            autoFocus
            className="w-full bg-card rounded-xl px-4 py-3 text-navy font-bold outline-none placeholder:text-muted placeholder:font-normal"
          />
          <p className="text-xs text-muted text-center leading-relaxed">
            Messages are end-to-end encrypted for every member's devices. The group's name, photo and member
            list are stored on the server so it can deliver to the right people.
          </p>
          {error && <p className="text-sm text-danger text-center">{error}</p>}
          <button
            onClick={create}
            disabled={busy}
            className="iris-fill w-full text-white font-bold py-3 rounded-full disabled:opacity-60 active:scale-[0.98] transition-transform"
          >
            {busy ? "Creating…" : "Create group"}
          </button>
        </div>
      )}
    </div>
  );
}
