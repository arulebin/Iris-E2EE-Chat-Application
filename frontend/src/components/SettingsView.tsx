import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { BackIcon, BellIcon, LogoutIcon } from "./icons";
import { Avatar } from "./Avatar";

type Props = {
  me: string | null;
  meProfile?: import("../types").UserProfile;
  pushEnabled: boolean;
  pushError: string | null;
  isBrave: boolean;
  onBack: () => void;
  onEnableNotifications: () => void;
  onLogout: () => void;
  onUpdateProfile: (name: string, file: File | null) => Promise<void>;
};

export function SettingsView({
  me,
  meProfile,
  pushEnabled,
  pushError,
  isBrave,
  onBack,
  onEnableNotifications,
  onLogout,
  onUpdateProfile
}: Props) {
  const [preferredName, setPreferredName] = useState(meProfile?.preferredName || "");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const inviteUrl = `${window.location.origin}/?add=${me}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(inviteUrl);
    alert("Invite link copied to clipboard!");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const f = e.target.files[0];
      setFile(f);
      const objUrl = URL.createObjectURL(f);
      setFilePreview(objUrl);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdateProfile(preferredName, file);
    } catch (err) {
      console.error(err);
      alert("Failed to save profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg">
      <header className="flex items-center justify-between px-3 py-3 border-b border-muted-soft/30">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1 text-navy hover:opacity-70"
            aria-label="Back"
          >
            <BackIcon />
          </button>
          <h1 className="text-xl font-bold text-navy">Profile & Settings</h1>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || (preferredName === (meProfile?.preferredName || "") && !file)}
          className="text-primary font-bold px-4 py-1 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
        <section className="flex flex-col items-center">
          <div className="relative mb-4">
            <Avatar 
              name={meProfile?.preferredName || me!} 
              avatarUrl={filePreview || meProfile?.avatarUrl} 
              size="lg" 
            />
            <label className="absolute bottom-0 right-0 bg-primary w-6 h-6 rounded-full flex items-center justify-center text-white cursor-pointer hover:opacity-90 shadow">
              <span className="text-lg leading-none -mt-1">+</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </label>
          </div>
          <p className="font-bold text-navy text-lg">{me}</p>
        </section>

        <section>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
            Profile Info
          </p>
          <div className="bg-card rounded-2xl px-4 py-3 shadow-sm flex flex-col gap-2">
            <label className="text-xs text-muted">Preferred Name (visible to others)</label>
            <input 
              type="text" 
              value={preferredName} 
              onChange={e => setPreferredName(e.target.value)} 
              placeholder={me!}
              className="bg-transparent text-navy font-bold outline-none placeholder:font-normal placeholder:text-muted"
            />
          </div>
        </section>

        <section>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
            Share Profile
          </p>
          <div className="bg-card rounded-2xl flex flex-col items-center p-6 shadow-sm gap-4">
            <div className="bg-white p-2 rounded-xl shadow-sm">
              <QRCodeSVG 
                value={inviteUrl} 
                size={180} 
                fgColor="#3f51b5" 
                imageSettings={meProfile?.avatarUrl ? {
                  src: `/api/media/profile/${meProfile.avatarUrl}`,
                  height: 48,
                  width: 48,
                  excavate: true
                } : undefined}
              />
            </div>
            <p className="text-sm text-center text-muted">Have friends scan this code or use your link to add you.</p>
            <button 
              onClick={handleCopyLink}
              className="w-full bg-primary text-white font-bold py-2 rounded-xl hover:bg-primary/90"
            >
              Copy Invite Link
            </button>
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
          className="mt-4 mb-4 bg-card hover:bg-card/80 text-red-500 font-semibold py-3 rounded-2xl shadow-sm flex items-center justify-center gap-2"
        >
          <LogoutIcon />
          Log out
        </button>
      </div>
    </div>
  );
}
