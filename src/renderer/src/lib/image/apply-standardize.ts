import {
  makeFloatRasterFromBandComputation,
  makeFloatRasterReusingUnchangedSourceBands,
  mapBandPixelsToFloat32,
} from "@/lib/image/make-float-raster";
import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";

// CT-084: data-changing standardize to a target mean and standard deviation.
// Full cube uses one cube-wide mean/std; band-wise uses each selected band's own
// mean/std. Output is a float32 raster (CT-077), so out-of-range true values
// survive while display clips. A zero-std band (every value identical) cannot be
// scaled, so every pixel maps to the target mean (no NaN/Inf). Non-selected bands
// in a band-wise pass are copied through unchanged.

export type StandardizeScopeSelection =
  | { readonly scope: "full-cube" }
  | { readonly scope: "band-wise"; readonly bandIndexes: ReadonlyArray<number> };

export interface StandardizeTargetDistribution {
  readonly targetMean: number;
  readonly targetStandardDeviation: number;
}

interface MeanAndStandardDeviation {
  readonly mean: number;
  readonly standardDeviation: number;
}

export function applyStandardizeToRaster(
  raster: RasterImage,
  selection: StandardizeScopeSelection,
  target: StandardizeTargetDistribution,
): RasterImage {
  if (selection.scope === "full-cube") return standardizeWholeCubeToTarget(raster, target);
  return standardizeSelectedBandsIndependentlyToTarget(raster, selection.bandIndexes, target);
}

function standardizeWholeCubeToTarget(
  raster: RasterImage,
  target: StandardizeTargetDistribution,
): RasterImage {
  const cubeStatistics = computeCubeWideMeanAndStandardDeviation(raster);
  return makeFloatRasterFromBandComputation(raster, (bandPixels) =>
    standardizePixelsWithStatistics(bandPixels, cubeStatistics, target),
  );
}

function standardizeSelectedBandsIndependentlyToTarget(
  raster: RasterImage,
  bandIndexes: ReadonlyArray<number>,
  target: StandardizeTargetDistribution,
): RasterImage {
  return makeFloatRasterReusingUnchangedSourceBands(raster, new Set(bandIndexes), (bandPixels) =>
    standardizeSingleBandToTarget(bandPixels, target),
  );
}

function standardizeSingleBandToTarget(
  bandPixels: RasterTypedArray,
  target: StandardizeTargetDistribution,
): Float32Array {
  const bandStatistics = computeMeanAndStandardDeviationOverPixels(bandPixels);
  return standardizePixelsWithStatistics(bandPixels, bandStatistics, target);
}

function standardizePixelsWithStatistics(
  bandPixels: RasterTypedArray,
  statistics: MeanAndStandardDeviation,
  target: StandardizeTargetDistribution,
): Float32Array {
  return mapBandPixelsToFloat32(bandPixels, (value) =>
    standardizeValueToTarget(value, statistics, target),
  );
}

function standardizeValueToTarget(
  value: number,
  statistics: MeanAndStandardDeviation,
  target: StandardizeTargetDistribution,
): number {
  if (statistics.standardDeviation === 0) return target.targetMean;
  const zScore = (value - statistics.mean) / statistics.standardDeviation;
  return zScore * target.targetStandardDeviation + target.targetMean;
}

function computeCubeWideMeanAndStandardDeviation(raster: RasterImage): MeanAndStandardDeviation {
  const mean = computeCubeWideMean(raster);
  const variance = computeCubeWideVarianceAroundMean(raster, mean);
  return { mean, standardDeviation: Math.sqrt(variance) };
}

function computeCubeWideMean(raster: RasterImage): number {
  const totals = raster.bandPixels.reduce(addBandSumAndCountToRunningTotals, { sum: 0, count: 0 });
  return totals.count === 0 ? 0 : totals.sum / totals.count;
}

function computeCubeWideVarianceAroundMean(raster: RasterImage, mean: number): number {
  const totals = raster.bandPixels.reduce(
    (running, bandPixels) => addBandSquaredDeviationsToRunningTotals(running, bandPixels, mean),
    { sum: 0, count: 0 },
  );
  return totals.count === 0 ? 0 : totals.sum / totals.count;
}

function addBandSumAndCountToRunningTotals(
  running: { sum: number; count: number },
  bandPixels: RasterTypedArray,
): { sum: number; count: number } {
  let sum = running.sum;
  for (let pixelIndex = 0; pixelIndex < bandPixels.length; pixelIndex += 1) {
    sum += bandPixels[pixelIndex] ?? 0;
  }
  return { sum, count: running.count + bandPixels.length };
}

function addBandSquaredDeviationsToRunningTotals(
  running: { sum: number; count: number },
  bandPixels: RasterTypedArray,
  mean: number,
): { sum: number; count: number } {
  let sum = running.sum;
  for (let pixelIndex = 0; pixelIndex < bandPixels.length; pixelIndex += 1) {
    const deviation = (bandPixels[pixelIndex] ?? 0) - mean;
    sum += deviation * deviation;
  }
  return { sum, count: running.count + bandPixels.length };
}

function computeMeanAndStandardDeviationOverPixels(
  bandPixels: RasterTypedArray,
): MeanAndStandardDeviation {
  if (bandPixels.length === 0) return { mean: 0, standardDeviation: 0 };
  const mean = computeMeanOverPixels(bandPixels);
  const variance = computeVarianceOverPixelsAroundMean(bandPixels, mean);
  return { mean, standardDeviation: Math.sqrt(variance) };
}

function computeMeanOverPixels(bandPixels: RasterTypedArray): number {
  let sum = 0;
  for (let pixelIndex = 0; pixelIndex < bandPixels.length; pixelIndex += 1) {
    sum += bandPixels[pixelIndex] ?? 0;
  }
  return sum / bandPixels.length;
}

function computeVarianceOverPixelsAroundMean(bandPixels: RasterTypedArray, mean: number): number {
  let sum = 0;
  for (let pixelIndex = 0; pixelIndex < bandPixels.length; pixelIndex += 1) {
    const deviation = (bandPixels[pixelIndex] ?? 0) - mean;
    sum += deviation * deviation;
  }
  return sum / bandPixels.length;
}
