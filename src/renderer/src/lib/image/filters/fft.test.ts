import { describe, expect, it } from "vitest";

import {
  fft2dInPlace,
  fftInPlace,
  inverseFft2dInPlace,
  inverseFftInPlace,
  isPowerOfTwo,
  nextPowerOfTwoAtLeast,
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

  it("rejects a non-power-of-two length and mismatched buffers", () => {
    expect(() => fftInPlace(new Float64Array(6), new Float64Array(6))).toThrow(/power of two/);
    expect(() => fftInPlace(new Float64Array(4), new Float64Array(8))).toThrow(/match in length/);
  });
});

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
