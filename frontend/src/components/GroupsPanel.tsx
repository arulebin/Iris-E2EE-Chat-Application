import type { GroupDto } from "../lib/groups/api";
import type { GroupPreview } from "../lib/groups/useGroups";
import { Avatar } from "./Avatar";
import { UsersIcon } from "./icons";

type Props = {
  me: string | null;
  groups: GroupDto[];
  previews: Record<string, GroupPreview>;
  activeGroupId?: string | null;
  onOpen: (groupId: string) => void;
  onCreate: () => void;
};

function shortTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    if (now.getTime() - d.getTime() < 7 * 86400000) return d.toLocaleDateString([], { weekday: "short" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

// The "Groups" tab of the chat list.
export function GroupsPanel({ me, groups, previews, activeGroupId, onOpen, onCreate }: Props) {
  return (
    <div className="flex-1 overflow-y-auto px-2">
      <button
        onClick={onCreate}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-card/60 active:bg-card/80 text-left"
      >
        <span className="iris-fill w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0">
          <UsersIcon className="w-5 h-5" />
        </span>
        <span className="font-bold text-primary">New group</span>
      </button>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
          <UsersIcon className="w-14 h-14 text-muted mb-4" />
          <p className="text-muted text-base leading-snug">
            No groups yet.
            <br />
            Start one with your connections — every message is end-to-end encrypted for each member.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1 py-2">
          {groups.map((g) => {
            const pv = previews[g.id];
            const who = pv && (pv.from === me ? "You" : g.members.find((m) => m.username === pv.from)?.preferredName || pv.from);
            return (
              <li key={g.id}>
                <button
                  onClick={() => onOpen(g.id)}
                  className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-2xl transition ${
                    activeGroupId === g.id ? "bg-card shadow-sm" : "hover:bg-card/60 active:bg-card/80"
                  }`}
                >
                  <Avatar name={g.name} avatarUrl={g.avatarUrl ?? undefined} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-navy truncate flex-1">{g.name}</p>
                      {pv && <span className="text-[11px] text-muted shrink-0 font-medium">{shortTime(pv.time)}</span>}
                    </div>
                    <p className="text-xs text-muted truncate">
                      {pv ? `${who}: ${pv.text}` : `${g.members.length} member${g.members.length === 1 ? "" : "s"}`}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
