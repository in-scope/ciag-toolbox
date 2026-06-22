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

// The readout listens on the panel CONTAINER (not the canvas) so a pointer moving
// over an in-panel floating overlay (the band navigator, the ROI overlay) still
// updates the readout: pointermove bubbles from those children up to the container,
// while the cursor position stays measured against the canvas the overlay covers.
export function attachPointerReadoutEventHandlers(
  listenerTarget: HTMLElement,
  coordinateCanvas: HTMLCanvasElement,
  handlers: PointerReadoutHandlers,
): () => void {
  const throttledOnMove = createThrottledMoveHandler(handlers.onMove);
  const onPointerMove = (event: PointerEvent): void =>
    throttledOnMove(extractCursorPositionFromPointerEvent(event, coordinateCanvas));
  const onPointerLeave = (): void => handlers.onLeave();
  listenerTarget.addEventListener("pointermove", onPointerMove);
  listenerTarget.addEventListener("pointerleave", onPointerLeave);
  listenerTarget.addEventListener("pointercancel", onPointerLeave);
  return () => {
    listenerTarget.removeEventListener("pointermove", onPointerMove);
    listenerTarget.removeEventListener("pointerleave", onPointerLeave);
    listenerTarget.removeEventListener("pointercancel", onPointerLeave);
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
