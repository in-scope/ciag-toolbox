import { describe, expect, it } from "vitest";

import {
  applyInvertToRasterBands,
  assertRasterDataRangeIsBoundedForInvert,
  autoNormalizeUnboundedRasterToUnitRange,
  isRasterDataRangeBoundedForInvert,
  planInvertForRaster,
} from "./apply-invert";
import type { RasterImage, RasterSampleFormat, RasterTypedArray } from "./raster-image";

function makeRaster(
  bands: ReadonlyArray<RasterTypedArray>,
  sampleFormat: RasterSampleFormat,
  bitsPerSample: number,
): RasterImage {
  return {
    bandPixels: bands,
    width: bands[0]!.length,
    height: 1,
    bandCount: bands.length,
    sampleFormat,
    bitsPerSample,
  };
}

function makeUint8Raster(...bands: ReadonlyArray<ReadonlyArray<number>>): RasterImage {
  return makeRaster(bands.map((values) => Uint8Array.from(values)), "uint", 8);
}

function makeFloatRaster(...bands: ReadonlyArray<ReadonlyArray<number>>): RasterImage {
  return makeRaster(bands.map((values) => Float32Array.from(values)), "float", 32);
}

describe("applyInvertToRasterBands", () => {
  it("inverts a uint8 band as 255 minus the value", () => {
    const result = applyInvertToRasterBands(makeUint8Raster([0, 1, 128, 255]), [0]);
    expect(Array.from(result.bandPixels[0]!)).toEqual([255, 254, 127, 0]);
  });

  it("inverts a float [0,1] band as 1 minus the value and preserves the float type", () => {
    const result = applyInvertToRasterBands(makeFloatRaster([0, 0.25, 0.75, 1]), [0]);
    expect(result.bandPixels[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result.bandPixels[0]!)).toEqual([1, 0.75, 0.25, 0]);
  });

  it("inverts only the selected bands, sharing the rest unchanged", () => {
    const result = applyInvertToRasterBands(makeUint8Raster([0, 255], [0, 255]), [1]);
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 255]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([255, 0]);
  });

  it("inverts every band when all band indexes are selected", () => {
    const result = applyInvertToRasterBands(makeUint8Raster([0, 10], [20, 30]), [0, 1]);
    expect(Array.from(result.bandPixels[0]!)).toEqual([255, 245]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([235, 225]);
  });

  it("does not mutate the source band", () => {
    const raster = makeUint8Raster([1, 2, 3]);
    applyInvertToRasterBands(raster, [0]);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([1, 2, 3]);
  });
});

describe("isRasterDataRangeBoundedForInvert", () => {
  it("treats every integer raster as bounded", () => {
    expect(isRasterDataRangeBoundedForInvert(makeUint8Raster([0, 255]))).toBe(true);
  });

  it("treats a float raster within [0,1] as bounded", () => {
    expect(isRasterDataRangeBoundedForInvert(makeFloatRaster([0, 0.5, 1]))).toBe(true);
  });

  it("treats a float raster with values outside [0,1] as unbounded", () => {
    expect(isRasterDataRangeBoundedForInvert(makeFloatRaster([0, 1.5]))).toBe(false);
    expect(isRasterDataRangeBoundedForInvert(makeFloatRaster([-0.2, 0.5]))).toBe(false);
  });
});

describe("assertRasterDataRangeIsBoundedForInvert", () => {
  it("does not throw for a bounded raster", () => {
    expect(() => assertRasterDataRangeIsBoundedForInvert(makeFloatRaster([0, 1]))).not.toThrow();
  });

  it("throws a user-readable error for an unbounded float raster", () => {
    expect(() => assertRasterDataRangeIsBoundedForInvert(makeFloatRaster([0, 2]))).toThrow(
      /bounded data range/i,
    );
  });
});

describe("planInvertForRaster", () => {
  it("inverts bounded uint8 data directly as a single output", () => {
    const outcome = planInvertForRaster(makeUint8Raster([0, 128, 255]), [0]);
    expect(outcome.kind).toBe("direct");
    if (outcome.kind !== "direct") throw new Error("expected a direct outcome");
    expect(Array.from(outcome.inverted.bandPixels[0]!)).toEqual([255, 127, 0]);
  });

  it("inverts bounded float [0,1] data directly as a single output", () => {
    const outcome = planInvertForRaster(makeFloatRaster([0, 0.25, 1]), [0]);
    expect(outcome.kind).toBe("direct");
  });

  it("auto-normalizes unbounded float data then inverts, returning two outputs", () => {
    const outcome = planInvertForRaster(makeFloatRaster([0, 2], [0, 0.5]), [0, 1]);
    expect(outcome.kind).toBe("auto-normalized");
    if (outcome.kind !== "auto-normalized") throw new Error("expected an auto-normalized outcome");
    expect(Array.from(outcome.normalized.bandPixels[0]!)).toEqual([0, 1]);
    expect(Array.from(outcome.normalized.bandPixels[1]!)).toEqual([0, 0.25]);
    expect(Array.from(outcome.normalizedThenInverted.bandPixels[0]!)).toEqual([1, 0]);
    expect(Array.from(outcome.normalizedThenInverted.bandPixels[1]!)).toEqual([1, 0.75]);
  });

  it("inverts only the selected bands in the auto-normalized path", () => {
    const outcome = planInvertForRaster(makeFloatRaster([0, 2], [0, 2]), [1]);
    if (outcome.kind !== "auto-normalized") throw new Error("expected an auto-normalized outcome");
    expect(Array.from(outcome.normalizedThenInverted.bandPixels[0]!)).toEqual([0, 1]);
    expect(Array.from(outcome.normalizedThenInverted.bandPixels[1]!)).toEqual([1, 0]);
  });
});

describe("autoNormalizeUnboundedRasterToUnitRange", () => {
  it("scales cube-wide values into [0,1] as a float raster", () => {
    const normalized = autoNormalizeUnboundedRasterToUnitRange(makeFloatRaster([-1, 3]));
    expect(normalized.sampleFormat).toBe("float");
    expect(Array.from(normalized.bandPixels[0]!)).toEqual([0, 1]);
  });
});
