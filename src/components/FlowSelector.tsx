// ABOUTME: FlowSelector — top-bar dropdown for the structural hint sent to AI Suggest.
// ABOUTME: Tight (default), Varied (more space, fewer tracks), Breaky (sparse final quarter).
// UI label is "Flow" (the song's structural arc); the underlying data model still
// calls the field `vibe` — translation lives here.
import { useAppStore } from "../store/useAppStore";
import { VIBES } from "../lib/aiSuggest";
import type { Vibe } from "../types";

const LABELS: Record<Vibe, string> = {
  tight: "Tight",
  varied: "Varied",
  breaky: "Breaky",
};

export function FlowSelector() {
  const value = useAppStore((s) => s.project.vibe);
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-300">
      <span>Flow</span>
      <select
        value={value}
        onChange={(e) =>
          useAppStore.getState().actions.setVibe(e.target.value as Vibe)
        }
        className="bg-zinc-900 rounded border border-zinc-700 text-zinc-200 px-2 py-1 pointer-coarse:min-h-11 focus:outline-none focus:border-orange-500 transition-colors"
      >
        {VIBES.map((v) => (
          <option key={v} value={v}>
            {LABELS[v]}
          </option>
        ))}
      </select>
    </label>
  );
}
