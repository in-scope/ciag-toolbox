// Generates a 256x256 placeholder build/icon.ico from a PNG payload.
// Run with: node scripts/generate-placeholder-icon.mjs
// Replace build/icon.ico with a real branded asset before public release.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ICON_WIDTH_PIXELS = 256;
const ICON_HEIGHT_PIXELS = 256;
const PLACEHOLDER_BACKGROUND_COLOR = { r: 24, g: 121, b: 219, a: 255 };

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
    const scanlineOffset = y * bytesPerScanline;
    pixelStream[scanlineOffset] = 0;
    for (let x = 0; x < width; x++) {
      const pixelOffset = scanlineOffset + 1 + x * 4;
      pixelStream[pixelOffset] = color.r;
      pixelStream[pixelOffset + 1] = color.g;
      pixelStream[pixelOffset + 2] = color.b;
      pixelStream[pixelOffset + 3] = color.a;
    }
  }
  return pixelStream;
}

function buildPngImageDataChunk(width, height, color) {
  const compressed = deflateSync(buildSolidColorRgbaPixelStream(width, height, color));
  return buildPngChunk("IDAT", compressed);
}

function buildPngImageEndChunk() {
  return buildPngChunk("IEND", Buffer.alloc(0));
}

function buildSolidColorPng(width, height, color) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    pngSignature,
    buildPngHeaderChunk(width, height),
    buildPngImageDataChunk(width, height, color),
    buildPngImageEndChunk(),
  ]);
}

function buildSinglePngIcoDirectoryHeader() {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  return header;
}

function buildIcoDirectoryEntryForPng(pngBuffer, width, height) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(width >= 256 ? 0 : width, 0);
  entry.writeUInt8(height >= 256 ? 0 : height, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12);
  return entry;
}

function buildIcoFileFromPng(pngBuffer, width, height) {
  return Buffer.concat([
    buildSinglePngIcoDirectoryHeader(),
    buildIcoDirectoryEntryForPng(pngBuffer, width, height),
    pngBuffer,
  ]);
}

function writePlaceholderWindowsIcon() {
  const png = buildSolidColorPng(ICON_WIDTH_PIXELS, ICON_HEIGHT_PIXELS, PLACEHOLDER_BACKGROUND_COLOR);
  const ico = buildIcoFileFromPng(png, ICON_WIDTH_PIXELS, ICON_HEIGHT_PIXELS);
  const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "build", "icon.ico");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, ico);
  console.log(`Wrote ${outputPath} (${ico.length} bytes)`);
}

writePlaceholderWindowsIcon();
