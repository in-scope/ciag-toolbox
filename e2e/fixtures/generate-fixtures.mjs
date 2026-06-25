// Deterministic E2E fixture generator (CT-114).
//
// Run with: pnpm e2e:fixtures (or `node e2e/fixtures/generate-fixtures.mjs`).
// It rewrites the committed fixtures byte-for-byte on every run (no clocks, no
// randomness), so the suite can assert EXACT pixel readouts and band means.
//
// Every fixture below is tiny (kilobytes) and math-predictable. The expected
// values are derived from the same formulas that fill the pixels and are
// written to manifest.json so specs assert against documented numbers rather
// than magic constants. Do NOT depend on the large captures in test-images/.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const FIXTURES_DIRECTORY = dirname(fileURLToPath(import.meta.url));

function generateAllFixtures() {
  const fixtures = buildAllFixtures();
  writeAllFixtureFiles(fixtures);
  writeManifestFile(fixtures);
}

function buildAllFixtures() {
  return {
    lowContrastGrayPng: buildLowContrastGrayscalePngFixture(),
    rgbPng: buildKnownRgbPngFixture(),
    multiBandTiff: buildMultiBandTwelveBitTiffFixture(),
    flatFieldReferenceTiff: buildSingleBandReferenceTiffFixture(),
    enviStack: buildEnviStackFixture(),
    enviFloatStack: buildEnviFloatStackFixture(),
  };
}

function writeAllFixtureFiles(fixtures) {
  writeFixtureFile(fixtures.lowContrastGrayPng.fileName, fixtures.lowContrastGrayPng.bytes);
  writeFixtureFile(fixtures.rgbPng.fileName, fixtures.rgbPng.bytes);
  writeFixtureFile(fixtures.multiBandTiff.fileName, fixtures.multiBandTiff.bytes);
  writeFixtureFile(fixtures.flatFieldReferenceTiff.fileName, fixtures.flatFieldReferenceTiff.bytes);
  writeFixtureFile(fixtures.enviStack.headerFileName, fixtures.enviStack.headerBytes);
  writeFixtureFile(fixtures.enviStack.binaryFileName, fixtures.enviStack.binaryBytes);
  writeFixtureFile(fixtures.enviFloatStack.headerFileName, fixtures.enviFloatStack.headerBytes);
  writeFixtureFile(fixtures.enviFloatStack.binaryFileName, fixtures.enviFloatStack.binaryBytes);
}

function writeFixtureFile(fileName, bytes) {
  writeFileSync(join(FIXTURES_DIRECTORY, fileName), bytes);
  process.stdout.write(`wrote ${fileName} (${bytes.length} bytes)\n`);
}

function writeManifestFile(fixtures) {
  const manifest = buildFixtureManifest(fixtures);
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(FIXTURES_DIRECTORY, "manifest.json"), text);
  process.stdout.write("wrote manifest.json\n");
}

// --- Low-contrast 8-bit grayscale PNG ---------------------------------------
// 4x4, value(index) = 100 + index*2, index = y*4 + x, so 100..130 (range 30 of
// 255). Useful for the Normalized-viewing stretch and normalize-to-float tests.

const GRAY_FIXTURE_WIDTH = 4;
const GRAY_FIXTURE_HEIGHT = 4;

function buildLowContrastGrayscalePngFixture() {
  const samples = buildLowContrastGraySamples();
  return {
    fileName: "low-contrast-gray.png",
    width: GRAY_FIXTURE_WIDTH,
    height: GRAY_FIXTURE_HEIGHT,
    samples,
    bytes: encodeGrayscalePngBytes(GRAY_FIXTURE_WIDTH, GRAY_FIXTURE_HEIGHT, samples),
  };
}

function buildLowContrastGraySamples() {
  const samples = new Uint8Array(GRAY_FIXTURE_WIDTH * GRAY_FIXTURE_HEIGHT);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = 100 + index * 2;
  }
  return samples;
}

// --- 8-bit RGB PNG with known per-pixel R/G/B -------------------------------
// 2x2 with deliberately distinct channels so grayscale conversion and
// false-colour mapping can be checked against exact channel numbers.

const RGB_FIXTURE_WIDTH = 2;
const RGB_FIXTURE_HEIGHT = 2;

const RGB_FIXTURE_PIXELS = [
  { x: 0, y: 0, r: 200, g: 100, b: 50 },
  { x: 1, y: 0, r: 10, g: 20, b: 30 },
  { x: 0, y: 1, r: 255, g: 0, b: 0 },
  { x: 1, y: 1, r: 0, g: 255, b: 0 },
];

function buildKnownRgbPngFixture() {
  const samples = buildKnownRgbSamples();
  return {
    fileName: "rgb.png",
    width: RGB_FIXTURE_WIDTH,
    height: RGB_FIXTURE_HEIGHT,
    pixels: RGB_FIXTURE_PIXELS,
    bytes: encodeRgbPngBytes(RGB_FIXTURE_WIDTH, RGB_FIXTURE_HEIGHT, samples),
  };
}

function buildKnownRgbSamples() {
  const samples = new Uint8Array(RGB_FIXTURE_WIDTH * RGB_FIXTURE_HEIGHT * 3);
  for (const pixel of RGB_FIXTURE_PIXELS) {
    const base = (pixel.y * RGB_FIXTURE_WIDTH + pixel.x) * 3;
    samples[base] = pixel.r;
    samples[base + 1] = pixel.g;
    samples[base + 2] = pixel.b;
  }
  return samples;
}

// --- Multi-band 12-bit-in-16-bit TIFF stack ---------------------------------
// 4x4, 3 pages (bands), uint16 container holding 12-bit values (<= 4095).
// value(band, index) = bandBase[band] + index*10, index = y*4 + x. The per-band
// bases give distinct means; the per-pixel ramp lets specs read true values at
// known coordinates (and bit-shift-by-4 multiplies each by 16, staying < 4096*16).

const STACK_WIDTH = 4;
const STACK_HEIGHT = 4;
const STACK_BAND_BASES = [100, 800, 1600];
const STACK_VALUE_STEP = 10;

function buildMultiBandTwelveBitTiffFixture() {
  const bands = STACK_BAND_BASES.map(buildRampBandFromBase);
  return {
    fileName: "multiband-12bit.tif",
    width: STACK_WIDTH,
    height: STACK_HEIGHT,
    bands,
    bytes: encodeMultiPageUint16TiffBytes(STACK_WIDTH, STACK_HEIGHT, bands),
  };
}

function buildRampBandFromBase(base) {
  const band = new Uint16Array(STACK_WIDTH * STACK_HEIGHT);
  for (let index = 0; index < band.length; index += 1) {
    band[index] = base + index * STACK_VALUE_STEP;
  }
  return band;
}

// --- Same-size single-band reference TIFF for flat-field broadcast ----------
// 4x4 (matches the stack), uniform 1000 so it can be broadcast across all
// bands without introducing a zero divisor in the flat-field formula.

const FLAT_FIELD_REFERENCE_VALUE = 1000;

function buildSingleBandReferenceTiffFixture() {
  const band = new Uint16Array(STACK_WIDTH * STACK_HEIGHT).fill(FLAT_FIELD_REFERENCE_VALUE);
  return {
    fileName: "flat-field-reference.tif",
    width: STACK_WIDTH,
    height: STACK_HEIGHT,
    bands: [band],
    bytes: encodeMultiPageUint16TiffBytes(STACK_WIDTH, STACK_HEIGHT, [band]),
  };
}

// --- Single-file ENVI stack (.hdr + binary) with wavelengths ----------------
// 4x4, 3 bands, uint16 (data type 12), BSQ, little-endian, with wavelength
// metadata. value(band, index) = enviBase[band] + index, distinct band means.

const ENVI_WIDTH = 4;
const ENVI_HEIGHT = 4;
const ENVI_BAND_BASES = [200, 1000, 1800];
const ENVI_WAVELENGTHS = [450, 550, 650];
const ENVI_DATA_TYPE_UINT16 = 12;

function buildEnviStackFixture() {
  const bands = ENVI_BAND_BASES.map(buildEnviRampBandFromBase);
  return {
    headerFileName: "envi-stack.hdr",
    binaryFileName: "envi-stack.bin",
    width: ENVI_WIDTH,
    height: ENVI_HEIGHT,
    bands,
    wavelengths: ENVI_WAVELENGTHS,
    headerBytes: encodeEnviHeaderBytes(),
    binaryBytes: encodeEnviBandSequentialUint16Binary(bands),
  };
}

function buildEnviRampBandFromBase(base) {
  const band = new Uint16Array(ENVI_WIDTH * ENVI_HEIGHT);
  for (let index = 0; index < band.length; index += 1) {
    band[index] = base + index;
  }
  return band;
}

function encodeEnviHeaderBytes() {
  const lines = [
    "ENVI",
    `samples = ${ENVI_WIDTH}`,
    `lines = ${ENVI_HEIGHT}`,
    `bands = ${ENVI_BAND_BASES.length}`,
    "header offset = 0",
    "file type = ENVI Standard",
    `data type = ${ENVI_DATA_TYPE_UINT16}`,
    "interleave = bsq",
    "byte order = 0",
    `wavelength = { ${ENVI_WAVELENGTHS.join(", ")} }`,
  ];
  return Buffer.from(`${lines.join("\n")}\n`, "utf-8");
}

function encodeEnviBandSequentialUint16Binary(bands) {
  const samplesPerBand = ENVI_WIDTH * ENVI_HEIGHT;
  const buffer = Buffer.alloc(bands.length * samplesPerBand * 2);
  bands.forEach((band, bandIndex) => {
    writeBandSequentialUint16Run(buffer, band, bandIndex * samplesPerBand * 2);
  });
  return buffer;
}

function writeBandSequentialUint16Run(buffer, band, baseByteOffset) {
  for (let index = 0; index < band.length; index += 1) {
    buffer.writeUInt16LE(band[index], baseByteOffset + index * 2);
  }
}

// --- Single-file ENVI float32 stack (.hdr + binary), values straddling [0,1] --
// CT-198: 4x4, 3 bands, float32 (data type 4), BSQ, little-endian. Band 0 is a
// mostly-negative field (-1.0) with four bright (+1.5) pixels in the centre, so its
// extents straddle [0,1] (some < 0, some > 1). Opening the Tone Curve panel on a float
// band must NOT restretch it: with the float default-identity fix the negatives stay
// black and only the four bright pixels light up, exactly as before the panel opened.

const ENVI_FLOAT_WIDTH = 4;
const ENVI_FLOAT_HEIGHT = 4;
const ENVI_FLOAT_DATA_TYPE = 4;
const ENVI_FLOAT_WAVELENGTHS = [500, 600, 700];
const ENVI_FLOAT_DARK_VALUE = -1.0;
const ENVI_FLOAT_BRIGHT_VALUE = 1.5;
const ENVI_FLOAT_BRIGHT_INDICES = [5, 6, 9, 10];

function buildEnviFloatStackFixture() {
  const bands = [buildMostlyDarkFloatBandWithBrightCentre(), buildFloatRampBand(-0.5, 0.12), buildFloatRampBand(-0.8, 0.15)];
  return {
    headerFileName: "envi-float-stack.hdr",
    binaryFileName: "envi-float-stack.bin",
    width: ENVI_FLOAT_WIDTH,
    height: ENVI_FLOAT_HEIGHT,
    bands,
    wavelengths: ENVI_FLOAT_WAVELENGTHS,
    headerBytes: encodeEnviFloatHeaderBytes(),
    binaryBytes: encodeEnviBandSequentialFloat32Binary(bands),
  };
}

function buildMostlyDarkFloatBandWithBrightCentre() {
  const band = new Float32Array(ENVI_FLOAT_WIDTH * ENVI_FLOAT_HEIGHT).fill(ENVI_FLOAT_DARK_VALUE);
  for (const index of ENVI_FLOAT_BRIGHT_INDICES) band[index] = ENVI_FLOAT_BRIGHT_VALUE;
  return band;
}

function buildFloatRampBand(base, step) {
  const band = new Float32Array(ENVI_FLOAT_WIDTH * ENVI_FLOAT_HEIGHT);
  for (let index = 0; index < band.length; index += 1) band[index] = base + index * step;
  return band;
}

function encodeEnviFloatHeaderBytes() {
  const lines = [
    "ENVI",
    `samples = ${ENVI_FLOAT_WIDTH}`,
    `lines = ${ENVI_FLOAT_HEIGHT}`,
    `bands = ${ENVI_FLOAT_WAVELENGTHS.length}`,
    "header offset = 0",
    "file type = ENVI Standard",
    `data type = ${ENVI_FLOAT_DATA_TYPE}`,
    "interleave = bsq",
    "byte order = 0",
    `wavelength = { ${ENVI_FLOAT_WAVELENGTHS.join(", ")} }`,
  ];
  return Buffer.from(`${lines.join("\n")}\n`, "utf-8");
}

function encodeEnviBandSequentialFloat32Binary(bands) {
  const samplesPerBand = ENVI_FLOAT_WIDTH * ENVI_FLOAT_HEIGHT;
  const buffer = Buffer.alloc(bands.length * samplesPerBand * 4);
  bands.forEach((band, bandIndex) => {
    writeBandSequentialFloat32Run(buffer, band, bandIndex * samplesPerBand * 4);
  });
  return buffer;
}

function writeBandSequentialFloat32Run(buffer, band, baseByteOffset) {
  for (let index = 0; index < band.length; index += 1) {
    buffer.writeFloatLE(band[index], baseByteOffset + index * 4);
  }
}

// --- PNG encoding -----------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_BIT_DEPTH_8 = 8;
const PNG_COLOR_TYPE_GRAYSCALE = 0;
const PNG_COLOR_TYPE_RGB = 2;
const crc32Table = buildCrc32Table();

function encodeGrayscalePngBytes(width, height, samples) {
  const scanlines = buildFilteredScanlines(samples, width);
  return assemblePngBytes(width, height, PNG_COLOR_TYPE_GRAYSCALE, scanlines);
}

function encodeRgbPngBytes(width, height, samples) {
  const scanlines = buildFilteredScanlines(samples, width * 3);
  return assemblePngBytes(width, height, PNG_COLOR_TYPE_RGB, scanlines);
}

function assemblePngBytes(width, height, colorType, rawScanlines) {
  const header = encodePngChunk("IHDR", buildPngHeaderData(width, height, colorType));
  const data = encodePngChunk("IDAT", deflateSync(rawScanlines));
  const end = encodePngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([PNG_SIGNATURE, header, data, end]);
}

function buildPngHeaderData(width, height, colorType) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = PNG_BIT_DEPTH_8;
  data[9] = colorType;
  return data;
}

function buildFilteredScanlines(samples, bytesPerRow) {
  const rows = [];
  for (let offset = 0; offset < samples.length; offset += bytesPerRow) {
    rows.push(Buffer.from([0, ...samples.subarray(offset, offset + bytesPerRow)]));
  }
  return Buffer.concat(rows);
}

function encodePngChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = buildUint32BigEndianBuffer(data.length);
  const checksum = buildUint32BigEndianBuffer(computeCrc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
}

function buildUint32BigEndianBuffer(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function computeCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    table[index] = computeCrc32TableEntry(index);
  }
  return table;
}

function computeCrc32TableEntry(byteValue) {
  let remainder = byteValue;
  for (let bit = 0; bit < 8; bit += 1) {
    remainder = remainder & 1 ? 0xedb88320 ^ (remainder >>> 1) : remainder >>> 1;
  }
  return remainder >>> 0;
}

// --- Multi-page uint16 TIFF encoding ----------------------------------------
// One classic little-endian directory (IFD) per band, each followed by its own
// uncompressed strip. The TIFF loader reads each same-shape page as one band.

const TIFF_TYPE_SHORT = 3;
const TIFF_TYPE_LONG = 4;
const TIFF_ENTRY_COUNT = 10;
const TIFF_IFD_BYTE_SIZE = 2 + TIFF_ENTRY_COUNT * 12 + 4;
const TIFF_FIRST_IFD_OFFSET = 8;

function encodeMultiPageUint16TiffBytes(width, height, bands) {
  const stripByteSize = width * height * 2;
  const pageBlockSize = TIFF_IFD_BYTE_SIZE + stripByteSize;
  const view = allocateTiffView(bands.length, pageBlockSize);
  writeLittleEndianTiffHeader(view);
  bands.forEach((band, pageIndex) => {
    writeTiffPage(view, pageIndex, bands.length, pageBlockSize, width, height, band);
  });
  return new Uint8Array(view.buffer);
}

function allocateTiffView(pageCount, pageBlockSize) {
  const totalSize = TIFF_FIRST_IFD_OFFSET + pageCount * pageBlockSize;
  return new DataView(new ArrayBuffer(totalSize));
}

function writeLittleEndianTiffHeader(view) {
  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49);
  view.setUint16(2, 42, true);
  view.setUint32(4, TIFF_FIRST_IFD_OFFSET, true);
}

function writeTiffPage(view, pageIndex, pageCount, pageBlockSize, width, height, band) {
  const ifdOffset = TIFF_FIRST_IFD_OFFSET + pageIndex * pageBlockSize;
  const stripOffset = ifdOffset + TIFF_IFD_BYTE_SIZE;
  const nextIfdOffset = pageIndex < pageCount - 1 ? ifdOffset + pageBlockSize : 0;
  const entries = buildTiffPageEntries(width, height, stripOffset);
  writeIfdAtOffset(view, ifdOffset, entries, nextIfdOffset);
  writeUint16StripAtOffset(view, stripOffset, band);
}

function buildTiffPageEntries(width, height, stripOffset) {
  return [
    { tag: 256, type: TIFF_TYPE_SHORT, value: width },
    { tag: 257, type: TIFF_TYPE_SHORT, value: height },
    { tag: 258, type: TIFF_TYPE_SHORT, value: 16 },
    { tag: 259, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 262, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 273, type: TIFF_TYPE_LONG, value: stripOffset },
    { tag: 277, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 278, type: TIFF_TYPE_SHORT, value: height },
    { tag: 279, type: TIFF_TYPE_LONG, value: width * height * 2 },
    { tag: 339, type: TIFF_TYPE_SHORT, value: 1 },
  ];
}

function writeIfdAtOffset(view, ifdOffset, entries, nextIfdOffset) {
  view.setUint16(ifdOffset, entries.length, true);
  entries.forEach((entry, entryIndex) => {
    writeIfdEntry(view, ifdOffset + 2 + entryIndex * 12, entry);
  });
  view.setUint32(ifdOffset + 2 + entries.length * 12, nextIfdOffset, true);
}

function writeIfdEntry(view, offset, entry) {
  view.setUint16(offset, entry.tag, true);
  view.setUint16(offset + 2, entry.type, true);
  view.setUint32(offset + 4, 1, true);
  writeIfdEntryValue(view, offset + 8, entry);
}

function writeIfdEntryValue(view, offset, entry) {
  if (entry.type === TIFF_TYPE_SHORT) {
    view.setUint16(offset, entry.value, true);
    return;
  }
  view.setUint32(offset, entry.value, true);
}

function writeUint16StripAtOffset(view, offset, band) {
  for (let index = 0; index < band.length; index += 1) {
    view.setUint16(offset + index * 2, band[index], true);
  }
}

// --- Manifest ---------------------------------------------------------------

function buildFixtureManifest(fixtures) {
  return {
    note: "Generated by e2e/fixtures/generate-fixtures.mjs - do not edit by hand.",
    lowContrastGrayPng: describeGrayscaleFixture(fixtures.lowContrastGrayPng),
    rgbPng: describeRgbFixture(fixtures.rgbPng),
    multiBandTiff: describeStackFixture(fixtures.multiBandTiff, "uint16"),
    flatFieldReferenceTiff: describeStackFixture(fixtures.flatFieldReferenceTiff, "uint16"),
    enviStack: describeEnviFixture(fixtures.enviStack),
    enviFloatStack: describeEnviFloatFixture(fixtures.enviFloatStack),
  };
}

function describeEnviFloatFixture(fixture) {
  return {
    headerFileName: fixture.headerFileName,
    binaryFileName: fixture.binaryFileName,
    width: fixture.width,
    height: fixture.height,
    bandCount: fixture.bands.length,
    dataType: "float32",
    wavelengths: fixture.wavelengths,
    bandMeans: fixture.bands.map(computeMean),
    samplePixels: buildStackCornerSamplePixels(fixture.bands, fixture.width, fixture.height),
  };
}

function describeGrayscaleFixture(fixture) {
  return {
    fileName: fixture.fileName,
    width: fixture.width,
    height: fixture.height,
    bandCount: 1,
    dataType: "uint8",
    samplePixels: [
      buildSamplePixel(0, 0, [fixture.samples[0]]),
      buildSamplePixel(3, 3, [fixture.samples[fixture.samples.length - 1]]),
    ],
  };
}

function describeRgbFixture(fixture) {
  return {
    fileName: fixture.fileName,
    width: fixture.width,
    height: fixture.height,
    bandCount: 3,
    dataType: "uint8",
    samplePixels: fixture.pixels.map((pixel) =>
      buildSamplePixel(pixel.x, pixel.y, [pixel.r, pixel.g, pixel.b]),
    ),
  };
}

function describeStackFixture(fixture, dataType) {
  return {
    fileName: fixture.fileName,
    width: fixture.width,
    height: fixture.height,
    bandCount: fixture.bands.length,
    dataType,
    bandMeans: fixture.bands.map(computeMean),
    samplePixels: buildStackCornerSamplePixels(fixture.bands, fixture.width, fixture.height),
  };
}

function describeEnviFixture(fixture) {
  return {
    headerFileName: fixture.headerFileName,
    binaryFileName: fixture.binaryFileName,
    width: fixture.width,
    height: fixture.height,
    bandCount: fixture.bands.length,
    dataType: "uint16",
    wavelengths: fixture.wavelengths,
    bandMeans: fixture.bands.map(computeMean),
    samplePixels: buildStackCornerSamplePixels(fixture.bands, fixture.width, fixture.height),
  };
}

function buildStackCornerSamplePixels(bands, width, height) {
  const lastIndex = width * height - 1;
  return [
    buildSamplePixel(0, 0, bands.map((band) => band[0])),
    buildSamplePixel(width - 1, height - 1, bands.map((band) => band[lastIndex])),
  ];
}

function buildSamplePixel(x, y, valuesPerBand) {
  return { x, y, valuesPerBand: valuesPerBand.map((value) => Number(value)) };
}

function computeMean(band) {
  let total = 0;
  for (const value of band) total += value;
  return total / band.length;
}

generateAllFixtures();
