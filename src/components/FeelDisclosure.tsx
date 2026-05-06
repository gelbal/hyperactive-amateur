// ABOUTME: FeelDisclosure — single button that opens a popover holding the advanced timing controls.
// ABOUTME: The button label is the live state (cut rate · swing · hold) so the value stays visible while the panel is closed.
import { useEffect, useRef, useState } from "react";
import { Sliders } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { SwingSlider } from "./SwingSlider";
import { CutSubdivisionSelect } from "./CutSubdivisionSelect";
import { HoldTimeControl } from "./HoldTimeControl";
import type { CutSubdivision } from "../types";

const CUT_LABEL: Record<CutSubdivision, string> = {
  "16n": "1/16",
  "8n": "1/8",
  "4n": "1/4",
  "2n": "1/2",
  "1m": "1 bar",
};

export function FeelDisclosure() {
  const cut = useAppStore((s) => s.project.cutSubdivision);
  const swing = useAppStore((s) => s.project.swing);
  const hold = useAppStore((s) => s.project.sameTierHoldMs);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const summary = `${CUT_LABEL[cut]} · ${Math.round(swing * 100)}% · ${hold}ms`;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Feel — cut rate, swing, hold"
        onClick={() => setOpen((v) => !v)}
        className={
          "flex items-center gap-2 px-3 py-2 text-sm rounded border transition-colors " +
          (open
            ? "bg-zinc-800 border-zinc-600"
            : "bg-zinc-900 border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600")
        }
      >
        <Sliders size={14} className="text-zinc-400" />
        <span className="text-zinc-300">Feel</span>
        <span className="font-mono tabular-nums text-xs text-zinc-500">{summary}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Feel controls"
          className="absolute left-0 top-full mt-2 z-30 min-w-[18rem] rounded-md border border-zinc-700 bg-zinc-900 shadow-xl p-4 flex flex-col gap-3"
        >
          <CutSubdivisionSelect />
          <SwingSlider />
          <HoldTimeControl />
        </div>
      )}
    </div>
  );
}
