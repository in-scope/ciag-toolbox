// CT-219g: reassembles a cube result pulled from the main process as raw
// band-major little-endian float32 byte chunks (see
// src/shared/chunked-user-script-run-protocol.ts) into one Float32Array per
// band. Pure so the chunk-boundary handling is unit-testable without IPC.

export interface CubeResultChunkAssembler {
  readonly append: (bytes: Uint8Array) => void;
  readonly finish: () => Float32Array[];
}

interface AssemblyPosition {
  bandIndex: number;
  offsetInBandBytes: number;
  receivedBytes: number;
}

export function createCubeResultChunkAssembler(
  shape: [number, number, number],
  totalBytes: number,
): CubeResultChunkAssembler {
  const bands = allocateBandsForShapeOrThrow(shape, totalBytes);
  const bandByteViews = bands.map((band) => new Uint8Array(band.buffer));
  const position: AssemblyPosition = { bandIndex: 0, offsetInBandBytes: 0, receivedBytes: 0 };
  return {
    append: (bytes) => writeChunkAcrossBandBoundaries(bandByteViews, position, bytes),
    finish: () => finishAssemblyOrThrow(bands, position, totalBytes),
  };
}

function allocateBandsForShapeOrThrow(
  shape: [number, number, number],
  totalBytes: number,
): Float32Array[] {
  const [bandCount, height, width] = shape;
  assertShapeDimensionsArePositiveIntegers(bandCount, height, width);
  if (bandCount * height * width * Float32Array.BYTES_PER_ELEMENT !== totalBytes) {
    throw new Error("The script result byte count did not match its stack shape.");
  }
  return Array.from({ length: bandCount }, () => new Float32Array(height * width));
}

function assertShapeDimensionsArePositiveIntegers(
  bandCount: number,
  height: number,
  width: number,
): void {
  const isValid = [bandCount, height, width].every((dimension) => Number.isInteger(dimension) && dimension > 0);
  if (!isValid) throw new Error("The script result described an invalid stack shape.");
}

function writeChunkAcrossBandBoundaries(
  bandByteViews: Uint8Array[],
  position: AssemblyPosition,
  bytes: Uint8Array,
): void {
  let cursor = 0;
  while (cursor < bytes.byteLength) {
    cursor += writeIntoCurrentBand(bandByteViews, position, bytes, cursor);
  }
}

function writeIntoCurrentBand(
  bandByteViews: Uint8Array[],
  position: AssemblyPosition,
  bytes: Uint8Array,
  cursor: number,
): number {
  const view = bandByteViews[position.bandIndex];
  if (view === undefined) throw new Error("The script result sent more bytes than its stack shape.");
  const take = Math.min(bytes.byteLength - cursor, view.byteLength - position.offsetInBandBytes);
  view.set(bytes.subarray(cursor, cursor + take), position.offsetInBandBytes);
  advanceAssemblyPosition(position, view, take);
  return take;
}

function advanceAssemblyPosition(
  position: AssemblyPosition,
  bandView: Uint8Array,
  writtenBytes: number,
): void {
  position.offsetInBandBytes += writtenBytes;
  position.receivedBytes += writtenBytes;
  if (position.offsetInBandBytes >= bandView.byteLength) {
    position.bandIndex += 1;
    position.offsetInBandBytes = 0;
  }
}

function finishAssemblyOrThrow(
  bands: Float32Array[],
  position: AssemblyPosition,
  totalBytes: number,
): Float32Array[] {
  if (position.receivedBytes !== totalBytes) {
    throw new Error("The script result ended before every stack byte arrived.");
  }
  return bands;
}
