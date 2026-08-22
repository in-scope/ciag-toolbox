import { describe, expect, it } from "vitest";

import {
  BAND_SELECTION_ACTION,
  createBandSelectionSourceTransform,
} from "./band-selection-action";
import { DEFAULT_VIEWPORT_RENDERING_STATE, type ViewportRenderingState } from "./viewport-action";
import {
  reduceCubeToSelectedBand,
  type BandSelectionEditingState,
} from "@/lib/image/band-ops/band-selection";
import { SCRIPTING_DOCS_HINT } from "@/lib/image/band-ops/user-script-return-contract";
import type { ApplyTimeUserScriptRunner } from "@/lib/python/run-user-script-at-apply";
import type { RasterImage } from "@/lib/image/raster-image";

function makeThreeBandUint16Raster(
  band0: ReadonlyArray<number>,
  band1: ReadonlyArray<number>,
  band2: ReadonlyArray<number>,
): RasterImage {
  return {
    bandPixels: [Uint16Array.from(band0), Uint16Array.from(band1), Uint16Array.from(band2)],
    width: band0.length,
    height: 1,
    bandCount: 3,
    sampleFormat: "uint",
    bitsPerSample: 16,
  };
}

function stateWithChoice(choice: BandSelectionEditingState): ViewportRenderingState {
  return { ...DEFAULT_VIEWPORT_RENDERING_STATE, bandSelection: choice };
}

function prepareApplyParametersFor(choice: BandSelectionEditingState) {
  return BAND_SELECTION_ACTION.prepareParameterValuesForApply!({}, stateWithChoice(choice), "whole-image");
}

function runnerReturningBand(rows: ReadonlyArray<ReadonlyArray<number>>): ApplyTimeUserScriptRunner {
  return async () => ({ status: "completed", value: rows });
}

async function applyChoiceToRaster(
  choice: BandSelectionEditingState,
  raster: RasterImage,
  runScript: ApplyTimeUserScriptRunner = runnerReturningBand([]),
): Promise<RasterImage> {
  const prepared = prepareApplyParametersFor(choice);
  const result = (await createBandSelectionSourceTransform(runScript)(
    { kind: "raster", raster },
    prepared,
  )) as { raster: RasterImage };
  return result.raster;
}

describe("BAND_SELECTION_ACTION presets", () => {
  it("rejects Apply when the editor has not staged a choice yet", () => {
    expect(() =>
      BAND_SELECTION_ACTION.prepareParameterValuesForApply!({}, DEFAULT_VIEWPORT_RENDERING_STATE, "whole-image"),
    ).toThrow(/pick average, variance, or custom/i);
  });

  it("outputs the per-pixel average band as a single float32 band", async () => {
    const raster = await applyChoiceToRaster(
      { kind: "preset", preset: "average" },
      makeThreeBandUint16Raster([100], [800], [1600]),
    );
    expect(raster.bandCount).toBe(1);
    expect(raster.sampleFormat).toBe("float");
    expect(raster.bandPixels[0]![0]).toBeCloseTo((100 + 800 + 1600) / 3, 3);
  });

  it("records the chosen preset in the applied label", () => {
    expect(BAND_SELECTION_ACTION.formatAppliedLabel!(prepareApplyParametersFor({ kind: "preset", preset: "average" })))
      .toBe("Band selection (average)");
    expect(BAND_SELECTION_ACTION.formatAppliedLabel!(prepareApplyParametersFor({ kind: "preset", preset: "variance" })))
      .toBe("Band selection (variance)");
  });

  // CT-293 chunked the preset sweep so it can report progress and stop; the
  // output must stay bit-identical to the pure per-pixel reduction.
  it("produces preset output identical to the pure preset math", async () => {
    const source = makeThreeBandUint16Raster([100, 40], [800, 90], [1600, 20]);
    for (const preset of ["average", "variance"] as const) {
      const raster = await applyChoiceToRaster({ kind: "preset", preset }, source);
      expect(raster.bandPixels[0]).toEqual(reduceCubeToSelectedBand(source.bandPixels, preset));
    }
  });

  it("stops the preset sweep when the apply flow aborts", async () => {
    const prepared = prepareApplyParametersFor({ kind: "preset", preset: "average" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      createBandSelectionSourceTransform()(
        { kind: "raster", raster: makeThreeBandUint16Raster([1], [2], [3]) },
        prepared,
        undefined,
        controller.signal,
      ),
    ).rejects.toThrow();
  });
});

describe("BAND_SELECTION_ACTION custom functions at Apply", () => {
  it("runs the configured formula at Apply and builds the returned band", async () => {
    const seenSources: ToolboxRunUserScriptSource[] = [];
    const runScript: ApplyTimeUserScriptRunner = async (_raster, source) => {
      seenSources.push(source);
      return { status: "completed", value: [[7, 8]] };
    };
    const raster = await applyChoiceToRaster(
      { kind: "formula", expression: " cube[1] " },
      makeThreeBandUint16Raster([1, 2], [3, 4], [5, 6]),
      runScript,
    );
    expect(seenSources).toEqual([{ mode: "formula", expression: "cube[1]" }]);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([7, 8]);
    expect(raster.bandCount).toBe(1);
    expect(raster.sampleFormat).toBe("float");
  });

  // The imported tool is re-read from disk on every Apply: the run always
  // carries the remembered file path, never a cached band.
  it("runs a configured tool by its remembered file path and records its name", async () => {
    const seenSources: ToolboxRunUserScriptSource[] = [];
    const runScript: ApplyTimeUserScriptRunner = async (_raster, source) => {
      seenSources.push(source);
      return { status: "completed", value: [[11, 12]] };
    };
    const choice = { kind: "tool", filePath: "C:/tools/band-tool.py", fileName: "band-tool.py" } as const;
    const raster = await applyChoiceToRaster(choice, makeThreeBandUint16Raster([1, 2], [3, 4], [5, 6]), runScript);
    expect(seenSources).toEqual([{ mode: "import", scriptPath: "C:/tools/band-tool.py" }]);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([11, 12]);
    expect(BAND_SELECTION_ACTION.formatAppliedLabel!(prepareApplyParametersFor(choice))).toBe(
      "Band selection (Imported tool: band-tool.py)",
    );
  });

  it("labels a formula result as Formula in History", () => {
    const prepared = prepareApplyParametersFor({ kind: "formula", expression: "cube[1]" });
    expect(BAND_SELECTION_ACTION.formatAppliedLabel!(prepared)).toBe("Band selection (Formula)");
  });

  it("rejects Apply when Custom is chosen with no formula and no tool", () => {
    expect(() => prepareApplyParametersFor({ kind: "formula", expression: "   " })).toThrow(
      /needs a formula or an imported tool/i,
    );
  });

  it("rejects a returned band whose shape does not match the stack", async () => {
    await expect(
      applyChoiceToRaster(
        { kind: "formula", expression: "cube[1]" },
        makeThreeBandUint16Raster([1, 2], [3, 4], [5, 6]),
        runnerReturningBand([[7, 8], [9, 10]]),
      ),
    ).rejects.toThrow(/must have 1 rows/i);
  });

  it("surfaces a failed script run with the docs hint appended", async () => {
    const runScript: ApplyTimeUserScriptRunner = async () => ({
      status: "failed",
      message: "NameError: name 'cub' is not defined",
    });
    await expect(
      applyChoiceToRaster(
        { kind: "formula", expression: "cub[1]" },
        makeThreeBandUint16Raster([1], [2], [3]),
        runScript,
      ),
    ).rejects.toThrow(SCRIPTING_DOCS_HINT);
  });
});

describe("BAND_SELECTION_ACTION consumed state", () => {
  it("closes the Subset Bands editor and drops the staged choice on the source after applying", () => {
    const sourceState = {
      ...stateWithChoice({ kind: "preset", preset: "average" }),
      isBandSubsetEditModeActive: true,
    };
    const cleared = BAND_SELECTION_ACTION.clearConsumedSourceStateAfterApply!(sourceState);
    expect(cleared.isBandSubsetEditModeActive).toBe(false);
    expect(cleared.bandSelection).toBeNull();
  });

  it("keeps the editor open until an Apply succeeds", () => {
    expect(BAND_SELECTION_ACTION.keepsPanelOpenUntilApplySucceeds).toBe(true);
  });

  it("resets the selected band to the single produced band after applying", () => {
    const state = { ...stateWithChoice({ kind: "preset", preset: "average" }), selectedBandIndex: 2 };
    const next = BAND_SELECTION_ACTION.apply(state, {});
    expect(next.selectedBandIndex).toBe(0);
    expect(next.bandSelection).toBeNull();
  });
});
