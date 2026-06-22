import { describe, expect, it } from "vitest";

import {
  applyNormalizeToRaster,
  clampValueToAbsoluteBounds,
  type NormalizeRangeMethod,
} from "./apply-normalize";
import { DEFAULT_PERCENTILE_BOUNDS } from "./percentile-value-range";
import type { RasterImage } from "./raster-image";

const ROBUST_METHOD: NormalizeRangeMethod = { kind: "percentile", bounds: DEFAULT_PERCENTILE_BOUNDS };

function clipMethod(lo: number, hi: number): NormalizeRangeMethod {
  return { kind: "clip-absolute", bounds: { lo, hi } };
}

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

  it("clamps below lo to lo, above hi to hi, and passes in-range values through (CT-194)", () => {
    const raster = makeTwoBandUint8Raster([10, 50, 100], [10, 50, 100]);
    const result = applyNormalizeToRaster(raster, { scope: "full-cube" }, clipMethod(30, 80));
    expect(Array.from(result.bandPixels[0]!)).toEqual([30, 50, 80]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([30, 50, 80]);
  });

  it("preserves the source data type when clipping by value (CT-194)", () => {
    const raster = makeSingleBandUint16Raster([800, 875, 950]);
    const result = applyNormalizeToRaster(raster, { scope: "full-cube" }, clipMethod(850, 900));
    expect(result.sampleFormat).toBe("uint");
    expect(result.bitsPerSample).toBe(16);
    expect(result.bandPixels[0]).toBeInstanceOf(Uint16Array);
    expect(Array.from(result.bandPixels[0]!)).toEqual([850, 875, 900]);
  });

  it("clips only the selected bands in band-wise scope, leaving others untouched (CT-194)", () => {
    const raster = makeTwoBandUint8Raster([10, 50, 100], [10, 50, 100]);
    const result = applyNormalizeToRaster(raster, { scope: "band-wise", bandIndexes: [0] }, clipMethod(30, 80));
    expect(Array.from(result.bandPixels[0]!)).toEqual([30, 50, 80]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([10, 50, 100]);
  });

  it("clips every band the same way in full-cube scope (CT-194)", () => {
    const raster = makeTwoBandUint8Raster([10, 50, 100], [20, 60, 120]);
    const result = applyNormalizeToRaster(raster, { scope: "full-cube" }, clipMethod(30, 80));
    expect(Array.from(result.bandPixels[0]!)).toEqual([30, 50, 80]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([30, 60, 80]);
  });

  it("rounds clamped values for an integer band (CT-194)", () => {
    const raster = makeSingleBandUint16Raster([800, 950]);
    const result = applyNormalizeToRaster(raster, { scope: "full-cube" }, clipMethod(850.4, 900.6));
    expect(Array.from(result.bandPixels[0]!)).toEqual([850, 901]);
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

describe("clampValueToAbsoluteBounds", () => {
  it("returns the low bound for a value below it", () => {
    expect(clampValueToAbsoluteBounds(5, { lo: 30, hi: 80 })).toBe(30);
  });

  it("returns the high bound for a value above it", () => {
    expect(clampValueToAbsoluteBounds(120, { lo: 30, hi: 80 })).toBe(80);
  });

  it("passes an in-range value through unchanged", () => {
    expect(clampValueToAbsoluteBounds(50, { lo: 30, hi: 80 })).toBe(50);
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
