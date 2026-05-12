import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import {
  findStackedRasterMismatchOrNull,
  stackSingleBandRastersIntoMultiBandRaster,
  type StackableRasterEntry,
} from "./stack-rasters";

function buildSingleBandUint16Raster(
  width: number,
  height: number,
  fillValue: number,
): RasterImage {
  const pixels = new Uint16Array(width * height).fill(fillValue);
  return {
    bandPixels: [pixels],
    width,
    height,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
}

function buildEntry(
  raster: RasterImage,
  bandLabel: string,
  wavelength: number | null,
): StackableRasterEntry {
  return { raster, bandLabel, wavelength };
}

describe("findStackedRasterMismatchOrNull", () => {
  it("returns null when all properties match", () => {
    const a = buildSingleBandUint16Raster(4, 4, 0);
    const b = buildSingleBandUint16Raster(4, 4, 0);
    expect(findStackedRasterMismatchOrNull(a, b)).toBeNull();
  });

  it("flags width divergence", () => {
    const a = buildSingleBandUint16Raster(4, 4, 0);
    const b = buildSingleBandUint16Raster(8, 4, 0);
    const mismatch = findStackedRasterMismatchOrNull(a, b);
    expect(mismatch?.propertyName).toBe("width");
    expect(mismatch?.baselineValue).toBe(4);
    expect(mismatch?.observedValue).toBe(8);
  });

  it("flags height divergence", () => {
    const a = buildSingleBandUint16Raster(4, 4, 0);
    const b = buildSingleBandUint16Raster(4, 8, 0);
    expect(findStackedRasterMismatchOrNull(a, b)?.propertyName).toBe("height");
  });

  it("flags bitsPerSample divergence", () => {
    const a = buildSingleBandUint16Raster(4, 4, 0);
    const b = { ...buildSingleBandUint16Raster(4, 4, 0), bitsPerSample: 8 };
    expect(findStackedRasterMismatchOrNull(a, b)?.propertyName).toBe("bitsPerSample");
  });

  it("flags sampleFormat divergence", () => {
    const a = buildSingleBandUint16Raster(4, 4, 0);
    const b: RasterImage = { ...buildSingleBandUint16Raster(4, 4, 0), sampleFormat: "int" };
    expect(findStackedRasterMismatchOrNull(a, b)?.propertyName).toBe("sampleFormat");
  });
});

describe("stackSingleBandRastersIntoMultiBandRaster", () => {
  it("stacks two compatible single-band rasters into a two-band raster", () => {
    const a = buildSingleBandUint16Raster(2, 2, 100);
    const b = buildSingleBandUint16Raster(2, 2, 200);
    const stack = stackSingleBandRastersIntoMultiBandRaster([
      buildEntry(a, "A", 365),
      buildEntry(b, "B", 450),
    ]);
    expect(stack.bandCount).toBe(2);
    expect(stack.width).toBe(2);
    expect(stack.height).toBe(2);
    expect(stack.bandPixels.length).toBe(2);
    expect(stack.bandPixels[0]?.[0]).toBe(100);
    expect(stack.bandPixels[1]?.[0]).toBe(200);
  });

  it("propagates band labels and wavelengths in order when every wavelength is present", () => {
    const stack = stackSingleBandRastersIntoMultiBandRaster([
      buildEntry(buildSingleBandUint16Raster(2, 2, 0), "365 nm", 365),
      buildEntry(buildSingleBandUint16Raster(2, 2, 0), "450 nm", 450),
    ]);
    expect(stack.bandLabels).toEqual(["365 nm", "450 nm"]);
    expect(stack.bandWavelengths).toEqual([365, 450]);
  });

  it("omits bandWavelengths when any entry has no wavelength", () => {
    const stack = stackSingleBandRastersIntoMultiBandRaster([
      buildEntry(buildSingleBandUint16Raster(2, 2, 0), "A", 365),
      buildEntry(buildSingleBandUint16Raster(2, 2, 0), "B", null),
    ]);
    expect(stack.bandWavelengths).toBeUndefined();
    expect(stack.bandLabels).toEqual(["A", "B"]);
  });

  it("throws when an entry diverges on width from the baseline", () => {
    expect(() =>
      stackSingleBandRastersIntoMultiBandRaster([
        buildEntry(buildSingleBandUint16Raster(2, 2, 0), "A", 365),
        buildEntry(buildSingleBandUint16Raster(4, 2, 0), "B", 450),
      ]),
    ).toThrow(/width/);
  });

  it("throws when fewer than two entries are provided", () => {
    expect(() =>
      stackSingleBandRastersIntoMultiBandRaster([
        buildEntry(buildSingleBandUint16Raster(2, 2, 0), "A", 365),
      ]),
    ).toThrow(/two or more bands/);
  });
});
