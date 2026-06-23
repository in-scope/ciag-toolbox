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

// CT-195: the noise covariance is accumulated by STREAMING over neighbour pairs
// with index arithmetic - never materialising a per-pair tuple object or a
// per-direction difference array. A real ~100-megapixel cube would otherwise
// allocate ~100 million [number, number] tuples per direction (tens of GB of
// heap) and crash the renderer; the streaming accumulator holds only the
// band-count-square cross-product sums. The math is unchanged within tolerance:
// each direction's neighbour differences are centred by their own mean, the
// centred cross-sums are pooled, and the result is halved (var(a - b) =
// 2*noiseVar for a smooth signal plus independent noise).
export function estimateShiftDifferenceNoiseCovariance(samples: CubeSampleMatrix, bandCount: number): number[][] {
  const horizontal = accumulateDirectionCentredCrossSum(samples, bandCount, horizontalNeighbourDirection(samples));
  const vertical = accumulateDirectionCentredCrossSum(samples, bandCount, verticalNeighbourDirection(samples));
  const pooledPairCount = Math.max(1, horizontal.pairCount + vertical.pairCount);
  return scaleMatrix(addMatrices(horizontal.centredCrossSum, vertical.centredCrossSum), 0.5 / pooledPairCount);
}

interface NeighbourDirection {
  readonly firstColumns: number;
  readonly firstRows: number;
  readonly rowStride: number;
  readonly neighbourOffset: number;
}

function horizontalNeighbourDirection(samples: CubeSampleMatrix): NeighbourDirection {
  return { firstColumns: Math.max(0, samples.width - 1), firstRows: samples.height, rowStride: samples.width, neighbourOffset: 1 };
}

function verticalNeighbourDirection(samples: CubeSampleMatrix): NeighbourDirection {
  return { firstColumns: samples.width, firstRows: Math.max(0, samples.height - 1), rowStride: samples.width, neighbourOffset: samples.width };
}

interface DirectionCrossSum {
  readonly centredCrossSum: number[][];
  readonly pairCount: number;
}

function accumulateDirectionCentredCrossSum(
  samples: CubeSampleMatrix,
  bandCount: number,
  direction: NeighbourDirection,
): DirectionCrossSum {
  const rawCrossSums = new Float64Array(bandCount * bandCount);
  const differenceSums = new Float64Array(bandCount);
  const pairCount = streamNeighbourDifferencesIntoCrossSums(samples, bandCount, direction, rawCrossSums, differenceSums);
  return { centredCrossSum: centreCrossSums(rawCrossSums, differenceSums, pairCount, bandCount), pairCount };
}

function streamNeighbourDifferencesIntoCrossSums(
  samples: CubeSampleMatrix,
  bandCount: number,
  direction: NeighbourDirection,
  rawCrossSums: Float64Array,
  differenceSums: Float64Array,
): number {
  const differenceBuffer = new Float64Array(bandCount);
  let pairCount = 0;
  for (let row = 0; row < direction.firstRows; row += 1) {
    const rowStart = row * direction.rowStride;
    for (let column = 0; column < direction.firstColumns; column += 1) {
      addNeighbourPairToCrossSums(samples.bandValues, bandCount, rowStart + column, direction, rawCrossSums, differenceSums, differenceBuffer);
      pairCount += 1;
    }
  }
  return pairCount;
}

function addNeighbourPairToCrossSums(
  bandValues: ReadonlyArray<Float64Array>,
  bandCount: number,
  firstIndex: number,
  direction: NeighbourDirection,
  rawCrossSums: Float64Array,
  differenceSums: Float64Array,
  differenceBuffer: Float64Array,
): void {
  fillBandDifferencesAtNeighbourPair(bandValues, bandCount, firstIndex, direction.neighbourOffset, differenceBuffer);
  accumulateDifferenceSumsAndCrossProducts(differenceBuffer, bandCount, differenceSums, rawCrossSums);
}

function fillBandDifferencesAtNeighbourPair(
  bandValues: ReadonlyArray<Float64Array>,
  bandCount: number,
  firstIndex: number,
  neighbourOffset: number,
  differenceBuffer: Float64Array,
): void {
  for (let band = 0; band < bandCount; band += 1) {
    const values = bandValues[band]!;
    differenceBuffer[band] = values[firstIndex]! - values[firstIndex + neighbourOffset]!;
  }
}

function accumulateDifferenceSumsAndCrossProducts(
  differenceBuffer: Float64Array,
  bandCount: number,
  differenceSums: Float64Array,
  rawCrossSums: Float64Array,
): void {
  for (let row = 0; row < bandCount; row += 1) {
    const rowDifference = differenceBuffer[row]!;
    differenceSums[row] = differenceSums[row]! + rowDifference;
    accumulateRowCrossProducts(rowDifference, differenceBuffer, bandCount, row * bandCount, rawCrossSums);
  }
}

function accumulateRowCrossProducts(
  rowDifference: number,
  differenceBuffer: Float64Array,
  bandCount: number,
  rowOffset: number,
  rawCrossSums: Float64Array,
): void {
  for (let column = 0; column < bandCount; column += 1) {
    const index = rowOffset + column;
    rawCrossSums[index] = rawCrossSums[index]! + rowDifference * differenceBuffer[column]!;
  }
}

// Centred cross-sum for a direction = Σ d_r d_c - (Σ d_r)(Σ d_c)/N, the standard
// identity for the mean-centred sum of products, so a smooth signal's constant
// local gradient cancels and only its noise survives.
function centreCrossSums(
  rawCrossSums: Float64Array,
  differenceSums: Float64Array,
  pairCount: number,
  bandCount: number,
): number[][] {
  const inversePairCount = pairCount > 0 ? 1 / pairCount : 0;
  return buildSquareMatrix(bandCount, (row, column) =>
    rawCrossSums[row * bandCount + column]! - differenceSums[row]! * differenceSums[column]! * inversePairCount,
  );
}

function addMatrices(
  left: ReadonlyArray<ReadonlyArray<number>>,
  right: ReadonlyArray<ReadonlyArray<number>>,
): number[][] {
  return left.map((row, rowIndex) => row.map((value, columnIndex) => value + right[rowIndex]![columnIndex]!));
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
    normalizeToUnitLength(applyTransposedWhitening(eigenvector, whitening, bandCount)),
  );
}

// The noise whitening scales each direction by 1 / sqrt(noise eigenvalue), so a
// near-noise-free or rank-deficient cube gives the data-space component vector an
// enormous norm and the projected component values overflow the half-float
// display texture into white (CT-195). MNF only needs the noise-ordered
// DIRECTION (the eigenvalue-derived noise fraction carries the strength), so
// rescaling each vector to unit length keeps the components finite and
// displayable - in data units, like PCA's unit eigenvectors - with no change to
// the ordering or the noise-fraction readout.
function normalizeToUnitLength(vector: ReadonlyArray<number>): number[] {
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!(length > 0)) return vector.map(() => 0);
  return vector.map((value) => value / length);
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
