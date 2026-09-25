// ABOUTME: canvasDraw — shared cover-crop and DPR canvas backing-store helpers.
// ABOUTME: Chop and Mood use these helpers to keep render pixels consistent.
export const DISPLAY_DPR_CAP = 2;

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function currentDevicePixelRatio(): number {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
}

function getSourceSize(source: CanvasImageSource): { width: number; height: number } {
  const videoSource = source as { videoWidth?: number; videoHeight?: number };
  if (
    typeof videoSource.videoWidth === "number" &&
    videoSource.videoWidth > 0 &&
    typeof videoSource.videoHeight === "number" &&
    videoSource.videoHeight > 0
  ) {
    return { width: videoSource.videoWidth, height: videoSource.videoHeight };
  }

  const imageSource = source as { naturalWidth?: number; naturalHeight?: number };
  if (
    typeof imageSource.naturalWidth === "number" &&
    imageSource.naturalWidth > 0 &&
    typeof imageSource.naturalHeight === "number" &&
    imageSource.naturalHeight > 0
  ) {
    return { width: imageSource.naturalWidth, height: imageSource.naturalHeight };
  }

  const sizedSource = source as { width?: unknown; height?: unknown };
  const width = typeof sizedSource.width === "number" ? sizedSource.width : 0;
  const height = typeof sizedSource.height === "number" ? sizedSource.height : 0;
  return { width, height };
}

export function coverCropRect(
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
): CanvasRect {
  if (sourceW <= 0 || sourceH <= 0 || targetW <= 0 || targetH <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const sourceAspect = sourceW / sourceH;
  const targetAspect = targetW / targetH;

  if (sourceAspect > targetAspect) {
    const width = sourceH * targetAspect;
    return {
      x: (sourceW - width) / 2,
      y: 0,
      width,
      height: sourceH,
    };
  }

  if (sourceAspect < targetAspect) {
    const height = sourceW / targetAspect;
    return {
      x: 0,
      y: (sourceH - height) / 2,
      width: sourceW,
      height,
    };
  }

  return { x: 0, y: 0, width: sourceW, height: sourceH };
}

export function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  tileRect: CanvasRect,
): void {
  const { width: sourceW, height: sourceH } = getSourceSize(source);
  const crop = coverCropRect(sourceW, sourceH, tileRect.width, tileRect.height);
  ctx.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    tileRect.x,
    tileRect.y,
    tileRect.width,
    tileRect.height,
  );
}

export function getDisplayBackingSize(
  cssSize: number,
  devicePixelRatio = currentDevicePixelRatio(),
): number {
  const dpr = Math.min(devicePixelRatio || 1, DISPLAY_DPR_CAP);
  return Math.max(1, Math.round(cssSize * dpr));
}

export function sizeDisplayCanvas(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
  devicePixelRatio = currentDevicePixelRatio(),
): void {
  canvas.width = getDisplayBackingSize(cssW, devicePixelRatio);
  canvas.height = getDisplayBackingSize(cssH, devicePixelRatio);
}
