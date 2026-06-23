import { describe, expect, it, vi } from "vitest";

import {
  EMPTY_PINNED_ROI_SPECTRA,
  EMPTY_PINNED_SPECTRA,
} from "@/lib/image/spectrum-entry";

import { EMPTY_OPERATION_HISTORY } from "./operation-history";
import { NO_PARAMETER_VALUES } from "./parameter-schema";
import {
  DEFAULT_VIEWPORT_RENDERING_STATE,
  applyActionToSelectedViewports,
  clearToneCurveEditingState,
  hasToneCurveEditingState,
  type ApplyActionCallbacks,
  type ViewportAction,
} from "./viewport-action";

function buildSampleEnableFlagAction(): ViewportAction {
  return {
    id: "sample-enable-flag",
    label: "Sample Enable Flag",
    apply: (state) => ({ ...state, normalizationEnabled: true }),
  };
}

describe("applyActionToSelectedViewports", () => {
  it("does nothing when the selection is empty", () => {
    const callbacks = createMockApplyActionCallbacks();
    applyActionToSelectedViewports(
      buildSampleEnableFlagAction(),
      NO_PARAMETER_VALUES,
      new Set(),
      callbacks,
    );
    expect(callbacks.getViewportRenderingState).not.toHaveBeenCalled();
    expect(callbacks.setViewportRenderingState).not.toHaveBeenCalled();
    expect(callbacks.reportApplyFailure).not.toHaveBeenCalled();
  });

  it("applies the action to every selected index in ascending order", () => {
    const callbacks = createMockApplyActionCallbacks();
    applyActionToSelectedViewports(
      buildSampleEnableFlagAction(),
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
      floatDisplayUsesFixedUnitWindow: false,
      lastAppliedOperationLabel: null,
      selectedBandIndex: 0,
      operationHistory: EMPTY_OPERATION_HISTORY,
      roi: null,
      operationRegion: null,
      toneCurveAnchors: null,
      toneCurveChannelAnchors: {},
      toneCurveActiveChannel: "rgb",
      pinnedSpectra: EMPTY_PINNED_SPECTRA,
      pinnedRoiSpectra: EMPTY_PINNED_ROI_SPECTRA,
      removedBandIndexes: [],
      isBandSubsetEditModeActive: false,
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

describe("tone-curve editing state helpers", () => {
  it("reports no editing state for a default rendering state", () => {
    expect(hasToneCurveEditingState(DEFAULT_VIEWPORT_RENDERING_STATE)).toBe(false);
  });

  it("reports editing state once anchors, a non-default channel, or stored channels exist", () => {
    const withAnchors = { ...DEFAULT_VIEWPORT_RENDERING_STATE, toneCurveAnchors: [] };
    const withChannel = { ...DEFAULT_VIEWPORT_RENDERING_STATE, toneCurveActiveChannel: "red" as const };
    const withStash = { ...DEFAULT_VIEWPORT_RENDERING_STATE, toneCurveChannelAnchors: { red: [] } };
    expect(hasToneCurveEditingState(withAnchors)).toBe(true);
    expect(hasToneCurveEditingState(withChannel)).toBe(true);
    expect(hasToneCurveEditingState(withStash)).toBe(true);
  });

  it("clears anchors, stored channels, and the active channel back to defaults", () => {
    const dirty = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      toneCurveAnchors: [{ input: 1, output: 2 }],
      toneCurveChannelAnchors: { red: [{ input: 1, output: 2 }] },
      toneCurveActiveChannel: "blue" as const,
    };
    const cleared = clearToneCurveEditingState(dirty);
    expect(hasToneCurveEditingState(cleared)).toBe(false);
    expect(cleared.toneCurveActiveChannel).toBe("rgb");
  });
});

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
