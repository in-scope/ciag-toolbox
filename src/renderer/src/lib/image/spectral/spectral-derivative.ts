import { makeFloat32RasterFromBands } from "@/lib/image/make-float-raster";
import { allocateFloat32ArrayOrThrow } from "@/lib/image/raster-allocation";
import {
  computeArrayReportingPerUnitProgress,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";
import {
  getRasterBandLabelOrDefault,
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";

// CT-202: the spectral derivative differences the cube along the band /
// wavelength axis. First order is the forward difference between adjacent
// bands (band k+1 minus band k), second order is the difference of those
// differences, so an N-band stack yields N - order derivative bands. The
// output is float32 via the Stage 3 float path (CT-077) and keeps the
// source's spatial dimensions.

export type SpectralDerivativeOrder = 1 | 2;

export const FIRST_ORDER_SPECTRAL_DERIVATIVE: SpectralDerivativeOrder = 1;
export const SECOND_ORDER_SPECTRAL_DERIVATIVE: SpectralDerivativeOrder = 2;
export const DEFAULT_SPECTRAL_DERIVATIVE_ORDER = FIRST_ORDER_SPECTRAL_DERIVATIVE;

export function computeSpectralDerivative(
  cube: RasterImage,
  order: SpectralDerivativeOrder = DEFAULT_SPECTRAL_DERIVATIVE_ORDER,
): RasterImage {
  assertCubeHasEnoughBandsForSpectralDerivativeOrder(cube, order);
  const shape = {
    width: cube.width,
    height: cube.height,
    bandLabels: buildSpectralDerivativeBandLabels(cube, order),
  };
  return makeFloat32RasterFromBands(shape, computeDerivativeBandsForOrder(cube, order));
}

// CT-222: the async twin of computeSpectralDerivative. Identical per-band math,
// one progress tick per OUTPUT derivative band.
export async function computeSpectralDerivativeReportingProgress(
  cube: RasterImage,
  order: SpectralDerivativeOrder = DEFAULT_SPECTRAL_DERIVATIVE_ORDER,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<RasterImage> {
  assertCubeHasEnoughBandsForSpectralDerivativeOrder(cube, order);
  const shape = {
    width: cube.width,
    height: cube.height,
    bandLabels: buildSpectralDerivativeBandLabels(cube, order),
  };
  const bands = await computeArrayReportingPerUnitProgress(
    cube.bandCount - order,
    (bandIndex) => computeSingleDerivativeBand(cube, order, bandIndex),
    onProgress,
    abortSignal,
  );
  return makeFloat32RasterFromBands(shape, bands);
}

function computeSingleDerivativeBand(
  cube: RasterImage,
  order: SpectralDerivativeOrder,
  bandIndex: number,
): Float32Array {
  if (order === SECOND_ORDER_SPECTRAL_DERIVATIVE) {
    return secondDifferenceAroundCenterBand(
      getRasterBandPixelsOrThrow(cube, bandIndex),
      getRasterBandPixelsOrThrow(cube, bandIndex + 1),
      getRasterBandPixelsOrThrow(cube, bandIndex + 2),
    );
  }
  return subtractAdjacentBands(
    getRasterBandPixelsOrThrow(cube, bandIndex + 1),
    getRasterBandPixelsOrThrow(cube, bandIndex),
  );
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

function computeDerivativeBandsForOrder(
  cube: RasterImage,
  order: SpectralDerivativeOrder,
): Float32Array[] {
  if (order === SECOND_ORDER_SPECTRAL_DERIVATIVE) return computeSecondOrderDifferenceBands(cube);
  return computeFirstOrderDifferenceBands(cube);
}

function computeFirstOrderDifferenceBands(cube: RasterImage): Float32Array[] {
  return Array.from({ length: cube.bandCount - 1 }, (_unused, bandIndex) =>
    subtractAdjacentBands(
      getRasterBandPixelsOrThrow(cube, bandIndex + 1),
      getRasterBandPixelsOrThrow(cube, bandIndex),
    ),
  );
}

function computeSecondOrderDifferenceBands(cube: RasterImage): Float32Array[] {
  return Array.from({ length: cube.bandCount - 2 }, (_unused, bandIndex) =>
    secondDifferenceAroundCenterBand(
      getRasterBandPixelsOrThrow(cube, bandIndex),
      getRasterBandPixelsOrThrow(cube, bandIndex + 1),
      getRasterBandPixelsOrThrow(cube, bandIndex + 2),
    ),
  );
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

function buildSpectralDerivativeBandLabels(
  cube: RasterImage,
  order: SpectralDerivativeOrder,
): string[] {
  if (order === SECOND_ORDER_SPECTRAL_DERIVATIVE) return buildSecondOrderBandLabels(cube);
  return buildFirstOrderBandLabels(cube);
}

function buildFirstOrderBandLabels(cube: RasterImage): string[] {
  return Array.from({ length: cube.bandCount - 1 }, (_unused, bandIndex) => {
    const next = getRasterBandLabelOrDefault(cube, bandIndex + 1);
    const current = getRasterBandLabelOrDefault(cube, bandIndex);
    return `d(${next} - ${current})`;
  });
}

function buildSecondOrderBandLabels(cube: RasterImage): string[] {
  return Array.from(
    { length: cube.bandCount - 2 },
    (_unused, bandIndex) => `d2(${getRasterBandLabelOrDefault(cube, bandIndex + 1)})`,
  );
}
