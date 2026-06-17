import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_KEPT_COMPONENTS,
  defaultComponentCountForBandCount,
  formatComponentCountLabel,
  resolveComponentCount,
} from "./component-count";

describe("resolveComponentCount", () => {
  it("clamps a request above the band count down to the band count", () => {
    expect(resolveComponentCount(50, 12)).toBe(12);
  });

  it("clamps a request below one up to one", () => {
    expect(resolveComponentCount(0, 12)).toBe(1);
    expect(resolveComponentCount(-3, 12)).toBe(1);
  });

  it("defaults an empty request to min(10, bandCount)", () => {
    expect(resolveComponentCount(undefined, 12)).toBe(DEFAULT_MAX_KEPT_COMPONENTS);
    expect(resolveComponentCount(Number.NaN, 12)).toBe(DEFAULT_MAX_KEPT_COMPONENTS);
  });

  it("defaults to the band count when there are fewer than ten bands", () => {
    expect(resolveComponentCount(undefined, 6)).toBe(6);
  });

  it("rounds a fractional request before clamping", () => {
    expect(resolveComponentCount(3.7, 12)).toBe(4);
  });
});

describe("defaultComponentCountForBandCount", () => {
  it("never exceeds ten and never drops below one", () => {
    expect(defaultComponentCountForBandCount(40)).toBe(10);
    expect(defaultComponentCountForBandCount(1)).toBe(1);
    expect(defaultComponentCountForBandCount(0)).toBe(1);
  });
});

describe("formatComponentCountLabel", () => {
  it("renders the kept count out of the source band count", () => {
    expect(formatComponentCountLabel(3, 12)).toBe("3 of 12");
  });
});
