import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import { buildRgbaBytesFromRgbRaster } from "@/lib/image/rgb-raster-to-rgba";

describe("buildRgbaBytesFromRgbRaster", () => {
  it("interleaves the three bands into opaque RGBA bytes", () => {
    const raster = buildThreeBandRgbUint8Raster([200, 10], [100, 20], [50, 30]);
    const rgba = buildRgbaBytesFromRgbRaster(raster);
    expect(Array.from(rgba)).toEqual([200, 100, 50, 255, 10, 20, 30, 255]);
  });

  it("returns a clamped byte buffer the size of width*height*4", () => {
    const raster = buildThreeBandRgbUint8Raster([1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]);
    const rgba = buildRgbaBytesFromRgbRaster(raster);
    expect(rgba).toBeInstanceOf(Uint8ClampedArray);
    expect(rgba.length).toBe(16);
  });
});

function buildThreeBandRgbUint8Raster(
  red: ReadonlyArray<number>,
  green: ReadonlyArray<number>,
  blue: ReadonlyArray<number>,
): RasterImage {
  return {
    width: red.length,
    height: 1,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: 3,
    bandPixels: [Uint8Array.from(red), Uint8Array.from(green), Uint8Array.from(blue)],
    colorInterpretation: "rgb",
  };
}
