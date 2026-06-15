import { describe, expect, it } from "vitest";

import {
  applyGeometricTransformToRasterImage,
  isGeometricTransform,
} from "./apply-geometric-transform";
import type { RasterImage, RasterTypedArray } from "./raster-image";

function makeSingleBandRaster(
  values: ReadonlyArray<number>,
  width: number,
  height: number,
  band: RasterTypedArray = Uint8Array.from(values),
): RasterImage {
  return { bandPixels: [band], width, height, bandCount: 1, sampleFormat: "uint", bitsPerSample: 8 };
}

// A 3-wide, 2-tall band: row0 = 1 2 3, row1 = 4 5 6.
const THREE_BY_TWO = [1, 2, 3, 4, 5, 6];

describe("applyGeometricTransformToRasterImage", () => {
  it("rotates 90 degrees clockwise and swaps width and height", () => {
    const result = applyGeometricTransformToRasterImage(makeSingleBandRaster(THREE_BY_TWO, 3, 2), "rotate-90-cw");
    expect([result.width, result.height]).toEqual([2, 3]);
    expect(Array.from(result.bandPixels[0]!)).toEqual([4, 1, 5, 2, 6, 3]);
  });

  it("rotates 180 degrees keeping the dimensions and reversing every pixel", () => {
    const result = applyGeometricTransformToRasterImage(makeSingleBandRaster(THREE_BY_TWO, 3, 2), "rotate-180");
    expect([result.width, result.height]).toEqual([3, 2]);
    expect(Array.from(result.bandPixels[0]!)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it("rotates 270 degrees clockwise and swaps width and height", () => {
    const result = applyGeometricTransformToRasterImage(makeSingleBandRaster(THREE_BY_TWO, 3, 2), "rotate-270-cw");
    expect([result.width, result.height]).toEqual([2, 3]);
    expect(Array.from(result.bandPixels[0]!)).toEqual([3, 6, 2, 5, 1, 4]);
  });

  it("flips horizontally by reversing each row", () => {
    const result = applyGeometricTransformToRasterImage(makeSingleBandRaster(THREE_BY_TWO, 3, 2), "flip-horizontal");
    expect([result.width, result.height]).toEqual([3, 2]);
    expect(Array.from(result.bandPixels[0]!)).toEqual([3, 2, 1, 6, 5, 4]);
  });

  it("flips vertically by swapping rows top to bottom", () => {
    const result = applyGeometricTransformToRasterImage(makeSingleBandRaster(THREE_BY_TWO, 3, 2), "flip-vertical");
    expect([result.width, result.height]).toEqual([3, 2]);
    expect(Array.from(result.bandPixels[0]!)).toEqual([4, 5, 6, 1, 2, 3]);
  });

  it("transforms every band of a multi-band cube together", () => {
    const raster: RasterImage = {
      bandPixels: [Uint8Array.from([1, 2, 3, 4]), Uint8Array.from([10, 20, 30, 40])],
      width: 2,
      height: 2,
      bandCount: 2,
      sampleFormat: "uint",
      bitsPerSample: 8,
    };
    const result = applyGeometricTransformToRasterImage(raster, "rotate-90-cw");
    expect(Array.from(result.bandPixels[0]!)).toEqual([3, 1, 4, 2]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([30, 10, 40, 20]);
  });

  it("preserves the source typed-array type", () => {
    const raster = makeSingleBandRaster(THREE_BY_TWO, 3, 2, Float32Array.from(THREE_BY_TWO));
    const result = applyGeometricTransformToRasterImage({ ...raster, sampleFormat: "float", bitsPerSample: 32 }, "rotate-180");
    expect(result.bandPixels[0]).toBeInstanceOf(Float32Array);
  });

  it("preserves the rgb colour interpretation so a rotated colour image stays colour", () => {
    const raster: RasterImage = {
      bandPixels: [Uint8Array.from([1, 2, 3, 4]), Uint8Array.from([5, 6, 7, 8]), Uint8Array.from([9, 10, 11, 12])],
      width: 2,
      height: 2,
      bandCount: 3,
      sampleFormat: "uint",
      bitsPerSample: 8,
      colorInterpretation: "rgb",
    };
    const result = applyGeometricTransformToRasterImage(raster, "rotate-90-cw");
    expect(result.colorInterpretation).toBe("rgb");
  });

  it("does not mutate the source raster", () => {
    const raster = makeSingleBandRaster(THREE_BY_TWO, 3, 2);
    applyGeometricTransformToRasterImage(raster, "rotate-90-cw");
    expect(Array.from(raster.bandPixels[0]!)).toEqual(THREE_BY_TWO);
    expect([raster.width, raster.height]).toEqual([3, 2]);
  });
});

describe("isGeometricTransform", () => {
  it("accepts the five supported transforms and rejects anything else", () => {
    expect(isGeometricTransform("rotate-90-cw")).toBe(true);
    expect(isGeometricTransform("flip-vertical")).toBe(true);
    expect(isGeometricTransform("rotate-45")).toBe(false);
    expect(isGeometricTransform(90)).toBe(false);
  });
});
