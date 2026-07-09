import type { RasterTypedArray } from "@/lib/image/raster-image";

import {
  butterworthBandpassGain,
  butterworthHighpassGain,
  butterworthLowpassGain,
} from "./butterworth";
import {
  fft2dInPlace,
  inverseFft2dInPlace,
  smallestSupportedFftLengthAtLeast,
  type ComplexGrid,
  type FftLineBuffer,
} from "./fft";

// CT-203: spatial frequency filtering WITHIN each band's picture (never across
// the wavelength axis). The band is mirror-padded up to FFT-supported
// dimensions, transformed with the pure-TS 2D FFT, multiplied by a Butterworth
// transfer function over the radial spatial frequency, inverse-transformed,
// and cropped back. Mirror padding avoids the hard wrap-around edge a zero pad
// would introduce at the image border.
//
// CT-219a: the padded working grid is the filter's dominant allocation (two
// contiguous buffers at padded dimensions). The grid is float32 (the output is
// float32 anyway; the FFT round-trip error is far below what survives the cast
// back), a single grid is reused across bands via
// createReusableSpatialFilterGrid, and an oversized stack is rejected up front
// with a clear error instead of the engine's raw "Array buffer allocation
// failed".
//
// CT-224: padding targets the smallest 2/3/5-smooth size at or above each
// dimension (the mixed-radix FFT handles those lengths), not the next power of
// two. Real captures sit just above a power of two, so this routinely quarters
// the grid: an 11608 x 8708 band pads to 11664 x 8748 (~779 MB) instead of
// 16384 x 16384 (2048 MB), bringing it back under the 1 GiB pre-flight limit.

export type SpatialFrequencyFilterMode = "lowpass" | "highpass" | "bandpass";

export type SpatialFrequencyFilterSettings =
  | { readonly mode: "lowpass"; readonly cutoff: number }
  | { readonly mode: "highpass"; readonly cutoff: number }
  | { readonly mode: "bandpass"; readonly lowCutoff: number; readonly highCutoff: number };

export interface BandSpatialShape {
  readonly width: number;
  readonly height: number;
}

export const SPATIAL_FILTER_GRID_BYTE_LIMIT = 1024 * 1024 * 1024;

const COMPLEX_GRID_BYTES_PER_PADDED_PIXEL = Float32Array.BYTES_PER_ELEMENT * 2;

export function estimateSpatialFilterGridBytes(shape: BandSpatialShape): number {
  const paddedWidth = smallestSupportedFftLengthAtLeast(shape.width);
  const paddedHeight = smallestSupportedFftLengthAtLeast(shape.height);
  return paddedWidth * paddedHeight * COMPLEX_GRID_BYTES_PER_PADDED_PIXEL;
}

export function assertShapeFitsSpatialFilterGrid(shape: BandSpatialShape): void {
  const gridBytes = estimateSpatialFilterGridBytes(shape);
  if (gridBytes <= SPATIAL_FILTER_GRID_BYTE_LIMIT) return;
  throw new Error(buildStackTooLargeForSpatialFilterMessage(shape, gridBytes));
}

function buildStackTooLargeForSpatialFilterMessage(
  shape: BandSpatialShape,
  gridBytes: number,
): string {
  const neededMegabytes = Math.ceil(gridBytes / (1024 * 1024));
  const limitMegabytes = SPATIAL_FILTER_GRID_BYTE_LIMIT / (1024 * 1024);
  return (
    `This stack is too large for the spatial filter: each ${shape.width} x ${shape.height} ` +
    `band needs a ${neededMegabytes} MB working grid and the limit is ${limitMegabytes} MB. ` +
    `Crop the stack to a smaller region and try again.`
  );
}

// One reusable working grid for a run over many bands: the two padded buffers
// are allocated once and rewritten per band, so a whole-stack filter no longer
// re-requests huge contiguous allocations under mounting fragmentation.
export interface ReusableSpatialFilterGrid {
  readonly filterBand: (
    band: RasterTypedArray,
    shape: BandSpatialShape,
    settings: SpatialFrequencyFilterSettings,
  ) => Float32Array;
}

export function createReusableSpatialFilterGrid(): ReusableSpatialFilterGrid {
  const held: { grid: ComplexGrid | null } = { grid: null };
  return {
    filterBand: (band, shape, settings) => filterBandReusingHeldGrid(held, band, shape, settings),
  };
}

export function applySpatialFrequencyFilterToBand(
  band: RasterTypedArray,
  shape: BandSpatialShape,
  settings: SpatialFrequencyFilterSettings,
): Float32Array {
  return createReusableSpatialFilterGrid().filterBand(band, shape, settings);
}

function filterBandReusingHeldGrid(
  held: { grid: ComplexGrid | null },
  band: RasterTypedArray,
  shape: BandSpatialShape,
  settings: SpatialFrequencyFilterSettings,
): Float32Array {
  assertShapeFitsSpatialFilterGrid(shape);
  assertGainIsComputableForSettings(settings);
  assertBandLengthMatchesShape(band, shape);
  held.grid = obtainGridMatchingPaddedShape(held.grid, shape);
  fillGridByMirrorPaddingBand(held.grid, band, shape);
  fft2dInPlace(held.grid);
  multiplyGridByButterworthTransfer(held.grid, settings);
  inverseFft2dInPlace(held.grid);
  return cropGridRealPartToShape(held.grid, shape);
}

function obtainGridMatchingPaddedShape(
  previous: ComplexGrid | null,
  shape: BandSpatialShape,
): ComplexGrid {
  const width = smallestSupportedFftLengthAtLeast(shape.width);
  const height = smallestSupportedFftLengthAtLeast(shape.height);
  if (previous && previous.width === width && previous.height === height) return previous;
  return allocateComplexGridOrThrowOutOfMemory(width, height);
}

function allocateComplexGridOrThrowOutOfMemory(width: number, height: number): ComplexGrid {
  try {
    return {
      real: new Float32Array(width * height),
      imag: new Float32Array(width * height),
      width,
      height,
    };
  } catch {
    throw buildSpatialFilterOutOfMemoryError(width, height);
  }
}

function buildSpatialFilterOutOfMemoryError(width: number, height: number): Error {
  const megabytes = Math.ceil((width * height * COMPLEX_GRID_BYTES_PER_PADDED_PIXEL) / (1024 * 1024));
  return new Error(
    `Not enough memory for the spatial filter's ${megabytes} MB working grid. ` +
      `Close other panels or crop the stack to a smaller region and try again.`,
  );
}

// Bin k of an N-point FFT holds the spatial frequency min(k, N - k) / N in
// cycles per pixel (the upper half of the spectrum mirrors negative
// frequencies).
export function fftBinFrequency(binIndex: number, length: number): number {
  const folded = binIndex <= length / 2 ? binIndex : length - binIndex;
  return folded / length;
}

export function butterworthGainForSettings(
  frequency: number,
  settings: SpatialFrequencyFilterSettings,
): number {
  if (settings.mode === "lowpass") return butterworthLowpassGain(frequency, settings.cutoff);
  if (settings.mode === "highpass") return butterworthHighpassGain(frequency, settings.cutoff);
  return butterworthBandpassGain(frequency, settings.lowCutoff, settings.highCutoff);
}

// The Butterworth gain helpers throw the user-facing cutoff errors; evaluating
// one gain up front surfaces them before any per-band work starts.
function assertGainIsComputableForSettings(settings: SpatialFrequencyFilterSettings): void {
  butterworthGainForSettings(0.25, settings);
}

function assertBandLengthMatchesShape(band: RasterTypedArray, shape: BandSpatialShape): void {
  if (band.length === shape.width * shape.height) return;
  throw new Error(
    `Spatial filter band has ${band.length} values but the stack shape is ` +
      `${shape.width} x ${shape.height}`,
  );
}

// The mirror fill overwrites every real cell of the padded grid; only the
// imaginary plane needs an explicit reset when the grid is reused.
function fillGridByMirrorPaddingBand(
  grid: ComplexGrid,
  band: RasterTypedArray,
  shape: BandSpatialShape,
): void {
  grid.imag.fill(0);
  for (let y = 0; y < grid.height; y += 1) {
    fillPaddedRowByMirroringSource(grid.real, band, shape, grid.width, y);
  }
}

function fillPaddedRowByMirroringSource(
  real: FftLineBuffer,
  band: RasterTypedArray,
  shape: BandSpatialShape,
  paddedWidth: number,
  y: number,
): void {
  const sourceRowStart = mirrorIndexIntoRange(y, shape.height) * shape.width;
  for (let x = 0; x < paddedWidth; x += 1) {
    real[y * paddedWidth + x] = band[sourceRowStart + mirrorIndexIntoRange(x, shape.width)] ?? 0;
  }
}

// Reflects a padded index back into [0, size). Smooth-size padding never
// reaches twice the source size (the next power of two is itself smooth and
// already below 2x), so a single reflection always suffices.
function mirrorIndexIntoRange(index: number, size: number): number {
  if (index < size) return index;
  return Math.max(0, 2 * size - 2 - index);
}

function multiplyGridByButterworthTransfer(
  grid: ComplexGrid,
  settings: SpatialFrequencyFilterSettings,
): void {
  for (let y = 0; y < grid.height; y += 1) {
    multiplyGridRowByTransfer(grid, y, fftBinFrequency(y, grid.height), settings);
  }
}

function multiplyGridRowByTransfer(
  grid: ComplexGrid,
  y: number,
  verticalFrequency: number,
  settings: SpatialFrequencyFilterSettings,
): void {
  for (let x = 0; x < grid.width; x += 1) {
    const radialFrequency = Math.hypot(fftBinFrequency(x, grid.width), verticalFrequency);
    const gain = butterworthGainForSettings(radialFrequency, settings);
    const index = y * grid.width + x;
    grid.real[index] = (grid.real[index] ?? 0) * gain;
    grid.imag[index] = (grid.imag[index] ?? 0) * gain;
  }
}

// The transfer function is real and symmetric in frequency, so the inverse
// transform's imaginary part is numerical noise; the real part is the result.
function cropGridRealPartToShape(grid: ComplexGrid, shape: BandSpatialShape): Float32Array {
  const out = new Float32Array(shape.width * shape.height);
  for (let y = 0; y < shape.height; y += 1) {
    for (let x = 0; x < shape.width; x += 1) {
      out[y * shape.width + x] = grid.real[y * grid.width + x] ?? 0;
    }
  }
  return out;
}
