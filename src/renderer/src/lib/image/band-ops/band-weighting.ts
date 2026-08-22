import { allocateFloat32ArrayOrThrow } from "@/lib/image/raster-allocation";
import type { RasterTypedArray } from "@/lib/image/raster-image";
import {
  runInChunksReportingProgress,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

// CT-209: combine every band of a stack into ONE weighted-sum band. The weights
// are normalized by the sum of their absolute values, so a uniform reweighting
// keeps the output on the same scale as the input bands (weights [1, 1, 1] give
// the plain mean). All-zero weights have nothing to normalize by, so the defined
// result is an all-zero band rather than a division by zero. Output is float32,
// built by the caller through the Stage 3 float path.
//
// CT-240: the output routes through the mapped allocator (a 100-band 50 MP
// weighted sum is a 200 MB band), and the async twin sweeps the pixels in
// bounded chunks with paint yields so a full-scale apply reports determinate
// progress instead of blocking the renderer past the UI-gap threshold. The
// per-pixel math and accumulation order are identical between the two.

export function computeWeightedSum(
  bands: ReadonlyArray<RasterTypedArray>,
  weights: ReadonlyArray<number>,
): Float32Array {
  const { output, normalizer } = prepareWeightedSumOutput(bands, weights);
  if (normalizer === 0) return output;
  fillNormalizedWeightedSumRange(output, bands, weights, normalizer, 0, output.length);
  return output;
}

export async function computeWeightedSumReportingProgress(
  bands: ReadonlyArray<RasterTypedArray>,
  weights: ReadonlyArray<number>,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<Float32Array> {
  const { output, normalizer } = prepareWeightedSumOutput(bands, weights);
  if (normalizer === 0) return output;
  await runInChunksReportingProgress(
    output.length,
    weightedSumPixelsPerChunk(bands.length),
    (start, end) => fillNormalizedWeightedSumRange(output, bands, weights, normalizer, start, end),
    onProgress,
    abortSignal,
  );
  return output;
}

// Sized so one chunk of bandCount multiply-adds per pixel stays in the low
// hundreds of milliseconds at reference scale.
const WEIGHTED_SUM_OPS_PER_CHUNK = 250_000_000;

function weightedSumPixelsPerChunk(bandCount: number): number {
  return Math.max(1, Math.floor(WEIGHTED_SUM_OPS_PER_CHUNK / Math.max(1, bandCount)));
}

interface PreparedWeightedSumOutput {
  readonly output: Float32Array;
  readonly normalizer: number;
}

function prepareWeightedSumOutput(
  bands: ReadonlyArray<RasterTypedArray>,
  weights: ReadonlyArray<number>,
): PreparedWeightedSumOutput {
  assertWeightCountMatchesBandCount(bands.length, weights.length);
  return {
    output: allocateFloat32ArrayOrThrow(bands[0]?.length ?? 0),
    normalizer: sumOfAbsoluteWeights(weights),
  };
}

function fillNormalizedWeightedSumRange(
  output: Float32Array,
  bands: ReadonlyArray<RasterTypedArray>,
  weights: ReadonlyArray<number>,
  normalizer: number,
  startPixel: number,
  endPixel: number,
): void {
  for (let pixel = startPixel; pixel < endPixel; pixel += 1) {
    output[pixel] = weightedSumAtPixel(bands, weights, pixel) / normalizer;
  }
}

function weightedSumAtPixel(
  bands: ReadonlyArray<RasterTypedArray>,
  weights: ReadonlyArray<number>,
  pixel: number,
): number {
  let sum = 0;
  for (let band = 0; band < bands.length; band += 1) {
    sum += (weights[band] ?? 0) * (bands[band]?.[pixel] ?? 0);
  }
  return sum;
}

function sumOfAbsoluteWeights(weights: ReadonlyArray<number>): number {
  return weights.reduce((total, weight) => total + Math.abs(weight), 0);
}

function assertWeightCountMatchesBandCount(bandCount: number, weightCount: number): void {
  if (bandCount === weightCount) return;
  throw new Error(
    `Weighted sum needs one weight per band (expected ${bandCount}, got ${weightCount}).`,
  );
}
