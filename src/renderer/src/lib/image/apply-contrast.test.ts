import { describe, expect, it } from "vitest";

import { applyContrastToRasterBands } from "./apply-contrast";
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

describe("applyContrastToRasterBands", () => {
  it("leaves the band unchanged when the contrast ratio is 1", () => {
    const raster = makeUint8Raster([10, 50, 90]);
    const result = applyContrastToRasterBands(raster, [0], 1);
    expect(Array.from(result.bandPixels[0]!)).toEqual([10, 50, 90]);
  });

  it("collapses the band to its mean when the contrast ratio is 0", () => {
    const raster = makeUint8Raster([10, 50, 90]);
    const result = applyContrastToRasterBands(raster, [0], 0);
    expect(Array.from(result.bandPixels[0]!)).toEqual([50, 50, 50]);
  });

  it("expands around the mean and clips at both ends of the data-type range", () => {
    const raster = makeUint8Raster([0, 50, 100]);
    const result = applyContrastToRasterBands(raster, [0], 5);
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 50, 255]);
  });

  it("only adjusts the selected band", () => {
    const raster = makeUint8Raster([10, 50, 90], [10, 50, 90]);
    const result = applyContrastToRasterBands(raster, [1], 0);
    expect(Array.from(result.bandPixels[0]!)).toEqual([10, 50, 90]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([50, 50, 50]);
  });

  it("keeps a float band float and clips out-of-range results to [0,1]", () => {
    const raster = makeRaster([Float32Array.from([0, 0.5, 1])], "float", 32);
    const result = applyContrastToRasterBands(raster, [0], 4);
    expect(result.bandPixels[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 0.5, 1]);
  });

  it("does not mutate the source band", () => {
    const raster = makeUint8Raster([10, 50, 90]);
    applyContrastToRasterBands(raster, [0], 2);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([10, 50, 90]);
  });
});
