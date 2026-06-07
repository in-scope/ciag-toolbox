import { describe, expect, it } from "vitest";

import {
  clampBandIndexWithinCount,
  formatBandNumberForInput,
  parseTypedBandNumberToIndexOrNull,
  pickBandStepDirectionFromWheelDelta,
  stepBandIndexInDirection,
} from "./band-navigation";

describe("clampBandIndexWithinCount", () => {
  it("keeps an in-range index unchanged", () => {
    expect(clampBandIndexWithinCount(5, 300)).toBe(5);
  });

  it("clamps below zero to the first band", () => {
    expect(clampBandIndexWithinCount(-3, 300)).toBe(0);
  });

  it("clamps past the end to the last band", () => {
    expect(clampBandIndexWithinCount(999, 300)).toBe(299);
  });

  it("returns zero for an empty band count", () => {
    expect(clampBandIndexWithinCount(2, 0)).toBe(0);
  });
});

describe("stepBandIndexInDirection", () => {
  it("steps forward by one band", () => {
    expect(stepBandIndexInDirection(10, 1, 300)).toBe(11);
  });

  it("steps backward by one band", () => {
    expect(stepBandIndexInDirection(10, -1, 300)).toBe(9);
  });

  it("does not step past the last band", () => {
    expect(stepBandIndexInDirection(299, 1, 300)).toBe(299);
  });

  it("does not step before the first band", () => {
    expect(stepBandIndexInDirection(0, -1, 300)).toBe(0);
  });
});

describe("parseTypedBandNumberToIndexOrNull", () => {
  it("parses a one-based band number to a zero-based index", () => {
    expect(parseTypedBandNumberToIndexOrNull("12", 300)).toBe(11);
  });

  it("rejects a number below the first band", () => {
    expect(parseTypedBandNumberToIndexOrNull("0", 300)).toBeNull();
  });

  it("rejects a number past the last band", () => {
    expect(parseTypedBandNumberToIndexOrNull("301", 300)).toBeNull();
  });

  it("rejects non-numeric text", () => {
    expect(parseTypedBandNumberToIndexOrNull("12a", 300)).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseTypedBandNumberToIndexOrNull("  7 ", 300)).toBe(6);
  });
});

describe("formatBandNumberForInput", () => {
  it("renders a zero-based index as a one-based number", () => {
    expect(formatBandNumberForInput(0)).toBe("1");
    expect(formatBandNumberForInput(299)).toBe("300");
  });
});

describe("pickBandStepDirectionFromWheelDelta", () => {
  it("steps forward on downward scroll", () => {
    expect(pickBandStepDirectionFromWheelDelta(40)).toBe(1);
  });

  it("steps backward on upward scroll", () => {
    expect(pickBandStepDirectionFromWheelDelta(-40)).toBe(-1);
  });
});
