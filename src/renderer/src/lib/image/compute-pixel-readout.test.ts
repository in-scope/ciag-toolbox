import { describe, expect, it } from "vitest";

import {
  formatPixelReadoutValueForDisplay,
  formatPixelReadoutValuesAsCommaSeparatedList,
  readPixelReadoutBandsAtImagePointOrNull,
} from "./compute-pixel-readout";
import type { RasterImage } from "./raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

function buildSingleBandRaster(): RasterImage {
  return {
    bandPixels: [new Uint16Array([10, 20, 30, 40])],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
}

function buildMultiBandRaster(): RasterImage {
  return {
    bandPixels: [
      new Uint16Array([1, 2, 3, 4]),
      new Uint16Array([10, 20, 30, 40]),
      new Float32Array([0.1, 0.2, 0.3, 0.4]),
    ],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 3,
    bandLabels: ["R", "G", "B"],
  };
}

describe("readPixelReadoutBandsAtImagePointOrNull", () => {
  it("reads the value at the requested raster pixel for a single-band source", () => {
    const source: ViewportImageSource = { kind: "raster", raster: buildSingleBandRaster() };
    const bands = readPixelReadoutBandsAtImagePointOrNull(source, 1, 1);
    expect(bands).not.toBeNull();
    expect(bands!.values).toEqual([40]);
    expect(bands!.sampleFormat).toBe("uint");
  });

  it("collects one value per band for a multi-band raster source", () => {
    const source: ViewportImageSource = { kind: "raster", raster: buildMultiBandRaster() };
    const bands = readPixelReadoutBandsAtImagePointOrNull(source, 0, 1);
    expect(bands!.values).toEqual([3, 30, expect.closeTo(0.3, 5)]);
    expect(bands!.labels).toEqual(["R", "G", "B"]);
  });

  it("returns null when the requested raster pixel is outside image bounds", () => {
    const source: ViewportImageSource = { kind: "raster", raster: buildSingleBandRaster() };
    expect(readPixelReadoutBandsAtImagePointOrNull(source, 2, 0)).toBeNull();
    expect(readPixelReadoutBandsAtImagePointOrNull(source, 0, -1)).toBeNull();
  });

  it("returns RGBA channel values for a browser pixels source", () => {
    const pixelsSource: ViewportImageSource = {
      kind: "pixels",
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray([255, 128, 64, 32]),
    };
    const bands = readPixelReadoutBandsAtImagePointOrNull(pixelsSource, 0, 0);
    expect(bands!.values).toEqual([255, 128, 64, 32]);
    expect(bands!.labels).toEqual(["Red", "Green", "Blue", "Alpha"]);
    expect(bands!.sampleFormat).toBe("uint");
  });

  it("returns null for image-bitmap sources because pixel data is not retained", () => {
    const dummyBitmap = { width: 4, height: 4 } as unknown as ImageBitmap;
    const source: ViewportImageSource = { kind: "image-bitmap", image: dummyBitmap };
    expect(readPixelReadoutBandsAtImagePointOrNull(source, 0, 0)).toBeNull();
  });
});

describe("formatPixelReadoutValueForDisplay", () => {
  it("formats integer-format values as plain integers", () => {
    expect(formatPixelReadoutValueForDisplay(1234, "uint")).toBe("1234");
    expect(formatPixelReadoutValueForDisplay(-7, "int")).toBe("-7");
  });

  it("formats float-format values to four significant figures", () => {
    expect(formatPixelReadoutValueForDisplay(0.123456, "float")).toBe("0.1235");
    expect(formatPixelReadoutValueForDisplay(1234.5678, "float")).toBe("1235");
    expect(formatPixelReadoutValueForDisplay(0, "float")).toBe("0");
  });

  it("returns a placeholder dash when the value is not finite", () => {
    expect(formatPixelReadoutValueForDisplay(Number.NaN, "uint")).toBe("-");
    expect(formatPixelReadoutValueForDisplay(Number.POSITIVE_INFINITY, "float")).toBe("-");
  });
});

describe("formatPixelReadoutValuesAsCommaSeparatedList", () => {
  it("joins multiple values with comma + space", () => {
    expect(formatPixelReadoutValuesAsCommaSeparatedList([10, 20, 30], "uint")).toBe("10, 20, 30");
  });
});
