import { BackIcon, BellIcon, LogoutIcon } from "./icons";

type Props = {
  me: string | null;
  pushEnabled: boolean;
  pushError: string | null;
  isBrave: boolean;
  onBack: () => void;
  onEnableNotifications: () => void;
  onLogout: () => void;
};

export function SettingsView({
  me,
  pushEnabled,
  pushError,
  isBrave,
  onBack,
  onEnableNotifications,
  onLogout,
}: Props) {
  return (
    <div className="flex flex-col h-full bg-bg">
      <header className="flex items-center gap-3 px-3 py-3 border-b border-muted-soft/30">
        <button
          onClick={onBack}
          className="p-1 text-navy hover:opacity-70"
          aria-label="Back"
        >
          <BackIcon />
        </button>
        <h1 className="text-xl font-bold text-navy">Settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
        <section>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
            Account
          </p>
          <div className="bg-card rounded-2xl px-4 py-3 shadow-sm">
            <p className="text-xs text-muted">Signed in as</p>
            <p className="font-bold text-navy">{me}</p>
          </div>
        </section>

        <section>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
            Notifications
          </p>
          <div className="bg-card rounded-2xl px-4 py-3 shadow-sm">
            {pushEnabled ? (
              <p className="flex items-center gap-2 text-navy text-sm">
                <BellIcon />
                Push notifications enabled
              </p>
            ) : (
              <button
                onClick={onEnableNotifications}
                className="flex items-center gap-2 text-primary font-semibold text-sm hover:underline"
              >
                <BellIcon />
                Enable push notifications
              </button>
            )}
            {pushError && (
              <p className="text-xs text-red-500 mt-2">{pushError}</p>
            )}
            {isBrave && !pushEnabled && (
              <p className="text-xs text-muted mt-2 leading-snug">
                Brave: enable Google services for push at{" "}
                <span className="font-mono">brave://settings/privacy</span>
              </p>
            )}
          </div>
        </section>

        <button
          onClick={onLogout}
          className="mt-auto bg-card hover:bg-card/80 text-red-500 font-semibold py-3 rounded-2xl shadow-sm flex items-center justify-center gap-2"
        >
          <LogoutIcon />
          Log out
        </button>
      </div>
    </div>
  );
}
