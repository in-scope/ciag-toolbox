import { describe, expect, it } from "vitest";

import {
  applyBrightnessToRasterBands,
  brightnessDeltaForRangeFractionOfBand,
} from "./apply-brightness";
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

describe("applyBrightnessToRasterBands", () => {
  it("adds a positive constant to the selected band only", () => {
    const raster = makeUint8Raster([0, 10, 20], [0, 10, 20]);
    const result = applyBrightnessToRasterBands(raster, [0], 5);
    expect(Array.from(result.bandPixels[0]!)).toEqual([5, 15, 25]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([0, 10, 20]);
  });

  it("clips above the data-type maximum when brightening past the range", () => {
    const raster = makeUint8Raster([200, 250, 255]);
    const result = applyBrightnessToRasterBands(raster, [0], 100);
    expect(Array.from(result.bandPixels[0]!)).toEqual([255, 255, 255]);
  });

  it("clips below the data-type minimum when darkening past the range", () => {
    const raster = makeUint8Raster([10, 40, 100]);
    const result = applyBrightnessToRasterBands(raster, [0], -50);
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 0, 50]);
  });

  it("clips a float [0,1] band to its display range and preserves the float type", () => {
    const raster = makeRaster([Float32Array.from([0, 0.25, 0.75])], "float", 32);
    const result = applyBrightnessToRasterBands(raster, [0], 0.5);
    expect(result.bandPixels[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result.bandPixels[0]!)).toEqual([0.5, 0.75, 1]);
  });

  it("does not mutate the source band", () => {
    const raster = makeUint8Raster([1, 2, 3]);
    applyBrightnessToRasterBands(raster, [0], 10);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([1, 2, 3]);
  });
});

describe("brightnessDeltaForRangeFractionOfBand", () => {
  it("scales the fraction by the uint8 container width", () => {
    const band = Uint8Array.from([0]);
    expect(brightnessDeltaForRangeFractionOfBand(band, "uint", 0.5)).toBeCloseTo(127.5);
  });

  it("treats a float band as a [0,1] range so the fraction is the delta", () => {
    const band = Float32Array.from([0]);
    expect(brightnessDeltaForRangeFractionOfBand(band, "float", 0.25)).toBeCloseTo(0.25);
  });
});
