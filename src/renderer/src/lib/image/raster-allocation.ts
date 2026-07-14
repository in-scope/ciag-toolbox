import type { RasterTypedArray } from "@/lib/image/raster-image";

// CT-103 / CT-239: band-array allocation with the in-vocabulary failure
// message. Every operation-path allocation of a band-sized typed array must
// come through here (or make-float-raster's float32 twin) so an exhausted
// ArrayBuffer pool surfaces as a clear, actionable error instead of the raw
// engine "Array buffer allocation failed" string.
export class RasterMemoryAllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RasterMemoryAllocationError";
  }
}

export function buildRasterMemoryAllocationErrorForByteLength(
  byteLength: number,
): RasterMemoryAllocationError {
  const megabytes = Math.ceil(byteLength / (1024 * 1024));
  return new RasterMemoryAllocationError(
    `Not enough memory to allocate ${megabytes} MB for this operation. ` +
      `Free memory or run it on fewer bands and try again.`,
  );
}

// Allocates a fresh typed array of the SAME element type as the given band.
export function allocateTypedArrayLikeBandOrThrow<T extends RasterTypedArray>(
  band: T,
  length: number,
): T {
  const Constructor = band.constructor as new (length: number) => T;
  try {
    return new Constructor(length);
  } catch {
    throw buildRasterMemoryAllocationErrorForByteLength(length * band.BYTES_PER_ELEMENT);
  }
}

export function allocateUint8ArrayOrThrow(length: number): Uint8Array {
  try {
    return new Uint8Array(length);
  } catch {
    throw buildRasterMemoryAllocationErrorForByteLength(length);
  }
}

export function allocateFloat32ArrayOrThrow(length: number): Float32Array {
  try {
    return new Float32Array(length);
  } catch {
    throw buildRasterMemoryAllocationErrorForByteLength(length * Float32Array.BYTES_PER_ELEMENT);
  }
}

export function allocateFloat64ArrayOrThrow(length: number): Float64Array {
  try {
    return new Float64Array(length);
  } catch {
    throw buildRasterMemoryAllocationErrorForByteLength(length * Float64Array.BYTES_PER_ELEMENT);
  }
}
