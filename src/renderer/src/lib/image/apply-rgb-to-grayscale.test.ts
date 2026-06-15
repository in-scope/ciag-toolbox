import { describe, expect, it } from "vitest";

import {
  applyRgbToGrayscale,
  assertRasterIsThreeBandRgb,
  LUMINANCE_GRAYSCALE_WEIGHTS,
  type RgbToGrayscaleWeights,
} from "./apply-rgb-to-grayscale";
import type { RasterImage } from "./raster-image";

const STRAIGHT_AVERAGE_WEIGHTS: RgbToGrayscaleWeights = {
  red: 1 / 3,
  green: 1 / 3,
  blue: 1 / 3,
};

function makeThreeBandUint8Rgb(
  red: ReadonlyArray<number>,
  green: ReadonlyArray<number>,
  blue: ReadonlyArray<number>,
): RasterImage {
  return {
    bandPixels: [Uint8Array.from(red), Uint8Array.from(green), Uint8Array.from(blue)],
    width: red.length,
    height: 1,
    bandCount: 3,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

function makeThreeBandFloatRgb(
  red: ReadonlyArray<number>,
  green: ReadonlyArray<number>,
  blue: ReadonlyArray<number>,
): RasterImage {
  return {
    bandPixels: [Float32Array.from(red), Float32Array.from(green), Float32Array.from(blue)],
    width: red.length,
    height: 1,
    bandCount: 3,
    sampleFormat: "float",
    bitsPerSample: 32,
  };
}

describe("applyRgbToGrayscale", () => {
  it("collapses a 3-band RGB image into one band with the default luminance weights", () => {
    const rgb = makeThreeBandUint8Rgb([100, 0], [200, 0], [50, 0]);
    const result = applyRgbToGrayscale(rgb, LUMINANCE_GRAYSCALE_WEIGHTS);
    expect(result.bandCount).toBe(1);
    expect(result.bandPixels).toHaveLength(1);
    const expectedFirst = Math.round(100 * 0.299 + 200 * 0.587 + 50 * 0.114);
    expect(Array.from(result.bandPixels[0]!)).toEqual([expectedFirst, 0]);
  });

  it("uses custom weights such as a straight 1/3 average", () => {
    const rgb = makeThreeBandUint8Rgb([30], [60], [90]);
    const result = applyRgbToGrayscale(rgb, STRAIGHT_AVERAGE_WEIGHTS);
    expect(Array.from(result.bandPixels[0]!)).toEqual([60]);
  });

  it("rounds and clamps integer output into the data-type range", () => {
    const rgb = makeThreeBandUint8Rgb([255], [255], [255]);
    const result = applyRgbToGrayscale(rgb, { red: 1, green: 1, blue: 1 });
    expect(Array.from(result.bandPixels[0]!)).toEqual([255]);
  });

  it("preserves a float source type and keeps fractional values", () => {
    const rgb = makeThreeBandFloatRgb([0.5], [0.25], [0.75]);
    const result = applyRgbToGrayscale(rgb, STRAIGHT_AVERAGE_WEIGHTS);
    expect(result.sampleFormat).toBe("float");
    expect(result.bandPixels[0]).toBeInstanceOf(Float32Array);
    expect(result.bandPixels[0]![0]).toBeCloseTo(0.5);
  });

  it("labels the produced band and resets band metadata to a single band", () => {
    const rgb = makeThreeBandUint8Rgb([10], [20], [30]);
    const result = applyRgbToGrayscale(rgb, LUMINANCE_GRAYSCALE_WEIGHTS);
    expect(result.bandLabels).toEqual(["Grayscale"]);
    expect(result.bandOriginalNumbers).toEqual([1]);
    expect(result.bandWavelengths).toBeUndefined();
  });

  it("does not mutate the source raster", () => {
    const rgb = makeThreeBandUint8Rgb([100], [200], [50]);
    applyRgbToGrayscale(rgb, LUMINANCE_GRAYSCALE_WEIGHTS);
    expect(rgb.bandCount).toBe(3);
    expect(Array.from(rgb.bandPixels[0]!)).toEqual([100]);
  });

  it("rejects a source that is not 3-band RGB", () => {
    const twoBand: RasterImage = {
      bandPixels: [Uint8Array.from([1]), Uint8Array.from([2])],
      width: 1,
      height: 1,
      bandCount: 2,
      sampleFormat: "uint",
      bitsPerSample: 8,
    };
    expect(() => applyRgbToGrayscale(twoBand, LUMINANCE_GRAYSCALE_WEIGHTS)).toThrow(/3-band RGB/i);
  });
});

describe("assertRasterIsThreeBandRgb", () => {
  it("passes for a 3-band raster and throws otherwise", () => {
    expect(() => assertRasterIsThreeBandRgb(makeThreeBandUint8Rgb([1], [2], [3]))).not.toThrow();
    const oneBand: RasterImage = {
      bandPixels: [Uint8Array.from([1])],
      width: 1,
      height: 1,
      bandCount: 1,
      sampleFormat: "uint",
      bitsPerSample: 8,
    };
    expect(() => assertRasterIsThreeBandRgb(oneBand)).toThrow(/3-band RGB/i);
  });
});
