// Encodes the band cube for the Python worker: raw little-endian float32 bytes
// (band-major, row-major within each band) plus a small JSON header. The bytes are sent
// as their own frame so the Python side reconstructs the cube with numpy.frombuffer/reshape
// rather than parsing JSON-encoded arrays. All packaged targets are little-endian, so a
// Float32Array's own bytes are already in the wire order.
// CT-219g: the payload's bytes are exposed as an ASYNC SEGMENT STREAM, never one
// concatenated Buffer - a reference-scale cube (~3 GB) cannot exist as a single
// allocation in any Chromium process (the 2 GiB PartitionAlloc cap), and the
// chunked-run session store streams the segments off a spooled temp file so the
// main process never holds the uploaded cube in memory at all.
import type { CubePayloadHeader } from "./worker-protocol";

export interface CubeForUserScript {
  bands: Float32Array[];
  height: number;
  width: number;
  wavelengths: number[] | null;
}

export interface EncodedCubePayload {
  header: CubePayloadHeader;
  totalByteLength: number;
  readSegments: () => AsyncIterable<Buffer>;
}

export function encodeCubeAsFloat32Payload(cube: CubeForUserScript): EncodedCubePayload {
  const segments = cube.bands.map(littleEndianBufferOf);
  return {
    header: buildCubePayloadHeader(cube),
    totalByteLength: segments.reduce((total, segment) => total + segment.length, 0),
    readSegments: () => yieldEachSegment(segments),
  };
}

async function* yieldEachSegment(segments: Buffer[]): AsyncIterable<Buffer> {
  for (const segment of segments) yield segment;
}

function buildCubePayloadHeader(cube: CubeForUserScript): CubePayloadHeader {
  return {
    shape: [cube.bands.length, cube.height, cube.width],
    dtype: "float32",
    wavelengths: cube.wavelengths,
  };
}

function littleEndianBufferOf(values: Float32Array): Buffer {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}
