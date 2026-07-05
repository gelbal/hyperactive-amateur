// ABOUTME: exportFormats — feature-detect which MediaRecorder MIME types this browser supports.
// ABOUTME: The export pipeline is codec-agnostic; this util drives the user-facing format picker.
import { RECORDING_MIME_CANDIDATES } from "./mediaRecorderSupport";

export interface ExportFormat {
  mimeType: string;
  label: string;
  extension: string;
}

const FORMAT_METADATA = {
  "video/webm; codecs=vp9,opus": {
    label: "WebM (VP9)",
    extension: "webm",
  },
  "video/webm; codecs=vp8,opus": {
    label: "WebM (VP8)",
    extension: "webm",
  },
  "video/webm": { label: "WebM", extension: "webm" },
  "video/mp4; codecs=avc1.42E01E,mp4a.40.2": {
    label: "MP4 (H.264)",
    extension: "mp4",
  },
  "video/mp4; codecs=h264,aac": { label: "MP4 (H.264)", extension: "mp4" },
  "video/mp4": { label: "MP4", extension: "mp4" },
} satisfies Record<
  (typeof RECORDING_MIME_CANDIDATES)[number],
  Omit<ExportFormat, "mimeType">
>;

// Preference order comes from the shared recording/export MediaRecorder probe.
// First match per container wins. WebM is the safer Chromium default for
// MediaRecorder; Safari falls through to MP4.
const PREFERENCE_ORDER: ExportFormat[] = RECORDING_MIME_CANDIDATES.map((mimeType) => ({
  mimeType,
  ...FORMAT_METADATA[mimeType],
}));

// Return the supported formats for this browser. Caps the list at one entry
// per container (mp4, webm) — the first-supported MIME under each container
// wins. A user-facing picker shouldn't list "MP4 (H.264)" and bare "MP4" as
// distinct choices.
export function detectSupportedFormats(): ExportFormat[] {
  if (typeof MediaRecorder === "undefined") return [];
  const byExtension = new Map<string, ExportFormat>();
  for (const fmt of PREFERENCE_ORDER) {
    if (!MediaRecorder.isTypeSupported(fmt.mimeType)) continue;
    if (byExtension.has(fmt.extension)) continue;
    byExtension.set(fmt.extension, fmt);
  }
  return Array.from(byExtension.values());
}
