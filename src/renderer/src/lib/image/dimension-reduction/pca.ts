import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";
import { projectMeanCentredSamplesOntoComponentVectors } from "@/lib/image/dimension-reduction/project-samples";
import { buildSquareMatrixInPairChunksReportingProgress } from "@/lib/image/dimension-reduction/square-matrix-progress";
import type { ComponentProjection } from "@/lib/image/dimension-reduction/transform-output";
import { decomposeSymmetricMatrix } from "@/lib/image/dimension-reduction/symmetric-eigen";
import type { UnitProgressCallback } from "@/lib/image/unit-progress";

// CT-181: Principal Component Analysis. fitPca mean-centres the cube, builds the
// band-by-band covariance matrix, and eigendecomposes it (eigenpairs sorted
// descending, so the leading components carry the most variance). applyPca
// re-centres every pixel with the fit means and projects it onto the kept
// eigenvectors. The two are split so CT-182 can fit on an ROI sample matrix yet
// still project the whole cube. Both are pure and operate on the band-major
// CubeSampleMatrix the CT-180 descriptor already extracts.

export interface PcaFit {
  readonly means: ReadonlyArray<number>;
  readonly eigenvalues: ReadonlyArray<number>;
  readonly eigenvectors: ReadonlyArray<ReadonlyArray<number>>;
}

export function fitPca(samples: CubeSampleMatrix, bandCount: number): PcaFit {
  const means = computePerBandMeans(samples, bandCount);
  const covariance = computeBandCovarianceMatrix(samples, means, bandCount);
  return decomposeCovarianceIntoPcaFit(means, covariance);
}

// CT-227: the async twin of fitPca. Identical per-pair covariance math, one
// progress tick and paint yield per band pair so the fit stretch of the phase
// bar advances while the covariance sweeps run.
export async function fitPcaReportingProgress(
  samples: CubeSampleMatrix,
  bandCount: number,
  onProgress?: UnitProgressCallback,
): Promise<PcaFit> {
  const means = computePerBandMeans(samples, bandCount);
  const covariance = await buildSquareMatrixInPairChunksReportingProgress(
    bandCount,
    (row, column) => covarianceBetweenBands(samples, means, row, column),
    onProgress,
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

function computePerBandMeans(samples: CubeSampleMatrix, bandCount: number): number[] {
  return Array.from({ length: bandCount }, (_unused, band) =>
    meanOfBand(samples.bandValues[band]!, samples.sampleCount),
  );
}

function meanOfBand(values: Float64Array, sampleCount: number): number {
  let sum = 0;
  for (let pixel = 0; pixel < sampleCount; pixel += 1) sum += values[pixel]!;
  return sum / Math.max(1, sampleCount);
}

function computeBandCovarianceMatrix(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  bandCount: number,
): number[][] {
  return Array.from({ length: bandCount }, (_unused, row) =>
    Array.from({ length: bandCount }, (_unused2, column) =>
      covarianceBetweenBands(samples, means, row, column),
    ),
  );
}

function covarianceBetweenBands(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  rowBand: number,
  columnBand: number,
): number {
  const rowValues = samples.bandValues[rowBand]!;
  const columnValues = samples.bandValues[columnBand]!;
  let sum = 0;
  for (let pixel = 0; pixel < samples.sampleCount; pixel += 1) {
    sum += (rowValues[pixel]! - means[rowBand]!) * (columnValues[pixel]! - means[columnBand]!);
  }
  return sum / Math.max(1, samples.sampleCount);
}
