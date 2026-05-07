import { useRef, useState } from "react";
import { ImageIcon, SmileIcon, TimerIcon } from "./icons";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onSendMedia?: (file: File, viewOnce: boolean) => Promise<void>;
  disabled?: boolean;
  disabledHint?: string | null;
};

export function MessageInput({
  value,
  onChange,
  onSend,
  onSendMedia,
  disabled,
  disabledHint,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [snapMode, setSnapMode] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !onSendMedia) return;
    setUploadError(null);
    setUploading(true);
    try {
      await onSendMedia(file, snapMode);
      setSnapMode(false); // reset after a successful snap so the next pic is normal
    } catch (err: any) {
      setUploadError(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="px-4 py-3 border-t border-muted-soft/30 bg-bg">
      {snapMode && (
        <div className="mb-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center gap-1.5 w-fit">
          <TimerIcon className="w-3.5 h-3.5" />
          Snap mode — next photo or video will self-destruct after viewing
        </div>
      )}
      <div className="flex items-center gap-2 bg-card rounded-full px-4 py-2 shadow-sm">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !disabled && onSend()}
          placeholder={uploading ? "Uploading…" : "Type here..."}
          disabled={disabled || uploading}
          className="flex-1 bg-transparent text-navy placeholder:text-muted text-[15px] focus:outline-none disabled:opacity-50"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={handleFile}
        />
        <button
          type="button"
          onClick={() => setSnapMode((s) => !s)}
          className={`p-1 rounded-full transition ${
            snapMode ? "text-primary" : "text-muted hover:text-navy"
          } disabled:opacity-50`}
          aria-label={snapMode ? "Snap mode on — tap to disable" : "Send next photo as snap"}
          aria-pressed={snapMode}
          disabled={disabled || uploading || !onSendMedia}
        >
          <TimerIcon />
        </button>
        <button
          type="button"
          className="text-muted hover:text-navy p-1 disabled:opacity-50"
          aria-label="Attach photo or video"
          disabled={disabled || uploading || !onSendMedia}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImageIcon />
        </button>
        <button
          type="button"
          className="text-muted hover:text-navy p-1"
          aria-label="Emoji (coming soon)"
          disabled
        >
          <SmileIcon />
        </button>
      </div>
      {uploadError && (
        <p className="text-xs text-red-500 mt-1.5 px-2">{uploadError}</p>
      )}
      {!uploadError && disabledHint && (
        <p className="text-xs text-muted mt-1.5 px-2">{disabledHint}</p>
      )}
    </div>
  );
}
