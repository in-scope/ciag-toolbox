import {
  buildRasterMemoryAllocationErrorForByteLength,
  RasterMemoryAllocationError,
} from "@/lib/image/raster-allocation";
import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";
import {
  reportCompletedUnitAndYieldSoProgressCanPaint,
  reportMultiUnitWorkStarting,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

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

// CT-239: the error class moved to raster-allocation.ts (the shared mapped
// allocator); re-exported here for the existing importers.
export { RasterMemoryAllocationError };

export function makeFloatRasterFromBandComputation(
  source: RasterImage,
  computeFloatBand: ComputeFloatBandFromSource,
): RasterImage {
  const bandPixels = source.bandPixels.map((band, index) =>
    computeSingleFloatBandMatchingSourceLength(band, index, computeFloatBand),
  );
  return buildFloat32RasterPreservingMetadata(source, bandPixels);
}

// CT-226: an async per-band computation may itself be chunked, reporting its own
// 0..1 within-band fraction (third argument), which the band loop folds into the
// overall fraction as (completed bands + within-band fraction) / band count. A
// plain sync ComputeFloatBandFromSource is assignable and simply never ticks
// within a band.
export type ComputeFloatBandFromSourceReportingProgress = (
  sourceBandPixels: RasterTypedArray,
  bandIndex: number,
  onWithinBandProgress?: UnitProgressCallback,
) => Float32Array | Promise<Float32Array>;

// CT-221: the async twin of makeFloatRasterFromBandComputation. One progress tick
// (and a paint yield) per computed band, so a long per-band operation can drive a
// determinate busy indicator. The per-band math is identical to the sync version.
export async function makeFloatRasterFromBandComputationReportingProgress(
  source: RasterImage,
  computeFloatBand: ComputeFloatBandFromSourceReportingProgress,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<RasterImage> {
  const bandPixels = await computeFloatBandsFoldingWithinBandProgress(
    source,
    (index, onWithinBand) => computeFloatBand(source.bandPixels[index]!, index, onWithinBand),
    onProgress,
    abortSignal,
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

// CT-221: the async twin of makeFloatRasterReusingUnchangedSourceBands. Every band
// is a progress unit (carried-through bands tick instantly), so the fraction tracks
// the whole output raster.
export async function makeFloatRasterReusingUnchangedSourceBandsReportingProgress(
  source: RasterImage,
  changedBandIndexes: ReadonlySet<number>,
  computeChangedFloatBand: ComputeFloatBandFromSourceReportingProgress,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<RasterImage> {
  const bandPixels = await computeFloatBandsFoldingWithinBandProgress(
    source,
    (index, onWithinBand) =>
      computeChangedBandOrCarryThrough(source, changedBandIndexes, computeChangedFloatBand, index, onWithinBand),
    onProgress,
    abortSignal,
  );
  return buildFloat32RasterPreservingMetadata(source, bandPixels);
}

function computeChangedBandOrCarryThrough(
  source: RasterImage,
  changedBandIndexes: ReadonlySet<number>,
  computeChangedFloatBand: ComputeFloatBandFromSourceReportingProgress,
  index: number,
  onWithinBandProgress?: UnitProgressCallback,
): Float32Array | Promise<Float32Array> {
  const band = source.bandPixels[index]!;
  if (!changedBandIndexes.has(index)) return carryUnchangedBandThroughAsFloat32(band);
  return computeChangedFloatBand(band, index, onWithinBandProgress);
}

// CT-226: the shared band loop behind both async twins. The within-band callback
// for band i maps a 0..1 fraction to (i + fraction) / bandCount, so a chunked
// band computation advances the bar continuously between per-band completion
// ticks.
async function computeFloatBandsFoldingWithinBandProgress(
  source: RasterImage,
  computeBand: (index: number, onWithinBand?: UnitProgressCallback) => Float32Array | Promise<Float32Array>,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<Float32Array[]> {
  const totalBands = source.bandPixels.length;
  reportMultiUnitWorkStarting(onProgress, totalBands);
  const bandPixels: Float32Array[] = [];
  for (let index = 0; index < totalBands; index += 1) {
    const onWithinBand = onProgress
      ? (fraction: number): void => onProgress((index + fraction) / totalBands)
      : undefined;
    bandPixels.push(await computeBandAssertingSourceLength(source, computeBand, index, onWithinBand));
    await reportCompletedUnitAndYieldSoProgressCanPaint(onProgress, index + 1, totalBands, abortSignal);
  }
  return bandPixels;
}

async function computeBandAssertingSourceLength(
  source: RasterImage,
  computeBand: (index: number, onWithinBand?: UnitProgressCallback) => Float32Array | Promise<Float32Array>,
  index: number,
  onWithinBand?: UnitProgressCallback,
): Promise<Float32Array> {
  const result = await computeBand(index, onWithinBand);
  assertComputedBandLengthMatchesSource(result, source.bandPixels[index]!, index);
  return result;
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
  return buildRasterMemoryAllocationErrorForByteLength(length * Float32Array.BYTES_PER_ELEMENT);
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
