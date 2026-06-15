import { describe, expect, it } from "vitest";

import { applyBlackWhitePointsToRasterBand } from "./apply-black-white-points";
import type { RasterImage, RasterSampleFormat, RasterTypedArray } from "./raster-image";

function makeSingleBandRaster(
  band: RasterTypedArray,
  width: number,
  height: number,
  sampleFormat: RasterSampleFormat,
  bitsPerSample: number,
): RasterImage {
  return {
    bandPixels: [band],
    width,
    height,
    bandCount: 1,
    sampleFormat,
    bitsPerSample,
  };
}

function makeUint8Raster(values: ReadonlyArray<number>, width: number, height: number): RasterImage {
  return makeSingleBandRaster(Uint8Array.from(values), width, height, "uint", 8);
}

describe("applyBlackWhitePointsToRasterBand", () => {
  it("linearly stretches the whole band so black maps to 0 and white to the type max", () => {
    const raster = makeUint8Raster([0, 64, 128, 255], 4, 1);
    const result = applyBlackWhitePointsToRasterBand(raster, 0, { black: 0, white: 128 });
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 128, 255, 255]);
  });

  it("clips values below the black point to the type minimum", () => {
    const raster = makeUint8Raster([10, 30, 90], 3, 1);
    const result = applyBlackWhitePointsToRasterBand(raster, 0, { black: 30, white: 90 });
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 0, 255]);
  });

  it("leaves an identity mapping when black/white span the full type range", () => {
    const raster = makeUint8Raster([0, 17, 200, 255], 4, 1);
    const result = applyBlackWhitePointsToRasterBand(raster, 0, { black: 0, white: 255 });
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 17, 200, 255]);
  });

  it("remaps only the pixels inside the ROI and leaves the rest unchanged", () => {
    const raster = makeUint8Raster([10, 20, 30, 40], 2, 2);
    const result = applyBlackWhitePointsToRasterBand(raster, 0, { black: 10, white: 40 }, {
      region: { imagePixelX0: 0, imagePixelY0: 0, imagePixelX1: 0, imagePixelY1: 0 },
    });
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 20, 30, 40]);
  });

  it("stretches a float [0,1] band and clips out-of-range results to [0,1]", () => {
    const band = Float32Array.from([0, 0.5, 1]);
    const raster = makeSingleBandRaster(band, 3, 1, "float", 32);
    const result = applyBlackWhitePointsToRasterBand(raster, 0, { black: 0.25, white: 0.75 });
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 0.5, 1]);
  });

  it("does not mutate the source raster band", () => {
    const raster = makeUint8Raster([0, 128, 255], 3, 1);
    applyBlackWhitePointsToRasterBand(raster, 0, { black: 0, white: 64 });
    expect(Array.from(raster.bandPixels[0]!)).toEqual([0, 128, 255]);
  });

  it("rejects a white point that is not above the black point", () => {
    const raster = makeUint8Raster([0, 128, 255], 3, 1);
    expect(() => applyBlackWhitePointsToRasterBand(raster, 0, { black: 200, white: 200 })).toThrow(
      /must be greater than black point/,
    );
  });
});
