import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import type { ViewportCellContent } from "@/components/viewport-grid";
import {
  EMPTY_PINNED_ROI_SPECTRA,
  EMPTY_PINNED_SPECTRA,
} from "@/lib/image/spectrum-entry";
import { buildErrorToastOptions } from "@/lib/notifications/toast-options";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import {
  applyActionInPlaceAtSourceIndex,
  applyActionToDuplicateOfSource,
  runDuplicateAndApplyAtTargetIndex,
  type ApplyActionFlowBindings,
} from "./apply-action-flow";
import {
  EMPTY_OPERATION_HISTORY,
  type ViewportOperationHistory,
} from "./operation-history";
import type { RasterImage } from "@/lib/image/raster-image";

import { NO_PARAMETER_VALUES, type ParameterValuesById } from "./parameter-schema";
import { INVERT_ACTION, type RegisteredViewportAction } from "./registered-actions";
import {
  DEFAULT_VIEWPORT_RENDERING_STATE,
  EMPTY_REMOVED_BAND_INDEXES,
  EMPTY_TONE_CURVE_CHANNEL_ANCHORS,
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

describe("runDuplicateAndApplyAtTargetIndex selecting the result panel (CT-105)", () => {
  it("selects the new target panel after placing the result", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    const selectViewportIndex = vi.fn();
    await runDuplicateAndApplyAtTargetIndex(
      buildNormalizeAction(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      { ...harness.bindings, selectViewportIndex },
    );
    expect(selectViewportIndex).toHaveBeenCalledWith(TARGET_INDEX);
  });

  it("does not select a panel when the duplicate apply fails", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    const selectViewportIndex = vi.fn();
    await runDuplicateAndApplyAtTargetIndex(
      buildActionThatThrowsOnTransform(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      { ...harness.bindings, selectViewportIndex },
    );
    expect(selectViewportIndex).not.toHaveBeenCalled();
  });
});

describe("runDuplicateAndApplyAtTargetIndex result-panel loading state (CT-106)", () => {
  it("registers an immediate, operation-specific loading entry for a new empty result panel", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    const records: RecordedBusyEntryInput[] = [];
    await runDuplicateAndApplyAtTargetIndex(
      buildNormalizeActionThatTransforms(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      { ...harness.bindings, busyRegistrar: buildRecordingBusyEntryRegistrar(records) },
    );
    expect(records).toContainEqual({
      viewportIndex: TARGET_INDEX,
      label: "Normalizing...",
      immediate: true,
    });
  });

  it("defers the loading entry (not immediate) when the result overwrites an occupied panel", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    const records: RecordedBusyEntryInput[] = [];
    await runDuplicateAndApplyAtTargetIndex(
      buildNormalizeActionThatTransforms(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      SOURCE_INDEX,
      { ...harness.bindings, busyRegistrar: buildRecordingBusyEntryRegistrar(records) },
    );
    expect(records).toContainEqual({
      viewportIndex: SOURCE_INDEX,
      label: "Normalizing...",
      immediate: false,
    });
  });
});

describe("runDuplicateAndApplyAtTargetIndex with transformSourceToSecondaryOutputs", () => {
  it("places each secondary output in its own fresh viewport with its own label and history", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    await runDuplicateAndApplyAtTargetIndex(
      buildInvertLikeActionWithSecondaryOutput(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    const secondaryWrite = harness.findLatestRenderingStateWriteAtIndex(SECONDARY_OUTPUT_INDEX);
    expect(secondaryWrite.lastAppliedOperationLabel).toBe("Normalize to [0,1] (auto for invert)");
    expect(secondaryWrite.operationHistory.map((entry) => entry.appliedLabel)).toEqual([
      "Normalize to [0,1] (auto for invert)",
    ]);
  });

  it("leaves the source viewport untouched while emitting a secondary output", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    await runDuplicateAndApplyAtTargetIndex(
      buildInvertLikeActionWithSecondaryOutput(),
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

describe("applyActionToDuplicateOfSource with assertCanApplyToSource (CT-190)", () => {
  it("opens no panel and writes no rendering state when the source is unappliable", () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    vi.mocked(toast.error).mockClear();
    applyActionToDuplicateOfSource(
      buildActionThatRejectsSource(),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    expect(harness.bindings.setImagesByIndex).not.toHaveBeenCalled();
    expect(harness.bindings.setRenderingState).not.toHaveBeenCalled();
    expect(harness.bindings.setGridLayout).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Reject Source failed: not appliable",
      buildErrorToastOptions(),
    );
  });
});

const SOURCE_INDEX = 0;
const TARGET_INDEX = 1;
const SECONDARY_OUTPUT_INDEX = 2;

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
    floatDisplayUsesFixedUnitWindow: false,
    viewChannelsSeparately: false,
    lastAppliedOperationLabel: null,
    selectedBandIndex: 0,
    operationHistory: history,
    roi: null,
    operationRegion: null,
    toneCurveAnchors: null,
    toneCurveChannelAnchors: EMPTY_TONE_CURVE_CHANNEL_ANCHORS,
    toneCurveActiveChannel: "rgb",
    thresholdBounds: null,
    thresholdOtsuCutoffs: null,
    bandWeights: null,
    bandSelection: null,
    cubeTransform: null,
    pinnedSpectra: EMPTY_PINNED_SPECTRA,
    pinnedRoiSpectra: EMPTY_PINNED_ROI_SPECTRA,
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

interface RecordedBusyEntryInput {
  readonly viewportIndex: number;
  readonly label: string;
  readonly immediate: boolean;
}

function buildRecordingBusyEntryRegistrar(
  records: RecordedBusyEntryInput[],
): ApplyActionFlowBindings["busyRegistrar"] {
  const noopHandle = { id: "test", update: () => undefined, clear: () => undefined };
  return {
    registerAppBusyEntry: () => noopHandle,
    registerViewportBusyEntry: (input) => {
      records.push({
        viewportIndex: input.viewportIndex,
        label: input.label,
        immediate: input.immediate ?? false,
      });
      return noopHandle;
    },
  };
}

function buildNormalizeActionThatTransforms(): RegisteredViewportAction {
  return {
    id: "normalize-data",
    label: "Normalize",
    loadingMessage: "Normalizing...",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Normalized",
    apply: (state: ViewportRenderingState) => state,
    transformSource: () => buildSinglePixelSource(),
  } as unknown as RegisteredViewportAction;
}

function buildInvertLikeActionWithSecondaryOutput(): RegisteredViewportAction {
  return {
    id: "invert",
    label: "Invert",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Invert",
    apply: (state: ViewportRenderingState) => state,
    transformSource: () => buildSinglePixelSource(),
    transformSourceToSecondaryOutputs: () => [
      { source: buildSinglePixelSource(), appliedLabel: "Normalize to [0,1] (auto for invert)" },
    ],
  } as unknown as RegisteredViewportAction;
}

function buildActionThatThrowsOnTransform(): RegisteredViewportAction {
  return {
    id: "throws",
    label: "Throws",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Throws",
    apply: (state: ViewportRenderingState) => state,
    transformSource: () => {
      throw new Error("boom");
    },
  } as unknown as RegisteredViewportAction;
}

function buildActionThatRejectsSource(): RegisteredViewportAction {
  return {
    id: "reject-source",
    label: "Reject Source",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Rejected",
    apply: (state: ViewportRenderingState) => state,
    transformSource: () => buildSinglePixelSource(),
    assertCanApplyToSource: () => {
      throw new Error("not appliable");
    },
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

describe("transform progress reaching the busy entry (CT-221)", () => {
  it("forwards transformSourceAsync progress ticks to the busy entry as progress updates", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    const progressUpdates: number[] = [];
    const bindings = {
      ...harness.bindings,
      busyRegistrar: buildProgressRecordingBusyEntryRegistrar(progressUpdates),
    };
    await runDuplicateAndApplyAtTargetIndex(
      buildActionReportingTransformProgress([0, 0.5, 1]),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      bindings,
    );
    expect(progressUpdates).toEqual([0, 0.5, 1]);
  });
});

function buildProgressRecordingBusyEntryRegistrar(
  progressUpdates: number[],
): ApplyActionFlowBindings["busyRegistrar"] {
  const handle = {
    id: "test",
    update: (next: { progress?: number | null }) => {
      if (typeof next.progress === "number") progressUpdates.push(next.progress);
    },
    clear: () => undefined,
  };
  return { registerAppBusyEntry: () => handle, registerViewportBusyEntry: () => handle };
}

function buildActionReportingTransformProgress(
  ticks: ReadonlyArray<number>,
): RegisteredViewportAction {
  return {
    id: "progressive",
    label: "Progressive",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Progressive",
    apply: (state: ViewportRenderingState) => state,
    transformSourceAsync: async (
      _source: ViewportImageSource,
      _parameterValues: unknown,
      onProgress?: (fraction: number) => void,
    ) => {
      for (const tick of ticks) onProgress?.(tick);
      return buildSinglePixelSource();
    },
  } as unknown as RegisteredViewportAction;
}

describe("apply without the whole-cube clone (CT-233)", () => {
  it("carries unchanged bands into the duplicate result by the SAME references after a single-band op", async () => {
    const content = buildThreeBandUint16RasterCellContent();
    const sourceRaster = readRasterFromCellContentOrThrow(content);
    const harness = buildRasterDuplicateFlowHarness(content);
    await runDuplicateAndApplyAtTargetIndex(
      INVERT_ACTION,
      buildInvertBandZeroParameterValues(),
      content,
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    const resultRaster = readRasterAtIndexOrThrow(harness, TARGET_INDEX);
    expect(resultRaster.bandPixels[1]).toBe(sourceRaster.bandPixels[1]);
    expect(resultRaster.bandPixels[2]).toBe(sourceRaster.bandPixels[2]);
    expect(resultRaster.bandPixels[0]).not.toBe(sourceRaster.bandPixels[0]);
    expect(Array.from(resultRaster.bandPixels[0]!)).toEqual([65435, 65335, 65235, 65135]);
  });

  it("leaves the source raster's band contents unchanged after an all-bands op", async () => {
    const content = buildThreeBandUint16RasterCellContent();
    const sourceRaster = readRasterFromCellContentOrThrow(content);
    const bandSnapshots = sourceRaster.bandPixels.map((band) => Array.from(band));
    const harness = buildRasterDuplicateFlowHarness(content);
    await runDuplicateAndApplyAtTargetIndex(
      INVERT_ACTION,
      buildInvertAllBandsParameterValues(),
      content,
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(harness.readContentAtIndex(SOURCE_INDEX)).toBe(content);
    sourceRaster.bandPixels.forEach((band, index) => {
      expect(Array.from(band)).toEqual(bandSnapshots[index]);
    });
  });

  it("leaves the source panel untouched when a duplicate-path transform throws", async () => {
    const content = buildThreeBandUint16RasterCellContent();
    const sourceRaster = readRasterFromCellContentOrThrow(content);
    const bandSnapshots = sourceRaster.bandPixels.map((band) => Array.from(band));
    const harness = buildRasterDuplicateFlowHarness(content);
    await runDuplicateAndApplyAtTargetIndex(
      buildActionThatThrowsOnTransform(),
      NO_PARAMETER_VALUES,
      content,
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(harness.readContentAtIndex(SOURCE_INDEX)).toBe(content);
    expect(harness.readContentAtIndex(TARGET_INDEX)).toBeUndefined();
    sourceRaster.bandPixels.forEach((band, index) => {
      expect(Array.from(band)).toEqual(bandSnapshots[index]);
    });
  });

  it("leaves the source panel untouched when an in-place transform throws", async () => {
    const content = buildThreeBandUint16RasterCellContent();
    const sourceRaster = readRasterFromCellContentOrThrow(content);
    const bandSnapshots = sourceRaster.bandPixels.map((band) => Array.from(band));
    const harness = buildRasterDuplicateFlowHarness(content);
    vi.mocked(toast.error).mockClear();
    applyActionInPlaceAtSourceIndex(
      buildActionThatThrowsOnTransform(),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Throws failed: boom", buildErrorToastOptions()),
    );
    expect(harness.readContentAtIndex(SOURCE_INDEX)).toBe(content);
    sourceRaster.bandPixels.forEach((band, index) => {
      expect(Array.from(band)).toEqual(bandSnapshots[index]);
    });
  });
});

interface RasterDuplicateFlowHarness {
  readonly bindings: ApplyActionFlowBindings;
  readonly readContentAtIndex: (index: number) => ViewportCellContent | undefined;
}

function buildRasterDuplicateFlowHarness(
  sourceContent: ViewportCellContent,
): RasterDuplicateFlowHarness {
  let imagesByIndex: ReadonlyMap<number, ViewportCellContent> = new Map([
    [SOURCE_INDEX, sourceContent],
  ]);
  const bindings: ApplyActionFlowBindings = {
    ...buildRasterHarnessRenderingBindings(),
    gridLayout: "1x2",
    cellCount: 2,
    get imagesByIndex() {
      return imagesByIndex;
    },
    setImagesByIndex: (updater) => {
      imagesByIndex = updater(imagesByIndex);
    },
  };
  return { bindings, readContentAtIndex: (index) => imagesByIndex.get(index) };
}

type RasterHarnessRenderingBindings = Pick<
  ApplyActionFlowBindings,
  "setGridLayout" | "setPendingDuplicate" | "getRenderingState" | "setRenderingState" | "busyRegistrar"
>;

function buildRasterHarnessRenderingBindings(): RasterHarnessRenderingBindings {
  const renderingByIndex = new Map<number, ViewportRenderingState>([
    [SOURCE_INDEX, buildRenderingStateWithHistory([])],
  ]);
  return {
    setGridLayout: vi.fn(),
    setPendingDuplicate: vi.fn(),
    getRenderingState: (index) => renderingByIndex.get(index) ?? DEFAULT_VIEWPORT_RENDERING_STATE,
    setRenderingState: vi.fn((index, next) => renderingByIndex.set(index, next)),
    busyRegistrar: buildNoopBusyEntryRegistrarForTests(),
  };
}

function buildThreeBandUint16RasterCellContent(): ViewportCellContent {
  return {
    fileName: "stack.tif",
    source: { kind: "raster", raster: buildThreeBandUint16Raster() },
    fileSizeBytes: 24,
  };
}

function buildThreeBandUint16Raster(): RasterImage {
  return {
    bandPixels: [
      new Uint16Array([100, 200, 300, 400]),
      new Uint16Array([500, 600, 700, 800]),
      new Uint16Array([900, 1000, 1100, 1200]),
    ],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 3,
  };
}

function readRasterFromCellContentOrThrow(content: ViewportCellContent): RasterImage {
  if (content.source.kind !== "raster") throw new Error("Expected a raster source");
  return content.source.raster;
}

function readRasterAtIndexOrThrow(
  harness: RasterDuplicateFlowHarness,
  index: number,
): RasterImage {
  const content = harness.readContentAtIndex(index);
  if (!content) throw new Error(`Expected viewport content at index ${index}`);
  return readRasterFromCellContentOrThrow(content);
}

function buildInvertBandZeroParameterValues(): ParameterValuesById {
  return Object.freeze({ applyToAllBands: false, targetBandIndex: 0 });
}

function buildInvertAllBandsParameterValues(): ParameterValuesById {
  return Object.freeze({ applyToAllBands: true });
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

describe("apply failure clears the operation region (CT-261)", () => {
  it("clears the source's operation region when an in-place apply fails", () => {
    const harness = buildFlowHarnessWithSourceOperationRegion();
    applyActionInPlaceAtSourceIndex(
      buildActionThatThrowsOnApply(),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    expect(harness.findLatestRenderingStateWriteAtIndex(SOURCE_INDEX).operationRegion).toBeNull();
  });

  it("clears the source's operation region when a duplicate-flow transform fails", async () => {
    const harness = buildFlowHarnessWithSourceOperationRegion();
    await runDuplicateAndApplyAtTargetIndex(
      buildActionThatThrowsOnTransform(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(harness.findLatestRenderingStateWriteAtIndex(SOURCE_INDEX).operationRegion).toBeNull();
  });

  it("leaves the region's sibling inspection ROI untouched when clearing on failure", () => {
    const harness = buildFlowHarnessWithSourceOperationRegion();
    applyActionInPlaceAtSourceIndex(
      buildActionThatThrowsOnApply(),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    expect(harness.findLatestRenderingStateWriteAtIndex(SOURCE_INDEX).roi).toEqual(buildSampleRoi());
  });
});

function buildFlowHarnessWithSourceOperationRegion(): DuplicateFlowHarness {
  const initialSource = {
    ...buildRenderingStateWithHistory([]),
    roi: buildSampleRoi(),
    operationRegion: buildSampleRoi(),
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

function buildActionThatThrowsOnApply(): RegisteredViewportAction {
  return {
    id: "throws-on-apply",
    label: "Throws On Apply",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Throws",
    apply: () => {
      throw new Error("boom");
    },
  } as unknown as RegisteredViewportAction;
}

void EMPTY_OPERATION_HISTORY;
