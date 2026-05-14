import { describe, expect, it } from "vitest";

import {
  cloneRasterImage,
  clampBandIndexToRaster,
  getRasterBandLabelOrDefault,
  getRasterBandPixelsOrThrow,
  type RasterImage,
} from "@/lib/image/raster-image";

describe("cloneRasterImage", () => {
  it("returns an independent copy with the same metadata and values", () => {
    const original = buildSampleRasterImage();
    const copy = cloneRasterImage(original);
    expect(copy).not.toBe(original);
    expect(copy.bandPixels).not.toBe(original.bandPixels);
    expect(copy.bandPixels[0]).not.toBe(original.bandPixels[0]);
    expect(Array.from(copy.bandPixels[0]!)).toEqual(Array.from(original.bandPixels[0]!));
    expect(copy.width).toBe(original.width);
    expect(copy.height).toBe(original.height);
    expect(copy.bitsPerSample).toBe(original.bitsPerSample);
    expect(copy.sampleFormat).toBe(original.sampleFormat);
    expect(copy.bandCount).toBe(original.bandCount);
  });

  it("does not propagate mutations from the copy back to the original", () => {
    const original = buildSampleRasterImage();
    const copy = cloneRasterImage(original);
    (copy.bandPixels[0] as Uint16Array)[0] = 9999;
    expect(original.bandPixels[0]![0]).toBe(10);
  });

  it("preserves the typed array constructor of each band", () => {
    const original = buildSampleRasterImage();
    const copy = cloneRasterImage(original);
    expect(copy.bandPixels[0]).toBeInstanceOf(Uint16Array);
  });

  it("clones an independent bandLabels array when present", () => {
    const original = buildMultiBandRasterImage();
    const copy = cloneRasterImage(original);
    expect(copy.bandLabels).toEqual(original.bandLabels);
    expect(copy.bandLabels).not.toBe(original.bandLabels);
  });
});

describe("getRasterBandPixelsOrThrow", () => {
  it("returns the requested band's pixels", () => {
    const raster = buildMultiBandRasterImage();
    expect(Array.from(getRasterBandPixelsOrThrow(raster, 1))).toEqual([100, 200, 300, 400]);
  });

  it("throws when the band index is out of range", () => {
    const raster = buildSampleRasterImage();
    expect(() => getRasterBandPixelsOrThrow(raster, 5)).toThrow();
  });
});

describe("clampBandIndexToRaster", () => {
  it("clamps negative values to zero", () => {
    expect(clampBandIndexToRaster(buildSampleRasterImage(), -1)).toBe(0);
  });

  it("clamps values past the last band to the last band", () => {
    expect(clampBandIndexToRaster(buildMultiBandRasterImage(), 99)).toBe(1);
  });

  it("returns valid indices unchanged", () => {
    expect(clampBandIndexToRaster(buildMultiBandRasterImage(), 1)).toBe(1);
  });
});

describe("getRasterBandLabelOrDefault", () => {
  it("returns the explicit band label when present", () => {
    const raster = buildMultiBandRasterImage();
    expect(getRasterBandLabelOrDefault(raster, 0)).toBe("Red");
    expect(getRasterBandLabelOrDefault(raster, 1)).toBe("Green");
  });

  it("falls back to a one-based default name when no label is set", () => {
    const raster = buildSampleRasterImage();
    expect(getRasterBandLabelOrDefault(raster, 0)).toBe("Band 1");
  });
});

function buildSampleRasterImage(): RasterImage {
  return {
    bandPixels: [new Uint16Array([10, 20, 30, 40])],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
}

function buildMultiBandRasterImage(): RasterImage {
  return {
    bandPixels: [
      new Uint16Array([10, 20, 30, 40]),
      new Uint16Array([100, 200, 300, 400]),
    ],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 2,
    bandLabels: ["Red", "Green"],
  };
}
