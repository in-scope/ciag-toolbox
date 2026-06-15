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
  cancelSaveImageFormatPicker,
  chooseSaveImageFormat,
  clickGridBackgroundToClearSelection,
  colorfulNonClearPixelFraction,
  confirmSaveImageFormat,
  createTemporaryExportDirectory,
  expectSaveImageFormatOptionDisabledWithTooltip,
  loadFixtureAsStack,
  loadImageFromAbsolutePath,
  panelCanvas,
  readMetadata,
  saveImageFormatPicker,
  selectGridLayout,
} from "./support/page-objects";
import {
  expectNormalizedViewingEnabled,
  toggleNormalizedViewing,
} from "./support/normalized-viewing";

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
//      raster. CT-162: ENVI, ENVI (32-bit float) and TIFF (32-bit float) are DISABLED in the
//      Save-image picker for such a photo source (each with an explaining tooltip) and cannot
//      be chosen - replacing the old offer-then-reject (ENVI) and silent float->uint
//      downgrade (TIFF float). The remaining uint TIFF/PNG/JPEG keep it true-colour on
//      reopen: a TIFF written from a true-colour source carries PhotometricInterpretation
//      RGB, so the loader (CT-160) reopens it as a 3-band RGB composite, not a grey band.
//   2. A raster (TIFF/ENVI) science source exports the selected band to TIFF, the whole cube
//      to ENVI, and a single rendered band to PNG/JPEG; those TIFF/ENVI reopen as grayscale
//      stacks because the science source carries no true-colour tag to write.
//   3. CT-161: a 32-bit FLOAT reopen now auto-fits its display window to the data's extents
//      on open (load-tiff/ENVI float data lies outside [0,1]), so it renders the data
//      VISIBLY instead of the old saturated white frame. The reopen therefore tracks the
//      source's appearance shown fit-to-window (Normalized viewing) for varied data, or the
//      source's default view for degenerate/uniform data - never the white frame.

const SOURCE_PANEL = 1;
const RELOADED_PANEL = 2;

// A render keeps its colour when channels visibly diverge; a render that lost its colour
// collapses to R==G==B and falls below the ceiling. Tuned on the calibration rows below;
// generous because this is not a CI gate.
const GRAYSCALE_FRACTION_CEILING = 0.08;
const TRUE_COLOUR_FRACTION_FLOOR = 0.25;
const LUMINANCE_TOLERANCE = 28;
const LOSSY_LUMINANCE_TOLERANCE = 48;
// The WebGL redraw after toggling Normalized viewing runs in a post-commit effect,
// so let it settle before screenshotting the data-fit render.
const NORMALIZED_REDRAW_SETTLE_MS = 300;

type InputKind = "trueColour" | "raster";
type ExportKind = "tiff-uint" | "tiff-float" | "canvas" | "envi-uint" | "envi-float";
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
  // The source's luminance under Normalized viewing (data fit to the display
  // window). Captured only for raster sources of a float export, because a float
  // reopen auto-fits the same way (CT-161); undefined otherwise.
  readonly dataFitLuminance?: number;
}

interface CellExpectation {
  readonly disabledInPicker: boolean;
  readonly disabledReason: string | null;
  readonly reloadedSampleFormat: ReloadedSampleFormat;
  readonly reopenTracksSourceColour: boolean;
}

// CT-162: ENVI/float export cannot apply to a browser-image (photo) source, so the picker
// disables those options with an explaining tooltip rather than offering then rejecting them.
const ENVI_DISABLED_REASON = "ENVI is for raster/scientific stacks";
const FLOAT_DISABLED_REASON = "Float export needs raster data";

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
  if (fixture.kind === "trueColour" && isDisabledForPhotoSource(format)) {
    return {
      disabledInPicker: true,
      disabledReason: disabledReasonForPhotoSource(format),
      reloadedSampleFormat: "-",
      reopenTracksSourceColour: false,
    };
  }
  if (format.kind === "canvas") {
    return enabledCell("-", true);
  }
  if (fixture.kind === "trueColour" && isTiffKind(format.kind)) {
    return enabledCell("uint", true);
  }
  return enabledCell(reloadedRasterSampleFormat(fixture, format), false);
}

function enabledCell(
  reloadedSampleFormat: ReloadedSampleFormat,
  reopenTracksSourceColour: boolean,
): CellExpectation {
  return { disabledInPicker: false, disabledReason: null, reloadedSampleFormat, reopenTracksSourceColour };
}

function isDisabledForPhotoSource(format: ExportFormat): boolean {
  return isEnviKind(format.kind) || format.kind === "tiff-float";
}

function disabledReasonForPhotoSource(format: ExportFormat): string {
  return isEnviKind(format.kind) ? ENVI_DISABLED_REASON : FLOAT_DISABLED_REASON;
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
  if (expectation.disabledInPicker) {
    return assertFormatOptionDisabledInPicker(launched, format, expectation);
  }
  const source = await captureSourceSignature(launched.window, fixture, format);
  const exportPath = await buildTemporaryExportPath(format);
  await exportSelectedSourceThroughSaveDialog(launched, format, exportPath);
  await completeAndAssertReopen(launched, fixture, format, exportPath, source, expectation);
}

// CT-162: a format that cannot apply to this source is offered but disabled, with a tooltip
// explaining why; the option cannot be chosen, so the picker is cancelled without a save.
async function assertFormatOptionDisabledInPicker(
  launched: LaunchedApp,
  format: ExportFormat,
  expectation: CellExpectation,
): Promise<void> {
  await triggerSaveImageMenuItem(launched.app);
  await expect(saveImageFormatPicker(launched.window)).toBeVisible();
  await expectSaveImageFormatOptionDisabledWithTooltip(
    launched.window,
    format.pickerLabel,
    expectation.disabledReason ?? "",
  );
  await cancelSaveImageFormatPicker(launched.window);
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
): Promise<void> {
  await enqueueSaveDialogPath(launched.window, exportPath);
  await triggerSaveImageMenuItem(launched.app);
  await expect(saveImageFormatPicker(launched.window)).toBeVisible();
  await chooseSaveImageFormat(launched.window, format.pickerLabel);
  await confirmSaveImageFormat(launched.window);
  await expect(launched.window.getByText("Saved to", { exact: false }).first()).toBeVisible();
}

// Adds the source's data-fit (Normalized viewing) luminance for raster float
// exports, the apples-to-apples target for a float reopen that now auto-fits its
// own display window on open (CT-161).
async function captureSourceSignature(
  window: Page,
  fixture: InputFixture,
  format: ExportFormat,
): Promise<RenderedSignature> {
  const signature = await captureRenderedSignature(window, SOURCE_PANEL);
  if (!isFloatKind(format.kind) || fixture.kind !== "raster") return signature;
  return { ...signature, dataFitLuminance: await measureNormalizedViewLuminance(window, SOURCE_PANEL) };
}

// Reads a panel's luminance under Normalized viewing (data stretched to fill the
// display window), then restores the toggle so the export proceeds from the
// default state.
async function measureNormalizedViewLuminance(window: Page, panel: number): Promise<number> {
  await toggleNormalizedViewing(window, panel);
  await expectNormalizedViewingEnabled(window, panel, true);
  await window.waitForTimeout(NORMALIZED_REDRAW_SETTLE_MS);
  const color = await averageNonClearCanvasColor(panelCanvas(window, panel));
  await toggleNormalizedViewing(window, panel);
  return (color.red + color.green + color.blue) / 3;
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
  expectLuminanceWithinTolerance(source.luminance, reloaded, format);
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
  if (reloaded.sampleFormat === "float") {
    return expectFloatReopenStaysVisibleAndTracksSource(source, reloaded, format);
  }
  if (source.colourfulFraction < TRUE_COLOUR_FRACTION_FLOOR) {
    expectLuminanceWithinTolerance(source.luminance, reloaded, format);
  }
}

// CT-161: a 32-bit float reopen auto-fits its display window to the data on open,
// so it renders the data VISIBLY (the pre-fix bug rendered a saturated white frame
// at luminance ~255). It therefore matches the source shown EITHER as-is (default)
// or fit-to-window (Normalized viewing) - both represent the same round-tripped
// data - and the white frame lies far above both, so this rejects the old bug.
function expectFloatReopenStaysVisibleAndTracksSource(
  source: RenderedSignature,
  reloaded: RenderedSignature,
  format: ExportFormat,
): void {
  const tolerance = luminanceToleranceForFormat(format);
  const dataFitLuminance = source.dataFitLuminance ?? source.luminance;
  const matchesDefaultView = Math.abs(reloaded.luminance - source.luminance) <= tolerance;
  const matchesDataFitView = Math.abs(reloaded.luminance - dataFitLuminance) <= tolerance;
  expect(matchesDefaultView || matchesDataFitView).toBe(true);
}

// Compares a reopened render's luminance against an expected source luminance.
// Float reopens are no longer exempt (CT-161): they auto-fit on open and are
// asserted via expectFloatReopenStaysVisibleAndTracksSource instead.
function expectLuminanceWithinTolerance(
  sourceLuminance: number,
  reloaded: RenderedSignature,
  format: ExportFormat,
): void {
  expect(Math.abs(reloaded.luminance - sourceLuminance)).toBeLessThanOrEqual(
    luminanceToleranceForFormat(format),
  );
}

function luminanceToleranceForFormat(format: ExportFormat): number {
  return format.isLossyCompressed ? LOSSY_LUMINANCE_TOLERANCE : LUMINANCE_TOLERANCE;
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
