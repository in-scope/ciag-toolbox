import { test, expect } from "@playwright/test";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";

import {
  enviStack,
  flatFieldReferenceTiff,
  lowContrastGrayPng,
  multiBandTiff,
  rgbPng,
} from "./fixtures/fixture-manifest";
import { enqueueSaveDialogPath } from "./support/dialog-stub-controls";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { triggerSaveImageMenuItem } from "./support/main-process";
import {
  averageNonClearCanvasColor,
  chooseSaveImageFormat,
  clickGridBackgroundToClearSelection,
  colorfulNonClearPixelFraction,
  confirmSaveImageFormat,
  createTemporaryExportDirectory,
  loadFixtureAsStack,
  loadImageFromAbsolutePath,
  panelCanvas,
  readMetadata,
  saveImageFormatPicker,
  selectGridLayout,
} from "./support/page-objects";

// Input-format x export-format round-trip matrix. This suite is deliberately NOT in CI:
// it leans on GPU-composited canvas readback (not pixel-identical across machines) to verify
// the IMPLICIT operations that run on open - true-colour compositing, per-channel
// normalisation, the stack-vs-photo decision - which the byte-level encode-*.test.ts unit
// suites cannot see. Each cell loads a committed fixture, exports it through the real Save
// dialog, reopens the written file, and compares the reopened render against the
// live-captured source render (relative, never magic constants).
//
// The expected outcome of every cell is DERIVED from two facts about the app (see
// encode-saved-image.ts):
//   1. A plain-opened PNG/JPG is a BROWSER-IMAGE source promoted to a true-colour R/G/B
//      raster. ENVI export rejects it outright, a float TIFF silently writes uint (no float
//      data exists in an 8-bit photo), and PNG/JPEG/TIFF keep it true-colour on reopen: a
//      TIFF written from a true-colour source carries PhotometricInterpretation RGB, so the
//      loader (CT-160) reopens it as a 3-band RGB composite, not a grey band.
//   2. A raster (TIFF/ENVI) science source exports the selected band to TIFF, the whole cube
//      to ENVI, and a single rendered band to PNG/JPEG; those TIFF/ENVI reopen as grayscale
//      stacks because the science source carries no true-colour tag to write.

const SOURCE_PANEL = 1;
const RELOADED_PANEL = 2;

// A render keeps its colour when channels visibly diverge; a render that lost its colour
// collapses to R==G==B and falls below the ceiling. Tuned on the calibration rows below;
// generous because this is not a CI gate.
const GRAYSCALE_FRACTION_CEILING = 0.08;
const TRUE_COLOUR_FRACTION_FLOOR = 0.25;
const LUMINANCE_TOLERANCE = 28;
const LOSSY_LUMINANCE_TOLERANCE = 48;

type InputKind = "trueColour" | "raster";
type ExportKind = "tiff-uint" | "tiff-float" | "canvas" | "envi-uint" | "envi-float";
type SaveOutcome = "saved" | "rejected";
type ReloadedSampleFormat = "-" | "uint" | "float";

interface InputFixture {
  readonly label: string;
  readonly committedFileName: string;
  readonly kind: InputKind;
}

interface ExportFormat {
  readonly pickerLabel: string;
  readonly destinationExtension: string;
  readonly kind: ExportKind;
  readonly isLossyCompressed: boolean;
}

interface RenderedSignature {
  readonly luminance: number;
  readonly colourfulFraction: number;
  readonly sampleFormat: string;
  readonly width: string;
  readonly height: string;
  readonly bandCount: string;
}

interface CellExpectation {
  readonly saveRejected: boolean;
  readonly reloadedSampleFormat: ReloadedSampleFormat;
  readonly reopenTracksSourceColour: boolean;
}

const INPUT_FIXTURES: ReadonlyArray<InputFixture> = [
  { label: "grayscale PNG", committedFileName: lowContrastGrayPng.fileName, kind: "trueColour" },
  { label: "true-colour RGB PNG", committedFileName: rgbPng.fileName, kind: "trueColour" },
  { label: "uint16 stack TIFF", committedFileName: multiBandTiff.fileName, kind: "raster" },
  { label: "single-band reference TIFF", committedFileName: flatFieldReferenceTiff.fileName, kind: "raster" },
  { label: "uint16 ENVI stack", committedFileName: enviStack.headerFileName, kind: "raster" },
];

const EXPORT_FORMATS: ReadonlyArray<ExportFormat> = [
  { pickerLabel: "TIFF (16-bit)", destinationExtension: "tif", kind: "tiff-uint", isLossyCompressed: false },
  { pickerLabel: "TIFF (8-bit)", destinationExtension: "tif", kind: "tiff-uint", isLossyCompressed: false },
  { pickerLabel: "TIFF (32-bit float)", destinationExtension: "tif", kind: "tiff-float", isLossyCompressed: false },
  { pickerLabel: "PNG (8-bit)", destinationExtension: "png", kind: "canvas", isLossyCompressed: false },
  { pickerLabel: "JPEG (8-bit)", destinationExtension: "jpg", kind: "canvas", isLossyCompressed: true },
  { pickerLabel: "ENVI (.hdr + .bin)", destinationExtension: "hdr", kind: "envi-uint", isLossyCompressed: false },
  { pickerLabel: "ENVI (32-bit float)", destinationExtension: "hdr", kind: "envi-float", isLossyCompressed: false },
];

for (const fixture of INPUT_FIXTURES) {
  for (const format of EXPORT_FORMATS) {
    test(`${fixture.label} exported as ${format.pickerLabel} reopens as documented`, async () => {
      await withFreshApp((launched) => runRoundTripCell(launched, fixture, format));
    });
  }
}

function expectedCellOutcome(fixture: InputFixture, format: ExportFormat): CellExpectation {
  if (isEnviKind(format.kind) && fixture.kind === "trueColour") {
    return { saveRejected: true, reloadedSampleFormat: "-", reopenTracksSourceColour: false };
  }
  if (format.kind === "canvas") {
    return { saveRejected: false, reloadedSampleFormat: "-", reopenTracksSourceColour: true };
  }
  if (fixture.kind === "trueColour" && isTiffKind(format.kind)) {
    return { saveRejected: false, reloadedSampleFormat: "uint", reopenTracksSourceColour: true };
  }
  return {
    saveRejected: false,
    reloadedSampleFormat: reloadedRasterSampleFormat(fixture, format),
    reopenTracksSourceColour: false,
  };
}

function isEnviKind(kind: ExportKind): boolean {
  return kind === "envi-uint" || kind === "envi-float";
}

function isTiffKind(kind: ExportKind): boolean {
  return kind === "tiff-uint" || kind === "tiff-float";
}

function isFloatKind(kind: ExportKind): boolean {
  return kind === "tiff-float" || kind === "envi-float";
}

// A float export only yields float data when there is float data to write: raster stacks
// keep float, but an 8-bit browser photo comes back uint regardless of the chosen format.
function reloadedRasterSampleFormat(fixture: InputFixture, format: ExportFormat): ReloadedSampleFormat {
  return isFloatKind(format.kind) && fixture.kind === "raster" ? "float" : "uint";
}

async function runRoundTripCell(
  launched: LaunchedApp,
  fixture: InputFixture,
  format: ExportFormat,
): Promise<void> {
  const expectation = expectedCellOutcome(fixture, format);
  await loadSourceIntoFirstPanelOfTwo(launched.window, fixture);
  const source = await captureRenderedSignature(launched.window, SOURCE_PANEL);
  const exportPath = await buildTemporaryExportPath(format);
  const outcome = await exportSelectedSourceThroughSaveDialog(launched, format, exportPath);
  if (expectation.saveRejected) return assertSaveWasRejected(outcome, fixture, format, source);
  await completeAndAssertReopen(launched, fixture, format, exportPath, source, expectation);
}

function assertSaveWasRejected(
  outcome: SaveOutcome,
  fixture: InputFixture,
  format: ExportFormat,
  source: RenderedSignature,
): void {
  logCalibrationRow(fixture, format, source, undefined);
  expect(outcome).toBe("rejected");
}

async function completeAndAssertReopen(
  launched: LaunchedApp,
  fixture: InputFixture,
  format: ExportFormat,
  exportPath: string,
  source: RenderedSignature,
  expectation: CellExpectation,
): Promise<void> {
  await expectWrittenFilesAreNonEmpty(exportPath, format);
  await loadImageFromAbsolutePath(launched.window, exportPath);
  const reloaded = await captureRenderedSignature(launched.window, RELOADED_PANEL);
  logCalibrationRow(fixture, format, source, reloaded);
  assertReloadedRenderMatchesExpectation(source, reloaded, format, expectation);
}

// A 1x2 grid keeps the source in panel 1 and the reopened copy in panel 2. The background
// click dismisses the Grid Layout tooltip before any panel loads; loading then selects
// panel 1, so the subsequent Save dialog targets the source.
async function loadSourceIntoFirstPanelOfTwo(window: Page, fixture: InputFixture): Promise<void> {
  await selectGridLayout(window, "1x2");
  await clickGridBackgroundToClearSelection(window);
  await loadFixtureAsStack(window, fixture.committedFileName);
}

async function buildTemporaryExportPath(format: ExportFormat): Promise<string> {
  return join(await createTemporaryExportDirectory(), `roundtrip.${format.destinationExtension}`);
}

async function exportSelectedSourceThroughSaveDialog(
  launched: LaunchedApp,
  format: ExportFormat,
  exportPath: string,
): Promise<SaveOutcome> {
  await enqueueSaveDialogPath(launched.window, exportPath);
  await triggerSaveImageMenuItem(launched.app);
  await expect(saveImageFormatPicker(launched.window)).toBeVisible();
  await chooseSaveImageFormat(launched.window, format.pickerLabel);
  await confirmSaveImageFormat(launched.window);
  return waitForSaveSuccessOrRejection(launched.window);
}

async function waitForSaveSuccessOrRejection(window: Page): Promise<SaveOutcome> {
  const saved = window.getByText("Saved to", { exact: false }).first();
  const rejected = window.getByText("Could not save", { exact: false }).first();
  await expect(saved.or(rejected)).toBeVisible();
  return (await rejected.isVisible()) ? "rejected" : "saved";
}

async function captureRenderedSignature(window: Page, panel: number): Promise<RenderedSignature> {
  const canvas = panelCanvas(window, panel);
  const averageColour = await averageNonClearCanvasColor(canvas);
  const metadata = await readMetadata(window);
  return {
    luminance: (averageColour.red + averageColour.green + averageColour.blue) / 3,
    colourfulFraction: await colorfulNonClearPixelFraction(canvas),
    sampleFormat: metadata.sampleFormat,
    width: metadata.width,
    height: metadata.height,
    bandCount: metadata.bandCount,
  };
}

function assertReloadedRenderMatchesExpectation(
  source: RenderedSignature,
  reloaded: RenderedSignature,
  format: ExportFormat,
  expectation: CellExpectation,
): void {
  assertGeometryAndSampleFormatPreserved(source, reloaded, expectation);
  if (expectation.reopenTracksSourceColour) {
    assertColourCharacterTracksSource(source, reloaded, format);
    return;
  }
  assertReopenedAsGrayscale(source, reloaded, format);
}

function assertGeometryAndSampleFormatPreserved(
  source: RenderedSignature,
  reloaded: RenderedSignature,
  expectation: CellExpectation,
): void {
  expect(reloaded.width).toBe(source.width);
  expect(reloaded.height).toBe(source.height);
  expect(reloaded.sampleFormat).toBe(expectation.reloadedSampleFormat);
}

// PNG/JPEG reopen through the true-colour promote path, so the reopened image keeps the
// source's colour CHARACTER: a colourful source stays colourful and a grey source stays
// grey. The check is categorical, not an exact-fraction match, because lossy JPEG on a tiny
// image can push every surviving pixel over the colour threshold (fraction climbs to 1.0).
function assertColourCharacterTracksSource(
  source: RenderedSignature,
  reloaded: RenderedSignature,
  format: ExportFormat,
): void {
  if (source.colourfulFraction >= TRUE_COLOUR_FRACTION_FLOOR) {
    expect(reloaded.colourfulFraction).toBeGreaterThanOrEqual(TRUE_COLOUR_FRACTION_FLOOR);
  } else {
    expect(reloaded.colourfulFraction).toBeLessThanOrEqual(GRAYSCALE_FRACTION_CEILING);
  }
  expectLuminanceWithinTolerance(source, reloaded, format);
}

// A science-stack source (TIFF/ENVI) carries no true-colour tag, so its TIFF/ENVI reopen is
// treated as a STACK and rendered as a single grey band. A grey source is unaffected; only a
// colourful source visibly degrades here (so its luminance is not expected to survive the
// band collapse).
function assertReopenedAsGrayscale(
  source: RenderedSignature,
  reloaded: RenderedSignature,
  format: ExportFormat,
): void {
  expect(reloaded.colourfulFraction).toBeLessThanOrEqual(GRAYSCALE_FRACTION_CEILING);
  if (source.colourfulFraction < TRUE_COLOUR_FRACTION_FLOOR) {
    expectLuminanceWithinTolerance(source, reloaded, format);
  }
}

// Luminance is only comparable when the display regime survives. A float reopen renders
// against the fixed [0,1] float window, so un-normalised integer data (values far above 1)
// legitimately saturates to white and its on-screen luminance is not expected to match the
// integer-normalised source. We skip the luminance check there; geometry, sample format and
// colour character still pin the cell down.
function expectLuminanceWithinTolerance(
  source: RenderedSignature,
  reloaded: RenderedSignature,
  format: ExportFormat,
): void {
  if (reloaded.sampleFormat === "float") return;
  const tolerance = format.isLossyCompressed ? LOSSY_LUMINANCE_TOLERANCE : LUMINANCE_TOLERANCE;
  expect(Math.abs(reloaded.luminance - source.luminance)).toBeLessThanOrEqual(tolerance);
}

async function expectWrittenFilesAreNonEmpty(exportPath: string, format: ExportFormat): Promise<void> {
  await expectNonEmptyFileOnDisk(exportPath);
  if (isEnviKind(format.kind)) await expectNonEmptyFileOnDisk(replaceFileExtension(exportPath, "bin"));
}

async function expectNonEmptyFileOnDisk(filePath: string): Promise<void> {
  const stats = await stat(filePath);
  expect(stats.size).toBeGreaterThan(0);
}

function replaceFileExtension(filePath: string, newExtension: string): string {
  const lastDot = filePath.lastIndexOf(".");
  const stem = lastDot <= 0 ? filePath : filePath.slice(0, lastDot);
  return `${stem}.${newExtension}`;
}

// One row per cell so any run prints the real numbers the thresholds are tuned against.
function logCalibrationRow(
  fixture: InputFixture,
  format: ExportFormat,
  source: RenderedSignature,
  reloaded: RenderedSignature | undefined,
): void {
  const cell = `${fixture.label} -> ${format.pickerLabel}`;
  const src = describeSignatureForLog("src", source);
  const out = reloaded ? describeSignatureForLog("out", reloaded) : "out[REJECTED]";
  console.log(`[matrix] ${cell} | ${src} ${out}`);
}

function describeSignatureForLog(prefix: string, signature: RenderedSignature): string {
  const lum = signature.luminance.toFixed(1);
  const colour = signature.colourfulFraction.toFixed(3);
  return `${prefix}[lum=${lum} colour=${colour} ${signature.sampleFormat} bands=${signature.bandCount}]`;
}

async function withFreshApp(run: (launched: LaunchedApp) => Promise<void>): Promise<void> {
  const launched = await launchToolboxApp();
  try {
    await run(launched);
  } finally {
    await closeToolboxApp(launched);
  }
}
