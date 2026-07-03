import type { RasterTypedArray } from "@/lib/image/raster-image";

import {
  butterworthBandpassGain,
  butterworthHighpassGain,
  butterworthLowpassGain,
} from "./butterworth";
import {
  fft2dInPlace,
  inverseFft2dInPlace,
  nextPowerOfTwoAtLeast,
  type ComplexGrid,
} from "./fft";

// CT-203: spatial frequency filtering WITHIN each band's picture (never across
// the wavelength axis). The band is mirror-padded up to power-of-two
// dimensions, transformed with the pure-TS 2D FFT, multiplied by a Butterworth
// transfer function over the radial spatial frequency, inverse-transformed,
// and cropped back. Mirror padding avoids the hard wrap-around edge a zero pad
// would introduce at the image border.

export type SpatialFrequencyFilterMode = "lowpass" | "highpass" | "bandpass";

export type SpatialFrequencyFilterSettings =
  | { readonly mode: "lowpass"; readonly cutoff: number }
  | { readonly mode: "highpass"; readonly cutoff: number }
  | { readonly mode: "bandpass"; readonly lowCutoff: number; readonly highCutoff: number };

export interface BandSpatialShape {
  readonly width: number;
  readonly height: number;
}

export function applySpatialFrequencyFilterToBand(
  band: RasterTypedArray,
  shape: BandSpatialShape,
  settings: SpatialFrequencyFilterSettings,
): Float32Array {
  assertGainIsComputableForSettings(settings);
  assertBandLengthMatchesShape(band, shape);
  const grid = buildMirrorPaddedComplexGrid(band, shape);
  fft2dInPlace(grid);
  multiplyGridByButterworthTransfer(grid, settings);
  inverseFft2dInPlace(grid);
  return cropGridRealPartToShape(grid, shape);
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

function buildMirrorPaddedComplexGrid(band: RasterTypedArray, shape: BandSpatialShape): ComplexGrid {
  const width = nextPowerOfTwoAtLeast(shape.width);
  const height = nextPowerOfTwoAtLeast(shape.height);
  const real = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    fillPaddedRowByMirroringSource(real, band, shape, width, y);
  }
  return { real, imag: new Float64Array(width * height), width, height };
}

function fillPaddedRowByMirroringSource(
  real: Float64Array,
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

// Reflects a padded index back into [0, size). Next-power-of-two padding never
// reaches twice the source size, so a single reflection always suffices.
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
