import {
  areViewportRoisIdentical,
  classifyRoiBoxHitAtCanvasPoint,
  convertCanvasDeltaToImagePixelDelta,
  cursorStyleForRoiBoxHit,
  moveViewportRoiByPixelOffsetClampedToImage,
  resizeViewportRoiByDraggingCornerClampedToImage,
  type RoiBoxCanvasRectangle,
  type RoiBoxCorner,
} from "@/lib/image/roi-box-editing";
import {
  canonicalizeViewportRoiCorners,
  type ImagePixelExtents,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";
import type { CanvasPixelPoint } from "./canvas-to-image-pixel";
import {
  computeCanvasPixelScaleForRenderer,
  computeCanvasRectangleForRoiBox,
} from "./roi-box-canvas-geometry";
import { extractCanvasPointFromPointerEvent } from "./roi-draw-input";
import type { ViewportRenderer } from "./viewport-renderer";

// CT-275: pointer handling that lets the COMMITTED region box be dragged (body)
// and resized (corner handles). These handlers must be registered on the canvas
// BEFORE the pan-zoom and draw handlers: when a pointer-down lands on the box
// they claim it with stopImmediatePropagation, so a click inside the box can
// never start a pan or a fresh draw. Edits preview through onPreviewRoiEdit on
// every move and commit once on release; a released pointer that did not change
// the box commits nothing.

export interface RoiBoxEditCallbacks {
  readonly isRoiBoxEditingEnabled: () => boolean;
  readonly getCommittedRoi: () => ViewportRoi | null;
  readonly getRenderer: () => ViewportRenderer | null;
  readonly getImageExtents: () => ImagePixelExtents | null;
  readonly onPreviewRoiEdit: (roi: ViewportRoi | null) => void;
  readonly onCommitRoiEdit: (roi: ViewportRoi) => void;
}

export interface RoiBoxEditAttachment {
  readonly detach: () => void;
}

type RoiBoxDragMode = "move" | RoiBoxCorner;

interface RoiBoxDragState {
  active: boolean;
  pointerId: number;
  mode: RoiBoxDragMode;
  startRoi: ViewportRoi;
  startPoint: CanvasPixelPoint;
  lastPreviewedRoi: ViewportRoi | null;
}

export function attachRoiBoxEditEventHandlers(
  canvas: HTMLCanvasElement,
  callbacks: RoiBoxEditCallbacks,
): RoiBoxEditAttachment {
  const dragState = createInactiveRoiBoxDragState();
  const handlers = buildRoiBoxEditEventHandlers(canvas, dragState, callbacks);
  registerRoiBoxEditHandlersOnCanvas(canvas, handlers);
  return {
    detach: () => {
      unregisterRoiBoxEditHandlersFromCanvas(canvas, handlers);
      setCanvasCursorStyle(canvas, "");
    },
  };
}

function createInactiveRoiBoxDragState(): RoiBoxDragState {
  return {
    active: false,
    pointerId: -1,
    mode: "move",
    startRoi: { imagePixelX0: 0, imagePixelY0: 0, imagePixelX1: 0, imagePixelY1: 0 },
    startPoint: { x: 0, y: 0 },
    lastPreviewedRoi: null,
  };
}

interface RoiBoxEditEventHandlers {
  readonly pointerdown: (event: PointerEvent) => void;
  readonly pointermove: (event: PointerEvent) => void;
  readonly pointerup: (event: PointerEvent) => void;
  readonly pointercancel: (event: PointerEvent) => void;
}

function buildRoiBoxEditEventHandlers(
  canvas: HTMLCanvasElement,
  dragState: RoiBoxDragState,
  callbacks: RoiBoxEditCallbacks,
): RoiBoxEditEventHandlers {
  return {
    pointerdown: (event) => beginRoiBoxEditWhenPointerLandsOnBox(event, canvas, dragState, callbacks),
    pointermove: (event) => previewRoiBoxEditOrUpdateHoverCursor(event, canvas, dragState, callbacks),
    pointerup: (event) => commitRoiBoxEditOnRelease(event, canvas, dragState, callbacks),
    pointercancel: (event) => discardRoiBoxEditWithoutCommitting(event, canvas, dragState, callbacks),
  };
}

interface EditableRoiBoxContext {
  readonly roi: ViewportRoi;
  readonly rectangle: RoiBoxCanvasRectangle;
}

function readEditableRoiBoxContextOrNull(
  callbacks: RoiBoxEditCallbacks,
): EditableRoiBoxContext | null {
  if (!callbacks.isRoiBoxEditingEnabled()) return null;
  const roi = callbacks.getCommittedRoi();
  const renderer = callbacks.getRenderer();
  if (!roi || !renderer || !callbacks.getImageExtents()) return null;
  const rectangle = computeCanvasRectangleForRoiBox(roi, renderer);
  if (!rectangle) return null;
  return { roi, rectangle };
}

function beginRoiBoxEditWhenPointerLandsOnBox(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  dragState: RoiBoxDragState,
  callbacks: RoiBoxEditCallbacks,
): void {
  if (event.button !== 0) return;
  const context = readEditableRoiBoxContextOrNull(callbacks);
  if (!context) return;
  const point = extractCanvasPointFromPointerEvent(event, canvas);
  const hit = classifyRoiBoxHitAtCanvasPoint(point.x, point.y, context.rectangle);
  if (hit.kind === "outside") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  activateRoiBoxDragState(dragState, event.pointerId, hit.kind === "inside" ? "move" : hit.corner, context.roi, point);
  canvas.setPointerCapture(event.pointerId);
}

function activateRoiBoxDragState(
  dragState: RoiBoxDragState,
  pointerId: number,
  mode: RoiBoxDragMode,
  startRoi: ViewportRoi,
  startPoint: CanvasPixelPoint,
): void {
  dragState.active = true;
  dragState.pointerId = pointerId;
  dragState.mode = mode;
  dragState.startRoi = canonicalizeViewportRoiCorners(startRoi);
  dragState.startPoint = startPoint;
  dragState.lastPreviewedRoi = null;
}

function previewRoiBoxEditOrUpdateHoverCursor(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  dragState: RoiBoxDragState,
  callbacks: RoiBoxEditCallbacks,
): void {
  if (!dragState.active) {
    updateHoverCursorForRoiBox(event, canvas, callbacks);
    return;
  }
  if (event.pointerId !== dragState.pointerId) return;
  const edited = computeEditedRoiForPointerEvent(event, canvas, dragState, callbacks);
  if (!edited) return;
  dragState.lastPreviewedRoi = edited;
  callbacks.onPreviewRoiEdit(edited);
}

function updateHoverCursorForRoiBox(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  callbacks: RoiBoxEditCallbacks,
): void {
  const context = readEditableRoiBoxContextOrNull(callbacks);
  if (!context) {
    setCanvasCursorStyle(canvas, "");
    return;
  }
  const point = extractCanvasPointFromPointerEvent(event, canvas);
  const hit = classifyRoiBoxHitAtCanvasPoint(point.x, point.y, context.rectangle);
  setCanvasCursorStyle(canvas, cursorStyleForRoiBoxHit(hit));
}

function setCanvasCursorStyle(canvas: HTMLCanvasElement, cursor: string): void {
  if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
}

function computeEditedRoiForPointerEvent(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  dragState: RoiBoxDragState,
  callbacks: RoiBoxEditCallbacks,
): ViewportRoi | null {
  const renderer = callbacks.getRenderer();
  const extents = callbacks.getImageExtents();
  if (!renderer || !extents) return null;
  const scale = computeCanvasPixelScaleForRenderer(renderer);
  if (!scale) return null;
  const point = extractCanvasPointFromPointerEvent(event, canvas);
  const offset = convertCanvasDeltaToImagePixelDelta(
    point.x - dragState.startPoint.x,
    point.y - dragState.startPoint.y,
    scale,
  );
  return applyRoiBoxDragToStartRoi(dragState, offset.offsetXPixels, offset.offsetYPixels, extents);
}

function applyRoiBoxDragToStartRoi(
  dragState: RoiBoxDragState,
  offsetXPixels: number,
  offsetYPixels: number,
  extents: ImagePixelExtents,
): ViewportRoi {
  if (dragState.mode === "move") {
    return moveViewportRoiByPixelOffsetClampedToImage(
      dragState.startRoi,
      offsetXPixels,
      offsetYPixels,
      extents,
    );
  }
  return resizeViewportRoiByDraggingCornerClampedToImage(
    dragState.startRoi,
    dragState.mode,
    offsetXPixels,
    offsetYPixels,
    extents,
  );
}

function commitRoiBoxEditOnRelease(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  dragState: RoiBoxDragState,
  callbacks: RoiBoxEditCallbacks,
): void {
  if (!dragState.active || event.pointerId !== dragState.pointerId) return;
  const finalRoi =
    computeEditedRoiForPointerEvent(event, canvas, dragState, callbacks) ??
    dragState.lastPreviewedRoi;
  const startRoi = dragState.startRoi;
  releaseRoiBoxPointerCaptureIfHeld(canvas, dragState.pointerId);
  resetRoiBoxDragState(dragState);
  callbacks.onPreviewRoiEdit(null);
  if (finalRoi && !areViewportRoisIdentical(finalRoi, startRoi)) callbacks.onCommitRoiEdit(finalRoi);
}

function discardRoiBoxEditWithoutCommitting(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  dragState: RoiBoxDragState,
  callbacks: RoiBoxEditCallbacks,
): void {
  if (!dragState.active || event.pointerId !== dragState.pointerId) return;
  releaseRoiBoxPointerCaptureIfHeld(canvas, dragState.pointerId);
  resetRoiBoxDragState(dragState);
  callbacks.onPreviewRoiEdit(null);
}

function resetRoiBoxDragState(dragState: RoiBoxDragState): void {
  dragState.active = false;
  dragState.pointerId = -1;
  dragState.lastPreviewedRoi = null;
}

function releaseRoiBoxPointerCaptureIfHeld(canvas: HTMLCanvasElement, pointerId: number): void {
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
}

function registerRoiBoxEditHandlersOnCanvas(
  canvas: HTMLCanvasElement,
  handlers: RoiBoxEditEventHandlers,
): void {
  canvas.addEventListener("pointerdown", handlers.pointerdown);
  canvas.addEventListener("pointermove", handlers.pointermove);
  canvas.addEventListener("pointerup", handlers.pointerup);
  canvas.addEventListener("pointercancel", handlers.pointercancel);
}

function unregisterRoiBoxEditHandlersFromCanvas(
  canvas: HTMLCanvasElement,
  handlers: RoiBoxEditEventHandlers,
): void {
  canvas.removeEventListener("pointerdown", handlers.pointerdown);
  canvas.removeEventListener("pointermove", handlers.pointermove);
  canvas.removeEventListener("pointerup", handlers.pointerup);
  canvas.removeEventListener("pointercancel", handlers.pointercancel);
}
