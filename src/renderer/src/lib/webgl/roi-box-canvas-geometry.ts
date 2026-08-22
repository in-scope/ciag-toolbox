import {
  canonicalizeViewportRoiCorners,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";
import type {
  RoiBoxCanvasPixelScale,
  RoiBoxCanvasRectangle,
} from "@/lib/image/roi-box-editing";
import type { ViewportRenderer } from "./viewport-renderer";

// Shared canvas-space geometry for the committed region box: the overlay draws
// the rectangle these helpers describe, and the CT-275 edit attachment hit-tests
// against the SAME rectangle so the grabbable area always matches what is drawn.

export function computeCanvasRectangleForRoiBox(
  roi: ViewportRoi,
  renderer: ViewportRenderer,
): RoiBoxCanvasRectangle | null {
  const canonical = canonicalizeViewportRoiCorners(roi);
  const topLeft = renderer.getCanvasPointForImagePixel(
    canonical.imagePixelX0,
    canonical.imagePixelY0,
  );
  const bottomRight = renderer.getCanvasPointForImagePixel(
    canonical.imagePixelX1 + 1,
    canonical.imagePixelY1 + 1,
  );
  if (!topLeft || !bottomRight) return null;
  return buildRectangleFromCanvasCorners(topLeft, bottomRight);
}

function buildRectangleFromCanvasCorners(
  first: { x: number; y: number },
  second: { x: number; y: number },
): RoiBoxCanvasRectangle {
  return {
    leftPx: Math.min(first.x, second.x),
    topPx: Math.min(first.y, second.y),
    widthPx: Math.abs(second.x - first.x),
    heightPx: Math.abs(second.y - first.y),
  };
}

export function computeCanvasPixelScaleForRenderer(
  renderer: ViewportRenderer,
): RoiBoxCanvasPixelScale | null {
  const origin = renderer.getCanvasPointForImagePixel(0, 0);
  const oneOver = renderer.getCanvasPointForImagePixel(1, 1);
  if (!origin || !oneOver) return null;
  return {
    canvasPxPerImagePixelX: oneOver.x - origin.x,
    canvasPxPerImagePixelY: oneOver.y - origin.y,
  };
}
