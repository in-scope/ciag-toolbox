// Deterministic scale10 fixture generator (CT-230).
//
// Run with: node scripts/generate-scale10-stack.mjs
// Writes the 10 GB / 100-band reference-scale fixtures to the gitignored
// .scale-audit/ directory:
//
//   scale10-reference.hdr/.raw   ENVI BSQ, 10000 samples x 5000 lines x 100
//                                bands, uint16 little-endian, exactly
//                                10,000,000,000 data bytes
//   scale10-band-001..100.tif    the same 100 bands as single-band classic
//                                TIFFs (~100 MB each) for the grouped-open route
//   scale10-flat-field.tif       10000 x 5000 uint16, value 500 + ramp
//   scale10-big-photo.png        10000 x 5000 RGB photo (r = 100 + (x % 100),
//                                g = 100 + (y % 100), b = 50)
//   scale10-manifest.json        formula, per-band bases/means, oracle pixels
//
// No clocks and no randomness: value(band, x, y) = (band + 1) * 600
// + (x % 100) + (y % 100), zero-based band, max 60198 (uint16-safe for all
// 100 bands). Everything streams band-by-band (or PNG row-by-row): no
// allocation ever exceeds one band of samples (~100 MB).

import { mkdirSync, openSync, writeSync, closeSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PIXEL_RAMP_MODULUS,
  describeCaptureForManifest,
  writeEnviBsqUint16,
  writeMultiPageUint16Tiff,
} from "./scale-fixture-writers.mjs";
import { streamRgbaPngUsingRowProvider } from "./png-utils.mjs";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIRECTORY = join(REPOSITORY_ROOT, ".scale-audit");

const SCALE10_REFERENCE = {
  width: 10000,
  height: 5000,
  bandCount: 100,
  bandBase: (bandIndex) => (bandIndex + 1) * 600,
};

const SCALE10_FLAT_FIELD = {
  width: 10000,
  height: 5000,
  bandCount: 1,
  bandBase: () => 500,
};

const EXPECTED_ENVI_DATA_BYTE_COUNT = 10_000_000_000;

const ENVI_HEADER_FILE_NAME = "scale10-reference.hdr";
const ENVI_BINARY_FILE_NAME = "scale10-reference.raw";
const FLAT_FIELD_FILE_NAME = "scale10-flat-field.tif";
const BIG_PHOTO_FILE_NAME = "scale10-big-photo.png";
const MANIFEST_FILE_NAME = "scale10-manifest.json";

const BIG_PHOTO = { width: 10000, height: 5000 };
const BIG_PHOTO_CHANNEL_BASE = 100;
const BIG_PHOTO_BLUE_VALUE = 50;
const BIG_PHOTO_CHANNEL_FORMULA =
  "r = 100 + (x % 100), g = 100 + (y % 100), b = 50";

async function generateScale10Fixtures() {
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  writeScale10EnviReference();
  writeScale10PerBandTiffs();
  writeScale10FlatFieldTiff();
  await writeScale10BigPhotoPng();
  writeScale10Manifest();
}

// --- ENVI reference cube -------------------------------------------------------

function writeScale10EnviReference() {
  const { headerByteCount, binaryByteCount } = writeEnviBsqUint16(
    join(OUTPUT_DIRECTORY, ENVI_HEADER_FILE_NAME),
    join(OUTPUT_DIRECTORY, ENVI_BINARY_FILE_NAME),
    SCALE10_REFERENCE,
  );
  assertEnviDataSectionIsExactlyTenGigabytes(binaryByteCount);
  reportWrittenFile(ENVI_HEADER_FILE_NAME, headerByteCount);
  reportWrittenFile(ENVI_BINARY_FILE_NAME, binaryByteCount);
}

function assertEnviDataSectionIsExactlyTenGigabytes(binaryByteCount) {
  if (binaryByteCount !== EXPECTED_ENVI_DATA_BYTE_COUNT) {
    throw new Error(
      `ENVI data section must be exactly ${EXPECTED_ENVI_DATA_BYTE_COUNT} bytes (wrote ${binaryByteCount})`,
    );
  }
}

// --- Per-band single-band TIFFs --------------------------------------------------

function writeScale10PerBandTiffs() {
  for (let bandIndex = 0; bandIndex < SCALE10_REFERENCE.bandCount; bandIndex += 1) {
    writeScale10SingleBandTiff(bandIndex);
  }
}

function writeScale10SingleBandTiff(bandIndex) {
  const fileName = buildBandTiffFileName(bandIndex);
  const byteCount = writeMultiPageUint16Tiff(
    join(OUTPUT_DIRECTORY, fileName),
    buildSingleBandSpecForReferenceBand(bandIndex),
  );
  reportWrittenFile(fileName, byteCount);
}

function buildSingleBandSpecForReferenceBand(bandIndex) {
  return {
    width: SCALE10_REFERENCE.width,
    height: SCALE10_REFERENCE.height,
    bandCount: 1,
    bandBase: () => SCALE10_REFERENCE.bandBase(bandIndex),
  };
}

function buildBandTiffFileName(bandIndex) {
  return `scale10-band-${String(bandIndex + 1).padStart(3, "0")}.tif`;
}

// --- Flat field --------------------------------------------------------------------

function writeScale10FlatFieldTiff() {
  const byteCount = writeMultiPageUint16Tiff(
    join(OUTPUT_DIRECTORY, FLAT_FIELD_FILE_NAME),
    SCALE10_FLAT_FIELD,
  );
  reportWrittenFile(FLAT_FIELD_FILE_NAME, byteCount);
}

// --- Big browser photo ---------------------------------------------------------------

async function writeScale10BigPhotoPng() {
  const byteCount = await streamBigPhotoPngToFile(join(OUTPUT_DIRECTORY, BIG_PHOTO_FILE_NAME));
  reportWrittenFile(BIG_PHOTO_FILE_NAME, byteCount);
}

async function streamBigPhotoPngToFile(filePath) {
  const fileDescriptor = openSync(filePath, "w");
  let totalByteCount = 0;
  try {
    await streamRgbaPngUsingRowProvider(BIG_PHOTO.width, BIG_PHOTO.height, buildBigPhotoRgbaRow, (bytes) => {
      writeSync(fileDescriptor, bytes);
      totalByteCount += bytes.byteLength;
    });
  } finally {
    closeSync(fileDescriptor);
  }
  return totalByteCount;
}

function buildBigPhotoRgbaRow(y) {
  const row = Buffer.alloc(BIG_PHOTO.width * 4);
  const green = BIG_PHOTO_CHANNEL_BASE + (y % PIXEL_RAMP_MODULUS);
  for (let x = 0; x < BIG_PHOTO.width; x += 1) {
    const offset = x * 4;
    row[offset] = BIG_PHOTO_CHANNEL_BASE + (x % PIXEL_RAMP_MODULUS);
    row[offset + 1] = green;
    row[offset + 2] = BIG_PHOTO_BLUE_VALUE;
    row[offset + 3] = 255;
  }
  return row;
}

// --- Manifest --------------------------------------------------------------------------

function writeScale10Manifest() {
  writeFileSync(
    join(OUTPUT_DIRECTORY, MANIFEST_FILE_NAME),
    `${JSON.stringify(buildScale10Manifest(), null, 2)}\n`,
  );
  process.stdout.write(`wrote ${MANIFEST_FILE_NAME}\n`);
}

function buildScale10Manifest() {
  return {
    note: "Generated by scripts/generate-scale10-stack.mjs - do not edit by hand.",
    valueFormula: "value(band, x, y) = (band + 1) * 600 + (x % 100) + (y % 100)",
    reference: {
      headerFileName: ENVI_HEADER_FILE_NAME,
      binaryFileName: ENVI_BINARY_FILE_NAME,
      interleave: "bsq",
      ...describeCaptureForManifest(SCALE10_REFERENCE),
    },
    bandTiffFileNames: buildAllBandTiffFileNames(),
    flatField: { fileName: FLAT_FIELD_FILE_NAME, ...describeCaptureForManifest(SCALE10_FLAT_FIELD) },
    bigPhoto: {
      fileName: BIG_PHOTO_FILE_NAME,
      width: BIG_PHOTO.width,
      height: BIG_PHOTO.height,
      channelFormula: BIG_PHOTO_CHANNEL_FORMULA,
    },
  };
}

function buildAllBandTiffFileNames() {
  return Array.from({ length: SCALE10_REFERENCE.bandCount }, (_, bandIndex) =>
    buildBandTiffFileName(bandIndex),
  );
}

function reportWrittenFile(fileName, byteCount) {
  process.stdout.write(`wrote ${fileName} (${byteCount} bytes)\n`);
}

await generateScale10Fixtures();
