// ABOUTME: useMoodKeys — Mood performance keyboard selection map.
// ABOUTME: Uses event.code and editable suppression like Chop's trigger hook.
import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import type { MoodMic, MoodSelectionEntry } from "../types";
import { armDrop, armSelection } from "./moodPerformance";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

function micIndexForCode(code: string): number | null {
  if (!code.startsWith("Digit")) return null;
  const n = Number(code.slice(5));
  if (n < 1 || n > 5) return null;
  return n - 1;
}

function nextStackEntry(mic: MoodMic, current: MoodSelectionEntry): MoodSelectionEntry {
  if (mic.takes.length === 0) return "off";
  if (current === "off") return mic.takes[0].id;
  const currentIndex = mic.takes.findIndex((take) => take.id === current);
  if (currentIndex === -1) return mic.takes[0].id;
  if (currentIndex === mic.takes.length - 1) return "off";
  return mic.takes[currentIndex + 1].id;
}

export function useMoodKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (isEditable(event.target)) return;

      const state = useAppStore.getState();
      if (state.appMode !== "mood") return;

      if (event.code === "KeyD") {
        event.preventDefault();
        armDrop();
        return;
      }

      const micIndex = micIndexForCode(event.code);
      if (micIndex === null) return;

      const piece = state.mood.piece;
      const mic = piece?.mics[micIndex];
      if (!piece || !mic) return;

      event.preventDefault();
      const current =
        state.mood.performance.armed[mic.id] ??
        state.mood.performance.selections[mic.id] ??
        "off";
      armSelection(mic.id, event.shiftKey ? "off" : nextStackEntry(mic, current));
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
