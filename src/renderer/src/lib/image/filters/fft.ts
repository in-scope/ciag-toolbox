// CT-203: minimal FFT for the spatial frequency filter, implemented in pure TS
// (locked decision: no new runtime dependency). All buffers on the per-band hot
// path are typed arrays. CT-219a: the transform is generic over float32/float64
// lines so memory-bound callers can halve their working-grid footprint with
// float32 buffers. CT-224: lengths may be any product of 2s, 3s, and 5s - a
// power of two runs the iterative radix-2 fast path, anything else the
// mixed-radix path - so callers pad to the nearest 5-smooth size instead of the
// next power of two (a 11608 x 8708 capture pads to 11664 x 8748, not
// 16384 x 16384, quartering the working grid).

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

const SUPPORTED_FFT_RADICES: ReadonlyArray<number> = [2, 3, 5];

export function isSupportedFftLength(value: number): boolean {
  if (!Number.isInteger(value) || value < 1) return false;
  let remaining = value;
  for (const radix of SUPPORTED_FFT_RADICES) {
    while (remaining % radix === 0) remaining /= radix;
  }
  return remaining === 1;
}

export function smallestSupportedFftLengthAtLeast(value: number): number {
  let candidate = Math.max(1, Math.ceil(value));
  while (!isSupportedFftLength(candidate)) candidate += 1;
  return candidate;
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
  if (!isPowerOfTwo(real.length)) {
    transformMixedRadixInPlace(real, imag, sign);
    return;
  }
  permuteIntoBitReversedOrder(real, imag);
  for (let blockSize = 2; blockSize <= real.length; blockSize *= 2) {
    performButterflyPassOfSize(real, imag, blockSize, sign);
  }
}

function assertTransformBuffersAreUsable(real: FftLineBuffer, imag: FftLineBuffer): void {
  if (!isSupportedFftLength(real.length)) {
    throw new Error(`FFT length must be a product of 2s, 3s, and 5s, got ${real.length}`);
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

// --- CT-224: mixed-radix (2/3/5) Cooley-Tukey for non-power-of-two lengths ---
//
// Decimation in time, recursing out of place into float64 scratch (the extra
// per-line precision costs one line's worth of memory, not a grid's worth),
// with all twiddles read from one cached table of the Nth roots of unity.

interface MixedRadixContext {
  readonly length: number;
  readonly cosTable: Float64Array;
  readonly sinTable: Float64Array;
  readonly outRe: Float64Array;
  readonly outIm: Float64Array;
  readonly spokeRe: Float64Array;
  readonly spokeIm: Float64Array;
  readonly sign: number;
}

const MAX_SUPPORTED_RADIX = 5;

function transformMixedRadixInPlace(real: FftLineBuffer, imag: FftLineBuffer, sign: number): void {
  const context = buildMixedRadixContext(real.length, sign);
  recurseMixedRadixTransform(context, real, imag, 0, 1, 0, real.length);
  real.set(context.outRe as never);
  imag.set(context.outIm as never);
}

function buildMixedRadixContext(length: number, sign: number): MixedRadixContext {
  const tables = rootOfUnityTablesForLength(length);
  return {
    length,
    cosTable: tables.cos,
    sinTable: tables.sin,
    outRe: new Float64Array(length),
    outIm: new Float64Array(length),
    spokeRe: new Float64Array(MAX_SUPPORTED_RADIX),
    spokeIm: new Float64Array(MAX_SUPPORTED_RADIX),
    sign,
  };
}

// One cached table of e^(2 pi i j / N) per line length: every sub-transform's
// twiddle W_n^j equals the root at index j * (N / n), so the recursion only
// ever multiplies indices, never calls trig on the hot path.
const rootOfUnityTableCache = new Map<number, { cos: Float64Array; sin: Float64Array }>();

function rootOfUnityTablesForLength(length: number): { cos: Float64Array; sin: Float64Array } {
  const cached = rootOfUnityTableCache.get(length);
  if (cached) return cached;
  const built = buildRootOfUnityTables(length);
  rootOfUnityTableCache.set(length, built);
  return built;
}

function buildRootOfUnityTables(length: number): { cos: Float64Array; sin: Float64Array } {
  const cos = new Float64Array(length);
  const sin = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    const angle = (2 * Math.PI * index) / length;
    cos[index] = Math.cos(angle);
    sin[index] = Math.sin(angle);
  }
  return { cos, sin };
}

// Splits off the smallest prime factor p, recurses on the p interleaved
// subsequences, then combines them level by level. tableStep is N / n for the
// current sub-length n, so twiddle indices stay in the one shared table.
function recurseMixedRadixTransform(
  context: MixedRadixContext,
  inRe: FftLineBuffer,
  inIm: FftLineBuffer,
  inOffset: number,
  tableStep: number,
  outOffset: number,
  n: number,
): void {
  if (n === 1) {
    context.outRe[outOffset] = inRe[inOffset] ?? 0;
    context.outIm[outOffset] = inIm[inOffset] ?? 0;
    return;
  }
  const radix = smallestSupportedRadixOf(n);
  recurseOnInterleavedSubsequences(context, inRe, inIm, inOffset, tableStep, outOffset, n, radix);
  combineSubtransformsAtLevel(context, outOffset, n, radix, tableStep);
}

function smallestSupportedRadixOf(n: number): number {
  for (const radix of SUPPORTED_FFT_RADICES) {
    if (n % radix === 0) return radix;
  }
  throw new Error(`FFT length must be a product of 2s, 3s, and 5s, got a factor of ${n}`);
}

function recurseOnInterleavedSubsequences(
  context: MixedRadixContext,
  inRe: FftLineBuffer,
  inIm: FftLineBuffer,
  inOffset: number,
  tableStep: number,
  outOffset: number,
  n: number,
  radix: number,
): void {
  const subLength = n / radix;
  for (let q = 0; q < radix; q += 1) {
    recurseMixedRadixTransform(
      context,
      inRe,
      inIm,
      inOffset + q * tableStep,
      tableStep * radix,
      outOffset + q * subLength,
      subLength,
    );
  }
}

// For each output frequency k = k0 + t * (n / radix), gather the radix
// sub-transform values at k0 (pre-twiddled by W_n^(q * k0)) and apply a small
// radix-point DFT in place across those strided slots.
function combineSubtransformsAtLevel(
  context: MixedRadixContext,
  outOffset: number,
  n: number,
  radix: number,
  tableStep: number,
): void {
  const subLength = n / radix;
  for (let k0 = 0; k0 < subLength; k0 += 1) {
    gatherTwiddledSpokeValues(context, outOffset, k0, subLength, radix, tableStep);
    writeSpokeDftBack(context, outOffset, k0, subLength, radix);
  }
}

function gatherTwiddledSpokeValues(
  context: MixedRadixContext,
  outOffset: number,
  k0: number,
  subLength: number,
  radix: number,
  tableStep: number,
): void {
  for (let q = 0; q < radix; q += 1) {
    const slot = outOffset + q * subLength + k0;
    const rootIndex = (q * k0 * tableStep) % context.length;
    multiplyIntoSpoke(context, q, context.outRe[slot] ?? 0, context.outIm[slot] ?? 0, rootIndex);
  }
}

function multiplyIntoSpoke(
  context: MixedRadixContext,
  spokeIndex: number,
  valueRe: number,
  valueIm: number,
  rootIndex: number,
): void {
  const twiddleRe = context.cosTable[rootIndex] ?? 1;
  const twiddleIm = context.sign * (context.sinTable[rootIndex] ?? 0);
  context.spokeRe[spokeIndex] = valueRe * twiddleRe - valueIm * twiddleIm;
  context.spokeIm[spokeIndex] = valueRe * twiddleIm + valueIm * twiddleRe;
}

function writeSpokeDftBack(
  context: MixedRadixContext,
  outOffset: number,
  k0: number,
  subLength: number,
  radix: number,
): void {
  const rootStride = context.length / radix;
  for (let t = 0; t < radix; t += 1) {
    writeSingleSpokeFrequency(context, outOffset + t * subLength + k0, radix, t, rootStride);
  }
}

function writeSingleSpokeFrequency(
  context: MixedRadixContext,
  outSlot: number,
  radix: number,
  t: number,
  rootStride: number,
): void {
  let sumRe = 0;
  let sumIm = 0;
  for (let q = 0; q < radix; q += 1) {
    const rootIndex = ((q * t) % radix) * rootStride;
    const rootRe = context.cosTable[rootIndex] ?? 1;
    const rootIm = context.sign * (context.sinTable[rootIndex] ?? 0);
    sumRe += (context.spokeRe[q] ?? 0) * rootRe - (context.spokeIm[q] ?? 0) * rootIm;
    sumIm += (context.spokeRe[q] ?? 0) * rootIm + (context.spokeIm[q] ?? 0) * rootRe;
  }
  context.outRe[outSlot] = sumRe;
  context.outIm[outSlot] = sumIm;
}
