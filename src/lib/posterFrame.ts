// ABOUTME: captureFirstFrame — extract a JPEG poster Blob from a video Blob via an off-DOM <video> + canvas.
// ABOUTME: Returns null (never throws) on decode failure or timeout so callers can save the clip regardless.

const DEFAULT_SEEK_TIME_SEC = 0.1;
const DEFAULT_TIMEOUT_MS = 1500;
const JPEG_QUALITY = 0.7;

// Capture a single frame near the start of the video and return it as a JPEG
// Blob. On any decode error, missing track, seek failure, or timeout, resolve
// with null — the caller must treat null as "no poster available" and fall
// back to a placeholder UI.
//
// Why this exists: iPad WebKit (which every iPadOS browser uses) does not
// reliably paint a first-frame poster on a blob-backed <video> with
// preload="metadata" that has never played. Storing a real image side-steps
// the issue and removes the per-thumbnail decoder pipeline.
export async function captureFirstFrame(
  blob: Blob,
  seekTimeSec: number = DEFAULT_SEEK_TIME_SEC,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  if (!blob || blob.size === 0) return null;

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  // Some WebKit builds refuse to load cross-origin videos for canvas draws;
  // blob URLs are same-origin but flagging anonymous keeps the intent explicit.
  video.crossOrigin = "anonymous";

  const objectUrl = URL.createObjectURL(blob);
  video.src = objectUrl;

  return new Promise<Blob | null>((resolve) => {
    let settled = false;
    const finish = (result: Blob | null) => {
      if (settled) return;
      settled = true;
      try {
        video.removeAttribute("src");
        video.load();
      } catch {
        // Ignore — element is already being torn down.
      }
      URL.revokeObjectURL(objectUrl);
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    const drawCurrentFrame = (): Blob | null | Promise<Blob | null> => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return null;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      try {
        ctx.drawImage(video, 0, 0, width, height);
      } catch {
        return null;
      }
      return new Promise<Blob | null>((res) => {
        try {
          canvas.toBlob((b) => res(b), "image/jpeg", JPEG_QUALITY);
        } catch {
          res(null);
        }
      });
    };

    const onSeeked = async () => {
      const result = await drawCurrentFrame();
      clearTimeout(timer);
      finish(result);
    };

    const onLoadedData = () => {
      // Seek a hair past 0 to coerce WebKit into decoding a real frame.
      // If the seek fails to fire (some blobs / containers), the timeout
      // catches us and we still resolve null.
      try {
        video.currentTime = Math.max(0, seekTimeSec);
      } catch {
        // Seeking can throw if the video hasn't loaded enough; fall back to
        // drawing whatever's there now.
        void (async () => {
          const result = await drawCurrentFrame();
          clearTimeout(timer);
          finish(result);
        })();
      }
    };

    const onError = () => {
      clearTimeout(timer);
      finish(null);
    };

    video.addEventListener("loadeddata", onLoadedData);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
  });
}
