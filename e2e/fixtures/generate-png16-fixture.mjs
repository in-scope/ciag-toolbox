// CT-272: generates gradient-gray16.png, a 16-bit grayscale PNG written by an
// EXTERNAL reference implementation (sharp/libvips), never by the app's own
// CT-271 encoder. The unit round-trip in src/main/png16-decode.test.ts and the
// e2e open spec both decode this committed file, so the app's decoder is
// checked against an independent encoder's real output (including whatever
// scanline filters libvips picks with adaptive filtering on).
//
// Run with: node e2e/fixtures/generate-png16-fixture.mjs
// The fixture is committed; regeneration is only needed if the formula changes.
// Pixel formula (pinned in fixture-manifest.ts): value = 300 + (y*width + x) * 500,
// so EVERY pixel exceeds 255 and an 8-bit downscale cannot round-trip.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const FIXTURES_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const FILE_NAME = "gradient-gray16.png";
const WIDTH = 6;
const HEIGHT = 4;

function buildGradientSamples() {
  const samples = new Uint16Array(WIDTH * HEIGHT);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = 300 + index * 500;
  }
  return samples;
}

async function encodeSixteenBitGrayscalePngWithReferenceTool(samples) {
  return sharp(samples, { raw: { width: WIDTH, height: HEIGHT, channels: 1 } })
    .toColourspace("grey16")
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function assertIhdrDeclaresSixteenBitGrayscale(pngBytes) {
  const bitDepth = pngBytes[24];
  const colorType = pngBytes[25];
  const interlaceMethod = pngBytes[28];
  if (bitDepth !== 16 || colorType !== 0 || interlaceMethod !== 0) {
    throw new Error(
      `Reference tool wrote bitDepth=${bitDepth} colorType=${colorType} interlace=${interlaceMethod}; expected non-interlaced 16-bit grayscale`,
    );
  }
}

async function assertReferenceToolReadsSamplesBackExactly(pngBytes, samples) {
  const { data, info } = await sharp(pngBytes)
    .toColourspace("grey16")
    .raw({ depth: "ushort" })
    .toBuffer({ resolveWithObject: true });
  const decoded = new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  if (info.channels !== 1 || decoded.length !== samples.length) {
    throw new Error("Reference decode returned an unexpected shape");
  }
  for (let index = 0; index < samples.length; index += 1) {
    if (decoded[index] !== samples[index]) {
      throw new Error(`Reference decode mismatch at index ${index}`);
    }
  }
}

const samples = buildGradientSamples();
const pngBytes = await encodeSixteenBitGrayscalePngWithReferenceTool(samples);
assertIhdrDeclaresSixteenBitGrayscale(pngBytes);
await assertReferenceToolReadsSamplesBackExactly(pngBytes, samples);
writeFileSync(join(FIXTURES_DIRECTORY, FILE_NAME), pngBytes);
process.stdout.write(`wrote ${FILE_NAME} (${pngBytes.length} bytes)\n`);
