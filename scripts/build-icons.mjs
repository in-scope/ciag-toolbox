import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import sharp from "sharp";
import IconGen from "icon-gen";
import toIco from "png-to-ico";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const STACKED_LOGO_SVG_PATH = resolve(PROJECT_ROOT, "build/logo.svg");
const COMPACT_LOGO_SVG_PATH = resolve(PROJECT_ROOT, "build/logo-compact.svg");
const OUTPUT_DIR = resolve(PROJECT_ROOT, "build");
const ICO_OUTPUT_PATH = resolve(OUTPUT_DIR, "icon.ico");
const ICNS_SOURCE_PNG_PATH = resolve(OUTPUT_DIR, "icon-source.png");

const COMPACT_VARIANT_SIZES = [16, 24, 32];
const STACKED_VARIANT_SIZES = [48, 64, 128, 256];

async function renderSvgToHighResolutionPngBuffer(svgPath) {
  return sharp(svgPath, { density: 600 }).resize(1024, 1024).png().toBuffer();
}

async function downsamplePngBufferToSize(sourceBuffer, sizeInPixels) {
  return sharp(sourceBuffer).resize(sizeInPixels, sizeInPixels).png().toBuffer();
}

async function buildPngBuffersForSizes(sourceBuffer, sizes) {
  return Promise.all(sizes.map((size) => downsamplePngBufferToSize(sourceBuffer, size)));
}

async function buildWindowsIcoWithPerSizeArtwork() {
  const compactSource = await renderSvgToHighResolutionPngBuffer(COMPACT_LOGO_SVG_PATH);
  const stackedSource = await renderSvgToHighResolutionPngBuffer(STACKED_LOGO_SVG_PATH);
  const compactBuffers = await buildPngBuffersForSizes(compactSource, COMPACT_VARIANT_SIZES);
  const stackedBuffers = await buildPngBuffersForSizes(stackedSource, STACKED_VARIANT_SIZES);
  const icoBuffer = await toIco([...compactBuffers, ...stackedBuffers]);
  await writeFile(ICO_OUTPUT_PATH, icoBuffer);
}

async function buildMacOsIcnsFromStackedArtwork() {
  await sharp(STACKED_LOGO_SVG_PATH, { density: 600 })
    .resize(1024, 1024)
    .png()
    .toFile(ICNS_SOURCE_PNG_PATH);
  await IconGen(ICNS_SOURCE_PNG_PATH, OUTPUT_DIR, {
    report: true,
    icns: { name: "icon", sizes: [16, 32, 64, 128, 256, 512, 1024] },
  });
}

async function removeIntermediateOutputs() {
  await rm(resolve(OUTPUT_DIR, "out"), { recursive: true, force: true });
  await rm(ICNS_SOURCE_PNG_PATH, { force: true });
}

async function ensureBuildDirectoryExists() {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

async function buildAllApplicationIcons() {
  await ensureBuildDirectoryExists();
  await buildWindowsIcoWithPerSizeArtwork();
  await buildMacOsIcnsFromStackedArtwork();
  await removeIntermediateOutputs();
}

buildAllApplicationIcons().catch((error) => {
  console.error(error);
  process.exit(1);
});
