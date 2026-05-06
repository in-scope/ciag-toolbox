import { describe, expect, it, vi } from "vitest";

import { EMPTY_PINNED_SPECTRA } from "@/lib/image/spectrum-entry";

import { EMPTY_OPERATION_HISTORY } from "./operation-history";
import { NO_PARAMETER_VALUES } from "./parameter-schema";
import { NORMALIZE_ACTION } from "./registered-actions";
import {
  DEFAULT_VIEWPORT_RENDERING_STATE,
  applyActionToSelectedViewports,
  type ApplyActionCallbacks,
  type ViewportAction,
} from "./viewport-action";

describe("applyActionToSelectedViewports", () => {
  it("does nothing when the selection is empty", () => {
    const callbacks = createMockApplyActionCallbacks();
    applyActionToSelectedViewports(NORMALIZE_ACTION, NO_PARAMETER_VALUES, new Set(), callbacks);
    expect(callbacks.getViewportRenderingState).not.toHaveBeenCalled();
    expect(callbacks.setViewportRenderingState).not.toHaveBeenCalled();
    expect(callbacks.reportApplyFailure).not.toHaveBeenCalled();
  });

  it("applies the action to every selected index in ascending order", () => {
    const callbacks = createMockApplyActionCallbacks();
    applyActionToSelectedViewports(
      NORMALIZE_ACTION,
      NO_PARAMETER_VALUES,
      new Set([2, 0, 5]),
      callbacks,
    );
    const writes = callbacks.setViewportRenderingState.mock.calls;
    expect(writes.map((call) => call[0])).toEqual([0, 2, 5]);
    for (const [, state] of writes) {
      expect(state.normalizationEnabled).toBe(true);
    }
  });

  it("catches a failure on one viewport but still applies to the rest", () => {
    const action = makeActionThatThrowsOnFirstApplyCall();
    const callbacks = createMockApplyActionCallbacks();
    applyActionToSelectedViewports(action, NO_PARAMETER_VALUES, new Set([0, 1]), callbacks);
    expect(callbacks.reportApplyFailure).toHaveBeenCalledTimes(1);
    expect(callbacks.reportApplyFailure.mock.calls[0]![0].viewportIndex).toBe(0);
    expect(callbacks.setViewportRenderingState).toHaveBeenCalledTimes(1);
    expect(callbacks.setViewportRenderingState).toHaveBeenCalledWith(1, {
      normalizationEnabled: true,
      lastAppliedOperationLabel: null,
      selectedBandIndex: 0,
      operationHistory: EMPTY_OPERATION_HISTORY,
      roi: null,
      pinnedSpectra: EMPTY_PINNED_SPECTRA,
    });
  });

  it("forwards parameter values into action.apply", () => {
    const apply = vi.fn((state, _params) => state);
    const action: ViewportAction = { id: "param-action", label: "Param Action", apply };
    const parameterValues = Object.freeze({ shift: 4 });
    const callbacks = createMockApplyActionCallbacks();
    applyActionToSelectedViewports(action, parameterValues, new Set([0]), callbacks);
    expect(apply).toHaveBeenCalledWith(DEFAULT_VIEWPORT_RENDERING_STATE, parameterValues);
  });
});

describe("NORMALIZE_ACTION", () => {
  it("enables normalization regardless of the previous state", () => {
    expect(
      NORMALIZE_ACTION.apply(
        {
          normalizationEnabled: false,
          lastAppliedOperationLabel: null,
          selectedBandIndex: 0,
          operationHistory: EMPTY_OPERATION_HISTORY,
          roi: null,
          pinnedSpectra: EMPTY_PINNED_SPECTRA,
        },
        NO_PARAMETER_VALUES,
      ),
    ).toEqual({
      normalizationEnabled: true,
      lastAppliedOperationLabel: null,
      selectedBandIndex: 0,
      operationHistory: EMPTY_OPERATION_HISTORY,
      roi: null,
      pinnedSpectra: EMPTY_PINNED_SPECTRA,
    });
    expect(
      NORMALIZE_ACTION.apply(
        {
          normalizationEnabled: true,
          lastAppliedOperationLabel: null,
          selectedBandIndex: 0,
          operationHistory: EMPTY_OPERATION_HISTORY,
          roi: null,
          pinnedSpectra: EMPTY_PINNED_SPECTRA,
        },
        NO_PARAMETER_VALUES,
      ),
    ).toEqual({
      normalizationEnabled: true,
      lastAppliedOperationLabel: null,
      selectedBandIndex: 0,
      operationHistory: EMPTY_OPERATION_HISTORY,
      roi: null,
      pinnedSpectra: EMPTY_PINNED_SPECTRA,
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
      return { ...state, normalizationEnabled: true };
    },
  };
}
