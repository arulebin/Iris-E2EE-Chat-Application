import { useEffect, useRef } from "react";

type Props = {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
};

export function VideoGrid({ localStream, remoteStream }: Props) {
  const localRef = useRef<HTMLVideoElement | null>(null);
  const remoteRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  if (!localStream && !remoteStream) return null;

  return (
    <div className="max-w-2xl mx-auto mb-4 grid grid-cols-2 gap-2">
      {remoteStream && (
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          className="w-full rounded-lg bg-black aspect-video"
        />
      )}
      {localStream && (
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          className="w-full rounded-lg bg-black aspect-video"
        />
      )}
    </div>
  );
}
