import { describe, expect, it } from "vitest";

import {
  formatHistogramPixelCountForAxis,
  formatNumberStringWithSuperscriptExponent,
} from "@/lib/image/format-axis-number";

describe("formatNumberStringWithSuperscriptExponent", () => {
  it("rewrites a positive e+N exponent as a superscript x10 magnitude", () => {
    expect(formatNumberStringWithSuperscriptExponent("1.234e+5")).toBe("1.234×10⁵");
  });

  it("rewrites a two-digit exponent as superscript digits", () => {
    expect(formatNumberStringWithSuperscriptExponent("1e+21")).toBe("1×10²¹");
  });

  it("renders a negative exponent with a superscript minus sign", () => {
    expect(formatNumberStringWithSuperscriptExponent("1.5e-7")).toBe("1.5×10⁻⁷");
  });

  it("keeps a negative mantissa intact", () => {
    expect(formatNumberStringWithSuperscriptExponent("-2.5e+4")).toBe("-2.5×10⁴");
  });

  it("leaves plain numeric strings untouched", () => {
    expect(formatNumberStringWithSuperscriptExponent("65535")).toBe("65535");
    expect(formatNumberStringWithSuperscriptExponent("0.2500")).toBe("0.2500");
    expect(formatNumberStringWithSuperscriptExponent("-0.5000")).toBe("-0.5000");
  });
});

describe("formatHistogramPixelCountForAxis", () => {
  it("shows small counts as plain integers", () => {
    expect(formatHistogramPixelCountForAxis(0)).toBe("0");
    expect(formatHistogramPixelCountForAxis(9999)).toBe("9999");
  });

  it("compacts large counts to a superscript x10 magnitude", () => {
    expect(formatHistogramPixelCountForAxis(250000)).toBe("2.5×10⁵");
    expect(formatHistogramPixelCountForAxis(12345)).toBe("1.2×10⁴");
  });

  it("returns a dash for non-finite counts", () => {
    expect(formatHistogramPixelCountForAxis(Number.NaN)).toBe("-");
  });
});
