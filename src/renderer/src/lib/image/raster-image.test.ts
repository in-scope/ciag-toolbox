import { describe, expect, it } from "vitest";

import { cloneRasterImage, type RasterImage } from "@/lib/image/raster-image";

describe("cloneRasterImage", () => {
  it("returns an independent copy with the same metadata and values", () => {
    const original = buildSampleUint16RasterImage();
    const copy = cloneRasterImage(original);
    expect(copy).not.toBe(original);
    expect(copy.pixels).not.toBe(original.pixels);
    expect(Array.from(copy.pixels)).toEqual(Array.from(original.pixels));
    expect(copy.width).toBe(original.width);
    expect(copy.height).toBe(original.height);
    expect(copy.bitsPerSample).toBe(original.bitsPerSample);
    expect(copy.sampleFormat).toBe(original.sampleFormat);
    expect(copy.bandCount).toBe(original.bandCount);
  });

  it("does not propagate mutations from the copy back to the original", () => {
    const original = buildSampleUint16RasterImage();
    const copy = cloneRasterImage(original);
    (copy.pixels as Uint16Array)[0] = 9999;
    expect(original.pixels[0]).toBe(10);
  });

  it("preserves the typed array constructor of the source pixels", () => {
    const original = buildSampleUint16RasterImage();
    const copy = cloneRasterImage(original);
    expect(copy.pixels).toBeInstanceOf(Uint16Array);
  });
});

function buildSampleUint16RasterImage(): RasterImage {
  return {
    pixels: new Uint16Array([10, 20, 30, 40]),
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
}
