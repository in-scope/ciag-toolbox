import { describe, expect, it } from "vitest";

import { applyCropToRasterImage } from "./apply-crop-to-roi";
import type { RasterImage } from "./raster-image";

describe("applyCropToRasterImage", () => {
  it("crops a single-band uint16 raster to the ROI rectangle", () => {
    const raster = createSingleBandUint16Raster(4, 3, [
      [10, 11, 12, 13],
      [20, 21, 22, 23],
      [30, 31, 32, 33],
    ]);
    const result = applyCropToRasterImage(raster, makeRoi(1, 1, 2, 2));
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(Array.from(result.bandPixels[0]!)).toEqual([21, 22, 31, 32]);
  });

  it("preserves the typed-array constructor for each band", () => {
    const raster = createSingleBandFloat32Raster(2, 2, [
      [1.5, 2.5],
      [3.5, 4.5],
    ]);
    const result = applyCropToRasterImage(raster, makeRoi(0, 0, 1, 1));
    expect(result.bandPixels[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result.bandPixels[0]!)).toEqual([1.5, 2.5, 3.5, 4.5]);
  });

  it("crops every band independently for multi-band rasters", () => {
    const raster = createTwoBandUint16Raster(3, 2,
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
      [
        [10, 20, 30],
        [40, 50, 60],
      ],
    );
    const result = applyCropToRasterImage(raster, makeRoi(1, 0, 2, 1));
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(Array.from(result.bandPixels[0]!)).toEqual([2, 3, 5, 6]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([20, 30, 50, 60]);
  });

  it("treats the entire image as a valid crop region", () => {
    const raster = createSingleBandUint16Raster(2, 2, [
      [7, 8],
      [9, 10],
    ]);
    const result = applyCropToRasterImage(raster, makeRoi(0, 0, 1, 1));
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(Array.from(result.bandPixels[0]!)).toEqual([7, 8, 9, 10]);
  });

  it("clamps a ROI that extends past the right and bottom edges", () => {
    const raster = createSingleBandUint16Raster(3, 2, [
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const result = applyCropToRasterImage(raster, makeRoi(1, 0, 99, 99));
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(Array.from(result.bandPixels[0]!)).toEqual([2, 3, 5, 6]);
  });

  it("canonicalizes a ROI whose corners are reversed", () => {
    const raster = createSingleBandUint16Raster(3, 3, [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
    const result = applyCropToRasterImage(raster, makeRoi(2, 2, 1, 1));
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(Array.from(result.bandPixels[0]!)).toEqual([5, 6, 8, 9]);
  });

  it("supports a one-by-one crop", () => {
    const raster = createSingleBandUint16Raster(2, 2, [
      [10, 20],
      [30, 40],
    ]);
    const result = applyCropToRasterImage(raster, makeRoi(1, 0, 1, 0));
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(Array.from(result.bandPixels[0]!)).toEqual([20]);
  });

  it("does not mutate the source raster's pixel buffers", () => {
    const sourceBand = new Uint16Array([1, 2, 3, 4]);
    const raster: RasterImage = {
      bandPixels: [sourceBand],
      width: 2,
      height: 2,
      bitsPerSample: 16,
      sampleFormat: "uint",
      bandCount: 1,
    };
    applyCropToRasterImage(raster, makeRoi(0, 0, 1, 0));
    expect(Array.from(sourceBand)).toEqual([1, 2, 3, 4]);
  });
});

function makeRoi(x0: number, y0: number, x1: number, y1: number) {
  return { imagePixelX0: x0, imagePixelY0: y0, imagePixelX1: x1, imagePixelY1: y1 };
}

function createSingleBandUint16Raster(
  width: number,
  height: number,
  rows: ReadonlyArray<ReadonlyArray<number>>,
): RasterImage {
  return {
    bandPixels: [new Uint16Array(rows.flat())],
    width,
    height,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
}

function createSingleBandFloat32Raster(
  width: number,
  height: number,
  rows: ReadonlyArray<ReadonlyArray<number>>,
): RasterImage {
  return {
    bandPixels: [new Float32Array(rows.flat())],
    width,
    height,
    bitsPerSample: 32,
    sampleFormat: "float",
    bandCount: 1,
  };
}

function createTwoBandUint16Raster(
  width: number,
  height: number,
  rowsA: ReadonlyArray<ReadonlyArray<number>>,
  rowsB: ReadonlyArray<ReadonlyArray<number>>,
): RasterImage {
  return {
    bandPixels: [new Uint16Array(rowsA.flat()), new Uint16Array(rowsB.flat())],
    width,
    height,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 2,
  };
}
