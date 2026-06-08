import { describe, expect, it } from "vitest";

import { applyNormalizeToRaster } from "./apply-normalize";
import type { RasterImage } from "./raster-image";

function makeTwoBandUint8Raster(
  bandOne: ReadonlyArray<number>,
  bandTwo: ReadonlyArray<number>,
): RasterImage {
  return {
    bandPixels: [Uint8Array.from(bandOne), Uint8Array.from(bandTwo)],
    width: bandOne.length,
    height: 1,
    bandCount: 2,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

describe("applyNormalizeToRaster", () => {
  it("scales the whole cube by one cube-wide min and max", () => {
    const raster = makeTwoBandUint8Raster([0, 100], [100, 200]);
    const result = applyNormalizeToRaster(raster, { scope: "full-cube" });
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 0.5]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([0.5, 1]);
  });

  it("emits a float32 [0,1] raster from an integer source", () => {
    const result = applyNormalizeToRaster(makeTwoBandUint8Raster([0, 200], [50, 100]), {
      scope: "full-cube",
    });
    expect(result.sampleFormat).toBe("float");
    expect(result.bitsPerSample).toBe(32);
    expect(result.bandPixels[0]).toBeInstanceOf(Float32Array);
  });

  it("scales each selected band by its own min and max in band-wise scope", () => {
    const raster = makeTwoBandUint8Raster([0, 100], [100, 200]);
    const result = applyNormalizeToRaster(raster, { scope: "band-wise", bandIndexes: [0, 1] });
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 1]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([0, 1]);
  });

  it("distinguishes all-bands band-wise from full-cube", () => {
    const raster = makeTwoBandUint8Raster([0, 100], [100, 200]);
    const fullCube = applyNormalizeToRaster(raster, { scope: "full-cube" });
    const bandWise = applyNormalizeToRaster(raster, { scope: "band-wise", bandIndexes: [0, 1] });
    expect(Array.from(fullCube.bandPixels[1]!)).toEqual([0.5, 1]);
    expect(Array.from(bandWise.bandPixels[1]!)).toEqual([0, 1]);
  });

  it("leaves non-selected bands unchanged in band-wise scope", () => {
    const raster = makeTwoBandUint8Raster([0, 100], [100, 200]);
    const result = applyNormalizeToRaster(raster, { scope: "band-wise", bandIndexes: [0] });
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 1]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([100, 200]);
  });

  it("maps a constant band to zero without producing NaN", () => {
    const raster = makeTwoBandUint8Raster([50, 50], [10, 90]);
    const bandWise = applyNormalizeToRaster(raster, { scope: "band-wise", bandIndexes: [0, 1] });
    expect(Array.from(bandWise.bandPixels[0]!)).toEqual([0, 0]);
    expect(Array.from(bandWise.bandPixels[1]!)).toEqual([0, 1]);
  });

  it("maps a fully constant cube to zero without producing NaN in full-cube scope", () => {
    const raster = makeTwoBandUint8Raster([7, 7], [7, 7]);
    const result = applyNormalizeToRaster(raster, { scope: "full-cube" });
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 0]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([0, 0]);
  });

  it("does not mutate the source raster", () => {
    const raster = makeTwoBandUint8Raster([0, 100], [100, 200]);
    applyNormalizeToRaster(raster, { scope: "full-cube" });
    expect(Array.from(raster.bandPixels[0]!)).toEqual([0, 100]);
  });
});
