import { useEffect, useRef, useState } from "react";
import { VideoIcon, XIcon } from "./icons";

type Props = {
  onCapture: (file: File) => void;
  onCancel: () => void;
};

type Mode = "photo" | "video";
type Preview = { url: string; file: File; isVideo: boolean } | null;

// Full-screen camera capture. Supports photo + video, then a Send/Retake preview
// before handing the file off to the uploader.
export function CameraCapture({ onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("photo");
  const [recording, setRecording] = useState(false);
  const [recElapsed, setRecElapsed] = useState(0);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [preview, setPreview] = useState<Preview>(null);

  // (Re-)acquire stream when facing or mode changes. Audio only needed for video.
  useEffect(() => {
    if (preview) return; // pause stream while user is reviewing the capture
    let cancelled = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: mode === "video"
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err?.name === "NotAllowedError"
            ? "Camera permission denied."
            : err?.message ?? "Camera unavailable"
        );
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing, mode, preview]);

  // Tick the REC counter while a video is being captured.
  useEffect(() => {
    if (!recording) {
      setRecElapsed(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(
      () => setRecElapsed(Math.floor((Date.now() - start) / 1000)),
      250
    );
    return () => window.clearInterval(id);
  }, [recording]);

  function takePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Mirror the captured frame for the front camera so it matches the on-screen preview.
    if (facing === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
        setPreview({ url: URL.createObjectURL(blob), file, isVideo: false });
      },
      "image/jpeg",
      0.9
    );
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];

    // Pick the best mime type the browser supports — webm is widely available;
    // Safari needs mp4 fallback. If none of the explicit types match, let the
    // browser pick its default by omitting `mimeType`.
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ];
    const mime = candidates.find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || "video/webm";
      const blob = new Blob(chunksRef.current, { type });
      const ext = type.includes("mp4") ? "mp4" : "webm";
      const file = new File([blob], `video-${Date.now()}.${ext}`, { type });
      setPreview({ url: URL.createObjectURL(blob), file, isVideo: true });
      setRecording(false);
    };
    recorder.start();
    setRecording(true);
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  function discardPreview() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  function send() {
    if (!preview) return;
    onCapture(preview.file);
  }

  // ─── Preview screen ─────────────────────────────────────────────
  if (preview) {
    return (
      <div className="fixed inset-0 bg-black z-50 flex flex-col">
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-white/80 hover:text-white p-2 z-10"
          aria-label="Close camera"
        >
          <XIcon className="w-7 h-7" />
        </button>

        {preview.isVideo ? (
          <video
            src={preview.url}
            controls
            playsInline
            className="flex-1 object-contain w-full h-full bg-black"
          />
        ) : (
          <img
            src={preview.url}
            alt="preview"
            className="flex-1 object-contain w-full h-full bg-black"
          />
        )}

        <div className="absolute bottom-8 inset-x-0 flex items-center justify-around px-8">
          <button
            onClick={discardPreview}
            className="text-white text-base font-semibold px-5 py-2.5 rounded-full bg-white/15 hover:bg-white/25 active:scale-95"
          >
            Retake
          </button>
          <button
            onClick={send}
            className="text-white text-base font-semibold px-7 py-2.5 rounded-full bg-primary hover:bg-primary-hover active:scale-95"
          >
            Send
          </button>
        </div>
      </div>
    );
  }

  // ─── Live capture screen ────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <button
        onClick={onCancel}
        className="absolute top-4 right-4 text-white/80 hover:text-white p-2 z-10"
        aria-label="Close camera"
      >
        <XIcon className="w-7 h-7" />
      </button>

      {recording && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3 py-1 rounded-full bg-red-600/90 text-white text-xs font-bold">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          REC{" "}
          {Math.floor(recElapsed / 60).toString().padStart(2, "0")}:
          {(recElapsed % 60).toString().padStart(2, "0")}
        </div>
      )}

      {error ? (
        <div className="flex-1 flex items-center justify-center px-8">
          <p className="text-white/80 text-center">{error}</p>
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="flex-1 object-cover w-full h-full"
          style={{ transform: facing === "user" ? "scaleX(-1)" : "none" }}
        />
      )}

      {!recording && !error && (
        <div className="absolute bottom-28 inset-x-0 flex items-center justify-center gap-2">
          <button
            onClick={() => setMode("photo")}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full transition ${
              mode === "photo" ? "bg-white text-black" : "text-white/80 bg-white/10 hover:bg-white/20"
            }`}
          >
            PHOTO
          </button>
          <button
            onClick={() => setMode("video")}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full transition flex items-center gap-1 ${
              mode === "video" ? "bg-white text-black" : "text-white/80 bg-white/10 hover:bg-white/20"
            }`}
          >
            <VideoIcon className="w-3.5 h-3.5" />
            VIDEO
          </button>
        </div>
      )}

      <div className="absolute bottom-8 inset-x-0 flex items-center justify-between px-12">
        <button
          onClick={onCancel}
          className="text-white/80 hover:text-white text-sm font-semibold disabled:opacity-30"
          disabled={recording}
        >
          Cancel
        </button>

        {mode === "photo" ? (
          <button
            onClick={takePhoto}
            disabled={!!error}
            aria-label="Take photo"
            className="w-16 h-16 rounded-full bg-white border-4 border-white/40 hover:border-white/80 transition disabled:opacity-50 active:scale-95"
          />
        ) : (
          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={!!error}
            aria-label={recording ? "Stop recording" : "Start recording"}
            className={`w-16 h-16 rounded-full border-4 transition disabled:opacity-50 active:scale-95 flex items-center justify-center ${
              recording
                ? "bg-red-600 border-white"
                : "bg-red-500 border-white/40 hover:border-white/80"
            }`}
          >
            {recording && <span className="w-5 h-5 bg-white rounded-sm" />}
          </button>
        )}

        <button
          onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
          disabled={!!error || recording}
          className="text-white/80 hover:text-white text-sm font-semibold disabled:opacity-30"
        >
          Flip
        </button>
      </div>
    </div>
  );
}
