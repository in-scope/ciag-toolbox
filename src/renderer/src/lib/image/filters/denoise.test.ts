import { describe, expect, it } from "vitest";

import {
  applyDenoiseToBand,
  applyDenoiseToBandInChunksReportingProgress,
  applyGaussianDenoise,
  applyMedianDenoise,
  buildNormalizedGaussianKernel,
} from "./denoise";
import type { BandSpatialShape } from "./spatial-frequency-filter";

const SHAPE_8X8: BandSpatialShape = { width: 8, height: 8 };

// Deterministic "noise": a checkerboard of +/- 20 around 100. Its variance is
// exactly 400, and any low-pass smoothing must pull neighbouring opposite
// values toward each other, so the variance must drop.
function makeCheckerboardNoiseBand(): Uint8Array {
  const band = new Uint8Array(SHAPE_8X8.width * SHAPE_8X8.height);
  for (let y = 0; y < SHAPE_8X8.height; y += 1) {
    for (let x = 0; x < SHAPE_8X8.width; x += 1) {
      band[y * SHAPE_8X8.width + x] = (x + y) % 2 === 0 ? 120 : 80;
    }
  }
  return band;
}

// Left half 10, right half 200: a hard vertical edge between x = 3 and x = 4,
// with isolated salt (255) and pepper (0) spikes away from the edge.
function makeSteppedBandWithSpikes(): Uint8Array {
  const band = new Uint8Array(SHAPE_8X8.width * SHAPE_8X8.height);
  for (let y = 0; y < SHAPE_8X8.height; y += 1) {
    for (let x = 0; x < SHAPE_8X8.width; x += 1) {
      band[y * SHAPE_8X8.width + x] = x < 4 ? 10 : 200;
    }
  }
  band[1 * SHAPE_8X8.width + 1] = 255;
  band[6 * SHAPE_8X8.width + 6] = 0;
  return band;
}

function computeVariance(values: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) sum += values[index] ?? 0;
  const mean = sum / values.length;
  let squaredDeviation = 0;
  for (let index = 0; index < values.length; index += 1) {
    squaredDeviation += ((values[index] ?? 0) - mean) ** 2;
  }
  return squaredDeviation / values.length;
}

describe("buildNormalizedGaussianKernel", () => {
  it("builds a symmetric kernel whose weights sum to 1", () => {
    const kernel = buildNormalizedGaussianKernel(1);
    expect(kernel.length).toBe(7);
    let sum = 0;
    for (const weight of kernel) sum += weight;
    expect(sum).toBeCloseTo(1, 12);
    expect(kernel[0]).toBeCloseTo(kernel[6] ?? Number.NaN, 12);
    expect(kernel[3]).toBeGreaterThan(kernel[2] ?? Number.NaN);
  });

  it("rejects a non-positive or non-finite sigma with a user-facing error", () => {
    expect(() => buildNormalizedGaussianKernel(0)).toThrow(/sigma/i);
    expect(() => buildNormalizedGaussianKernel(-1)).toThrow(/sigma/i);
    expect(() => buildNormalizedGaussianKernel(Number.NaN)).toThrow(/sigma/i);
  });
});

describe("applyGaussianDenoise", () => {
  it("reduces the variance of a noisy band", () => {
    const noisy = makeCheckerboardNoiseBand();
    const smoothed = applyGaussianDenoise(noisy, SHAPE_8X8, 1);
    expect(computeVariance(noisy)).toBeCloseTo(400, 6);
    expect(computeVariance(smoothed)).toBeLessThan(100);
  });

  it("keeps a flat band exactly flat (normalized kernel)", () => {
    const flat = new Uint8Array(SHAPE_8X8.width * SHAPE_8X8.height).fill(50);
    const smoothed = applyGaussianDenoise(flat, SHAPE_8X8, 2);
    for (const value of smoothed) expect(value).toBeCloseTo(50, 4);
  });

  it("rejects a band whose length does not match the shape", () => {
    expect(() => applyGaussianDenoise(new Uint8Array(3), SHAPE_8X8, 1)).toThrow(/shape/i);
  });
});

describe("applyMedianDenoise", () => {
  it("removes isolated salt-and-pepper spikes", () => {
    const denoised = applyMedianDenoise(makeSteppedBandWithSpikes(), SHAPE_8X8, 1);
    expect(denoised[1 * SHAPE_8X8.width + 1]).toBe(10);
    expect(denoised[6 * SHAPE_8X8.width + 6]).toBe(200);
  });

  it("preserves a hard edge (no blurring across the step)", () => {
    const denoised = applyMedianDenoise(makeSteppedBandWithSpikes(), SHAPE_8X8, 1);
    expect(denoised[4 * SHAPE_8X8.width + 3]).toBe(10);
    expect(denoised[4 * SHAPE_8X8.width + 4]).toBe(200);
  });

  it("keeps a flat band unchanged", () => {
    const flat = new Uint8Array(SHAPE_8X8.width * SHAPE_8X8.height).fill(77);
    const denoised = applyMedianDenoise(flat, SHAPE_8X8, 2);
    for (const value of denoised) expect(value).toBe(77);
  });

  it("rejects a fractional or sub-1 radius with a user-facing error", () => {
    const band = new Uint8Array(SHAPE_8X8.width * SHAPE_8X8.height);
    expect(() => applyMedianDenoise(band, SHAPE_8X8, 0)).toThrow(/radius/i);
    expect(() => applyMedianDenoise(band, SHAPE_8X8, 1.5)).toThrow(/radius/i);
  });
});

describe("applyDenoiseToBand", () => {
  it("dispatches to the method named in the settings", () => {
    const band = makeSteppedBandWithSpikes();
    const median = applyDenoiseToBand(band, SHAPE_8X8, { method: "median", radius: 1 });
    const gaussian = applyDenoiseToBand(band, SHAPE_8X8, { method: "gaussian", sigma: 1 });
    expect(median[1 * SHAPE_8X8.width + 1]).toBe(10);
    expect(gaussian[1 * SHAPE_8X8.width + 1]).toBeGreaterThan(10);
    expect(gaussian[1 * SHAPE_8X8.width + 1]).toBeLessThan(255);
  });
});

// CT-226: the chunked twins share the row-range workers with the sync functions,
// so their outputs are identical; between chunks they tick a monotonic 0..1
// within-band fraction (Gaussian: horizontal pass = first half, vertical = second).
describe("applyDenoiseToBandInChunksReportingProgress (CT-226)", () => {
  const SHAPE = { width: 4, height: 6 };
  const ONE_ROW_PER_CHUNK = 4;

  function makeRampBand(): Uint16Array {
    return Uint16Array.from({ length: 24 }, (_unused, index) => (index * 37) % 211);
  }

  it("matches the sync median denoise exactly", async () => {
    const chunked = await applyDenoiseToBandInChunksReportingProgress(
      makeRampBand(),
      SHAPE,
      { method: "median", radius: 1 },
      undefined,
      ONE_ROW_PER_CHUNK,
    );
    expect(Array.from(chunked)).toEqual(
      Array.from(applyMedianDenoise(makeRampBand(), SHAPE, 1)),
    );
  });

  it("matches the sync Gaussian denoise exactly", async () => {
    const chunked = await applyDenoiseToBandInChunksReportingProgress(
      makeRampBand(),
      SHAPE,
      { method: "gaussian", sigma: 1 },
      undefined,
      ONE_ROW_PER_CHUNK,
    );
    expect(Array.from(chunked)).toEqual(
      Array.from(applyGaussianDenoise(makeRampBand(), SHAPE, 1)),
    );
  });

  it("ticks one within-band fraction per median row chunk", async () => {
    const ticks: number[] = [];
    await applyDenoiseToBandInChunksReportingProgress(
      makeRampBand(),
      SHAPE,
      { method: "median", radius: 1 },
      (fraction) => ticks.push(fraction),
      ONE_ROW_PER_CHUNK,
    );
    expect(ticks).toEqual([1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1]);
  });

  it("splits Gaussian ticks between the horizontal and vertical passes", async () => {
    const ticks: number[] = [];
    await applyDenoiseToBandInChunksReportingProgress(
      makeRampBand(),
      SHAPE,
      { method: "gaussian", sigma: 1 },
      (fraction) => ticks.push(fraction),
      ONE_ROW_PER_CHUNK,
    );
    expect(ticks.length).toBe(12);
    expect(ticks[5]).toBe(0.5);
    expect(ticks[11]).toBe(1);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!).toBeGreaterThanOrEqual(ticks[i - 1]!);
    }
  });
});
