import { describe, expect, it } from "vitest";

import { BAND_WEIGHTING_ACTION } from "./band-weighting-action";
import { DEFAULT_VIEWPORT_RENDERING_STATE } from "./viewport-action";
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

describe("BAND_WEIGHTING_ACTION", () => {
  it("rejects Apply when the editor has not produced weights yet", () => {
    expect(() =>
      BAND_WEIGHTING_ACTION.prepareParameterValuesForApply!({}, DEFAULT_VIEWPORT_RENDERING_STATE, "whole-image"),
    ).toThrow(/weight for each band/);
  });

  it("injects the serialized weights from rendering state for the audit trail", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, bandWeights: [1, 0, 0] };
    const prepared = BAND_WEIGHTING_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    expect(prepared).toMatchObject({ weightsJson: "[1,0,0]" });
  });

  // CT-240: the transform is async (chunked with paint yields at scale).
  it("outputs a single float32 band equal to the normalized weighted sum", async () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, bandWeights: [1, 1, 1] };
    const prepared = BAND_WEIGHTING_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    const result = (await BAND_WEIGHTING_ACTION.transformSourceAsync!(
      { kind: "raster", raster: makeThreeBandUint16Raster([0, 30], [30, 30], [60, 30]) },
      prepared,
    )) as { raster: RasterImage };
    expect(result.raster.bandCount).toBe(1);
    expect(result.raster.sampleFormat).toBe("float");
    expect(Array.from(result.raster.bandPixels[0]!)).toEqual([30, 30]);
  });

  it("selects a single band exactly when only that band is weighted", async () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, bandWeights: [0, 1, 0] };
    const prepared = BAND_WEIGHTING_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    const result = (await BAND_WEIGHTING_ACTION.transformSourceAsync!(
      { kind: "raster", raster: makeThreeBandUint16Raster([100], [800], [1600]) },
      prepared,
    )) as { raster: RasterImage };
    expect(Array.from(result.raster.bandPixels[0]!)).toEqual([800]);
  });

  it("records the weights in the applied label", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, bandWeights: [1, -0.5, 0] };
    const prepared = BAND_WEIGHTING_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    expect(BAND_WEIGHTING_ACTION.formatAppliedLabel!(prepared)).toBe("Band weighting (weights: 1, -0.500, 0)");
  });

  it("resets the selected band to the single produced band after applying", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, selectedBandIndex: 2, bandWeights: [1, 1, 1] };
    const next = BAND_WEIGHTING_ACTION.apply(state, {});
    expect(next.selectedBandIndex).toBe(0);
    expect(next.bandWeights).toBeNull();
  });
});
