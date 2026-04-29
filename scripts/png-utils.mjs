// Shared helpers for generating tiny solid-color RGBA PNGs that the icon
// scripts wrap into ICO (Windows) and ICNS (macOS) container formats.
// Pure Node (zlib + Buffer); no native deps.

import { deflateSync } from "node:zlib";

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

function buildSolidColorRgbaPixelStream(width, height, color) {
  const bytesPerScanline = 1 + width * 4;
  const pixelStream = Buffer.alloc(height * bytesPerScanline);
  for (let y = 0; y < height; y++) {
    fillScanlineWithColor(pixelStream, y * bytesPerScanline, width, color);
  }
  return pixelStream;
}

function fillScanlineWithColor(pixelStream, scanlineOffset, width, color) {
  pixelStream[scanlineOffset] = 0;
  for (let x = 0; x < width; x++) {
    const pixelOffset = scanlineOffset + 1 + x * 4;
    pixelStream[pixelOffset] = color.r;
    pixelStream[pixelOffset + 1] = color.g;
    pixelStream[pixelOffset + 2] = color.b;
    pixelStream[pixelOffset + 3] = color.a;
  }
}

function buildPngImageDataChunk(width, height, color) {
  const compressed = deflateSync(buildSolidColorRgbaPixelStream(width, height, color));
  return buildPngChunk("IDAT", compressed);
}

function buildPngImageEndChunk() {
  return buildPngChunk("IEND", Buffer.alloc(0));
}

export function buildSolidColorPng(width, height, color) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    pngSignature,
    buildPngHeaderChunk(width, height),
    buildPngImageDataChunk(width, height, color),
    buildPngImageEndChunk(),
  ]);
}
