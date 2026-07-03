import { describe, expect, it } from "vitest";

import {
  butterworthBandpassGain,
  butterworthHighpassGain,
  butterworthLowpassGain,
} from "./butterworth";

describe("butterworthLowpassGain", () => {
  it("passes DC fully and halves the power exactly at the cutoff", () => {
    expect(butterworthLowpassGain(0, 0.2)).toBe(1);
    expect(butterworthLowpassGain(0.2, 0.2)).toBeCloseTo(0.5, 12);
  });

  it("attenuates monotonically toward zero above the cutoff", () => {
    const nearCutoff = butterworthLowpassGain(0.25, 0.1);
    const farAboveCutoff = butterworthLowpassGain(0.5, 0.1);
    expect(nearCutoff).toBeLessThan(0.5);
    expect(farAboveCutoff).toBeLessThan(nearCutoff);
    expect(farAboveCutoff).toBeLessThan(0.01);
  });
});

describe("butterworthHighpassGain", () => {
  it("removes DC entirely and halves the power exactly at the cutoff", () => {
    expect(butterworthHighpassGain(0, 0.05)).toBe(0);
    expect(butterworthHighpassGain(0.05, 0.05)).toBeCloseTo(0.5, 12);
  });

  it("approaches full gain well above the cutoff", () => {
    expect(butterworthHighpassGain(0.5, 0.05)).toBeGreaterThan(0.99);
  });
});

describe("butterworthBandpassGain", () => {
  it("removes DC, peaks between the cutoffs, and falls off above the high cutoff", () => {
    const atDc = butterworthBandpassGain(0, 0.05, 0.25);
    const betweenCutoffs = butterworthBandpassGain(0.15, 0.05, 0.25);
    const aboveHighCutoff = butterworthBandpassGain(0.5, 0.05, 0.25);
    expect(atDc).toBe(0);
    expect(betweenCutoffs).toBeGreaterThan(0.85);
    expect(aboveHighCutoff).toBeLessThan(betweenCutoffs / 2);
  });

  it("rejects cutoffs that are not a usable low < high band", () => {
    expect(() => butterworthBandpassGain(0.25, 0.3, 0.1)).toThrow(/low cutoff below the high/);
    expect(() => butterworthBandpassGain(0.25, 0.2, 0.2)).toThrow(/low cutoff below the high/);
  });
});

describe("cutoff validation shared by every mode", () => {
  it("rejects a zero, negative, or non-finite cutoff with a user-facing error", () => {
    expect(() => butterworthLowpassGain(0.1, 0)).toThrow(/greater than 0/);
    expect(() => butterworthHighpassGain(0.1, -0.2)).toThrow(/greater than 0/);
    expect(() => butterworthLowpassGain(0.1, Number.NaN)).toThrow(/greater than 0/);
  });
});
