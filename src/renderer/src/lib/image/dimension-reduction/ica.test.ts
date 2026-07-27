import { describe, expect, it } from "vitest";

import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";

import {
  applyIca,
  describeFastIcaFitSampling,
  fitIca,
  fitIcaReportingProgress,
  MAX_FAST_ICA_FIT_SAMPLES,
} from "./ica";

function makeSampleMatrix(bands: ReadonlyArray<ReadonlyArray<number>>): CubeSampleMatrix {
  const bandValues = bands.map((band) => Float64Array.from(band));
  const sampleCount = bands[0]!.length;
  return { bandCount: bands.length, sampleCount, width: sampleCount, height: 1, bandValues };
}

const SAMPLE_COUNT = 240;

// Two statistically independent, non-Gaussian sources: a sawtooth ramp and a
// square wave on a different period. FastICA can separate them precisely because
// each is non-Gaussian; their differing periods keep them uncorrelated.
function sawtoothSource(): number[] {
  return Array.from({ length: SAMPLE_COUNT }, (_unused, index) => ((index % 23) / 23) * 2 - 1);
}

function squareWaveSource(): number[] {
  return Array.from({ length: SAMPLE_COUNT }, (_unused, index) => (index % 11 < 5.5 ? 1 : -1));
}

// A deterministic LCG approximates Gaussian noise (sum of draws) without
// Math.random, so the near-Gaussian termination test stays reproducible.
function approximatelyGaussianStream(seed: number): number[] {
  let state = seed >>> 0;
  return Array.from({ length: SAMPLE_COUNT }, () => {
    let total = 0;
    for (let draw = 0; draw < 6; draw += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      total += state / 0xffffffff;
    }
    return total - 3;
  });
}

const SAWTOOTH = sawtoothSource();
const SQUARE = squareWaveSource();

// Mix the two sources through a non-singular matrix into two observed bands.
function mixSources(a0: number, a1: number): number[] {
  return SAWTOOTH.map((value, index) => a0 * value + a1 * SQUARE[index]!);
}

const MIXED_CUBE = makeSampleMatrix([mixSources(1, 0.7), mixSources(0.4, -1)]);

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

function bestAbsoluteCorrelationWithSource(
  recovered: ReadonlyArray<ArrayLike<number>>,
  source: ReadonlyArray<number>,
): number {
  return Math.max(...recovered.map((component) => Math.abs(pearsonCorrelation(component, source))));
}

describe("fitIca / applyIca", () => {
  it("recovers two independent sources, each correlating strongly with one component", () => {
    const fit = fitIca(MIXED_CUBE, 2);
    const recovered = applyIca(MIXED_CUBE, fit, 2);
    expect(bestAbsoluteCorrelationWithSource(recovered, SAWTOOTH)).toBeGreaterThan(0.9);
    expect(bestAbsoluteCorrelationWithSource(recovered, SQUARE)).toBeGreaterThan(0.9);
  });

  it("maps the two sources to two DIFFERENT recovered components (a true unmixing)", () => {
    const fit = fitIca(MIXED_CUBE, 2);
    const [first, second] = applyIca(MIXED_CUBE, fit, 2);
    const firstFavoursSawtooth =
      Math.abs(pearsonCorrelation(first!, SAWTOOTH)) > Math.abs(pearsonCorrelation(first!, SQUARE));
    const secondFavoursSawtooth =
      Math.abs(pearsonCorrelation(second!, SAWTOOTH)) > Math.abs(pearsonCorrelation(second!, SQUARE));
    expect(firstFavoursSawtooth).not.toBe(secondFavoursSawtooth);
  });

  it("is deterministic: the same cube fits to identical component vectors across runs", () => {
    expect(fitIca(MIXED_CUBE, 2).componentVectors).toEqual(fitIca(MIXED_CUBE, 2).componentVectors);
  });

  // CT-240: the sample matrix aliases the raster's own typed arrays, so the fit
  // must read integer storage to the exact same float64 values a copy held.
  it("fits identically over uint16 storage and a float64 copy of the same values", () => {
    const integerBands = [
      SAWTOOTH.map((value) => Math.round(600 + 100 * value)),
      SQUARE.map((value, index) => Math.round(1200 + 90 * value + 3 * (index % 7))),
    ];
    const float64Cube = makeSampleMatrix(integerBands);
    const uint16Cube: CubeSampleMatrix = {
      ...float64Cube,
      bandValues: integerBands.map((band) => Uint16Array.from(band)),
    };
    expect(fitIca(uint16Cube, 2)).toEqual(fitIca(float64Cube, 2));
  });

  it("keeps only the requested number of components", () => {
    const fit = fitIca(MIXED_CUBE, 2);
    const projection = applyIca(MIXED_CUBE, fit, 1);
    expect(projection).toHaveLength(1);
    expect(projection[0]!.length).toBe(SAMPLE_COUNT);
  });

  it("centres with the fit means: a sample equal to the means projects to zero", () => {
    const fit = fitIca(MIXED_CUBE, 2);
    const meanSample = makeSampleMatrix(fit.means.map((mean) => [mean]));
    const projection = applyIca(meanSample, fit, 2);
    expect(projection[0]![0]!).toBeCloseTo(0, 6);
    expect(projection[1]![0]!).toBeCloseTo(0, 6);
  });

  // CT-240: cubes at or below the cap keep stride 1 (bit-identical fits); a
  // reference-scale cube strides uniformly down to at most the cap, which is
  // what bounds ICA's whitened working set inside the renderer's pool.
  it("samples every pixel below the FastICA cap and strides uniformly above it", () => {
    expect(describeFastIcaFitSampling(1_000)).toEqual({ stride: 1, sampledCount: 1_000 });
    expect(describeFastIcaFitSampling(MAX_FAST_ICA_FIT_SAMPLES)).toEqual({
      stride: 1,
      sampledCount: MAX_FAST_ICA_FIT_SAMPLES,
    });
    const atScale = describeFastIcaFitSampling(50_000_000);
    expect(atScale.stride).toBe(13);
    expect(atScale.sampledCount).toBe(Math.ceil(50_000_000 / 13));
    expect(atScale.sampledCount).toBeLessThanOrEqual(MAX_FAST_ICA_FIT_SAMPLES);
  });

  it("terminates with finite component vectors on near-Gaussian data (the max-iteration cap)", () => {
    const gaussianCube = makeSampleMatrix([approximatelyGaussianStream(1), approximatelyGaussianStream(98765)]);
    const fit = fitIca(gaussianCube, 2);
    const everyEntry = fit.componentVectors.flat();
    expect(everyEntry).toHaveLength(4);
    expect(everyEntry.every((value) => Number.isFinite(value))).toBe(true);
  });
});

// CT-227: the async twin runs the exact sync steps (whitening covariance,
// whitened projections, FastICA fixed-point updates), reporting the whitening
// into the first half of the fit window and one tick per fixed-point iteration
// (against the iteration cap) into the second.
describe("fitIcaReportingProgress (CT-227)", () => {
  it("produces a fit identical to the sync fitIca", async () => {
    expect(await fitIcaReportingProgress(MIXED_CUBE, 2)).toEqual(fitIca(MIXED_CUBE, 2));
  });

  it("matches the sync fit on near-Gaussian data where the iteration cap bites", async () => {
    const gaussianCube = makeSampleMatrix([approximatelyGaussianStream(1), approximatelyGaussianStream(98765)]);
    expect(await fitIcaReportingProgress(gaussianCube, 2)).toEqual(fitIca(gaussianCube, 2));
  });

  it("ticks monotonically within 0..1 with whitening ticks then per-iteration ticks", async () => {
    const ticks: number[] = [];
    await fitIcaReportingProgress(MIXED_CUBE, 2, (fraction) => ticks.push(fraction));
    expect(ticks[ticks.length - 1]).toBe(1);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!).toBeGreaterThanOrEqual(ticks[i - 1]!);
    }
    expect(ticks.some((fraction) => fraction <= 0.5)).toBe(true);
    expect(ticks.some((fraction) => fraction > 0.5 && fraction < 1)).toBe(true);
  });
});
