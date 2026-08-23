import type { CanvasPixelPoint } from "./canvas-to-image-pixel";
import { extractCanvasPointFromPointerEvent } from "./roi-draw-input";

// The brush ghost tracks the pointer while the Masks tool is active, so the
// user sees where a stamp would land BEFORE pressing. Reporting canvas points
// (not image pixels) keeps this attachment as dumb as the brush input; the
// caller owns the view-transform conversion.

export interface BrushGhostHoverCallbacks {
  readonly isBrushGhostEnabled: () => boolean;
  readonly onHoverAtCanvasPoint: (point: CanvasPixelPoint | null) => void;
}

export function attachBrushGhostHoverEventHandlers(
  canvas: HTMLCanvasElement,
  callbacks: BrushGhostHoverCallbacks,
): () => void {
  const pointermove = (event: PointerEvent) => reportHoverFromPointerEvent(event, canvas, callbacks);
  const pointerleave = () => callbacks.onHoverAtCanvasPoint(null);
  canvas.addEventListener("pointermove", pointermove);
  canvas.addEventListener("pointerleave", pointerleave);
  return () => {
    canvas.removeEventListener("pointermove", pointermove);
    canvas.removeEventListener("pointerleave", pointerleave);
  };
}

function reportHoverFromPointerEvent(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  callbacks: BrushGhostHoverCallbacks,
): void {
  if (!callbacks.isBrushGhostEnabled()) {
    callbacks.onHoverAtCanvasPoint(null);
    return;
  }
  callbacks.onHoverAtCanvasPoint(extractCanvasPointFromPointerEvent(event, canvas));
}
