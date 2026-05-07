export const MIN_USER_ZOOM = 0.75;
export const DEFAULT_MAX_USER_ZOOM = 32;
const TARGET_CANVAS_PX_PER_IMAGE_PX_AT_MAX_ZOOM = 32;
const WHEEL_ZOOM_SENSITIVITY = 0.001;

export interface ClipPoint {
  x: number;
  y: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export const IDENTITY_PAN: ClipPoint = { x: 0, y: 0 };

export function computeFitToViewportScale(
  image: ViewportSize,
  display: ViewportSize,
): ClipPoint {
  if (!hasNonZeroArea(image) || !hasNonZeroArea(display)) {
    return { x: 1, y: 1 };
  }
  const imageAspect = image.width / image.height;
  const canvasAspect = display.width / display.height;
  if (imageAspect > canvasAspect) {
    return { x: 1, y: canvasAspect / imageAspect };
  }
  return { x: imageAspect / canvasAspect, y: 1 };
}

export function convertCanvasPointToClipSpace(
  xPx: number,
  yPx: number,
  display: ViewportSize,
): ClipPoint {
  if (!hasNonZeroArea(display)) return { x: 0, y: 0 };
  return {
    x: (xPx / display.width) * 2 - 1,
    y: 1 - (yPx / display.height) * 2,
  };
}

export function convertPixelDeltaToClipDelta(
  dxPx: number,
  dyPx: number,
  display: ViewportSize,
): ClipPoint {
  if (!hasNonZeroArea(display)) return { x: 0, y: 0 };
  return {
    x: (dxPx / display.width) * 2,
    y: -(dyPx / display.height) * 2,
  };
}

export function clampUserZoom(
  zoom: number,
  image: ViewportSize,
  display: ViewportSize,
): number {
  const max = computeMaxUserZoom(image, display);
  return Math.max(MIN_USER_ZOOM, Math.min(max, zoom));
}

export function computeMaxUserZoom(image: ViewportSize, display: ViewportSize): number {
  if (!hasNonZeroArea(image) || !hasNonZeroArea(display)) return DEFAULT_MAX_USER_ZOOM;
  const fitRatio = Math.min(display.width / image.width, display.height / image.height);
  const zoomToReachTargetSamplingDensity =
    TARGET_CANVAS_PX_PER_IMAGE_PX_AT_MAX_ZOOM / fitRatio;
  return Math.max(DEFAULT_MAX_USER_ZOOM, zoomToReachTargetSamplingDensity);
}

export function computeWheelZoomFactor(wheelDeltaY: number): number {
  return Math.exp(-wheelDeltaY * WHEEL_ZOOM_SENSITIVITY);
}

export function computePanForZoomAtCursor(
  cursorClip: ClipPoint,
  oldPan: ClipPoint,
  oldZoom: number,
  newZoom: number,
): ClipPoint {
  const ratio = newZoom / oldZoom;
  return {
    x: cursorClip.x * (1 - ratio) + oldPan.x * ratio,
    y: cursorClip.y * (1 - ratio) + oldPan.y * ratio,
  };
}

function hasNonZeroArea(size: ViewportSize): boolean {
  return size.width > 0 && size.height > 0;
}
