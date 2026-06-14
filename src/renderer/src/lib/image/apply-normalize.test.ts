import { describe, expect, it } from "vitest";

import { applyNormalizeToRaster, type NormalizeRangeMethod } from "./apply-normalize";
import { DEFAULT_PERCENTILE_BOUNDS } from "./percentile-value-range";
import type { RasterImage } from "./raster-image";

const ROBUST_METHOD: NormalizeRangeMethod = { kind: "percentile", bounds: DEFAULT_PERCENTILE_BOUNDS };

function makeSingleBandUint16Raster(values: ReadonlyArray<number>): RasterImage {
  return {
    bandPixels: [Uint16Array.from(values)],
    width: values.length,
    height: 1,
    bandCount: 1,
    sampleFormat: "uint",
    bitsPerSample: 16,
  };
}

// A band whose bulk sits in [0, 98] with a single sparse near-max outlier (1000).
function makeOutlierBandValues(): number[] {
  const bulk = Array.from({ length: 99 }, (_unused, index) => index);
  return [...bulk, 1000];
}

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

describe("applyNormalizeToRaster", () => {
  it("scales the whole cube by one cube-wide min and max", () => {
    const raster = makeTwoBandUint8Raster([0, 100], [100, 200]);
    const result = applyNormalizeToRaster(raster, { scope: "full-cube" });
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 0.5]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([0.5, 1]);
  });

  it("emits a float32 [0,1] raster from an integer source", () => {
    const result = applyNormalizeToRaster(makeTwoBandUint8Raster([0, 200], [50, 100]), {
      scope: "full-cube",
    });
    expect(result.sampleFormat).toBe("float");
    expect(result.bitsPerSample).toBe(32);
    expect(result.bandPixels[0]).toBeInstanceOf(Float32Array);
  });

  it("scales each selected band by its own min and max in band-wise scope", () => {
    const raster = makeTwoBandUint8Raster([0, 100], [100, 200]);
    const result = applyNormalizeToRaster(raster, { scope: "band-wise", bandIndexes: [0, 1] });
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 1]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([0, 1]);
  });

  it("distinguishes all-bands band-wise from full-cube", () => {
    const raster = makeTwoBandUint8Raster([0, 100], [100, 200]);
    const fullCube = applyNormalizeToRaster(raster, { scope: "full-cube" });
    const bandWise = applyNormalizeToRaster(raster, { scope: "band-wise", bandIndexes: [0, 1] });
    expect(Array.from(fullCube.bandPixels[1]!)).toEqual([0.5, 1]);
    expect(Array.from(bandWise.bandPixels[1]!)).toEqual([0, 1]);
  });

  it("leaves non-selected bands unchanged in band-wise scope", () => {
    const raster = makeTwoBandUint8Raster([0, 100], [100, 200]);
    const result = applyNormalizeToRaster(raster, { scope: "band-wise", bandIndexes: [0] });
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 1]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([100, 200]);
  });

  it("maps a constant band to zero without producing NaN", () => {
    const raster = makeTwoBandUint8Raster([50, 50], [10, 90]);
    const bandWise = applyNormalizeToRaster(raster, { scope: "band-wise", bandIndexes: [0, 1] });
    expect(Array.from(bandWise.bandPixels[0]!)).toEqual([0, 0]);
    expect(Array.from(bandWise.bandPixels[1]!)).toEqual([0, 1]);
  });

  it("maps a fully constant cube to zero without producing NaN in full-cube scope", () => {
    const raster = makeTwoBandUint8Raster([7, 7], [7, 7]);
    const result = applyNormalizeToRaster(raster, { scope: "full-cube" });
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 0]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([0, 0]);
  });

  it("does not mutate the source raster", () => {
    const raster = makeTwoBandUint8Raster([0, 100], [100, 200]);
    applyNormalizeToRaster(raster, { scope: "full-cube" });
    expect(Array.from(raster.bandPixels[0]!)).toEqual([0, 100]);
  });

  it("leaves the bulk compressed near 0 under plain min-max with a sparse outlier (CT-107 reproduction)", () => {
    const raster = makeSingleBandUint16Raster(makeOutlierBandValues());
    const result = applyNormalizeToRaster(raster, { scope: "band-wise", bandIndexes: [0] });
    const normalized = Array.from(result.bandPixels[0]!);
    // The outlier (1000) sets the max, so every bulk value (0..98) maps below 0.1.
    const bulkValues = normalized.slice(0, 99);
    expect(Math.max(...bulkValues)).toBeLessThan(0.1);
    expect(normalized[99]).toBe(1);
  });

  it("stretches the bulk across [0,1] under robust percentile normalize (CT-107)", () => {
    const raster = makeSingleBandUint16Raster(makeOutlierBandValues());
    const result = applyNormalizeToRaster(raster, { scope: "band-wise", bandIndexes: [0] }, ROBUST_METHOD);
    const normalized = Array.from(result.bandPixels[0]!);
    // Robust range is roughly [1.98, 97.02], so the mid value (50) lands mid-scale.
    expect(normalized[50]).toBeGreaterThan(0.4);
    expect(normalized[50]).toBeLessThan(0.6);
  });

  it("clips values outside the percentile range to 0 and 1 (CT-107)", () => {
    const raster = makeSingleBandUint16Raster(makeOutlierBandValues());
    const result = applyNormalizeToRaster(raster, { scope: "band-wise", bandIndexes: [0] }, ROBUST_METHOD);
    const normalized = Array.from(result.bandPixels[0]!);
    expect(normalized[0]).toBe(0);
    expect(normalized[99]).toBe(1);
  });

  it("supports robust percentile normalize in full-cube scope (CT-107)", () => {
    const raster = makeTwoBandUint8Raster([0, 50, 100], [10, 60, 200]);
    const result = applyNormalizeToRaster(raster, { scope: "full-cube" }, ROBUST_METHOD);
    expect(result.sampleFormat).toBe("float");
    for (const value of Array.from(result.bandPixels[0]!).concat(Array.from(result.bandPixels[1]!))) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("reuses unchanged float bands by reference in band-wise scope (CT-103)", () => {
    const raster = makeThreeBandFloat32Raster();
    const result = applyNormalizeToRaster(raster, { scope: "band-wise", bandIndexes: [1] });
    expect(result.bandPixels[0]).toBe(raster.bandPixels[0]);
    expect(result.bandPixels[2]).toBe(raster.bandPixels[2]);
    expect(result.bandPixels[1]).not.toBe(raster.bandPixels[1]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([0, 0.5, 1]);
  });
});

function makeThreeBandFloat32Raster(): RasterImage {
  return {
    bandPixels: [
      Float32Array.from([0, 1, 2]),
      Float32Array.from([10, 20, 30]),
      Float32Array.from([5, 6, 7]),
    ],
    width: 3,
    height: 1,
    bandCount: 3,
    sampleFormat: "float",
    bitsPerSample: 32,
  };
}
