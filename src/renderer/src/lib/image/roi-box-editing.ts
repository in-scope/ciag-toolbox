import {
  canonicalizeViewportRoiCorners,
  type ImagePixelExtents,
  type ViewportRoi,
} from "./viewport-roi";

// CT-275: pure geometry for editing a COMMITTED region box with the mouse.
// Dragging inside the box moves it at fixed size; dragging a corner handle
// resizes it around the opposite (anchored) corner. Both operations CLAMP to
// the image boundary - an edit can shrink or stop at an edge but never resets
// the selection, and a resize can never go below 1x1 (a corner dragged onto
// its anchor still spans one pixel).

export type RoiBoxCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

export type RoiBoxHit =
  | { readonly kind: "corner"; readonly corner: RoiBoxCorner }
  | { readonly kind: "inside" }
  | { readonly kind: "outside" };

export interface RoiBoxCanvasRectangle {
  readonly leftPx: number;
  readonly topPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface RoiBoxCanvasPixelScale {
  readonly canvasPxPerImagePixelX: number;
  readonly canvasPxPerImagePixelY: number;
}

export interface ImagePixelOffset {
  readonly offsetXPixels: number;
  readonly offsetYPixels: number;
}

export const ROI_BOX_CORNER_HIT_RADIUS_PX = 6;

export function moveViewportRoiByPixelOffsetClampedToImage(
  roi: ViewportRoi,
  offsetXPixels: number,
  offsetYPixels: number,
  image: ImagePixelExtents,
): ViewportRoi {
  const canonical = canonicalizeViewportRoiCorners(roi);
  const dx = clampMoveOffsetToAxis(offsetXPixels, canonical.imagePixelX0, canonical.imagePixelX1, image.width);
  const dy = clampMoveOffsetToAxis(offsetYPixels, canonical.imagePixelY0, canonical.imagePixelY1, image.height);
  return {
    imagePixelX0: canonical.imagePixelX0 + dx,
    imagePixelY0: canonical.imagePixelY0 + dy,
    imagePixelX1: canonical.imagePixelX1 + dx,
    imagePixelY1: canonical.imagePixelY1 + dy,
  };
}

function clampMoveOffsetToAxis(
  offset: number,
  lowPixel: number,
  highPixel: number,
  axisLength: number,
): number {
  const smallestAllowed = -lowPixel;
  const largestAllowed = axisLength - 1 - highPixel;
  return Math.min(Math.max(Math.round(offset), smallestAllowed), largestAllowed);
}

export function resizeViewportRoiByDraggingCornerClampedToImage(
  roi: ViewportRoi,
  draggedCorner: RoiBoxCorner,
  offsetXPixels: number,
  offsetYPixels: number,
  image: ImagePixelExtents,
): ViewportRoi {
  const canonical = canonicalizeViewportRoiCorners(roi);
  const dragged = readRoiCornerPixel(canonical, draggedCorner);
  const anchor = readRoiCornerPixel(canonical, oppositeRoiBoxCorner(draggedCorner));
  return canonicalizeViewportRoiCorners({
    imagePixelX0: anchor.x,
    imagePixelY0: anchor.y,
    imagePixelX1: clampPixelIndexToAxis(Math.round(dragged.x + offsetXPixels), image.width),
    imagePixelY1: clampPixelIndexToAxis(Math.round(dragged.y + offsetYPixels), image.height),
  });
}

export function oppositeRoiBoxCorner(corner: RoiBoxCorner): RoiBoxCorner {
  if (corner === "topLeft") return "bottomRight";
  if (corner === "topRight") return "bottomLeft";
  if (corner === "bottomLeft") return "topRight";
  return "topLeft";
}

function readRoiCornerPixel(
  canonical: ViewportRoi,
  corner: RoiBoxCorner,
): { x: number; y: number } {
  const x = corner === "topLeft" || corner === "bottomLeft"
    ? canonical.imagePixelX0
    : canonical.imagePixelX1;
  const y = corner === "topLeft" || corner === "topRight"
    ? canonical.imagePixelY0
    : canonical.imagePixelY1;
  return { x, y };
}

function clampPixelIndexToAxis(value: number, axisLength: number): number {
  if (axisLength <= 0) return 0;
  if (value < 0) return 0;
  if (value > axisLength - 1) return axisLength - 1;
  return value;
}

export function classifyRoiBoxHitAtCanvasPoint(
  pointXPx: number,
  pointYPx: number,
  rectangle: RoiBoxCanvasRectangle,
  cornerHitRadiusPx: number = ROI_BOX_CORNER_HIT_RADIUS_PX,
): RoiBoxHit {
  const corner = findRoiBoxCornerWithinHitRadius(pointXPx, pointYPx, rectangle, cornerHitRadiusPx);
  if (corner) return { kind: "corner", corner };
  if (isCanvasPointInsideRoiBoxRectangle(pointXPx, pointYPx, rectangle)) return { kind: "inside" };
  return { kind: "outside" };
}

function findRoiBoxCornerWithinHitRadius(
  pointXPx: number,
  pointYPx: number,
  rectangle: RoiBoxCanvasRectangle,
  cornerHitRadiusPx: number,
): RoiBoxCorner | null {
  for (const { corner, x, y } of listRoiBoxCornerCanvasCenters(rectangle)) {
    const isWithinRadius =
      Math.abs(pointXPx - x) <= cornerHitRadiusPx && Math.abs(pointYPx - y) <= cornerHitRadiusPx;
    if (isWithinRadius) return corner;
  }
  return null;
}

function listRoiBoxCornerCanvasCenters(
  rectangle: RoiBoxCanvasRectangle,
): ReadonlyArray<{ corner: RoiBoxCorner; x: number; y: number }> {
  const right = rectangle.leftPx + rectangle.widthPx;
  const bottom = rectangle.topPx + rectangle.heightPx;
  return [
    { corner: "topLeft", x: rectangle.leftPx, y: rectangle.topPx },
    { corner: "topRight", x: right, y: rectangle.topPx },
    { corner: "bottomLeft", x: rectangle.leftPx, y: bottom },
    { corner: "bottomRight", x: right, y: bottom },
  ];
}

function isCanvasPointInsideRoiBoxRectangle(
  pointXPx: number,
  pointYPx: number,
  rectangle: RoiBoxCanvasRectangle,
): boolean {
  return (
    pointXPx >= rectangle.leftPx &&
    pointXPx <= rectangle.leftPx + rectangle.widthPx &&
    pointYPx >= rectangle.topPx &&
    pointYPx <= rectangle.topPx + rectangle.heightPx
  );
}

export function cursorStyleForRoiBoxHit(hit: RoiBoxHit): string {
  if (hit.kind === "corner") {
    return hit.corner === "topLeft" || hit.corner === "bottomRight"
      ? "nwse-resize"
      : "nesw-resize";
  }
  if (hit.kind === "inside") return "move";
  return "";
}

export function convertCanvasDeltaToImagePixelDelta(
  canvasDeltaXPx: number,
  canvasDeltaYPx: number,
  scale: RoiBoxCanvasPixelScale,
): ImagePixelOffset {
  return {
    offsetXPixels: divideCanvasDeltaByScaleOrZero(canvasDeltaXPx, scale.canvasPxPerImagePixelX),
    offsetYPixels: divideCanvasDeltaByScaleOrZero(canvasDeltaYPx, scale.canvasPxPerImagePixelY),
  };
}

function divideCanvasDeltaByScaleOrZero(deltaPx: number, canvasPxPerImagePixel: number): number {
  if (canvasPxPerImagePixel === 0 || !Number.isFinite(canvasPxPerImagePixel)) return 0;
  return deltaPx / canvasPxPerImagePixel;
}

export function areViewportRoisIdentical(first: ViewportRoi, second: ViewportRoi): boolean {
  const a = canonicalizeViewportRoiCorners(first);
  const b = canonicalizeViewportRoiCorners(second);
  return (
    a.imagePixelX0 === b.imagePixelX0 &&
    a.imagePixelY0 === b.imagePixelY0 &&
    a.imagePixelX1 === b.imagePixelX1 &&
    a.imagePixelY1 === b.imagePixelY1
  );
}
