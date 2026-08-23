import { UserScriptReturnContractError } from "@/lib/image/band-ops/user-script-return-contract";

// CT-215 / CT-299: the return contract for the Custom transform operation. A user
// formula or imported tool transforms the WHOLE cube and returns a new (bands,
// height, width) cube; the band count is free (any N >= 1), and spatial dimensions
// (height, width) may be any size >= 1. Finiteness and 3-dimensionality are already
// enforced in Python before the frames are sent (CT-214), so this validates the
// decoded frames: internal consistency between the reported shape and the delivered
// bands, and that all dimensions are present and >= 1.

export interface TransformedCubeResult {
  readonly shape: readonly [number, number, number];
  readonly bands: ReadonlyArray<Float32Array>;
}

export function validateTransformedCubeAgainstSource(
  shape: ReadonlyArray<number>,
  bands: ReadonlyArray<Float32Array>,
  _sourceHeight: number,
  _sourceWidth: number,
): TransformedCubeResult {
  const [bandCount, height, width] = readThreeDimensionalShapeOrThrow(shape);
  rejectFewerThanOneBand(bandCount);
  rejectSpatialDimensionsTooSmall(height, width);
  rejectBandListInconsistentWithShape(bands, bandCount, height * width);
  return { shape: [bandCount, height, width], bands };
}

function readThreeDimensionalShapeOrThrow(
  shape: ReadonlyArray<number>,
): [number, number, number] {
  const [bandCount, height, width] = shape;
  if (shape.length !== 3 || bandCount === undefined || height === undefined || width === undefined) {
    throw new UserScriptReturnContractError(
      `The transformed cube shape must be (bands, height, width) (got ${shape.length} dimensions).`,
    );
  }
  return [bandCount, height, width];
}

function rejectFewerThanOneBand(bandCount: number): void {
  if (bandCount >= 1) return;
  throw new UserScriptReturnContractError(
    `The transformed cube must have at least one band (got ${bandCount}).`,
  );
}

function rejectSpatialDimensionsTooSmall(height: number, width: number): void {
  if (height >= 1 && width >= 1) return;
  throw new UserScriptReturnContractError(
    `The transformed cube must have height >= 1 and width >= 1 ` +
      `(got ${height} x ${width}).`,
  );
}

function rejectBandListInconsistentWithShape(
  bands: ReadonlyArray<Float32Array>,
  bandCount: number,
  pixelsPerBand: number,
): void {
  if (bands.length !== bandCount) {
    throw new UserScriptReturnContractError(
      `The transformed cube reported ${bandCount} bands but delivered ${bands.length}.`,
    );
  }
  bands.forEach((band, index) => rejectBandWithWrongPixelCount(band, index, pixelsPerBand));
}

function rejectBandWithWrongPixelCount(
  band: Float32Array,
  bandIndex: number,
  pixelsPerBand: number,
): void {
  if (band.length === pixelsPerBand) return;
  throw new UserScriptReturnContractError(
    `Transformed band ${bandIndex + 1} must have ${pixelsPerBand} values (got ${band.length}).`,
  );
}

export interface TransformSourceBandMetadata {
  readonly bandCount: number;
  readonly bandLabels?: ReadonlyArray<string>;
  readonly bandWavelengths?: ReadonlyArray<number>;
}

export interface TransformOutputBandMetadata {
  readonly bandLabels?: ReadonlyArray<string>;
  readonly bandWavelengths?: ReadonlyArray<number>;
}

// Wavelengths and labels only mean anything if the transform kept the band
// structure, so they carry through ONLY on a matching band count. On a changed
// count both stay undefined: an undefined bandLabels is how a raster gets the
// generic "Band N" display identity (describeRasterBandDisplayIdentity), whereas
// explicit "Band N" strings would render as "#1 Band 1".
export function buildTransformOutputBandMetadata(
  sourceMeta: TransformSourceBandMetadata,
  outputBandCount: number,
): TransformOutputBandMetadata {
  if (outputBandCount !== sourceMeta.bandCount) return {};
  return {
    bandLabels: sourceMeta.bandLabels ? [...sourceMeta.bandLabels] : undefined,
    bandWavelengths: sourceMeta.bandWavelengths ? [...sourceMeta.bandWavelengths] : undefined,
  };
}
