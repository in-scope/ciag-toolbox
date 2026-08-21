import { createDeflate, crc32, type Deflate } from "node:zlib";

// CT-271: streaming 16-bit grayscale PNG encoder for the chunked save-image
// protocol. The renderer streams RAW row-major big-endian uint16 samples; this
// module inserts the per-scanline filter byte (filter type 0, None), deflates
// through Node zlib off the main thread, and hands finished PNG bytes to an
// injected sink as they become available - the encoded file never exists whole
// in any process. Electron-free and unit-tested (round-tripped against a
// reference decoder in png16-encode.test.ts).

export interface Png16GrayscaleDimensions {
  readonly width: number;
  readonly height: number;
}

export type EncodedPngByteSink = (bytes: Uint8Array) => Promise<void>;

export interface StreamingPng16GrayscaleEncoder {
  consumeRawBigEndianSampleBytes(bytes: Uint8Array): Promise<void>;
  finishWritingPngTrailer(): Promise<void>;
  disposeAbandoningEncode(): void;
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_BIT_DEPTH_SIXTEEN = 16;
const PNG_COLOR_TYPE_GRAYSCALE = 0;
const BYTES_PER_SIXTEEN_BIT_SAMPLE = 2;

export function rawPng16SampleByteLengthForDimensions(
  dimensions: Png16GrayscaleDimensions,
): number {
  return dimensions.width * dimensions.height * BYTES_PER_SIXTEEN_BIT_SAMPLE;
}

interface Png16EncoderState {
  readonly dimensions: Png16GrayscaleDimensions;
  readonly rowByteLength: number;
  readonly writeEncodedBytes: EncodedPngByteSink;
  readonly deflate: Deflate;
  readonly deflatedBlocks: Buffer[];
  consumedRawBytes: number;
  bytesIntoCurrentRow: number;
  headerWritten: boolean;
}

export function createStreamingPng16GrayscaleEncoder(
  dimensions: Png16GrayscaleDimensions,
  writeEncodedBytes: EncodedPngByteSink,
): StreamingPng16GrayscaleEncoder {
  assertValidPng16Dimensions(dimensions);
  const state = buildInitialEncoderState(dimensions, writeEncodedBytes);
  return {
    consumeRawBigEndianSampleBytes: (bytes) => consumeRawSampleBytes(state, bytes),
    finishWritingPngTrailer: () => finishWritingTrailer(state),
    disposeAbandoningEncode: () => state.deflate.destroy(),
  };
}

function assertValidPng16Dimensions(dimensions: Png16GrayscaleDimensions): void {
  const { width, height } = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("The export described an invalid encoded size.");
  }
}

function buildInitialEncoderState(
  dimensions: Png16GrayscaleDimensions,
  writeEncodedBytes: EncodedPngByteSink,
): Png16EncoderState {
  const deflatedBlocks: Buffer[] = [];
  const deflate = createDeflate();
  deflate.on("data", (block: Buffer) => deflatedBlocks.push(block));
  return {
    dimensions,
    rowByteLength: dimensions.width * BYTES_PER_SIXTEEN_BIT_SAMPLE,
    writeEncodedBytes,
    deflate,
    deflatedBlocks,
    consumedRawBytes: 0,
    bytesIntoCurrentRow: 0,
    headerWritten: false,
  };
}

async function consumeRawSampleBytes(
  state: Png16EncoderState,
  bytes: Uint8Array,
): Promise<void> {
  assertConsumeStaysWithinRawPayload(state, bytes.byteLength);
  await writeSignatureAndHeaderOnce(state);
  const filtered = takeBytesInsertingScanlineFilterBytes(state, bytes);
  await writeBufferThroughDeflate(state.deflate, filtered);
  state.consumedRawBytes += bytes.byteLength;
  await flushCollectedDeflateBlocksAsIdatChunk(state);
}

function assertConsumeStaysWithinRawPayload(
  state: Png16EncoderState,
  incomingByteLength: number,
): void {
  const total = rawPng16SampleByteLengthForDimensions(state.dimensions);
  if (incomingByteLength === 0 || state.consumedRawBytes + incomingByteLength > total) {
    throw new Error("The exported image bytes did not match the described size.");
  }
}

async function writeSignatureAndHeaderOnce(state: Png16EncoderState): Promise<void> {
  if (state.headerWritten) return;
  state.headerWritten = true;
  await state.writeEncodedBytes(PNG_SIGNATURE);
  await state.writeEncodedBytes(buildPngChunkBytes("IHDR", buildIhdrChunkData(state.dimensions)));
}

function buildIhdrChunkData(dimensions: Png16GrayscaleDimensions): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, dimensions.width);
  view.setUint32(4, dimensions.height);
  data[8] = PNG_BIT_DEPTH_SIXTEEN;
  data[9] = PNG_COLOR_TYPE_GRAYSCALE;
  return data;
}

// PNG scanlines each start with one filter-type byte; type 0 (None) keeps the
// samples verbatim, so the filtered stream is the raw big-endian samples with a
// zero byte spliced in at every row boundary, wherever those fall inside the
// incoming chunk.
function takeBytesInsertingScanlineFilterBytes(
  state: Png16EncoderState,
  bytes: Uint8Array,
): Uint8Array {
  const filtered = new Uint8Array(bytes.byteLength + countScanlineStartsCovered(state, bytes.byteLength));
  let written = 0;
  for (let index = 0; index < bytes.byteLength; ) {
    if (state.bytesIntoCurrentRow === 0) filtered[written++] = 0;
    const take = Math.min(state.rowByteLength - state.bytesIntoCurrentRow, bytes.byteLength - index);
    filtered.set(bytes.subarray(index, index + take), written);
    written += take;
    index += take;
    state.bytesIntoCurrentRow = (state.bytesIntoCurrentRow + take) % state.rowByteLength;
  }
  return filtered;
}

function countScanlineStartsCovered(
  state: Png16EncoderState,
  incomingByteLength: number,
): number {
  const startsAtRowBoundary = state.bytesIntoCurrentRow === 0 ? 1 : 0;
  const lastPositionInRowSpace = state.bytesIntoCurrentRow + incomingByteLength - 1;
  return Math.floor(lastPositionInRowSpace / state.rowByteLength) + startsAtRowBoundary;
}

function writeBufferThroughDeflate(deflate: Deflate, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    deflate.write(bytes, (error) => (error ? reject(error) : resolve()));
  });
}

async function flushCollectedDeflateBlocksAsIdatChunk(state: Png16EncoderState): Promise<void> {
  if (state.deflatedBlocks.length === 0) return;
  const data = Buffer.concat(state.deflatedBlocks.splice(0));
  await state.writeEncodedBytes(buildPngChunkBytes("IDAT", data));
}

async function finishWritingTrailer(state: Png16EncoderState): Promise<void> {
  assertEveryRawSampleByteArrived(state);
  await endDeflateFlushingRemainingOutput(state.deflate);
  await flushCollectedDeflateBlocksAsIdatChunk(state);
  await state.writeEncodedBytes(buildPngChunkBytes("IEND", new Uint8Array(0)));
}

function assertEveryRawSampleByteArrived(state: Png16EncoderState): void {
  if (state.consumedRawBytes !== rawPng16SampleByteLengthForDimensions(state.dimensions)) {
    throw new Error("The exported image bytes did not match the described size.");
  }
}

function endDeflateFlushingRemainingOutput(deflate: Deflate): Promise<void> {
  return new Promise((resolve, reject) => {
    deflate.once("error", reject);
    deflate.once("end", () => resolve());
    deflate.end();
  });
}

function buildPngChunkBytes(chunkType: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(chunkType, (character) => character.charCodeAt(0));
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(data, crc32(typeBytes)));
  return chunk;
}
