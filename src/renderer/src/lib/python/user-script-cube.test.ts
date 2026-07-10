import { describe, expect, it } from "vitest";

import { buildUserScriptRunCubeInputFromRaster } from "./user-script-cube";
import type { RasterImage } from "@/lib/image/raster-image";

function makeUint16Raster(): RasterImage {
  return {
    bandPixels: [Uint16Array.from([100, 110]), Uint16Array.from([800, 820])],
    width: 2,
    height: 1,
    bandCount: 2,
    sampleFormat: "uint",
    bitsPerSample: 16,
  };
}

describe("buildUserScriptRunCubeInputFromRaster", () => {
  it("describes the stack shape and converts a requested band to Float32Array", () => {
    const cube = buildUserScriptRunCubeInputFromRaster(makeUint16Raster());
    expect(cube.width).toBe(2);
    expect(cube.height).toBe(1);
    expect(cube.bandCount).toBe(2);
    expect(cube.wavelengths).toBeNull();
    expect(cube.getBandAsFloat32(0)).toBeInstanceOf(Float32Array);
    expect(Array.from(cube.getBandAsFloat32(1))).toEqual([800, 820]);
  });

  it("passes an existing float band through without re-copying its contents", () => {
    const floatBand = Float32Array.from([1.5, 2.5]);
    const raster: RasterImage = {
      bandPixels: [floatBand],
      width: 2,
      height: 1,
      bandCount: 1,
      sampleFormat: "float",
      bitsPerSample: 32,
    };
    expect(buildUserScriptRunCubeInputFromRaster(raster).getBandAsFloat32(0)).toBe(floatBand);
  });

  it("rejects a band index outside the stack", () => {
    const cube = buildUserScriptRunCubeInputFromRaster(makeUint16Raster());
    expect(() => cube.getBandAsFloat32(2)).toThrow(/no band at the requested index/);
  });
});
