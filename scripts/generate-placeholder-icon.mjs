// Generates a 256x256 placeholder build/icon.ico from a PNG payload.
// Run with: node scripts/generate-placeholder-icon.mjs
// Replace build/icon.ico with a real branded asset before public release.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PLACEHOLDER_BACKGROUND_COLOR, buildSolidColorPng } from "./png-utils.mjs";

const ICON_WIDTH_PIXELS = 256;
const ICON_HEIGHT_PIXELS = 256;

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
