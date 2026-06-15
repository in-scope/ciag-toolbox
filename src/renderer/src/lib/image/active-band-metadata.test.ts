import { describe, expect, it } from "vitest";

import { buildActiveBandMetadataRows } from "./active-band-metadata";
import { applyBandKeepToRasterImage } from "./apply-band-keep";
import type { RasterImage } from "./raster-image";

function createFiveBandRaster(
  overrides: Partial<RasterImage> = {},
): RasterImage {
  return {
    bandPixels: Array.from({ length: 5 }, (_, band) => new Uint16Array([band, band])),
    width: 2,
    height: 1,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 5,
    bandWavelengths: [450, 500, 550, 600, 650],
    bandOriginalNumbers: [1, 2, 3, 4, 5],
    ...overrides,
  };
}

describe("buildActiveBandMetadataRows", () => {
  it("reports the current band's original number", () => {
    const rows = buildActiveBandMetadataRows(createFiveBandRaster(), 2);
    expect(rows[0]).toEqual({ label: "Original band", value: "3" });
  });

  it("defaults the original number to band index plus one when none is recorded", () => {
    const raster = createFiveBandRaster({ bandOriginalNumbers: undefined });
    const rows = buildActiveBandMetadataRows(raster, 3);
    expect(rows[0]).toEqual({ label: "Original band", value: "4" });
  });

  it("includes the band wavelength in nanometres when available", () => {
    const rows = buildActiveBandMetadataRows(createFiveBandRaster(), 2);
    expect(rows[1]).toEqual({ label: "Wavelength", value: "550 nm" });
  });

  it("formats a fractional wavelength to one decimal place", () => {
    const raster = createFiveBandRaster({ bandWavelengths: [450.25, 500, 550, 600, 650] });
    const rows = buildActiveBandMetadataRows(raster, 0);
    expect(rows[1]).toEqual({ label: "Wavelength", value: "450.3 nm" });
  });

  it("omits the wavelength row when the raster has no wavelengths", () => {
    const raster = createFiveBandRaster({ bandWavelengths: undefined });
    const rows = buildActiveBandMetadataRows(raster, 1);
    expect(rows).toHaveLength(1);
    expect(rows.some((row) => row.label === "Wavelength")).toBe(false);
  });

  it("omits the wavelength row when the wavelength list length does not match the band count", () => {
    const raster = createFiveBandRaster({ bandWavelengths: [450, 500] });
    const rows = buildActiveBandMetadataRows(raster, 0);
    expect(rows).toHaveLength(1);
  });

  it("keeps the original-band mapping correct after a middle band is removed", () => {
    const removedMiddleBand = applyBandKeepToRasterImage(createFiveBandRaster(), [0, 1, 3, 4]);
    const rowsAtRemovedPosition = buildActiveBandMetadataRows(removedMiddleBand, 2);
    expect(rowsAtRemovedPosition[0]).toEqual({ label: "Original band", value: "4" });
    expect(rowsAtRemovedPosition[1]).toEqual({ label: "Wavelength", value: "600 nm" });
  });
});
