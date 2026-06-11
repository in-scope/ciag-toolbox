import { describe, expect, it } from "vitest";

import { formatViewportHeaderLabel } from "@/components/viewport-header-label";
import type { RasterImage } from "@/lib/image/raster-image";

describe("formatViewportHeaderLabel", () => {
  it("tracks the active band so the label changes as the slider moves", () => {
    const raster = buildThreeBandRaster();
    const labelAtBandOne = formatViewportHeaderLabel(headerInputForBand(raster, 0));
    const labelAtBandTwo = formatViewportHeaderLabel(headerInputForBand(raster, 1));
    expect(labelAtBandOne).toBe("cube.hdr - Band 1");
    expect(labelAtBandTwo).toBe("cube.hdr - Band 2");
  });

  it("prefers an explicit band label over the default band name", () => {
    const raster: RasterImage = { ...buildThreeBandRaster(), bandLabels: ["Red", "Green", "Blue"] };
    expect(formatViewportHeaderLabel(headerInputForBand(raster, 2))).toBe("cube.hdr - #3 Blue");
  });

  it("uses the original band number after a subset re-homes it", () => {
    const raster: RasterImage = { ...buildThreeBandRaster(), bandOriginalNumbers: [3, 5, 9] };
    expect(formatViewportHeaderLabel(headerInputForBand(raster, 1))).toBe("cube.hdr - Band 5");
  });

  it("clamps an out-of-range selected band to the last band", () => {
    const raster = buildThreeBandRaster();
    expect(formatViewportHeaderLabel(headerInputForBand(raster, 99))).toBe("cube.hdr - Band 3");
  });

  it("omits the band suffix for a single-band stack", () => {
    const raster = buildSingleBandRaster();
    expect(formatViewportHeaderLabel(headerInputForBand(raster, 0))).toBe("cube.hdr");
  });

  it("falls back to the file name alone when there is no raster", () => {
    const input = { fileName: "photo.png", raster: null, selectedBandIndex: 0, lastAppliedOperationLabel: null };
    expect(formatViewportHeaderLabel(input)).toBe("photo.png");
  });

  it("appends the operation label before the active band", () => {
    const raster = buildThreeBandRaster();
    const label = formatViewportHeaderLabel({
      fileName: "cube.hdr",
      raster,
      selectedBandIndex: 1,
      lastAppliedOperationLabel: "Normalize",
    });
    expect(label).toBe("cube.hdr (Normalize) - Band 2");
  });
});

function headerInputForBand(raster: RasterImage, selectedBandIndex: number) {
  return { fileName: "cube.hdr", raster, selectedBandIndex, lastAppliedOperationLabel: null };
}

function buildThreeBandRaster(): RasterImage {
  return {
    bandPixels: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])],
    width: 1,
    height: 1,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: 3,
  };
}

function buildSingleBandRaster(): RasterImage {
  return {
    bandPixels: [new Uint8Array([1])],
    width: 1,
    height: 1,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: 1,
  };
}
