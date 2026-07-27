// Shared oracle math and streaming uint16 TIFF/ENVI writers for the scale-audit
// (CT-219) and scale10 (CT-230) fixture generators.
//
// Byte emission is separated from file IO so unit tests can push the SAME writer
// code paths through the app's real readers entirely in memory. The per-band
// emitters never hold more than one band of samples at a time, which is what
// keeps the 10 GB scale10 generation inside a ~100 MB allocation ceiling.
//
// A capture spec is { width, height, bandCount, bandBase(bandIndex) } and every
// pixel is the oracle value(band, x, y) = bandBase(band) + (x % 100) + (y % 100).

import { closeSync, openSync, writeFileSync, writeSync } from "node:fs";

export const PIXEL_RAMP_MODULUS = 100;
const MEAN_OF_MODULO_RAMP = (PIXEL_RAMP_MODULUS - 1) / 2;

// --- Oracle pixel values -----------------------------------------------------

export function computeOraclePixelValue(spec, bandIndex, x, y) {
  return spec.bandBase(bandIndex) + (x % PIXEL_RAMP_MODULUS) + (y % PIXEL_RAMP_MODULUS);
}

export function computeOracleBandMean(spec, bandIndex) {
  assertRampMeanIsExact(spec);
  return spec.bandBase(bandIndex) + 2 * MEAN_OF_MODULO_RAMP;
}

function assertRampMeanIsExact(spec) {
  if (spec.width % PIXEL_RAMP_MODULUS !== 0 || spec.height % PIXEL_RAMP_MODULUS !== 0) {
    throw new Error("width and height must be multiples of the ramp modulus for exact means");
  }
}

// --- Band sample construction ------------------------------------------------

export function buildBandSamples(spec, bandIndex) {
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

function encodeBandSamplesAsLittleEndianBytes(samples) {
  assertPlatformIsLittleEndian();
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}

function assertPlatformIsLittleEndian() {
  const probe = new Uint8Array(new Uint16Array([1]).buffer);
  if (probe[0] !== 1) {
    throw new Error("these writers emit uint16 samples via typed-array views and require a little-endian platform");
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

export function writeMultiPageUint16Tiff(filePath, spec) {
  return writeEmittedBytesToFile(filePath, (emitBytes) =>
    emitMultiPageUint16TiffBytes(spec, emitBytes),
  );
}

export function emitMultiPageUint16TiffBytes(spec, emitBytes) {
  emitBytes(encodeLittleEndianTiffHeader());
  for (let bandIndex = 0; bandIndex < spec.bandCount; bandIndex += 1) {
    emitBytes(encodeIfdForBand(spec, bandIndex));
    emitBytes(encodeBandSamplesAsLittleEndianBytes(buildBandSamples(spec, bandIndex)));
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

// --- Streaming ENVI BSQ uint16 writer ------------------------------------------
// Header sidecar plus a raw band-sequential little-endian binary. Data type 12
// is ENVI's uint16; byte order 0 is little-endian.

export function buildEnviBsqUint16HeaderText(spec) {
  return [
    "ENVI",
    `samples = ${spec.width}`,
    `lines = ${spec.height}`,
    `bands = ${spec.bandCount}`,
    "header offset = 0",
    "file type = ENVI Standard",
    "data type = 12",
    "interleave = bsq",
    "byte order = 0",
    "",
  ].join("\n");
}

export function writeEnviBsqUint16(headerPath, binaryPath, spec) {
  const headerText = buildEnviBsqUint16HeaderText(spec);
  writeFileSync(headerPath, headerText);
  const binaryByteCount = writeEmittedBytesToFile(binaryPath, (emitBytes) =>
    emitEnviBsqUint16BinaryBytes(spec, emitBytes),
  );
  return { headerByteCount: Buffer.byteLength(headerText), binaryByteCount };
}

export function emitEnviBsqUint16BinaryBytes(spec, emitBytes) {
  for (let bandIndex = 0; bandIndex < spec.bandCount; bandIndex += 1) {
    emitBytes(encodeBandSamplesAsLittleEndianBytes(buildBandSamples(spec, bandIndex)));
  }
}

// --- File IO -------------------------------------------------------------------

function writeEmittedBytesToFile(filePath, emitAllBytes) {
  const fileDescriptor = openSync(filePath, "w");
  let totalByteCount = 0;
  try {
    emitAllBytes((bytes) => {
      writeSync(fileDescriptor, bytes);
      totalByteCount += bytes.byteLength;
    });
  } finally {
    closeSync(fileDescriptor);
  }
  return totalByteCount;
}

// --- Manifest description --------------------------------------------------------

export function describeCaptureForManifest(spec) {
  return {
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
    valuesPerBand: buildPerBandList(spec, (bandIndex) =>
      computeOraclePixelValue(spec, bandIndex, corner.x, corner.y),
    ),
  }));
}
