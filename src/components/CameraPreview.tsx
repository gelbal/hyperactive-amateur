// ABOUTME: CameraPreview — small live webcam tile in the top bar.
// ABOUTME: Owns the single MediaStream request and mirrors it to the store for other components.
import { useEffect, useRef } from "react";
import { useMediaStream } from "../lib/useMediaStream";
import { useAppStore } from "../store/useAppStore";

export function CameraPreview() {
  const { stream, status, error, request } = useMediaStream();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    useAppStore.getState().actions.setMedia({
      stream,
      status,
      error: error?.message ?? null,
    });
  }, [stream, status, error]);

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
        Camera blocked: {error?.message ?? "permission denied"}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        void request();
      }}
      className="ml-auto px-3 py-2 text-sm rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
    >
      {status === "requesting" ? "Requesting…" : "Enable camera"}
    </button>
  );
}
