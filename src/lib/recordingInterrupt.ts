// ABOUTME: recordingInterrupt — registration seam for lifecycle-owned recording cancellation.
// ABOUTME: Lets media/audio lifecycle code interrupt active flows without importing recordingFlow.
export interface RecordingInterruptHandler {
  isActive: () => boolean;
  interrupt: (reason: "interrupted") => void;
}

let recordingInterruptHandler: RecordingInterruptHandler | null = null;

export function registerRecordingInterruptHandler(
  handler: RecordingInterruptHandler | null,
): void {
  recordingInterruptHandler = handler;
}

export function interruptActiveRecording(reason: "interrupted"): boolean {
  const interruptHandler = recordingInterruptHandler;
  if (!interruptHandler?.isActive()) return false;
  interruptHandler.interrupt(reason);
  return true;
}
