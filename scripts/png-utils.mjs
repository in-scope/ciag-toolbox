// Shared helpers for generating PNGs in pure Node (zlib + Buffer; no native deps).

import { createDeflate, deflateSync } from "node:zlib";

export const PLACEHOLDER_BACKGROUND_COLOR = { r: 24, g: 121, b: 219, a: 255 };

function buildCrc32LookupTable() {
  const table = new Uint32Array(256);
  for (let byteValue = 0; byteValue < 256; byteValue++) {
    let remainder = byteValue;
    for (let bit = 0; bit < 8; bit++) {
      remainder = remainder & 1 ? 0xedb88320 ^ (remainder >>> 1) : remainder >>> 1;
    }
    table[byteValue] = remainder >>> 0;
  }
  return table;
}

const CRC32_LOOKUP_TABLE = buildCrc32LookupTable();

function computeCrc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_LOOKUP_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildPngChunk(typeFourCc, dataBuffer) {
  const lengthHeader = Buffer.alloc(4);
  lengthHeader.writeUInt32BE(dataBuffer.length, 0);
  const typeBytes = Buffer.from(typeFourCc, "ascii");
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(computeCrc32(Buffer.concat([typeBytes, dataBuffer])), 0);
  return Buffer.concat([lengthHeader, typeBytes, dataBuffer, crcBuffer]);
}

function buildPngHeaderChunk(width, height) {
  const headerData = Buffer.alloc(13);
  headerData.writeUInt32BE(width, 0);
  headerData.writeUInt32BE(height, 4);
  headerData.writeUInt8(8, 8);
  headerData.writeUInt8(6, 9);
  headerData.writeUInt8(0, 10);
  headerData.writeUInt8(0, 11);
  headerData.writeUInt8(0, 12);
  return buildPngChunk("IHDR", headerData);
}

function buildSolidColorRgbaPixelBuffer(width, height, color) {
  const buffer = Buffer.alloc(width * height * 4);
  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = color.r;
    buffer[i + 1] = color.g;
    buffer[i + 2] = color.b;
    buffer[i + 3] = color.a;
  }
  return buffer;
}

function buildScanlineFilteredStreamFromRgbaBuffer(width, height, rgbaPixelBuffer) {
  const bytesPerScanline = 1 + width * 4;
  const stream = Buffer.alloc(height * bytesPerScanline);
  for (let y = 0; y < height; y++) {
    const filteredOffset = y * bytesPerScanline;
    const sourceOffset = y * width * 4;
    stream[filteredOffset] = 0;
    rgbaPixelBuffer.copy(stream, filteredOffset + 1, sourceOffset, sourceOffset + width * 4);
  }
  return stream;
}

function buildPngImageDataChunkFromRgbaBuffer(width, height, rgbaPixelBuffer) {
  const stream = buildScanlineFilteredStreamFromRgbaBuffer(width, height, rgbaPixelBuffer);
  return buildPngChunk("IDAT", deflateSync(stream));
}

function buildPngImageEndChunk() {
  return buildPngChunk("IEND", Buffer.alloc(0));
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function buildRgbaPng(width, height, rgbaPixelBuffer) {
  return Buffer.concat([
    PNG_SIGNATURE,
    buildPngHeaderChunk(width, height),
    buildPngImageDataChunkFromRgbaBuffer(width, height, rgbaPixelBuffer),
    buildPngImageEndChunk(),
  ]);
}

export function buildSolidColorPng(width, height, color) {
  return buildRgbaPng(width, height, buildSolidColorRgbaPixelBuffer(width, height, color));
}

// --- Streaming RGBA PNG (CT-230) ---------------------------------------------
// Emits a PNG row by row so a 10000x5000 photo never materializes its full
// pixel or scanline buffer. One zlib deflate stream spans multiple IDAT chunks,
// which is valid PNG; each IDAT is emitted once ~1 MB of deflated bytes exist.

const STREAMED_IDAT_TARGET_BYTES = 1 << 20;

export async function streamRgbaPngUsingRowProvider(width, height, provideRowRgba, emitPngBytes) {
  await emitPngBytes(PNG_SIGNATURE);
  await emitPngBytes(buildPngHeaderChunk(width, height));
  await deflateRowsIntoIdatChunks(width, height, provideRowRgba, emitPngBytes);
  await emitPngBytes(buildPngImageEndChunk());
}

async function deflateRowsIntoIdatChunks(width, height, provideRowRgba, emitPngBytes) {
  const deflateStream = createDeflate();
  const deflatedParts = collectStreamOutputParts(deflateStream);
  for (let y = 0; y < height; y++) {
    await writeToStreamHonoringBackpressure(deflateStream, buildFilteredScanline(width, provideRowRgba(y)));
    await emitCollectedPartsAsIdatWhenLargeEnough(deflatedParts, emitPngBytes);
  }
  await endStreamAndAwaitAllDataEmitted(deflateStream);
  await emitCollectedPartsAsIdatChunk(deflatedParts, emitPngBytes);
}

function collectStreamOutputParts(stream) {
  const parts = [];
  stream.on("data", (chunk) => parts.push(chunk));
  return parts;
}

function buildFilteredScanline(width, rowRgbaBuffer) {
  const scanline = Buffer.alloc(1 + width * 4);
  scanline[0] = 0;
  scanline.set(rowRgbaBuffer.subarray(0, width * 4), 1);
  return scanline;
}

function writeToStreamHonoringBackpressure(stream, buffer) {
  return new Promise((resolve, reject) => {
    stream.write(buffer, (error) => (error ? reject(error) : resolve()));
  });
}

// The writable-side end() callback can fire BEFORE the final deflated bytes are
// emitted on the readable side; waiting for the readable "end" event guarantees
// every "data" chunk has been collected.
function endStreamAndAwaitAllDataEmitted(stream) {
  return new Promise((resolve, reject) => {
    stream.once("error", reject);
    stream.once("end", resolve);
    stream.end();
  });
}

async function emitCollectedPartsAsIdatWhenLargeEnough(parts, emitPngBytes) {
  if (sumOfPartByteLengths(parts) < STREAMED_IDAT_TARGET_BYTES) return;
  await emitCollectedPartsAsIdatChunk(parts, emitPngBytes);
}

async function emitCollectedPartsAsIdatChunk(parts, emitPngBytes) {
  if (parts.length === 0) return;
  await emitPngBytes(buildPngChunk("IDAT", Buffer.concat(parts.splice(0, parts.length))));
}

function sumOfPartByteLengths(parts) {
  return parts.reduce((total, part) => total + part.length, 0);
}
