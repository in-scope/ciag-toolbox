import type { CanvasPixelPoint } from "./canvas-to-image-pixel";

export interface RoiDrawCanvasRect {
  readonly start: CanvasPixelPoint;
  readonly current: CanvasPixelPoint;
}

export interface RoiDrawCallbacks {
  readonly isRoiDrawingEnabled: () => boolean;
  readonly onDragStateChange: (rect: RoiDrawCanvasRect | null) => void;
  readonly onDragCommit: (rect: RoiDrawCanvasRect) => void;
}

interface RoiDragState {
  active: boolean;
  pointerId: number;
  start: CanvasPixelPoint;
}

export function attachRoiDrawEventHandlers(
  canvas: HTMLCanvasElement,
  callbacks: RoiDrawCallbacks,
): () => void {
  const dragState = createInactiveRoiDragState();
  const handlers = buildRoiDrawEventHandlers(canvas, dragState, callbacks);
  registerRoiDrawHandlersOnCanvas(canvas, handlers);
  return () => unregisterRoiDrawHandlersFromCanvas(canvas, handlers);
}

function createInactiveRoiDragState(): RoiDragState {
  return { active: false, pointerId: -1, start: { x: 0, y: 0 } };
}

interface RoiDrawEventHandlers {
  readonly pointerdown: (event: PointerEvent) => void;
  readonly pointermove: (event: PointerEvent) => void;
  readonly pointerup: (event: PointerEvent) => void;
  readonly pointercancel: (event: PointerEvent) => void;
}

function buildRoiDrawEventHandlers(
  canvas: HTMLCanvasElement,
  dragState: RoiDragState,
  callbacks: RoiDrawCallbacks,
): RoiDrawEventHandlers {
  return {
    pointerdown: (event) => beginRoiDragIfPrimaryButton(event, canvas, dragState, callbacks),
    pointermove: (event) => emitInProgressDragRectangleIfActive(event, canvas, dragState, callbacks),
    pointerup: (event) => commitOrCancelRoiDragOnRelease(event, canvas, dragState, callbacks),
    pointercancel: (event) => cancelInProgressRoiDrag(event, canvas, dragState, callbacks),
  };
}

function beginRoiDragIfPrimaryButton(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  dragState: RoiDragState,
  callbacks: RoiDrawCallbacks,
): void {
  if (event.button !== 0) return;
  if (!callbacks.isRoiDrawingEnabled()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const start = extractCanvasPointFromPointerEvent(event, canvas);
  dragState.active = true;
  dragState.pointerId = event.pointerId;
  dragState.start = start;
  canvas.setPointerCapture(event.pointerId);
  callbacks.onDragStateChange({ start, current: start });
}

function emitInProgressDragRectangleIfActive(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  dragState: RoiDragState,
  callbacks: RoiDrawCallbacks,
): void {
  if (!dragState.active || event.pointerId !== dragState.pointerId) return;
  const current = extractCanvasPointFromPointerEvent(event, canvas);
  callbacks.onDragStateChange({ start: dragState.start, current });
}

function commitOrCancelRoiDragOnRelease(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  dragState: RoiDragState,
  callbacks: RoiDrawCallbacks,
): void {
  if (!dragState.active || event.pointerId !== dragState.pointerId) return;
  const current = extractCanvasPointFromPointerEvent(event, canvas);
  const start = dragState.start;
  releasePointerCaptureIfHeld(canvas, dragState.pointerId);
  resetRoiDragState(dragState);
  callbacks.onDragStateChange(null);
  callbacks.onDragCommit({ start, current });
}

function cancelInProgressRoiDrag(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  dragState: RoiDragState,
  callbacks: RoiDrawCallbacks,
): void {
  if (!dragState.active || event.pointerId !== dragState.pointerId) return;
  releasePointerCaptureIfHeld(canvas, dragState.pointerId);
  resetRoiDragState(dragState);
  callbacks.onDragStateChange(null);
}

function resetRoiDragState(dragState: RoiDragState): void {
  dragState.active = false;
  dragState.pointerId = -1;
}

function releasePointerCaptureIfHeld(canvas: HTMLCanvasElement, pointerId: number): void {
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
}

function extractCanvasPointFromPointerEvent(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
): CanvasPixelPoint {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function registerRoiDrawHandlersOnCanvas(
  canvas: HTMLCanvasElement,
  handlers: RoiDrawEventHandlers,
): void {
  canvas.addEventListener("pointerdown", handlers.pointerdown);
  canvas.addEventListener("pointermove", handlers.pointermove);
  canvas.addEventListener("pointerup", handlers.pointerup);
  canvas.addEventListener("pointercancel", handlers.pointercancel);
}

function unregisterRoiDrawHandlersFromCanvas(
  canvas: HTMLCanvasElement,
  handlers: RoiDrawEventHandlers,
): void {
  canvas.removeEventListener("pointerdown", handlers.pointerdown);
  canvas.removeEventListener("pointermove", handlers.pointermove);
  canvas.removeEventListener("pointerup", handlers.pointerup);
  canvas.removeEventListener("pointercancel", handlers.pointercancel);
}
