import {
  makeFloat32RasterFromBands,
  type Float32RasterShape,
} from "@/lib/image/make-float-raster";
import { allocateFloat32ArrayOrThrow } from "@/lib/image/raster-allocation";
import {
  computeArrayReportingPerUnitProgress,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";
import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";

// CT-202 / CT-285: the spectral derivative differences the cube along the band /
// wavelength axis and KEEPS the source band count, so output band k stays
// aligned with input band k's wavelength (chemical peaks are found at known
// wavelengths). The locked edge scheme: first order is the forward difference
// (band k+1 minus band k) with a one-sided backward difference for the last
// band; second order is the centered second difference for interior bands with
// one-sided second-order differences at both edges. Wavelengths and band labels
// carry through one-to-one. The output is float32 via the Stage 3 float path
// (CT-077) and keeps the source's spatial dimensions.

export type SpectralDerivativeOrder = 1 | 2;

export const FIRST_ORDER_SPECTRAL_DERIVATIVE: SpectralDerivativeOrder = 1;
export const SECOND_ORDER_SPECTRAL_DERIVATIVE: SpectralDerivativeOrder = 2;
export const DEFAULT_SPECTRAL_DERIVATIVE_ORDER = FIRST_ORDER_SPECTRAL_DERIVATIVE;

export function computeSpectralDerivative(
  cube: RasterImage,
  order: SpectralDerivativeOrder = DEFAULT_SPECTRAL_DERIVATIVE_ORDER,
): RasterImage {
  assertCubeHasEnoughBandsForSpectralDerivativeOrder(cube, order);
  const bands = Array.from({ length: cube.bandCount }, (_unused, bandIndex) =>
    computeSingleDerivativeBand(cube, order, bandIndex),
  );
  return makeFloat32RasterFromBands(buildOutputShapeCarryingSourceBandMetadata(cube), bands);
}

// CT-222: the async twin of computeSpectralDerivative. Identical per-band math,
// one progress tick per output band.
export async function computeSpectralDerivativeReportingProgress(
  cube: RasterImage,
  order: SpectralDerivativeOrder = DEFAULT_SPECTRAL_DERIVATIVE_ORDER,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<RasterImage> {
  assertCubeHasEnoughBandsForSpectralDerivativeOrder(cube, order);
  const bands = await computeArrayReportingPerUnitProgress(
    cube.bandCount,
    (bandIndex) => computeSingleDerivativeBand(cube, order, bandIndex),
    onProgress,
    abortSignal,
  );
  return makeFloat32RasterFromBands(buildOutputShapeCarryingSourceBandMetadata(cube), bands);
}

function computeSingleDerivativeBand(
  cube: RasterImage,
  order: SpectralDerivativeOrder,
  bandIndex: number,
): Float32Array {
  if (order === SECOND_ORDER_SPECTRAL_DERIVATIVE) {
    return computeSecondOrderDerivativeBand(cube, bandIndex);
  }
  return computeFirstOrderDerivativeBand(cube, bandIndex);
}

// Forward difference for every band except the last, which takes the one-sided
// backward difference (band N-1 minus band N-2) so the output keeps N bands.
function computeFirstOrderDerivativeBand(cube: RasterImage, bandIndex: number): Float32Array {
  const differencedIndex = Math.min(bandIndex, cube.bandCount - 2);
  return subtractAdjacentBands(
    getRasterBandPixelsOrThrow(cube, differencedIndex + 1),
    getRasterBandPixelsOrThrow(cube, differencedIndex),
  );
}

// Centered second difference around the band; both edge bands take the
// one-sided second-order difference, which equals the centered difference
// around their nearest interior neighbour.
function computeSecondOrderDerivativeBand(cube: RasterImage, bandIndex: number): Float32Array {
  const centerIndex = clampToInteriorBandIndex(bandIndex, cube.bandCount);
  return secondDifferenceAroundCenterBand(
    getRasterBandPixelsOrThrow(cube, centerIndex - 1),
    getRasterBandPixelsOrThrow(cube, centerIndex),
    getRasterBandPixelsOrThrow(cube, centerIndex + 1),
  );
}

function clampToInteriorBandIndex(bandIndex: number, bandCount: number): number {
  return Math.min(Math.max(bandIndex, 1), bandCount - 2);
}

export function assertCubeHasEnoughBandsForSpectralDerivativeOrder(
  cube: RasterImage,
  order: SpectralDerivativeOrder,
): void {
  const requiredBandCount = order + 1;
  if (cube.bandCount >= requiredBandCount) return;
  throw new Error(
    `The ${describeSpectralDerivativeOrder(order)} spectral derivative needs a stack with ` +
      `at least ${requiredBandCount} bands; this stack has ${cube.bandCount}.`,
  );
}

export function describeSpectralDerivativeOrder(order: SpectralDerivativeOrder): string {
  return order === SECOND_ORDER_SPECTRAL_DERIVATIVE ? "2nd order" : "1st order";
}

function subtractAdjacentBands(
  nextBand: RasterTypedArray,
  currentBand: RasterTypedArray,
): Float32Array {
  const out = allocateFloat32ArrayOrThrow(currentBand.length);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = (nextBand[i] ?? 0) - (currentBand[i] ?? 0);
  }
  return out;
}

function secondDifferenceAroundCenterBand(
  previousBand: RasterTypedArray,
  centerBand: RasterTypedArray,
  nextBand: RasterTypedArray,
): Float32Array {
  const out = allocateFloat32ArrayOrThrow(centerBand.length);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = (nextBand[i] ?? 0) - 2 * (centerBand[i] ?? 0) + (previousBand[i] ?? 0);
  }
  return out;
}

function buildOutputShapeCarryingSourceBandMetadata(cube: RasterImage): Float32RasterShape {
  return {
    width: cube.width,
    height: cube.height,
    bandLabels: cube.bandLabels,
    bandWavelengths: cube.bandWavelengths,
  };
}
