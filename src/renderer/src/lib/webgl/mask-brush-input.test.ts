import { describe, expect, it, vi } from "vitest";

import { attachMaskBrushEventHandlers } from "./mask-brush-input";

describe("attachMaskBrushEventHandlers", () => {
  it("reports a stroke as begin, one segment per move, then commit", () => {
    const harness = buildMaskBrushTestHarness();
    harness.fireRegisteredHandler("pointerdown", buildPointerEvent(4, 4));
    harness.fireRegisteredHandler("pointermove", buildPointerEvent(9, 4));
    harness.fireRegisteredHandler("pointerup", buildPointerEvent(9, 4));
    expect(harness.callbacks.onStrokeBegin).toHaveBeenCalledWith({ x: 4, y: 4 });
    expect(harness.callbacks.onStrokeExtend).toHaveBeenNthCalledWith(1, {
      from: { x: 4, y: 4 },
      to: { x: 9, y: 4 },
    });
    expect(harness.callbacks.onStrokeCommit).toHaveBeenCalledTimes(1);
  });

  it("claims the gesture so no pan or region draw starts under it", () => {
    const harness = buildMaskBrushTestHarness();
    const event = buildPointerEvent(4, 4);
    harness.fireRegisteredHandler("pointerdown", event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
  });

  it("ignores pointer events while painting is disabled", () => {
    const harness = buildMaskBrushTestHarness();
    harness.callbacks.isMaskPaintingEnabled.mockReturnValue(false);
    harness.fireRegisteredHandler("pointerdown", buildPointerEvent(4, 4));
    harness.fireRegisteredHandler("pointerup", buildPointerEvent(9, 4));
    expect(harness.callbacks.onStrokeBegin).not.toHaveBeenCalled();
    expect(harness.callbacks.onStrokeCommit).not.toHaveBeenCalled();
  });

  it("extends the stroke to the release point before committing", () => {
    const harness = buildMaskBrushTestHarness();
    harness.fireRegisteredHandler("pointerdown", buildPointerEvent(0, 0));
    harness.fireRegisteredHandler("pointerup", buildPointerEvent(3, 7));
    expect(harness.callbacks.onStrokeExtend).toHaveBeenLastCalledWith({
      from: { x: 0, y: 0 },
      to: { x: 3, y: 7 },
    });
  });

  it("cancels rather than commits when the pointer is cancelled", () => {
    const harness = buildMaskBrushTestHarness();
    harness.fireRegisteredHandler("pointerdown", buildPointerEvent(1, 1));
    harness.fireRegisteredHandler("pointercancel", buildPointerEvent(1, 1));
    expect(harness.callbacks.onStrokeCancel).toHaveBeenCalledTimes(1);
    expect(harness.callbacks.onStrokeCommit).not.toHaveBeenCalled();
  });

  it("cancelInProgressStroke drops an active stroke and is a no-op otherwise", () => {
    const harness = buildMaskBrushTestHarness();
    harness.attachment.cancelInProgressStroke();
    expect(harness.callbacks.onStrokeCancel).not.toHaveBeenCalled();
    harness.fireRegisteredHandler("pointerdown", buildPointerEvent(2, 2));
    harness.attachment.cancelInProgressStroke();
    expect(harness.callbacks.onStrokeCancel).toHaveBeenCalledTimes(1);
    harness.fireRegisteredHandler("pointerup", buildPointerEvent(2, 2));
    expect(harness.callbacks.onStrokeCommit).not.toHaveBeenCalled();
  });

  it("detach removes every pointer listener from the canvas", () => {
    const harness = buildMaskBrushTestHarness();
    harness.attachment.detach();
    expect(harness.canvas.registeredHandlerCount()).toBe(0);
  });
});

interface MaskBrushTestHarness {
  readonly canvas: FakeCanvas;
  readonly attachment: ReturnType<typeof attachMaskBrushEventHandlers>;
  readonly callbacks: {
    readonly isMaskPaintingEnabled: ReturnType<typeof vi.fn>;
    readonly onStrokeBegin: ReturnType<typeof vi.fn>;
    readonly onStrokeExtend: ReturnType<typeof vi.fn>;
    readonly onStrokeCommit: ReturnType<typeof vi.fn>;
    readonly onStrokeCancel: ReturnType<typeof vi.fn>;
  };
  readonly fireRegisteredHandler: (type: string, event: object) => void;
}

function buildMaskBrushTestHarness(): MaskBrushTestHarness {
  const canvas = createFakeCanvasWithRectAndPointerCapture();
  const callbacks = {
    isMaskPaintingEnabled: vi.fn(() => true),
    onStrokeBegin: vi.fn(),
    onStrokeExtend: vi.fn(),
    onStrokeCommit: vi.fn(),
    onStrokeCancel: vi.fn(),
  };
  const attachment = attachMaskBrushEventHandlers(canvas as unknown as HTMLCanvasElement, callbacks);
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
    addEventListener: (type, handler) => registerHandlerInMap(handlersByType, type, handler),
    removeEventListener: (type, handler) => unregisterHandlerFromMap(handlersByType, type, handler),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    fireRegisteredHandler: (type, event) => fireAllHandlersForType(handlersByType, type, event),
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

interface FakePointerEvent {
  readonly pointerId: number;
  readonly button: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly preventDefault: ReturnType<typeof vi.fn>;
  readonly stopImmediatePropagation: ReturnType<typeof vi.fn>;
}

function buildPointerEvent(clientX: number, clientY: number): FakePointerEvent {
  return {
    pointerId: 1,
    button: 0,
    clientX,
    clientY,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
}
