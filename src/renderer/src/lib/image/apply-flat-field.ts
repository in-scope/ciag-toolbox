import {
  makeFloatRasterFromBandComputation,
  mapBandPixelsToFloat32,
} from "@/lib/image/make-float-raster";
import {
  getRasterBandLabelOrDefault,
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";

// CT-078: flat-field correction. Per band C = m * (R - D) / (F - D), where R is
// the target band, F the light reference band, D the optional dark reference band
// (zeros when omitted), and m the per-band mean of (F - D). Results are fractional,
// so the output is a float32 raster (CT-077): out-of-range true values survive,
// display clips them.

export function applyFlatFieldToRasterImage(
  target: RasterImage,
  lightReference: RasterImage,
  darkReference?: RasterImage,
): RasterImage {
  assertReferenceDimensionsMatchTarget(target, lightReference, "Light reference");
  if (darkReference) {
    assertReferenceDimensionsMatchTarget(target, darkReference, "Dark reference");
  }
  return makeFloatRasterFromBandComputation(target, (targetBandPixels, bandIndex) =>
    correctSingleBandWithFlatField(
      { target, lightReference, darkReference },
      targetBandPixels,
      bandIndex,
    ),
  );
}

interface FlatFieldReferences {
  readonly target: RasterImage;
  readonly lightReference: RasterImage;
  readonly darkReference?: RasterImage;
}

function correctSingleBandWithFlatField(
  references: FlatFieldReferences,
  targetBandPixels: RasterTypedArray,
  bandIndex: number,
): Float32Array {
  const lightBand = getRasterBandPixelsOrThrow(references.lightReference, bandIndex);
  const darkBand = references.darkReference
    ? getRasterBandPixelsOrThrow(references.darkReference, bandIndex)
    : null;
  const denominators = computeBandDenominatorsOrThrowOnZero(references.target, lightBand, darkBand, bandIndex);
  const meanDenominator = computeMeanOfValues(denominators);
  return mapBandPixelsToFloat32(
    targetBandPixels,
    (value, index) => (meanDenominator * (value - readDarkValue(darkBand, index))) / denominators[index]!,
  );
}

function computeBandDenominatorsOrThrowOnZero(
  target: RasterImage,
  lightBand: RasterTypedArray,
  darkBand: RasterTypedArray | null,
  bandIndex: number,
): Float64Array {
  const denominators = new Float64Array(lightBand.length);
  for (let index = 0; index < denominators.length; index += 1) {
    const denominator = (lightBand[index] ?? 0) - readDarkValue(darkBand, index);
    if (denominator === 0) throw new Error(buildZeroDivisorMessage(target, bandIndex));
    denominators[index] = denominator;
  }
  return denominators;
}

function computeMeanOfValues(values: Float64Array): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) sum += values[index]!;
  return sum / values.length;
}

function readDarkValue(darkBand: RasterTypedArray | null, index: number): number {
  return darkBand ? (darkBand[index] ?? 0) : 0;
}

function assertReferenceDimensionsMatchTarget(
  target: RasterImage,
  reference: RasterImage,
  referenceName: string,
): void {
  if (
    reference.width === target.width &&
    reference.height === target.height &&
    reference.bandCount === target.bandCount
  ) {
    return;
  }
  throw new Error(
    `${referenceName} dimensions (${describeRasterDimensions(reference)}) do not match ` +
      `the target image (${describeRasterDimensions(target)}).`,
  );
}

function describeRasterDimensions(raster: RasterImage): string {
  return `${raster.width}x${raster.height}, ${raster.bandCount} bands`;
}

function buildZeroDivisorMessage(target: RasterImage, bandIndex: number): string {
  return (
    `Flat-field correction aborted: ${getRasterBandLabelOrDefault(target, bandIndex)} has a pixel ` +
    `where the light reference minus the dark reference is zero, which would divide by zero.`
  );
}
