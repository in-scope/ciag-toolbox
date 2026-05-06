import { describe, expect, it } from "vitest";

import {
  computePixelSpectrumOrNull,
  computeRoiMeanSpectrumOrNull,
} from "@/lib/image/compute-spectrum";
import type { RasterImage } from "@/lib/image/raster-image";

function buildRasterFromBands(
  width: number,
  height: number,
  bandPixels: ReadonlyArray<ReadonlyArray<number>>,
): RasterImage {
  return {
    bandPixels: bandPixels.map((band) => Float32Array.from(band)),
    width,
    height,
    bitsPerSample: 32,
    sampleFormat: "float",
    bandCount: bandPixels.length,
  };
}

describe("computePixelSpectrumOrNull", () => {
  it("returns one sample per band at the chosen pixel", () => {
    const raster = buildRasterFromBands(2, 2, [
      [1, 2, 3, 4],
      [10, 20, 30, 40],
      [100, 200, 300, 400],
    ]);
    const spectrum = computePixelSpectrumOrNull(raster, 1, 0);
    expect(spectrum?.bandValues).toEqual([2, 20, 200]);
  });

  it("returns null when the pixel is outside the raster", () => {
    const raster = buildRasterFromBands(2, 2, [[1, 2, 3, 4]]);
    expect(computePixelSpectrumOrNull(raster, -1, 0)).toBeNull();
    expect(computePixelSpectrumOrNull(raster, 0, -1)).toBeNull();
    expect(computePixelSpectrumOrNull(raster, 2, 0)).toBeNull();
    expect(computePixelSpectrumOrNull(raster, 0, 2)).toBeNull();
  });
});

describe("computeRoiMeanSpectrumOrNull", () => {
  it("computes mean and zero standard deviation for a uniform region", () => {
    const raster = buildRasterFromBands(2, 2, [
      [5, 5, 5, 5],
      [7, 7, 7, 7],
    ]);
    const result = computeRoiMeanSpectrumOrNull(raster, {
      imagePixelX0: 0,
      imagePixelY0: 0,
      imagePixelX1: 1,
      imagePixelY1: 1,
    });
    expect(result?.bandMeans).toEqual([5, 7]);
    expect(result?.bandStandardDeviations).toEqual([0, 0]);
    expect(result?.samplePixelCount).toBe(4);
  });

  it("computes mean and population standard deviation across a 1x4 stripe", () => {
    const raster = buildRasterFromBands(4, 1, [[2, 4, 4, 6]]);
    const result = computeRoiMeanSpectrumOrNull(raster, {
      imagePixelX0: 0,
      imagePixelY0: 0,
      imagePixelX1: 3,
      imagePixelY1: 0,
    });
    expect(result?.bandMeans).toEqual([4]);
    expect(result?.samplePixelCount).toBe(4);
    expect(result?.bandStandardDeviations[0]).toBeCloseTo(Math.sqrt(2), 6);
  });

  it("clamps the ROI to the raster's pixel bounds", () => {
    const raster = buildRasterFromBands(2, 2, [[1, 2, 3, 4]]);
    const result = computeRoiMeanSpectrumOrNull(raster, {
      imagePixelX0: -10,
      imagePixelY0: -10,
      imagePixelX1: 10,
      imagePixelY1: 10,
    });
    expect(result?.bandMeans).toEqual([2.5]);
    expect(result?.samplePixelCount).toBe(4);
  });

  it("handles a single-pixel ROI", () => {
    const raster = buildRasterFromBands(3, 3, [[1, 2, 3, 4, 5, 6, 7, 8, 9]]);
    const result = computeRoiMeanSpectrumOrNull(raster, {
      imagePixelX0: 1,
      imagePixelY0: 1,
      imagePixelX1: 1,
      imagePixelY1: 1,
    });
    expect(result?.bandMeans).toEqual([5]);
    expect(result?.bandStandardDeviations).toEqual([0]);
    expect(result?.samplePixelCount).toBe(1);
  });
});
