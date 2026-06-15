import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";

// CT-086: build a false-color composite by mapping three chosen source bands to
// the R, G, and B output channels. Band numbers are 1-based (as the user enters
// them) and the assignment is order-sensitive: r -> channel 0, g -> channel 1,
// b -> channel 2. The result is a 3-band raster that shares the chosen source
// band buffers read-only and preserves the source data type.

export interface FalseColorBandAssignment {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function buildFalseColorComposite(
  raster: RasterImage,
  assignment: FalseColorBandAssignment,
): RasterImage {
  assertFalseColorBandAssignmentInRange(raster, assignment);
  return buildThreeChannelCompositeRaster(raster, assignment, readAssignedChannelBands(raster, assignment));
}

export function assertFalseColorBandAssignmentInRange(
  raster: RasterImage,
  assignment: FalseColorBandAssignment,
): void {
  assertBandNumberWithinRange(raster, assignment.r, "Red");
  assertBandNumberWithinRange(raster, assignment.g, "Green");
  assertBandNumberWithinRange(raster, assignment.b, "Blue");
}

export function isFalseColorBandAssignmentInRange(
  raster: RasterImage,
  assignment: FalseColorBandAssignment,
): boolean {
  return (
    isBandNumberWithinRange(raster, assignment.r) &&
    isBandNumberWithinRange(raster, assignment.g) &&
    isBandNumberWithinRange(raster, assignment.b)
  );
}

function assertBandNumberWithinRange(raster: RasterImage, bandNumber: number, channel: string): void {
  if (isBandNumberWithinRange(raster, bandNumber)) return;
  throw new Error(
    `${channel} channel band ${bandNumber} is out of range. Choose a band between 1 and ${raster.bandCount}.`,
  );
}

function isBandNumberWithinRange(raster: RasterImage, bandNumber: number): boolean {
  return Number.isInteger(bandNumber) && bandNumber >= 1 && bandNumber <= raster.bandCount;
}

function readAssignedChannelBands(
  raster: RasterImage,
  assignment: FalseColorBandAssignment,
): readonly [RasterTypedArray, RasterTypedArray, RasterTypedArray] {
  return [
    getRasterBandPixelsOrThrow(raster, assignment.r - 1),
    getRasterBandPixelsOrThrow(raster, assignment.g - 1),
    getRasterBandPixelsOrThrow(raster, assignment.b - 1),
  ];
}

function buildThreeChannelCompositeRaster(
  source: RasterImage,
  assignment: FalseColorBandAssignment,
  channelBands: readonly [RasterTypedArray, RasterTypedArray, RasterTypedArray],
): RasterImage {
  return {
    ...source,
    bandPixels: [channelBands[0], channelBands[1], channelBands[2]],
    bandCount: 3,
    bandLabels: [`R: band ${assignment.r}`, `G: band ${assignment.g}`, `B: band ${assignment.b}`],
    bandOriginalNumbers: [assignment.r, assignment.g, assignment.b],
    bandWavelengths: undefined,
  };
}
