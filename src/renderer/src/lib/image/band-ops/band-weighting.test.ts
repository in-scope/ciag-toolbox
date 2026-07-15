import { describe, expect, it } from "vitest";

import { computeWeightedSum, computeWeightedSumReportingProgress } from "./band-weighting";

describe("computeWeightedSum", () => {
  it("normalizes by the sum of absolute weights, so equal weights give the band mean", () => {
    const bands = [Float32Array.from([0, 100]), Float32Array.from([0, 100])];
    const result = computeWeightedSum(bands, [1, 1]);
    expect(Array.from(result)).toEqual([0, 100]);
  });

  it("returns an all-zero band for all-zero weights (defined degenerate case)", () => {
    const bands = [Float32Array.from([10, 20]), Float32Array.from([30, 40])];
    const result = computeWeightedSum(bands, [0, 0]);
    expect(Array.from(result)).toEqual([0, 0]);
  });

  it("computes a known hand-weighted case, dividing by the sum of absolute weights", () => {
    const bands = [Float32Array.from([10, 20]), Float32Array.from([30, 40])];
    const result = computeWeightedSum(bands, [2, -1]);
    // normalizer = |2| + |-1| = 3. pixel0 = (2*10 - 30)/3; pixel1 = (2*20 - 40)/3.
    expect(result[0]).toBeCloseTo(-10 / 3, 6);
    expect(result[1]).toBeCloseTo(0, 6);
  });

  it("selects a single band exactly when only that band carries a weight", () => {
    const bands = [Uint16Array.from([100, 110]), Uint16Array.from([800, 820])];
    const result = computeWeightedSum(bands, [1, 0]);
    expect(Array.from(result)).toEqual([100, 110]);
  });

  it("produces a float32 band", () => {
    const result = computeWeightedSum([Float32Array.from([1])], [1]);
    expect(result).toBeInstanceOf(Float32Array);
  });

  it("throws a clear error when the weight count does not match the band count", () => {
    const bands = [Float32Array.from([1]), Float32Array.from([2])];
    expect(() => computeWeightedSum(bands, [1])).toThrow(/one weight per band/);
  });
});

// CT-240: the async twin chunks the same per-pixel sweep with paint yields and
// determinate progress; the output must be byte-identical to the sync path.
describe("computeWeightedSumReportingProgress", () => {
  it("matches the sync computeWeightedSum exactly across chunk boundaries", async () => {
    const pixelCount = 1000;
    const bands = [
      Uint16Array.from({ length: pixelCount }, (_unused, index) => 600 + (index % 100)),
      Uint16Array.from({ length: pixelCount }, (_unused, index) => 1200 + (index % 37)),
    ];
    const weights = [1, 1];
    expect(await computeWeightedSumReportingProgress(bands, weights)).toEqual(
      computeWeightedSum(bands, weights),
    );
  });

  it("reports monotonic progress ending at exactly 1", async () => {
    const ticks: number[] = [];
    const bands = [Uint16Array.from({ length: 10 }, (_unused, index) => index)];
    await computeWeightedSumReportingProgress(bands, [1], (fraction) => ticks.push(fraction));
    expect(ticks[ticks.length - 1]).toBe(1);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!).toBeGreaterThanOrEqual(ticks[i - 1]!);
    }
  });
});
