// ABOUTME: BpmDial — circular knob for tempo, snaps to discrete stops in the hip-hop range.
// ABOUTME: Scroll wheel or vertical drag changes the value; arrow keys adjust by one stop.
import { useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";

const STOPS = [70, 80, 90, 100, 110, 120, 130, 140, 150, 160] as const;
const ARC_START_DEG = -135;
const ARC_END_DEG = 135;
const ARC_RANGE_DEG = ARC_END_DEG - ARC_START_DEG;

const SIZE = 56;
const CENTER = SIZE / 2;
const RADIUS = 24;
const NOTCH_INNER = 6;
const NOTCH_OUTER = 22;
const DRAG_PIXELS_PER_STOP = 16;

function indexOfNearest(value: number): number {
  let bestIdx = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < STOPS.length; i++) {
    const d = Math.abs(STOPS[i] - value);
    if (d < bestDelta) {
      bestDelta = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function angleFor(value: number): number {
  const idx = indexOfNearest(value);
  return ARC_START_DEG + (idx / (STOPS.length - 1)) * ARC_RANGE_DEG;
}

function stepBy(value: number, delta: number): number {
  const idx = indexOfNearest(value);
  const next = Math.max(0, Math.min(STOPS.length - 1, idx + delta));
  return STOPS[next];
}

export function BpmDial() {
  const bpm = useAppStore((s) => s.project.bpm);
  // Export freezes project mutations; the dial must look disabled and ignore
  // input, not just rely on the store writer's no-op.
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const dragRef = useRef<{ startY: number; startBpm: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const setBpm = (next: number) => useAppStore.getState().actions.setBpm(next);

  const angleDeg = angleFor(bpm);
  const angleRad = (angleDeg * Math.PI) / 180;
  const notchX1 = CENTER + NOTCH_INNER * Math.sin(angleRad);
  const notchY1 = CENTER - NOTCH_INNER * Math.cos(angleRad);
  const notchX2 = CENTER + NOTCH_OUTER * Math.sin(angleRad);
  const notchY2 = CENTER - NOTCH_OUTER * Math.cos(angleRad);

  // Subtle tick marks at each stop for visual structure.
  const ticks = STOPS.map((_, i) => {
    const a = ARC_START_DEG + (i / (STOPS.length - 1)) * ARC_RANGE_DEG;
    const r = (a * Math.PI) / 180;
    return {
      x1: CENTER + (RADIUS - 1) * Math.sin(r),
      y1: CENTER - (RADIUS - 1) * Math.cos(r),
      x2: CENTER + (RADIUS + 2) * Math.sin(r),
      y2: CENTER - (RADIUS + 2) * Math.cos(r),
    };
  });

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label={`BPM ${bpm}`}
        aria-valuemin={STOPS[0]}
        aria-valuemax={STOPS[STOPS.length - 1]}
        aria-valuenow={bpm}
        role="slider"
        disabled={isExporting}
        onWheel={(event) => {
          if (isExporting) return;
          event.preventDefault();
          setBpm(stepBy(bpm, event.deltaY > 0 ? -1 : 1));
        }}
        onPointerDown={(event) => {
          if (isExporting) return;
          event.preventDefault();
          (event.currentTarget as HTMLButtonElement).setPointerCapture(
            event.pointerId,
          );
          dragRef.current = { startY: event.clientY, startBpm: bpm };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (isExporting || !dragRef.current) return;
          const dy = dragRef.current.startY - event.clientY;
          const stepDelta = Math.round(dy / DRAG_PIXELS_PER_STOP);
          setBpm(stepBy(dragRef.current.startBpm, stepDelta));
        }}
        onPointerUp={(event) => {
          (event.currentTarget as HTMLButtonElement).releasePointerCapture(
            event.pointerId,
          );
          dragRef.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onKeyDown={(event) => {
          if (isExporting) return;
          if (event.key === "ArrowUp" || event.key === "ArrowRight") {
            event.preventDefault();
            setBpm(stepBy(bpm, 1));
          } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
            event.preventDefault();
            setBpm(stepBy(bpm, -1));
          }
        }}
        title="Drag, scroll, or use arrow keys to change BPM"
        className={
          "relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 transition-colors " +
          "disabled:opacity-30 disabled:cursor-not-allowed " +
          (dragging ? "cursor-grabbing" : "cursor-ns-resize")
        }
        style={{ width: SIZE, height: SIZE, touchAction: "none" }}
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="#18181b"
            stroke="#3f3f46"
            strokeWidth={2}
          />
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke="#52525b"
              strokeWidth={1}
            />
          ))}
          <line
            x1={notchX1}
            y1={notchY1}
            x2={notchX2}
            y2={notchY2}
            stroke="#fb923c"
            strokeWidth={3}
            strokeLinecap="round"
          />
        </svg>
      </button>
      <div className="flex flex-col leading-none">
        <span className="font-mono tabular-nums text-base text-zinc-200">{bpm}</span>
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">BPM</span>
      </div>
    </div>
  );
}
