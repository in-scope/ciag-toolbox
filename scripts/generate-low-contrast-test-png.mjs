// Generates a deliberately low-contrast PNG for visually verifying that the
// Normalize tool stretches an image's intensity range.
// Run with: node scripts/generate-low-contrast-test-png.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildRgbaPng } from "./png-utils.mjs";

const IMAGE_WIDTH_PIXELS = 512;
const IMAGE_HEIGHT_PIXELS = 320;
const MIN_INTENSITY = 70;
const MAX_INTENSITY = 130;
const FRAME_INTENSITY = 150;
const FRAME_THICKNESS_PIXELS = 8;
const CIRCLE_RADIUS_PIXELS = 60;
const CIRCLE_INTENSITY = 120;

function computeHorizontalGradientIntensity(x) {
  const ratio = x / (IMAGE_WIDTH_PIXELS - 1);
  return Math.round(MIN_INTENSITY + ratio * (MAX_INTENSITY - MIN_INTENSITY));
}

function isOnFrameBorder(x, y) {
  const limit = FRAME_THICKNESS_PIXELS;
  return (
    x < limit ||
    x >= IMAGE_WIDTH_PIXELS - limit ||
    y < limit ||
    y >= IMAGE_HEIGHT_PIXELS - limit
  );
}

function isInsideCenterCircle(x, y) {
  const dx = x - IMAGE_WIDTH_PIXELS / 2;
  const dy = y - IMAGE_HEIGHT_PIXELS / 2;
  return dx * dx + dy * dy <= CIRCLE_RADIUS_PIXELS * CIRCLE_RADIUS_PIXELS;
}

function chooseIntensityForPixel(x, y) {
  if (isOnFrameBorder(x, y)) return FRAME_INTENSITY;
  if (isInsideCenterCircle(x, y)) return CIRCLE_INTENSITY;
  return computeHorizontalGradientIntensity(x);
}

function writeGrayscalePixelAt(buffer, x, y, intensity) {
  const offset = (y * IMAGE_WIDTH_PIXELS + x) * 4;
  buffer[offset] = intensity;
  buffer[offset + 1] = intensity;
  buffer[offset + 2] = intensity;
  buffer[offset + 3] = 255;
}

function writeScanlineIntensities(buffer, y) {
  for (let x = 0; x < IMAGE_WIDTH_PIXELS; x++) {
    writeGrayscalePixelAt(buffer, x, y, chooseIntensityForPixel(x, y));
  }
}

function buildLowContrastRgbaPixelBuffer() {
  const buffer = Buffer.alloc(IMAGE_WIDTH_PIXELS * IMAGE_HEIGHT_PIXELS * 4);
  for (let y = 0; y < IMAGE_HEIGHT_PIXELS; y++) {
    writeScanlineIntensities(buffer, y);
  }
  return buffer;
}

function resolveOutputPath() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  return resolve(scriptDir, "..", "test-images", "low-contrast-sample.png");
}

function writeLowContrastTestPng() {
  const pixels = buildLowContrastRgbaPixelBuffer();
  const png = buildRgbaPng(IMAGE_WIDTH_PIXELS, IMAGE_HEIGHT_PIXELS, pixels);
  const outputPath = resolveOutputPath();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, png);
  console.log(`Wrote ${outputPath} (${png.length} bytes)`);
}

writeLowContrastTestPng();
