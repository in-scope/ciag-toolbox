import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";
import { projectMeanCentredSamplesOntoComponentVectors } from "@/lib/image/dimension-reduction/project-samples";
import { buildSquareMatrixInPairChunksReportingProgress } from "@/lib/image/dimension-reduction/square-matrix-progress";
import { decomposeSymmetricMatrix } from "@/lib/image/dimension-reduction/symmetric-eigen";
import type { ComponentProjection } from "@/lib/image/dimension-reduction/transform-output";
import {
  computeArrayReportingPerUnitProgress,
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

export interface IcaFit {
  readonly means: ReadonlyArray<number>;
  readonly componentVectors: ReadonlyArray<ReadonlyArray<number>>;
}

const MAX_FAST_ICA_ITERATIONS = 200;
const FAST_ICA_CONVERGENCE_TOLERANCE = 1e-6;
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

// CT-227: the async twin of fitIca. The whitening covariance (per band pair)
// and the whitened-sample projections (per axis) fill the first half of the fit
// window; the FastICA estimation fills the second with one tick per fixed-point
// iteration against the iteration cap. Every step reuses the sync math.
const ICA_WHITENING_MATRIX_END_FRACTION = 0.35;
const ICA_WHITENED_SAMPLES_END_FRACTION = 0.5;

export async function fitIcaReportingProgress(
  samples: CubeSampleMatrix,
  components: number,
  onProgress?: UnitProgressCallback,
): Promise<IcaFit> {
  const means = computePerBandMeans(samples, samples.bandCount);
  const { whitening, whitened } = await whitenCubeReportingProgress(samples, means, components, onProgress);
  const unmixing = await estimateUnmixingMatrixReportingProgress(
    whitened,
    scaleProgressToWindow(onProgress, ICA_WHITENED_SAMPLES_END_FRACTION, 1),
  );
  return { means, componentVectors: multiplyMatrices(orderUnmixingByRecoveredSourceVariance(unmixing, whitened), whitening) };
}

interface WhitenedCube {
  readonly whitening: number[][];
  readonly whitened: Float64Array[];
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
    scaleProgressToWindow(onProgress, 0, ICA_WHITENING_MATRIX_END_FRACTION),
  );
  const whitened = await computeArrayReportingPerUnitProgress(
    whitening.length,
    (axis) => projectEveryCentredSampleOntoVector(samples, means, whitening[axis]!),
    scaleProgressToWindow(onProgress, ICA_WHITENING_MATRIX_END_FRACTION, ICA_WHITENED_SAMPLES_END_FRACTION),
  );
  return { whitening, whitened };
}

// ICA imposes no natural component order, but a rank-deficient cube (e.g.
// collinear bands) leaves some recovered directions in the data's null space,
// where the recovered source is ~0. Ordering the components by descending
// recovered-source variance keeps those empty directions last, so the leading
// kept components always carry real signal. This is an ordering, not a displayed
// strength metric, so the kept bands still read plain "IC N".
function orderUnmixingByRecoveredSourceVariance(
  unmixing: ReadonlyArray<ReadonlyArray<number>>,
  whitened: ReadonlyArray<Float64Array>,
): number[][] {
  return unmixing
    .map((row) => ({ row: [...row], variance: recoveredSourceVariance(row, whitened) }))
    .sort((a, b) => b.variance - a.variance)
    .map((entry) => entry.row);
}

function recoveredSourceVariance(
  row: ReadonlyArray<number>,
  whitened: ReadonlyArray<Float64Array>,
): number {
  const sampleCount = whitened[0]?.length ?? 0;
  let sumOfSquares = 0;
  for (let pixel = 0; pixel < sampleCount; pixel += 1) {
    const recovered = dotWhitenedSampleWithVector(whitened, row, pixel);
    sumOfSquares += recovered * recovered;
  }
  return sumOfSquares / Math.max(1, sampleCount);
}

export function applyIca(
  samples: CubeSampleMatrix,
  fit: IcaFit,
  keep: number = fit.componentVectors.length,
): ComponentProjection {
  return projectMeanCentredSamplesOntoComponentVectors(samples, fit.means, fit.componentVectors, keep);
}

function computePerBandMeans(samples: CubeSampleMatrix, bandCount: number): number[] {
  return Array.from({ length: bandCount }, (_unused, band) =>
    meanOfBand(samples.bandValues[band]!, samples.sampleCount),
  );
}

function meanOfBand(values: Float64Array, sampleCount: number): number {
  let sum = 0;
  for (let pixel = 0; pixel < sampleCount; pixel += 1) sum += values[pixel]!;
  return sum / Math.max(1, sampleCount);
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
  const covariance = await buildSquareMatrixInPairChunksReportingProgress(
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
  const rowValues = samples.bandValues[rowBand]!;
  const columnValues = samples.bandValues[columnBand]!;
  let sum = 0;
  for (let pixel = 0; pixel < samples.sampleCount; pixel += 1) {
    sum += (rowValues[pixel]! - means[rowBand]!) * (columnValues[pixel]! - means[columnBand]!);
  }
  return sum / Math.max(1, samples.sampleCount);
}

function whitenCentredSamples(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  whitening: ReadonlyArray<ReadonlyArray<number>>,
): Float64Array[] {
  return whitening.map((row) => projectEveryCentredSampleOntoVector(samples, means, row));
}

function projectEveryCentredSampleOntoVector(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  vector: ReadonlyArray<number>,
): Float64Array {
  const projected = new Float64Array(samples.sampleCount);
  for (let pixel = 0; pixel < samples.sampleCount; pixel += 1) {
    projected[pixel] = dotCentredSampleWithVector(samples, means, vector, pixel);
  }
  return projected;
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
function estimateUnmixingMatrix(whitened: ReadonlyArray<Float64Array>): number[][] {
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
  whitened: ReadonlyArray<Float64Array>,
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
  whitened: ReadonlyArray<Float64Array>,
  alreadyFound: ReadonlyArray<ReadonlyArray<number>>,
  index: number,
): number[] {
  let vector = decorrelateAndNormalize(makeDeterministicSeedVector(whitened.length, index), alreadyFound);
  for (let iteration = 0; iteration < MAX_FAST_ICA_ITERATIONS; iteration += 1) {
    const next = runSingleFastIcaIterationStep(whitened, alreadyFound, vector);
    if (hasFastIcaConverged(next, vector)) return next;
    vector = next;
  }
  return vector;
}

async function extractSingleIndependentComponentReportingProgress(
  whitened: ReadonlyArray<Float64Array>,
  alreadyFound: ReadonlyArray<ReadonlyArray<number>>,
  index: number,
  onProgress?: UnitProgressCallback,
): Promise<number[]> {
  let vector = decorrelateAndNormalize(makeDeterministicSeedVector(whitened.length, index), alreadyFound);
  for (let iteration = 0; iteration < MAX_FAST_ICA_ITERATIONS; iteration += 1) {
    const next = runSingleFastIcaIterationStep(whitened, alreadyFound, vector);
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

function runSingleFastIcaIterationStep(
  whitened: ReadonlyArray<Float64Array>,
  alreadyFound: ReadonlyArray<ReadonlyArray<number>>,
  vector: ReadonlyArray<number>,
): number[] {
  return decorrelateAndNormalize(fastIcaFixedPointUpdate(whitened, vector), alreadyFound);
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
// maximally non-Gaussian (independent) projection direction.
function fastIcaFixedPointUpdate(whitened: ReadonlyArray<Float64Array>, vector: ReadonlyArray<number>): number[] {
  const sampleCount = whitened[0]?.length ?? 0;
  const weightedSampleSum = new Array<number>(whitened.length).fill(0);
  let derivativeSum = 0;
  for (let pixel = 0; pixel < sampleCount; pixel += 1) {
    const activation = Math.tanh(dotWhitenedSampleWithVector(whitened, vector, pixel));
    accumulateWeightedSample(weightedSampleSum, whitened, pixel, activation);
    derivativeSum += 1 - activation * activation;
  }
  return combineFastIcaUpdate(weightedSampleSum, derivativeSum / Math.max(1, sampleCount), vector, sampleCount);
}

function dotWhitenedSampleWithVector(
  whitened: ReadonlyArray<Float64Array>,
  vector: ReadonlyArray<number>,
  pixel: number,
): number {
  let sum = 0;
  for (let axis = 0; axis < whitened.length; axis += 1) sum += whitened[axis]![pixel]! * vector[axis]!;
  return sum;
}

function accumulateWeightedSample(
  weightedSampleSum: number[],
  whitened: ReadonlyArray<Float64Array>,
  pixel: number,
  weight: number,
): void {
  for (let axis = 0; axis < whitened.length; axis += 1) {
    weightedSampleSum[axis] = weightedSampleSum[axis]! + whitened[axis]![pixel]! * weight;
  }
}

function combineFastIcaUpdate(
  weightedSampleSum: ReadonlyArray<number>,
  meanDerivative: number,
  vector: ReadonlyArray<number>,
  sampleCount: number,
): number[] {
  return weightedSampleSum.map(
    (sum, axis) => sum / Math.max(1, sampleCount) - meanDerivative * vector[axis]!,
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
