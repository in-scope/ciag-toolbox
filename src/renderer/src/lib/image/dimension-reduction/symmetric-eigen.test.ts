import { describe, expect, it } from "vitest";

import { decomposeSymmetricMatrix } from "./symmetric-eigen";

// [[2,0,0],[0,3,4],[0,4,9]] has a known spectrum: the 2x2 lower block
// [[3,4],[4,9]] gives 6 +/- 5 = {11, 1}, leaving eigenvalues {11, 2, 1}.
const KNOWN_SYMMETRIC_MATRIX = [
  [2, 0, 0],
  [0, 3, 4],
  [0, 4, 9],
];

const TOLERANCE = 1e-9;

describe("decomposeSymmetricMatrix", () => {
  it("returns eigenvalues sorted descending for a known 3x3 matrix", () => {
    const { eigenvalues } = decomposeSymmetricMatrix(KNOWN_SYMMETRIC_MATRIX);
    expect(eigenvalues[0]!).toBeCloseTo(11, 9);
    expect(eigenvalues[1]!).toBeCloseTo(2, 9);
    expect(eigenvalues[2]!).toBeCloseTo(1, 9);
  });

  it("returns orthonormal eigenvectors", () => {
    const { eigenvectors } = decomposeSymmetricMatrix(KNOWN_SYMMETRIC_MATRIX);
    for (const vector of eigenvectors) expect(vectorNorm(vector)).toBeCloseTo(1, 9);
    expect(absoluteDotProduct(eigenvectors[0]!, eigenvectors[1]!)).toBeLessThan(TOLERANCE);
    expect(absoluteDotProduct(eigenvectors[0]!, eigenvectors[2]!)).toBeLessThan(TOLERANCE);
    expect(absoluteDotProduct(eigenvectors[1]!, eigenvectors[2]!)).toBeLessThan(TOLERANCE);
  });

  it("satisfies A·v = λ·v for every returned eigenpair", () => {
    const { eigenvalues, eigenvectors } = decomposeSymmetricMatrix(KNOWN_SYMMETRIC_MATRIX);
    eigenvectors.forEach((vector, index) => {
      const transformed = multiplyMatrixByVector(KNOWN_SYMMETRIC_MATRIX, vector);
      const scaled = vector.map((component) => component * eigenvalues[index]!);
      transformed.forEach((value, axis) => expect(value).toBeCloseTo(scaled[axis]!, 9));
    });
  });

  it("diagonalizes an already-diagonal matrix without spurious rotations", () => {
    const { eigenvalues } = decomposeSymmetricMatrix([
      [5, 0],
      [0, 7],
    ]);
    expect([...eigenvalues]).toEqual([7, 5]);
  });
});

function vectorNorm(vector: ReadonlyArray<number>): number {
  return Math.sqrt(absoluteDotProduct(vector, vector));
}

function absoluteDotProduct(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  return Math.abs(a.reduce((sum, value, index) => sum + value * b[index]!, 0));
}

function multiplyMatrixByVector(
  matrix: ReadonlyArray<ReadonlyArray<number>>,
  vector: ReadonlyArray<number>,
): number[] {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index]!, 0));
}
