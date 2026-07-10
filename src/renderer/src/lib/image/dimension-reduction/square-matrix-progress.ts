import { runInChunksReportingProgress, type UnitProgressCallback } from "@/lib/image/unit-progress";

// CT-227: the covariance matrices behind the PCA/MNF/ICA fits are band-by-band
// square matrices whose every entry is a full sweep over the sample values, so
// at reference scale each entry costs real time. Building the matrix one entry
// (band pair) per chunk with a paint yield between chunks lets the fit stretch
// of the phase bar advance continuously instead of freezing until the whole
// matrix exists. Entries are computed in the same row-major order as the sync
// builders, so the resulting numbers are bit-identical.
export async function buildSquareMatrixInPairChunksReportingProgress(
  size: number,
  computeEntry: (row: number, column: number) => number,
  onProgress?: UnitProgressCallback,
): Promise<number[][]> {
  const matrix: number[][] = Array.from({ length: size }, () => new Array<number>(size));
  await runInChunksReportingProgress(
    size * size,
    1,
    (startPair, endPair) => fillMatrixEntriesForPairRange(matrix, size, startPair, endPair, computeEntry),
    onProgress,
  );
  return matrix;
}

function fillMatrixEntriesForPairRange(
  matrix: number[][],
  size: number,
  startPair: number,
  endPair: number,
  computeEntry: (row: number, column: number) => number,
): void {
  for (let pair = startPair; pair < endPair; pair += 1) {
    const row = Math.floor(pair / size);
    const column = pair % size;
    matrix[row]![column] = computeEntry(row, column);
  }
}
