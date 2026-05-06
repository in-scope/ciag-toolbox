import {
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";

export function applyBandKeepToRasterImage(
  raster: RasterImage,
  keptBandIndexes: ReadonlyArray<number>,
): RasterImage {
  const sortedIndexes = sortAndDeduplicateBandIndexes(keptBandIndexes);
  validateKeptBandIndexesAgainstRaster(sortedIndexes, raster);
  return {
    ...raster,
    bandPixels: pickBandPixelsByIndexList(raster.bandPixels, sortedIndexes),
    bandLabels: pickOptionalBandStringsByIndexList(raster.bandLabels, sortedIndexes),
    bandWavelengths: pickOptionalBandNumbersByIndexList(raster.bandWavelengths, sortedIndexes),
    bandCount: sortedIndexes.length,
  };
}

export function listKeptBandIndexesFromRemoved(
  totalBandCount: number,
  removedBandIndexes: ReadonlyArray<number>,
): ReadonlyArray<number> {
  const removedSet = new Set(removedBandIndexes);
  const kept: number[] = [];
  for (let bandIndex = 0; bandIndex < totalBandCount; bandIndex += 1) {
    if (!removedSet.has(bandIndex)) kept.push(bandIndex);
  }
  return kept;
}

function sortAndDeduplicateBandIndexes(
  bandIndexes: ReadonlyArray<number>,
): ReadonlyArray<number> {
  return Array.from(new Set(bandIndexes)).sort((a, b) => a - b);
}

function validateKeptBandIndexesAgainstRaster(
  sortedIndexes: ReadonlyArray<number>,
  raster: RasterImage,
): void {
  if (sortedIndexes.length === 0) {
    throw new Error("Band keep requires at least one band to keep.");
  }
  for (const bandIndex of sortedIndexes) {
    if (bandIndex < 0 || bandIndex >= raster.bandCount) {
      throw new Error(
        `Band index ${bandIndex} out of range for raster with ${raster.bandCount} bands.`,
      );
    }
  }
}

function pickBandPixelsByIndexList(
  bandPixels: ReadonlyArray<RasterTypedArray>,
  sortedIndexes: ReadonlyArray<number>,
): ReadonlyArray<RasterTypedArray> {
  return sortedIndexes.map((bandIndex) => bandPixels[bandIndex]!);
}

function pickOptionalBandStringsByIndexList(
  values: ReadonlyArray<string> | undefined,
  sortedIndexes: ReadonlyArray<number>,
): ReadonlyArray<string> | undefined {
  if (!values) return undefined;
  return sortedIndexes.map((bandIndex) => values[bandIndex] ?? "");
}

function pickOptionalBandNumbersByIndexList(
  values: ReadonlyArray<number> | undefined,
  sortedIndexes: ReadonlyArray<number>,
): ReadonlyArray<number> | undefined {
  if (!values) return undefined;
  return sortedIndexes.map((bandIndex) => values[bandIndex] ?? 0);
}
