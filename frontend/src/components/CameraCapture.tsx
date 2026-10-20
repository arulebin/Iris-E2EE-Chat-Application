import { useEffect, useRef, useState } from "react";
import { VideoIcon, XIcon } from "./icons";
import {
  CaptureCancelled,
  hasNativeCamera,
  nativeRecordVideo,
  nativeTakePhoto,
} from "../lib/nativeCamera";

// ImageCapture (Chrome/Android) isn't in TS's DOM lib yet — just what we use.
type ImageCaptureLike = { takePhoto(): Promise<Blob> };
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

// Recording bitrate. Browsers default to ~2.5 Mbps, which smears 1080p motion.
const VIDEO_BITS_PER_SECOND = 8_000_000;

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
  const native = hasNativeCamera();

  // (Re-)acquire stream when facing or mode changes. Audio only needed for video.
  useEffect(() => {
    if (preview || native) return; // paused while reviewing; native uses the system camera
    let cancelled = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());

    // Square "ideal" bounds let the browser pick the sensor's best mode in
    // either orientation — a landscape 1920×1080 ask on a portrait phone often
    // falls back to 720p. Photos want full resolution; video stays ≤1080p so
    // the encoder keeps up.
    const edge = mode === "photo" ? 4096 : 1920;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: facing, width: { ideal: edge }, height: { ideal: edge } },
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
  }, [facing, mode, preview, native]);

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

  function showPreview(file: File) {
    setPreview({
      url: URL.createObjectURL(file),
      file,
      isVideo: file.type.startsWith("video/"),
    });
  }

  // Android app: the system camera owns capture; we just show the result.
  async function captureNative(kind: Mode) {
    setError(null);
    try {
      showPreview(kind === "photo" ? await nativeTakePhoto() : await nativeRecordVideo());
    } catch (err) {
      if (err instanceof CaptureCancelled) return;
      setError(err instanceof Error ? err.message : "Camera unavailable");
    }
  }

  // Prefer ImageCapture.takePhoto(): it triggers the camera's real still
  // pipeline (full sensor resolution, focus + denoise) instead of copying one
  // compressed preview frame, which is what made shots look blurry.
  async function grabStill(video: HTMLVideoElement): Promise<CanvasImageSource> {
    const track = streamRef.current?.getVideoTracks()[0];
    const Ctor = (window as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
    if (track && Ctor) {
      try {
        return await createImageBitmap(await new Ctor(track).takePhoto());
      } catch {
        // Some devices/drivers reject takePhoto — fall back to the video frame.
      }
    }
    return video;
  }

  async function takePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const source = await grabStill(video);
    const width = source instanceof HTMLVideoElement ? source.videoWidth : (source as ImageBitmap).width;
    const height = source instanceof HTMLVideoElement ? source.videoHeight : (source as ImageBitmap).height;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Mirror the captured frame for the front camera so it matches the on-screen preview.
    if (facing === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(source, 0, 0, width, height);
    if (source instanceof ImageBitmap) source.close();

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        showPreview(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92
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
    const recorder = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || "video/webm";
      const blob = new Blob(chunksRef.current, { type });
      const ext = type.includes("mp4") ? "mp4" : "webm";
      showPreview(new File([blob], `video-${Date.now()}.${ext}`, { type }));
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
      <div className="fixed inset-0 bg-black z-50 flex flex-col safe-frame">
        <button
          onClick={onCancel}
          className="absolute safe-top-4 right-4 text-white/80 hover:text-white p-2 z-10"
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

        <div className="absolute safe-bottom-8 inset-x-0 flex items-center justify-around px-8">
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

  // ─── Native capture screen (Android app) ────────────────────────
  if (native) {
    return (
      <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center gap-4 px-8 safe-frame">
        <button
          onClick={onCancel}
          className="absolute safe-top-4 right-4 text-white/80 hover:text-white p-2 z-10"
          aria-label="Close camera"
        >
          <XIcon className="w-7 h-7" />
        </button>
        {error && <p className="text-white/80 text-center mb-2">{error}</p>}
        <button
          onClick={() => captureNative("photo")}
          className="w-full max-w-xs text-black text-base font-semibold px-7 py-3 rounded-full bg-white hover:bg-white/90 active:scale-95"
        >
          Take photo
        </button>
        <button
          onClick={() => captureNative("video")}
          className="w-full max-w-xs text-white text-base font-semibold px-7 py-3 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 flex items-center justify-center gap-2"
        >
          <VideoIcon className="w-4 h-4" />
          Record video
        </button>
        <button
          onClick={onCancel}
          className="text-white/80 hover:text-white text-sm font-semibold mt-2"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ─── Live capture screen ────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col safe-frame">
      <button
        onClick={onCancel}
        className="absolute safe-top-4 right-4 text-white/80 hover:text-white p-2 z-10"
        aria-label="Close camera"
      >
        <XIcon className="w-7 h-7" />
      </button>

      {recording && (
        <div className="absolute safe-top-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3 py-1 rounded-full bg-red-600/90 text-white text-xs font-bold">
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
        <div className="absolute safe-bottom-28 inset-x-0 flex items-center justify-center gap-2">
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

      <div className="absolute safe-bottom-8 inset-x-0 flex items-center justify-between px-12">
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
