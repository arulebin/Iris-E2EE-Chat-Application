import { useRef, useState } from "react";
import type { ChatMessage } from "../types";
import { CameraCapture } from "./CameraCapture";
import { CameraIcon, ImageIcon, SmileIcon, TimerIcon, XIcon } from "./icons";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onSendMedia?: (file: File, viewOnce: boolean) => Promise<void>;
  disabled?: boolean;
  disabledHint?: string | null;
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
};

export function MessageInput({
  value,
  onChange,
  onSend,
  onSendMedia,
  disabled,
  disabledHint,
  replyTo,
  onCancelReply,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [snapMode, setSnapMode] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  async function uploadFile(file: File) {
    if (!onSendMedia) return;
    setUploadError(null);
    setUploading(true);
    try {
      await onSendMedia(file, snapMode);
      // Wait for it slightly so order is preserved somewhat
      await new Promise((r) => setTimeout(r, 100));
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      throw err; // throw to stop sequence
    } finally {
      setUploading(false);
    }
  }

  async function confirmPendingFiles() {
    try {
      for (const file of pendingFiles) {
        await uploadFile(file);
      }
      setPendingFiles([]);
      setSnapMode(false);
    } catch (e) {
      // Error handled in uploadFile
    }
  }

  async function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setPendingFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleCameraCapture(file: File) {
    setCameraOpen(false);
    setPendingFiles([file]);
  }

  return (
    <>
      {cameraOpen && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onCancel={() => setCameraOpen(false)}
        />
      )}

      {pendingFiles.length > 0 && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col pt-4">
          <button
            onClick={() => setPendingFiles([])}
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2 z-10"
            aria-label="Cancel"
          >
            <XIcon className="w-7 h-7" />
          </button>
          
          <div className="flex-1 flex overflow-x-auto items-center snap-x px-4 gap-4 pb-[80px]">
            {pendingFiles.map((file, i) => (
              <div key={i} className="shrink-0 w-[80vw] max-w-sm max-h-[70vh] flex flex-col items-center justify-center snap-center relative">
                {file.type.startsWith("video/") ? (
                  <video src={URL.createObjectURL(file)} controls className="max-w-full max-h-full object-contain bg-muted/20" />
                ) : (
                  <img src={URL.createObjectURL(file)} className="max-w-full max-h-full object-contain bg-muted/20" />
                )}
                <span className="text-white mt-4 font-semibold">{file.name}</span>
              </div>
            ))}
          </div>

          <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black to-transparent flex justify-center pb-8">
            <button
              onClick={confirmPendingFiles}
              disabled={uploading}
              className="bg-primary text-white rounded-full py-3 px-8 font-semibold shadow-lg disabled:opacity-50"
            >
              {uploading ? "Sending..." : `Send ${pendingFiles.length} file${pendingFiles.length > 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      )}

      <div className="px-4 py-3 border-t border-muted-soft/30 bg-bg">
        {replyTo && (
          <div className="mb-2 flex items-center gap-2 bg-card rounded-lg pl-3 pr-2 py-1.5 border-l-2 border-primary">
            <div className="flex-1 min-w-0 text-xs">
              <p className="font-semibold text-primary truncate">Replying to {replyTo.from}</p>
              <p className="text-muted truncate">
                {replyTo.mediaId
                  ? replyTo.viewOnce
                    ? `Snap · ${replyTo.mimeType?.startsWith("video/") ? "video" : "photo"}`
                    : replyTo.mimeType?.startsWith("video/")
                    ? "Video"
                    : "Photo"
                  : replyTo.content || "…"}
              </p>
            </div>
            <button
              onClick={onCancelReply}
              className="text-muted hover:text-navy p-1"
              aria-label="Cancel reply"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>
        )}
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
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={handleFileInput}
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
            onClick={() => setCameraOpen(true)}
            className="text-muted hover:text-navy p-1 disabled:opacity-50"
            aria-label="Take photo"
            disabled={disabled || uploading || !onSendMedia}
          >
            <CameraIcon />
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
    </>
  );
}
