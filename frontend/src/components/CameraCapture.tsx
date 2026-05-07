import { useEffect, useRef, useState } from "react";
import { XIcon } from "./icons";

type Props = {
  onCapture: (file: File) => void;
  onCancel: () => void;
};

// Full-screen camera capture overlay. Uses getUserMedia for the webcam stream,
// captures a single frame to a canvas, and hands it back as a JPEG File ready
// to feed to uploadMedia.
export function CameraCapture({ onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");

  // Acquire camera stream on mount + on facing-mode change.
  useEffect(() => {
    let cancelled = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing }, audio: false })
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
  }, [facing]);

  function handleCapture() {
    const video = videoRef.current;
    if (!video || capturing) return;
    if (!video.videoWidth || !video.videoHeight) return; // not ready yet
    setCapturing(true);

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCapturing(false);
      return;
    }

    // Mirror the image only when shooting from the front-facing camera so the
    // captured photo matches the preview the user sees.
    if (facing === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCapturing(false);
          return;
        }
        const file = new File([blob], `photo-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        onCapture(file);
      },
      "image/jpeg",
      0.9
    );
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <button
        onClick={onCancel}
        className="absolute top-4 right-4 text-white/80 hover:text-white p-2 z-10"
        aria-label="Close camera"
      >
        <XIcon className="w-7 h-7" />
      </button>

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

      <div className="absolute bottom-8 inset-x-0 flex items-center justify-between px-12">
        <button
          onClick={onCancel}
          className="text-white/80 hover:text-white text-sm font-semibold"
        >
          Cancel
        </button>

        <button
          onClick={handleCapture}
          disabled={!!error || capturing}
          aria-label="Take photo"
          className="w-16 h-16 rounded-full bg-white border-4 border-white/40 hover:border-white/80 transition disabled:opacity-50 active:scale-95"
        />

        <button
          onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
          disabled={!!error}
          className="text-white/80 hover:text-white text-sm font-semibold"
        >
          Flip
        </button>
      </div>
    </div>
  );
}
