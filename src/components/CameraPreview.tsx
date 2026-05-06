// ABOUTME: CameraPreview — small live webcam tile in the top bar.
// ABOUTME: Reads the shared media slice; clicking "Enable camera" forwards to lib/media.
import { useEffect, useRef } from "react";
import { useAppStore } from "../store/useAppStore";
import { requestMedia } from "../lib/media";

export function CameraPreview() {
  const stream = useAppStore((s) => s.media.stream);
  const status = useAppStore((s) => s.media.status);
  const error = useAppStore((s) => s.media.error);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  if (status === "granted") {
    return (
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-label="camera preview"
        className="w-32 h-32 rounded object-cover bg-zinc-900 ml-auto"
      />
    );
  }

  if (status === "denied") {
    return (
      <div className="ml-auto text-xs text-red-400 max-w-[12rem]">
        Camera blocked: {error ?? "permission denied"}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        void requestMedia();
      }}
      className="ml-auto px-3 py-2 text-sm rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
    >
      {status === "requesting" ? "Requesting…" : "Enable camera"}
    </button>
  );
}
