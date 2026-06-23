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

// CT-195: when the noise covariance is rank-deficient (e.g. two bands carrying
// independent signals but the SAME correlated noise), the noise-whitening gain
// (1 / sqrt(noise eigenvalue)) explodes along the signal-bearing noise null
// space. Before the fix the data-space component vectors inherited that gain and
// the projected component values reached ~1.5e6, which overflows the half-float
// display texture (max ~65504) into Inf and a uniformly white panel. The float
// values stayed finite, so the readout oracle and the collinear-fixture e2e never
// caught it. The fix rescales each component vector to unit length, keeping the
// components finite AND within the half-float display range while leaving the
// eigenvalues / noise fractions intact.
const HALF_FLOAT_MAX_FINITE = 65504;
const RANK_DEFICIENT_SIDE = 24;
const RANK_DEFICIENT_COUNT = RANK_DEFICIENT_SIDE * RANK_DEFICIENT_SIDE;

// Same integer noise added to a horizontal-ramp band and a vertical-ramp band:
// the per-direction-centred neighbour differences are identical across the two
// bands, so the estimated noise covariance is singular and the (independent)
// signals occupy its null space.
function rankDeficientNoiseCube(): CubeSampleMatrix {
  const sharedNoise = Array.from({ length: RANK_DEFICIENT_COUNT }, (_u, i) => ((i * 7) % 3) - 1);
  const horizontal = Array.from({ length: RANK_DEFICIENT_COUNT }, (_u, i) => 100 + 100 * (i % RANK_DEFICIENT_SIDE));
  const vertical = Array.from(
    { length: RANK_DEFICIENT_COUNT },
    (_u, i) => 100 + 80 * Math.floor(i / RANK_DEFICIENT_SIDE),
  );
  const b0 = horizontal.map((value, i) => value + sharedNoise[i]!);
  const b1 = vertical.map((value, i) => value + sharedNoise[i]!);
  return makeSampleMatrix(RANK_DEFICIENT_SIDE, RANK_DEFICIENT_SIDE, [b0, b1]);
}

function vectorLength(vector: ReadonlyArray<number>): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

describe("fitMnf on a rank-deficient-noise cube (CT-195 white-screen regression)", () => {
  const cube = rankDeficientNoiseCube();

  it("produces finite component vectors of unit length, not the exploded whitening scale", () => {
    const fit = fitMnf(cube, 2);
    for (const vector of fit.componentVectors) {
      expect(vector.every((value) => Number.isFinite(value))).toBe(true);
      expect(vectorLength(vector)).toBeCloseTo(1, 6);
    }
  });

  it("keeps the projected components finite and within the half-float display range", () => {
    const fit = fitMnf(cube, 2);
    for (const band of applyMnf(cube, fit, 2)) {
      for (const value of band) {
        expect(Number.isFinite(value)).toBe(true);
        expect(Math.abs(value)).toBeLessThan(HALF_FLOAT_MAX_FINITE);
      }
    }
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
