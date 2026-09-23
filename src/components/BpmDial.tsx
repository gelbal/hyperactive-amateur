// ABOUTME: BpmDial — circular knob for tempo, snaps to discrete stops in the hip-hop range.
// ABOUTME: Turning the knob by angle or the scroll wheel changes the value; arrow keys adjust by one stop.
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
const DEG_PER_STOP = ARC_RANGE_DEG / (STOPS.length - 1);
// Pointer positions this close to the centre have no usable angle.
const DEAD_ZONE_PX = 6;

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

// Clock angle of a pointer around the knob: 0 at 12 o'clock, clockwise
// positive, in (-180, 180]. Null inside the dead zone around the centre.
function pointerAngle(knob: HTMLElement, clientX: number, clientY: number): number | null {
  const rect = knob.getBoundingClientRect();
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  if (Math.hypot(dx, dy) < DEAD_ZONE_PX) return null;
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

// Shortest signed rotation from one angle to another, in (-180, 180].
function unwrappedDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

interface Turn {
  startIdx: number;
  lastAngle: number | null;
  // Rotation since the turn began, clamped to what the starting stop can
  // reach, so reversing after the end responds at once.
  accumulatedDeg: number;
}

export function BpmDial() {
  const bpm = useAppStore((s) => s.project.bpm);
  // Export freezes project mutations; the dial must look disabled and ignore
  // input, not just rely on the store writer's no-op.
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const turnRef = useRef<Turn | null>(null);
  const [dragging, setDragging] = useState(false);

  // Every write bumps the project revision (re-arming autosave, staling an
  // in-flight Suggest), so only a changed stop is written.
  const setBpm = (next: number) => {
    if (next === useAppStore.getState().project.bpm) return;
    useAppStore.getState().actions.setBpm(next);
  };

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
          if (isExporting || event.deltaY === 0) return;
          event.preventDefault();
          setBpm(stepBy(bpm, event.deltaY > 0 ? -1 : 1));
        }}
        onPointerDown={(event) => {
          if (isExporting) return;
          event.preventDefault();
          const knob = event.currentTarget as HTMLButtonElement;
          knob.setPointerCapture(event.pointerId);
          turnRef.current = {
            startIdx: indexOfNearest(bpm),
            lastAngle: pointerAngle(knob, event.clientX, event.clientY),
            accumulatedDeg: 0,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const turn = turnRef.current;
          if (isExporting || !turn) return;
          const angle = pointerAngle(event.currentTarget as HTMLButtonElement, event.clientX, event.clientY);
          if (angle === null) return;
          if (turn.lastAngle === null) {
            turn.lastAngle = angle;
            return;
          }
          const delta = unwrappedDelta(turn.lastAngle, angle);
          turn.lastAngle = angle;
          const minDeg = -turn.startIdx * DEG_PER_STOP;
          const maxDeg = (STOPS.length - 1 - turn.startIdx) * DEG_PER_STOP;
          turn.accumulatedDeg = Math.max(minDeg, Math.min(maxDeg, turn.accumulatedDeg + delta));
          setBpm(STOPS[turn.startIdx + Math.round(turn.accumulatedDeg / DEG_PER_STOP)]);
        }}
        onPointerUp={(event) => {
          (event.currentTarget as HTMLButtonElement).releasePointerCapture(
            event.pointerId,
          );
          turnRef.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          turnRef.current = null;
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
        title="Turn, scroll, or use arrow keys to change BPM"
        className={
          "relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 transition-colors " +
          "disabled:opacity-30 disabled:cursor-not-allowed " +
          (dragging ? "cursor-grabbing" : "cursor-grab")
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
