import type { RasterTypedArray } from "@/lib/image/raster-image";
import { allocateFloat32ArrayOrThrow } from "@/lib/image/raster-allocation";
import {
  runInChunksReportingProgress,
  scaleProgressToWindow,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

import type { BandSpatialShape } from "./spatial-frequency-filter";

// CT-204: spatial denoising WITHIN each band's picture, entirely in the pixel
// domain (deliberately no FFT dependency). Gaussian denoising is a separable
// convolution with a normalized kernel truncated at three sigma; median
// denoising is a rank filter over a square neighborhood. Both clamp
// neighborhood coordinates to the band's edges, so a flat band passes through
// unchanged.
//
// CT-226: the ...InChunksReportingProgress twins run the SAME row loops in row
// chunks with a paint yield and a progress tick between chunks, so a
// minutes-long band advances the busy bar continuously on the main thread. The
// sync functions and the chunked twins share the row-range workers, so their
// results are identical.

export type DenoiseMethod = "gaussian" | "median";

export type DenoiseSettings =
  | { readonly method: "gaussian"; readonly sigma: number }
  | { readonly method: "median"; readonly radius: number };

// Roughly 2M pixels of kernel work per chunk keeps each main-thread slice in the
// tens-of-milliseconds range at any image width.
const DENOISE_PIXELS_PER_CHUNK = 2_000_000;

export function applyDenoiseToBand(
  band: RasterTypedArray,
  shape: BandSpatialShape,
  settings: DenoiseSettings,
): Float32Array {
  if (settings.method === "median") return applyMedianDenoise(band, shape, settings.radius);
  return applyGaussianDenoise(band, shape, settings.sigma);
}

export async function applyDenoiseToBandInChunksReportingProgress(
  band: RasterTypedArray,
  shape: BandSpatialShape,
  settings: DenoiseSettings,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
  pixelsPerChunk: number = DENOISE_PIXELS_PER_CHUNK,
): Promise<Float32Array> {
  if (settings.method === "median") {
    return applyMedianDenoiseInChunksReportingProgress(band, shape, settings.radius, onProgress, abortSignal, pixelsPerChunk);
  }
  return applyGaussianDenoiseInChunksReportingProgress(band, shape, settings.sigma, onProgress, abortSignal, pixelsPerChunk);
}

export function applyGaussianDenoise(
  band: RasterTypedArray,
  shape: BandSpatialShape,
  sigma: number,
): Float32Array {
  assertBandLengthMatchesShape(band, shape);
  const kernel = buildNormalizedGaussianKernel(sigma);
  const rowsSmoothed = convolveEachRowWithKernel(band, shape, kernel);
  return convolveEachColumnWithKernel(rowsSmoothed, shape, kernel);
}

// The horizontal pass fills the first half of the band's fraction, the vertical
// pass the second half.
export async function applyGaussianDenoiseInChunksReportingProgress(
  band: RasterTypedArray,
  shape: BandSpatialShape,
  sigma: number,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
  pixelsPerChunk: number = DENOISE_PIXELS_PER_CHUNK,
): Promise<Float32Array> {
  assertBandLengthMatchesShape(band, shape);
  const kernel = buildNormalizedGaussianKernel(sigma);
  const rowsSmoothed = allocateFloat32ArrayOrThrow(shape.width * shape.height);
  await runInChunksReportingProgress(
    shape.height,
    denoiseRowsPerChunk(shape, pixelsPerChunk),
    (yStart, yEnd) => convolveRowRangeWithKernel(band, shape, kernel, rowsSmoothed, yStart, yEnd),
    scaleProgressToWindow(onProgress, 0, 0.5),
    abortSignal,
  );
  return convolveColumnsInChunksReportingProgress(rowsSmoothed, shape, kernel, onProgress, abortSignal, pixelsPerChunk);
}

async function convolveColumnsInChunksReportingProgress(
  rowsSmoothed: Float32Array,
  shape: BandSpatialShape,
  kernel: Float64Array,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
  pixelsPerChunk: number = DENOISE_PIXELS_PER_CHUNK,
): Promise<Float32Array> {
  const out = allocateFloat32ArrayOrThrow(shape.width * shape.height);
  await runInChunksReportingProgress(
    shape.height,
    denoiseRowsPerChunk(shape, pixelsPerChunk),
    (yStart, yEnd) => convolveColumnRangeWithKernel(rowsSmoothed, shape, kernel, out, yStart, yEnd),
    scaleProgressToWindow(onProgress, 0.5, 1),
    abortSignal,
  );
  return out;
}

export function applyMedianDenoise(
  band: RasterTypedArray,
  shape: BandSpatialShape,
  radius: number,
): Float32Array {
  assertMedianRadiusIsUsable(radius);
  assertBandLengthMatchesShape(band, shape);
  const out = allocateFloat32ArrayOrThrow(shape.width * shape.height);
  const window = new Float64Array((2 * radius + 1) * (2 * radius + 1));
  medianDenoiseRowRange(band, shape, radius, out, window, 0, shape.height);
  return out;
}

export async function applyMedianDenoiseInChunksReportingProgress(
  band: RasterTypedArray,
  shape: BandSpatialShape,
  radius: number,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
  pixelsPerChunk: number = DENOISE_PIXELS_PER_CHUNK,
): Promise<Float32Array> {
  assertMedianRadiusIsUsable(radius);
  assertBandLengthMatchesShape(band, shape);
  const out = allocateFloat32ArrayOrThrow(shape.width * shape.height);
  const window = new Float64Array((2 * radius + 1) * (2 * radius + 1));
  await runInChunksReportingProgress(
    shape.height,
    denoiseRowsPerChunk(shape, pixelsPerChunk),
    (yStart, yEnd) => medianDenoiseRowRange(band, shape, radius, out, window, yStart, yEnd),
    onProgress,
    abortSignal,
  );
  return out;
}

function denoiseRowsPerChunk(shape: BandSpatialShape, pixelsPerChunk: number): number {
  return Math.max(1, Math.floor(pixelsPerChunk / Math.max(1, shape.width)));
}

function medianDenoiseRowRange(
  band: RasterTypedArray,
  shape: BandSpatialShape,
  radius: number,
  out: Float32Array,
  window: Float64Array,
  yStart: number,
  yEnd: number,
): void {
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = 0; x < shape.width; x += 1) {
      out[y * shape.width + x] = medianOfClampedSquareNeighborhood(band, shape, x, y, radius, window);
    }
  }
}

// Truncating at three sigma keeps > 99.7% of the ideal kernel's mass; the
// renormalization makes the weights sum to exactly 1, so a flat band keeps its
// exact value through the convolution.
export function buildNormalizedGaussianKernel(sigma: number): Float64Array {
  assertGaussianSigmaIsUsable(sigma);
  const radius = Math.ceil(3 * sigma);
  const kernel = new Float64Array(2 * radius + 1);
  for (let offset = -radius; offset <= radius; offset += 1) {
    kernel[offset + radius] = Math.exp(-(offset * offset) / (2 * sigma * sigma));
  }
  return divideKernelBySum(kernel);
}

function divideKernelBySum(kernel: Float64Array): Float64Array {
  let sum = 0;
  for (const weight of kernel) sum += weight;
  for (let index = 0; index < kernel.length; index += 1) {
    kernel[index] = (kernel[index] ?? 0) / sum;
  }
  return kernel;
}

function convolveEachRowWithKernel(
  band: ArrayLike<number>,
  shape: BandSpatialShape,
  kernel: Float64Array,
): Float32Array {
  const out = allocateFloat32ArrayOrThrow(shape.width * shape.height);
  convolveRowRangeWithKernel(band, shape, kernel, out, 0, shape.height);
  return out;
}

function convolveEachColumnWithKernel(
  band: ArrayLike<number>,
  shape: BandSpatialShape,
  kernel: Float64Array,
): Float32Array {
  const out = allocateFloat32ArrayOrThrow(shape.width * shape.height);
  convolveColumnRangeWithKernel(band, shape, kernel, out, 0, shape.height);
  return out;
}

function convolveRowRangeWithKernel(
  band: ArrayLike<number>,
  shape: BandSpatialShape,
  kernel: Float64Array,
  out: Float32Array,
  yStart: number,
  yEnd: number,
): void {
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = 0; x < shape.width; x += 1) {
      out[y * shape.width + x] = convolveAlongClampedLine(band, y * shape.width, 1, shape.width, x, kernel);
    }
  }
}

function convolveColumnRangeWithKernel(
  band: ArrayLike<number>,
  shape: BandSpatialShape,
  kernel: Float64Array,
  out: Float32Array,
  yStart: number,
  yEnd: number,
): void {
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = 0; x < shape.width; x += 1) {
      out[y * shape.width + x] = convolveAlongClampedLine(band, x, shape.width, shape.height, y, kernel);
    }
  }
}

function convolveAlongClampedLine(
  values: ArrayLike<number>,
  lineStart: number,
  stride: number,
  lineLength: number,
  position: number,
  kernel: Float64Array,
): number {
  const radius = (kernel.length - 1) / 2;
  let sum = 0;
  for (let tap = 0; tap < kernel.length; tap += 1) {
    const sampled = clampIndexIntoRange(position + tap - radius, lineLength);
    sum += (kernel[tap] ?? 0) * (values[lineStart + sampled * stride] ?? 0);
  }
  return sum;
}

// The clamped window always holds the full odd-sized square, so the median is
// the exact middle of the sorted window (no interpolation).
function medianOfClampedSquareNeighborhood(
  band: RasterTypedArray,
  shape: BandSpatialShape,
  centerX: number,
  centerY: number,
  radius: number,
  window: Float64Array,
): number {
  const count = fillWindowWithClampedNeighborhood(band, shape, centerX, centerY, radius, window);
  const sorted = window.subarray(0, count).sort();
  return sorted[(count - 1) / 2] ?? 0;
}

function fillWindowWithClampedNeighborhood(
  band: RasterTypedArray,
  shape: BandSpatialShape,
  centerX: number,
  centerY: number,
  radius: number,
  window: Float64Array,
): number {
  let count = 0;
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    const y = clampIndexIntoRange(centerY + offsetY, shape.height);
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const x = clampIndexIntoRange(centerX + offsetX, shape.width);
      window[count] = band[y * shape.width + x] ?? 0;
      count += 1;
    }
  }
  return count;
}

function clampIndexIntoRange(index: number, size: number): number {
  if (index < 0) return 0;
  if (index >= size) return size - 1;
  return index;
}

function assertGaussianSigmaIsUsable(sigma: number): void {
  if (Number.isFinite(sigma) && sigma > 0) return;
  throw new Error("Denoise sigma must be a number greater than 0.");
}

function assertMedianRadiusIsUsable(radius: number): void {
  if (Number.isInteger(radius) && radius >= 1) return;
  throw new Error("Denoise radius must be a whole number of 1 or higher.");
}

function assertBandLengthMatchesShape(band: RasterTypedArray, shape: BandSpatialShape): void {
  if (band.length === shape.width * shape.height) return;
  throw new Error(
    `Denoise band has ${band.length} values but the stack shape is ` +
      `${shape.width} x ${shape.height}`,
  );
}
