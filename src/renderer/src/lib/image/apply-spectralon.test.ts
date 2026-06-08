import { describe, expect, it } from "vitest";

import { applySpectralonReflectanceCalibration } from "@/lib/image/apply-spectralon";
import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";
import type { ViewportRoi } from "@/lib/image/viewport-roi";

// All test rasters are 2x2 so a bright/dark ROI can be a distinct sub-region.
// Row 0 = (0,0),(1,0); row 1 = (0,1),(1,1).
const TOP_ROW: ViewportRoi = { imagePixelX0: 0, imagePixelY0: 0, imagePixelX1: 1, imagePixelY1: 0 };
const BOTTOM_ROW: ViewportRoi = { imagePixelX0: 0, imagePixelY0: 1, imagePixelX1: 1, imagePixelY1: 1 };
const WHOLE_IMAGE: ViewportRoi = { imagePixelX0: 0, imagePixelY0: 0, imagePixelX1: 1, imagePixelY1: 1 };

describe("applySpectralonReflectanceCalibration", () => {
  it("divides by the bright ROI mean (W) when no dark ROI is given (D = 0)", () => {
    const target = build2x2Raster([new Uint16Array([50, 70, 10, 30])]);
    const result = applySpectralonReflectanceCalibration(target, {
      brightRoi: WHOLE_IMAGE,
      reflectance: 1,
    });
    // W = mean(50,70,10,30) = 40. out = raw / 40.
    expect(Array.from(result.bandPixels[0]!)).toEqual([1.25, 1.75, 0.25, 0.75]);
  });

  it("subtracts the dark ROI mean and divides by (W - D)", () => {
    const target = build2x2Raster([new Uint16Array([50, 70, 10, 30])]);
    const result = applySpectralonReflectanceCalibration(target, {
      brightRoi: TOP_ROW,
      darkRoi: BOTTOM_ROW,
      reflectance: 1,
    });
    // W = mean(50,70) = 60, D = mean(10,30) = 20, W - D = 40.
    // out = (raw - 20) / 40 = [0.75, 1.25, -0.25, 0.25].
    expect(Array.from(result.bandPixels[0]!)).toEqual([0.75, 1.25, -0.25, 0.25]);
  });

  it("scales the result by the entered reflectance value", () => {
    const target = build2x2Raster([new Uint16Array([50, 70, 10, 30])]);
    const result = applySpectralonReflectanceCalibration(target, {
      brightRoi: TOP_ROW,
      darkRoi: BOTTOM_ROW,
      reflectance: 0.5,
    });
    // Same as bright+dark above, halved by reflectance 0.5.
    expect(Array.from(result.bandPixels[0]!)).toEqual([0.375, 0.625, -0.125, 0.125]);
  });

  it("calibrates each band with its own bright and dark means", () => {
    const target = build2x2Raster([
      new Uint16Array([50, 70, 10, 30]),
      new Uint16Array([6, 10, 2, 2]),
    ]);
    const result = applySpectralonReflectanceCalibration(target, {
      brightRoi: TOP_ROW,
      darkRoi: BOTTOM_ROW,
      reflectance: 1,
    });
    // Band 1: W = mean(6,10) = 8, D = mean(2,2) = 2, W - D = 6.
    // out = (raw - 2) / 6 = [4/6, 8/6, 0, 0].
    expect(result.bandPixels[1]![0]!).toBeCloseTo(4 / 6);
    expect(result.bandPixels[1]![1]!).toBeCloseTo(8 / 6);
    expect(result.bandPixels[1]![2]!).toBeCloseTo(0);
  });

  it("produces a float32 raster so out-of-range true values survive", () => {
    const target = build2x2Raster([new Uint16Array([50, 70, 10, 30])]);
    const result = applySpectralonReflectanceCalibration(target, {
      brightRoi: WHOLE_IMAGE,
      reflectance: 1,
    });
    expect(result.sampleFormat).toBe("float");
    expect(result.bandPixels[0]!).toBeInstanceOf(Float32Array);
  });

  it("aborts naming the band when the bright and dark means are equal (zero divisor)", () => {
    const target = build2x2Raster([new Uint16Array([50, 70, 10, 30])]);
    expect(() =>
      applySpectralonReflectanceCalibration(target, {
        brightRoi: TOP_ROW,
        darkRoi: TOP_ROW,
        reflectance: 1,
      }),
    ).toThrow(/divide by zero/);
  });
});

function build2x2Raster(bandPixels: ReadonlyArray<RasterTypedArray>): RasterImage {
  return {
    bandPixels,
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: bandPixels.length,
  };
}
