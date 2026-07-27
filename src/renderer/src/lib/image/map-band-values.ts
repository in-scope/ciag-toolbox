import { allocateTypedArrayLikeBandOrThrow } from "@/lib/image/raster-allocation";
import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";
import {
  computeArrayReportingPerUnitProgress,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

export function mapBandValuesPreservingType(
  band: RasterTypedArray,
  mapValue: (value: number) => number,
): RasterTypedArray {
  const mapped = allocateTypedArrayLikeBandOrThrow(band, band.length);
  for (let index = 0; index < band.length; index += 1) {
    mapped[index] = mapValue(band[index] ?? 0);
  }
  return mapped;
}

export function mapSelectedRasterBandsPreservingType(
  raster: RasterImage,
  bandIndexes: ReadonlyArray<number>,
  transformSelectedBand: (band: RasterTypedArray) => RasterTypedArray,
): RasterImage {
  const selectedBands = new Set(bandIndexes);
  const bandPixels = raster.bandPixels.map((band, index) =>
    selectedBands.has(index) ? transformSelectedBand(band) : band,
  );
  return { ...raster, bandPixels };
}

// CT-221: the async twin of mapSelectedRasterBandsPreservingType. One progress tick
// (and a paint yield) per band, so a long type-preserving per-band operation (e.g.
// clip by value) can drive a determinate busy indicator.
export async function mapSelectedRasterBandsPreservingTypeReportingProgress(
  raster: RasterImage,
  bandIndexes: ReadonlyArray<number>,
  transformSelectedBand: (band: RasterTypedArray) => RasterTypedArray,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  const selectedBands = new Set(bandIndexes);
  const bandPixels = await computeArrayReportingPerUnitProgress(
    raster.bandPixels.length,
    (index) => (selectedBands.has(index) ? transformSelectedBand(raster.bandPixels[index]!) : raster.bandPixels[index]!),
    onProgress,
  );
  return { ...raster, bandPixels };
}
