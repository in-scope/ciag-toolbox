import { describe, expect, it } from "vitest";

import {
  buildDefaultThresholdBounds,
  fractionForThresholdBoundValue,
  moveLowerThresholdBoundTo,
  moveUpperThresholdBoundTo,
  thresholdBoundValueAtFraction,
} from "./threshold-bounds-editing";

const RANGE = { min: 100, max: 130 };

describe("buildDefaultThresholdBounds", () => {
  it("spans the full value range", () => {
    expect(buildDefaultThresholdBounds(RANGE)).toEqual({ lower: 100, upper: 130 });
  });
});

describe("moveLowerThresholdBoundTo", () => {
  it("clamps the lower bound to the range minimum", () => {
    const next = moveLowerThresholdBoundTo({ lower: 110, upper: 120 }, 50, RANGE, true);
    expect(next).toEqual({ lower: 100, upper: 120 });
  });

  it("clamps the lower bound to the upper bound so lower <= upper", () => {
    const next = moveLowerThresholdBoundTo({ lower: 110, upper: 120 }, 125, RANGE, true);
    expect(next).toEqual({ lower: 120, upper: 120 });
  });

  it("rounds for integer bands and keeps fractions for float bands", () => {
    expect(moveLowerThresholdBoundTo({ lower: 100, upper: 130 }, 110.6, RANGE, true).lower).toBe(111);
    expect(moveLowerThresholdBoundTo({ lower: 100, upper: 130 }, 110.6, RANGE, false).lower).toBe(110.6);
  });
});

describe("moveUpperThresholdBoundTo", () => {
  it("clamps the upper bound to the range maximum", () => {
    const next = moveUpperThresholdBoundTo({ lower: 110, upper: 120 }, 500, RANGE, true);
    expect(next).toEqual({ lower: 110, upper: 130 });
  });

  it("clamps the upper bound to the lower bound so lower <= upper", () => {
    const next = moveUpperThresholdBoundTo({ lower: 110, upper: 120 }, 90, RANGE, true);
    expect(next).toEqual({ lower: 110, upper: 110 });
  });
});

describe("threshold bound fraction mapping", () => {
  it("maps fractions into the value range and back", () => {
    expect(thresholdBoundValueAtFraction(RANGE, 0)).toBe(100);
    expect(thresholdBoundValueAtFraction(RANGE, 1)).toBe(130);
    expect(thresholdBoundValueAtFraction(RANGE, 0.5)).toBe(115);
    expect(fractionForThresholdBoundValue(RANGE, 115)).toBe(0.5);
  });

  it("clamps out-of-range inputs", () => {
    expect(thresholdBoundValueAtFraction(RANGE, -1)).toBe(100);
    expect(thresholdBoundValueAtFraction(RANGE, 2)).toBe(130);
    expect(fractionForThresholdBoundValue(RANGE, 90)).toBe(0);
    expect(fractionForThresholdBoundValue(RANGE, 140)).toBe(1);
  });

  it("returns fraction 0 for a degenerate range", () => {
    expect(fractionForThresholdBoundValue({ min: 5, max: 5 }, 5)).toBe(0);
  });
});
