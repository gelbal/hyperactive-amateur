// ABOUTME: RecordingStation — in-viewport sequential walkthrough for filling track clips one by one.
// ABOUTME: Holds a live preview stream while mounted and reuses it for each capture; exposes a Sources picker for camera/mic.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, SkipForward, Check, Settings2, SwitchCamera } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { recordIntoTrack } from "../lib/recordingFlow";
import {
  acquirePreviewStream,
  enumerateMediaDevices,
  releasePreviewStream,
  type InputDeviceList,
} from "../lib/media";
import { isStandalone, triggerInstall, useCanInstall } from "../lib/install";
import { canStartAudibleAction } from "../lib/audibleActionGate";

const TRACK_COUNT = 8;
const EMPTY_DEVICES: InputDeviceList = { videoInputs: [], audioInputs: [] };

export function RecordingStation() {
  const recordingState = useAppStore((s) => s.recording.state);
  const canStartRecording = useAppStore(canStartAudibleAction);
  const tracks = useAppStore((s) => s.project.tracks);
  const videoDeviceId = useAppStore((s) => s.media.videoDeviceId);
  const audioDeviceId = useAppStore((s) => s.media.audioDeviceId);
  const videoFacingMode = useAppStore((s) => s.media.videoFacingMode);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [devices, setDevices] = useState<InputDeviceList>(EMPTY_DEVICES);

  const target = useMemo(() => {
    for (let i = 0; i < TRACK_COUNT; i++) {
      if (!tracks[i].clip && !skipped.has(i)) return i;
    }
    return null;
  }, [tracks, skipped]);
  const hasTarget = target !== null;

  const refreshDevices = useCallback(async () => {
    const list = await enumerateMediaDevices();
    setDevices(list);
  }, []);

  // Hold a preview stream while the station is mounted. The same stream is
  // reused across recording cycles — the user sees themselves continuously,
  // and we don't churn getUserMedia between countdowns. Re-acquires when the
  // user picks a different device.
  useEffect(() => {
    if (!hasTarget) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await acquirePreviewStream();
        if (cancelled) {
          releasePreviewStream(stream);
          return;
        }
        previewStreamRef.current = stream;
        setPreviewStream(stream);
        setError(null);
        // Labels are only populated after permission is granted; refresh now.
        void refreshDevices();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (stream) {
        releasePreviewStream(stream);
      }
      previewStreamRef.current = null;
      setPreviewStream(null);
    };
  }, [hasTarget, videoDeviceId, audioDeviceId, videoFacingMode, refreshDevices]);

  useEffect(() => {
    if (videoRef.current && previewStream) {
      videoRef.current.srcObject = previewStream;
    }
  }, [previewStream]);

  // Re-enumerate when devices are plugged/unplugged so the Sources panel stays
  // honest. The browser fires this even when the panel isn't open.
  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.addEventListener !== "function") return;
    const onChange = () => void refreshDevices();
    mediaDevices.addEventListener("devicechange", onChange);
    return () => mediaDevices.removeEventListener("devicechange", onChange);
  }, [refreshDevices]);

  if (target === null) {
    return (
      <div
        className="absolute inset-0 rounded overflow-hidden bg-zinc-950/95 flex flex-col items-center justify-center gap-4 text-center px-8"
        aria-label="recording station"
        role="region"
      >
        <p className="max-w-[18rem] text-sm text-zinc-300">
          All empty tracks were skipped.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSkipped(new Set())}
            className="flex items-center gap-2 px-3 py-2 rounded-full bg-orange-500 text-zinc-950 font-medium hover:bg-orange-400"
          >
            Record first sound
          </button>
          <button
            type="button"
            onClick={() => useAppStore.getState().actions.dismissRecordingStation()}
            className="flex items-center gap-2 px-3 py-2 rounded-full bg-zinc-900/80 text-zinc-200 border border-zinc-700 hover:bg-zinc-800"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  const isBusy = recordingState !== "idle";
  const recordDisabled = isBusy || !canStartRecording;

  const onRecord = () => {
    setError(null);
    const stream = previewStreamRef.current;
    void recordIntoTrack(target, {
      stream: stream ?? undefined,
      onError: setError,
    });
  };

  const onSkip = () => {
    setSkipped((s) => new Set(s).add(target));
  };

  const onDone = () => {
    useAppStore.getState().actions.dismissRecordingStation();
  };

  const onSelectVideo = (id: string) => {
    useAppStore.getState().actions.setPreferredDevices({ video: id || null });
  };
  const onSelectAudio = (id: string) => {
    useAppStore.getState().actions.setPreferredDevices({ audio: id || null });
  };

  return (
    <div
      className="absolute inset-0 rounded overflow-hidden"
      aria-label="recording station"
      role="region"
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover bg-zinc-900"
        aria-hidden
      />
      {/* Vignette for legibility */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, rgba(9,9,11,0.55) 0%, rgba(9,9,11,0) 35%, rgba(9,9,11,0) 60%, rgba(9,9,11,0.75) 100%)",
        }}
      />
      <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-zinc-950/70 border border-zinc-800 text-xs uppercase tracking-wide text-zinc-300">
        Recording for Track {target + 1}
      </div>
      <div className="absolute top-3 left-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Choose camera and microphone"
            aria-expanded={showSources}
            onClick={() => setShowSources((v) => !v)}
            disabled={recordDisabled}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-950/70 border border-zinc-800 text-[11px] uppercase tracking-wide text-zinc-300 hover:bg-zinc-900/90 disabled:opacity-50"
          >
            <Settings2 size={12} />
            Sources
          </button>
          {/* Front/rear flip — only shows on touch devices; deviceId selection
            in the Sources panel always wins (see media.ts buildConstraints). */}
          <button
            type="button"
            aria-label="Switch camera"
            onClick={() => useAppStore.getState().actions.toggleVideoFacingMode()}
            disabled={isBusy}
            className="hidden any-pointer-coarse:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-950/70 border border-zinc-800 text-[11px] uppercase tracking-wide text-zinc-300 hover:bg-zinc-900/90 disabled:opacity-50"
          >
            <SwitchCamera size={12} />
            Flip
          </button>
        </div>
        {showSources && (
          <div
            role="dialog"
            aria-label="Input device selection"
            className="mt-2 w-[240px] rounded-md border border-zinc-700 bg-zinc-950/95 shadow-xl p-3 flex flex-col gap-2 text-[11px] text-zinc-200"
          >
            <label className="flex flex-col gap-1">
              <span className="uppercase tracking-wide text-zinc-400">Camera</span>
              <select
                aria-label="Camera"
                value={videoDeviceId ?? ""}
                onChange={(e) => onSelectVideo(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-zinc-100"
              >
                <option value="">Default</option>
                {devices.videoInputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="uppercase tracking-wide text-zinc-400">Microphone</span>
              <select
                aria-label="Microphone"
                value={audioDeviceId ?? ""}
                onChange={(e) => onSelectAudio(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-zinc-100"
              >
                <option value="">Default</option>
                {devices.audioInputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${d.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
            </label>
            <InstallAffordance />
          </div>
        )}
      </div>
      <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center gap-3 px-4">
        {error && (
          <span role="alert" className="text-xs text-red-400 max-w-[80%] text-center">
            {error}
          </span>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={recordDisabled}
            onClick={onRecord}
            aria-label={`Record clip for track ${target + 1}`}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-orange-500 text-zinc-950 font-medium hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Circle size={14} fill="currentColor" />
            Record
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onSkip}
            aria-label="Skip this track"
            className="flex items-center gap-2 px-3 py-2 rounded-full bg-zinc-900/80 text-zinc-200 border border-zinc-700 hover:bg-zinc-800 disabled:opacity-50"
          >
            <SkipForward size={14} />
            Skip
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onDone}
            aria-label="Done recording"
            className="flex items-center gap-2 px-3 py-2 rounded-full bg-zinc-900/80 text-zinc-200 border border-zinc-700 hover:bg-zinc-800 disabled:opacity-50"
          >
            <Check size={14} />
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// Chromium-on-Android (and desktop Chrome) fires beforeinstallprompt — show
// the install button when the prompt is available. The hook subscribes to
// install-state changes so the button appears even if the event fires AFTER
// the Sources panel is open (Chrome's install-eligibility heuristics can take
// several seconds). iOS Safari has no install prompt API at all, so we
// surface a one-line hint pointing at Share → Add to Home Screen. The UA
// sniff is for the hint surface only; it does not gate functionality.
function InstallAffordance() {
  const installable = useCanInstall();
  if (installable) {
    return (
      <button
        type="button"
        onClick={() => void triggerInstall()}
        className="mt-1 px-2 py-1.5 rounded bg-orange-500 text-zinc-950 text-[11px] font-medium uppercase tracking-wide hover:bg-orange-400"
      >
        Install app
      </button>
    );
  }
  const isIOS =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS && !isStandalone()) {
    return (
      <p className="mt-1 text-[10px] text-zinc-500 leading-snug">
        Tap Share → Add to Home Screen to install.
      </p>
    );
  }
  return null;
}
