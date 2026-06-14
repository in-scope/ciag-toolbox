import { describe, expect, it } from "vitest";

import {
  computePercentileValueRange,
  computePercentileValueRangeOfOwnedArray,
  DEFAULT_PERCENTILE_BOUNDS,
} from "./percentile-value-range";

describe("computePercentileValueRange", () => {
  it("returns the low and high order statistics of an evenly spread band", () => {
    const values = Array.from({ length: 101 }, (_unused, index) => index);
    const range = computePercentileValueRange(values, { lowPercentile: 2, highPercentile: 98 });
    expect(range.min).toBeCloseTo(2);
    expect(range.max).toBeCloseTo(98);
  });

  it("interpolates linearly between the two closest ranks", () => {
    const range = computePercentileValueRange([0, 10, 20, 30], { lowPercentile: 50, highPercentile: 50 });
    expect(range.min).toBeCloseTo(15);
    expect(range.max).toBeCloseTo(15);
  });

  it("excludes a sparse near-max outlier from the high percentile (the CT-107 fixture)", () => {
    const bulk = Array.from({ length: 99 }, (_unused, index) => index);
    const range = computePercentileValueRange([...bulk, 1000], DEFAULT_PERCENTILE_BOUNDS);
    expect(range.max).toBeLessThan(100);
    expect(range.max).toBeCloseTo(97.02);
    expect(range.min).toBeCloseTo(1.98);
  });

  it("clamps out-of-range percentiles to the data endpoints", () => {
    const range = computePercentileValueRange([5, 6, 7, 8], { lowPercentile: -10, highPercentile: 250 });
    expect(range.min).toBe(5);
    expect(range.max).toBe(8);
  });

  it("returns zeros for an empty input without producing NaN", () => {
    const range = computePercentileValueRange([], DEFAULT_PERCENTILE_BOUNDS);
    expect(range.min).toBe(0);
    expect(range.max).toBe(0);
  });

  it("collapses a single-value input to that value", () => {
    const range = computePercentileValueRange([42], DEFAULT_PERCENTILE_BOUNDS);
    expect(range.min).toBe(42);
    expect(range.max).toBe(42);
  });
});

describe("computePercentileValueRangeOfOwnedArray", () => {
  it("sorts the caller-owned array in place and reads the same percentiles", () => {
    const owned = Float64Array.from([30, 0, 10, 20]);
    const range = computePercentileValueRangeOfOwnedArray(owned, { lowPercentile: 50, highPercentile: 50 });
    expect(range.min).toBeCloseTo(15);
    expect(Array.from(owned)).toEqual([0, 10, 20, 30]);
  });
});
