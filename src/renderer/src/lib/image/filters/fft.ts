// CT-203: minimal iterative radix-2 FFT for the spatial frequency filter,
// implemented in pure TS (locked decision: no new runtime dependency). All
// buffers on the per-band hot path are typed arrays. Lengths must be powers of
// two; callers pad (see spatial-frequency-filter.ts). CT-219a: the transform is
// generic over float32/float64 lines so memory-bound callers can halve their
// working-grid footprint with float32 buffers.

export type FftLineBuffer = Float32Array | Float64Array;

export interface ComplexGrid {
  readonly real: FftLineBuffer;
  readonly imag: FftLineBuffer;
  readonly width: number;
  readonly height: number;
}

export function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

export function nextPowerOfTwoAtLeast(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

export function fftInPlace(real: FftLineBuffer, imag: FftLineBuffer): void {
  transformInPlace(real, imag, FORWARD_TRANSFORM_SIGN);
}

// The inverse folds the 1/N normalization in, so fft followed by inverseFft
// recovers the original samples.
export function inverseFftInPlace(real: FftLineBuffer, imag: FftLineBuffer): void {
  transformInPlace(real, imag, INVERSE_TRANSFORM_SIGN);
  scaleValuesInPlace(real, 1 / real.length);
  scaleValuesInPlace(imag, 1 / imag.length);
}

export function fft2dInPlace(grid: ComplexGrid): void {
  transformEveryGridRow(grid, fftInPlace);
  transformEveryGridColumn(grid, fftInPlace);
}

export function inverseFft2dInPlace(grid: ComplexGrid): void {
  transformEveryGridRow(grid, inverseFftInPlace);
  transformEveryGridColumn(grid, inverseFftInPlace);
}

const FORWARD_TRANSFORM_SIGN = -1;
const INVERSE_TRANSFORM_SIGN = 1;

type ComplexLineTransform = (real: FftLineBuffer, imag: FftLineBuffer) => void;

function transformEveryGridRow(grid: ComplexGrid, transformLine: ComplexLineTransform): void {
  for (let y = 0; y < grid.height; y += 1) {
    const rowStart = y * grid.width;
    transformLine(
      grid.real.subarray(rowStart, rowStart + grid.width),
      grid.imag.subarray(rowStart, rowStart + grid.width),
    );
  }
}

function transformEveryGridColumn(grid: ComplexGrid, transformLine: ComplexLineTransform): void {
  const columnReal = allocateLineBufferMatching(grid.real, grid.height);
  const columnImag = allocateLineBufferMatching(grid.imag, grid.height);
  for (let x = 0; x < grid.width; x += 1) {
    copyGridColumnIntoLine(grid, x, columnReal, columnImag);
    transformLine(columnReal, columnImag);
    copyLineIntoGridColumn(grid, x, columnReal, columnImag);
  }
}

function allocateLineBufferMatching(sample: FftLineBuffer, length: number): FftLineBuffer {
  return sample instanceof Float64Array ? new Float64Array(length) : new Float32Array(length);
}

function copyGridColumnIntoLine(
  grid: ComplexGrid,
  x: number,
  lineReal: FftLineBuffer,
  lineImag: FftLineBuffer,
): void {
  for (let y = 0; y < grid.height; y += 1) {
    lineReal[y] = grid.real[y * grid.width + x] ?? 0;
    lineImag[y] = grid.imag[y * grid.width + x] ?? 0;
  }
}

function copyLineIntoGridColumn(
  grid: ComplexGrid,
  x: number,
  lineReal: FftLineBuffer,
  lineImag: FftLineBuffer,
): void {
  for (let y = 0; y < grid.height; y += 1) {
    grid.real[y * grid.width + x] = lineReal[y] ?? 0;
    grid.imag[y * grid.width + x] = lineImag[y] ?? 0;
  }
}

function transformInPlace(real: FftLineBuffer, imag: FftLineBuffer, sign: number): void {
  assertTransformBuffersAreUsable(real, imag);
  permuteIntoBitReversedOrder(real, imag);
  for (let blockSize = 2; blockSize <= real.length; blockSize *= 2) {
    performButterflyPassOfSize(real, imag, blockSize, sign);
  }
}

function assertTransformBuffersAreUsable(real: FftLineBuffer, imag: FftLineBuffer): void {
  if (!isPowerOfTwo(real.length)) {
    throw new Error(`FFT length must be a power of two, got ${real.length}`);
  }
  if (imag.length !== real.length) {
    throw new Error(
      `FFT real and imaginary buffers must match in length (${real.length} vs ${imag.length})`,
    );
  }
}

function performButterflyPassOfSize(
  real: FftLineBuffer,
  imag: FftLineBuffer,
  blockSize: number,
  sign: number,
): void {
  const angleStep = (sign * 2 * Math.PI) / blockSize;
  for (let blockStart = 0; blockStart < real.length; blockStart += blockSize) {
    combineHalvesOfBlock(real, imag, blockStart, blockSize / 2, angleStep);
  }
}

function combineHalvesOfBlock(
  real: FftLineBuffer,
  imag: FftLineBuffer,
  blockStart: number,
  halfSize: number,
  angleStep: number,
): void {
  for (let offset = 0; offset < halfSize; offset += 1) {
    const angle = angleStep * offset;
    combineButterflyPair(
      real,
      imag,
      blockStart + offset,
      blockStart + offset + halfSize,
      Math.cos(angle),
      Math.sin(angle),
    );
  }
}

function combineButterflyPair(
  real: FftLineBuffer,
  imag: FftLineBuffer,
  top: number,
  bottom: number,
  twiddleReal: number,
  twiddleImag: number,
): void {
  const productReal = (real[bottom] ?? 0) * twiddleReal - (imag[bottom] ?? 0) * twiddleImag;
  const productImag = (real[bottom] ?? 0) * twiddleImag + (imag[bottom] ?? 0) * twiddleReal;
  real[bottom] = (real[top] ?? 0) - productReal;
  imag[bottom] = (imag[top] ?? 0) - productImag;
  real[top] = (real[top] ?? 0) + productReal;
  imag[top] = (imag[top] ?? 0) + productImag;
}

function permuteIntoBitReversedOrder(real: FftLineBuffer, imag: FftLineBuffer): void {
  for (let index = 1, reversed = 0; index < real.length; index += 1) {
    reversed = nextBitReversedIndex(reversed, real.length);
    if (index < reversed) swapComplexEntries(real, imag, index, reversed);
  }
}

function nextBitReversedIndex(reversed: number, length: number): number {
  let bit = length >> 1;
  while (reversed & bit) {
    reversed ^= bit;
    bit >>= 1;
  }
  return reversed | bit;
}

function swapComplexEntries(real: FftLineBuffer, imag: FftLineBuffer, a: number, b: number): void {
  swapValuesAt(real, a, b);
  swapValuesAt(imag, a, b);
}

function swapValuesAt(values: FftLineBuffer, a: number, b: number): void {
  const held = values[a] ?? 0;
  values[a] = values[b] ?? 0;
  values[b] = held;
}

function scaleValuesInPlace(values: FftLineBuffer, factor: number): void {
  for (let index = 0; index < values.length; index += 1) {
    values[index] = (values[index] ?? 0) * factor;
  }
}
