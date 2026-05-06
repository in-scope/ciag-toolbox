const POINTER_READOUT_TARGET_FRAMES_PER_SECOND = 30;
const POINTER_READOUT_MIN_INTERVAL_MS = 1000 / POINTER_READOUT_TARGET_FRAMES_PER_SECOND;

export interface CanvasCursorPositionPx {
  readonly xPx: number;
  readonly yPx: number;
}

export interface PointerReadoutHandlers {
  readonly onMove: (position: CanvasCursorPositionPx) => void;
  readonly onLeave: () => void;
}

export function attachPointerReadoutEventHandlers(
  canvas: HTMLCanvasElement,
  handlers: PointerReadoutHandlers,
): () => void {
  const throttledOnMove = createThrottledMoveHandler(handlers.onMove);
  const onPointerMove = (event: PointerEvent): void =>
    throttledOnMove(extractCursorPositionFromPointerEvent(event, canvas));
  const onPointerLeave = (): void => handlers.onLeave();
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointercancel", onPointerLeave);
  return () => {
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("pointercancel", onPointerLeave);
  };
}

function createThrottledMoveHandler(
  emit: (position: CanvasCursorPositionPx) => void,
): (position: CanvasCursorPositionPx) => void {
  let lastEmitTimeMs = 0;
  return (position) => {
    const now = performance.now();
    if (now - lastEmitTimeMs < POINTER_READOUT_MIN_INTERVAL_MS) return;
    lastEmitTimeMs = now;
    emit(position);
  };
}

function extractCursorPositionFromPointerEvent(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
): CanvasCursorPositionPx {
  const rect = canvas.getBoundingClientRect();
  return { xPx: event.clientX - rect.left, yPx: event.clientY - rect.top };
}
