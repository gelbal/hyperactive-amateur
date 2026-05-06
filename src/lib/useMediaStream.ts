// ABOUTME: useMediaStream — request camera + mic via getUserMedia and expose status.
// ABOUTME: Idempotent (multiple request() calls share one stream); cleans up tracks on unmount.
import { useCallback, useEffect, useRef, useState } from "react";

export type MediaStreamStatus = "idle" | "requesting" | "granted" | "denied";

export interface UseMediaStreamResult {
  stream: MediaStream | null;
  error: Error | null;
  status: MediaStreamStatus;
  request: () => Promise<void>;
}

const CONSTRAINTS: MediaStreamConstraints = {
  video: { width: 720, height: 720, facingMode: "user" },
  audio: { sampleRate: 48000, channelCount: 1 },
};

export function useMediaStream(): UseMediaStreamResult {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState<MediaStreamStatus>("idle");

  // Refs let request() see the latest values without re-creating the callback.
  const streamRef = useRef<MediaStream | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const request = useCallback(async (): Promise<void> => {
    if (streamRef.current) return;
    if (inFlightRef.current) return inFlightRef.current;

    setStatus("requesting");
    setError(null);

    const promise = (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
        streamRef.current = s;
        setStream(s);
        setStatus("granted");
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
        setStatus("denied");
      } finally {
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    return () => {
      const s = streamRef.current;
      if (s) {
        for (const track of s.getTracks()) track.stop();
      }
      streamRef.current = null;
    };
  }, []);

  return { stream, error, status, request };
}
