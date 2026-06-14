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

// CT-078 / CT-111: flat-field correction. Per band C = m * (R - D) / (F - D),
// where R is the target band, F the light reference band, D the optional dark
// reference band (zeros when omitted), and m the per-band mean of (F - D).
// Results are fractional, so the output is a float32 raster (CT-077): out-of-range
// true values survive, display clips them.
//
// CT-111 reference rules (chosen and enforced here):
// - Spatial dimensions (width and height) MUST match the target exactly.
// - Band count must either equal the target's band count (per-band correction),
//   OR be a single band that is broadcast across every target band (a lone TIFF
//   band used as a flat field). Any other band-count mismatch is rejected.

export function applyFlatFieldToRasterImage(
  target: RasterImage,
  lightReference: RasterImage,
  darkReference?: RasterImage,
): RasterImage {
  assertReferenceIsCompatibleWithTarget(target, lightReference, "Light reference");
  if (darkReference) {
    assertReferenceIsCompatibleWithTarget(target, darkReference, "Dark reference");
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
  const lightBand = readReferenceBandForTargetBand(references.lightReference, bandIndex);
  const darkBand = references.darkReference
    ? readReferenceBandForTargetBand(references.darkReference, bandIndex)
    : null;
  const denominators = computeBandDenominatorsOrThrowOnZero(references.target, lightBand, darkBand, bandIndex);
  const meanDenominator = computeMeanOfValues(denominators);
  return mapBandPixelsToFloat32(
    targetBandPixels,
    (value, index) => (meanDenominator * (value - readDarkValue(darkBand, index))) / denominators[index]!,
  );
}

function readReferenceBandForTargetBand(
  reference: RasterImage,
  targetBandIndex: number,
): RasterTypedArray {
  const referenceBandIndex = reference.bandCount === 1 ? 0 : targetBandIndex;
  return getRasterBandPixelsOrThrow(reference, referenceBandIndex);
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

function assertReferenceIsCompatibleWithTarget(
  target: RasterImage,
  reference: RasterImage,
  referenceName: string,
): void {
  assertReferenceSpatialDimensionsMatchTarget(target, reference, referenceName);
  assertReferenceBandCountIsCompatibleWithTarget(target, reference, referenceName);
}

function assertReferenceSpatialDimensionsMatchTarget(
  target: RasterImage,
  reference: RasterImage,
  referenceName: string,
): void {
  if (reference.width === target.width && reference.height === target.height) return;
  throw new Error(
    `${referenceName} size (${reference.width}x${reference.height}) does not match the ` +
      `stack size (${target.width}x${target.height}). Use a reference of the same width and height.`,
  );
}

function assertReferenceBandCountIsCompatibleWithTarget(
  target: RasterImage,
  reference: RasterImage,
  referenceName: string,
): void {
  if (reference.bandCount === target.bandCount || reference.bandCount === 1) return;
  throw new Error(
    `${referenceName} has ${reference.bandCount} bands, which does not match the stack's ` +
      `${target.bandCount} bands. Use a reference with the same number of bands, or a single-band reference.`,
  );
}

function buildZeroDivisorMessage(target: RasterImage, bandIndex: number): string {
  return (
    `Flat-field correction aborted: ${getRasterBandLabelOrDefault(target, bandIndex)} has a pixel ` +
    `where the light reference minus the dark reference is zero, which would divide by zero.`
  );
}
