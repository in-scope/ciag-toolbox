import { describe, expect, it } from "vitest";

import {
  allocateTypedArrayLikeBandOrThrow,
  allocateUint8ArrayOrThrow,
  buildRasterMemoryAllocationErrorForByteLength,
  RasterMemoryAllocationError,
} from "./raster-allocation";

const IMPOSSIBLE_LENGTH = 2 ** 48;

describe("allocateTypedArrayLikeBandOrThrow", () => {
  it("allocates a fresh array of the band's own element type", () => {
    const allocated = allocateTypedArrayLikeBandOrThrow(new Int16Array(2), 5);
    expect(allocated).toBeInstanceOf(Int16Array);
    expect(allocated.length).toBe(5);
  });

  it("maps an impossible allocation to the in-vocabulary memory error", () => {
    expect(() => allocateTypedArrayLikeBandOrThrow(new Uint16Array(1), IMPOSSIBLE_LENGTH)).toThrow(
      RasterMemoryAllocationError,
    );
    expect(() => allocateTypedArrayLikeBandOrThrow(new Uint16Array(1), IMPOSSIBLE_LENGTH)).toThrow(
      /Not enough memory to allocate/,
    );
  });
});

describe("allocateUint8ArrayOrThrow", () => {
  it("allocates and maps failures identically", () => {
    expect(allocateUint8ArrayOrThrow(3)).toBeInstanceOf(Uint8Array);
    expect(() => allocateUint8ArrayOrThrow(IMPOSSIBLE_LENGTH)).toThrow(/Not enough memory to allocate/);
  });
});

describe("buildRasterMemoryAllocationErrorForByteLength", () => {
  it("names the megabytes needed and never the raw allocator string", () => {
    const error = buildRasterMemoryAllocationErrorForByteLength(3 * 1024 * 1024);
    expect(error.message).toContain("3 MB");
    expect(error.message.toLowerCase()).not.toContain("allocation failed");
  });
});
