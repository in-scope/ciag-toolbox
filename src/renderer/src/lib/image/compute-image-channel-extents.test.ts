import { describe, expect, it } from "vitest";

import {
  IDENTITY_RGB_CHANNEL_EXTENTS,
  IDENTITY_SINGLE_BAND_EXTENTS,
  computeImageRgbChannelExtents,
  computeSingleBandRasterUnitExtents,
} from "@/lib/image/compute-image-channel-extents";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

const UINT16_CONTAINER_MAX = 65535;

describe("computeSingleBandRasterUnitExtents", () => {
  it("returns scalar min/max scaled by 1/(2^bps - 1) for uint rasters", () => {
    const raster = buildUint16RasterFromValues([0, 4096, 8192, 16384]);
    const extents = computeSingleBandRasterUnitExtents(raster);
    expect(extents.min).toBe(0);
    expect(extents.max).toBeCloseTo(16384 / UINT16_CONTAINER_MAX, 6);
  });

  it("captures the actual data range, not the container range, so 12-bit data in uint16 normalizes to its real span", () => {
    const raster = buildUint16RasterFromValues([100, 200, 300, 4000]);
    const extents = computeSingleBandRasterUnitExtents(raster);
    expect(extents.max).toBeLessThan(0.07);
    expect(extents.min).toBeGreaterThan(0);
  });

  it("passes float pixel values through unchanged", () => {
    const raster: RasterImage = {
      bandPixels: [new Float32Array([0.1, 0.5, 0.9])],
      width: 3,
      height: 1,
      bitsPerSample: 32,
      sampleFormat: "float",
      bandCount: 1,
    };
    const extents = computeSingleBandRasterUnitExtents(raster);
    expect(extents.min).toBeCloseTo(0.1, 6);
    expect(extents.max).toBeCloseTo(0.9, 6);
  });

  it("returns identity extents for an empty raster", () => {
    const raster = buildUint16RasterFromValues([]);
    expect(computeSingleBandRasterUnitExtents(raster)).toEqual(
      IDENTITY_SINGLE_BAND_EXTENTS,
    );
  });

  it("reads the requested band's pixels for multi-band rasters", () => {
    const raster = buildTwoBandUint16Raster([10, 20], [50000, 60000]);
    const firstBandExtents = computeSingleBandRasterUnitExtents(raster, 0);
    const secondBandExtents = computeSingleBandRasterUnitExtents(raster, 1);
    expect(firstBandExtents.max).toBeCloseTo(20 / UINT16_CONTAINER_MAX, 6);
    expect(secondBandExtents.max).toBeCloseTo(60000 / UINT16_CONTAINER_MAX, 6);
  });
});

describe("computeImageRgbChannelExtents (raster path)", () => {
  it("broadcasts the single-band scalar extents across all three RGB channels", () => {
    const raster = buildUint16RasterFromValues([1000, 2000, 3000, 4000]);
    const source: ViewportImageSource = { kind: "raster", raster };
    const extents = computeImageRgbChannelExtents(source);
    const expectedMin = 1000 / UINT16_CONTAINER_MAX;
    const expectedMax = 4000 / UINT16_CONTAINER_MAX;
    expect(extents.min[0]).toBeCloseTo(expectedMin, 6);
    expect(extents.min[1]).toBe(extents.min[0]);
    expect(extents.min[2]).toBe(extents.min[0]);
    expect(extents.max[0]).toBeCloseTo(expectedMax, 6);
    expect(extents.max[1]).toBe(extents.max[0]);
    expect(extents.max[2]).toBe(extents.max[0]);
  });

  it("uses the requested band when given a multi-band raster source", () => {
    const raster = buildTwoBandUint16Raster([0, 1000], [50000, 60000]);
    const source: ViewportImageSource = { kind: "raster", raster };
    const firstBandExtents = computeImageRgbChannelExtents(source, 0);
    const secondBandExtents = computeImageRgbChannelExtents(source, 1);
    expect(firstBandExtents.max[0]).toBeLessThan(secondBandExtents.max[0]);
  });
});

describe("computeImageRgbChannelExtents (pixels path)", () => {
  it("computes per-channel min/max in unit space for an RGBA8 buffer", () => {
    const pixels = new Uint8ClampedArray([
      0, 128, 255, 255,
      255, 0, 128, 255,
    ]);
    const source: ViewportImageSource = {
      kind: "pixels",
      pixels,
      width: 2,
      height: 1,
    };
    const extents = computeImageRgbChannelExtents(source);
    expect(extents.min[0]).toBeCloseTo(0, 6);
    expect(extents.max[0]).toBeCloseTo(1, 6);
    expect(extents.min[1]).toBeCloseTo(0, 6);
    expect(extents.max[1]).toBeCloseTo(128 / 255, 6);
    expect(extents.min[2]).toBeCloseTo(128 / 255, 6);
    expect(extents.max[2]).toBeCloseTo(1, 6);
  });

  it("returns identity extents for an empty pixels buffer", () => {
    const source: ViewportImageSource = {
      kind: "pixels",
      pixels: new Uint8Array(0),
      width: 0,
      height: 0,
    };
    expect(computeImageRgbChannelExtents(source)).toEqual(
      IDENTITY_RGB_CHANNEL_EXTENTS,
    );
  });
});

function buildUint16RasterFromValues(values: ReadonlyArray<number>): RasterImage {
  return {
    bandPixels: [new Uint16Array(values)],
    width: values.length,
    height: 1,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
}

function buildTwoBandUint16Raster(
  bandZero: ReadonlyArray<number>,
  bandOne: ReadonlyArray<number>,
): RasterImage {
  return {
    bandPixels: [new Uint16Array(bandZero), new Uint16Array(bandOne)],
    width: bandZero.length,
    height: 1,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 2,
  };
}
