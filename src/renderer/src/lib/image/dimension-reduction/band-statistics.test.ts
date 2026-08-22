import { describe, expect, it } from "vitest";

import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";
import { OperationStoppedError } from "@/lib/image/operation-stop";
import type { RasterTypedArray } from "@/lib/image/raster-image";

import {
  computeBandCovarianceMatrixFromMeans,
  computeBandCovarianceMatrixFromMeansReportingProgress,
  computePerBandMeans,
  covarianceBetweenCentredBands,
} from "./band-statistics";

// A 7-band cube exercises both kernel paths of the CT-270 blocked builder:
// row 0 sweeps one full 4-column block plus a 3-column remainder. The odd
// sample count and pseudo-random values leave no accidental symmetry.
const BAND_COUNT = 7;
const SAMPLE_COUNT = 103;

function pseudoRandomValue(band: number, pixel: number): number {
  return ((band + 1) * 7919 + pixel * 104729 + ((pixel * pixel) % 251)) % 1024;
}

function makePseudoRandomCube(
  makeBand: (values: number[]) => RasterTypedArray,
): CubeSampleMatrix {
  const bandValues = Array.from({ length: BAND_COUNT }, (_unused, band) =>
    makeBand(Array.from({ length: SAMPLE_COUNT }, (_unused2, pixel) => pseudoRandomValue(band, pixel))),
  );
  return { bandCount: BAND_COUNT, sampleCount: SAMPLE_COUNT, width: SAMPLE_COUNT, height: 1, bandValues };
}

// The pre-CT-270 covariance matrix: one independent per-pair sweep per cell
// through the reference kernel. The blocked builder must reproduce it
// bit-identically (same per-cell accumulation order, so exact toEqual).
function buildCovarianceMatrixOnePairAtATime(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
): number[][] {
  return Array.from({ length: samples.bandCount }, (_unused, row) =>
    Array.from({ length: samples.bandCount }, (_unused2, column) =>
      covarianceBetweenCentredBands(
        samples.bandValues[row]!,
        samples.bandValues[column]!,
        means[row]!,
        means[column]!,
        samples.sampleCount,
      ),
    ),
  );
}

describe("computeBandCovarianceMatrixFromMeans (CT-270)", () => {
  it("is bit-identical to the per-pair reference kernel over uint16 storage", () => {
    const cube = makePseudoRandomCube((values) => Uint16Array.from(values));
    const means = computePerBandMeans(cube, cube.bandCount);
    expect(computeBandCovarianceMatrixFromMeans(cube, means)).toEqual(
      buildCovarianceMatrixOnePairAtATime(cube, means),
    );
  });

  it("is bit-identical to the per-pair reference kernel over float64 storage", () => {
    const cube = makePseudoRandomCube((values) => Float64Array.from(values));
    const means = computePerBandMeans(cube, cube.bandCount);
    expect(computeBandCovarianceMatrixFromMeans(cube, means)).toEqual(
      buildCovarianceMatrixOnePairAtATime(cube, means),
    );
  });

  it("handles a single-band cube", () => {
    const cube: CubeSampleMatrix = {
      bandCount: 1,
      sampleCount: 4,
      width: 4,
      height: 1,
      bandValues: [Float64Array.from([1, 3, 5, 7])],
    };
    const means = computePerBandMeans(cube, 1);
    expect(computeBandCovarianceMatrixFromMeans(cube, means)).toEqual([[5]]);
  });
});

describe("computeBandCovarianceMatrixFromMeansReportingProgress (CT-270)", () => {
  it("matches the sync builder exactly", async () => {
    const cube = makePseudoRandomCube((values) => Uint16Array.from(values));
    const means = computePerBandMeans(cube, cube.bandCount);
    expect(await computeBandCovarianceMatrixFromMeansReportingProgress(cube, means)).toEqual(
      computeBandCovarianceMatrixFromMeans(cube, means),
    );
  });

  it("ticks monotonically per row band, ending at exactly 1", async () => {
    const cube = makePseudoRandomCube((values) => Uint16Array.from(values));
    const means = computePerBandMeans(cube, cube.bandCount);
    const ticks: number[] = [];
    await computeBandCovarianceMatrixFromMeansReportingProgress(cube, means, (fraction) =>
      ticks.push(fraction),
    );
    expect(ticks.length).toBeGreaterThanOrEqual(BAND_COUNT);
    expect(ticks[ticks.length - 1]).toBe(1);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!).toBeGreaterThanOrEqual(ticks[i - 1]!);
    }
    expect(ticks.some((fraction) => fraction > 0 && fraction < 1)).toBe(true);
  });

  it("cancels at the next chunk boundary when the abort signal fires", async () => {
    const cube = makePseudoRandomCube((values) => Uint16Array.from(values));
    const means = computePerBandMeans(cube, cube.bandCount);
    const controller = new AbortController();
    const build = computeBandCovarianceMatrixFromMeansReportingProgress(
      cube,
      means,
      () => controller.abort(),
      controller.signal,
    );
    await expect(build).rejects.toBeInstanceOf(OperationStoppedError);
  });
});
