// ABOUTME: performanceInterrupt — registration seam for lifecycle-owned stops of a running performance.
// ABOUTME: Lets page-hide and audio-interruption handling stop a Mood performance without importing moodTransport.
export interface PerformanceInterruptHandler {
  isActive: () => boolean;
  interrupt: () => void;
}

let performanceInterruptHandlers: PerformanceInterruptHandler[] = [];

export function registerPerformanceInterruptHandler(
  handler: PerformanceInterruptHandler,
): () => void {
  performanceInterruptHandlers = [...performanceInterruptHandlers, handler];
  return () => {
    performanceInterruptHandlers = performanceInterruptHandlers.filter(
      (candidate) => candidate !== handler,
    );
  };
}

export function __resetPerformanceInterruptHandlersForTesting(): void {
  performanceInterruptHandlers = [];
}

// Stops every registered performance that is running; true when one was.
export function interruptActivePerformance(): boolean {
  let interrupted = false;
  for (const handler of performanceInterruptHandlers) {
    if (!handler.isActive()) continue;
    handler.interrupt();
    interrupted = true;
  }
  return interrupted;
}
