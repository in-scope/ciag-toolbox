import { createInflate, type Inflate } from "node:zlib";

import {
  assertSixteenBitPngHeaderIsDecodable,
  channelCountForSixteenBitPngColorTypeOrThrow,
  parseIhdrChunkData,
  startsWithPngSignature,
} from "../shared/png-header";
import { reconstructScanlineBytesInPlace } from "../shared/png-scanline-filters";

// CT-272: streaming 16-bit PNG decoder, the counterpart of png16-encode.ts.
// File bytes are fed in arbitrary slices; the chunk walker routes IDAT data
// through Node zlib inflate, scanlines are unfiltered (all five PNG filter
// types) as they complete, and reconstructed rows of big-endian samples
// accumulate for the caller to drain - neither the compressed stream nor the
// decoded payload ever exists whole in this module. Electron-free and
// round-trip unit-tested against png16-encode.ts plus a reference-tool
// fixture in png16-decode.test.ts.

export interface Png16DecodedHeader {
  readonly width: number;
  readonly height: number;
  readonly channelCount: number;
}

export interface StreamingPng16Decoder {
  consumeFileBytes(bytes: Uint8Array): Promise<void>;
  headerOrNull(): Png16DecodedHeader | null;
  takePendingDecodedBytes(): Uint8Array[];
  finishAssertingEveryRowDecoded(): Promise<void>;
  disposeAbandoningDecode(): void;
}

const PNG_SIGNATURE_BYTE_LENGTH = 8;
const CHUNK_FRAME_OVERHEAD_BYTES = 12;
const TRUNCATED_PIXEL_DATA_MESSAGE =
  "The PNG file's pixel data ended before every row was decoded";

interface Png16DecoderState {
  incoming: Uint8Array;
  signatureChecked: boolean;
  header: Png16DecodedHeader | null;
  rowByteLength: number;
  bytesPerPixel: number;
  readonly inflate: Inflate;
  readonly inflatedBlocks: Buffer[];
  currentRow: Uint8Array | null;
  currentRowFilled: number;
  currentRowFilterType: number;
  previousRow: Uint8Array | null;
  readonly decodedRows: Uint8Array[];
  producedRowCount: number;
  sawIend: boolean;
}

export function createStreamingPng16Decoder(): StreamingPng16Decoder {
  const state = buildInitialDecoderState();
  return {
    consumeFileBytes: (bytes) => consumeFileBytes(state, bytes),
    headerOrNull: () => state.header,
    takePendingDecodedBytes: () => state.decodedRows.splice(0),
    finishAssertingEveryRowDecoded: () => finishAssertingEveryRowDecoded(state),
    disposeAbandoningDecode: () => state.inflate.destroy(),
  };
}

function buildInitialDecoderState(): Png16DecoderState {
  const inflatedBlocks: Buffer[] = [];
  const inflate = createInflate();
  inflate.on("data", (block: Buffer) => inflatedBlocks.push(block));
  return {
    incoming: new Uint8Array(0),
    signatureChecked: false,
    header: null,
    rowByteLength: 0,
    bytesPerPixel: 0,
    inflate,
    inflatedBlocks,
    currentRow: null,
    currentRowFilled: 0,
    currentRowFilterType: 0,
    previousRow: null,
    decodedRows: [],
    producedRowCount: 0,
    sawIend: false,
  };
}

async function consumeFileBytes(state: Png16DecoderState, bytes: Uint8Array): Promise<void> {
  state.incoming = concatenateBytes(state.incoming, bytes);
  checkSignatureOnce(state);
  if (!state.signatureChecked) return;
  await walkEveryCompletePngChunk(state);
}

function checkSignatureOnce(state: Png16DecoderState): void {
  if (state.signatureChecked || state.incoming.length < PNG_SIGNATURE_BYTE_LENGTH) return;
  if (!startsWithPngSignature(state.incoming)) {
    throw new Error("The file is not a valid PNG");
  }
  state.signatureChecked = true;
  state.incoming = state.incoming.subarray(PNG_SIGNATURE_BYTE_LENGTH);
}

async function walkEveryCompletePngChunk(state: Png16DecoderState): Promise<void> {
  while (!state.sawIend) {
    const frame = readNextCompleteChunkFrameOrNull(state.incoming);
    if (frame === null) return;
    state.incoming = state.incoming.subarray(frame.frameByteLength);
    await dispatchPngChunk(state, frame.chunkType, frame.data);
  }
}

interface PngChunkFrame {
  readonly chunkType: string;
  readonly data: Uint8Array;
  readonly frameByteLength: number;
}

function readNextCompleteChunkFrameOrNull(incoming: Uint8Array): PngChunkFrame | null {
  if (incoming.length < CHUNK_FRAME_OVERHEAD_BYTES - 4) return null;
  const view = new DataView(incoming.buffer, incoming.byteOffset, incoming.byteLength);
  const dataLength = view.getUint32(0);
  const frameByteLength = CHUNK_FRAME_OVERHEAD_BYTES + dataLength;
  if (incoming.length < frameByteLength) return null;
  return {
    chunkType: String.fromCharCode(incoming[4]!, incoming[5]!, incoming[6]!, incoming[7]!),
    data: incoming.subarray(8, 8 + dataLength),
    frameByteLength,
  };
}

async function dispatchPngChunk(
  state: Png16DecoderState,
  chunkType: string,
  data: Uint8Array,
): Promise<void> {
  if (chunkType === "IHDR") return parseAndValidateIhdr(state, data);
  if (chunkType === "IDAT") return inflateIdatDataIntoRows(state, data);
  if (chunkType === "IEND") {
    state.sawIend = true;
  }
}

function parseAndValidateIhdr(state: Png16DecoderState, data: Uint8Array): void {
  const summary = parseIhdrChunkData(data);
  if (summary.bitDepth !== 16) {
    throw new Error("This decoder only reads 16-bit PNGs");
  }
  assertSixteenBitPngHeaderIsDecodable(summary);
  const channelCount = channelCountForSixteenBitPngColorTypeOrThrow(summary.colorType);
  assertPositivePngDimensions(summary.width, summary.height);
  state.header = { width: summary.width, height: summary.height, channelCount };
  state.bytesPerPixel = channelCount * 2;
  state.rowByteLength = summary.width * state.bytesPerPixel;
}

function assertPositivePngDimensions(width: number, height: number): void {
  if (width <= 0 || height <= 0) {
    throw new Error("The PNG file describes an empty image");
  }
}

async function inflateIdatDataIntoRows(
  state: Png16DecoderState,
  data: Uint8Array,
): Promise<void> {
  if (state.header === null) {
    throw new Error("The PNG file's pixel data arrived before its header");
  }
  await writeBufferThroughInflate(state.inflate, data);
  drainInflatedBlocksIntoRows(state);
}

function writeBufferThroughInflate(inflate: Inflate, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    inflate.write(bytes, (error) => (error ? reject(error) : resolve()));
  });
}

function drainInflatedBlocksIntoRows(state: Png16DecoderState): void {
  for (const block of state.inflatedBlocks.splice(0)) {
    consumeInflatedBytesIntoRows(state, block);
  }
}

// Each PNG scanline is one filter-type byte followed by the row's sample
// bytes; rows assemble across inflate block boundaries wherever they fall.
function consumeInflatedBytesIntoRows(state: Png16DecoderState, bytes: Uint8Array): void {
  let index = 0;
  while (index < bytes.length) {
    index = beginRowTakingFilterByteIfNeeded(state, bytes, index);
    if (index >= bytes.length) return;
    index = fillCurrentRowFromBytes(state, bytes, index);
    completeCurrentRowIfFull(state);
  }
}

function beginRowTakingFilterByteIfNeeded(
  state: Png16DecoderState,
  bytes: Uint8Array,
  index: number,
): number {
  if (state.currentRow !== null) return index;
  if (state.producedRowCount >= state.header!.height) {
    throw new Error("The PNG file holds more pixel data than its header describes");
  }
  state.currentRow = new Uint8Array(state.rowByteLength);
  state.currentRowFilled = 0;
  state.currentRowFilterType = bytes[index]!;
  return index + 1;
}

function fillCurrentRowFromBytes(
  state: Png16DecoderState,
  bytes: Uint8Array,
  index: number,
): number {
  const take = Math.min(state.rowByteLength - state.currentRowFilled, bytes.length - index);
  state.currentRow!.set(bytes.subarray(index, index + take), state.currentRowFilled);
  state.currentRowFilled += take;
  return index + take;
}

function completeCurrentRowIfFull(state: Png16DecoderState): void {
  if (state.currentRow === null || state.currentRowFilled < state.rowByteLength) return;
  const row = state.currentRow;
  reconstructScanlineBytesInPlace(
    state.currentRowFilterType,
    row,
    state.previousRow,
    state.bytesPerPixel,
  );
  state.decodedRows.push(row);
  state.previousRow = row;
  state.producedRowCount += 1;
  state.currentRow = null;
}

async function finishAssertingEveryRowDecoded(state: Png16DecoderState): Promise<void> {
  // A deflate stream cut off mid-file errors out of zlib's end; that IS the
  // truncation case, so it surfaces as the same message as missing rows.
  await endInflateFlushingRemainingOutput(state.inflate).catch(() => {
    throw new Error(TRUNCATED_PIXEL_DATA_MESSAGE);
  });
  drainInflatedBlocksIntoRows(state);
  if (state.header === null || state.producedRowCount < state.header.height) {
    throw new Error(TRUNCATED_PIXEL_DATA_MESSAGE);
  }
}

function endInflateFlushingRemainingOutput(inflate: Inflate): Promise<void> {
  return new Promise((resolve, reject) => {
    inflate.once("error", reject);
    inflate.once("end", () => resolve());
    inflate.end();
  });
}

function concatenateBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  if (first.length === 0) return second;
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first, 0);
  joined.set(second, first.length);
  return joined;
}
