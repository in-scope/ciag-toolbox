// Deterministic scale-audit fixture generator (CT-219).
//
// Run with: node scripts/generate-scale-audit-stack.mjs
// Writes two large captures to the gitignored .scale-audit/ directory:
//
//   reference-stack.tif   8000 x 6000, 16 bands, uint16 multi-page TIFF
//                         (the CT-219 reference scale: must work everywhere)
//   stretch-capture.tif   14000 x 11000, 1 band, uint16 TIFF
//                         (the stretch case: must fail gracefully, not crash)
//
// No clocks and no randomness: value(band, x, y) = (band + 1) * 1000
// + (x % 100) + (y % 100), so every pixel is an oracle. At (0, 0) band b
// reads (b + 1) * 1000 exactly; width and height are whole multiples of 100,
// so every band mean is (b + 1) * 1000 + 99. The stretch capture uses base
// 500 with the same modulo ramp (mean 599). manifest.json records these.
//
// The TIFF layout mirrors e2e/fixtures/generate-fixtures.mjs (classic
// little-endian, one IFD + one uncompressed strip per band) but streams each
// band to disk instead of assembling the whole ~1.5 GB file in memory.

import { mkdirSync, writeFileSync, openSync, writeSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIRECTORY = join(REPOSITORY_ROOT, ".scale-audit");

const REFERENCE_STACK = {
  fileName: "reference-stack.tif",
  width: 8000,
  height: 6000,
  bandCount: 16,
  bandBase: (bandIndex) => (bandIndex + 1) * 1000,
};

const STRETCH_CAPTURE = {
  fileName: "stretch-capture.tif",
  width: 14000,
  height: 11000,
  bandCount: 1,
  bandBase: () => 500,
};

const PIXEL_RAMP_MODULUS = 100;
const MEAN_OF_MODULO_RAMP = (PIXEL_RAMP_MODULUS - 1) / 2;

function generateScaleAuditCaptures() {
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  writeMultiPageUint16Tiff(REFERENCE_STACK);
  writeMultiPageUint16Tiff(STRETCH_CAPTURE);
  writeManifestFile();
}

// --- Oracle pixel values -----------------------------------------------------

function computeOraclePixelValue(spec, bandIndex, x, y) {
  return spec.bandBase(bandIndex) + (x % PIXEL_RAMP_MODULUS) + (y % PIXEL_RAMP_MODULUS);
}

function computeOracleBandMean(spec, bandIndex) {
  assertRampMeanIsExact(spec);
  return spec.bandBase(bandIndex) + 2 * MEAN_OF_MODULO_RAMP;
}

function assertRampMeanIsExact(spec) {
  if (spec.width % PIXEL_RAMP_MODULUS !== 0 || spec.height % PIXEL_RAMP_MODULUS !== 0) {
    throw new Error("width and height must be multiples of the ramp modulus for exact means");
  }
}

// --- Band sample construction ------------------------------------------------

function buildBandSamples(spec, bandIndex) {
  const samples = new Uint16Array(spec.width * spec.height);
  const rampByColumn = buildColumnRamp(spec.width);
  for (let y = 0; y < spec.height; y += 1) {
    fillBandRow(samples, spec, bandIndex, y, rampByColumn);
  }
  return samples;
}

function buildColumnRamp(width) {
  const ramp = new Uint16Array(width);
  for (let x = 0; x < width; x += 1) ramp[x] = x % PIXEL_RAMP_MODULUS;
  return ramp;
}

function fillBandRow(samples, spec, bandIndex, y, rampByColumn) {
  const rowBase = spec.bandBase(bandIndex) + (y % PIXEL_RAMP_MODULUS);
  const rowOffset = y * spec.width;
  for (let x = 0; x < spec.width; x += 1) {
    samples[rowOffset + x] = rowBase + rampByColumn[x];
  }
}

// --- Streaming multi-page uint16 TIFF writer ----------------------------------
// Classic little-endian TIFF: 8-byte header, then per band one IFD immediately
// followed by its uncompressed strip. Same tag set as the committed e2e
// fixture generator; offsets are computed up front so pages stream in order.

const TIFF_TYPE_SHORT = 3;
const TIFF_TYPE_LONG = 4;
const TIFF_ENTRY_COUNT = 10;
const TIFF_IFD_BYTE_SIZE = 2 + TIFF_ENTRY_COUNT * 12 + 4;
const TIFF_FIRST_IFD_OFFSET = 8;

function writeMultiPageUint16Tiff(spec) {
  const filePath = join(OUTPUT_DIRECTORY, spec.fileName);
  const fileDescriptor = openSync(filePath, "w");
  try {
    writeTiffHeaderAndAllPages(fileDescriptor, spec);
  } finally {
    closeSync(fileDescriptor);
  }
  reportWrittenCapture(spec);
}

function writeTiffHeaderAndAllPages(fileDescriptor, spec) {
  writeSync(fileDescriptor, encodeLittleEndianTiffHeader());
  for (let bandIndex = 0; bandIndex < spec.bandCount; bandIndex += 1) {
    writeSync(fileDescriptor, encodeIfdForBand(spec, bandIndex));
    writeSync(fileDescriptor, encodeBandStripBytes(spec, bandIndex));
  }
}

function encodeLittleEndianTiffHeader() {
  const header = Buffer.alloc(TIFF_FIRST_IFD_OFFSET);
  header.write("II", 0, "ascii");
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(TIFF_FIRST_IFD_OFFSET, 4);
  return header;
}

function computePageBlockSize(spec) {
  return TIFF_IFD_BYTE_SIZE + spec.width * spec.height * 2;
}

function computeIfdOffsetForBand(spec, bandIndex) {
  return TIFF_FIRST_IFD_OFFSET + bandIndex * computePageBlockSize(spec);
}

function encodeIfdForBand(spec, bandIndex) {
  const ifdOffset = computeIfdOffsetForBand(spec, bandIndex);
  const stripOffset = ifdOffset + TIFF_IFD_BYTE_SIZE;
  const isLastBand = bandIndex === spec.bandCount - 1;
  const nextIfdOffset = isLastBand ? 0 : computeIfdOffsetForBand(spec, bandIndex + 1);
  return encodeIfdBytes(buildTiffPageEntries(spec, stripOffset), nextIfdOffset);
}

function buildTiffPageEntries(spec, stripOffset) {
  return [
    { tag: 256, type: TIFF_TYPE_SHORT, value: spec.width },
    { tag: 257, type: TIFF_TYPE_SHORT, value: spec.height },
    { tag: 258, type: TIFF_TYPE_SHORT, value: 16 },
    { tag: 259, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 262, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 273, type: TIFF_TYPE_LONG, value: stripOffset },
    { tag: 277, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 278, type: TIFF_TYPE_LONG, value: spec.height },
    { tag: 279, type: TIFF_TYPE_LONG, value: spec.width * spec.height * 2 },
    { tag: 339, type: TIFF_TYPE_SHORT, value: 1 },
  ];
}

function encodeIfdBytes(entries, nextIfdOffset) {
  const bytes = Buffer.alloc(TIFF_IFD_BYTE_SIZE);
  bytes.writeUInt16LE(entries.length, 0);
  entries.forEach((entry, entryIndex) => writeIfdEntry(bytes, 2 + entryIndex * 12, entry));
  bytes.writeUInt32LE(nextIfdOffset, 2 + entries.length * 12);
  return bytes;
}

function writeIfdEntry(bytes, offset, entry) {
  bytes.writeUInt16LE(entry.tag, offset);
  bytes.writeUInt16LE(entry.type, offset + 2);
  bytes.writeUInt32LE(1, offset + 4);
  if (entry.type === TIFF_TYPE_SHORT) bytes.writeUInt16LE(entry.value, offset + 8);
  else bytes.writeUInt32LE(entry.value, offset + 8);
}

function encodeBandStripBytes(spec, bandIndex) {
  const samples = buildBandSamples(spec, bandIndex);
  assertPlatformIsLittleEndian();
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}

function assertPlatformIsLittleEndian() {
  const probe = new Uint8Array(new Uint16Array([1]).buffer);
  if (probe[0] !== 1) {
    throw new Error("this generator writes uint16 strips via typed-array views and requires a little-endian platform");
  }
}

function reportWrittenCapture(spec) {
  const totalBytes = TIFF_FIRST_IFD_OFFSET + spec.bandCount * computePageBlockSize(spec);
  process.stdout.write(`wrote ${spec.fileName} (${spec.width}x${spec.height}, ${spec.bandCount} band(s), ${totalBytes} bytes)\n`);
}

// --- Manifest ------------------------------------------------------------------

function writeManifestFile() {
  const manifest = {
    note: "Generated by scripts/generate-scale-audit-stack.mjs - do not edit by hand.",
    valueFormula: "value(band, x, y) = bandBase + (x % 100) + (y % 100)",
    referenceStack: describeCapture(REFERENCE_STACK),
    stretchCapture: describeCapture(STRETCH_CAPTURE),
  };
  writeFileSync(join(OUTPUT_DIRECTORY, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write("wrote manifest.json\n");
}

function describeCapture(spec) {
  return {
    fileName: spec.fileName,
    width: spec.width,
    height: spec.height,
    bandCount: spec.bandCount,
    dataType: "uint16",
    bandBases: buildPerBandList(spec, (bandIndex) => spec.bandBase(bandIndex)),
    bandMeans: buildPerBandList(spec, (bandIndex) => computeOracleBandMean(spec, bandIndex)),
    samplePixels: buildManifestSamplePixels(spec),
  };
}

function buildPerBandList(spec, computeValueForBand) {
  return Array.from({ length: spec.bandCount }, (_, bandIndex) => computeValueForBand(bandIndex));
}

function buildManifestSamplePixels(spec) {
  const corners = [
    { x: 0, y: 0 },
    { x: spec.width - 1, y: spec.height - 1 },
    { x: 150, y: 250 },
  ];
  return corners.map((corner) => ({
    ...corner,
    valuesPerBand: buildPerBandList(spec, (bandIndex) => computeOraclePixelValue(spec, bandIndex, corner.x, corner.y)),
  }));
}

generateScaleAuditCaptures();
