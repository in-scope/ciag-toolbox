import { describe, expect, it } from "vitest";

import { BandHistogramCache } from "@/lib/image/band-histogram-cache";
import type { BandHistogram } from "@/lib/image/compute-band-histogram";
import type { RasterImage } from "@/lib/image/raster-image";

describe("BandHistogramCache", () => {
  it("returns null for an unseen (raster, bandIndex, binCount) tuple", () => {
    const cache = new BandHistogramCache();
    const raster = buildTinyRaster();
    expect(cache.read(raster, 0, 256)).toBeNull();
  });

  it("stores and reads back the same histogram reference", () => {
    const cache = new BandHistogramCache();
    const raster = buildTinyRaster();
    const histogram = buildPlaceholderHistogram();
    cache.store(raster, 0, 256, histogram);
    expect(cache.read(raster, 0, 256)).toBe(histogram);
  });

  it("scopes entries by bandIndex", () => {
    const cache = new BandHistogramCache();
    const raster = buildTinyRaster();
    const histogramA = buildPlaceholderHistogram();
    const histogramB = buildPlaceholderHistogram();
    cache.store(raster, 0, 256, histogramA);
    cache.store(raster, 1, 256, histogramB);
    expect(cache.read(raster, 0, 256)).toBe(histogramA);
    expect(cache.read(raster, 1, 256)).toBe(histogramB);
  });

  it("scopes entries by binCount", () => {
    const cache = new BandHistogramCache();
    const raster = buildTinyRaster();
    const histogram64 = buildPlaceholderHistogram();
    const histogram256 = buildPlaceholderHistogram();
    cache.store(raster, 0, 64, histogram64);
    cache.store(raster, 0, 256, histogram256);
    expect(cache.read(raster, 0, 64)).toBe(histogram64);
    expect(cache.read(raster, 0, 256)).toBe(histogram256);
  });

  it("does not share entries across distinct raster identities", () => {
    const cache = new BandHistogramCache();
    const raster = buildTinyRaster();
    const otherRaster = buildTinyRaster();
    cache.store(raster, 0, 256, buildPlaceholderHistogram());
    expect(cache.read(otherRaster, 0, 256)).toBeNull();
  });
});

function buildTinyRaster(): RasterImage {
  return {
    bandPixels: [new Uint8Array([0, 1, 2, 3])],
    width: 4,
    height: 1,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: 1,
  };
}

function buildPlaceholderHistogram(): BandHistogram {
  return {
    bins: new Uint32Array([1, 1, 1, 1]),
    binCount: 4,
    min: 0,
    max: 255,
    binWidth: 64,
    totalSampleCount: 4,
    excludedSampleCount: 0,
  };
}
