// ABOUTME: useMoodKeys — Mood performance keyboard selection map.
// ABOUTME: Uses event.code and editable suppression like Chop's trigger hook.
import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import type { MoodMic, MoodSelectionEntry } from "../types";
import {
  pressMoodBrake,
  pressMoodGate,
  pressMoodHarmonize,
  releaseMoodBrake,
  releaseMoodGate,
  releaseMoodHarmonize,
  triggerMoodEcho,
} from "./moodFx";
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
    const heldFxKeys = new Set<"KeyB" | "KeyG" | "KeyH">();
    const releaseHeldFx = (code: "KeyB" | "KeyG" | "KeyH") => {
      if (!heldFxKeys.delete(code)) return;
      if (code === "KeyG") releaseMoodGate();
      else if (code === "KeyB") releaseMoodBrake();
      else releaseMoodHarmonize();
    };
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

      if (event.code === "KeyG") {
        event.preventDefault();
        if (pressMoodGate()) heldFxKeys.add("KeyG");
        return;
      }

      if (event.code === "KeyE") {
        event.preventDefault();
        triggerMoodEcho();
        return;
      }

      if (event.code === "KeyB") {
        event.preventDefault();
        if (pressMoodBrake()) heldFxKeys.add("KeyB");
        return;
      }

      if (event.code === "KeyH") {
        event.preventDefault();
        if (pressMoodHarmonize()) heldFxKeys.add("KeyH");
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

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "KeyG" && event.code !== "KeyB" && event.code !== "KeyH") return;
      if (!heldFxKeys.has(event.code)) return;
      event.preventDefault();
      releaseHeldFx(event.code);
    };

    const releaseAllHeldFx = () => {
      releaseHeldFx("KeyG");
      releaseHeldFx("KeyB");
      releaseHeldFx("KeyH");
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseAllHeldFx);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAllHeldFx);
      releaseAllHeldFx();
    };
  }, []);
}
