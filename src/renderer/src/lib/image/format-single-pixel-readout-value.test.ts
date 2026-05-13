import { describe, expect, it } from "vitest";

import { formatSinglePixelReadoutValue } from "./compute-pixel-readout";

describe("formatSinglePixelReadoutValue", () => {
  it("formats unsigned integer values as plain integers", () => {
    expect(formatSinglePixelReadoutValue(0, "uint")).toBe("0");
    expect(formatSinglePixelReadoutValue(255, "uint")).toBe("255");
    expect(formatSinglePixelReadoutValue(65535, "uint")).toBe("65535");
  });

  it("formats signed integer values as plain integers with sign", () => {
    expect(formatSinglePixelReadoutValue(-32768, "int")).toBe("-32768");
    expect(formatSinglePixelReadoutValue(-1, "int")).toBe("-1");
    expect(formatSinglePixelReadoutValue(0, "int")).toBe("0");
    expect(formatSinglePixelReadoutValue(32767, "int")).toBe("32767");
  });

  it("formats positive float values with four significant figures", () => {
    expect(formatSinglePixelReadoutValue(0.123456, "float")).toBe("0.1235");
    expect(formatSinglePixelReadoutValue(123.4567, "float")).toBe("123.5");
  });

  it("formats float zero as plain '0'", () => {
    expect(formatSinglePixelReadoutValue(0, "float")).toBe("0");
  });

  it("renders a placeholder dash for non-finite values regardless of format", () => {
    expect(formatSinglePixelReadoutValue(Number.NaN, "uint")).toBe("-");
    expect(formatSinglePixelReadoutValue(Number.POSITIVE_INFINITY, "int")).toBe("-");
    expect(formatSinglePixelReadoutValue(Number.NEGATIVE_INFINITY, "float")).toBe("-");
  });
});
