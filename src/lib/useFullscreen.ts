// ABOUTME: useFullscreen — small hook that tracks browser fullscreen state and exposes enter/exit.
// ABOUTME: Used by the Viewport for presentation mode. Tied to the Fullscreen API; ESC exits naturally.
import { useCallback, useEffect, useState } from "react";

export interface UseFullscreenResult {
  isFullscreen: boolean;
  isSupported: boolean;
  enter: (element: Element) => Promise<void>;
  exit: () => Promise<void>;
}

export function useFullscreen(): UseFullscreenResult {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(
    () => typeof document !== "undefined" && Boolean(document.fullscreenElement),
  );
  // iOS Safari doesn't implement requestFullscreen on arbitrary elements
  // (only on <video>). Feature-detect so the toggle can hide itself.
  const isSupported =
    typeof document !== "undefined" &&
    typeof document.documentElement.requestFullscreen === "function";

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const enter = useCallback(async (element: Element) => {
    if (typeof element.requestFullscreen !== "function") return;
    try {
      await element.requestFullscreen();
    } catch {
      // User dismissed the prompt or the API failed; nothing to recover here.
    }
  }, []);

  const exit = useCallback(async () => {
    if (typeof document.exitFullscreen !== "function") return;
    if (!document.fullscreenElement) return;
    try {
      await document.exitFullscreen();
    } catch {
      // Same — best-effort.
    }
  }, []);

  return { isFullscreen, isSupported, enter, exit };
}
