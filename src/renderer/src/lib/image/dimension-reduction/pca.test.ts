import { describe, expect, it } from "vitest";

import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";
import { OperationStoppedError } from "@/lib/image/operation-stop";

import { applyPca, fitPca, fitPcaReportingProgress, varianceExplained } from "./pca";

function makeSampleMatrix(bands: ReadonlyArray<ReadonlyArray<number>>): CubeSampleMatrix {
  const bandValues = bands.map((band) => Float64Array.from(band));
  const sampleCount = bands[0]!.length;
  return { bandCount: bands.length, sampleCount, width: sampleCount, height: 1, bandValues };
}

function dotProduct(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  return a.reduce((sum, value, index) => sum + value * b[index]!, 0);
}

// A two-band cube whose second band is exactly twice the first: all variance lies
// along the (1, 2) axis, so PC1 must point there and PC2 must be orthogonal with
// (near) zero variance.
const DOMINANT_AXIS_CUBE = makeSampleMatrix([
  [0, 1, 2, 3, 4, 5],
  [0, 2, 4, 6, 8, 10],
]);

describe("fitPca", () => {
  it("orders components by descending eigenvalue (variance)", () => {
    const fit = fitPca(DOMINANT_AXIS_CUBE, 2);
    expect(fit.eigenvalues[0]!).toBeGreaterThan(fit.eigenvalues[1]!);
  });

  it("points the leading component along the known dominant axis", () => {
    const fit = fitPca(DOMINANT_AXIS_CUBE, 2);
    const [first, second] = fit.eigenvectors[0]!;
    expect(Math.abs(second! / first!)).toBeCloseTo(2, 5);
  });

  it("returns orthonormal eigenvectors", () => {
    const fit = fitPca(DOMINANT_AXIS_CUBE, 2);
    expect(dotProduct(fit.eigenvectors[0]!, fit.eigenvectors[1]!)).toBeCloseTo(0, 6);
    expect(dotProduct(fit.eigenvectors[0]!, fit.eigenvectors[0]!)).toBeCloseTo(1, 6);
  });

  it("mean-centres each band", () => {
    const fit = fitPca(DOMINANT_AXIS_CUBE, 2);
    expect(fit.means).toEqual([2.5, 5]);
  });

  // CT-240: the sample matrix aliases the raster's own typed arrays, so the fit
  // must read integer storage to the exact same float64 values a copy held.
  it("fits identically over uint16 storage and a float64 copy of the same values", () => {
    const bands = [
      [600, 601, 699, 700, 799, 601],
      [1200, 1202, 1398, 1400, 1598, 1202],
    ];
    const uint16Matrix: CubeSampleMatrix = {
      ...makeSampleMatrix(bands),
      bandValues: bands.map((band) => Uint16Array.from(band)),
    };
    expect(fitPca(uint16Matrix, 2)).toEqual(fitPca(makeSampleMatrix(bands), 2));
  });
});

// CT-227 / CT-240: the async twin shares the sync fit's per-pair covariance
// math exactly (the symmetric builder mirrors each unordered pair, which is
// bit-identical to the full square) and reports per-band means ticks followed
// by one tick per upper-triangle band pair.
describe("fitPcaReportingProgress (CT-227)", () => {
  it("produces a fit identical to the sync fitPca", async () => {
    expect(await fitPcaReportingProgress(DOMINANT_AXIS_CUBE, 2)).toEqual(fitPca(DOMINANT_AXIS_CUBE, 2));
  });

  it("ticks monotonically within 0..1, ending at exactly 1", async () => {
    const ticks: number[] = [];
    await fitPcaReportingProgress(DOMINANT_AXIS_CUBE, 2, (fraction) => ticks.push(fraction));
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks[ticks.length - 1]).toBe(1);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!).toBeGreaterThanOrEqual(ticks[i - 1]!);
    }
  });

  it("works without a progress callback", async () => {
    const fit = await fitPcaReportingProgress(DOMINANT_AXIS_CUBE, 2);
    expect(fit.eigenvalues[0]!).toBeGreaterThan(fit.eigenvalues[1]!);
  });

  // CT-268: the abort signal reaches the fit's inner chunk loops, so a Stop
  // clicked mid-fit ends the run at the next chunk boundary.
  it("cancels mid-fit when the abort signal fires during a progress tick", async () => {
    const controller = new AbortController();
    const fit = fitPcaReportingProgress(
      DOMINANT_AXIS_CUBE,
      2,
      () => controller.abort(),
      controller.signal,
    );
    await expect(fit).rejects.toBeInstanceOf(OperationStoppedError);
  });
});

describe("applyPca", () => {
  it("projects onto the kept components, keeping only the requested count", () => {
    const fit = fitPca(DOMINANT_AXIS_CUBE, 2);
    const projection = applyPca(DOMINANT_AXIS_CUBE, fit, 1);
    expect(projection).toHaveLength(1);
    expect(projection[0]!.length).toBe(DOMINANT_AXIS_CUBE.sampleCount);
  });

  it("carries real variance into PC1 while the orthogonal PC2 collapses to ~0", () => {
    const fit = fitPca(DOMINANT_AXIS_CUBE, 2);
    const [pc1, pc2] = applyPca(DOMINANT_AXIS_CUBE, fit, 2);
    expect(Math.max(...Array.from(pc1!).map(Math.abs))).toBeGreaterThan(1);
    expect(Math.max(...Array.from(pc2!).map(Math.abs))).toBeLessThan(1e-6);
  });

  it("centres with the fit means: a sample equal to the mean projects to zero", () => {
    const fit = fitPca(DOMINANT_AXIS_CUBE, 2);
    const meanSample = makeSampleMatrix([[2.5], [5]]);
    const [pc1] = applyPca(meanSample, fit, 1);
    expect(pc1![0]!).toBeCloseTo(0, 6);
  });
});

describe("varianceExplained", () => {
  it("sums to 1 across all components", () => {
    const ratios = varianceExplained([8, 1, 1]);
    expect(ratios.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);
  });

  it("is descending when eigenvalues are descending", () => {
    const ratios = varianceExplained([8, 1, 1]);
    expect(ratios[0]!).toBeGreaterThanOrEqual(ratios[1]!);
    expect(ratios[1]!).toBeGreaterThanOrEqual(ratios[2]!);
  });

  it("returns the fraction of total variance per component", () => {
    expect(varianceExplained([3, 1])).toEqual([0.75, 0.25]);
  });

  it("returns zeros when the total variance is zero", () => {
    expect(varianceExplained([0, 0])).toEqual([0, 0]);
  });
});
