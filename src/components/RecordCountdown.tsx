// ABOUTME: RecordCountdown — overlay shown while capture is preparing, counting down, and recording.
// ABOUTME: Derives visible countdown digits from the shared audio-clock deadline and lets Esc cancel the active flow.
import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { cancelCurrentRecording } from "../lib/recordingFlow";
import { getAudioContext } from "../lib/audio";

const SECONDS = 3;
const TICK_MS = 100;

function digitForDeadline(countdownEndsAt: number): number {
  const remaining = Math.ceil(countdownEndsAt - getAudioContext().currentTime);
  return Math.max(1, Math.min(SECONDS, remaining));
}

export function RecordCountdown() {
  const state = useAppStore((s) => s.recording.state);
  const countdownEndsAt = useAppStore((s) => s.recording.countdownEndsAt);
  const [count, setCount] = useState(SECONDS);
  const active = state === "preparing" || state === "countdown" || state === "recording";
  const canClickCancel = state === "preparing" || state === "countdown";

  useEffect(() => {
    if (state !== "countdown" || countdownEndsAt === null) {
      setCount(SECONDS);
      return;
    }
    const update = () => setCount(digitForDeadline(countdownEndsAt));
    update();
    const id = window.setInterval(() => {
      update();
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [state, countdownEndsAt]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelCurrentRecording();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  if (!active) return null;

  const onCancel = () => {
    cancelCurrentRecording();
  };

  return (
    <div
      role="status"
      aria-live="assertive"
      aria-label="recording countdown"
      className="absolute inset-0 z-40 bg-black/70 flex flex-col items-center justify-center gap-3 pointer-events-auto"
    >
      {state === "preparing" ? (
        <div className="text-white text-xl font-semibold tracking-tight">
          Getting the camera ready…
        </div>
      ) : state === "countdown" ? (
        <div
          key={count}
          className="text-white text-[160px] font-extrabold tabular-nums leading-none"
          style={{ animation: "scale-down 1s ease-out forwards" }}
        >
          {Math.max(1, count)}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-red-400 font-mono uppercase tracking-wider text-sm">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" aria-hidden />
          Recording
        </div>
      )}
      {canClickCancel && (
        <button
          type="button"
          aria-label="Cancel recording"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-full bg-zinc-100 text-zinc-950 text-xs font-medium uppercase tracking-wide hover:bg-white"
        >
          Cancel
        </button>
      )}
      <span className="text-[10px] uppercase tracking-wider text-zinc-300/80">
        Press Esc to cancel
      </span>
      <style>{`@keyframes scale-down{from{transform:scale(1.4);opacity:0.4}to{transform:scale(1);opacity:1}}`}</style>
    </div>
  );
}
