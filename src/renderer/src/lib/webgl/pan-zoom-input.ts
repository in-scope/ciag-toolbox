export interface PanZoomTarget {
  panByPixels(dxPx: number, dyPx: number): void;
  zoomAtCanvasPoint(xPx: number, yPx: number, wheelDeltaY: number): void;
  resetView(): void;
}

interface DragState {
  active: boolean;
  lastClientX: number;
  lastClientY: number;
}

interface PanZoomEventHandlers {
  pointerdown: (event: PointerEvent) => void;
  pointermove: (event: PointerEvent) => void;
  pointerup: (event: PointerEvent) => void;
  pointercancel: (event: PointerEvent) => void;
  wheel: (event: WheelEvent) => void;
  dblclick: () => void;
}

type PanZoomTargetGetter = () => PanZoomTarget | null;
type CanInitiatePanPredicate = () => boolean;

const ALWAYS_ALLOW_PAN: CanInitiatePanPredicate = () => true;

export function attachPanZoomEventHandlers(
  canvas: HTMLCanvasElement,
  getTarget: PanZoomTargetGetter,
  getCanInitiatePan: CanInitiatePanPredicate = ALWAYS_ALLOW_PAN,
): () => void {
  const dragState = createInactiveDragState();
  const handlers = createPanZoomEventHandlers(canvas, getTarget, dragState, getCanInitiatePan);
  registerPanZoomHandlersOnCanvas(canvas, handlers);
  return () => unregisterPanZoomHandlersFromCanvas(canvas, handlers);
}

function createInactiveDragState(): DragState {
  return { active: false, lastClientX: 0, lastClientY: 0 };
}

function createPanZoomEventHandlers(
  canvas: HTMLCanvasElement,
  getTarget: PanZoomTargetGetter,
  dragState: DragState,
  getCanInitiatePan: CanInitiatePanPredicate,
): PanZoomEventHandlers {
  return {
    pointerdown: (event) => beginPanIfPrimaryButton(event, canvas, dragState, getCanInitiatePan),
    pointermove: (event) =>
      panTargetIfDragActive(event, dragState, getTarget()),
    pointerup: (event) => endPan(event, canvas, dragState),
    pointercancel: (event) => endPan(event, canvas, dragState),
    wheel: (event) => zoomTargetAtCursor(event, canvas, getTarget()),
    dblclick: () => getTarget()?.resetView(),
  };
}

function beginPanIfPrimaryButton(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  dragState: DragState,
  getCanInitiatePan: CanInitiatePanPredicate,
): void {
  if (event.button !== 0) return;
  if (!getCanInitiatePan()) return;
  if (event.defaultPrevented) return;
  dragState.active = true;
  dragState.lastClientX = event.clientX;
  dragState.lastClientY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
}

function panTargetIfDragActive(
  event: PointerEvent,
  dragState: DragState,
  target: PanZoomTarget | null,
): void {
  if (!dragState.active || !target) return;
  const deltaX = event.clientX - dragState.lastClientX;
  const deltaY = event.clientY - dragState.lastClientY;
  dragState.lastClientX = event.clientX;
  dragState.lastClientY = event.clientY;
  target.panByPixels(deltaX, deltaY);
}

function endPan(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  dragState: DragState,
): void {
  dragState.active = false;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

function zoomTargetAtCursor(
  event: WheelEvent,
  canvas: HTMLCanvasElement,
  target: PanZoomTarget | null,
): void {
  event.preventDefault();
  if (!target) return;
  const rect = canvas.getBoundingClientRect();
  const cursorX = event.clientX - rect.left;
  const cursorY = event.clientY - rect.top;
  target.zoomAtCanvasPoint(cursorX, cursorY, event.deltaY);
}

function registerPanZoomHandlersOnCanvas(
  canvas: HTMLCanvasElement,
  handlers: PanZoomEventHandlers,
): void {
  canvas.addEventListener("pointerdown", handlers.pointerdown);
  canvas.addEventListener("pointermove", handlers.pointermove);
  canvas.addEventListener("pointerup", handlers.pointerup);
  canvas.addEventListener("pointercancel", handlers.pointercancel);
  canvas.addEventListener("wheel", handlers.wheel, { passive: false });
  canvas.addEventListener("dblclick", handlers.dblclick);
}

function unregisterPanZoomHandlersFromCanvas(
  canvas: HTMLCanvasElement,
  handlers: PanZoomEventHandlers,
): void {
  canvas.removeEventListener("pointerdown", handlers.pointerdown);
  canvas.removeEventListener("pointermove", handlers.pointermove);
  canvas.removeEventListener("pointerup", handlers.pointerup);
  canvas.removeEventListener("pointercancel", handlers.pointercancel);
  canvas.removeEventListener("wheel", handlers.wheel);
  canvas.removeEventListener("dblclick", handlers.dblclick);
}
