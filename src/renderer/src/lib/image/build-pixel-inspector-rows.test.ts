import { describe, expect, it } from "vitest";

import {
  buildBrowserSourcePixelInspectorRow,
  buildRasterPixelInspectorRows,
} from "./build-pixel-inspector-rows";
import { computePerBandRawValueExtentsForRaster } from "./compute-image-channel-extents";
import type { RasterImage } from "./raster-image";

function buildThreeBandUint16Raster(): RasterImage {
  return {
    bandPixels: [
      new Uint16Array([0, 100, 200, 300]),
      new Uint16Array([1000, 2000, 3000, 4000]),
      new Uint16Array([10, 10, 10, 10]),
    ],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 3,
    bandLabels: ["B1", "B2", "B3"],
  };
}

describe("buildRasterPixelInspectorRows", () => {
  it("returns rows with '-' display values and null fractions when no readout is available", () => {
    const raster = buildThreeBandUint16Raster();
    const rows = buildRasterPixelInspectorRows({
      raster,
      perBandRawValueExtents: computePerBandRawValueExtentsForRaster(raster),
      cursorBandValues: null,
      roiMeanBandValues: null,
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.displayValue)).toEqual(["-", "-", "-"]);
    expect(rows.map((row) => row.normalizedFraction)).toEqual([null, null, null]);
  });

  it("formats cursor band values per row and normalizes against the raster extents", () => {
    const raster = buildThreeBandUint16Raster();
    const rows = buildRasterPixelInspectorRows({
      raster,
      perBandRawValueExtents: computePerBandRawValueExtentsForRaster(raster),
      cursorBandValues: [150, 1500, 10],
      roiMeanBandValues: null,
    });
    expect(rows[0]?.displayValue).toBe("150");
    expect(rows[1]?.displayValue).toBe("1500");
    expect(rows[2]?.displayValue).toBe("10");
    expect(rows[0]?.normalizedFraction).toBeCloseTo(150 / 300, 6);
    expect(rows[1]?.normalizedFraction).toBeCloseTo(500 / 3000, 6);
    expect(rows[2]?.normalizedFraction).toBe(0);
  });

  it("falls back to ROI mean values when cursor band values are absent", () => {
    const raster = buildThreeBandUint16Raster();
    const rows = buildRasterPixelInspectorRows({
      raster,
      perBandRawValueExtents: computePerBandRawValueExtentsForRaster(raster),
      cursorBandValues: null,
      roiMeanBandValues: [150, 2500, 10],
    });
    expect(rows[0]?.displayValue).toBe("150");
    expect(rows[1]?.displayValue).toBe("2500");
    expect(rows[2]?.displayValue).toBe("10");
  });

  it("ignores ROI mean values whose length does not match the raster band count", () => {
    const raster = buildThreeBandUint16Raster();
    const rows = buildRasterPixelInspectorRows({
      raster,
      perBandRawValueExtents: computePerBandRawValueExtentsForRaster(raster),
      cursorBandValues: null,
      roiMeanBandValues: [150, 2500],
    });
    expect(rows.map((row) => row.displayValue)).toEqual(["-", "-", "-"]);
  });

  it("uses each band's label from the raster", () => {
    const raster = buildThreeBandUint16Raster();
    const rows = buildRasterPixelInspectorRows({
      raster,
      perBandRawValueExtents: computePerBandRawValueExtentsForRaster(raster),
      cursorBandValues: [0, 0, 0],
      roiMeanBandValues: null,
    });
    expect(rows.map((row) => row.label)).toEqual(["B1", "B2", "B3"]);
  });
});

describe("buildBrowserSourcePixelInspectorRow", () => {
  it("renders '-' when no cursor data is available", () => {
    const row = buildBrowserSourcePixelInspectorRow(null);
    expect(row.label).toBe("Pixel");
    expect(row.displayValue).toBe("-");
    expect(row.normalizedFraction).toBeNull();
  });

  it("joins RGBA values with comma + space when cursor data is available", () => {
    const row = buildBrowserSourcePixelInspectorRow([255, 128, 64, 32]);
    expect(row.displayValue).toBe("255, 128, 64, 32");
  });

  it("computes the mini-bar fraction as the mean of the RGB bytes divided by 255", () => {
    const row = buildBrowserSourcePixelInspectorRow([255, 128, 64, 32]);
    expect(row.normalizedFraction).toBeCloseTo((255 + 128 + 64) / 3 / 255, 6);
  });
});
