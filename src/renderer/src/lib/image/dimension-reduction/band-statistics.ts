import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";
import { throwIfOperationStopped } from "@/lib/image/operation-stop";
import { allocateFloat64ArrayOrThrow } from "@/lib/image/raster-allocation";
import {
  computeArrayReportingPerUnitProgress,
  reportProgressFractionAndYield,
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
  abortSignal?: AbortSignal,
): Promise<number[]> {
  return computeArrayReportingPerUnitProgress(
    bandCount,
    (band) => meanOfBandValues(samples.bandValues[band]!, samples.sampleCount),
    onProgress,
    abortSignal,
  );
}

// The mean-centred covariance of two band arrays, accumulated in sample order.
// Centred accumulation (not the E[xy] - mx*my identity) keeps full float64
// precision at raw uint16 magnitudes. CT-270: the fits now build their matrices
// through the blocked builder above; this per-pair kernel stays as the
// reference the builder's equivalence test pins bit-identity against.
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

// CT-270: the band-by-band covariance matrix shared by the PCA fit, the MNF
// data pass, and the ICA whitening. Only the upper triangle is computed (each
// entry mirrored, exactly like the CT-240 symmetric builder it replaces), the
// row band is centred ONCE into a reusable float64 buffer, and each sweep
// accumulates four columns at a time so the row stream is read once per four
// cells. Every cell still accumulates its products in plain sample order, so
// the entries are bit-identical to covarianceBetweenCentredBands per pair.
const COVARIANCE_COLUMN_BLOCK_WIDTH = 4;

export function computeBandCovarianceMatrixFromMeans(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
): number[][] {
  const build = startCovarianceMatrixBuild(samples, means);
  for (let row = 0; row < samples.bandCount; row += 1) {
    fillCentredRowBuffer(build, row);
    for (let blockStart = row; blockStart < samples.bandCount; blockStart += COVARIANCE_COLUMN_BLOCK_WIDTH) {
      fillMirroredCovarianceEntriesForBlock(build, row, blockStart);
    }
  }
  return build.matrix;
}

// The async twin: identical kernels and accumulation order, with a progress
// tick after every row and extra paint yields inside a row whenever the swept
// pair count exceeds the op budget (one row of a 100-band reference-scale cube
// is far too long for a single UI gap).
export async function computeBandCovarianceMatrixFromMeansReportingProgress(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<number[][]> {
  const build = startCovarianceMatrixBuild(samples, means);
  const pacing = startCovarianceYieldPacing(samples);
  for (let row = 0; row < samples.bandCount; row += 1) {
    fillCentredRowBuffer(build, row);
    await fillCovarianceRowYieldingBetweenBlocks(build, row, pacing, onProgress, abortSignal);
  }
  return build.matrix;
}

interface CovarianceMatrixBuild {
  readonly samples: CubeSampleMatrix;
  readonly means: ReadonlyArray<number>;
  readonly matrix: number[][];
  readonly centredRow: Float64Array;
}

function startCovarianceMatrixBuild(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
): CovarianceMatrixBuild {
  return {
    samples,
    means,
    matrix: Array.from({ length: samples.bandCount }, () => new Array<number>(samples.bandCount)),
    centredRow: allocateFloat64ArrayOrThrow(samples.sampleCount),
  };
}

interface CovarianceYieldPacing {
  readonly totalPairs: number;
  readonly pairsPerYield: number;
  completedPairs: number;
  pairsSinceYield: number;
}

function startCovarianceYieldPacing(samples: CubeSampleMatrix): CovarianceYieldPacing {
  return {
    totalPairs: (samples.bandCount * (samples.bandCount + 1)) / 2,
    pairsPerYield: Math.max(1, Math.floor(SAMPLE_SWEEP_OPS_PER_CHUNK / Math.max(1, samples.sampleCount))),
    completedPairs: 0,
    pairsSinceYield: 0,
  };
}

async function fillCovarianceRowYieldingBetweenBlocks(
  build: CovarianceMatrixBuild,
  row: number,
  pacing: CovarianceYieldPacing,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<void> {
  for (let blockStart = row; blockStart < build.samples.bandCount; blockStart += COVARIANCE_COLUMN_BLOCK_WIDTH) {
    pacing.pairsSinceYield += fillMirroredCovarianceEntriesForBlock(build, row, blockStart);
    if (pacing.pairsSinceYield < pacing.pairsPerYield) continue;
    await reportCovariancePairsCompleted(pacing, onProgress, abortSignal);
  }
  await reportCovariancePairsCompleted(pacing, onProgress, abortSignal);
}

async function reportCovariancePairsCompleted(
  pacing: CovarianceYieldPacing,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<void> {
  pacing.completedPairs += pacing.pairsSinceYield;
  pacing.pairsSinceYield = 0;
  await reportProgressFractionAndYield(onProgress, pacing.completedPairs / pacing.totalPairs, abortSignal);
}

function fillCentredRowBuffer(build: CovarianceMatrixBuild, row: number): void {
  const rowValues = build.samples.bandValues[row]!;
  const rowMean = build.means[row]!;
  for (let pixel = 0; pixel < build.samples.sampleCount; pixel += 1) {
    build.centredRow[pixel] = rowValues[pixel]! - rowMean;
  }
}

// Returns how many pairs (cells) the block filled.
function fillMirroredCovarianceEntriesForBlock(
  build: CovarianceMatrixBuild,
  row: number,
  blockStart: number,
): number {
  const blockEnd = Math.min(blockStart + COVARIANCE_COLUMN_BLOCK_WIDTH, build.samples.bandCount);
  if (blockEnd - blockStart === COVARIANCE_COLUMN_BLOCK_WIDTH) {
    fillMirroredEntriesFromFourColumnSums(build, row, blockStart);
  } else {
    fillMirroredEntriesOneColumnAtATime(build, row, blockStart, blockEnd);
  }
  return blockEnd - blockStart;
}

function fillMirroredEntriesFromFourColumnSums(
  build: CovarianceMatrixBuild,
  row: number,
  blockStart: number,
): void {
  const sums = sumCentredRowAgainstFourColumns(build, blockStart);
  for (let offset = 0; offset < COVARIANCE_COLUMN_BLOCK_WIDTH; offset += 1) {
    writeMirroredCovarianceEntry(build, row, blockStart + offset, sums[offset]!);
  }
}

function fillMirroredEntriesOneColumnAtATime(
  build: CovarianceMatrixBuild,
  row: number,
  blockStart: number,
  blockEnd: number,
): void {
  for (let column = blockStart; column < blockEnd; column += 1) {
    writeMirroredCovarianceEntry(build, row, column, sumCentredRowAgainstOneColumn(build, column));
  }
}

function writeMirroredCovarianceEntry(
  build: CovarianceMatrixBuild,
  row: number,
  column: number,
  centredProductSum: number,
): void {
  const entry = centredProductSum / Math.max(1, build.samples.sampleCount);
  build.matrix[row]![column] = entry;
  build.matrix[column]![row] = entry;
}

interface FourColumnBlock {
  readonly column0: RasterTypedArray;
  readonly column1: RasterTypedArray;
  readonly column2: RasterTypedArray;
  readonly column3: RasterTypedArray;
  readonly means: Float64Array;
}

function viewFourColumnBlock(build: CovarianceMatrixBuild, blockStart: number): FourColumnBlock {
  return {
    column0: build.samples.bandValues[blockStart]!,
    column1: build.samples.bandValues[blockStart + 1]!,
    column2: build.samples.bandValues[blockStart + 2]!,
    column3: build.samples.bandValues[blockStart + 3]!,
    means: Float64Array.of(
      build.means[blockStart]!,
      build.means[blockStart + 1]!,
      build.means[blockStart + 2]!,
      build.means[blockStart + 3]!,
    ),
  };
}

// The hot kernel: four independent accumulator chains over one centred-row
// stream. Each sum is a plain sample-order accumulation, so cell (row, c) gets
// the exact floats the per-pair kernel produced.
function sumCentredRowAgainstFourColumns(
  build: CovarianceMatrixBuild,
  blockStart: number,
): Float64Array {
  const { column0, column1, column2, column3, means } = viewFourColumnBlock(build, blockStart);
  const mean0 = means[0]!, mean1 = means[1]!, mean2 = means[2]!, mean3 = means[3]!;
  const centredRow = build.centredRow;
  let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0;
  for (let pixel = 0; pixel < build.samples.sampleCount; pixel += 1) {
    const centred = centredRow[pixel]!;
    sum0 += centred * (column0[pixel]! - mean0);
    sum1 += centred * (column1[pixel]! - mean1);
    sum2 += centred * (column2[pixel]! - mean2);
    sum3 += centred * (column3[pixel]! - mean3);
  }
  return Float64Array.of(sum0, sum1, sum2, sum3);
}

function sumCentredRowAgainstOneColumn(build: CovarianceMatrixBuild, column: number): number {
  const columnValues = build.samples.bandValues[column]!;
  const columnMean = build.means[column]!;
  const centredRow = build.centredRow;
  let sum = 0;
  for (let pixel = 0; pixel < build.samples.sampleCount; pixel += 1) {
    sum += centredRow[pixel]! * (columnValues[pixel]! - columnMean);
  }
  return sum;
}

// Runs range-based work over the sample axis in bounded chunks with a paint
// yield between chunks but NO progress reporting - for sweeps whose progress
// unit is coarser than a chunk (one FastICA iteration, one projected axis).
// CT-268: each yield doubles as a stop checkpoint when a signal is given.
export async function runOverSampleRangesYielding(
  sampleCount: number,
  samplesPerChunk: number,
  processRange: (startSample: number, endSample: number) => void,
  abortSignal?: AbortSignal,
): Promise<void> {
  const chunkSize = Math.max(1, Math.floor(samplesPerChunk));
  for (let start = 0; start < sampleCount; start += chunkSize) {
    processRange(start, Math.min(sampleCount, start + chunkSize));
    await yieldOnceSoTheBusyIndicatorCanPaint();
    throwIfOperationStopped(abortSignal);
  }
}

// Sized so one chunk of band-dependent per-sample work (a projection dot, a
// FastICA activation sweep) stays in the low hundreds of milliseconds at
// reference scale: budget / bandCount samples per chunk. CT-270 halved the old
// 250M budget: yields are near-free now (MessageChannel), and the measured
// 49-axis FastICA chunk at 250M ran long enough to breach the 1 s UI-gap
// ceiling at the Anna benchmark.
const SAMPLE_SWEEP_OPS_PER_CHUNK = 120_000_000;

export function samplesPerChunkForPerBandSweep(bandCount: number): number {
  return Math.max(1, Math.floor(SAMPLE_SWEEP_OPS_PER_CHUNK / Math.max(1, bandCount)));
}
