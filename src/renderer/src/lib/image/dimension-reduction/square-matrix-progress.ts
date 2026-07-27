import { runInChunksReportingProgress, type UnitProgressCallback } from "@/lib/image/unit-progress";

// CT-227: the covariance matrices behind the PCA/MNF/ICA fits are band-by-band
// square matrices whose every entry is a full sweep over the sample values, so
// at reference scale each entry costs real time. Building the matrix one entry
// (band pair) per chunk with a paint yield between chunks lets the fit stretch
// of the phase bar advance continuously instead of freezing until the whole
// matrix exists.
//
// CT-240: every consumer's entry function is SYMMETRIC (a covariance), so only
// the upper triangle (row <= column) is computed and each entry is mirrored.
// The mirror is bit-identical to computing both cells - the per-sample products
// commute and the summation order per pair is unchanged - and it halves the
// dominant fit cost at 100 bands.
export async function buildSymmetricMatrixInPairChunksReportingProgress(
  size: number,
  computeEntry: (row: number, column: number) => number,
  onProgress?: UnitProgressCallback,
): Promise<number[][]> {
  const matrix: number[][] = Array.from({ length: size }, () => new Array<number>(size));
  const pairs = listUpperTrianglePairs(size);
  await runInChunksReportingProgress(
    pairs.length,
    1,
    (startPair, endPair) => fillMirroredEntriesForPairRange(matrix, pairs, startPair, endPair, computeEntry),
    onProgress,
  );
  return matrix;
}

interface BandPair {
  readonly row: number;
  readonly column: number;
}

function listUpperTrianglePairs(size: number): BandPair[] {
  const pairs: BandPair[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let column = row; column < size; column += 1) {
      pairs.push({ row, column });
    }
  }
  return pairs;
}

function fillMirroredEntriesForPairRange(
  matrix: number[][],
  pairs: ReadonlyArray<BandPair>,
  startPair: number,
  endPair: number,
  computeEntry: (row: number, column: number) => number,
): void {
  for (let pairIndex = startPair; pairIndex < endPair; pairIndex += 1) {
    const { row, column } = pairs[pairIndex]!;
    const entry = computeEntry(row, column);
    matrix[row]![column] = entry;
    matrix[column]![row] = entry;
  }
}
