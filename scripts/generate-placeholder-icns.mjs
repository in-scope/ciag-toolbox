// Generates a placeholder build/icon.icns from PNG payloads.
// Run with: node scripts/generate-placeholder-icns.mjs
// Replace build/icon.icns with a real branded asset before public release.
//
// ICNS layout: 8-byte header ("icns" + total file size, big-endian) followed
// by a sequence of 8-byte typed entries ("ic07"|"ic08"|"ic09"|"ic10" + entry
// size including the 8-byte header, big-endian) each carrying an embedded PNG
// payload. macOS Big Sur and later prefer ic10 (1024x1024 retina); older
// macOS releases pick from the smaller entries.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PLACEHOLDER_BACKGROUND_COLOR, buildSolidColorPng } from "./png-utils.mjs";

const ICNS_PNG_ENTRY_TYPES_BY_PIXEL_SIZE = {
  128: "ic07",
  256: "ic08",
  512: "ic09",
  1024: "ic10",
};

function buildIcnsTypedEntryFromPng(typeFourCc, pngBuffer) {
  const sizeIncludingHeader = 8 + pngBuffer.length;
  const header = Buffer.alloc(8);
  header.write(typeFourCc, 0, 4, "ascii");
  header.writeUInt32BE(sizeIncludingHeader, 4);
  return Buffer.concat([header, pngBuffer]);
}

function buildIcnsFileFromTypedEntries(typedEntries) {
  const body = Buffer.concat(typedEntries);
  const totalFileSize = 8 + body.length;
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(totalFileSize, 4);
  return Buffer.concat([header, body]);
}

function buildPlaceholderIcnsTypedEntryForSize(pixelSize) {
  const fourCc = ICNS_PNG_ENTRY_TYPES_BY_PIXEL_SIZE[pixelSize];
  if (!fourCc) throw new Error(`No ICNS PNG type defined for size ${pixelSize}`);
  const png = buildSolidColorPng(pixelSize, pixelSize, PLACEHOLDER_BACKGROUND_COLOR);
  return buildIcnsTypedEntryFromPng(fourCc, png);
}

function writePlaceholderMacIcon() {
  const sizes = [128, 256, 512, 1024];
  const typedEntries = sizes.map(buildPlaceholderIcnsTypedEntryForSize);
  const icns = buildIcnsFileFromTypedEntries(typedEntries);
  const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "build", "icon.icns");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, icns);
  console.log(`Wrote ${outputPath} (${icns.length} bytes)`);
}

writePlaceholderMacIcon();
