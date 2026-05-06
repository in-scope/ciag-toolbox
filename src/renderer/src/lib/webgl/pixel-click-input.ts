import type { CanvasPixelPoint } from "./canvas-to-image-pixel";

export interface PixelClickCallbacks {
  readonly isPixelClickEnabled: () => boolean;
  readonly onPixelClick: (point: CanvasPixelPoint) => void;
}

interface PixelClickPointerState {
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
}

const MAX_CLICK_DRIFT_PIXELS = 3;

export function attachPixelClickEventHandlers(
  canvas: HTMLCanvasElement,
  callbacks: PixelClickCallbacks,
): () => void {
  const state = createInactiveClickPointerState();
  const handlers = buildPixelClickEventHandlers(canvas, state, callbacks);
  registerPixelClickHandlersOnCanvas(canvas, handlers);
  return () => unregisterPixelClickHandlersFromCanvas(canvas, handlers);
}

function createInactiveClickPointerState(): PixelClickPointerState {
  return { pointerId: -1, startX: 0, startY: 0, active: false };
}

interface PixelClickEventHandlers {
  readonly pointerdown: (event: PointerEvent) => void;
  readonly pointerup: (event: PointerEvent) => void;
  readonly pointercancel: (event: PointerEvent) => void;
}

function buildPixelClickEventHandlers(
  canvas: HTMLCanvasElement,
  state: PixelClickPointerState,
  callbacks: PixelClickCallbacks,
): PixelClickEventHandlers {
  return {
    pointerdown: (event) => recordPotentialClickStart(event, state, callbacks),
    pointerup: (event) => emitClickIfPointerStayedNearOrigin(event, canvas, state, callbacks),
    pointercancel: () => resetClickPointerState(state),
  };
}

function recordPotentialClickStart(
  event: PointerEvent,
  state: PixelClickPointerState,
  callbacks: PixelClickCallbacks,
): void {
  if (event.button !== 0) return;
  if (!callbacks.isPixelClickEnabled()) return;
  if (event.defaultPrevented) return;
  state.pointerId = event.pointerId;
  state.startX = event.clientX;
  state.startY = event.clientY;
  state.active = true;
}

function emitClickIfPointerStayedNearOrigin(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  state: PixelClickPointerState,
  callbacks: PixelClickCallbacks,
): void {
  if (!state.active || event.pointerId !== state.pointerId) return;
  const drifted = pointerDriftedBeyondClickThreshold(event, state);
  resetClickPointerState(state);
  if (drifted) return;
  if (!callbacks.isPixelClickEnabled()) return;
  callbacks.onPixelClick(extractCanvasPointFromPointerEvent(event, canvas));
}

function pointerDriftedBeyondClickThreshold(
  event: PointerEvent,
  state: PixelClickPointerState,
): boolean {
  const dx = Math.abs(event.clientX - state.startX);
  const dy = Math.abs(event.clientY - state.startY);
  return dx > MAX_CLICK_DRIFT_PIXELS || dy > MAX_CLICK_DRIFT_PIXELS;
}

function resetClickPointerState(state: PixelClickPointerState): void {
  state.active = false;
  state.pointerId = -1;
}

function extractCanvasPointFromPointerEvent(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
): CanvasPixelPoint {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function registerPixelClickHandlersOnCanvas(
  canvas: HTMLCanvasElement,
  handlers: PixelClickEventHandlers,
): void {
  canvas.addEventListener("pointerdown", handlers.pointerdown);
  canvas.addEventListener("pointerup", handlers.pointerup);
  canvas.addEventListener("pointercancel", handlers.pointercancel);
}

function unregisterPixelClickHandlersFromCanvas(
  canvas: HTMLCanvasElement,
  handlers: PixelClickEventHandlers,
): void {
  canvas.removeEventListener("pointerdown", handlers.pointerdown);
  canvas.removeEventListener("pointerup", handlers.pointerup);
  canvas.removeEventListener("pointercancel", handlers.pointercancel);
}
