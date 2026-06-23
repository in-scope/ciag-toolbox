import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import { collectRoiSamples, extractCubeSampleMatrixFromRaster } from "./cube-samples";

function makeTwoBandRaster(): RasterImage {
  return {
    bandPixels: [new Uint16Array([1, 2, 3, 4]), new Uint16Array([10, 20, 30, 40])],
    width: 2,
    height: 2,
    bandCount: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
  };
}

function makeThreeByTwoBandRaster(): RasterImage {
  return {
    bandPixels: [new Uint16Array([1, 2, 3, 4, 5, 6]), new Uint16Array([10, 20, 30, 40, 50, 60])],
    width: 3,
    height: 2,
    bandCount: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
  };
}

describe("extractCubeSampleMatrixFromRaster", () => {
  it("returns one band-major Float64Array per band over every pixel", () => {
    const matrix = extractCubeSampleMatrixFromRaster(makeTwoBandRaster());
    expect(matrix.bandCount).toBe(2);
    expect(matrix.sampleCount).toBe(4);
    expect(Array.from(matrix.bandValues[0]!)).toEqual([1, 2, 3, 4]);
    expect(Array.from(matrix.bandValues[1]!)).toEqual([10, 20, 30, 40]);
  });

  it("produces Float64Array bands so integer cubes feed float math", () => {
    const matrix = extractCubeSampleMatrixFromRaster(makeTwoBandRaster());
    expect(matrix.bandValues[0]!).toBeInstanceOf(Float64Array);
  });
});

describe("collectRoiSamples", () => {
  it("returns only the in-ROI pixels for a known rectangular region", () => {
    const roi = { imagePixelX0: 1, imagePixelY0: 0, imagePixelX1: 2, imagePixelY1: 1 };
    const matrix = collectRoiSamples(makeThreeByTwoBandRaster(), roi);
    expect(matrix.bandCount).toBe(2);
    expect(matrix.sampleCount).toBe(4);
    expect(Array.from(matrix.bandValues[0]!)).toEqual([2, 3, 5, 6]);
    expect(Array.from(matrix.bandValues[1]!)).toEqual([20, 30, 50, 60]);
  });

  it("canonicalizes reversed corners and clamps them to the image bounds", () => {
    const roi = { imagePixelX0: 9, imagePixelY0: 1, imagePixelX1: 2, imagePixelY1: 1 };
    const matrix = collectRoiSamples(makeThreeByTwoBandRaster(), roi);
    expect(matrix.sampleCount).toBe(1);
    expect(Array.from(matrix.bandValues[0]!)).toEqual([6]);
  });
});
