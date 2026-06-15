import { describe, expect, it } from "vitest";

import { applyStandardizeToRaster } from "./apply-standardize";
import type { RasterImage } from "./raster-image";

function makeTwoBandUint8Raster(
  bandOne: ReadonlyArray<number>,
  bandTwo: ReadonlyArray<number>,
): RasterImage {
  return {
    bandPixels: [Uint8Array.from(bandOne), Uint8Array.from(bandTwo)],
    width: bandOne.length,
    height: 1,
    bandCount: 2,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

const UNIT_TARGET = { targetMean: 0, targetStandardDeviation: 1 };

describe("applyStandardizeToRaster", () => {
  it("standardizes each selected band to its own mean and std in band-wise scope", () => {
    const raster = makeTwoBandUint8Raster([10, 30], [40, 60]);
    const result = applyStandardizeToRaster(raster, { scope: "band-wise", bandIndexes: [0, 1] }, UNIT_TARGET);
    expect(Array.from(result.bandPixels[0]!)).toEqual([-1, 1]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([-1, 1]);
  });

  it("shifts and scales to the requested target mean and std", () => {
    const raster = makeTwoBandUint8Raster([0, 10], [0, 10]);
    const result = applyStandardizeToRaster(
      raster,
      { scope: "band-wise", bandIndexes: [0, 1] },
      { targetMean: 100, targetStandardDeviation: 10 },
    );
    expect(Array.from(result.bandPixels[0]!)).toEqual([90, 110]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([90, 110]);
  });

  it("emits a float32 raster from an integer source", () => {
    const result = applyStandardizeToRaster(
      makeTwoBandUint8Raster([10, 30], [40, 60]),
      { scope: "full-cube" },
      UNIT_TARGET,
    );
    expect(result.sampleFormat).toBe("float");
    expect(result.bitsPerSample).toBe(32);
    expect(result.bandPixels[0]).toBeInstanceOf(Float32Array);
  });

  it("uses one cube-wide mean and std in full-cube scope, distinct from band-wise", () => {
    const raster = makeTwoBandUint8Raster([10, 30], [40, 60]);
    const result = applyStandardizeToRaster(raster, { scope: "full-cube" }, UNIT_TARGET);
    expect(result.bandPixels[0]![0]!).toBeCloseTo(-1.3868, 3);
    expect(result.bandPixels[0]![1]!).toBeCloseTo(-0.2774, 3);
    expect(result.bandPixels[1]![0]!).toBeCloseTo(0.2774, 3);
    expect(result.bandPixels[1]![1]!).toBeCloseTo(1.3868, 3);
  });

  it("leaves non-selected bands unchanged in band-wise scope", () => {
    const raster = makeTwoBandUint8Raster([10, 30], [40, 60]);
    const result = applyStandardizeToRaster(raster, { scope: "band-wise", bandIndexes: [0] }, UNIT_TARGET);
    expect(Array.from(result.bandPixels[0]!)).toEqual([-1, 1]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([40, 60]);
  });

  it("maps a zero-std band to the target mean without producing NaN or Inf", () => {
    const raster = makeTwoBandUint8Raster([50, 50], [10, 90]);
    const result = applyStandardizeToRaster(
      raster,
      { scope: "band-wise", bandIndexes: [0, 1] },
      { targetMean: 7, targetStandardDeviation: 3 },
    );
    expect(Array.from(result.bandPixels[0]!)).toEqual([7, 7]);
    expect(result.bandPixels[1]!.every((value) => Number.isFinite(value))).toBe(true);
  });

  it("maps a fully constant cube to the target mean in full-cube scope", () => {
    const raster = makeTwoBandUint8Raster([7, 7], [7, 7]);
    const result = applyStandardizeToRaster(
      raster,
      { scope: "full-cube" },
      { targetMean: 42, targetStandardDeviation: 5 },
    );
    expect(Array.from(result.bandPixels[0]!)).toEqual([42, 42]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([42, 42]);
  });

  it("does not mutate the source raster", () => {
    const raster = makeTwoBandUint8Raster([10, 30], [40, 60]);
    applyStandardizeToRaster(raster, { scope: "full-cube" }, UNIT_TARGET);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([10, 30]);
  });
});
