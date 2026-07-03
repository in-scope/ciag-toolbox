import { describe, expect, it } from "vitest";

import {
  applyPercentileClip,
  assertPercentileClipBoundsAreValid,
  clampValuesToCutPoints,
  computePercentileCutPoints,
} from "./percentile-clip";

// A 16-value ramp 0..15 keeps the linear-interpolation math exact: percentile
// p sits at rank p/100 * 15, so 25/75 land at 3.75 and 11.25.
const RAMP = Array.from({ length: 16 }, (_unused, index) => index);

describe("computePercentileCutPoints", () => {
  it("interpolates linearly between order statistics (numpy default)", () => {
    const cutPoints = computePercentileCutPoints(RAMP, {
      lowerPercentile: 25,
      upperPercentile: 75,
    });
    expect(cutPoints.lowerCutPoint).toBeCloseTo(3.75, 10);
    expect(cutPoints.upperCutPoint).toBeCloseTo(11.25, 10);
  });

  it("is order-independent because it sorts internally", () => {
    const shuffled = [15, 0, 7, 3, 12, 1, 9, 5, 14, 2, 11, 4, 13, 6, 10, 8];
    expect(computePercentileCutPoints(shuffled, { lowerPercentile: 25, upperPercentile: 75 }))
      .toEqual(computePercentileCutPoints(RAMP, { lowerPercentile: 25, upperPercentile: 75 }));
  });

  it("returns the data min and max for 0 and 100", () => {
    const cutPoints = computePercentileCutPoints(RAMP, {
      lowerPercentile: 0,
      upperPercentile: 100,
    });
    expect(cutPoints).toEqual({ lowerCutPoint: 0, upperCutPoint: 15 });
  });

  it("rejects an empty value set with a user-facing error", () => {
    expect(() =>
      computePercentileCutPoints([], { lowerPercentile: 2, upperPercentile: 98 }),
    ).toThrow(/no pixel values/i);
  });
});

describe("applyPercentileClip", () => {
  it("clamps values below the lower cut point up and above the upper cut point down", () => {
    const clipped = applyPercentileClip(RAMP, { lowerPercentile: 25, upperPercentile: 75 });
    expect(clipped).toBeInstanceOf(Float32Array);
    expect(clipped).toHaveLength(RAMP.length);
    expect(clipped[0]).toBeCloseTo(3.75, 5);
    expect(clipped[3]).toBeCloseTo(3.75, 5);
    expect(clipped[4]).toBe(4);
    expect(clipped[11]).toBe(11);
    expect(clipped[12]).toBeCloseTo(11.25, 5);
    expect(clipped[15]).toBeCloseTo(11.25, 5);
  });

  it("collapses every value to the single cut point when lower equals upper", () => {
    const clipped = applyPercentileClip(RAMP, { lowerPercentile: 50, upperPercentile: 50 });
    for (const value of clipped) expect(value).toBeCloseTo(7.5, 5);
  });

  it("is a no-op at 0/100 (the cut points are the data extremes)", () => {
    const clipped = applyPercentileClip(RAMP, { lowerPercentile: 0, upperPercentile: 100 });
    expect(Array.from(clipped)).toEqual(RAMP);
  });

  it("preserves typed-array input values exactly when they lie inside the cut points", () => {
    const band = new Uint16Array([100, 200, 300, 400, 500]);
    const clipped = applyPercentileClip(band, { lowerPercentile: 0, upperPercentile: 100 });
    expect(Array.from(clipped)).toEqual([100, 200, 300, 400, 500]);
  });
});

describe("clampValuesToCutPoints", () => {
  it("applies np.clip semantics against externally computed cut points", () => {
    const clamped = clampValuesToCutPoints([1, 5, 9], { lowerCutPoint: 3, upperCutPoint: 7 });
    expect(Array.from(clamped)).toEqual([3, 5, 7]);
  });
});

describe("assertPercentileClipBoundsAreValid", () => {
  it("rejects a lower percentile above the upper with a user-facing error", () => {
    expect(() =>
      assertPercentileClipBoundsAreValid({ lowerPercentile: 60, upperPercentile: 40 }),
    ).toThrow(/upper percentile at or above the lower/i);
  });

  it("rejects percentiles outside 0..100 or non-finite values", () => {
    expect(() =>
      assertPercentileClipBoundsAreValid({ lowerPercentile: -1, upperPercentile: 98 }),
    ).toThrow(/lower percentile between 0 and 100/i);
    expect(() =>
      assertPercentileClipBoundsAreValid({ lowerPercentile: 2, upperPercentile: 101 }),
    ).toThrow(/upper percentile between 0 and 100/i);
    expect(() =>
      assertPercentileClipBoundsAreValid({ lowerPercentile: Number.NaN, upperPercentile: 98 }),
    ).toThrow(/lower percentile between 0 and 100/i);
  });

  it("accepts equal bounds and the full 0..100 range", () => {
    expect(() =>
      assertPercentileClipBoundsAreValid({ lowerPercentile: 50, upperPercentile: 50 }),
    ).not.toThrow();
    expect(() =>
      assertPercentileClipBoundsAreValid({ lowerPercentile: 0, upperPercentile: 100 }),
    ).not.toThrow();
  });
});
