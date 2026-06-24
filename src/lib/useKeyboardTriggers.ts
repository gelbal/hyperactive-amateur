// ABOUTME: useKeyboardTriggers — listens for Digit1-8 / Numpad1-8 and fires the matching track.
// ABOUTME: Suppressed inside text inputs and on key repeat; uses Tone.now for audio-clock alignment.
import { useEffect } from "react";
import { triggerTrackNow } from "./audio";
import { canStartAudibleAction } from "./audibleActionGate";
import { useAppStore } from "../store/useAppStore";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

// Returns 0..7 if the code names a digit 1..8, otherwise null.
export function trackIdForCode(code: string): number | null {
  if (code.startsWith("Digit")) {
    const n = Number(code.slice(5));
    if (n >= 1 && n <= 8) return n - 1;
  }
  if (code.startsWith("Numpad")) {
    const n = Number(code.slice(6));
    if (n >= 1 && n <= 8) return n - 1;
  }
  return null;
}

export function useKeyboardTriggers(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (isEditable(event.target)) return;
      const trackId = trackIdForCode(event.code);
      if (trackId === null) return;
      if (!canStartAudibleAction(useAppStore.getState())) return;
      event.preventDefault();
      void triggerTrackNow(trackId);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
