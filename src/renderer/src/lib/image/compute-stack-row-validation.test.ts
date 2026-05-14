import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import { buildStackEntryValidationStatesInDisplayOrder } from "./compute-stack-row-validation";
import type { DecodedStackEntry } from "./open-image-stack-types";

function buildSingleBandRaster(width: number, height: number): RasterImage {
  return {
    bandPixels: [new Uint16Array(width * height)],
    width,
    height,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
}

function buildMultiBandRaster(bandCount: number): RasterImage {
  const pixels: Uint16Array[] = [];
  for (let i = 0; i < bandCount; i++) pixels.push(new Uint16Array(4));
  return {
    bandPixels: pixels,
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount,
  };
}

function buildDecodedEntry(
  fileName: string,
  raster: RasterImage | null,
  decodeError: string | null = null,
): DecodedStackEntry {
  return {
    fileName,
    filePath: `/tmp/${fileName}`,
    fileSizeBytes: 100,
    mtimeMs: 0,
    raster,
    decodeError,
    wavelength: null,
    differentiatingSubstring: fileName,
  };
}

describe("buildStackEntryValidationStatesInDisplayOrder", () => {
  it("marks the first single-page entry as valid and treats it as baseline", () => {
    const baselineRaster = buildSingleBandRaster(4, 4);
    const states = buildStackEntryValidationStatesInDisplayOrder([
      buildDecodedEntry("a.tif", baselineRaster),
      buildDecodedEntry("b.tif", buildSingleBandRaster(4, 4)),
    ]);
    expect(states[0]).toEqual({ kind: "valid" });
    expect(states[1]).toEqual({ kind: "valid" });
  });

  it("flags property mismatch against the first single-page baseline", () => {
    const states = buildStackEntryValidationStatesInDisplayOrder([
      buildDecodedEntry("a.tif", buildSingleBandRaster(4, 4)),
      buildDecodedEntry("b.tif", buildSingleBandRaster(8, 4)),
    ]);
    expect(states[1]?.kind).toBe("property-mismatch");
  });

  it("flags multi-page TIFFs as multi-page errors regardless of order", () => {
    const states = buildStackEntryValidationStatesInDisplayOrder([
      buildDecodedEntry("a.tif", buildMultiBandRaster(3)),
      buildDecodedEntry("b.tif", buildSingleBandRaster(4, 4)),
    ]);
    expect(states[0]?.kind).toBe("multi-page");
    expect(states[1]?.kind).toBe("valid");
  });

  it("flags entries with decode errors", () => {
    const states = buildStackEntryValidationStatesInDisplayOrder([
      buildDecodedEntry("a.tif", null, "Corrupt TIFF"),
    ]);
    expect(states[0]).toEqual({ kind: "decode-failed", message: "Corrupt TIFF" });
  });

  it("uses the first non-error row as baseline even when the first row is multi-page", () => {
    const states = buildStackEntryValidationStatesInDisplayOrder([
      buildDecodedEntry("multi.tif", buildMultiBandRaster(2)),
      buildDecodedEntry("a.tif", buildSingleBandRaster(4, 4)),
      buildDecodedEntry("b.tif", buildSingleBandRaster(8, 8)),
    ]);
    expect(states[0]?.kind).toBe("multi-page");
    expect(states[1]?.kind).toBe("valid");
    expect(states[2]?.kind).toBe("property-mismatch");
  });
});
