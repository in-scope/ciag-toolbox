import { afterEach, describe, expect, it } from "vitest";

import { BAND_SELECTION_ACTION } from "./band-selection-action";
import { DEFAULT_VIEWPORT_RENDERING_STATE } from "./viewport-action";
import { reduceCubeToSelectedBand } from "@/lib/image/band-ops/band-selection";
import {
  forgetAllBandSelectionResults,
  rememberBandSelectionResult,
} from "@/lib/image/band-ops/band-selection-result-store";
import type { RasterImage } from "@/lib/image/raster-image";

afterEach(() => forgetAllBandSelectionResults());

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

describe("BAND_SELECTION_ACTION", () => {
  it("rejects Apply when the editor has not produced a choice yet", () => {
    expect(() =>
      BAND_SELECTION_ACTION.prepareParameterValuesForApply!({}, DEFAULT_VIEWPORT_RENDERING_STATE, "whole-image"),
    ).toThrow(/pick a preset or run a formula or tool/i);
  });

  it("outputs the per-pixel average band as a single float32 band for the average preset", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, bandSelection: { kind: "preset", preset: "average" } as const };
    const prepared = BAND_SELECTION_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    const result = BAND_SELECTION_ACTION.transformSource!(
      { kind: "raster", raster: makeThreeBandUint16Raster([100], [800], [1600]) },
      prepared,
    ) as { raster: RasterImage };
    expect(result.raster.bandCount).toBe(1);
    expect(result.raster.sampleFormat).toBe("float");
    expect(result.raster.bandPixels[0]![0]).toBeCloseTo((100 + 800 + 1600) / 3, 3);
    expect(BAND_SELECTION_ACTION.formatAppliedLabel!(prepared)).toBe("Band selection (average)");
  });

  it("records the variance preset in the applied label", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, bandSelection: { kind: "preset", preset: "variance" } as const };
    const prepared = BAND_SELECTION_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    expect(BAND_SELECTION_ACTION.formatAppliedLabel!(prepared)).toBe("Band selection (variance)");
  });

  it("outputs the remembered custom band and records its description for a formula/tool result", () => {
    const token = rememberBandSelectionResult({ values: Float32Array.from([7, 8]), width: 2, height: 1 });
    const state = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      bandSelection: { kind: "custom", token, description: "Imported tool: band-tool.py" } as const,
    };
    const prepared = BAND_SELECTION_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    const result = BAND_SELECTION_ACTION.transformSource!(
      { kind: "raster", raster: makeThreeBandUint16Raster([1, 2], [3, 4], [5, 6]) },
      prepared,
    ) as { raster: RasterImage };
    expect(Array.from(result.raster.bandPixels[0]!)).toEqual([7, 8]);
    expect(BAND_SELECTION_ACTION.formatAppliedLabel!(prepared)).toBe("Band selection (Imported tool: band-tool.py)");
  });

  it("throws a clear error when the remembered band token is gone", () => {
    const state = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      bandSelection: { kind: "custom", token: "band-selection-missing", description: "Formula" } as const,
    };
    const prepared = BAND_SELECTION_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    expect(() =>
      BAND_SELECTION_ACTION.transformSource!(
        { kind: "raster", raster: makeThreeBandUint16Raster([1], [2], [3]) },
        prepared,
      ),
    ).toThrow(/no longer available/i);
  });

  // CT-284: the Subset Bands "By function" mode applies through this action with
  // no extra parameters; its output must equal the old Band Selection presets.
  it("produces preset output identical to the standalone preset math for the merged Subset Bands path", () => {
    const raster = makeThreeBandUint16Raster([100, 40], [800, 90], [1600, 20]);
    for (const preset of ["average", "variance"] as const) {
      const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, bandSelection: { kind: "preset", preset } as const };
      const prepared = BAND_SELECTION_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
      const result = BAND_SELECTION_ACTION.transformSource!({ kind: "raster", raster }, prepared) as {
        raster: RasterImage;
      };
      expect(result.raster.bandPixels[0]).toEqual(reduceCubeToSelectedBand(raster.bandPixels, preset));
    }
  });

  it("closes the Subset Bands editor and drops the staged choice on the source after applying", () => {
    const sourceState = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      isBandSubsetEditModeActive: true,
      bandSelection: { kind: "preset", preset: "average" } as const,
    };
    const cleared = BAND_SELECTION_ACTION.clearConsumedSourceStateAfterApply!(sourceState);
    expect(cleared.isBandSubsetEditModeActive).toBe(false);
    expect(cleared.bandSelection).toBeNull();
  });

  it("resets the selected band to the single produced band after applying", () => {
    const state = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      selectedBandIndex: 2,
      bandSelection: { kind: "preset", preset: "average" } as const,
    };
    const next = BAND_SELECTION_ACTION.apply(state, {});
    expect(next.selectedBandIndex).toBe(0);
    expect(next.bandSelection).toBeNull();
  });
});
