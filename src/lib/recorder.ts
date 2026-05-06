// ABOUTME: recordClip — record a fixed-duration WebM clip from a MediaStream and decode its audio.
// ABOUTME: Returns the blob plus a pre-decoded AudioBuffer for low-latency Tone.Player playback.
export interface RecordingResult {
  blob: Blob;
  audioBuffer: AudioBuffer;
  durationMs: number;
}

const PREFERRED_MIME = "video/webm; codecs=vp9,opus";
const FALLBACK_MIME = "video/webm";

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return PREFERRED_MIME;
  if (MediaRecorder.isTypeSupported(PREFERRED_MIME)) return PREFERRED_MIME;
  return FALLBACK_MIME;
}

export async function recordClip(
  stream: MediaStream,
  durationMs: number,
  audioContext: AudioContext,
): Promise<RecordingResult> {
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = (event) => {
      const err = (event as ErrorEvent).error ?? new Error("MediaRecorder error");
      reject(err instanceof Error ? err : new Error(String(err)));
    };
  });

  recorder.start();
  const stopTimer = setTimeout(() => {
    if (recorder.state !== "inactive") recorder.stop();
  }, durationMs);

  try {
    await stopped;
  } finally {
    clearTimeout(stopTimer);
  }

  const blob = new Blob(chunks, { type: mimeType });
  const arrayBuffer = await blob.arrayBuffer();
  // Pass a copy to decodeAudioData — some browsers detach the input buffer.
  const decodeBuffer = arrayBuffer.slice(0);

  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioContext.decodeAudioData(decodeBuffer);
  } catch (err) {
    throw new Error(
      `Failed to decode recorded audio: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { blob, audioBuffer, durationMs };
}
