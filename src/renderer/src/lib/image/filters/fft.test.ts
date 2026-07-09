import { describe, expect, it } from "vitest";

import {
  fft2dInPlace,
  fftInPlace,
  inverseFft2dInPlace,
  inverseFftInPlace,
  isPowerOfTwo,
  isSupportedFftLength,
  nextPowerOfTwoAtLeast,
  smallestSupportedFftLengthAtLeast,
  type ComplexGrid,
} from "./fft";

function makeComplexLine(values: ReadonlyArray<number>): [Float64Array, Float64Array] {
  return [Float64Array.from(values), new Float64Array(values.length)];
}

function makeSquareGrid(values: ReadonlyArray<number>, side: number): ComplexGrid {
  return {
    real: Float64Array.from(values),
    imag: new Float64Array(values.length),
    width: side,
    height: side,
  };
}

describe("isPowerOfTwo / nextPowerOfTwoAtLeast", () => {
  it("recognizes powers of two", () => {
    expect(isPowerOfTwo(1)).toBe(true);
    expect(isPowerOfTwo(8)).toBe(true);
    expect(isPowerOfTwo(6)).toBe(false);
    expect(isPowerOfTwo(0)).toBe(false);
  });

  it("rounds a size up to the next power of two", () => {
    expect(nextPowerOfTwoAtLeast(1)).toBe(1);
    expect(nextPowerOfTwoAtLeast(4)).toBe(4);
    expect(nextPowerOfTwoAtLeast(5)).toBe(8);
    expect(nextPowerOfTwoAtLeast(9)).toBe(16);
  });
});

describe("fftInPlace (known transform pairs)", () => {
  it("transforms an impulse into a flat spectrum", () => {
    const [real, imag] = makeComplexLine([1, 0, 0, 0, 0, 0, 0, 0]);
    fftInPlace(real, imag);
    for (let bin = 0; bin < 8; bin += 1) {
      expect(real[bin]).toBeCloseTo(1, 12);
      expect(imag[bin]).toBeCloseTo(0, 12);
    }
  });

  it("transforms a constant into a single DC bin", () => {
    const [real, imag] = makeComplexLine([3, 3, 3, 3]);
    fftInPlace(real, imag);
    expect(real[0]).toBeCloseTo(12, 12);
    for (let bin = 1; bin < 4; bin += 1) {
      expect(real[bin]).toBeCloseTo(0, 12);
      expect(imag[bin]).toBeCloseTo(0, 12);
    }
  });

  it("puts a unit cosine's energy into the matching conjugate bins", () => {
    const samples = Array.from({ length: 8 }, (_unused, n) => Math.cos((2 * Math.PI * n) / 8));
    const [real, imag] = makeComplexLine(samples);
    fftInPlace(real, imag);
    expect(real[1]).toBeCloseTo(4, 12);
    expect(real[7]).toBeCloseTo(4, 12);
    expect(real[0]).toBeCloseTo(0, 12);
    expect(real[2]).toBeCloseTo(0, 12);
  });

  it("round-trips through the inverse transform", () => {
    const original = [5, -2, 7.5, 0, 1, 3, -4.25, 9];
    const [real, imag] = makeComplexLine(original);
    fftInPlace(real, imag);
    inverseFftInPlace(real, imag);
    original.forEach((value, index) => {
      expect(real[index]).toBeCloseTo(value, 10);
      expect(imag[index]).toBeCloseTo(0, 10);
    });
  });

  it("rejects an unsupported length and mismatched buffers", () => {
    expect(() => fftInPlace(new Float64Array(7), new Float64Array(7))).toThrow(/2s, 3s, and 5s/);
    expect(() => fftInPlace(new Float64Array(4), new Float64Array(8))).toThrow(/match in length/);
  });
});

// CT-224: lengths with factors of 3 and 5 run the mixed-radix path; the naive
// O(n^2) DFT is the ground truth for every supported non-power-of-two size.
describe("mixed-radix FFT (CT-224)", () => {
  it("classifies supported lengths as products of 2s, 3s, and 5s", () => {
    expect(isSupportedFftLength(6)).toBe(true);
    expect(isSupportedFftLength(45)).toBe(true);
    expect(isSupportedFftLength(7)).toBe(false);
    expect(isSupportedFftLength(0)).toBe(false);
  });

  it("rounds real capture dimensions up to nearby smooth sizes, not powers of two", () => {
    expect(smallestSupportedFftLengthAtLeast(11608)).toBe(11664);
    expect(smallestSupportedFftLengthAtLeast(8708)).toBe(8748);
    expect(smallestSupportedFftLengthAtLeast(8000)).toBe(8000);
    expect(smallestSupportedFftLengthAtLeast(6000)).toBe(6000);
    expect(smallestSupportedFftLengthAtLeast(1)).toBe(1);
  });

  it.each([3, 5, 6, 9, 10, 12, 15, 20, 30, 45, 60])(
    "matches the naive DFT at length %i",
    (length) => {
      const samples = Array.from({ length }, (_unused, n) => Math.sin(n * 1.7) + 0.3 * n);
      const [real, imag] = makeComplexLine(samples);
      fftInPlace(real, imag);
      const expected = naiveDft(samples);
      for (let bin = 0; bin < length; bin += 1) {
        expect(real[bin]).toBeCloseTo(expected.real[bin]!, 8);
        expect(imag[bin]).toBeCloseTo(expected.imag[bin]!, 8);
      }
    },
  );

  it.each([6, 12, 15, 45, 60])("round-trips through the inverse at length %i", (length) => {
    const original = Array.from({ length }, (_unused, n) => Math.cos(n * 0.9) * 5 - n * 0.2);
    const [real, imag] = makeComplexLine(original);
    fftInPlace(real, imag);
    inverseFftInPlace(real, imag);
    original.forEach((value, index) => {
      expect(real[index]).toBeCloseTo(value, 10);
      expect(imag[index]).toBeCloseTo(0, 10);
    });
  });

  it("round-trips a non-power-of-two float32 grid within float32 precision", () => {
    const original = Array.from({ length: 12 * 18 }, (_unused, index) => (index % 37) * 0.5 - 4);
    const grid: ComplexGrid = {
      real: Float32Array.from(original),
      imag: new Float32Array(original.length),
      width: 12,
      height: 18,
    };
    fft2dInPlace(grid);
    inverseFft2dInPlace(grid);
    original.forEach((value, index) => {
      expect(grid.real[index]).toBeCloseTo(value, 3);
      expect(grid.imag[index]).toBeCloseTo(0, 3);
    });
  });
});

// CT-225: the 2D transform reports one tick per completed line (rows then
// columns), which the spatial filter turns into within-band progress.
describe("fft2dInPlace line progress (CT-225)", () => {
  it("ticks once per row then once per column with a shared total", () => {
    const grid = makeSquareGrid(Array.from({ length: 16 }, (_unused, index) => index), 4);
    const ticks: Array<[number, number]> = [];
    fft2dInPlace(grid, (completed, total) => ticks.push([completed, total]));
    expect(ticks).toEqual([
      [1, 8], [2, 8], [3, 8], [4, 8],
      [5, 8], [6, 8], [7, 8], [8, 8],
    ]);
  });

  it("reports the same line ticks through the inverse transform", () => {
    const grid = makeSquareGrid(Array.from({ length: 16 }, (_unused, index) => index), 4);
    fft2dInPlace(grid);
    const ticks: Array<[number, number]> = [];
    inverseFft2dInPlace(grid, (completed, total) => ticks.push([completed, total]));
    expect(ticks.length).toBe(8);
    expect(ticks[7]).toEqual([8, 8]);
  });
});

function naiveDft(samples: ReadonlyArray<number>): { real: number[]; imag: number[] } {
  const n = samples.length;
  const real = new Array<number>(n).fill(0);
  const imag = new Array<number>(n).fill(0);
  for (let bin = 0; bin < n; bin += 1) {
    for (let index = 0; index < n; index += 1) {
      const angle = (-2 * Math.PI * bin * index) / n;
      real[bin]! += samples[index]! * Math.cos(angle);
      imag[bin]! += samples[index]! * Math.sin(angle);
    }
  }
  return { real, imag };
}

describe("fft2dInPlace", () => {
  it("transforms a constant grid into a single DC bin holding the sum", () => {
    const grid = makeSquareGrid(Array.from({ length: 16 }, () => 1), 4);
    fft2dInPlace(grid);
    expect(grid.real[0]).toBeCloseTo(16, 12);
    for (let index = 1; index < 16; index += 1) {
      expect(grid.real[index]).toBeCloseTo(0, 12);
      expect(grid.imag[index]).toBeCloseTo(0, 12);
    }
  });

  it("transforms a corner impulse into a flat spectrum", () => {
    const values = Array.from({ length: 16 }, (_unused, index) => (index === 0 ? 1 : 0));
    const grid = makeSquareGrid(values, 4);
    fft2dInPlace(grid);
    for (let index = 0; index < 16; index += 1) {
      expect(grid.real[index]).toBeCloseTo(1, 12);
      expect(grid.imag[index]).toBeCloseTo(0, 12);
    }
  });

  it("round-trips a grid through the inverse transform", () => {
    const original = Array.from({ length: 16 }, (_unused, index) => index * 1.5 - 4);
    const grid = makeSquareGrid(original, 4);
    fft2dInPlace(grid);
    inverseFft2dInPlace(grid);
    original.forEach((value, index) => {
      expect(grid.real[index]).toBeCloseTo(value, 10);
      expect(grid.imag[index]).toBeCloseTo(0, 10);
    });
  });

  // CT-219a: the spatial filter's working grid is float32 to halve its memory;
  // the transform must round-trip within float32 precision on those buffers.
  it("round-trips a float32 grid within float32 precision", () => {
    const original = Array.from({ length: 16 }, (_unused, index) => index * 1.5 - 4);
    const grid: ComplexGrid = {
      real: Float32Array.from(original),
      imag: new Float32Array(16),
      width: 4,
      height: 4,
    };
    fft2dInPlace(grid);
    inverseFft2dInPlace(grid);
    original.forEach((value, index) => {
      expect(grid.real[index]).toBeCloseTo(value, 3);
      expect(grid.imag[index]).toBeCloseTo(0, 3);
    });
  });
});
