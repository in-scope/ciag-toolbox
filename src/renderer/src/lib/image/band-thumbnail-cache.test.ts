import { describe, expect, it } from "vitest";

import {
  BandThumbnailCache,
  computeOrReadBandThumbnailViaCache,
} from "./band-thumbnail-cache";
import type { RasterImage } from "./raster-image";

describe("BandThumbnailCache", () => {
  it("returns null when no entry exists for the (raster, bandIndex) key", () => {
    const cache = new BandThumbnailCache();
    const raster = buildSyntheticRasterForCacheTests();
    expect(cache.read(raster, 0)).toBeNull();
  });

  it("stores and reads a ready entry keyed by raster identity and band index", () => {
    const cache = new BandThumbnailCache();
    const raster = buildSyntheticRasterForCacheTests();
    const pixels = { rgba: new Uint8ClampedArray(4 * 4 * 4), sizePx: 4 };
    cache.storeReady(raster, 1, pixels);
    expect(cache.read(raster, 1)).toEqual({ kind: "ready", pixels });
    expect(cache.read(raster, 0)).toBeNull();
  });

  it("does not return entries written under a different raster identity", () => {
    const cache = new BandThumbnailCache();
    const rasterA = buildSyntheticRasterForCacheTests();
    const rasterB = buildSyntheticRasterForCacheTests();
    const pixels = { rgba: new Uint8ClampedArray(4 * 4 * 4), sizePx: 4 };
    cache.storeReady(rasterA, 0, pixels);
    expect(cache.read(rasterB, 0)).toBeNull();
  });

  it("stores and reads a failed entry sentinel", () => {
    const cache = new BandThumbnailCache();
    const raster = buildSyntheticRasterForCacheTests();
    cache.storeFailed(raster, 0);
    expect(cache.read(raster, 0)).toEqual({ kind: "failed" });
  });
});

describe("computeOrReadBandThumbnailViaCache", () => {
  it("computes and caches a thumbnail on the first call", () => {
    const cache = new BandThumbnailCache();
    const raster = buildSyntheticRasterForCacheTests();
    const first = computeOrReadBandThumbnailViaCache(cache, raster, 0, 4);
    expect(first.kind).toBe("ready");
    const second = cache.read(raster, 0);
    expect(second).toEqual(first);
  });

  it("returns the cached entry without recomputing on subsequent calls", () => {
    const cache = new BandThumbnailCache();
    const raster = buildSyntheticRasterForCacheTests();
    const first = computeOrReadBandThumbnailViaCache(cache, raster, 0, 4);
    const second = computeOrReadBandThumbnailViaCache(cache, raster, 0, 4);
    expect(first).toBe(second);
  });

  it("returns a failed entry for an out-of-range band index", () => {
    const cache = new BandThumbnailCache();
    const raster = buildSyntheticRasterForCacheTests();
    const result = computeOrReadBandThumbnailViaCache(cache, raster, 99, 4);
    expect(result.kind).toBe("failed");
    expect(cache.read(raster, 99)).toEqual({ kind: "failed" });
  });
});

function buildSyntheticRasterForCacheTests(): RasterImage {
  return {
    width: 2,
    height: 2,
    bandCount: 2,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandPixels: [
      Uint8Array.from([0, 64, 128, 255]),
      Uint8Array.from([10, 20, 30, 40]),
    ],
  };
}
