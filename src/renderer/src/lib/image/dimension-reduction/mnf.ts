import {
  computePerBandMeans,
  computePerBandMeansReportingProgress,
  covarianceBetweenCentredBands,
} from "@/lib/image/dimension-reduction/band-statistics";
import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";
import { projectMeanCentredSamplesOntoComponentVectors } from "@/lib/image/dimension-reduction/project-samples";
import { buildSymmetricMatrixInPairChunksReportingProgress } from "@/lib/image/dimension-reduction/square-matrix-progress";
import { decomposeSymmetricMatrix } from "@/lib/image/dimension-reduction/symmetric-eigen";
import type { ComponentProjection } from "@/lib/image/dimension-reduction/transform-output";
import type { RasterTypedArray } from "@/lib/image/raster-image";
import {
  runInChunksReportingProgress,
  scaleProgressToWindow,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

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
//
// CT-240: every statistic streams from the sample matrix's band arrays (which
// alias the live raster - no float64 cube copy), and the band-pair loops
// accumulate only the upper triangle, mirrored at read time. The mirror is
// bit-identical to the full square (per-pair products commute and the
// accumulation order per cell is unchanged) and halves the dominant cost.

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
  const means = computePerBandMeans(samples, bandCount);
  const whitening = buildNoiseWhiteningMatrix(estimateShiftDifferenceNoiseCovariance(samples, bandCount));
  const dataCovariance = computeCovarianceFromMeans(samples, means, bandCount);
  return decomposeWhitenedCovarianceIntoMnfFit(means, dataCovariance, whitening, bandCount);
}

// CT-227: the async twin of fitMnf. The means sweep ticks per band, the
// noise-covariance pass (streaming over every neighbour pair) fills the first
// half of the fit window and the data covariance pass (one sweep per band pair)
// fills the second, each chunked with paint yields; the per-pair math is
// identical to the sync fit.
const MNF_MEANS_END_FRACTION = 0.04;
const MNF_NOISE_COVARIANCE_PASS_END_FRACTION = 0.5;

export async function fitMnfReportingProgress(
  samples: CubeSampleMatrix,
  bandCount: number,
  onProgress?: UnitProgressCallback,
): Promise<MnfFit> {
  const means = await computePerBandMeansReportingProgress(
    samples,
    bandCount,
    scaleProgressToWindow(onProgress, 0, MNF_MEANS_END_FRACTION),
  );
  const noiseCovariance = await estimateShiftDifferenceNoiseCovarianceReportingProgress(
    samples,
    bandCount,
    scaleProgressToWindow(onProgress, MNF_MEANS_END_FRACTION, MNF_NOISE_COVARIANCE_PASS_END_FRACTION),
  );
  const dataCovariance = await computeDataCovarianceInPairChunks(
    samples,
    means,
    bandCount,
    scaleProgressToWindow(onProgress, MNF_NOISE_COVARIANCE_PASS_END_FRACTION, 1),
  );
  return decomposeWhitenedCovarianceIntoMnfFit(means, dataCovariance, buildNoiseWhiteningMatrix(noiseCovariance), bandCount);
}

function computeDataCovarianceInPairChunks(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  bandCount: number,
  onProgress?: UnitProgressCallback,
): Promise<number[][]> {
  return buildSymmetricMatrixInPairChunksReportingProgress(
    bandCount,
    (row, col) => covarianceOfBandPair(samples, means, row, col),
    onProgress,
  );
}

function decomposeWhitenedCovarianceIntoMnfFit(
  means: ReadonlyArray<number>,
  dataCovariance: ReadonlyArray<ReadonlyArray<number>>,
  whitening: ReadonlyArray<ReadonlyArray<number>>,
  bandCount: number,
): MnfFit {
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

function computeCovarianceFromMeans(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  bandCount: number,
): number[][] {
  return buildSquareMatrix(bandCount, (row, col) => covarianceOfBandPair(samples, means, row, col));
}

function covarianceOfBandPair(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  row: number,
  col: number,
): number {
  return covarianceBetweenCentredBands(
    samples.bandValues[row]!,
    samples.bandValues[col]!,
    means[row]!,
    means[col]!,
    samples.sampleCount,
  );
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
  return poolDirectionsIntoNoiseCovariance(horizontal, vertical);
}

// CT-227: the async twin of estimateShiftDifferenceNoiseCovariance. The
// horizontal pass fills the first half of its window and the vertical pass the
// second; each pass streams the SAME row-range accumulator as the sync path in
// row chunks with a paint yield between chunks, so the accumulation order (and
// therefore every float) is unchanged.
export async function estimateShiftDifferenceNoiseCovarianceReportingProgress(
  samples: CubeSampleMatrix,
  bandCount: number,
  onProgress?: UnitProgressCallback,
): Promise<number[][]> {
  const horizontal = await accumulateDirectionCentredCrossSumInRowChunks(
    samples,
    bandCount,
    horizontalNeighbourDirection(samples),
    scaleProgressToWindow(onProgress, 0, 0.5),
  );
  const vertical = await accumulateDirectionCentredCrossSumInRowChunks(
    samples,
    bandCount,
    verticalNeighbourDirection(samples),
    scaleProgressToWindow(onProgress, 0.5, 1),
  );
  return poolDirectionsIntoNoiseCovariance(horizontal, vertical);
}

function poolDirectionsIntoNoiseCovariance(
  horizontal: DirectionCrossSum,
  vertical: DirectionCrossSum,
): number[][] {
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
  const accumulators = makeDirectionAccumulators(bandCount);
  const pairCount = streamRowRangeOfNeighbourDifferences(samples, bandCount, direction, 0, direction.firstRows, accumulators);
  return { centredCrossSum: centreCrossSums(accumulators.rawCrossSums, accumulators.differenceSums, pairCount, bandCount), pairCount };
}

// CT-240: the per-pair cost scales with bandCount squared (the cross-product
// triangle), so the chunk size is derived from an op budget instead of a fixed
// pixel count - a fixed 2M-pixel chunk that took tens of milliseconds at 5
// bands would block for ~15 seconds at 100 bands and blow the UI-gap budget.
const NOISE_ESTIMATE_OPS_PER_CHUNK = 250_000_000;

function noiseEstimatePixelsPerChunk(bandCount: number): number {
  const opsPerPixel = bandCount * bandCount;
  return Math.max(1, Math.floor(NOISE_ESTIMATE_OPS_PER_CHUNK / Math.max(1, opsPerPixel)));
}

async function accumulateDirectionCentredCrossSumInRowChunks(
  samples: CubeSampleMatrix,
  bandCount: number,
  direction: NeighbourDirection,
  onProgress?: UnitProgressCallback,
): Promise<DirectionCrossSum> {
  const accumulators = makeDirectionAccumulators(bandCount);
  let pairCount = 0;
  await runInChunksReportingProgress(
    direction.firstRows,
    Math.max(1, Math.floor(noiseEstimatePixelsPerChunk(bandCount) / Math.max(1, direction.firstColumns))),
    (startRow, endRow) => {
      pairCount += streamRowRangeOfNeighbourDifferences(samples, bandCount, direction, startRow, endRow, accumulators);
    },
    onProgress,
  );
  return { centredCrossSum: centreCrossSums(accumulators.rawCrossSums, accumulators.differenceSums, pairCount, bandCount), pairCount };
}

interface DirectionAccumulators {
  readonly rawCrossSums: Float64Array;
  readonly differenceSums: Float64Array;
  readonly differenceBuffer: Float64Array;
}

function makeDirectionAccumulators(bandCount: number): DirectionAccumulators {
  return {
    rawCrossSums: new Float64Array(bandCount * bandCount),
    differenceSums: new Float64Array(bandCount),
    differenceBuffer: new Float64Array(bandCount),
  };
}

function streamRowRangeOfNeighbourDifferences(
  samples: CubeSampleMatrix,
  bandCount: number,
  direction: NeighbourDirection,
  startRow: number,
  endRow: number,
  accumulators: DirectionAccumulators,
): number {
  let pairCount = 0;
  for (let row = startRow; row < endRow; row += 1) {
    const rowStart = row * direction.rowStride;
    for (let column = 0; column < direction.firstColumns; column += 1) {
      addNeighbourPairToCrossSums(samples.bandValues, bandCount, rowStart + column, direction, accumulators.rawCrossSums, accumulators.differenceSums, accumulators.differenceBuffer);
      pairCount += 1;
    }
  }
  return pairCount;
}

function addNeighbourPairToCrossSums(
  bandValues: ReadonlyArray<RasterTypedArray>,
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
  bandValues: ReadonlyArray<RasterTypedArray>,
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

// CT-240: only the upper triangle (column >= row) is accumulated; the mirror
// happens once at centreCrossSums time. Cell (r, c) receives the exact products
// cell (c, r) would have received in the same order, so the halved sweep is
// bit-identical to the full one.
function accumulateDifferenceSumsAndCrossProducts(
  differenceBuffer: Float64Array,
  bandCount: number,
  differenceSums: Float64Array,
  rawCrossSums: Float64Array,
): void {
  for (let row = 0; row < bandCount; row += 1) {
    const rowDifference = differenceBuffer[row]!;
    differenceSums[row] = differenceSums[row]! + rowDifference;
    accumulateUpperTriangleRowCrossProducts(rowDifference, differenceBuffer, bandCount, row, rawCrossSums);
  }
}

function accumulateUpperTriangleRowCrossProducts(
  rowDifference: number,
  differenceBuffer: Float64Array,
  bandCount: number,
  row: number,
  rawCrossSums: Float64Array,
): void {
  const rowOffset = row * bandCount;
  for (let column = row; column < bandCount; column += 1) {
    const index = rowOffset + column;
    rawCrossSums[index] = rawCrossSums[index]! + rowDifference * differenceBuffer[column]!;
  }
}

// Centred cross-sum for a direction = Σ d_r d_c - (Σ d_r)(Σ d_c)/N, the standard
// identity for the mean-centred sum of products, so a smooth signal's constant
// local gradient cancels and only its noise survives. The raw cross-sums hold
// only the upper triangle; reading through the (min, max) index mirrors them.
function centreCrossSums(
  rawCrossSums: Float64Array,
  differenceSums: Float64Array,
  pairCount: number,
  bandCount: number,
): number[][] {
  const inversePairCount = pairCount > 0 ? 1 / pairCount : 0;
  return buildSquareMatrix(bandCount, (row, column) =>
    readUpperTriangleCrossSum(rawCrossSums, bandCount, row, column) -
    differenceSums[row]! * differenceSums[column]! * inversePairCount,
  );
}

function readUpperTriangleCrossSum(
  rawCrossSums: Float64Array,
  bandCount: number,
  row: number,
  column: number,
): number {
  const low = Math.min(row, column);
  const high = Math.max(row, column);
  return rawCrossSums[low * bandCount + high]!;
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
