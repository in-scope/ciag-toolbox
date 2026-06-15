import { describe, expect, it } from "vitest";

import { applyBitShiftToRasterImage } from "@/lib/image/apply-bit-shift";
import {
  computeImageRgbChannelExtents,
  computeSingleBandRasterUnitExtents,
} from "@/lib/image/compute-image-channel-extents";
import {
  computeDataTypeUnitMappingForRaster,
  mapRawValueToDisplayUnit,
} from "@/lib/image/data-type-display-range";
import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-089 contract: the DEFAULT display maps each value across the data type's
// full range (0..255 for 8-bit, [0,1] for float, signed range handled), so a dim
// sub-range band reads as dim instead of being auto-stretched to its own min/max.
// "Normalized viewing" is the ONLY path that stretches a band to its actual
// min/max, and it stays view-only and band-wise. These tests contrast the two
// display paths the renderer uses (data-type mapping vs band-wise stretch) so a
// regression that makes the default auto-stretch again is caught.

const BRIGHTEST_DEFAULT_FRACTION_THAT_STILL_READS_DIM = 0.1;

function rasterSource(raster: RasterImage): ViewportImageSource {
  return { kind: "raster", raster };
}

function defaultDisplayFractionForValue(raster: RasterImage, value: number): number {
  return mapRawValueToDisplayUnit(value, computeDataTypeUnitMappingForRaster(raster));
}

function normalizedDisplayRangeWidthForBand(raster: RasterImage, bandIndex = 0): number {
  const extents = computeSingleBandRasterUnitExtents(raster, bandIndex);
  return extents.max - extents.min;
}

function buildSingleBandRaster(
  pixels: RasterTypedArray,
  sampleFormat: RasterImage["sampleFormat"],
  bitsPerSample: number,
): RasterImage {
  return {
    bandPixels: [pixels],
    width: pixels.length,
    height: 1,
    bitsPerSample,
    sampleFormat,
    bandCount: 1,
  };
}

describe("CT-089: default display maps to the data-type range, not a band auto-stretch", () => {
  it("keeps a dim 12-bit-in-uint16 band dim under the default display", () => {
    const dimBand = new Uint16Array([2000, 2010, 2020, 2030, 2040, 2050, 2060]);
    const raster = buildSingleBandRaster(dimBand, "uint", 16);

    expect(defaultDisplayFractionForValue(raster, 2060)).toBeLessThan(
      BRIGHTEST_DEFAULT_FRACTION_THAT_STILL_READS_DIM,
    );
  });

  it("stretches that same dim band to fill [0,1] only via Normalized viewing", () => {
    const dimBand = new Uint16Array([2000, 2010, 2020, 2030, 2040, 2050, 2060]);
    const raster = buildSingleBandRaster(dimBand, "uint", 16);
    const extents = computeImageRgbChannelExtents(rasterSource(raster));

    expect(extents.min[0]).toBeCloseTo(2000 / 65535, 6);
    expect(extents.max[0]).toBeCloseTo(2060 / 65535, 6);
    expect(normalizedDisplayRangeWidthForBand(raster)).toBeGreaterThan(0);
  });

  it("makes a bit-shifted band visibly brighter under the default display", () => {
    const dimBand = new Uint16Array([2000, 2010, 2020, 2030, 2040, 2050, 2060]);
    const raster = buildSingleBandRaster(dimBand, "uint", 16);
    const shifted = applyBitShiftToRasterImage(raster, 4);

    const dimFraction = defaultDisplayFractionForValue(raster, 2060);
    const shiftedFraction = defaultDisplayFractionForValue(shifted, 2060 * 16);
    expect(shiftedFraction).toBeGreaterThan(dimFraction * 8);
  });

  it("maps a float [0,1] band by passing values through, not stretching its own range", () => {
    const dimFloatBand = new Float32Array([0.1, 0.11, 0.12]);
    const raster = buildSingleBandRaster(dimFloatBand, "float", 32);

    expect(defaultDisplayFractionForValue(raster, 0.12)).toBeCloseTo(0.12, 6);
    const extents = computeImageRgbChannelExtents(rasterSource(raster));
    expect(extents.max[0]).toBeCloseTo(0.12, 6);
    expect(extents.min[0]).toBeCloseTo(0.1, 6);
  });

  it("maps a signed int16 band by its type range so mid values read mid-grey", () => {
    const signedBand = new Int16Array([-10, 0, 10]);
    const raster = buildSingleBandRaster(signedBand, "int", 16);

    expect(defaultDisplayFractionForValue(raster, 0)).toBeCloseTo(0.5, 4);
    expect(defaultDisplayFractionForValue(raster, -10)).toBeLessThan(0.5);
    expect(defaultDisplayFractionForValue(raster, 10)).toBeGreaterThan(0.5);
  });
});
