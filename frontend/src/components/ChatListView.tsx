import { Avatar } from "./Avatar";
import {
  ChatBubbleIcon,
  NewChatIcon,
  SearchIcon,
  SettingsIcon,
} from "./icons";

type Props = {
  me: string | null;
  users: string[];
  recipient: string;
  onSelectUser: (username: string) => void;
  onOpenSettings: () => void;
};

type Tab = "messages" | "groups";

export function ChatListView({
  me,
  users,
  recipient,
  onSelectUser,
  onOpenSettings,
}: Props) {
  // Groups isn't built yet — tab is a visual placeholder for the design.
  const activeTab: Tab = "messages";

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Top bar */}
      <header className="px-5 pt-6 pb-3 flex items-center justify-between">
        <h1 className="text-3xl font-extrabold text-navy">Iris</h1>
        <div className="flex items-center gap-3">
          <button
            className="text-navy hover:opacity-70"
            aria-label="Search (coming soon)"
            disabled
          >
            <SearchIcon />
          </button>
          <button
            onClick={onOpenSettings}
            className="text-navy hover:opacity-70"
            aria-label="Settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      <p className="px-5 pb-3 text-xs text-muted">
        Signed in as <span className="font-semibold text-navy">{me}</span>
      </p>

      {/* Pill tabs */}
      <div className="px-5 pb-3">
        <div className="bg-muted-soft/40 rounded-full p-1 flex">
          <button
            className={`flex-1 py-2 text-sm font-bold rounded-full transition ${
              activeTab === "messages"
                ? "bg-navy text-white shadow"
                : "text-navy"
            }`}
          >
            Messages
          </button>
          <button
            className="flex-1 py-2 text-sm font-bold rounded-full text-muted cursor-not-allowed"
            disabled
            title="Groups coming soon"
          >
            Groups
          </button>
        </div>
      </div>

      {/* User list */}
      <div className="flex-1 overflow-y-auto px-2">
        {users.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-8 py-20 text-center">
            <ChatBubbleIcon className="w-14 h-14 text-muted mb-4" />
            <p className="text-muted text-base leading-snug">
              No chat found.
              <br />
              Sign up another account to start one.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1 py-2">
            {users.map((u) => (
              <li key={u}>
                <button
                  onClick={() => onSelectUser(u)}
                  className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-2xl transition ${
                    recipient === u
                      ? "bg-card shadow-sm"
                      : "hover:bg-card/60"
                  }`}
                >
                  <Avatar name={u} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-navy truncate">{u}</p>
                    <p className="text-xs text-muted truncate">Tap to open chat</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* FAB — placeholder for "new chat" flow */}
      <button
        className="absolute bottom-6 right-6 sm:bottom-8 sm:right-8 w-14 h-14 bg-navy hover:bg-navy-muted text-white rounded-full shadow-lg flex items-center justify-center"
        aria-label="New chat (coming soon)"
        disabled
      >
        <NewChatIcon />
      </button>
    </div>
  );
}
