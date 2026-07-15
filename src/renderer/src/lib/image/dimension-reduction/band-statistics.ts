import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";
import {
  computeArrayReportingPerUnitProgress,
  yieldOnceSoTheBusyIndicatorCanPaint,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";
import type { RasterTypedArray } from "@/lib/image/raster-image";

// CT-240: the per-band statistics shared by the PCA/MNF/ICA fits, streaming
// straight from the sample matrix's band arrays (which alias the live raster's
// own bands - no float64 cube copy). Each helper has a chunked async twin with
// paint yields so a 100-band sweep over 50 megapixels never blocks the
// renderer past the UI-gap threshold; the accumulation order is identical to
// the sync helper, so sync and async results are bit-identical.

export function meanOfBandValues(values: RasterTypedArray, sampleCount: number): number {
  let sum = 0;
  for (let pixel = 0; pixel < sampleCount; pixel += 1) sum += values[pixel]!;
  return sum / Math.max(1, sampleCount);
}

export function computePerBandMeans(samples: CubeSampleMatrix, bandCount: number): number[] {
  return Array.from({ length: bandCount }, (_unused, band) =>
    meanOfBandValues(samples.bandValues[band]!, samples.sampleCount),
  );
}

// One progress tick (and one paint yield) per band; a single band's mean sweep
// is far below the UI-gap threshold even at 50 megapixels.
export function computePerBandMeansReportingProgress(
  samples: CubeSampleMatrix,
  bandCount: number,
  onProgress?: UnitProgressCallback,
): Promise<number[]> {
  return computeArrayReportingPerUnitProgress(
    bandCount,
    (band) => meanOfBandValues(samples.bandValues[band]!, samples.sampleCount),
    onProgress,
  );
}

// The mean-centred covariance of two band arrays, accumulated in sample order.
// Centred accumulation (not the E[xy] - mx*my identity) keeps full float64
// precision at raw uint16 magnitudes; hoisting the arrays and means keeps the
// hot loop monomorphic.
export function covarianceBetweenCentredBands(
  rowValues: RasterTypedArray,
  columnValues: RasterTypedArray,
  rowMean: number,
  columnMean: number,
  sampleCount: number,
): number {
  let sum = 0;
  for (let pixel = 0; pixel < sampleCount; pixel += 1) {
    sum += (rowValues[pixel]! - rowMean) * (columnValues[pixel]! - columnMean);
  }
  return sum / Math.max(1, sampleCount);
}

// Runs range-based work over the sample axis in bounded chunks with a paint
// yield between chunks but NO progress reporting - for sweeps whose progress
// unit is coarser than a chunk (one FastICA iteration, one projected axis).
export async function runOverSampleRangesYielding(
  sampleCount: number,
  samplesPerChunk: number,
  processRange: (startSample: number, endSample: number) => void,
): Promise<void> {
  const chunkSize = Math.max(1, Math.floor(samplesPerChunk));
  for (let start = 0; start < sampleCount; start += chunkSize) {
    processRange(start, Math.min(sampleCount, start + chunkSize));
    await yieldOnceSoTheBusyIndicatorCanPaint();
  }
}

// Sized so one chunk of band-dependent per-sample work (a projection dot, a
// FastICA activation sweep) stays in the low hundreds of milliseconds at
// reference scale: budget / bandCount samples per chunk.
const SAMPLE_SWEEP_OPS_PER_CHUNK = 250_000_000;

export function samplesPerChunkForPerBandSweep(bandCount: number): number {
  return Math.max(1, Math.floor(SAMPLE_SWEEP_OPS_PER_CHUNK / Math.max(1, bandCount)));
}
