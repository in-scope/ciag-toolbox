import { describe, expect, it } from "vitest";
import {
  buildRasterFromRgbaBytesDetectingColor,
  buildRgbRasterFromRgbaBytes,
  coerceViewportSourceToRasterSource,
} from "@/lib/image/promote-source-to-raster";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

function buildTwoPixelRgbaBytes(): Uint8ClampedArray {
  return new Uint8ClampedArray([
    10, 20, 30, 255, // pixel 0: R=10 G=20 B=30 (alpha dropped)
    40, 50, 60, 128, // pixel 1: R=40 G=50 B=60 (alpha dropped)
  ]);
}

function buildTwoPixelGrayscaleRgbaBytes(): Uint8ClampedArray {
  return new Uint8ClampedArray([
    100, 100, 100, 255, // pixel 0: R==G==B (grayscale)
    130, 130, 130, 255, // pixel 1: R==G==B (grayscale)
  ]);
}

describe("buildRgbRasterFromRgbaBytes", () => {
  it("builds an 8-bit 3-band RGB raster with the source dimensions", () => {
    const raster = buildRgbRasterFromRgbaBytes(buildTwoPixelRgbaBytes(), 2, 1);
    expect(raster.width).toBe(2);
    expect(raster.height).toBe(1);
    expect(raster.bandCount).toBe(3);
    expect(raster.sampleFormat).toBe("uint");
    expect(raster.bitsPerSample).toBe(8);
  });

  it("splits the RGBA bytes into red, green, and blue bands, dropping alpha", () => {
    const raster = buildRgbRasterFromRgbaBytes(buildTwoPixelRgbaBytes(), 2, 1);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([10, 40]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([20, 50]);
    expect(Array.from(raster.bandPixels[2]!)).toEqual([30, 60]);
  });

  it("labels the bands Red, Green, Blue with original numbers 1, 2, 3", () => {
    const raster = buildRgbRasterFromRgbaBytes(buildTwoPixelRgbaBytes(), 2, 1);
    expect(raster.bandLabels).toEqual(["Red", "Green", "Blue"]);
    expect(raster.bandOriginalNumbers).toEqual([1, 2, 3]);
  });

  it("tags the promoted raster as an rgb colour composite so the viewport shows colour", () => {
    const raster = buildRgbRasterFromRgbaBytes(buildTwoPixelRgbaBytes(), 2, 1);
    expect(raster.colorInterpretation).toBe("rgb");
  });

  it("throws when the RGBA buffer is too short for the declared pixel count", () => {
    expect(() => buildRgbRasterFromRgbaBytes(new Uint8ClampedArray(4), 2, 1)).toThrow(
      /RGBA buffer/,
    );
  });
});

describe("buildRasterFromRgbaBytesDetectingColor", () => {
  it("promotes colour RGBA bytes to a 3-band rgb composite raster", () => {
    const raster = buildRasterFromRgbaBytesDetectingColor(buildTwoPixelRgbaBytes(), 2, 1);
    expect(raster.bandCount).toBe(3);
    expect(raster.colorInterpretation).toBe("rgb");
    expect(raster.bandLabels).toEqual(["Red", "Green", "Blue"]);
  });

  it("promotes grayscale RGBA bytes (R==G==B) to a single-band raster with no rgb tag", () => {
    const raster = buildRasterFromRgbaBytesDetectingColor(buildTwoPixelGrayscaleRgbaBytes(), 2, 1);
    expect(raster.bandCount).toBe(1);
    expect(raster.colorInterpretation).toBeUndefined();
    expect(raster.sampleFormat).toBe("uint");
    expect(raster.bitsPerSample).toBe(8);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([100, 130]);
  });
});

describe("coerceViewportSourceToRasterSource", () => {
  it("returns a raster source unchanged", () => {
    const raster: RasterImage = {
      bandPixels: [new Uint8Array([1])],
      width: 1,
      height: 1,
      bitsPerSample: 8,
      sampleFormat: "uint",
      bandCount: 1,
    };
    const source: ViewportImageSource = { kind: "raster", raster };
    expect(coerceViewportSourceToRasterSource(source)).toBe(source);
  });

  it("promotes a browser-decoded pixels source to a 3-band RGB raster", () => {
    const source: ViewportImageSource = {
      kind: "pixels",
      pixels: buildTwoPixelRgbaBytes(),
      width: 2,
      height: 1,
    };
    const coerced = coerceViewportSourceToRasterSource(source);
    expect(coerced.kind).toBe("raster");
    expect(coerced.raster.bandCount).toBe(3);
    expect(Array.from(coerced.raster.bandPixels[0]!)).toEqual([10, 40]);
  });

  it("promotes a grayscale browser-decoded pixels source to a single-band raster", () => {
    const source: ViewportImageSource = {
      kind: "pixels",
      pixels: buildTwoPixelGrayscaleRgbaBytes(),
      width: 2,
      height: 1,
    };
    const coerced = coerceViewportSourceToRasterSource(source);
    expect(coerced.raster.bandCount).toBe(1);
    expect(coerced.raster.colorInterpretation).toBeUndefined();
  });
});
