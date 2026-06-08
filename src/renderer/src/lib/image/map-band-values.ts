import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";

export function mapBandValuesPreservingType(
  band: RasterTypedArray,
  mapValue: (value: number) => number,
): RasterTypedArray {
  const Constructor = band.constructor as new (length: number) => RasterTypedArray;
  const mapped = new Constructor(band.length);
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
