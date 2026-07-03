// Encodes the band cube for the Python worker: a raw little-endian float32 buffer
// (band-major, row-major within each band) plus a small JSON header. The buffer is sent
// as its own frame so the Python side reconstructs it with numpy.frombuffer/reshape
// rather than parsing JSON-encoded arrays. All packaged targets are little-endian, so a
// Float32Array's own bytes are already in the wire order.
import type { CubePayloadHeader } from "./worker-protocol";

export interface CubeForUserScript {
  bands: Float32Array[];
  height: number;
  width: number;
  wavelengths: number[] | null;
}

export interface EncodedCubePayload {
  header: CubePayloadHeader;
  buffer: Buffer;
}

export function encodeCubeAsFloat32Payload(cube: CubeForUserScript): EncodedCubePayload {
  const contiguous = concatenateBandsInBandMajorOrder(cube.bands, cube.height * cube.width);
  return { header: buildCubePayloadHeader(cube), buffer: littleEndianBufferOf(contiguous) };
}

function buildCubePayloadHeader(cube: CubeForUserScript): CubePayloadHeader {
  return {
    shape: [cube.bands.length, cube.height, cube.width],
    dtype: "float32",
    wavelengths: cube.wavelengths,
  };
}

function concatenateBandsInBandMajorOrder(bands: Float32Array[], bandLength: number): Float32Array {
  const contiguous = new Float32Array(bands.length * bandLength);
  bands.forEach((band, bandIndex) => contiguous.set(band, bandIndex * bandLength));
  return contiguous;
}

function littleEndianBufferOf(values: Float32Array): Buffer {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}
