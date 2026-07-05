// ABOUTME: captureFirstFrame — extract a JPEG poster Blob from a video Blob via an off-DOM <video> + canvas.
// ABOUTME: Returns null (never throws) on decode failure or timeout so callers can save the clip regardless.

const DEFAULT_SEEK_TIME_SEC = 0.1;
const DEFAULT_TIMEOUT_MS = 1500;
const JPEG_QUALITY = 0.7;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: HTMLVideoElement["requestVideoFrameCallback"];
  cancelVideoFrameCallback?: HTMLVideoElement["cancelVideoFrameCallback"];
};

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
    let captureStarted = false;
    let videoFrameCallbackHandle: number | null = null;

    const cleanupListeners = () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };

    const cleanupVideoFrameCallback = () => {
      if (videoFrameCallbackHandle === null) return;
      const handle = videoFrameCallbackHandle;
      videoFrameCallbackHandle = null;
      const cancelVideoFrameCallback = (video as VideoWithFrameCallback).cancelVideoFrameCallback;
      if (typeof cancelVideoFrameCallback !== "function") return;
      try {
        cancelVideoFrameCallback.call(video, handle);
      } catch {
        // Ignore — the element is already settling through another path.
      }
    };

    const finish = (result: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanupListeners();
      cleanupVideoFrameCallback();
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

    const drawAndFinish = async () => {
      const result = await drawCurrentFrame();
      finish(result);
    };

    const onSeeked = async () => {
      await drawAndFinish();
    };

    const seekToFrame = () => {
      if (settled || captureStarted) return;
      captureStarted = true;
      // Seek a hair past 0 to coerce WebKit into decoding a real frame.
      // If the seek fails to fire (some blobs / containers), the timeout
      // catches us and we still resolve null.
      try {
        video.currentTime = Math.max(0, seekTimeSec);
      } catch {
        // Seeking can throw if the video hasn't loaded enough; fall back to
        // drawing whatever's there now.
        void drawAndFinish();
      }
    };

    const onLoadedMetadata = () => seekToFrame();
    const onLoadedData = () => seekToFrame();

    const onError = () => {
      finish(null);
    };

    const requestVideoFrameCallback = (video as VideoWithFrameCallback).requestVideoFrameCallback;
    if (typeof requestVideoFrameCallback === "function") {
      try {
        videoFrameCallbackHandle = requestVideoFrameCallback.call(video, () => {
          videoFrameCallbackHandle = null;
          if (settled || captureStarted) return;
          captureStarted = true;
          void drawAndFinish();
        });
      } catch {
        // Ignore and let the metadata/data/timeout paths settle the poster.
      }
    }

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("loadeddata", onLoadedData);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
  });
}
