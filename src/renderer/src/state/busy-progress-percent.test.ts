import { describe, expect, it } from "vitest";

import { formatBusyProgressPercentText } from "./busy-progress-percent";

describe("formatBusyProgressPercentText", () => {
  it("formats zero progress as 0%", () => {
    expect(formatBusyProgressPercentText(0)).toBe("0%");
  });

  it("rounds a fractional progress to the nearest whole percent", () => {
    expect(formatBusyProgressPercentText(0.42)).toBe("42%");
    expect(formatBusyProgressPercentText(0.666)).toBe("67%");
    expect(formatBusyProgressPercentText(0.004)).toBe("0%");
  });

  it("formats complete progress as 100%", () => {
    expect(formatBusyProgressPercentText(1)).toBe("100%");
  });

  it("clamps out-of-range progress into 0..100", () => {
    expect(formatBusyProgressPercentText(-0.5)).toBe("0%");
    expect(formatBusyProgressPercentText(1.7)).toBe("100%");
  });

  it("treats a NaN progress as 0%", () => {
    expect(formatBusyProgressPercentText(Number.NaN)).toBe("0%");
  });
});
