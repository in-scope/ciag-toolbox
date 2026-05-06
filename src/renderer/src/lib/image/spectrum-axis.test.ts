import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import {
  buildSpectrumXAxisFromRaster,
  describeSpectrumYAxisLabel,
} from "@/lib/image/spectrum-axis";

function buildRasterWithBandCount(
  bandCount: number,
  wavelengths?: ReadonlyArray<number>,
): RasterImage {
  return {
    bandPixels: Array.from({ length: bandCount }, () => Float32Array.from([0])),
    width: 1,
    height: 1,
    bitsPerSample: 32,
    sampleFormat: "float",
    bandCount,
    bandWavelengths: wavelengths,
  };
}

describe("buildSpectrumXAxisFromRaster", () => {
  it("returns wavelength axis when wavelengths match band count", () => {
    const raster = buildRasterWithBandCount(3, [400, 500, 600]);
    const axis = buildSpectrumXAxisFromRaster(raster);
    expect(axis.label).toBe("Wavelength (nm)");
    expect(axis.bandPositions).toEqual([400, 500, 600]);
    expect(axis.tickLabels).toEqual(["400", "500", "600"]);
  });

  it("falls back to band index axis when wavelengths are missing", () => {
    const raster = buildRasterWithBandCount(3);
    const axis = buildSpectrumXAxisFromRaster(raster);
    expect(axis.label).toBe("Band index");
    expect(axis.bandPositions).toEqual([1, 2, 3]);
  });

  it("falls back to band index axis when wavelength count mismatches", () => {
    const raster = buildRasterWithBandCount(3, [400, 500]);
    const axis = buildSpectrumXAxisFromRaster(raster);
    expect(axis.label).toBe("Band index");
  });

  it("downsamples ticks to a small fixed maximum", () => {
    const raster = buildRasterWithBandCount(20);
    const axis = buildSpectrumXAxisFromRaster(raster);
    expect(axis.tickPositions.length).toBeLessThanOrEqual(5);
    expect(axis.bandPositions.length).toBe(20);
  });
});

describe("describeSpectrumYAxisLabel", () => {
  it("uses Counts for integer sample formats", () => {
    expect(describeSpectrumYAxisLabel("uint")).toBe("Counts");
    expect(describeSpectrumYAxisLabel("int")).toBe("Counts");
  });

  it("uses Reflectance / counts for float sample formats", () => {
    expect(describeSpectrumYAxisLabel("float")).toBe("Reflectance / counts");
  });
});
