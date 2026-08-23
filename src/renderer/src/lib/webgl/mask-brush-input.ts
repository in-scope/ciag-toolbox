import type { CanvasPixelPoint } from "./canvas-to-image-pixel";
import { extractCanvasPointFromPointerEvent } from "./roi-draw-input";

// CT-304: freehand mask painting, the same attachment shape as roi-draw-input.
// A stroke claims the gesture on pointer-down (preventDefault plus
// stopImmediatePropagation), so it can never also start a pan or a region draw;
// that only holds because this attachment is registered on the canvas BEFORE
// those two (see the hook order in components/viewport.tsx).
//
// The attachment reports CANVAS points and the segment between consecutive
// pointer samples; converting to image pixels and rasterizing the stamps is the
// caller's job (lib/masks/mask-brush.ts), so nothing here knows about masks.

export interface MaskBrushCanvasSegment {
  readonly from: CanvasPixelPoint;
  readonly to: CanvasPixelPoint;
}

export interface MaskBrushCallbacks {
  readonly isMaskPaintingEnabled: () => boolean;
  readonly onStrokeBegin: (point: CanvasPixelPoint) => void;
  readonly onStrokeExtend: (segment: MaskBrushCanvasSegment) => void;
  readonly onStrokeCommit: () => void;
  readonly onStrokeCancel: () => void;
}

export interface MaskBrushAttachment {
  readonly detach: () => void;
  readonly cancelInProgressStroke: () => void;
}

interface MaskStrokeState {
  active: boolean;
  pointerId: number;
  lastPoint: CanvasPixelPoint;
}

export function attachMaskBrushEventHandlers(
  canvas: HTMLCanvasElement,
  callbacks: MaskBrushCallbacks,
): MaskBrushAttachment {
  const strokeState = createInactiveMaskStrokeState();
  const handlers = buildMaskBrushEventHandlers(canvas, strokeState, callbacks);
  registerMaskBrushHandlersOnCanvas(canvas, handlers);
  return {
    detach: () => unregisterMaskBrushHandlersFromCanvas(canvas, handlers),
    cancelInProgressStroke: () => discardActiveStroke(canvas, strokeState, callbacks),
  };
}

function createInactiveMaskStrokeState(): MaskStrokeState {
  return { active: false, pointerId: -1, lastPoint: { x: 0, y: 0 } };
}

interface MaskBrushEventHandlers {
  readonly pointerdown: (event: PointerEvent) => void;
  readonly pointermove: (event: PointerEvent) => void;
  readonly pointerup: (event: PointerEvent) => void;
  readonly pointercancel: (event: PointerEvent) => void;
}

function buildMaskBrushEventHandlers(
  canvas: HTMLCanvasElement,
  strokeState: MaskStrokeState,
  callbacks: MaskBrushCallbacks,
): MaskBrushEventHandlers {
  return {
    pointerdown: (event) => beginStrokeIfPrimaryButton(event, canvas, strokeState, callbacks),
    pointermove: (event) => extendStrokeToPointerPosition(event, canvas, strokeState, callbacks),
    pointerup: (event) => commitStrokeOnRelease(event, canvas, strokeState, callbacks),
    pointercancel: (event) => cancelStrokeOnPointerCancel(event, canvas, strokeState, callbacks),
  };
}

function beginStrokeIfPrimaryButton(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  strokeState: MaskStrokeState,
  callbacks: MaskBrushCallbacks,
): void {
  if (event.button !== 0) return;
  if (!callbacks.isMaskPaintingEnabled()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const start = extractCanvasPointFromPointerEvent(event, canvas);
  strokeState.active = true;
  strokeState.pointerId = event.pointerId;
  strokeState.lastPoint = start;
  canvas.setPointerCapture(event.pointerId);
  callbacks.onStrokeBegin(start);
}

function extendStrokeToPointerPosition(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  strokeState: MaskStrokeState,
  callbacks: MaskBrushCallbacks,
): void {
  if (!isEventForActiveStroke(event, strokeState)) return;
  const current = extractCanvasPointFromPointerEvent(event, canvas);
  const segment = { from: strokeState.lastPoint, to: current };
  strokeState.lastPoint = current;
  callbacks.onStrokeExtend(segment);
}

function commitStrokeOnRelease(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  strokeState: MaskStrokeState,
  callbacks: MaskBrushCallbacks,
): void {
  if (!isEventForActiveStroke(event, strokeState)) return;
  extendStrokeToPointerPosition(event, canvas, strokeState, callbacks);
  endStrokeReleasingPointer(canvas, strokeState);
  callbacks.onStrokeCommit();
}

function cancelStrokeOnPointerCancel(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  strokeState: MaskStrokeState,
  callbacks: MaskBrushCallbacks,
): void {
  if (!isEventForActiveStroke(event, strokeState)) return;
  endStrokeReleasingPointer(canvas, strokeState);
  callbacks.onStrokeCancel();
}

function discardActiveStroke(
  canvas: HTMLCanvasElement,
  strokeState: MaskStrokeState,
  callbacks: MaskBrushCallbacks,
): void {
  if (!strokeState.active) return;
  endStrokeReleasingPointer(canvas, strokeState);
  callbacks.onStrokeCancel();
}

function isEventForActiveStroke(event: PointerEvent, strokeState: MaskStrokeState): boolean {
  return strokeState.active && event.pointerId === strokeState.pointerId;
}

function endStrokeReleasingPointer(
  canvas: HTMLCanvasElement,
  strokeState: MaskStrokeState,
): void {
  releasePointerCaptureIfHeld(canvas, strokeState.pointerId);
  strokeState.active = false;
  strokeState.pointerId = -1;
}

function releasePointerCaptureIfHeld(canvas: HTMLCanvasElement, pointerId: number): void {
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
}

function registerMaskBrushHandlersOnCanvas(
  canvas: HTMLCanvasElement,
  handlers: MaskBrushEventHandlers,
): void {
  canvas.addEventListener("pointerdown", handlers.pointerdown);
  canvas.addEventListener("pointermove", handlers.pointermove);
  canvas.addEventListener("pointerup", handlers.pointerup);
  canvas.addEventListener("pointercancel", handlers.pointercancel);
}

function unregisterMaskBrushHandlersFromCanvas(
  canvas: HTMLCanvasElement,
  handlers: MaskBrushEventHandlers,
): void {
  canvas.removeEventListener("pointerdown", handlers.pointerdown);
  canvas.removeEventListener("pointermove", handlers.pointermove);
  canvas.removeEventListener("pointerup", handlers.pointerup);
  canvas.removeEventListener("pointercancel", handlers.pointercancel);
}
