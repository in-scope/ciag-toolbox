import { describe, expect, it } from "vitest";

import type { RasterTypedArray } from "@/lib/image/raster-image";

import { kthSmallestValueAcrossSortedBands } from "./sorted-band-order-statistics";

// Reference oracle: the k-th smallest of the union IS sorted-concatenation[k]
// (the exact read the old concatenate-and-sort percentile path performed).
function sortedConcatenation(bands: ReadonlyArray<RasterTypedArray>): Float64Array {
  const total = bands.reduce((sum, band) => sum + band.length, 0);
  const joined = new Float64Array(total);
  let offset = 0;
  for (const band of bands) {
    joined.set(band, offset);
    offset += band.length;
  }
  return joined.sort();
}

// Deterministic pseudo-random values (no Math.random in fixtures).
function nextSeed(seed: number): number {
  return (seed * 1103515245 + 12345) % 2147483648;
}

function pseudoRandomFloat32Band(length: number, seed: number): Float32Array {
  const band = new Float32Array(length);
  let state = seed;
  for (let index = 0; index < length; index += 1) {
    state = nextSeed(state);
    band[index] = (state / 2147483648) * 2000 - 1000;
  }
  return band.sort();
}

function expectEveryRankToMatchTheSortedConcatenation(
  bands: ReadonlyArray<RasterTypedArray>,
  ranks: ReadonlyArray<number>,
): void {
  const reference = sortedConcatenation(bands);
  for (const k of ranks) {
    expect(kthSmallestValueAcrossSortedBands(bands, k)).toBe(reference[k]);
  }
}

describe("kthSmallestValueAcrossSortedBands", () => {
  it("matches the sorted concatenation on small sorted bands with duplicates and negatives", () => {
    const bands = [
      new Float32Array([-5, -1, 0, 2, 2, 7]),
      new Float32Array([-2, 2, 3, 3]),
      new Float32Array([1]),
    ];
    expectEveryRankToMatchTheSortedConcatenation(bands, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("matches the sorted concatenation across pseudo-random float bands of skewed sizes", () => {
    const bands = [
      pseudoRandomFloat32Band(1200, 7),
      pseudoRandomFloat32Band(40, 19),
      pseudoRandomFloat32Band(333, 101),
    ];
    const total = 1200 + 40 + 333;
    expectEveryRankToMatchTheSortedConcatenation(bands, [0, 1, 500, 786, 787, 1200, total - 2, total - 1]);
  });

  it("matches the sorted concatenation past the gather threshold (pivot-narrowing loop)", () => {
    const bands = Array.from({ length: 5 }, (_unused, bandIndex) =>
      pseudoRandomFloat32Band(2000, 31 + bandIndex),
    );
    expectEveryRankToMatchTheSortedConcatenation(bands, [0, 1, 4999, 5000, 5001, 9998, 9999]);
  });

  it("handles large-range integer bands exactly", () => {
    const bands = [
      Int32Array.from([-2_000_000_000, -7, 0, 2_000_000_000]),
      Uint32Array.from([3, 4_000_000_000]),
    ];
    expectEveryRankToMatchTheSortedConcatenation(bands, [0, 1, 2, 3, 4, 5]);
  });

  it("works with a single band and with empty bands mixed in", () => {
    const single = [new Float64Array([1.5, 2.5, 9])];
    expectEveryRankToMatchTheSortedConcatenation(single, [0, 1, 2]);
    const withEmpty = [new Float32Array(0), new Float32Array([4, 8]), new Float32Array(0)];
    expectEveryRankToMatchTheSortedConcatenation(withEmpty, [0, 1]);
  });

  it("ignores NaN tails below their ranks and returns NaN once a rank lands in them", () => {
    const bands = [
      new Float32Array([1, 3, Number.NaN]).sort(),
      new Float32Array([2, Number.NaN, Number.NaN]).sort(),
    ];
    expect(kthSmallestValueAcrossSortedBands(bands, 0)).toBe(1);
    expect(kthSmallestValueAcrossSortedBands(bands, 1)).toBe(2);
    expect(kthSmallestValueAcrossSortedBands(bands, 2)).toBe(3);
    expect(kthSmallestValueAcrossSortedBands(bands, 3)).toBeNaN();
    expect(kthSmallestValueAcrossSortedBands(bands, 5)).toBeNaN();
  });

  it("handles ties spanning several bands around the pivot", () => {
    const bands = [
      Uint16Array.from({ length: 3000 }, () => 5),
      Uint16Array.from({ length: 3000 }, (_unused, index) => (index < 1500 ? 4 : 5)),
      Uint16Array.from({ length: 3000 }, (_unused, index) => (index < 10 ? 5 : 6)),
    ];
    expectEveryRankToMatchTheSortedConcatenation(bands, [0, 1499, 1500, 4509, 4510, 8999]);
  });
});
