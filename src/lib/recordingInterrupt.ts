// ABOUTME: recordingInterrupt — registration seam for lifecycle-owned recording cancellation.
// ABOUTME: Lets media/audio lifecycle code interrupt active flows without importing recordingFlow.
export interface RecordingInterruptHandler {
  isActive: () => boolean;
  interrupt: (reason: "user" | "interrupted") => void;
}

let recordingInterruptHandlers: RecordingInterruptHandler[] = [];

export function registerRecordingInterruptHandler(
  handler: RecordingInterruptHandler,
): () => void {
  recordingInterruptHandlers = [...recordingInterruptHandlers, handler];
  return () => {
    recordingInterruptHandlers = recordingInterruptHandlers.filter(
      (candidate) => candidate !== handler,
    );
  };
}

export function __resetRecordingInterruptHandlersForTesting(): void {
  recordingInterruptHandlers = [];
}

export function interruptActiveRecording(reason: "user" | "interrupted"): boolean {
  for (const interruptHandler of recordingInterruptHandlers) {
    if (!interruptHandler.isActive()) continue;
    interruptHandler.interrupt(reason);
    return true;
  }
  return false;
}
