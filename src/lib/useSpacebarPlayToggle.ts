// ABOUTME: Wires spacebar to mode-aware playback while skipping presses inside editable targets.
// ABOUTME: Mounted once at the App level; cleans up its document listener on unmount.
import { useEffect } from "react";
import { togglePlayback } from "./audio";
import { canStartAudibleAction } from "./audibleActionGate";
import { runAudibleAction } from "./audibleActionRunner";
import { startMoodPerformance, stopMoodPerformance } from "./moodTransport";
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

      if (state.appMode === "mood") {
        if (state.mood.performance.isPerforming) {
          event.preventDefault();
          stopMoodPerformance();
          return;
        }
        if (state.mood.piece?.cycleSeconds == null || !canStartAudibleAction(state)) return;
        event.preventDefault();
        runAudibleAction(startMoodPerformance());
        return;
      }

      if (state.appMode !== "chop") return;
      if (!state.playback.isPlaying && !canStartAudibleAction(state)) return;
      event.preventDefault();
      runAudibleAction(togglePlayback());
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
