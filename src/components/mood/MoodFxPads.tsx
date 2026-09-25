// ABOUTME: Compact live Gate, Echo, and Brake controls for the Mood performance panel.
// ABOUTME: Maps pointer hold/tap gestures onto module-local audio-clocked FX state.
import { useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import {
  getMoodFxPadState,
  pressMoodBrake,
  pressMoodGate,
  pressMoodHarmonize,
  releaseMoodBrake,
  releaseMoodGate,
  releaseMoodHarmonize,
  subscribeMoodFxPadState,
  triggerMoodEcho,
} from "../../lib/moodFx";
import { useAppStore } from "../../store/useAppStore";
import type { MoodKeyEstimate } from "../../types";

type FxPadProps = {
  active: boolean;
  ariaLabel: string;
  disabled: boolean;
  label: string;
  onPress?: () => boolean;
  onRelease?: () => boolean;
  onTap?: () => boolean;
  subtitle: string;
  title: string;
};

function FxPad({
  active,
  ariaLabel,
  disabled,
  label,
  onPress,
  onRelease,
  onTap,
  subtitle,
  title,
}: FxPadProps) {
  const pointerHeldRef = useRef(false);
  const release = () => {
    if (!pointerHeldRef.current) return;
    pointerHeldRef.current = false;
    onRelease?.();
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!onPress || (typeof event.button === "number" && event.button !== 0)) return;
    event.preventDefault();
    pointerHeldRef.current = onPress();
    if (pointerHeldRef.current) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!onRelease || (typeof event.button === "number" && event.button !== 0)) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    release();
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onTap}
      onPointerCancel={release}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      className={
        "flex h-14 min-w-16 flex-col items-center justify-center rounded border-2 px-2 transition-colors pointer-coarse:min-h-11 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-50 " +
        (active
          ? "border-orange-500 bg-orange-500 text-zinc-950"
          : disabled
            ? "border-zinc-700 bg-zinc-900 text-zinc-600"
            : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-zinc-500")
      }
    >
      <span className="text-sm font-black leading-none tracking-tight">{label}</span>
      <span className="mt-1 whitespace-nowrap font-mono text-[9px] font-normal leading-none tracking-normal">
        {subtitle}
      </span>
    </button>
  );
}

function disabledTitle(label: string, isPerforming: boolean, recordingIdle: boolean): string {
  if (!recordingIdle) return `${label} is locked during capture`;
  if (!isPerforming) return `Start performance to use ${label}`;
  return label;
}

function harmonizeTitleFor(
  isPerforming: boolean,
  recordingIdle: boolean,
  keyEstimate: MoodKeyEstimate | undefined,
): string {
  if (!recordingIdle) return "Harmonize is locked during capture";
  if (!isPerforming) return "Start performance to use Harmonize";
  if (!keyEstimate) return "Harmonize needs a key estimate from the One";
  return `layers your loop at AI-picked thirds and fifths (${keyEstimate.key} ${keyEstimate.mode})`;
}

export function MoodFxPads() {
  const isPerforming = useAppStore((state) => state.mood.performance.isPerforming);
  const recordingIdle = useAppStore((state) => state.recording.state === "idle");
  const keyEstimate = useAppStore((state) => state.mood.piece?.keyEstimate);
  const findingKey = useAppStore((state) => {
    const oneTakeId = state.mood.piece?.oneTakeId;
    return Boolean(oneTakeId && state.mood.partCheckingTakeIds.includes(oneTakeId));
  });
  const padState = useSyncExternalStore(
    subscribeMoodFxPadState,
    getMoodFxPadState,
    getMoodFxPadState,
  );
  const disabled = !isPerforming || !recordingIdle;
  const harmonizeDisabled = disabled || !keyEstimate;
  const stoppedSubtitle = !isPerforming && recordingIdle ? "press Play" : null;

  return (
    <div className="flex shrink-0 gap-1">
      <FxPad
        active={padState.gateActive}
        ariaLabel="Gate the loop (hold)"
        disabled={disabled}
        label="GATE"
        onPress={pressMoodGate}
        onRelease={releaseMoodGate}
        subtitle={stoppedSubtitle ?? "hold · G"}
        title={disabledTitle("Gate", isPerforming, recordingIdle)}
      />
      <FxPad
        active={padState.echoActive}
        ariaLabel="Echo throw"
        disabled={disabled}
        label="ECHO"
        onTap={triggerMoodEcho}
        subtitle={stoppedSubtitle ?? "tap · E"}
        title={disabledTitle("Echo", isPerforming, recordingIdle)}
      />
      <FxPad
        active={padState.brakeActive}
        ariaLabel="Brake the loop (hold)"
        disabled={disabled}
        label="BRAKE"
        onPress={pressMoodBrake}
        onRelease={releaseMoodBrake}
        subtitle={stoppedSubtitle ?? "hold · B"}
        title={disabledTitle("Brake", isPerforming, recordingIdle)}
      />
      <FxPad
        active={padState.harmonizeActive}
        ariaLabel="Harmonize the loop (hold)"
        disabled={harmonizeDisabled}
        label="HARMONIZE"
        onPress={pressMoodHarmonize}
        onRelease={releaseMoodHarmonize}
        subtitle={
          stoppedSubtitle ??
          (keyEstimate ? "hold · H" : findingKey ? "finding key…" : "no key yet")
        }
        title={harmonizeTitleFor(isPerforming, recordingIdle, keyEstimate)}
      />
    </div>
  );
}
