import { describe, expect, it } from "vitest";

import {
  applyInvertToRasterBands,
  assertRasterDataRangeIsBoundedForInvert,
  isRasterDataRangeBoundedForInvert,
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
