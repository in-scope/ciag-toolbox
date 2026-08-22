import {
  computeBandCovarianceMatrixFromMeans,
  computeBandCovarianceMatrixFromMeansReportingProgress,
  computePerBandMeans,
  computePerBandMeansReportingProgress,
} from "@/lib/image/dimension-reduction/band-statistics";
import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";
import { projectMeanCentredSamplesOntoComponentVectors } from "@/lib/image/dimension-reduction/project-samples";
import type { ComponentProjection } from "@/lib/image/dimension-reduction/transform-output";
import { decomposeSymmetricMatrix } from "@/lib/image/dimension-reduction/symmetric-eigen";
import { scaleProgressToWindow, type UnitProgressCallback } from "@/lib/image/unit-progress";

// CT-181: Principal Component Analysis. fitPca computes per-band means, builds
// the band-by-band covariance matrix, and eigendecomposes it (eigenpairs sorted
// descending, so the leading components carry the most variance). applyPca
// re-centres every pixel with the fit means and projects it onto the kept
// eigenvectors. The two are split so CT-182 can fit on an ROI sample matrix yet
// still project the whole cube. Both are pure and operate on the band-major
// CubeSampleMatrix, which (CT-240) aliases the raster's own band arrays - the
// fit statistics stream from the original typed arrays with no cube copy.

export interface PcaFit {
  readonly means: ReadonlyArray<number>;
  readonly eigenvalues: ReadonlyArray<number>;
  readonly eigenvectors: ReadonlyArray<ReadonlyArray<number>>;
}

export function fitPca(samples: CubeSampleMatrix, bandCount: number): PcaFit {
  const means = computePerBandMeans(samples, bandCount);
  const covariance = computeBandCovarianceMatrixFromMeans(samples, means);
  return decomposeCovarianceIntoPcaFit(means, covariance);
}

// CT-227: the async twin of fitPca. Identical covariance math; the means sweep
// ticks per band and the CT-270 blocked covariance build (each unordered pair
// computed once and mirrored, bit-identical to the full square) ticks per row
// band, with paint yields throughout.
const PCA_MEANS_END_FRACTION = 0.08;

export async function fitPcaReportingProgress(
  samples: CubeSampleMatrix,
  bandCount: number,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<PcaFit> {
  const means = await computePerBandMeansReportingProgress(
    samples,
    bandCount,
    scaleProgressToWindow(onProgress, 0, PCA_MEANS_END_FRACTION),
    abortSignal,
  );
  const covariance = await computeBandCovarianceMatrixFromMeansReportingProgress(
    samples,
    means,
    scaleProgressToWindow(onProgress, PCA_MEANS_END_FRACTION, 1),
    abortSignal,
  );
  return decomposeCovarianceIntoPcaFit(means, covariance);
}

function decomposeCovarianceIntoPcaFit(
  means: ReadonlyArray<number>,
  covariance: ReadonlyArray<ReadonlyArray<number>>,
): PcaFit {
  const decomposition = decomposeSymmetricMatrix(covariance);
  return { means, eigenvalues: decomposition.eigenvalues, eigenvectors: decomposition.eigenvectors };
}

export function applyPca(
  samples: CubeSampleMatrix,
  fit: PcaFit,
  keep: number,
): ComponentProjection {
  return projectMeanCentredSamplesOntoComponentVectors(samples, fit.means, fit.eigenvectors, keep);
}

export function varianceExplained(eigenvalues: ReadonlyArray<number>): number[] {
  const total = eigenvalues.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return eigenvalues.map(() => 0);
  return eigenvalues.map((value) => value / total);
}

