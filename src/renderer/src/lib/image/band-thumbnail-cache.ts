import type { RasterImage } from "./raster-image";
import {
  buildBandThumbnailPixelsOrNull,
  type BandThumbnailPixels,
} from "./build-band-thumbnail";

export type BandThumbnailCacheEntry =
  | { readonly kind: "ready"; readonly pixels: BandThumbnailPixels }
  | { readonly kind: "failed" };

export class BandThumbnailCache {
  private readonly entriesByRaster = new WeakMap<
    RasterImage,
    Map<number, BandThumbnailCacheEntry>
  >();

  read(raster: RasterImage, bandIndex: number): BandThumbnailCacheEntry | null {
    const perRaster = this.entriesByRaster.get(raster);
    if (!perRaster) return null;
    return perRaster.get(bandIndex) ?? null;
  }

  storeReady(raster: RasterImage, bandIndex: number, pixels: BandThumbnailPixels): void {
    this.writeEntryForRasterBand(raster, bandIndex, { kind: "ready", pixels });
  }

  storeFailed(raster: RasterImage, bandIndex: number): void {
    this.writeEntryForRasterBand(raster, bandIndex, { kind: "failed" });
  }

  private writeEntryForRasterBand(
    raster: RasterImage,
    bandIndex: number,
    entry: BandThumbnailCacheEntry,
  ): void {
    const existing = this.entriesByRaster.get(raster);
    if (existing) {
      existing.set(bandIndex, entry);
      return;
    }
    const next = new Map<number, BandThumbnailCacheEntry>();
    next.set(bandIndex, entry);
    this.entriesByRaster.set(raster, next);
  }
}

export function computeOrReadBandThumbnailViaCache(
  cache: BandThumbnailCache,
  raster: RasterImage,
  bandIndex: number,
  sizePx: number,
): BandThumbnailCacheEntry {
  const cached = cache.read(raster, bandIndex);
  if (cached) return cached;
  return computeAndStoreBandThumbnailInCache(cache, raster, bandIndex, sizePx);
}

function computeAndStoreBandThumbnailInCache(
  cache: BandThumbnailCache,
  raster: RasterImage,
  bandIndex: number,
  sizePx: number,
): BandThumbnailCacheEntry {
  const pixels = buildBandThumbnailPixelsOrNull(raster, bandIndex, sizePx);
  if (!pixels) {
    cache.storeFailed(raster, bandIndex);
  } else {
    cache.storeReady(raster, bandIndex, pixels);
  }
  return cache.read(raster, bandIndex) as BandThumbnailCacheEntry;
}
