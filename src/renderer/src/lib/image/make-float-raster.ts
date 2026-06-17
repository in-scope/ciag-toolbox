import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";

// CT-077: shared constructor for operation-produced float32 rasters. Operations
// that emit fractional results (normalize, standardize, Spectralon, ...) compute
// per-band values and hand them here to get a valid float raster that flows
// through tile rebuild, render (display clips to [0, 1]), pixel readout (true
// values), and the ENVI float save path. Out-of-range true values are preserved
// in bandPixels; only the display clips them.

export const FLOAT32_BITS_PER_SAMPLE = 32;

export type ComputeFloatBandFromSource = (
  sourceBandPixels: RasterTypedArray,
  bandIndex: number,
) => Float32Array;

// CT-103: a clear, actionable typed error for a failed band allocation, so the
// apply-action-flow toast names the memory needed instead of surfacing the raw
// engine "Array buffer allocation failed".
export class RasterMemoryAllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RasterMemoryAllocationError";
  }
}

export function makeFloatRasterFromBandComputation(
  source: RasterImage,
  computeFloatBand: ComputeFloatBandFromSource,
): RasterImage {
  const bandPixels = source.bandPixels.map((band, index) =>
    computeSingleFloatBandMatchingSourceLength(band, index, computeFloatBand),
  );
  return buildFloat32RasterPreservingMetadata(source, bandPixels);
}

// CT-103: a band-wise float op only allocates buffers for the bands it actually
// changes; every unchanged float band is carried through BY REFERENCE, so a
// single-band op on a large float cube no longer reallocates the whole cube.
export function makeFloatRasterReusingUnchangedSourceBands(
  source: RasterImage,
  changedBandIndexes: ReadonlySet<number>,
  computeChangedFloatBand: ComputeFloatBandFromSource,
): RasterImage {
  const bandPixels = source.bandPixels.map((band, index) =>
    changedBandIndexes.has(index)
      ? computeSingleFloatBandMatchingSourceLength(band, index, computeChangedFloatBand)
      : carryUnchangedBandThroughAsFloat32(band),
  );
  return buildFloat32RasterPreservingMetadata(source, bandPixels);
}

export function mapBandPixelsToFloat32(
  sourceBandPixels: RasterTypedArray,
  mapValue: (value: number, pixelIndex: number) => number,
): Float32Array {
  const out = allocateFloat32ArrayOrThrow(sourceBandPixels.length);
  for (let i = 0; i < sourceBandPixels.length; i += 1) {
    out[i] = mapValue(sourceBandPixels[i] ?? 0, i);
  }
  return out;
}

function carryUnchangedBandThroughAsFloat32(band: RasterTypedArray): Float32Array {
  if (band instanceof Float32Array) return band;
  return copyBandIntoNewFloat32Array(band);
}

function copyBandIntoNewFloat32Array(band: RasterTypedArray): Float32Array {
  const out = allocateFloat32ArrayOrThrow(band.length);
  out.set(band as never);
  return out;
}

function allocateFloat32ArrayOrThrow(length: number): Float32Array {
  try {
    return new Float32Array(length);
  } catch {
    throw buildRasterMemoryAllocationErrorForLength(length);
  }
}

function buildRasterMemoryAllocationErrorForLength(length: number): RasterMemoryAllocationError {
  const megabytes = Math.ceil((length * Float32Array.BYTES_PER_ELEMENT) / (1024 * 1024));
  return new RasterMemoryAllocationError(
    `Not enough memory to allocate ${megabytes} MB for this operation. ` +
      `Free memory or run it on fewer bands and try again.`,
  );
}

function computeSingleFloatBandMatchingSourceLength(
  sourceBandPixels: RasterTypedArray,
  bandIndex: number,
  computeFloatBand: ComputeFloatBandFromSource,
): Float32Array {
  const result = computeFloatBand(sourceBandPixels, bandIndex);
  assertComputedBandLengthMatchesSource(result, sourceBandPixels, bandIndex);
  return result;
}

function assertComputedBandLengthMatchesSource(
  result: Float32Array,
  sourceBandPixels: RasterTypedArray,
  bandIndex: number,
): void {
  if (result.length === sourceBandPixels.length) return;
  throw new Error(
    `Float band computation for band ${bandIndex} produced ${result.length} values ` +
      `but the source band has ${sourceBandPixels.length}`,
  );
}

function buildFloat32RasterPreservingMetadata(
  source: RasterImage,
  bandPixels: ReadonlyArray<Float32Array>,
): RasterImage {
  return {
    ...source,
    bandPixels,
    sampleFormat: "float",
    bitsPerSample: FLOAT32_BITS_PER_SAMPLE,
  };
}

export interface Float32RasterShape {
  readonly width: number;
  readonly height: number;
  readonly bandLabels?: ReadonlyArray<string>;
}

// CT-180: an operation whose output band count DIFFERS from its source (e.g. a
// dimension-reduction transform that emits N principal components from M bands)
// cannot carry source band metadata through, so it builds a fresh float raster
// from an explicit shape rather than spreading the source. The float
// sampleFormat/bitsPerSample stay defined in one place alongside CT-077.
export function makeFloat32RasterFromBands(
  shape: Float32RasterShape,
  bandPixels: ReadonlyArray<Float32Array>,
): RasterImage {
  return {
    bandPixels,
    width: shape.width,
    height: shape.height,
    bandCount: bandPixels.length,
    sampleFormat: "float",
    bitsPerSample: FLOAT32_BITS_PER_SAMPLE,
    bandLabels: shape.bandLabels ? [...shape.bandLabels] : undefined,
  };
}
