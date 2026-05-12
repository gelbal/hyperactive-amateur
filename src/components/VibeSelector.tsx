// ABOUTME: VibeSelector — segmented control for the persistent style hint sent to AI Suggest.
// ABOUTME: Tight (default), Varied (more space, fewer tracks), Breaky (sparse final quarter).
import { useAppStore } from "../store/useAppStore";
import { VIBES } from "../lib/aiSuggest";
import type { Vibe } from "../types";

const LABELS: Record<Vibe, string> = {
  tight: "Tight",
  varied: "Varied",
  breaky: "Breaky",
};

const HINT: Record<Vibe, string> = {
  tight: "Dense, repetitive — classic.",
  varied: "More space, fewer tracks per loop.",
  breaky: "Drops the last quarter for a rest.",
};

export function VibeSelector() {
  const value = useAppStore((s) => s.project.vibe);
  const setVibe = useAppStore.getState().actions.setVibe;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-zinc-300">Vibe</span>
      <div role="radiogroup" aria-label="Vibe" className="flex items-stretch rounded border border-zinc-700 overflow-hidden">
        {VIBES.map((v) => {
          const active = v === value;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={LABELS[v]}
              onClick={() => setVibe(v)}
              className={
                "flex-1 px-2 py-1 text-xs transition-colors " +
                (active
                  ? "bg-orange-500 text-zinc-950 font-medium"
                  : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800")
              }
            >
              {LABELS[v]}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-zinc-500">{HINT[value]}</p>
    </div>
  );
}
