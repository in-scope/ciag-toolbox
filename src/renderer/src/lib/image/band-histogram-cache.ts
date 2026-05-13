import type { BandHistogram } from "@/lib/image/compute-band-histogram";
import type { RasterImage } from "@/lib/image/raster-image";

export class BandHistogramCache {
  private readonly entriesByRaster = new WeakMap<
    RasterImage,
    Map<string, BandHistogram>
  >();

  read(raster: RasterImage, bandIndex: number, binCount: number): BandHistogram | null {
    const innerMap = this.entriesByRaster.get(raster);
    if (!innerMap) return null;
    return innerMap.get(buildBandHistogramCacheKey(bandIndex, binCount)) ?? null;
  }

  store(
    raster: RasterImage,
    bandIndex: number,
    binCount: number,
    histogram: BandHistogram,
  ): void {
    const key = buildBandHistogramCacheKey(bandIndex, binCount);
    const existing = this.entriesByRaster.get(raster);
    if (existing) {
      existing.set(key, histogram);
      return;
    }
    const next = new Map<string, BandHistogram>();
    next.set(key, histogram);
    this.entriesByRaster.set(raster, next);
  }
}

function buildBandHistogramCacheKey(bandIndex: number, binCount: number): string {
  return `${bandIndex}|${binCount}`;
}
