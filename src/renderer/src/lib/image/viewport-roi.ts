export interface ViewportRoi {
  readonly imagePixelX0: number;
  readonly imagePixelY0: number;
  readonly imagePixelX1: number;
  readonly imagePixelY1: number;
}

export interface ImagePixelExtents {
  readonly width: number;
  readonly height: number;
}

const MINIMUM_ROI_SIDE_PIXELS = 1;

export function canonicalizeViewportRoiCorners(roi: ViewportRoi): ViewportRoi {
  return {
    imagePixelX0: Math.min(roi.imagePixelX0, roi.imagePixelX1),
    imagePixelY0: Math.min(roi.imagePixelY0, roi.imagePixelY1),
    imagePixelX1: Math.max(roi.imagePixelX0, roi.imagePixelX1),
    imagePixelY1: Math.max(roi.imagePixelY0, roi.imagePixelY1),
  };
}

export function clampViewportRoiToImageBounds(
  roi: ViewportRoi,
  image: ImagePixelExtents,
): ViewportRoi {
  const canonical = canonicalizeViewportRoiCorners(roi);
  return {
    imagePixelX0: clampPixelIndex(canonical.imagePixelX0, image.width),
    imagePixelY0: clampPixelIndex(canonical.imagePixelY0, image.height),
    imagePixelX1: clampPixelIndex(canonical.imagePixelX1, image.width),
    imagePixelY1: clampPixelIndex(canonical.imagePixelY1, image.height),
  };
}

function clampPixelIndex(value: number, length: number): number {
  if (length <= 0) return 0;
  const intValue = Math.round(value);
  if (intValue < 0) return 0;
  if (intValue > length - 1) return length - 1;
  return intValue;
}

export function isViewportRoiLargerThanMinimumSide(roi: ViewportRoi): boolean {
  const canonical = canonicalizeViewportRoiCorners(roi);
  const widthPixels = canonical.imagePixelX1 - canonical.imagePixelX0 + 1;
  const heightPixels = canonical.imagePixelY1 - canonical.imagePixelY0 + 1;
  return widthPixels >= MINIMUM_ROI_SIDE_PIXELS && heightPixels >= MINIMUM_ROI_SIDE_PIXELS;
}

export function computeViewportRoiWidthInPixels(roi: ViewportRoi): number {
  const canonical = canonicalizeViewportRoiCorners(roi);
  return canonical.imagePixelX1 - canonical.imagePixelX0 + 1;
}

export function computeViewportRoiHeightInPixels(roi: ViewportRoi): number {
  const canonical = canonicalizeViewportRoiCorners(roi);
  return canonical.imagePixelY1 - canonical.imagePixelY0 + 1;
}

export function formatViewportRoiCornerLabel(roi: ViewportRoi): string {
  const canonical = canonicalizeViewportRoiCorners(roi);
  return `(${canonical.imagePixelX0}, ${canonical.imagePixelY0}) - (${canonical.imagePixelX1}, ${canonical.imagePixelY1})`;
}

export function formatViewportRoiSizeLabel(roi: ViewportRoi): string {
  const widthPixels = computeViewportRoiWidthInPixels(roi);
  const heightPixels = computeViewportRoiHeightInPixels(roi);
  return `${widthPixels} x ${heightPixels} px`;
}
