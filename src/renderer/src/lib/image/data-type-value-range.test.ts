import { describe, expect, it } from "vitest";

import {
  clampValueToDataTypeRange,
  clampValueToDataTypeRangeRoundingIntegers,
  dataTypeValueRangeForBand,
  isFloatTypedArray,
} from "./data-type-value-range";

describe("dataTypeValueRangeForBand", () => {
  it("returns the [0,1] display range for float bands regardless of container", () => {
    expect(dataTypeValueRangeForBand(Float32Array.from([0]), "float")).toEqual({ min: 0, max: 1 });
  });

  it("returns the unsigned container range for an integer band", () => {
    expect(dataTypeValueRangeForBand(Uint8Array.from([0]), "uint")).toEqual({ min: 0, max: 255 });
  });

  it("returns the signed container range for a signed integer band", () => {
    expect(dataTypeValueRangeForBand(Int16Array.from([0]), "int")).toEqual({ min: -32768, max: 32767 });
  });
});

describe("clampValueToDataTypeRangeRoundingIntegers", () => {
  it("rounds integer output and clamps to the range", () => {
    expect(clampValueToDataTypeRangeRoundingIntegers(255.6, { min: 0, max: 255 }, true)).toBe(255);
    expect(clampValueToDataTypeRangeRoundingIntegers(12.4, { min: 0, max: 255 }, true)).toBe(12);
  });

  it("keeps fractional float output without rounding", () => {
    expect(clampValueToDataTypeRangeRoundingIntegers(0.25, { min: 0, max: 1 }, false)).toBe(0.25);
  });
});

describe("clampValueToDataTypeRange and isFloatTypedArray", () => {
  it("clamps below and above the range bounds", () => {
    expect(clampValueToDataTypeRange(-5, { min: 0, max: 10 })).toBe(0);
    expect(clampValueToDataTypeRange(99, { min: 0, max: 10 })).toBe(10);
  });

  it("recognises float typed arrays", () => {
    expect(isFloatTypedArray(Float32Array.from([0]))).toBe(true);
    expect(isFloatTypedArray(Uint8Array.from([0]))).toBe(false);
  });
});
