import {
  computeBandCovarianceMatrixFromMeans,
  computeBandCovarianceMatrixFromMeansReportingProgress,
  computePerBandMeans,
  computePerBandMeansReportingProgress,
  runOverSampleRangesYielding,
  samplesPerChunkForPerBandSweep,
} from "@/lib/image/dimension-reduction/band-statistics";
import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";
import { projectMeanCentredSamplesOntoComponentVectors } from "@/lib/image/dimension-reduction/project-samples";
import { decomposeSymmetricMatrix } from "@/lib/image/dimension-reduction/symmetric-eigen";
import type { ComponentProjection } from "@/lib/image/dimension-reduction/transform-output";
import { allocateFloat32ArrayOrThrow } from "@/lib/image/raster-allocation";
import {
  reportProgressFractionAndYield,
  runInChunksReportingProgress,
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
// 1 and are bit-identical to the uncapped fit.
//
// CT-270: the whitened set stores FLOAT32 in ONE INTERLEAVED sample-major
// matrix (a sampled pixel's axis values sit contiguously), so every FastICA
// sweep reads one linear stream instead of axisCount parallel streams, and the
// fill centres each pixel's bands once for ALL axes instead of re-reading
// every band per axis (together: ICA at the Anna benchmark dropped from
// ~186 s to well inside its 3-minute target). Each stored value is the same
// band-order dot product as before (mapped allocator, priced by
// estimate-apply-allocation.ts); the FastICA sweeps accumulate in float64, and
// the sync and async fits share every accumulation path, so their results stay
// identical.

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
  abortSignal?: AbortSignal,
): Promise<IcaFit> {
  const means = await computePerBandMeansReportingProgress(
    samples,
    samples.bandCount,
    scaleProgressToWindow(onProgress, 0, ICA_MEANS_END_FRACTION),
    abortSignal,
  );
  const { whitening, whitened } = await whitenCubeReportingProgress(samples, means, components, onProgress, abortSignal);
  const unmixing = await estimateUnmixingMatrixReportingProgress(
    whitened,
    scaleProgressToWindow(onProgress, ICA_WHITENED_SAMPLES_END_FRACTION, 1),
    abortSignal,
  );
  const ordered = await orderUnmixingByRecoveredSourceVarianceYielding(unmixing, whitened, abortSignal);
  return { means, componentVectors: multiplyMatrices(ordered, whitening) };
}

// CT-270: sample-major interleaved storage - the axisCount whitened values of
// sampled pixel i live contiguously at values[i * axisCount ..].
interface WhitenedSampleMatrix {
  readonly axisCount: number;
  readonly sampledCount: number;
  readonly values: Float32Array;
}

interface WhitenedCube {
  readonly whitening: number[][];
  readonly whitened: WhitenedSampleMatrix;
}

async function whitenCubeReportingProgress(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  components: number,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<WhitenedCube> {
  const whitening = await buildWhiteningMatrixReportingProgress(
    samples,
    means,
    components,
    scaleProgressToWindow(onProgress, ICA_MEANS_END_FRACTION, ICA_WHITENING_MATRIX_END_FRACTION),
    abortSignal,
  );
  const whitened = await fillWhitenedSampleMatrixReportingProgress(
    samples,
    means,
    whitening,
    scaleProgressToWindow(onProgress, ICA_WHITENING_MATRIX_END_FRACTION, ICA_WHITENED_SAMPLES_END_FRACTION),
    abortSignal,
  );
  return { whitening, whitened };
}

// The async twin of whitenCentredSamples: the same pixel-major fill in sample
// chunks (priced by the all-axes-per-pixel cost) with a progress tick and a
// paint yield per chunk.
async function fillWhitenedSampleMatrixReportingProgress(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  whitening: ReadonlyArray<ReadonlyArray<number>>,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<WhitenedSampleMatrix> {
  const sampling = describeFastIcaFitSampling(samples.sampleCount);
  const matrix = makeWhitenedSampleMatrix(whitening.length, sampling.sampledCount);
  const centredBands = new Float64Array(samples.bandCount);
  await runInChunksReportingProgress(
    sampling.sampledCount,
    samplesPerChunkForPerBandSweep((whitening.length + 1) * samples.bandCount),
    (start, end) => fillWhitenedSampleRangePixelMajor(samples, means, whitening, matrix, sampling.stride, centredBands, start, end),
    onProgress,
    abortSignal,
  );
  return matrix;
}

// ICA imposes no natural component order, but a rank-deficient cube (e.g.
// collinear bands) leaves some recovered directions in the data's null space,
// where the recovered source is ~0. Ordering the components by descending
// recovered-source variance keeps those empty directions last, so the leading
// kept components always carry real signal. This is an ordering, not a displayed
// strength metric, so the kept bands still read plain "IC N".
function orderUnmixingByRecoveredSourceVariance(
  unmixing: ReadonlyArray<ReadonlyArray<number>>,
  whitened: WhitenedSampleMatrix,
): number[][] {
  return sortUnmixingRowsByDescendingVariance(
    unmixing.map((row) => ({ row: [...row], variance: recoveredSourceVariance(row, whitened) })),
  );
}

// The async twin computes the SAME variances (same accumulation order) with
// paint yields between sample chunks, then applies the same stable sort.
async function orderUnmixingByRecoveredSourceVarianceYielding(
  unmixing: ReadonlyArray<ReadonlyArray<number>>,
  whitened: WhitenedSampleMatrix,
  abortSignal?: AbortSignal,
): Promise<number[][]> {
  const entries: VarianceTaggedRow[] = [];
  for (const row of unmixing) {
    entries.push({ row: [...row], variance: await recoveredSourceVarianceYielding(row, whitened, abortSignal) });
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
  whitened: WhitenedSampleMatrix,
): number {
  const accumulator = { sumOfSquares: 0 };
  accumulateRecoveredSourceSquares(row, whitened, 0, whitened.sampledCount, accumulator);
  return accumulator.sumOfSquares / Math.max(1, whitened.sampledCount);
}

async function recoveredSourceVarianceYielding(
  row: ReadonlyArray<number>,
  whitened: WhitenedSampleMatrix,
  abortSignal?: AbortSignal,
): Promise<number> {
  const accumulator = { sumOfSquares: 0 };
  await runOverSampleRangesYielding(
    whitened.sampledCount,
    samplesPerChunkForPerBandSweep(whitened.axisCount),
    (start, end) => accumulateRecoveredSourceSquares(row, whitened, start, end, accumulator),
    abortSignal,
  );
  return accumulator.sumOfSquares / Math.max(1, whitened.sampledCount);
}

function accumulateRecoveredSourceSquares(
  row: ReadonlyArray<number>,
  whitened: WhitenedSampleMatrix,
  startSample: number,
  endSample: number,
  accumulator: { sumOfSquares: number },
): void {
  const { values, axisCount } = whitened;
  for (let pixel = startSample; pixel < endSample; pixel += 1) {
    const recovered = dotInterleavedSampleWithVector(values, pixel * axisCount, axisCount, row);
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
  const covariance = computeBandCovarianceMatrixFromMeans(samples, means);
  return whiteningRowsFromCovariance(covariance, samples.bandCount, components);
}

async function buildWhiteningMatrixReportingProgress(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  components: number,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<number[][]> {
  const covariance = await computeBandCovarianceMatrixFromMeansReportingProgress(
    samples,
    means,
    onProgress,
    abortSignal,
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

// The whitened matrix is the fit's only cube-scale working set, so it holds
// only the capped uniform sample (stride 1 below the cap) and stores float32
// (mapped allocator) - the FastICA sweeps still accumulate in float64, and
// both the sync and async fits read the same rounded storage.
function whitenCentredSamples(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  whitening: ReadonlyArray<ReadonlyArray<number>>,
): WhitenedSampleMatrix {
  const sampling = describeFastIcaFitSampling(samples.sampleCount);
  const matrix = makeWhitenedSampleMatrix(whitening.length, sampling.sampledCount);
  const centredBands = new Float64Array(samples.bandCount);
  fillWhitenedSampleRangePixelMajor(samples, means, whitening, matrix, sampling.stride, centredBands, 0, sampling.sampledCount);
  return matrix;
}

function makeWhitenedSampleMatrix(axisCount: number, sampledCount: number): WhitenedSampleMatrix {
  return { axisCount, sampledCount, values: allocateFloat32ArrayOrThrow(axisCount * sampledCount) };
}

// Pixel-major fill: centre one pixel's bands once, then project it onto every
// whitening row. Each stored value is the exact band-order dot the per-axis
// fill produced; only the (axis, sample) visit order differs, and the outputs
// are independent, so the matrix content is bit-identical.
function fillWhitenedSampleRangePixelMajor(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  whitening: ReadonlyArray<ReadonlyArray<number>>,
  matrix: WhitenedSampleMatrix,
  stride: number,
  centredBands: Float64Array,
  startSampledIndex: number,
  endSampledIndex: number,
): void {
  for (let index = startSampledIndex; index < endSampledIndex; index += 1) {
    fillCentredBandsAtPixel(samples, means, index * stride, centredBands);
    writeWhitenedAxesForSample(whitening, centredBands, matrix, index);
  }
}

function fillCentredBandsAtPixel(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  pixel: number,
  centredBands: Float64Array,
): void {
  for (let band = 0; band < samples.bandCount; band += 1) {
    centredBands[band] = samples.bandValues[band]![pixel]! - means[band]!;
  }
}

function writeWhitenedAxesForSample(
  whitening: ReadonlyArray<ReadonlyArray<number>>,
  centredBands: Float64Array,
  matrix: WhitenedSampleMatrix,
  sampledIndex: number,
): void {
  const base = sampledIndex * matrix.axisCount;
  for (let axis = 0; axis < matrix.axisCount; axis += 1) {
    matrix.values[base + axis] = dotVectorWithCentredBands(whitening[axis]!, centredBands);
  }
}

function dotVectorWithCentredBands(
  vector: ReadonlyArray<number>,
  centredBands: Float64Array,
): number {
  let sum = 0;
  for (let band = 0; band < centredBands.length; band += 1) {
    sum += vector[band]! * centredBands[band]!;
  }
  return sum;
}

// FastICA by deflation: extract one independent component at a time, each
// decorrelated against the components already found (Gram-Schmidt), so the
// resulting unmixing rows stay orthonormal in whitened space.
function estimateUnmixingMatrix(whitened: WhitenedSampleMatrix): number[][] {
  const found: number[][] = [];
  for (let index = 0; index < whitened.axisCount; index += 1) {
    found.push(extractSingleIndependentComponent(whitened, found, index));
  }
  return found;
}

// CT-227: the async twin of estimateUnmixingMatrix. Each component owns an equal
// window of the estimation's fraction and ticks once per fixed-point iteration
// against the iteration cap (with a completion tick when it converges early), so
// the bar advances during the sample-sweeping FastICA updates.
async function estimateUnmixingMatrixReportingProgress(
  whitened: WhitenedSampleMatrix,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<number[][]> {
  const found: number[][] = [];
  for (let index = 0; index < whitened.axisCount; index += 1) {
    const componentWindow = scaleProgressToWindow(onProgress, index / whitened.axisCount, (index + 1) / whitened.axisCount);
    found.push(await extractSingleIndependentComponentReportingProgress(whitened, found, index, componentWindow, abortSignal));
  }
  return found;
}

function extractSingleIndependentComponent(
  whitened: WhitenedSampleMatrix,
  alreadyFound: ReadonlyArray<ReadonlyArray<number>>,
  index: number,
): number[] {
  let vector = decorrelateAndNormalize(makeDeterministicSeedVector(whitened.axisCount, index), alreadyFound);
  for (let iteration = 0; iteration < MAX_FAST_ICA_ITERATIONS; iteration += 1) {
    const next = decorrelateAndNormalize(fastIcaFixedPointUpdate(whitened, vector), alreadyFound);
    if (hasFastIcaConverged(next, vector)) return next;
    vector = next;
  }
  return vector;
}

async function extractSingleIndependentComponentReportingProgress(
  whitened: WhitenedSampleMatrix,
  alreadyFound: ReadonlyArray<ReadonlyArray<number>>,
  index: number,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<number[]> {
  let vector = decorrelateAndNormalize(makeDeterministicSeedVector(whitened.axisCount, index), alreadyFound);
  for (let iteration = 0; iteration < MAX_FAST_ICA_ITERATIONS; iteration += 1) {
    const next = decorrelateAndNormalize(await fastIcaFixedPointUpdateYielding(whitened, vector, abortSignal), alreadyFound);
    await reportProgressFractionAndYield(onProgress, (iteration + 1) / MAX_FAST_ICA_ITERATIONS, abortSignal);
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
function fastIcaFixedPointUpdate(whitened: WhitenedSampleMatrix, vector: ReadonlyArray<number>): number[] {
  const accumulators = makeFastIcaSweepAccumulators(whitened.axisCount);
  accumulateFastIcaSampleRange(whitened, vector, 0, whitened.sampledCount, accumulators);
  return combineFastIcaUpdate(accumulators, vector, whitened.sampledCount);
}

async function fastIcaFixedPointUpdateYielding(
  whitened: WhitenedSampleMatrix,
  vector: ReadonlyArray<number>,
  abortSignal?: AbortSignal,
): Promise<number[]> {
  const accumulators = makeFastIcaSweepAccumulators(whitened.axisCount);
  await runOverSampleRangesYielding(
    whitened.sampledCount,
    fastIcaSamplesPerChunk(whitened.axisCount),
    (start, end) => accumulateFastIcaSampleRange(whitened, vector, start, end, accumulators),
    abortSignal,
  );
  return combineFastIcaUpdate(accumulators, vector, whitened.sampledCount);
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
  whitened: WhitenedSampleMatrix,
  vector: ReadonlyArray<number>,
  startSample: number,
  endSample: number,
  accumulators: FastIcaSweepAccumulators,
): void {
  const { values, axisCount } = whitened;
  for (let pixel = startSample; pixel < endSample; pixel += 1) {
    const base = pixel * axisCount;
    const activation = Math.tanh(dotInterleavedSampleWithVector(values, base, axisCount, vector));
    addWeightedInterleavedSample(values, base, axisCount, activation, accumulators.weightedSampleSum);
    accumulators.derivativeSum += 1 - activation * activation;
  }
}

function dotInterleavedSampleWithVector(
  values: Float32Array,
  base: number,
  axisCount: number,
  vector: ReadonlyArray<number>,
): number {
  let sum = 0;
  for (let axis = 0; axis < axisCount; axis += 1) sum += values[base + axis]! * vector[axis]!;
  return sum;
}

function addWeightedInterleavedSample(
  values: Float32Array,
  base: number,
  axisCount: number,
  weight: number,
  weightedSampleSum: Float64Array,
): void {
  for (let axis = 0; axis < axisCount; axis += 1) {
    weightedSampleSum[axis] = weightedSampleSum[axis]! + values[base + axis]! * weight;
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
