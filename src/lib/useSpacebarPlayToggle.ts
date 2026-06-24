// ABOUTME: Wires spacebar to togglePlayback while skipping presses inside inputs/textareas.
// ABOUTME: Mounted once at the App level; cleans up its document listener on unmount.
import { useEffect } from "react";
import { togglePlayback } from "./audio";
import { canStartAudibleAction } from "./audibleActionGate";
import { useAppStore } from "../store/useAppStore";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useSpacebarPlayToggle(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      if (event.repeat) return;
      if (isEditable(event.target)) return;
      const state = useAppStore.getState();
      if (state.playback.isExporting) return;
      if (!state.playback.isPlaying && !canStartAudibleAction(state)) return;
      event.preventDefault();
      void togglePlayback();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
