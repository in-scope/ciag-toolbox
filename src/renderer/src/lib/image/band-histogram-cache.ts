import type { BandHistogram } from "@/lib/image/compute-band-histogram";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportRoi } from "@/lib/image/viewport-roi";

export class BandHistogramCache {
  private readonly entriesByRaster = new WeakMap<
    RasterImage,
    Map<string, BandHistogram>
  >();

  read(
    raster: RasterImage,
    bandIndex: number,
    binCount: number,
    region: ViewportRoi | null = null,
  ): BandHistogram | null {
    const innerMap = this.entriesByRaster.get(raster);
    if (!innerMap) return null;
    return innerMap.get(buildBandHistogramCacheKey(bandIndex, binCount, region)) ?? null;
  }

  store(
    raster: RasterImage,
    bandIndex: number,
    binCount: number,
    histogram: BandHistogram,
    region: ViewportRoi | null = null,
  ): void {
    const key = buildBandHistogramCacheKey(bandIndex, binCount, region);
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

function buildBandHistogramCacheKey(
  bandIndex: number,
  binCount: number,
  region: ViewportRoi | null,
): string {
  return `${bandIndex}|${binCount}|${describeRegionCornersForCacheKey(region)}`;
}

// CT-256: region and whole-band histograms cache independently, keyed by corners.
function describeRegionCornersForCacheKey(region: ViewportRoi | null): string {
  if (!region) return "whole-band";
  return `${region.imagePixelX0},${region.imagePixelY0},${region.imagePixelX1},${region.imagePixelY1}`;
}
