import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import {
  estimateTiffExportBytes,
  findTiffExportRefusalMessageOrNull,
  MAX_CLASSIC_TIFF_EXPORT_BYTES,
  TIFF_EXPORT_TOO_LARGE_MESSAGE,
  wouldTiffExportExceedClassicTiffLimit,
} from "@/lib/image/tiff-export-size";
import type { ViewportImageSource } from "@/lib/webgl/texture";

describe("wouldTiffExportExceedClassicTiffLimit", () => {
  it("allows exactly 4,294,967,295 bytes (the classic TIFF offset limit)", () => {
    expect(wouldTiffExportExceedClassicTiffLimit(4_294_967_295)).toBe(false);
  });

  it("refuses 4,294,967,296 bytes (one past the limit)", () => {
    expect(wouldTiffExportExceedClassicTiffLimit(4_294_967_296)).toBe(true);
  });

  it("pins the limit constant to the classic TIFF 32-bit offset maximum", () => {
    expect(MAX_CLASSIC_TIFF_EXPORT_BYTES).toBe(4_294_967_295);
  });
});

describe("TIFF_EXPORT_TOO_LARGE_MESSAGE", () => {
  it("is exactly the locked refusal copy", () => {
    expect(TIFF_EXPORT_TOO_LARGE_MESSAGE).toBe(
      "TIFF export supports images up to 4 GB. Use ENVI export for larger stacks.",
    );
  });
});

describe("estimateTiffExportBytes", () => {
  it("multiplies dimensions, bands, and sample width", () => {
    expect(
      estimateTiffExportBytes({ width: 100, height: 50, bandCount: 3, bytesPerSample: 2 }),
    ).toBe(30_000);
  });

  it("puts the scale10 reference stack (10000x5000x100 uint16) past the limit", () => {
    const estimated = estimateTiffExportBytes({
      width: 10_000,
      height: 5_000,
      bandCount: 100,
      bytesPerSample: 2,
    });
    expect(estimated).toBe(10_000_000_000);
    expect(wouldTiffExportExceedClassicTiffLimit(estimated)).toBe(true);
  });

  it("keeps a spatially cropped scale10 sub-stack (4000x5000x100 uint16) under the limit", () => {
    const estimated = estimateTiffExportBytes({
      width: 4_000,
      height: 5_000,
      bandCount: 100,
      bytesPerSample: 2,
    });
    expect(wouldTiffExportExceedClassicTiffLimit(estimated)).toBe(false);
  });
});

describe("findTiffExportRefusalMessageOrNull", () => {
  it("refuses a 16-bit TIFF export of a stack whose content exceeds the limit", () => {
    const source = buildRasterSourceClaimingDimensions(10_000, 5_000, 100);
    expect(findTiffExportRefusalMessageOrNull(source, "tiff-16-bit")).toBe(
      TIFF_EXPORT_TOO_LARGE_MESSAGE,
    );
  });

  it("weights the float TIFF format at four bytes per sample", () => {
    // 10000 x 5000 x 25 bands: 2.5 GB at uint16 (allowed), 5 GB at float32 (refused).
    const source = buildRasterSourceClaimingDimensions(10_000, 5_000, 25);
    expect(findTiffExportRefusalMessageOrNull(source, "tiff-16-bit")).toBeNull();
    expect(findTiffExportRefusalMessageOrNull(source, "tiff-float-32")).toBe(
      TIFF_EXPORT_TOO_LARGE_MESSAGE,
    );
  });

  it("weights the 8-bit TIFF format at one byte per sample", () => {
    // 10000 x 5000 x 80 bands: 4.0 GB at 8-bit (allowed), 8 GB at 16-bit (refused).
    const source = buildRasterSourceClaimingDimensions(10_000, 5_000, 80);
    expect(findTiffExportRefusalMessageOrNull(source, "tiff-8-bit")).toBeNull();
    expect(findTiffExportRefusalMessageOrNull(source, "tiff-16-bit")).toBe(
      TIFF_EXPORT_TOO_LARGE_MESSAGE,
    );
  });

  it("never refuses non-TIFF formats, whatever the stack size", () => {
    const source = buildRasterSourceClaimingDimensions(10_000, 5_000, 100);
    expect(findTiffExportRefusalMessageOrNull(source, "envi")).toBeNull();
    expect(findTiffExportRefusalMessageOrNull(source, "envi-float")).toBeNull();
    expect(findTiffExportRefusalMessageOrNull(source, "png-8-bit")).toBeNull();
    expect(findTiffExportRefusalMessageOrNull(source, "jpeg-8-bit")).toBeNull();
  });

  it("allows an ordinary reference-scale band export", () => {
    const source = buildRasterSourceClaimingDimensions(8_000, 6_000, 16);
    expect(findTiffExportRefusalMessageOrNull(source, "tiff-16-bit")).toBeNull();
  });

  it("counts a browser photo source as three channels", () => {
    const oversized: ViewportImageSource = {
      kind: "pixels",
      pixels: new Uint8Array(4),
      width: 50_000,
      height: 50_000,
    };
    // 50000 x 50000 x 3 x 1 byte = 7.5 GB.
    expect(findTiffExportRefusalMessageOrNull(oversized, "tiff-8-bit")).toBe(
      TIFF_EXPORT_TOO_LARGE_MESSAGE,
    );
  });
});

// The refusal decision reads metadata only (it must run before any pixel
// touches an encoder), so the fixture claims large dimensions without
// allocating them.
function buildRasterSourceClaimingDimensions(
  width: number,
  height: number,
  bandCount: number,
): ViewportImageSource {
  const raster: RasterImage = {
    width,
    height,
    bandCount,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandPixels: [new Uint16Array(1)],
  };
  return { kind: "raster", raster };
}
