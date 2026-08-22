import { describe, expect, it } from "vitest";

import {
  applySpatialFrequencyFilterToBand,
  assertShapeFitsSpatialFilterGrid,
  butterworthGainForSettings,
  createReusableSpatialFilterGrid,
  estimateSpatialFilterGridBytes,
  fftBinFrequency,
  SPATIAL_FILTER_GRID_BYTE_LIMIT,
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

// CT-219a: one working grid is reused across a run over many bands; the reuse
// must be invisible in the results (the imaginary plane resets, the real plane
// is fully overwritten by the mirror fill, and a padded-shape change reallocates).
describe("createReusableSpatialFilterGrid", () => {
  const LOWPASS = { mode: "lowpass", cutoff: 0.1 } as const;

  it("filters consecutive bands identically to fresh one-shot runs", () => {
    const reusableGrid = createReusableSpatialFilterGrid();
    const checkerboard = makeCheckerboardBand(0, 200);
    const flat = makeFlatBand(150, SIDE * SIDE);
    const reusedFirst = reusableGrid.filterBand(checkerboard, SQUARE, LOWPASS);
    const reusedSecond = reusableGrid.filterBand(flat, SQUARE, LOWPASS);
    expect(Array.from(reusedFirst)).toEqual(
      Array.from(applySpatialFrequencyFilterToBand(checkerboard, SQUARE, LOWPASS)),
    );
    expect(Array.from(reusedSecond)).toEqual(
      Array.from(applySpatialFrequencyFilterToBand(flat, SQUARE, LOWPASS)),
    );
  });

  it("survives a shape change between bands by reallocating the grid", () => {
    const reusableGrid = createReusableSpatialFilterGrid();
    reusableGrid.filterBand(makeFlatBand(90, 15), { width: 5, height: 3 }, LOWPASS);
    const filtered = reusableGrid.filterBand(makeFlatBand(150, SIDE * SIDE), SQUARE, LOWPASS);
    expect(maxAbsoluteDeviationFrom(filtered, 150)).toBeLessThan(1e-6);
  });

  it("rejects an oversized shape before touching the band data", () => {
    const reusableGrid = createReusableSpatialFilterGrid();
    expect(() =>
      reusableGrid.filterBand(new Float32Array(1), { width: 20000, height: 20000 }, LOWPASS),
    ).toThrow(/too large for the frequency filter/);
  });
});

// CT-225: filterBand streams monotonic 0..1 fractions from the FFT line loops
// (forward transform = first half, inverse = second half) so a minutes-long
// band visibly advances the busy bar.
describe("within-band filter progress (CT-225)", () => {
  it("reports monotonic within-band fractions crossing the forward/inverse halves", () => {
    const ticks: number[] = [];
    createReusableSpatialFilterGrid().filterBand(
      makeFlatBand(120, 16),
      { width: 4, height: 4 },
      { mode: "lowpass", cutoff: 0.1 },
      (fraction) => ticks.push(fraction),
    );
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks[ticks.length - 1]).toBe(1);
    expect(ticks.some((tick) => tick > 0 && tick <= 0.5)).toBe(true);
    expect(ticks.some((tick) => tick > 0.5 && tick < 1)).toBe(true);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!).toBeGreaterThanOrEqual(ticks[i - 1]!);
    }
  });
});

describe("spatial filter grid size limit", () => {
  // CT-224: dimensions pad to the smallest 2/3/5-smooth size, not the next
  // power of two, so already-smooth dimensions (5, 3, 8) need no padding.
  it("estimates two float32 buffers at the smallest smooth padded dimensions", () => {
    expect(estimateSpatialFilterGridBytes({ width: 5, height: 3 })).toBe(5 * 3 * 4 * 2);
    expect(estimateSpatialFilterGridBytes({ width: 8, height: 8 })).toBe(8 * 8 * 4 * 2);
    expect(estimateSpatialFilterGridBytes({ width: 7, height: 11 })).toBe(8 * 12 * 4 * 2);
  });

  it("accepts the reference 8000 x 6000 scale and rejects a 150 MP stretch capture", () => {
    expect(() => assertShapeFitsSpatialFilterGrid({ width: 8000, height: 6000 })).not.toThrow();
    expect(estimateSpatialFilterGridBytes({ width: 8000, height: 6000 })).toBeLessThanOrEqual(
      SPATIAL_FILTER_GRID_BYTE_LIMIT,
    );
    expect(() => assertShapeFitsSpatialFilterGrid({ width: 14000, height: 11000 })).toThrow(
      /too large for the frequency filter.*Crop the stack/s,
    );
  });

  // CT-224: the 11608 x 8708 capture that hit the old 2048 MB power-of-two grid
  // now pads to 11664 x 8748 (~779 MB) and passes the pre-flight.
  it("accepts a 101 MP capture that the power-of-two padding used to reject", () => {
    expect(() => assertShapeFitsSpatialFilterGrid({ width: 11608, height: 8708 })).not.toThrow();
    expect(estimateSpatialFilterGridBytes({ width: 11608, height: 8708 })).toBe(
      11664 * 8748 * 4 * 2,
    );
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
