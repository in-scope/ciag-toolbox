import { describe, expect, it } from "vitest";

import { buildUserScriptCubeFromRaster } from "./user-script-cube";
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

describe("buildUserScriptCubeFromRaster", () => {
  it("converts every band to Float32Array and carries the spatial dimensions", () => {
    const cube = buildUserScriptCubeFromRaster(makeUint16Raster());
    expect(cube.width).toBe(2);
    expect(cube.height).toBe(1);
    expect(cube.wavelengths).toBeNull();
    expect(cube.bands).toHaveLength(2);
    expect(cube.bands[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(cube.bands[1]!)).toEqual([800, 820]);
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
    expect(buildUserScriptCubeFromRaster(raster).bands[0]).toBe(floatBand);
  });
});
