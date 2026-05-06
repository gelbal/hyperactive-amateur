// ABOUTME: RecordCountdown — full-screen 3-2-1 overlay shown before recording begins.
// ABOUTME: Mounted by App; reads recording.state from the store.
import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";

const SECONDS = 3;

export function RecordCountdown() {
  const state = useAppStore((s) => s.recording.state);
  const [count, setCount] = useState(SECONDS);

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

  if (state !== "countdown") return null;

  return (
    <div
      role="status"
      aria-live="assertive"
      aria-label="recording countdown"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center pointer-events-none"
    >
      <div
        key={count}
        className="text-white text-[200px] font-extrabold tabular-nums"
        style={{ animation: "scale-down 1s ease-out forwards" }}
      >
        {Math.max(1, count)}
      </div>
      <style>{`@keyframes scale-down{from{transform:scale(1.4);opacity:0.4}to{transform:scale(1);opacity:1}}`}</style>
    </div>
  );
}
