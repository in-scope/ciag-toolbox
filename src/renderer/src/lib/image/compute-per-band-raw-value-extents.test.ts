import { describe, expect, it } from "vitest";

import {
  computePerBandRawValueExtentsForRaster,
  computeRasterBandRawValueExtents,
} from "./compute-image-channel-extents";
import type { RasterImage } from "./raster-image";

function buildMultiBandRaster(): RasterImage {
  return {
    bandPixels: [
      new Uint8Array([10, 20, 30, 40]),
      new Uint16Array([0, 0, 0, 0]),
      new Float32Array([-0.5, 0.0, 0.25, 1.0]),
    ],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 3,
  };
}

describe("computeRasterBandRawValueExtents", () => {
  it("returns min and max in raw value units for a uint band", () => {
    const raster = buildMultiBandRaster();
    expect(computeRasterBandRawValueExtents(raster, 0)).toEqual({ min: 10, max: 40 });
  });

  it("returns equal min and max for a band with all-zero values", () => {
    const raster = buildMultiBandRaster();
    expect(computeRasterBandRawValueExtents(raster, 1)).toEqual({ min: 0, max: 0 });
  });

  it("returns the actual float min and max without unit scaling", () => {
    const raster = buildMultiBandRaster();
    expect(computeRasterBandRawValueExtents(raster, 2)).toEqual({ min: -0.5, max: 1 });
  });

  it("memoizes results per (raster identity, bandIndex)", () => {
    const raster = buildMultiBandRaster();
    const firstCall = computeRasterBandRawValueExtents(raster, 0);
    const secondCall = computeRasterBandRawValueExtents(raster, 0);
    expect(secondCall).toBe(firstCall);
  });

  it("returns distinct entries for different bandIndexes on the same raster", () => {
    const raster = buildMultiBandRaster();
    const band0 = computeRasterBandRawValueExtents(raster, 0);
    const band1 = computeRasterBandRawValueExtents(raster, 1);
    expect(band0).not.toBe(band1);
  });

  it("does not reuse memoized entries across distinct raster identities", () => {
    const rasterA = buildMultiBandRaster();
    const rasterB = buildMultiBandRaster();
    const extentsA = computeRasterBandRawValueExtents(rasterA, 0);
    const extentsB = computeRasterBandRawValueExtents(rasterB, 0);
    expect(extentsA).not.toBe(extentsB);
  });
});

describe("computePerBandRawValueExtentsForRaster", () => {
  it("returns one extents entry per band in band order", () => {
    const raster = buildMultiBandRaster();
    const allExtents = computePerBandRawValueExtentsForRaster(raster);
    expect(allExtents).toHaveLength(3);
    expect(allExtents[0]).toEqual({ min: 10, max: 40 });
    expect(allExtents[1]).toEqual({ min: 0, max: 0 });
    expect(allExtents[2]).toEqual({ min: -0.5, max: 1 });
  });
});
