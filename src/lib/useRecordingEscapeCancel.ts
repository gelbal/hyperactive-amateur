// ABOUTME: useRecordingEscapeCancel — shared Escape-key cancellation host for active recording flows.
// ABOUTME: Routes user cancellation through the registered recording interrupt handlers.
import { useEffect } from "react";
import { interruptActiveRecording } from "./recordingInterrupt";

export function cancelActiveRecordingByUser(): void {
  interruptActiveRecording("user");
}

export function useRecordingEscapeCancel(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelActiveRecordingByUser();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}
