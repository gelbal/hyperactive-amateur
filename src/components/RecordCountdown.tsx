// ABOUTME: RecordCountdown — overlay shown during the 3-2-1 countdown and the 2-second record window.
// ABOUTME: Pressing Esc cancels the active flow via recordingFlow's module-level controller.
import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { cancelCurrentRecording } from "../lib/recordingFlow";

const SECONDS = 3;

export function RecordCountdown() {
  const state = useAppStore((s) => s.recording.state);
  const [count, setCount] = useState(SECONDS);
  const active = state === "countdown" || state === "recording";

  useEffect(() => {
    if (state !== "countdown") {
      setCount(SECONDS);
      return;
    }
    setCount(SECONDS);
    let n = SECONDS;
    const id = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        window.clearInterval(id);
      }
      setCount(n);
    }, 1000);
    return () => window.clearInterval(id);
  }, [state]);

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

  return (
    <div
      role="status"
      aria-live="assertive"
      aria-label="recording countdown"
      className="absolute inset-0 z-40 bg-black/70 flex flex-col items-center justify-center gap-3 pointer-events-auto"
    >
      {state === "countdown" ? (
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
      <span className="text-[10px] uppercase tracking-wider text-zinc-300/80">
        Press Esc to cancel
      </span>
      <style>{`@keyframes scale-down{from{transform:scale(1.4);opacity:0.4}to{transform:scale(1);opacity:1}}`}</style>
    </div>
  );
}
