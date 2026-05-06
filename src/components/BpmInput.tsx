// ABOUTME: BPM number input that drives Tone.Transport tempo via the store.
// ABOUTME: Local string state for in-flight typing; commits on change/blur with revert on bad input.
import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";

const MIN = 60;
const MAX = 180;

export function BpmInput() {
  const bpm = useAppStore((s) => s.project.bpm);
  const [draft, setDraft] = useState(String(bpm));

  useEffect(() => {
    setDraft(String(bpm));
  }, [bpm]);

  return (
    <label className="flex items-center gap-2 text-sm text-zinc-300">
      <span>BPM</span>
      <input
        type="number"
        inputMode="numeric"
        min={MIN}
        max={MAX}
        value={draft}
        aria-label="BPM"
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          // Empty / non-numeric drafts don't touch the store; the user might
          // still be typing. They get reverted on blur if never made valid.
          if (raw.trim() === "") return;
          const parsed = Number(raw);
          if (!Number.isFinite(parsed)) return;
          useAppStore.getState().actions.setBpm(parsed);
        }}
        onBlur={(e) => {
          const raw = e.target.value;
          if (raw.trim() === "" || !Number.isFinite(Number(raw))) {
            setDraft(String(bpm));
          }
        }}
        className="w-16 text-center bg-zinc-900 rounded px-2 py-1 border border-zinc-700 focus:border-orange-500 focus:outline-none"
      />
    </label>
  );
}
