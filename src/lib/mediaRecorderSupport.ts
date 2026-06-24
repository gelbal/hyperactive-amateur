// ABOUTME: Shared MediaRecorder MIME capability detection for capture/export-adjacent UI.
// ABOUTME: Keeps Safari/Chromium differences out of individual components.

export const RECORDING_MIME_CANDIDATES = [
  "video/webm; codecs=vp9,opus",
  "video/webm; codecs=vp8,opus",
  "video/webm",
  "video/mp4; codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4; codecs=h264,aac",
  "video/mp4",
] as const;

export function getSupportedRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  for (const mimeType of RECORDING_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
  }
  return "";
}

export function hasSupportedRecordingMimeType(): boolean {
  return getSupportedRecordingMimeType() !== "";
}
