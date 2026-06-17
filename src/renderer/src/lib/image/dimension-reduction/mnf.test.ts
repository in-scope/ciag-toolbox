import { describe, expect, it } from "vitest";

import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";

import { applyMnf, fitMnf, noiseFractionPerComponent } from "./mnf";

// A deterministic LCG gives independent-yet-reproducible per-band noise without
// Math.random (which would make the test flaky). Different seeds produce
// uncorrelated streams, so the estimated noise covariance stays non-singular.
function deterministicNoise(seed: number, count: number): number[] {
  let state = seed >>> 0;
  return Array.from({ length: count }, () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  });
}

function makeSampleMatrix(width: number, height: number, bands: ReadonlyArray<ReadonlyArray<number>>): CubeSampleMatrix {
  const bandValues = bands.map((band) => Float64Array.from(band));
  return { bandCount: bands.length, sampleCount: width * height, width, height, bandValues };
}

const GRID_SIDE = 8;
const SAMPLE_COUNT = GRID_SIDE * GRID_SIDE;

// Band 0 is a horizontal ramp with tiny noise (very high SNR). Band 1 is a
// vertical ramp with large noise (low SNR). The two ramps are linearly
// independent signals (horizontal vs vertical gradient), so the MNF component
// that recovers the high-SNR source can be told apart by correlation.
function horizontalRamp(): number[] {
  return Array.from({ length: SAMPLE_COUNT }, (_unused, index) => 12 * (index % GRID_SIDE));
}

function verticalRamp(): number[] {
  return Array.from({ length: SAMPLE_COUNT }, (_unused, index) => 12 * Math.floor(index / GRID_SIDE));
}

function addNoise(signal: number[], noise: number[], amplitude: number): number[] {
  return signal.map((value, index) => value + amplitude * noise[index]!);
}

const HIGH_SNR_BAND = addNoise(horizontalRamp(), deterministicNoise(1, SAMPLE_COUNT), 1);
const LOW_SNR_BAND = addNoise(verticalRamp(), deterministicNoise(999, SAMPLE_COUNT), 30);
const NOISY_RAMP_CUBE = makeSampleMatrix(GRID_SIDE, GRID_SIDE, [HIGH_SNR_BAND, LOW_SNR_BAND]);

function pearsonCorrelation(a: ArrayLike<number>, b: ReadonlyArray<number>): number {
  const meanA = average(Array.from(a));
  const meanB = average(b);
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < b.length; i += 1) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  return covariance / Math.sqrt(varianceA * varianceB);
}

function average(values: ReadonlyArray<number>): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

describe("fitMnf", () => {
  it("orders components so the leading one has the lower noise fraction", () => {
    const fit = fitMnf(NOISY_RAMP_CUBE, 2);
    const noiseFractions = noiseFractionPerComponent(fit.eigenvalues);
    expect(noiseFractions[0]!).toBeLessThan(noiseFractions[1]!);
  });

  it("makes the leading component recover the high-SNR source, not the noisy one", () => {
    const fit = fitMnf(NOISY_RAMP_CUBE, 2);
    const [leading] = applyMnf(NOISY_RAMP_CUBE, fit, 2);
    const correlationWithHighSnr = Math.abs(pearsonCorrelation(leading!, horizontalRamp()));
    const correlationWithLowSnr = Math.abs(pearsonCorrelation(leading!, verticalRamp()));
    expect(correlationWithHighSnr).toBeGreaterThan(0.9);
    expect(correlationWithHighSnr).toBeGreaterThan(correlationWithLowSnr);
  });
});

describe("applyMnf", () => {
  it("keeps only the requested number of components", () => {
    const fit = fitMnf(NOISY_RAMP_CUBE, 2);
    const projection = applyMnf(NOISY_RAMP_CUBE, fit, 1);
    expect(projection).toHaveLength(1);
    expect(projection[0]!.length).toBe(SAMPLE_COUNT);
  });

  it("centres with the fit means: a sample equal to the means projects to zero", () => {
    const fit = fitMnf(NOISY_RAMP_CUBE, 2);
    const meanSample = makeSampleMatrix(1, 1, fit.means.map((mean) => [mean]));
    const [leading] = applyMnf(meanSample, fit, 1);
    expect(leading![0]!).toBeCloseTo(0, 6);
  });
});

describe("noiseFractionPerComponent", () => {
  it("is the reciprocal of each whitened eigenvalue", () => {
    expect(noiseFractionPerComponent([4, 2])).toEqual([0.25, 0.5]);
  });

  it("ascends as the eigenvalues descend, so leading components are the cleaner ones", () => {
    const fractions = noiseFractionPerComponent([8, 2, 1.25]);
    expect(fractions[0]!).toBeLessThan(fractions[1]!);
    expect(fractions[1]!).toBeLessThan(fractions[2]!);
  });

  it("clamps a noise-dominated component (eigenvalue at or below one) to a full noise fraction", () => {
    expect(noiseFractionPerComponent([0.5, 0])).toEqual([1, 1]);
  });
});
