// CT-180: a pure, dependency-free eigensolver for the small symmetric matrices
// (band-count square, e.g. covariance / noise-whitened covariance) that every
// dimension-reduction transform decomposes. We use the cyclic Jacobi rotation
// method rather than pulling in ml-matrix: the matrices are tiny (band count,
// typically < 100), Jacobi is numerically robust for symmetric inputs, and a
// self-contained implementation stays deterministic and fully unit-testable
// with no supply-chain surface. Matrices are held flat (row-major Float64Array)
// so indexing is total. Eigenpairs are returned sorted descending so PCA/MNF
// can keep the leading components directly.

export interface SymmetricEigenDecomposition {
  readonly eigenvalues: ReadonlyArray<number>;
  readonly eigenvectors: ReadonlyArray<ReadonlyArray<number>>;
}

interface FlatSquareMatrix {
  readonly size: number;
  readonly data: Float64Array;
}

const MAX_JACOBI_SWEEPS = 100;
const JACOBI_CONVERGENCE_EPSILON = 1e-14;

export function decomposeSymmetricMatrix(
  matrix: ReadonlyArray<ReadonlyArray<number>>,
): SymmetricEigenDecomposition {
  const working = copyToFlatSquareMatrix(matrix);
  const eigenvectors = buildFlatIdentityMatrix(working.size);
  diagonalizeWithJacobiRotations(working, eigenvectors);
  return sortEigenpairsByEigenvalueDescending(readDiagonal(working), eigenvectors);
}

function diagonalizeWithJacobiRotations(matrix: FlatSquareMatrix, vectors: FlatSquareMatrix): void {
  for (let sweep = 0; sweep < MAX_JACOBI_SWEEPS; sweep += 1) {
    if (offDiagonalFrobeniusNorm(matrix) < JACOBI_CONVERGENCE_EPSILON) return;
    runSingleJacobiSweep(matrix, vectors);
  }
}

function runSingleJacobiSweep(matrix: FlatSquareMatrix, vectors: FlatSquareMatrix): void {
  for (let p = 0; p < matrix.size - 1; p += 1) {
    for (let q = p + 1; q < matrix.size; q += 1) {
      if (readEntry(matrix, p, q) !== 0) rotateToZeroOffDiagonalEntry(matrix, vectors, p, q);
    }
  }
}

function rotateToZeroOffDiagonalEntry(
  matrix: FlatSquareMatrix,
  vectors: FlatSquareMatrix,
  p: number,
  q: number,
): void {
  const rotation = computeJacobiRotation(
    readEntry(matrix, p, p),
    readEntry(matrix, q, q),
    readEntry(matrix, p, q),
  );
  applyRotationToSymmetricMatrix(matrix, p, q, rotation);
  applyRotationToEigenvectorColumns(vectors, p, q, rotation);
}

interface JacobiRotation {
  readonly cosine: number;
  readonly sine: number;
}

function computeJacobiRotation(app: number, aqq: number, apq: number): JacobiRotation {
  const tangent = computeRotationTangent(app, aqq, apq);
  const cosine = 1 / Math.sqrt(tangent * tangent + 1);
  return { cosine, sine: tangent * cosine };
}

function computeRotationTangent(app: number, aqq: number, apq: number): number {
  const theta = (aqq - app) / (2 * apq);
  const magnitude = 1 / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
  return theta < 0 ? -magnitude : magnitude;
}

function applyRotationToSymmetricMatrix(
  matrix: FlatSquareMatrix,
  p: number,
  q: number,
  rotation: JacobiRotation,
): void {
  updateRotatedDiagonalPair(matrix, p, q, rotation);
  for (let i = 0; i < matrix.size; i += 1) {
    if (i !== p && i !== q) rotateOffDiagonalEntryPair(matrix, i, p, q, rotation);
  }
  writeSymmetricEntry(matrix, p, q, 0);
}

function updateRotatedDiagonalPair(
  matrix: FlatSquareMatrix,
  p: number,
  q: number,
  { cosine, sine }: JacobiRotation,
): void {
  const app = readEntry(matrix, p, p);
  const aqq = readEntry(matrix, q, q);
  const apq = readEntry(matrix, p, q);
  writeEntry(matrix, p, p, cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq);
  writeEntry(matrix, q, q, sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq);
}

function rotateOffDiagonalEntryPair(
  matrix: FlatSquareMatrix,
  i: number,
  p: number,
  q: number,
  { cosine, sine }: JacobiRotation,
): void {
  const aip = readEntry(matrix, i, p);
  const aiq = readEntry(matrix, i, q);
  writeSymmetricEntry(matrix, i, p, cosine * aip - sine * aiq);
  writeSymmetricEntry(matrix, i, q, sine * aip + cosine * aiq);
}

function applyRotationToEigenvectorColumns(
  vectors: FlatSquareMatrix,
  p: number,
  q: number,
  { cosine, sine }: JacobiRotation,
): void {
  for (let i = 0; i < vectors.size; i += 1) {
    const vip = readEntry(vectors, i, p);
    const viq = readEntry(vectors, i, q);
    writeEntry(vectors, i, p, cosine * vip - sine * viq);
    writeEntry(vectors, i, q, sine * vip + cosine * viq);
  }
}

function offDiagonalFrobeniusNorm(matrix: FlatSquareMatrix): number {
  let sumOfSquares = 0;
  for (let p = 0; p < matrix.size - 1; p += 1) {
    for (let q = p + 1; q < matrix.size; q += 1) {
      sumOfSquares += readEntry(matrix, p, q) ** 2;
    }
  }
  return Math.sqrt(sumOfSquares);
}

function sortEigenpairsByEigenvalueDescending(
  diagonal: ReadonlyArray<number>,
  eigenvectors: FlatSquareMatrix,
): SymmetricEigenDecomposition {
  const descendingOrder = diagonal.map((_, index) => index).sort((a, b) => diagonal[b]! - diagonal[a]!);
  return {
    eigenvalues: descendingOrder.map((index) => diagonal[index]!),
    eigenvectors: descendingOrder.map((columnIndex) => extractColumn(eigenvectors, columnIndex)),
  };
}

function extractColumn(matrix: FlatSquareMatrix, columnIndex: number): number[] {
  return Array.from({ length: matrix.size }, (_, row) => readEntry(matrix, row, columnIndex));
}

function readDiagonal(matrix: FlatSquareMatrix): number[] {
  return Array.from({ length: matrix.size }, (_, index) => readEntry(matrix, index, index));
}

function copyToFlatSquareMatrix(matrix: ReadonlyArray<ReadonlyArray<number>>): FlatSquareMatrix {
  const size = matrix.length;
  const data = new Float64Array(size * size);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) data[row * size + column] = matrix[row]![column]!;
  }
  return { size, data };
}

function buildFlatIdentityMatrix(size: number): FlatSquareMatrix {
  const data = new Float64Array(size * size);
  for (let index = 0; index < size; index += 1) data[index * size + index] = 1;
  return { size, data };
}

function readEntry(matrix: FlatSquareMatrix, row: number, column: number): number {
  return matrix.data[row * matrix.size + column]!;
}

function writeEntry(matrix: FlatSquareMatrix, row: number, column: number, value: number): void {
  matrix.data[row * matrix.size + column] = value;
}

function writeSymmetricEntry(matrix: FlatSquareMatrix, row: number, column: number, value: number): void {
  writeEntry(matrix, row, column, value);
  writeEntry(matrix, column, row, value);
}
