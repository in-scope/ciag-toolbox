import { describe, expect, it } from "vitest";

import {
  applySpatialFrequencyFilterToBand,
  butterworthGainForSettings,
  fftBinFrequency,
  type BandSpatialShape,
} from "./spatial-frequency-filter";

const SIDE = 8;
const SQUARE: BandSpatialShape = { width: SIDE, height: SIDE };

function makeCheckerboardBand(low: number, high: number): Uint8Array {
  const band = new Uint8Array(SIDE * SIDE);
  for (let y = 0; y < SIDE; y += 1) {
    for (let x = 0; x < SIDE; x += 1) {
      band[y * SIDE + x] = (x + y) % 2 === 0 ? low : high;
    }
  }
  return band;
}

function makeFlatBand(value: number, pixelCount: number): Uint8Array {
  return new Uint8Array(pixelCount).fill(value);
}

function meanOf(values: Float32Array): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function maxAbsoluteDeviationFrom(values: Float32Array, center: number): number {
  let max = 0;
  for (const value of values) max = Math.max(max, Math.abs(value - center));
  return max;
}

describe("fftBinFrequency", () => {
  it("folds the upper half of the spectrum onto the matching negative frequency", () => {
    expect(fftBinFrequency(0, 8)).toBe(0);
    expect(fftBinFrequency(2, 8)).toBeCloseTo(0.25, 12);
    expect(fftBinFrequency(4, 8)).toBeCloseTo(0.5, 12);
    expect(fftBinFrequency(6, 8)).toBeCloseTo(0.25, 12);
  });
});

describe("applySpatialFrequencyFilterToBand", () => {
  it("low-pass attenuates a Nyquist checkerboard down to its mean", () => {
    const band = makeCheckerboardBand(0, 200);
    const filtered = applySpatialFrequencyFilterToBand(band, SQUARE, {
      mode: "lowpass",
      cutoff: 0.1,
    });
    expect(meanOf(filtered)).toBeCloseTo(100, 3);
    expect(maxAbsoluteDeviationFrom(filtered, 100)).toBeLessThan(2);
  });

  it("low-pass passes a flat band through unchanged (DC gain is 1)", () => {
    const filtered = applySpatialFrequencyFilterToBand(makeFlatBand(150, SIDE * SIDE), SQUARE, {
      mode: "lowpass",
      cutoff: 0.1,
    });
    expect(maxAbsoluteDeviationFrom(filtered, 150)).toBeLessThan(1e-6);
  });

  it("high-pass attenuates a flat band to zero", () => {
    const filtered = applySpatialFrequencyFilterToBand(makeFlatBand(150, SIDE * SIDE), SQUARE, {
      mode: "highpass",
      cutoff: 0.05,
    });
    expect(maxAbsoluteDeviationFrom(filtered, 0)).toBeLessThan(1e-6);
  });

  it("high-pass keeps a Nyquist checkerboard's oscillation while removing its mean", () => {
    const band = makeCheckerboardBand(0, 200);
    const filtered = applySpatialFrequencyFilterToBand(band, SQUARE, {
      mode: "highpass",
      cutoff: 0.05,
    });
    expect(meanOf(filtered)).toBeCloseTo(0, 3);
    expect(maxAbsoluteDeviationFrom(filtered, 0)).toBeGreaterThan(80);
  });

  it("bandpass removes DC but keeps a mid-frequency wave", () => {
    const width = 8;
    const midFrequencyWave = Float32Array.from(
      { length: width },
      (_unused, x) => 100 + 50 * Math.cos(2 * Math.PI * 0.25 * x),
    );
    const filtered = applySpatialFrequencyFilterToBand(
      midFrequencyWave,
      { width, height: 1 },
      { mode: "bandpass", lowCutoff: 0.1, highCutoff: 0.4 },
    );
    expect(meanOf(filtered)).toBeCloseTo(0, 3);
    expect(Math.abs(filtered[0] ?? 0)).toBeGreaterThan(30);
  });

  it("mirror-pads non-power-of-two dimensions so a flat band stays flat", () => {
    const shape: BandSpatialShape = { width: 5, height: 3 };
    const filtered = applySpatialFrequencyFilterToBand(makeFlatBand(90, 15), shape, {
      mode: "lowpass",
      cutoff: 0.2,
    });
    expect(filtered.length).toBe(15);
    expect(maxAbsoluteDeviationFrom(filtered, 90)).toBeLessThan(1e-6);
  });

  it("rejects unusable settings and mismatched band shapes before filtering", () => {
    const flat = makeFlatBand(1, SIDE * SIDE);
    expect(() =>
      applySpatialFrequencyFilterToBand(flat, SQUARE, { mode: "lowpass", cutoff: 0 }),
    ).toThrow(/greater than 0/);
    expect(() =>
      applySpatialFrequencyFilterToBand(flat, SQUARE, {
        mode: "bandpass",
        lowCutoff: 0.4,
        highCutoff: 0.1,
      }),
    ).toThrow(/low cutoff below the high/);
    expect(() =>
      applySpatialFrequencyFilterToBand(flat, { width: 3, height: 3 }, { mode: "lowpass", cutoff: 0.1 }),
    ).toThrow(/64 values/);
  });
});

describe("butterworthGainForSettings", () => {
  it("routes each mode to its matching transfer function", () => {
    expect(butterworthGainForSettings(0, { mode: "lowpass", cutoff: 0.2 })).toBe(1);
    expect(butterworthGainForSettings(0, { mode: "highpass", cutoff: 0.2 })).toBe(0);
    expect(
      butterworthGainForSettings(0.15, { mode: "bandpass", lowCutoff: 0.05, highCutoff: 0.25 }),
    ).toBeGreaterThan(0.85);
  });
});
