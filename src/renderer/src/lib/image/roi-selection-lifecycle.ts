import { canonicalizeViewportRoiCorners, type ViewportRoi } from "./viewport-roi";

export interface ClickedImagePixel {
  readonly x: number;
  readonly y: number;
}

export type InspectionRoiSelectionEvent =
  | { readonly kind: "commit"; readonly roi: ViewportRoi }
  | { readonly kind: "plain-click"; readonly clickedImagePixel: ClickedImagePixel | null }
  | { readonly kind: "region-tool-deactivated" };

export function reduceInspectionRoiSelection(
  currentRoi: ViewportRoi | null,
  event: InspectionRoiSelectionEvent,
): ViewportRoi | null {
  if (event.kind === "commit") return canonicalizeViewportRoiCorners(event.roi);
  if (event.kind === "region-tool-deactivated") return null;
  return resolveInspectionRoiAfterPlainClick(currentRoi, event.clickedImagePixel);
}

export function resolveInspectionRoiAfterPlainClick(
  currentRoi: ViewportRoi | null,
  clickedImagePixel: ClickedImagePixel | null,
): ViewportRoi | null {
  if (!currentRoi) return null;
  if (isPlainClickInsideRoi(currentRoi, clickedImagePixel)) return currentRoi;
  return null;
}

function isPlainClickInsideRoi(
  roi: ViewportRoi,
  clickedImagePixel: ClickedImagePixel | null,
): boolean {
  if (!clickedImagePixel) return false;
  return isImagePixelInsideRoi(roi, clickedImagePixel.x, clickedImagePixel.y);
}

export function isImagePixelInsideRoi(roi: ViewportRoi, imageX: number, imageY: number): boolean {
  const canonical = canonicalizeViewportRoiCorners(roi);
  const isWithinHorizontalSpan =
    imageX >= canonical.imagePixelX0 && imageX <= canonical.imagePixelX1;
  const isWithinVerticalSpan =
    imageY >= canonical.imagePixelY0 && imageY <= canonical.imagePixelY1;
  return isWithinHorizontalSpan && isWithinVerticalSpan;
}
