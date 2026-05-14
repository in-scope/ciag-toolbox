import { describe, expect, it, vi } from "vitest";

import type { ViewportCellContent } from "@/components/viewport-grid";
import { EMPTY_PINNED_SPECTRA } from "@/lib/image/spectrum-entry";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import {
  applyActionInPlaceAtSourceIndex,
  runDuplicateAndApplyAtTargetIndex,
  type ApplyActionFlowBindings,
} from "./apply-action-flow";
import {
  EMPTY_OPERATION_HISTORY,
  type ViewportOperationHistory,
} from "./operation-history";
import { NO_PARAMETER_VALUES } from "./parameter-schema";
import type { RegisteredViewportAction } from "./registered-actions";
import {
  DEFAULT_VIEWPORT_RENDERING_STATE,
  EMPTY_REMOVED_BAND_INDEXES,
  type ViewportRenderingState,
} from "./viewport-action";
import type { ViewportRoi } from "@/lib/image/viewport-roi";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("runDuplicateAndApplyAtTargetIndex", () => {
  it("inherits the source viewport's operation history when duplicating to a new viewport", async () => {
    const sourcePriorHistory = buildHistoryWithEntries(["normalize", "bit-shift"]);
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory });
    await runDuplicateAndApplyAtTargetIndex(
      buildNormalizeAction(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    const targetWrite = harness.findLatestRenderingStateWriteAtIndex(TARGET_INDEX);
    expect(targetWrite.operationHistory.map((entry) => entry.actionId)).toEqual([
      "normalize",
      "bit-shift",
      "normalize",
    ]);
  });

  it("does not modify the source viewport's history when duplicating", async () => {
    const sourcePriorHistory = buildHistoryWithEntries(["normalize"]);
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory });
    await runDuplicateAndApplyAtTargetIndex(
      buildNormalizeAction(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(harness.bindings.setRenderingState).not.toHaveBeenCalledWith(
      SOURCE_INDEX,
      expect.anything(),
    );
  });
});

describe("runDuplicateAndApplyAtTargetIndex with clearConsumedSourceStateAfterApply", () => {
  it("clears consumed source state on the source viewport in the duplicate flow", async () => {
    const sourcePriorHistory = buildHistoryWithEntries(["normalize"]);
    const sampleRoi = buildSampleRoi();
    const harness = buildDuplicateFlowHarnessWithSourceRoi({ sourcePriorHistory, sourceRoi: sampleRoi });
    await runDuplicateAndApplyAtTargetIndex(
      buildCropLikeActionThatClearsSourceRoi(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    const sourceWrite = harness.findLatestRenderingStateWriteAtIndex(SOURCE_INDEX);
    expect(sourceWrite.roi).toBeNull();
    expect(sourceWrite.operationHistory.map((entry) => entry.actionId)).toEqual(["normalize"]);
  });

  it("does not write source state when sourceIndex equals targetIndex (in-place via duplicate path)", async () => {
    const sourcePriorHistory = buildHistoryWithEntries([]);
    const harness = buildDuplicateFlowHarnessWithSourceRoi({
      sourcePriorHistory,
      sourceRoi: buildSampleRoi(),
    });
    await runDuplicateAndApplyAtTargetIndex(
      buildCropLikeActionThatClearsSourceRoi(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      SOURCE_INDEX,
      harness.bindings,
    );
    const setRenderingStateMock = harness.bindings.setRenderingState as unknown as {
      mock: { calls: ReadonlyArray<[number, ViewportRenderingState]> };
    };
    const sourceWrites = setRenderingStateMock.mock.calls.filter(
      ([index]) => index === SOURCE_INDEX,
    );
    expect(sourceWrites).toHaveLength(1);
  });
});

describe("applyActionInPlaceAtSourceIndex", () => {
  it("appends a new history entry to the source's existing history", () => {
    const sourcePriorHistory = buildHistoryWithEntries(["bit-shift"]);
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory });
    applyActionInPlaceAtSourceIndex(
      buildNormalizeAction(),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    const sourceWrite = harness.findLatestRenderingStateWriteAtIndex(SOURCE_INDEX);
    expect(sourceWrite.operationHistory.map((entry) => entry.actionId)).toEqual([
      "bit-shift",
      "normalize",
    ]);
  });
});

const SOURCE_INDEX = 0;
const TARGET_INDEX = 1;

interface DuplicateFlowHarness {
  readonly bindings: ApplyActionFlowBindings;
  readonly findLatestRenderingStateWriteAtIndex: (index: number) => ViewportRenderingState;
}

interface DuplicateFlowHarnessOptions {
  readonly sourcePriorHistory: ViewportOperationHistory;
}

function buildDuplicateFlowHarness(options: DuplicateFlowHarnessOptions): DuplicateFlowHarness {
  const renderingByIndex = new Map<number, ViewportRenderingState>([
    [SOURCE_INDEX, buildRenderingStateWithHistory(options.sourcePriorHistory)],
  ]);
  const setRenderingState = vi.fn(
    (index: number, next: ViewportRenderingState) => renderingByIndex.set(index, next),
  );
  const bindings = buildBindingsBackedByMaps(renderingByIndex, setRenderingState);
  return { bindings, findLatestRenderingStateWriteAtIndex: (i) => readLatestWrite(setRenderingState, i) };
}

function buildBindingsBackedByMaps(
  renderingByIndex: Map<number, ViewportRenderingState>,
  setRenderingState: ApplyActionFlowBindings["setRenderingState"],
): ApplyActionFlowBindings {
  const imagesByIndex = new Map<number, ViewportCellContent>([
    [SOURCE_INDEX, buildSinglePixelCellContent()],
  ]);
  return {
    gridLayout: "1x2",
    cellCount: 2,
    imagesByIndex,
    setGridLayout: vi.fn(),
    setImagesByIndex: vi.fn((updater) => updater(imagesByIndex)),
    setPendingDuplicate: vi.fn(),
    getRenderingState: (index) =>
      renderingByIndex.get(index) ?? DEFAULT_VIEWPORT_RENDERING_STATE,
    setRenderingState,
    busyRegistrar: buildNoopBusyEntryRegistrarForTests(),
  };
}

function buildNoopBusyEntryRegistrarForTests(): ApplyActionFlowBindings["busyRegistrar"] {
  const noopHandle = { id: "test", update: () => undefined, clear: () => undefined };
  return {
    registerAppBusyEntry: () => noopHandle,
    registerViewportBusyEntry: () => noopHandle,
  };
}

function readLatestWrite(
  setRenderingState: ApplyActionFlowBindings["setRenderingState"],
  index: number,
): ViewportRenderingState {
  const mock = setRenderingState as unknown as { mock: { calls: ReadonlyArray<[number, ViewportRenderingState]> } };
  const matching = mock.mock.calls.filter(([writtenIndex]) => writtenIndex === index);
  const last = matching[matching.length - 1];
  if (!last) throw new Error(`Expected a setRenderingState write at index ${index}`);
  return last[1];
}

function buildRenderingStateWithHistory(
  history: ViewportOperationHistory,
): ViewportRenderingState {
  return {
    normalizationEnabled: false,
    lastAppliedOperationLabel: null,
    selectedBandIndex: 0,
    operationHistory: history,
    roi: null,
    pinnedSpectra: EMPTY_PINNED_SPECTRA,
    removedBandIndexes: EMPTY_REMOVED_BAND_INDEXES,
    isBandSubsetEditModeActive: false,
  };
}

function buildHistoryWithEntries(actionIds: ReadonlyArray<string>): ViewportOperationHistory {
  return actionIds.map((id, index) => ({
    actionId: id,
    actionLabel: id,
    appliedLabel: id,
    parameterValues: {},
    timestampMs: 1_000 + index,
  }));
}

function buildNormalizeAction(): RegisteredViewportAction {
  return {
    id: "normalize",
    label: "Normalize",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Normalized",
    apply: (state: ViewportRenderingState) => ({ ...state, normalizationEnabled: true }),
  } as unknown as RegisteredViewportAction;
}

function buildSinglePixelCellContent(): ViewportCellContent {
  return {
    fileName: "test.png",
    source: buildSinglePixelSource(),
    fileSizeBytes: 4,
  };
}

function buildSinglePixelSource(): ViewportImageSource {
  return {
    kind: "pixels",
    pixels: new Uint8ClampedArray([0, 0, 0, 255]),
    width: 1,
    height: 1,
  };
}

interface DuplicateFlowHarnessWithRoiOptions {
  readonly sourcePriorHistory: ViewportOperationHistory;
  readonly sourceRoi: ViewportRoi;
}

function buildDuplicateFlowHarnessWithSourceRoi(
  options: DuplicateFlowHarnessWithRoiOptions,
): DuplicateFlowHarness {
  const initialSource = {
    ...buildRenderingStateWithHistory(options.sourcePriorHistory),
    roi: options.sourceRoi,
  };
  const renderingByIndex = new Map<number, ViewportRenderingState>([[SOURCE_INDEX, initialSource]]);
  const setRenderingState = vi.fn((index: number, next: ViewportRenderingState) =>
    renderingByIndex.set(index, next),
  );
  const bindings = buildBindingsBackedByMaps(renderingByIndex, setRenderingState);
  return {
    bindings,
    findLatestRenderingStateWriteAtIndex: (i) => readLatestWrite(setRenderingState, i),
  };
}

function buildSampleRoi(): ViewportRoi {
  return { imagePixelX0: 1, imagePixelY0: 2, imagePixelX1: 4, imagePixelY1: 6 };
}

function buildCropLikeActionThatClearsSourceRoi(): RegisteredViewportAction {
  return {
    id: "crop-like",
    label: "Crop Like",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Cropped",
    apply: (state: ViewportRenderingState) => ({ ...state, roi: null }),
    clearConsumedSourceStateAfterApply: (state: ViewportRenderingState) => ({
      ...state,
      roi: null,
    }),
  } as unknown as RegisteredViewportAction;
}

void EMPTY_OPERATION_HISTORY;
