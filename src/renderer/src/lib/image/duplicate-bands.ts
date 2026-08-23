import { allocateTypedArrayLikeBandOrThrow } from "@/lib/image/raster-allocation";
import {
  describeRasterBandDisplayIdentity,
  getRasterBandExplicitLabelOrNull,
  getRasterBandOriginalNumber,
  listRasterBandOriginalNumbers,
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";

// CT-301: append copies of the given bands (by CURRENT band index, in the
// given order) to the end of the stack. Each copy carries the source band's
// own pixel data, wavelength, and original band number; its label is the
// source band's display label plus " copy". Bands NOT duplicated keep their
// existing identity untouched.

export function duplicateRasterBands(
  raster: RasterImage,
  bandIndexesToDuplicate: ReadonlyArray<number>,
): RasterImage {
  assertBandIndexesToDuplicate(raster, bandIndexesToDuplicate);
  return {
    ...raster,
    bandPixels: [
      ...raster.bandPixels,
      ...bandIndexesToDuplicate.map((bandIndex) => copyRasterBand(raster.bandPixels[bandIndex]!)),
    ],
    bandLabels: buildBandLabelsWithDuplicates(raster, bandIndexesToDuplicate),
    bandWavelengths: buildBandWavelengthsWithDuplicates(raster, bandIndexesToDuplicate),
    bandOriginalNumbers: buildBandOriginalNumbersWithDuplicates(raster, bandIndexesToDuplicate),
    bandCount: raster.bandCount + bandIndexesToDuplicate.length,
  };
}

function assertBandIndexesToDuplicate(
  raster: RasterImage,
  bandIndexesToDuplicate: ReadonlyArray<number>,
): void {
  if (bandIndexesToDuplicate.length === 0) {
    throw new Error("Duplicate bands requires at least one band to duplicate.");
  }
  for (const bandIndex of bandIndexesToDuplicate) {
    if (bandIndex < 0 || bandIndex >= raster.bandCount) {
      throw new Error(
        `Band index ${bandIndex} out of range for raster with ${raster.bandCount} bands.`,
      );
    }
  }
}

function copyRasterBand(band: RasterTypedArray): RasterTypedArray {
  const copy = allocateTypedArrayLikeBandOrThrow(band, band.length);
  copy.set(band as never);
  return copy;
}

function buildBandLabelsWithDuplicates(
  raster: RasterImage,
  bandIndexesToDuplicate: ReadonlyArray<number>,
): ReadonlyArray<string> {
  const originalLabels = Array.from(
    { length: raster.bandCount },
    (_, bandIndex) => getRasterBandExplicitLabelOrNull(raster, bandIndex) ?? "",
  );
  const duplicatedLabels = bandIndexesToDuplicate.map(
    (bandIndex) => `${describeRasterBandDisplayIdentity(raster, bandIndex).label} copy`,
  );
  return [...originalLabels, ...duplicatedLabels];
}

function buildBandWavelengthsWithDuplicates(
  raster: RasterImage,
  bandIndexesToDuplicate: ReadonlyArray<number>,
): ReadonlyArray<number> | undefined {
  if (!raster.bandWavelengths) return undefined;
  const wavelengths = raster.bandWavelengths;
  return [...wavelengths, ...bandIndexesToDuplicate.map((bandIndex) => wavelengths[bandIndex]!)];
}

function buildBandOriginalNumbersWithDuplicates(
  raster: RasterImage,
  bandIndexesToDuplicate: ReadonlyArray<number>,
): ReadonlyArray<number> {
  const originalNumbers = listRasterBandOriginalNumbers(raster);
  const duplicatedOriginalNumbers = bandIndexesToDuplicate.map((bandIndex) =>
    getRasterBandOriginalNumber(raster, bandIndex),
  );
  return [...originalNumbers, ...duplicatedOriginalNumbers];
}
