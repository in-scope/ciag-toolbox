import { describe, expect, it } from "vitest";

import { buildFalseColorPreviewSourceOrNull } from "./false-color-preview-pixels";
import type { RasterImage } from "@/lib/image/raster-image";

function makeThreeBandRaster(): RasterImage {
  return {
    bandPixels: [
      Uint8Array.from([0, 50, 100]),
      Uint8Array.from([10, 10, 10]),
      Float32Array.from([0, 1, 2]),
    ],
    width: 3,
    height: 1,
    bandCount: 3,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

function readPixelsSourceOrThrow(
  source: ReturnType<typeof buildFalseColorPreviewSourceOrNull>,
): { pixels: Uint8ClampedArray | Uint8Array; width: number; height: number } {
  if (!source || source.kind !== "pixels") throw new Error("expected a pixels source");
  return source;
}

describe("buildFalseColorPreviewSourceOrNull", () => {
  it("returns an RGBA pixels source sized to the raster", () => {
    const source = readPixelsSourceOrThrow(buildFalseColorPreviewSourceOrNull(makeThreeBandRaster(), { r: 1, g: 2, b: 3 }));
    expect(source.width).toBe(3);
    expect(source.height).toBe(1);
    expect(source.pixels.length).toBe(3 * 4);
  });

  it("stretches the R channel band to [0,255] by its own min and max", () => {
    const source = readPixelsSourceOrThrow(buildFalseColorPreviewSourceOrNull(makeThreeBandRaster(), { r: 1, g: 2, b: 3 }));
    expect(source.pixels[0]).toBe(0);
    expect(source.pixels[4]).toBe(Math.round((50 / 100) * 255));
    expect(source.pixels[8]).toBe(255);
  });

  it("maps a constant band to 0 without producing NaN", () => {
    const source = readPixelsSourceOrThrow(buildFalseColorPreviewSourceOrNull(makeThreeBandRaster(), { r: 1, g: 2, b: 3 }));
    expect(source.pixels[1]).toBe(0);
    expect(source.pixels[5]).toBe(0);
    expect(source.pixels[9]).toBe(0);
  });

  it("writes a fully opaque alpha channel", () => {
    const source = readPixelsSourceOrThrow(buildFalseColorPreviewSourceOrNull(makeThreeBandRaster(), { r: 1, g: 2, b: 3 }));
    expect(source.pixels[3]).toBe(255);
    expect(source.pixels[7]).toBe(255);
    expect(source.pixels[11]).toBe(255);
  });

  it("is order-sensitive: the R channel reflects the chosen R band", () => {
    const source = readPixelsSourceOrThrow(buildFalseColorPreviewSourceOrNull(makeThreeBandRaster(), { r: 3, g: 1, b: 2 }));
    expect(source.pixels[0]).toBe(0);
    expect(source.pixels[4]).toBe(Math.round((1 / 2) * 255));
    expect(source.pixels[8]).toBe(255);
  });

  it("returns null when any band number is out of range", () => {
    expect(buildFalseColorPreviewSourceOrNull(makeThreeBandRaster(), { r: 1, g: 2, b: 4 })).toBeNull();
    expect(buildFalseColorPreviewSourceOrNull(makeThreeBandRaster(), { r: 0, g: 2, b: 3 })).toBeNull();
  });
});
