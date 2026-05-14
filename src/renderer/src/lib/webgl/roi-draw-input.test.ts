import { describe, expect, it, vi } from "vitest";

import { attachRoiDrawEventHandlers } from "./roi-draw-input";

describe("attachRoiDrawEventHandlers", () => {
  it("returns a controller exposing detach and cancelInProgressDrag", () => {
    const harness = buildRoiDrawTestHarness();
    expect(typeof harness.attachment.detach).toBe("function");
    expect(typeof harness.attachment.cancelInProgressDrag).toBe("function");
  });

  it("cancelInProgressDrag clears the in-progress rect when a drag is active", () => {
    const harness = buildRoiDrawTestHarness();
    harness.fireRegisteredHandler("pointerdown", buildPrimaryButtonPointerEvent({ clientX: 5, clientY: 7 }));
    harness.fireRegisteredHandler("pointermove", buildPrimaryButtonPointerEvent({ clientX: 25, clientY: 27 }));
    expect(harness.callbacks.onDragStateChange).toHaveBeenLastCalledWith({
      start: { x: 5, y: 7 },
      current: { x: 25, y: 27 },
    });
    harness.attachment.cancelInProgressDrag();
    expect(harness.callbacks.onDragStateChange).toHaveBeenLastCalledWith(null);
  });

  it("cancelInProgressDrag is a no-op when no drag is active", () => {
    const harness = buildRoiDrawTestHarness();
    harness.attachment.cancelInProgressDrag();
    expect(harness.callbacks.onDragStateChange).not.toHaveBeenCalled();
  });

  it("after cancelInProgressDrag, a subsequent pointerup does not commit a ROI", () => {
    const harness = buildRoiDrawTestHarness();
    harness.fireRegisteredHandler("pointerdown", buildPrimaryButtonPointerEvent({ clientX: 5, clientY: 7 }));
    harness.attachment.cancelInProgressDrag();
    harness.callbacks.onDragStateChange.mockClear();
    harness.fireRegisteredHandler("pointerup", buildPrimaryButtonPointerEvent({ clientX: 25, clientY: 27 }));
    expect(harness.callbacks.onDragCommit).not.toHaveBeenCalled();
  });

  it("detach removes pointer event listeners from the canvas", () => {
    const harness = buildRoiDrawTestHarness();
    harness.attachment.detach();
    expect(harness.canvas.registeredHandlerCount()).toBe(0);
  });
});

interface RoiDrawTestHarness {
  readonly canvas: FakeCanvas;
  readonly attachment: ReturnType<typeof attachRoiDrawEventHandlers>;
  readonly callbacks: {
    readonly isRoiDrawingEnabled: ReturnType<typeof vi.fn>;
    readonly onDragStateChange: ReturnType<typeof vi.fn>;
    readonly onDragCommit: ReturnType<typeof vi.fn>;
  };
  readonly fireRegisteredHandler: (type: string, event: object) => void;
}

function buildRoiDrawTestHarness(): RoiDrawTestHarness {
  const canvas = createFakeCanvasWithRectAndPointerCapture();
  const callbacks = {
    isRoiDrawingEnabled: vi.fn(() => true),
    onDragStateChange: vi.fn(),
    onDragCommit: vi.fn(),
  };
  const attachment = attachRoiDrawEventHandlers(canvas as unknown as HTMLCanvasElement, callbacks);
  return {
    canvas,
    attachment,
    callbacks,
    fireRegisteredHandler: (type, event) => canvas.fireRegisteredHandler(type, event),
  };
}

interface FakeCanvas {
  addEventListener: (type: string, handler: (event: object) => void) => void;
  removeEventListener: (type: string, handler: (event: object) => void) => void;
  getBoundingClientRect: () => { left: number; top: number };
  setPointerCapture: (pointerId: number) => void;
  releasePointerCapture: (pointerId: number) => void;
  hasPointerCapture: (pointerId: number) => boolean;
  fireRegisteredHandler: (type: string, event: object) => void;
  registeredHandlerCount: () => number;
}

function createFakeCanvasWithRectAndPointerCapture(): FakeCanvas {
  const handlersByType = new Map<string, Set<(event: object) => void>>();
  return {
    addEventListener: (type, handler) =>
      registerHandlerInMap(handlersByType, type, handler),
    removeEventListener: (type, handler) =>
      unregisterHandlerFromMap(handlersByType, type, handler),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    fireRegisteredHandler: (type, event) =>
      fireAllHandlersForType(handlersByType, type, event),
    registeredHandlerCount: () => countAllHandlersInMap(handlersByType),
  };
}

function registerHandlerInMap(
  map: Map<string, Set<(event: object) => void>>,
  type: string,
  handler: (event: object) => void,
): void {
  const existing = map.get(type) ?? new Set<(event: object) => void>();
  existing.add(handler);
  map.set(type, existing);
}

function unregisterHandlerFromMap(
  map: Map<string, Set<(event: object) => void>>,
  type: string,
  handler: (event: object) => void,
): void {
  map.get(type)?.delete(handler);
}

function fireAllHandlersForType(
  map: Map<string, Set<(event: object) => void>>,
  type: string,
  event: object,
): void {
  const handlers = map.get(type);
  if (!handlers) return;
  for (const handler of handlers) handler(event);
}

function countAllHandlersInMap(map: Map<string, Set<(event: object) => void>>): number {
  let total = 0;
  for (const handlers of map.values()) total += handlers.size;
  return total;
}

function buildPrimaryButtonPointerEvent(extras: { clientX: number; clientY: number }): object {
  return {
    pointerId: 1,
    button: 0,
    clientX: extras.clientX,
    clientY: extras.clientY,
    preventDefault: () => undefined,
    stopImmediatePropagation: () => undefined,
  };
}
