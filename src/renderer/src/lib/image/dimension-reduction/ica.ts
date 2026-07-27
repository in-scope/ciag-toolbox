import {
  computePerBandMeans,
  computePerBandMeansReportingProgress,
  covarianceBetweenCentredBands,
  runOverSampleRangesYielding,
  samplesPerChunkForPerBandSweep,
} from "@/lib/image/dimension-reduction/band-statistics";
import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";
import { projectMeanCentredSamplesOntoComponentVectors } from "@/lib/image/dimension-reduction/project-samples";
import { buildSymmetricMatrixInPairChunksReportingProgress } from "@/lib/image/dimension-reduction/square-matrix-progress";
import { decomposeSymmetricMatrix } from "@/lib/image/dimension-reduction/symmetric-eigen";
import type { ComponentProjection } from "@/lib/image/dimension-reduction/transform-output";
import { allocateFloat32ArrayOrThrow } from "@/lib/image/raster-allocation";
import {
  reportMultiUnitWorkStarting,
  reportProgressFractionAndYield,
  scaleProgressToWindow,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

// CT-184: Independent Component Analysis. fitIca first WHITENS the cube via PCA
// (mean-centre, decorrelate, scale each principal axis to unit variance), then
// runs the FastICA fixed-point iteration to estimate an orthogonal unmixing
// matrix in whitened space that maximises the non-Gaussianity (independence) of
// the recovered sources. Unlike PCA's orthogonal axes, the recovered components
// isolate statistically independent sources (e.g. distinct materials). applyIca
// projects every mean-centred pixel onto the kept component vectors, exactly like
// PCA and MNF, so the CT-182 fit-on-ROI / apply-to-whole split composes with no
// ICA-specific code.
//
// The whole iteration is DETERMINISTIC (no Math.random): each component starts
// from a fixed, index-derived seed vector, so tests are reproducible and never
// flaky. A max-iteration cap guarantees termination even on near-Gaussian data
// that FastICA cannot separate. ICA reports NO per-component strength metric
// (none is standard), so the action omits component labels.
//
// CT-240: the fit statistics stream from the sample matrix's band arrays (which
// alias the live raster - no float64 cube copy). ICA's only cube-scale working
// set is the whitened sample matrix, and its SAMPLE COUNT IS CAPPED: the
// FastICA expectation (and the recovered-variance ordering) is estimated over
// a uniform spatial stride of at most MAX_FAST_ICA_FIT_SAMPLES pixels, while
// the means, the whitening covariance, and the final projection stay exact
// over every pixel. At the 50-megapixel reference scale an uncapped whitened
// matrix (10 axes x 50M float32 = 2 GB) sat dead-but-uncollected through the
// projection phase and tipped the renderer ArrayBuffer pool over (V8 runs no
// last-resort GC when a backing-store allocation fails - the measured CT-240
// failure); the capped matrix is ~150 MB and the estimation math is the same
// statistic over a large uniform sample. Cubes at or below the cap keep stride
// 1 and are bit-identical to the uncapped fit. Whitened axes store FLOAT32
// (mapped allocator, priced by estimate-apply-allocation.ts); the FastICA
// sweeps accumulate in float64, and the sync and async fits share every
// accumulation path, so their results stay identical.

export interface IcaFit {
  readonly means: ReadonlyArray<number>;
  readonly componentVectors: ReadonlyArray<ReadonlyArray<number>>;
}

const MAX_FAST_ICA_ITERATIONS = 200;
const FAST_ICA_CONVERGENCE_TOLERANCE = 1e-6;

// The FastICA estimation sample cap (see the CT-240 note above). 4M uniform
// samples estimate a <= 100-dimensional expectation with far more precision
// than the fixed-point tolerance resolves, at 1/13 of the reference-scale
// pixel count.
export const MAX_FAST_ICA_FIT_SAMPLES = 4_000_000;

export interface FastIcaFitSampling {
  readonly stride: number;
  readonly sampledCount: number;
}

export function describeFastIcaFitSampling(sampleCount: number): FastIcaFitSampling {
  const stride = Math.max(1, Math.ceil(sampleCount / MAX_FAST_ICA_FIT_SAMPLES));
  return { stride, sampledCount: Math.ceil(Math.max(0, sampleCount) / stride) };
}
// Near-zero principal axes (a collinear cube) would make whitening divide by
// zero; flooring the tiny eigenvalues keeps the whitening finite, exactly like
// the MNF noise whitening.
const WHITENING_EIGENVALUE_FLOOR_FRACTION = 1e-6;

export function fitIca(samples: CubeSampleMatrix, components: number): IcaFit {
  const means = computePerBandMeans(samples, samples.bandCount);
  const whitening = buildWhiteningMatrix(samples, means, components);
  const whitened = whitenCentredSamples(samples, means, whitening);
  const unmixing = orderUnmixingByRecoveredSourceVariance(estimateUnmixingMatrix(whitened), whitened);
  return { means, componentVectors: multiplyMatrices(unmixing, whitening) };
}

// CT-227: the async twin of fitIca. The means, whitening covariance, and
// whitened-sample projections fill the first half of the fit window; the
// FastICA estimation fills the second with one tick per fixed-point iteration
// against the iteration cap. Every step reuses the sync accumulation paths (in
// chunked sample ranges with paint yields), so the fits are identical.
const ICA_MEANS_END_FRACTION = 0.05;
const ICA_WHITENING_MATRIX_END_FRACTION = 0.35;
const ICA_WHITENED_SAMPLES_END_FRACTION = 0.5;

export async function fitIcaReportingProgress(
  samples: CubeSampleMatrix,
  components: number,
  onProgress?: UnitProgressCallback,
): Promise<IcaFit> {
  const means = await computePerBandMeansReportingProgress(
    samples,
    samples.bandCount,
    scaleProgressToWindow(onProgress, 0, ICA_MEANS_END_FRACTION),
  );
  const { whitening, whitened } = await whitenCubeReportingProgress(samples, means, components, onProgress);
  const unmixing = await estimateUnmixingMatrixReportingProgress(
    whitened,
    scaleProgressToWindow(onProgress, ICA_WHITENED_SAMPLES_END_FRACTION, 1),
  );
  const ordered = await orderUnmixingByRecoveredSourceVarianceYielding(unmixing, whitened);
  return { means, componentVectors: multiplyMatrices(ordered, whitening) };
}

interface WhitenedCube {
  readonly whitening: number[][];
  readonly whitened: Float32Array[];
}

async function whitenCubeReportingProgress(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  components: number,
  onProgress?: UnitProgressCallback,
): Promise<WhitenedCube> {
  const whitening = await buildWhiteningMatrixReportingProgress(
    samples,
    means,
    components,
    scaleProgressToWindow(onProgress, ICA_MEANS_END_FRACTION, ICA_WHITENING_MATRIX_END_FRACTION),
  );
  const whitened = await projectWhitenedAxesInSampleChunks(
    samples,
    means,
    whitening,
    scaleProgressToWindow(onProgress, ICA_WHITENING_MATRIX_END_FRACTION, ICA_WHITENED_SAMPLES_END_FRACTION),
  );
  return { whitening, whitened };
}

// One tick per projected axis, with each axis's sampled sweep chunked so it
// never blocks the renderer past the UI-gap threshold.
async function projectWhitenedAxesInSampleChunks(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  whitening: ReadonlyArray<ReadonlyArray<number>>,
  onProgress?: UnitProgressCallback,
): Promise<Float32Array[]> {
  reportMultiUnitWorkStarting(onProgress, whitening.length);
  const sampling = describeFastIcaFitSampling(samples.sampleCount);
  const whitened: Float32Array[] = [];
  for (let axis = 0; axis < whitening.length; axis += 1) {
    whitened.push(await projectSampledCentredPixelsOntoVectorYielding(samples, means, whitening[axis]!, sampling));
    await reportProgressFractionAndYield(onProgress, (axis + 1) / whitening.length);
  }
  return whitened;
}

async function projectSampledCentredPixelsOntoVectorYielding(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  vector: ReadonlyArray<number>,
  sampling: FastIcaFitSampling,
): Promise<Float32Array> {
  const projected = allocateFloat32ArrayOrThrow(sampling.sampledCount);
  await runOverSampleRangesYielding(
    sampling.sampledCount,
    samplesPerChunkForPerBandSweep(samples.bandCount),
    (start, end) => fillWhitenedAxisSampleRange(samples, means, vector, projected, sampling.stride, start, end),
  );
  return projected;
}

// ICA imposes no natural component order, but a rank-deficient cube (e.g.
// collinear bands) leaves some recovered directions in the data's null space,
// where the recovered source is ~0. Ordering the components by descending
// recovered-source variance keeps those empty directions last, so the leading
// kept components always carry real signal. This is an ordering, not a displayed
// strength metric, so the kept bands still read plain "IC N".
function orderUnmixingByRecoveredSourceVariance(
  unmixing: ReadonlyArray<ReadonlyArray<number>>,
  whitened: ReadonlyArray<Float32Array>,
): number[][] {
  return sortUnmixingRowsByDescendingVariance(
    unmixing.map((row) => ({ row: [...row], variance: recoveredSourceVariance(row, whitened) })),
  );
}

// The async twin computes the SAME variances (same accumulation order) with
// paint yields between sample chunks, then applies the same stable sort.
async function orderUnmixingByRecoveredSourceVarianceYielding(
  unmixing: ReadonlyArray<ReadonlyArray<number>>,
  whitened: ReadonlyArray<Float32Array>,
): Promise<number[][]> {
  const entries: VarianceTaggedRow[] = [];
  for (const row of unmixing) {
    entries.push({ row: [...row], variance: await recoveredSourceVarianceYielding(row, whitened) });
  }
  return sortUnmixingRowsByDescendingVariance(entries);
}

interface VarianceTaggedRow {
  readonly row: number[];
  readonly variance: number;
}

function sortUnmixingRowsByDescendingVariance(entries: ReadonlyArray<VarianceTaggedRow>): number[][] {
  return [...entries].sort((a, b) => b.variance - a.variance).map((entry) => entry.row);
}

function recoveredSourceVariance(
  row: ReadonlyArray<number>,
  whitened: ReadonlyArray<Float32Array>,
): number {
  const sampleCount = whitened[0]?.length ?? 0;
  const accumulator = { sumOfSquares: 0 };
  accumulateRecoveredSourceSquares(row, whitened, 0, sampleCount, accumulator);
  return accumulator.sumOfSquares / Math.max(1, sampleCount);
}

async function recoveredSourceVarianceYielding(
  row: ReadonlyArray<number>,
  whitened: ReadonlyArray<Float32Array>,
): Promise<number> {
  const sampleCount = whitened[0]?.length ?? 0;
  const accumulator = { sumOfSquares: 0 };
  await runOverSampleRangesYielding(sampleCount, samplesPerChunkForPerBandSweep(whitened.length), (start, end) =>
    accumulateRecoveredSourceSquares(row, whitened, start, end, accumulator),
  );
  return accumulator.sumOfSquares / Math.max(1, sampleCount);
}

function accumulateRecoveredSourceSquares(
  row: ReadonlyArray<number>,
  whitened: ReadonlyArray<Float32Array>,
  startSample: number,
  endSample: number,
  accumulator: { sumOfSquares: number },
): void {
  for (let pixel = startSample; pixel < endSample; pixel += 1) {
    const recovered = dotWhitenedSampleWithVector(whitened, row, pixel);
    accumulator.sumOfSquares += recovered * recovered;
  }
}

export function applyIca(
  samples: CubeSampleMatrix,
  fit: IcaFit,
  keep: number = fit.componentVectors.length,
): ComponentProjection {
  return projectMeanCentredSamplesOntoComponentVectors(samples, fit.means, fit.componentVectors, keep);
}

// The whitening matrix maps a mean-centred pixel onto the top `components`
// principal axes, each scaled to unit variance: row i = eigenvector_i /
// sqrt(eigenvalue_i). The resulting whitened samples are sphered (identity
// covariance), which is the precondition FastICA assumes.
function buildWhiteningMatrix(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  components: number,
): number[][] {
  const covariance = computeBandCovarianceMatrix(samples, means, samples.bandCount);
  return whiteningRowsFromCovariance(covariance, samples.bandCount, components);
}

async function buildWhiteningMatrixReportingProgress(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  components: number,
  onProgress?: UnitProgressCallback,
): Promise<number[][]> {
  const covariance = await buildSymmetricMatrixInPairChunksReportingProgress(
    samples.bandCount,
    (row, column) => covarianceBetweenBands(samples, means, row, column),
    onProgress,
  );
  return whiteningRowsFromCovariance(covariance, samples.bandCount, components);
}

function whiteningRowsFromCovariance(
  covariance: ReadonlyArray<ReadonlyArray<number>>,
  bandCount: number,
  components: number,
): number[][] {
  const { eigenvalues, eigenvectors } = decomposeSymmetricMatrix(covariance);
  const floor = eigenvalueFloor(eigenvalues);
  const keep = Math.min(components, bandCount);
  return Array.from({ length: keep }, (_unused, axis) =>
    scaleVector(eigenvectors[axis]!, 1 / Math.sqrt(Math.max(eigenvalues[axis]!, floor))),
  );
}

function eigenvalueFloor(eigenvalues: ReadonlyArray<number>): number {
  const largest = eigenvalues.reduce((max, value) => Math.max(max, value), 0);
  return largest > 0 ? largest * WHITENING_EIGENVALUE_FLOOR_FRACTION : 1;
}

function computeBandCovarianceMatrix(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  bandCount: number,
): number[][] {
  return Array.from({ length: bandCount }, (_unused, row) =>
    Array.from({ length: bandCount }, (_unused2, column) =>
      covarianceBetweenBands(samples, means, row, column),
    ),
  );
}

function covarianceBetweenBands(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  rowBand: number,
  columnBand: number,
): number {
  return covarianceBetweenCentredBands(
    samples.bandValues[rowBand]!,
    samples.bandValues[columnBand]!,
    means[rowBand]!,
    means[columnBand]!,
    samples.sampleCount,
  );
}

function whitenCentredSamples(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  whitening: ReadonlyArray<ReadonlyArray<number>>,
): Float32Array[] {
  const sampling = describeFastIcaFitSampling(samples.sampleCount);
  return whitening.map((row) => projectSampledCentredPixelsOntoVector(samples, means, row, sampling));
}

// The whitened axes are the fit's only cube-scale working set, so they hold
// only the capped uniform sample (stride 1 below the cap) and store float32
// (mapped allocator) - the FastICA sweeps still accumulate in float64, and
// both the sync and async fits read the same rounded storage.
function projectSampledCentredPixelsOntoVector(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  vector: ReadonlyArray<number>,
  sampling: FastIcaFitSampling,
): Float32Array {
  const projected = allocateFloat32ArrayOrThrow(sampling.sampledCount);
  fillWhitenedAxisSampleRange(samples, means, vector, projected, sampling.stride, 0, sampling.sampledCount);
  return projected;
}

function fillWhitenedAxisSampleRange(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  vector: ReadonlyArray<number>,
  projected: Float32Array,
  stride: number,
  startSampledIndex: number,
  endSampledIndex: number,
): void {
  for (let index = startSampledIndex; index < endSampledIndex; index += 1) {
    projected[index] = dotCentredSampleWithVector(samples, means, vector, index * stride);
  }
}

function dotCentredSampleWithVector(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  vector: ReadonlyArray<number>,
  pixel: number,
): number {
  let sum = 0;
  for (let band = 0; band < samples.bandCount; band += 1) {
    sum += vector[band]! * (samples.bandValues[band]![pixel]! - means[band]!);
  }
  return sum;
}

// FastICA by deflation: extract one independent component at a time, each
// decorrelated against the components already found (Gram-Schmidt), so the
// resulting unmixing rows stay orthonormal in whitened space.
function estimateUnmixingMatrix(whitened: ReadonlyArray<Float32Array>): number[][] {
  const found: number[][] = [];
  for (let index = 0; index < whitened.length; index += 1) {
    found.push(extractSingleIndependentComponent(whitened, found, index));
  }
  return found;
}

// CT-227: the async twin of estimateUnmixingMatrix. Each component owns an equal
// window of the estimation's fraction and ticks once per fixed-point iteration
// against the iteration cap (with a completion tick when it converges early), so
// the bar advances during the sample-sweeping FastICA updates.
async function estimateUnmixingMatrixReportingProgress(
  whitened: ReadonlyArray<Float32Array>,
  onProgress?: UnitProgressCallback,
): Promise<number[][]> {
  const found: number[][] = [];
  for (let index = 0; index < whitened.length; index += 1) {
    const componentWindow = scaleProgressToWindow(onProgress, index / whitened.length, (index + 1) / whitened.length);
    found.push(await extractSingleIndependentComponentReportingProgress(whitened, found, index, componentWindow));
  }
  return found;
}

function extractSingleIndependentComponent(
  whitened: ReadonlyArray<Float32Array>,
  alreadyFound: ReadonlyArray<ReadonlyArray<number>>,
  index: number,
): number[] {
  let vector = decorrelateAndNormalize(makeDeterministicSeedVector(whitened.length, index), alreadyFound);
  for (let iteration = 0; iteration < MAX_FAST_ICA_ITERATIONS; iteration += 1) {
    const next = decorrelateAndNormalize(fastIcaFixedPointUpdate(whitened, vector), alreadyFound);
    if (hasFastIcaConverged(next, vector)) return next;
    vector = next;
  }
  return vector;
}

async function extractSingleIndependentComponentReportingProgress(
  whitened: ReadonlyArray<Float32Array>,
  alreadyFound: ReadonlyArray<ReadonlyArray<number>>,
  index: number,
  onProgress?: UnitProgressCallback,
): Promise<number[]> {
  let vector = decorrelateAndNormalize(makeDeterministicSeedVector(whitened.length, index), alreadyFound);
  for (let iteration = 0; iteration < MAX_FAST_ICA_ITERATIONS; iteration += 1) {
    const next = decorrelateAndNormalize(await fastIcaFixedPointUpdateYielding(whitened, vector), alreadyFound);
    await reportProgressFractionAndYield(onProgress, (iteration + 1) / MAX_FAST_ICA_ITERATIONS);
    if (hasFastIcaConverged(next, vector)) return finishComponentReportingCompletion(next, onProgress);
    vector = next;
  }
  return vector;
}

async function finishComponentReportingCompletion(
  vector: number[],
  onProgress?: UnitProgressCallback,
): Promise<number[]> {
  await reportProgressFractionAndYield(onProgress, 1);
  return vector;
}

// A fixed, index-derived seed (no Math.random) keeps the iteration deterministic
// while avoiding the standard-basis vectors that can sit on a symmetric saddle of
// the sphered data.
function makeDeterministicSeedVector(dimension: number, index: number): number[] {
  return Array.from({ length: dimension }, (_unused, axis) => Math.cos((index + 1) * (axis + 1)));
}

function hasFastIcaConverged(next: ReadonlyArray<number>, previous: ReadonlyArray<number>): boolean {
  return Math.abs(1 - Math.abs(dotVectors(next, previous))) < FAST_ICA_CONVERGENCE_TOLERANCE;
}

// One FastICA logcosh fixed-point step: w+ = E[z g(wᵀz)] - E[g'(wᵀz)] w, with
// g = tanh. The expectation over every whitened sample is what drives w toward a
// maximally non-Gaussian (independent) projection direction. The sync and async
// paths share the range accumulator, so their floats are identical; the async
// path only inserts paint yields between sample chunks.
function fastIcaFixedPointUpdate(whitened: ReadonlyArray<Float32Array>, vector: ReadonlyArray<number>): number[] {
  const sampleCount = whitened[0]?.length ?? 0;
  const accumulators = makeFastIcaSweepAccumulators(whitened.length);
  accumulateFastIcaSampleRange(whitened, vector, 0, sampleCount, accumulators);
  return combineFastIcaUpdate(accumulators, vector, sampleCount);
}

async function fastIcaFixedPointUpdateYielding(
  whitened: ReadonlyArray<Float32Array>,
  vector: ReadonlyArray<number>,
): Promise<number[]> {
  const sampleCount = whitened[0]?.length ?? 0;
  const accumulators = makeFastIcaSweepAccumulators(whitened.length);
  await runOverSampleRangesYielding(sampleCount, fastIcaSamplesPerChunk(whitened.length), (start, end) =>
    accumulateFastIcaSampleRange(whitened, vector, start, end, accumulators),
  );
  return combineFastIcaUpdate(accumulators, vector, sampleCount);
}

// tanh dominates the per-sample cost, so the chunk budget prices each sample as
// the axis work plus a flat activation cost.
const FAST_ICA_TANH_OP_COST = 24;

function fastIcaSamplesPerChunk(axisCount: number): number {
  return samplesPerChunkForPerBandSweep(2 * axisCount + FAST_ICA_TANH_OP_COST);
}

interface FastIcaSweepAccumulators {
  readonly weightedSampleSum: Float64Array;
  derivativeSum: number;
}

function makeFastIcaSweepAccumulators(axisCount: number): FastIcaSweepAccumulators {
  return { weightedSampleSum: new Float64Array(axisCount), derivativeSum: 0 };
}

function accumulateFastIcaSampleRange(
  whitened: ReadonlyArray<Float32Array>,
  vector: ReadonlyArray<number>,
  startSample: number,
  endSample: number,
  accumulators: FastIcaSweepAccumulators,
): void {
  for (let pixel = startSample; pixel < endSample; pixel += 1) {
    const activation = Math.tanh(dotWhitenedSampleWithVector(whitened, vector, pixel));
    accumulateWeightedSample(accumulators.weightedSampleSum, whitened, pixel, activation);
    accumulators.derivativeSum += 1 - activation * activation;
  }
}

function dotWhitenedSampleWithVector(
  whitened: ReadonlyArray<Float32Array>,
  vector: ReadonlyArray<number>,
  pixel: number,
): number {
  let sum = 0;
  for (let axis = 0; axis < whitened.length; axis += 1) sum += whitened[axis]![pixel]! * vector[axis]!;
  return sum;
}

function accumulateWeightedSample(
  weightedSampleSum: Float64Array,
  whitened: ReadonlyArray<Float32Array>,
  pixel: number,
  weight: number,
): void {
  for (let axis = 0; axis < whitened.length; axis += 1) {
    weightedSampleSum[axis] = weightedSampleSum[axis]! + whitened[axis]![pixel]! * weight;
  }
}

function combineFastIcaUpdate(
  accumulators: FastIcaSweepAccumulators,
  vector: ReadonlyArray<number>,
  sampleCount: number,
): number[] {
  const meanDerivative = accumulators.derivativeSum / Math.max(1, sampleCount);
  return Array.from(accumulators.weightedSampleSum, (sum, axis) =>
    sum / Math.max(1, sampleCount) - meanDerivative * vector[axis]!,
  );
}

function decorrelateAndNormalize(
  vector: ReadonlyArray<number>,
  alreadyFound: ReadonlyArray<ReadonlyArray<number>>,
): number[] {
  return normalizeVector(subtractProjectionsOntoFoundComponents(vector, alreadyFound));
}

function subtractProjectionsOntoFoundComponents(
  vector: ReadonlyArray<number>,
  alreadyFound: ReadonlyArray<ReadonlyArray<number>>,
): number[] {
  return alreadyFound.reduce<number[]>(
    (current, found) => subtractScaledVector(current, found, dotVectors(current, found)),
    [...vector],
  );
}

function subtractScaledVector(
  vector: ReadonlyArray<number>,
  direction: ReadonlyArray<number>,
  scale: number,
): number[] {
  return vector.map((value, axis) => value - scale * direction[axis]!);
}

function normalizeVector(vector: ReadonlyArray<number>): number[] {
  const norm = Math.sqrt(dotVectors(vector, vector));
  if (!(norm > 0)) return [...vector];
  return vector.map((value) => value / norm);
}

function multiplyMatrices(
  left: ReadonlyArray<ReadonlyArray<number>>,
  right: ReadonlyArray<ReadonlyArray<number>>,
): number[][] {
  return left.map((leftRow) => buildProductRow(leftRow, right));
}

function buildProductRow(
  leftRow: ReadonlyArray<number>,
  right: ReadonlyArray<ReadonlyArray<number>>,
): number[] {
  const columnCount = right[0]?.length ?? 0;
  return Array.from({ length: columnCount }, (_unused, column) =>
    accumulateRowTimesColumn(leftRow, right, column),
  );
}

function accumulateRowTimesColumn(
  leftRow: ReadonlyArray<number>,
  right: ReadonlyArray<ReadonlyArray<number>>,
  column: number,
): number {
  let sum = 0;
  for (let k = 0; k < leftRow.length; k += 1) sum += leftRow[k]! * right[k]![column]!;
  return sum;
}

function dotVectors(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let sum = 0;
  for (let axis = 0; axis < a.length; axis += 1) sum += a[axis]! * b[axis]!;
  return sum;
}

function scaleVector(vector: ReadonlyArray<number>, factor: number): number[] {
  return vector.map((value) => value * factor);
}
