import type { RasterTypedArray } from "@/lib/image/raster-image";

// CT-209: combine every band of a stack into ONE weighted-sum band. The weights
// are normalized by the sum of their absolute values, so a uniform reweighting
// keeps the output on the same scale as the input bands (weights [1, 1, 1] give
// the plain mean). All-zero weights have nothing to normalize by, so the defined
// result is an all-zero band rather than a division by zero. Output is float32,
// built by the caller through the Stage 3 float path.

export function computeWeightedSum(
  bands: ReadonlyArray<RasterTypedArray>,
  weights: ReadonlyArray<number>,
): Float32Array {
  assertWeightCountMatchesBandCount(bands.length, weights.length);
  const output = new Float32Array(bands[0]?.length ?? 0);
  const normalizer = sumOfAbsoluteWeights(weights);
  if (normalizer === 0) return output;
  fillNormalizedWeightedSum(output, bands, weights, normalizer);
  return output;
}

function fillNormalizedWeightedSum(
  output: Float32Array,
  bands: ReadonlyArray<RasterTypedArray>,
  weights: ReadonlyArray<number>,
  normalizer: number,
): void {
  for (let pixel = 0; pixel < output.length; pixel += 1) {
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
    `Band weighting needs one weight per band (expected ${bandCount}, got ${weightCount}).`,
  );
}
