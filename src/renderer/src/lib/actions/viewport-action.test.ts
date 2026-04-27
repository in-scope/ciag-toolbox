import { describe, expect, it, vi } from "vitest";

import { TOGGLE_NORMALIZATION_ACTION } from "./registered-actions";
import {
  DEFAULT_VIEWPORT_RENDERING_STATE,
  applyActionToSelectedViewports,
  type ApplyActionCallbacks,
  type ViewportAction,
} from "./viewport-action";

describe("applyActionToSelectedViewports", () => {
  it("does nothing when the selection is empty", () => {
    const callbacks = createMockApplyActionCallbacks();
    applyActionToSelectedViewports(TOGGLE_NORMALIZATION_ACTION, new Set(), callbacks);
    expect(callbacks.getViewportRenderingState).not.toHaveBeenCalled();
    expect(callbacks.setViewportRenderingState).not.toHaveBeenCalled();
    expect(callbacks.reportApplyFailure).not.toHaveBeenCalled();
  });

  it("applies the action to every selected index in ascending order", () => {
    const callbacks = createMockApplyActionCallbacks();
    applyActionToSelectedViewports(TOGGLE_NORMALIZATION_ACTION, new Set([2, 0, 5]), callbacks);
    const writes = callbacks.setViewportRenderingState.mock.calls;
    expect(writes.map((call) => call[0])).toEqual([0, 2, 5]);
    for (const [, state] of writes) {
      expect(state.normalizationEnabled).toBe(true);
    }
  });

  it("catches a failure on one viewport but still applies to the rest", () => {
    const action = makeActionThatThrowsOnFirstApplyCall();
    const callbacks = createMockApplyActionCallbacks();
    applyActionToSelectedViewports(action, new Set([0, 1]), callbacks);
    expect(callbacks.reportApplyFailure).toHaveBeenCalledTimes(1);
    expect(callbacks.reportApplyFailure.mock.calls[0]![0].viewportIndex).toBe(0);
    expect(callbacks.setViewportRenderingState).toHaveBeenCalledTimes(1);
    expect(callbacks.setViewportRenderingState).toHaveBeenCalledWith(1, {
      normalizationEnabled: true,
    });
  });
});

describe("TOGGLE_NORMALIZATION_ACTION", () => {
  it("flips normalizationEnabled on apply", () => {
    expect(TOGGLE_NORMALIZATION_ACTION.apply({ normalizationEnabled: false })).toEqual({
      normalizationEnabled: true,
    });
    expect(TOGGLE_NORMALIZATION_ACTION.apply({ normalizationEnabled: true })).toEqual({
      normalizationEnabled: false,
    });
  });
});

interface MockApplyActionCallbacks extends ApplyActionCallbacks {
  getViewportRenderingState: ReturnType<typeof vi.fn>;
  setViewportRenderingState: ReturnType<typeof vi.fn>;
  reportApplyFailure: ReturnType<typeof vi.fn>;
}

function createMockApplyActionCallbacks(): MockApplyActionCallbacks {
  return {
    getViewportRenderingState: vi.fn(() => DEFAULT_VIEWPORT_RENDERING_STATE),
    setViewportRenderingState: vi.fn(),
    reportApplyFailure: vi.fn(),
  };
}

function makeActionThatThrowsOnFirstApplyCall(): ViewportAction {
  let invocations = 0;
  return {
    id: "throws-on-first-call",
    label: "Throws on First Call",
    apply: (state) => {
      invocations += 1;
      if (invocations === 1) throw new Error("boom");
      return { ...state, normalizationEnabled: !state.normalizationEnabled };
    },
  };
}
