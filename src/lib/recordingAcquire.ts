// ABOUTME: Shared abort-aware media acquisition seam for Chop and Mood recording flows.
// ABOUTME: Releases late-arriving streams when a flow is canceled during getUserMedia.
import {
  acquireRecordingStream,
  releaseRecordingStream,
  type CaptureAspect,
} from "./media";

function makeAbortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

export function acquireRecordingStreamUntilAbort(
  signal: AbortSignal,
  aspect?: CaptureAspect,
): Promise<MediaStream> {
  const acquisition = acquireRecordingStream(aspect);
  return new Promise<MediaStream>((resolve, reject) => {
    let settled = false;
    const stopWatchingAbort = () => signal.removeEventListener("abort", onAbort);
    const releaseLateStream = (stream: MediaStream) => {
      releaseRecordingStream(stream);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      stopWatchingAbort();
      acquisition.then(releaseLateStream, () => undefined);
      reject(makeAbortError("Aborted during media acquisition"));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
    acquisition.then(
      (stream) => {
        if (settled) {
          releaseLateStream(stream);
          return;
        }
        settled = true;
        stopWatchingAbort();
        resolve(stream);
      },
      (err) => {
        if (settled) return;
        settled = true;
        stopWatchingAbort();
        reject(err);
      },
    );
  });
}
