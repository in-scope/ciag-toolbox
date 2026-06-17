import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";
import { projectMeanCentredSamplesOntoComponentVectors } from "@/lib/image/dimension-reduction/project-samples";
import { decomposeSymmetricMatrix } from "@/lib/image/dimension-reduction/symmetric-eigen";
import type { ComponentProjection } from "@/lib/image/dimension-reduction/transform-output";

// CT-183: Minimum Noise Fraction. fitMnf estimates the band noise covariance by
// the shift-difference method (neighbour-pixel differencing), noise-whitens the
// data, then eigendecomposes the whitened data covariance so the leading
// components are the highest signal-to-noise ones rather than the
// highest-variance ones PCA returns. applyMnf projects every mean-centred pixel
// onto the kept component vectors, exactly like PCA, so the fit-on-ROI /
// apply-to-whole split (CT-182) composes with no MNF-specific ROI code.
//
// The noise covariance is the sample covariance of the neighbour differences,
// halved (var(a - b) = 2*noiseVar for a smooth signal plus independent noise).
// Horizontal and vertical differences are each centred by their own mean before
// pooling, so a smooth signal's constant local gradient is removed and only its
// noise survives. The whitened-data eigenvalue along a direction is the
// signal-plus-noise variance in noise units, so the per-component noise fraction
// is its reciprocal.

export interface MnfFit {
  readonly means: ReadonlyArray<number>;
  readonly eigenvalues: ReadonlyArray<number>;
  readonly componentVectors: ReadonlyArray<ReadonlyArray<number>>;
}

// The noise covariance can be singular (perfectly collinear bands give identical
// per-band differences); flooring the tiny noise eigenvalues keeps the whitening
// finite instead of dividing by zero.
const NOISE_EIGENVALUE_FLOOR_FRACTION = 1e-6;

export function fitMnf(samples: CubeSampleMatrix, bandCount: number): MnfFit {
  const means = computePerBandMeans(samples.bandValues, samples.sampleCount, bandCount);
  const whitening = buildNoiseWhiteningMatrix(estimateShiftDifferenceNoiseCovariance(samples, bandCount));
  const dataCovariance = computeCovarianceFromMeans(samples.bandValues, means, samples.sampleCount, bandCount);
  const decomposition = decomposeSymmetricMatrix(whitenDataCovariance(dataCovariance, whitening));
  const componentVectors = mapWhitenedVectorsIntoDataSpace(decomposition.eigenvectors, whitening, bandCount);
  return { means, eigenvalues: decomposition.eigenvalues, componentVectors };
}

export function applyMnf(samples: CubeSampleMatrix, fit: MnfFit, keep: number): ComponentProjection {
  return projectMeanCentredSamplesOntoComponentVectors(samples, fit.means, fit.componentVectors, keep);
}

export function noiseFractionPerComponent(eigenvalues: ReadonlyArray<number>): number[] {
  return eigenvalues.map(toNoiseFraction);
}

function toNoiseFraction(eigenvalue: number): number {
  if (!(eigenvalue > 0)) return 1;
  return Math.min(1, 1 / eigenvalue);
}

function computePerBandMeans(
  bandValues: ReadonlyArray<Float64Array>,
  sampleCount: number,
  bandCount: number,
): number[] {
  return Array.from({ length: bandCount }, (_unused, band) => meanOfValues(bandValues[band]!, sampleCount));
}

function meanOfValues(values: Float64Array, sampleCount: number): number {
  let sum = 0;
  for (let i = 0; i < sampleCount; i += 1) sum += values[i]!;
  return sum / Math.max(1, sampleCount);
}

function computeCovarianceFromMeans(
  bandValues: ReadonlyArray<Float64Array>,
  means: ReadonlyArray<number>,
  sampleCount: number,
  bandCount: number,
): number[][] {
  return buildSymmetricMatrix(bandCount, (row, col) =>
    covarianceOfBands(bandValues[row]!, bandValues[col]!, means[row]!, means[col]!, sampleCount),
  );
}

function covarianceOfBands(
  rowValues: Float64Array,
  colValues: Float64Array,
  rowMean: number,
  colMean: number,
  sampleCount: number,
): number {
  let sum = 0;
  for (let i = 0; i < sampleCount; i += 1) sum += (rowValues[i]! - rowMean) * (colValues[i]! - colMean);
  return sum / Math.max(1, sampleCount);
}

function estimateShiftDifferenceNoiseCovariance(samples: CubeSampleMatrix, bandCount: number): number[][] {
  const differences = collectDirectionCentredNeighbourDifferences(samples);
  const means = computePerBandMeans(differences.bandValues, differences.sampleCount, bandCount);
  const covariance = computeCovarianceFromMeans(differences.bandValues, means, differences.sampleCount, bandCount);
  return scaleMatrix(covariance, 0.5);
}

interface DifferenceBands {
  readonly bandValues: ReadonlyArray<Float64Array>;
  readonly sampleCount: number;
}

function collectDirectionCentredNeighbourDifferences(samples: CubeSampleMatrix): DifferenceBands {
  const horizontal = listHorizontalNeighbourPairs(samples.width, samples.height);
  const vertical = listVerticalNeighbourPairs(samples.width, samples.height);
  const bandValues = samples.bandValues.map((band) =>
    concatenateCentredDifferences(differencesAcrossPairs(band, horizontal), differencesAcrossPairs(band, vertical)),
  );
  return { bandValues, sampleCount: horizontal.length + vertical.length };
}

function listHorizontalNeighbourPairs(width: number, height: number): Array<readonly [number, number]> {
  const pairs: Array<readonly [number, number]> = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x + 1 < width; x += 1) pairs.push([y * width + x, y * width + x + 1]);
  }
  return pairs;
}

function listVerticalNeighbourPairs(width: number, height: number): Array<readonly [number, number]> {
  const pairs: Array<readonly [number, number]> = [];
  for (let y = 0; y + 1 < height; y += 1) {
    for (let x = 0; x < width; x += 1) pairs.push([y * width + x, (y + 1) * width + x]);
  }
  return pairs;
}

function differencesAcrossPairs(
  band: Float64Array,
  pairs: ReadonlyArray<readonly [number, number]>,
): Float64Array {
  const differences = new Float64Array(pairs.length);
  for (let i = 0; i < pairs.length; i += 1) differences[i] = band[pairs[i]![0]]! - band[pairs[i]![1]]!;
  return differences;
}

function concatenateCentredDifferences(horizontal: Float64Array, vertical: Float64Array): Float64Array {
  const centred = new Float64Array(horizontal.length + vertical.length);
  centred.set(subtractMean(horizontal), 0);
  centred.set(subtractMean(vertical), horizontal.length);
  return centred;
}

function subtractMean(values: Float64Array): Float64Array {
  if (values.length === 0) return values;
  const mean = meanOfValues(values, values.length);
  return values.map((value) => value - mean);
}

function buildNoiseWhiteningMatrix(noiseCovariance: ReadonlyArray<ReadonlyArray<number>>): number[][] {
  const { eigenvalues, eigenvectors } = decomposeSymmetricMatrix(noiseCovariance);
  const floor = noiseEigenvalueFloor(eigenvalues);
  return eigenvectors.map((eigenvector, index) =>
    scaleVector(eigenvector, 1 / Math.sqrt(Math.max(eigenvalues[index]!, floor))),
  );
}

function noiseEigenvalueFloor(eigenvalues: ReadonlyArray<number>): number {
  const largest = eigenvalues.reduce((max, value) => Math.max(max, value), 0);
  return largest > 0 ? largest * NOISE_EIGENVALUE_FLOOR_FRACTION : 1;
}

function whitenDataCovariance(
  dataCovariance: ReadonlyArray<ReadonlyArray<number>>,
  whitening: ReadonlyArray<ReadonlyArray<number>>,
): number[][] {
  return multiplyMatrixByTranspose(multiplyMatrices(whitening, dataCovariance), whitening);
}

function multiplyMatrices(
  left: ReadonlyArray<ReadonlyArray<number>>,
  right: ReadonlyArray<ReadonlyArray<number>>,
): number[][] {
  const size = left.length;
  return buildSquareMatrix(size, (row, col) => sumRowTimesColumn(left[row]!, right, col, size));
}

function sumRowTimesColumn(
  leftRow: ReadonlyArray<number>,
  right: ReadonlyArray<ReadonlyArray<number>>,
  col: number,
  size: number,
): number {
  let sum = 0;
  for (let k = 0; k < size; k += 1) sum += leftRow[k]! * right[k]![col]!;
  return sum;
}

function multiplyMatrixByTranspose(
  left: ReadonlyArray<ReadonlyArray<number>>,
  right: ReadonlyArray<ReadonlyArray<number>>,
): number[][] {
  const size = left.length;
  return buildSquareMatrix(size, (row, col) => dotVectors(left[row]!, right[col]!, size));
}

function dotVectors(a: ReadonlyArray<number>, b: ReadonlyArray<number>, size: number): number {
  let sum = 0;
  for (let k = 0; k < size; k += 1) sum += a[k]! * b[k]!;
  return sum;
}

function mapWhitenedVectorsIntoDataSpace(
  whitenedEigenvectors: ReadonlyArray<ReadonlyArray<number>>,
  whitening: ReadonlyArray<ReadonlyArray<number>>,
  bandCount: number,
): number[][] {
  return whitenedEigenvectors.map((eigenvector) =>
    applyTransposedWhitening(eigenvector, whitening, bandCount),
  );
}

function applyTransposedWhitening(
  whitenedVector: ReadonlyArray<number>,
  whitening: ReadonlyArray<ReadonlyArray<number>>,
  bandCount: number,
): number[] {
  return Array.from({ length: bandCount }, (_unused, band) =>
    accumulateTransposedColumn(whitenedVector, whitening, band),
  );
}

function accumulateTransposedColumn(
  whitenedVector: ReadonlyArray<number>,
  whitening: ReadonlyArray<ReadonlyArray<number>>,
  band: number,
): number {
  let sum = 0;
  for (let k = 0; k < whitening.length; k += 1) sum += whitening[k]![band]! * whitenedVector[k]!;
  return sum;
}

function buildSymmetricMatrix(size: number, entry: (row: number, col: number) => number): number[][] {
  return buildSquareMatrix(size, entry);
}

function buildSquareMatrix(size: number, entry: (row: number, col: number) => number): number[][] {
  return Array.from({ length: size }, (_unused, row) =>
    Array.from({ length: size }, (_unused2, col) => entry(row, col)),
  );
}

function scaleMatrix(matrix: ReadonlyArray<ReadonlyArray<number>>, factor: number): number[][] {
  return matrix.map((row) => scaleVector(row, factor));
}

function scaleVector(vector: ReadonlyArray<number>, factor: number): number[] {
  return vector.map((value) => value * factor);
}
