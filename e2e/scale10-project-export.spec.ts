// CT-242 scale10 sweep: project save/reopen and exports at reference scale.
//
// PROJECT ROUND-TRIP: the 10 GB capture is opened, an IDENTITY contrast curve
// is applied in place (2-endpoint integer curve, byte-identical output; the
// History entry is what forces the save to BAKE the raster through the CT-235
// chunked encode-and-spool path instead of streaming the untouched source file
// from disk - any data-changing full-stack operation is refused by the CT-239
// memory guard at 100 bands, and identity keeps every readout oracle-exact).
// The bundle is saved with determinate progress, the app RELAUNCHES, and the
// reopened project (the CT-236 chunked asset read feeding the CT-231 streaming
// ENVI decoder) must read the oracle exactly at (150, 250) on band 50.
//
// EXPORTS: ENVI export of the full 100-band stack streams through the CT-237
// chunked save-image protocol and the exported .hdr/.bin re-opens in the app
// with exact oracle readouts (uint16 preserved, so no float tolerance). TIFF
// export of the full stack must refuse with the exact locked copy BEFORE any
// dialog or encoding (classic TIFF caps at 4,294,967,295 bytes and the refusal
// gates on the FULL stack content); a cropped sub-stack under that limit
// exports fine. PNG and JPEG exports of the current view must produce files
// that genuinely decode, verified in-test with Node via sharp.
//
// OPT-IN: runs only with MSI_SCALE10=1 and the generated fixtures present
// (node scripts/generate-scale10-stack.mjs); otherwise every test skips.
// Run locally: dev server first (pnpm dev), then
//   MSI_SCALE10=1 MSI_E2E_TRACE_LABEL=CT-242 pnpm e2e scale10-project-export.spec.ts
import { expect, test } from "@playwright/test";
import { readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

import {
  enqueueOpenDialogPaths,
  enqueueSaveDialogPath,
  resetDialogQueues,
} from "./support/dialog-stub-controls";
import { readHistoryEntries } from "./support/history-panel";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  triggerOpenProjectMenuItem,
  triggerSaveImageMenuItem,
  triggerSaveProjectMenuItem,
} from "./support/main-process";
import { openOperation, setOpenInNewPanel } from "./support/operations";
import { selectOperationRegionByDrag } from "./support/operation-region-picker";
import { panelGrid, selectPanel } from "./support/panels";
import { createTemporaryProjectBundleDirectory } from "./support/project-bundle-flow";
import {
  chooseSaveImageFormat,
  confirmSaveImageFormat,
  createTemporaryExportDirectory,
  saveImageFormatPicker,
} from "./support/save-image-flow";
import { runAsStoryboardStep } from "./support/storyboard-step";
import { expectToneCurveOpensWithTwoEndpoints, TONE_CURVE_LABEL } from "./support/tone-curve-editor";
import {
  applyOperationWithBudget,
  closeGridPanel,
  countGridPanels,
  expectNoRawAllocationFailureToast,
  expectValueCloseTo,
  forceRendererGarbageCollection,
  openScale10SingleFile,
  readReportedPixelNear,
  readVisibleToastTexts,
  recordScale10Result,
  SCALE10_APPLY_BUDGET_MS,
  SCALE10_DIMENSIONS,
  SCALE10_MAX_UI_GAP_MS,
  SCALE10_REFERENCE_HEADER_PATH,
  SCALE10_SINGLE_FILE_OPEN_BUDGET_MS,
  scale10Value,
  selectActiveBandNumberInPanel,
  skipUnlessScale10SweepIsEnabled,
  startUiHeartbeat,
  stopUiHeartbeatAndReadMaxGapMs,
  watchForDeterminateProgressBar,
} from "./scale10.support";

const SOURCE_PANEL = 1;
const CROP_RESULT_PANEL = 2;
const PROBE_PIXEL = { x: 150, y: 250 };

// PRD budgets (hard assertions): save 45 min, reopen 45 min, ENVI export
// 45 min, PNG/JPEG 15 min each; the cropped TIFF (one 6 MB band) shares the
// view-export budget. Test timeouts sit above the sum of contained budgets.
const PROJECT_SAVE_BUDGET_MS = 45 * 60_000;
const PROJECT_REOPEN_BUDGET_MS = 45 * 60_000;
const ENVI_EXPORT_BUDGET_MS = 45 * 60_000;
const VIEW_EXPORT_BUDGET_MS = 15 * 60_000;
const PROJECT_TEST_TIMEOUT_MS = 170 * 60_000;
const ENVI_TEST_TIMEOUT_MS = 120 * 60_000;
const TIFF_TEST_TIMEOUT_MS = 90 * 60_000;
const VIEW_EXPORT_TEST_TIMEOUT_MS = 70 * 60_000;

// The CT-237 locked refusal copy and the classic TIFF offset ceiling it guards.
const TIFF_REFUSAL_COPY =
  "TIFF export supports images up to 4 GB. Use ENVI export for larger stacks.";
const MAX_CLASSIC_TIFF_EXPORT_BYTES = 4_294_967_295;
const TIFF_REFUSAL_TOAST_TIMEOUT_MS = 60_000;

// The exported ENVI sidecar must carry exactly the uint16 data section:
// 10000 x 5000 x 100 bands x 2 bytes.
const EXPECTED_ENVI_BINARY_BYTES = 10_000_000_000;

// Same drag rectangle the CT-239 crop test committed reliably at this scale
// (~2000 x 1600 image pixels; full stack content ~640 MB, far under 4 GiB).
const CROP_REGION = { start: { x: 1_000, y: 1_000 }, end: { x: 3_000, y: 2_600 } };

// Sonner toasts persist ~4 s; consecutive exports wait them out so the second
// "Saved to" assertion cannot match the first export's toast.
const TOAST_LAPSE_MS = 6_000;
const LEAK_CHECK_TIMEOUT_MS = 60_000;

let launched: LaunchedApp;
let testStartedAtMs = 0;
const directoriesToRemoveAfterAppClose: string[] = [];

test.beforeEach(async () => {
  skipUnlessScale10SweepIsEnabled();
  testStartedAtMs = Date.now();
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  if (!launched) return;
  try {
    await closeToolboxApp(launched);
  } catch {
    await launched.app.close().catch(() => undefined);
  }
  removeRegisteredTemporaryDirectories();
});

// The bundle and export payloads are ~10 GB each; every test registers its
// temp directory so the afterEach removes it once the app (and any file
// handles it held) is gone.
function registerTemporaryDirectoryForCleanup(directory: string): string {
  directoriesToRemoveAfterAppClose.push(directory);
  return directory;
}

function removeRegisteredTemporaryDirectories(): void {
  for (const directory of directoriesToRemoveAfterAppClose.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
}

// --- sweep bookkeeping ---------------------------------------------------------

async function recordSweepVerdict(
  area: string,
  run: () => Promise<Record<string, unknown>>,
): Promise<void> {
  try {
    recordScale10Result({ area, verdict: "pass", ...(await run()) });
  } catch (error) {
    recordScale10Result({
      area,
      verdict: "fail",
      error: String(error).slice(0, 400),
      toasts: await readVisibleToastTexts(launched.window).catch(() => []),
    });
    throw error;
  }
}

// --- measured phases -------------------------------------------------------------

interface TimedPhase {
  readonly elapsedMs: number;
  readonly maxUiGapMs: number;
  readonly sawDeterminateProgressBar: boolean;
}

async function runPhaseMeasuringUiResponsiveness(
  stepLabel: string,
  runPhaseToCompletion: () => Promise<void>,
): Promise<TimedPhase> {
  return runAsStoryboardStep(launched.window, stepLabel, async () => {
    await startUiHeartbeat(launched.window);
    const progressWatch = watchForDeterminateProgressBar(launched.window);
    const startedAt = Date.now();
    await runPhaseToCompletion();
    const elapsedMs = Date.now() - startedAt;
    progressWatch.stop();
    const maxUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(launched.window);
    return { elapsedMs, maxUiGapMs, sawDeterminateProgressBar: progressWatch.sawDeterminateBar() };
  });
}

function expectPhaseLeftTheRendererResponsive(
  timing: { readonly maxUiGapMs: number },
  phaseLabel: string,
): void {
  expect(timing.maxUiGapMs, `${phaseLabel} must not freeze the renderer`).toBeLessThanOrEqual(
    SCALE10_MAX_UI_GAP_MS,
  );
}

// --- shared oracle readout ---------------------------------------------------------

async function verifyOracleBandReadout(panelNumber: number, bandNumber: number): Promise<string> {
  return runAsStoryboardStep(launched.window, `Verify the oracle readout on band ${bandNumber}`, async () => {
    await selectActiveBandNumberInPanel(launched.window, panelNumber, bandNumber);
    const reported = await readReportedPixelNear(launched.window, panelNumber, PROBE_PIXEL, SCALE10_DIMENSIONS);
    const expected = scale10Value(bandNumber - 1, reported.x, reported.y);
    expectValueCloseTo(reported.value, expected, 0, `band ${bandNumber} at (${reported.x}, ${reported.y})`);
    return `band ${bandNumber}: pixel (${reported.x}, ${reported.y}) read ${reported.rawValue}, expected ${expected}`;
  });
}

// --- spool-file leak check (CT-235 save protocol) --------------------------------------

async function expectNoFreshSaveBundleSpoolFiles(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Verify no save-bundle spool files remain", async () => {
    await expect
      .poll(listSaveBundleSpoolFileNamesFromThisTest, { timeout: LEAK_CHECK_TIMEOUT_MS })
      .toEqual([]);
  });
}

// Only spool files created during THIS test count: stale files from earlier
// crashed sessions are the cleanup Standing Rule's business, not this spec's.
function listSaveBundleSpoolFileNamesFromThisTest(): string[] {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith("msi-save-bundle-") && name.endsWith(".bin"))
    .filter((name) => fileWasModifiedSinceTestStart(join(tmpdir(), name)));
}

function fileWasModifiedSinceTestStart(filePath: string): boolean {
  try {
    return statSync(filePath).mtimeMs >= testStartedAtMs;
  } catch {
    return false;
  }
}

// --- exports through the save-image flow --------------------------------------------------

async function exportSelectedPanelWithBudget(
  formatLabel: string,
  destinationPath: string,
  budgetMs: number,
): Promise<TimedPhase> {
  const timing = await runPhaseMeasuringUiResponsiveness(`Export as ${formatLabel} within budget`, async () => {
    await enqueueSaveDialogPath(launched.window, destinationPath);
    await triggerSaveImageMenuItem(launched.app);
    await expect(saveImageFormatPicker(launched.window)).toBeVisible();
    await chooseSaveImageFormat(launched.window, formatLabel);
    await confirmSaveImageFormat(launched.window);
    await expectSaveSucceededToastWithin(budgetMs);
  });
  expectPhaseLeftTheRendererResponsive(timing, `the ${formatLabel} export`);
  expectFileOnDiskWithAtLeastOneByte(destinationPath);
  return timing;
}

async function expectSaveSucceededToastWithin(budgetMs: number): Promise<void> {
  await expect(launched.window.getByText("Saved to", { exact: false }).first()).toBeVisible({
    timeout: budgetMs,
  });
}

function expectFileOnDiskWithAtLeastOneByte(filePath: string): number {
  const size = statSync(filePath).size;
  expect(size, `${filePath} must exist with content`).toBeGreaterThan(0);
  return size;
}

// Full decode in Node: sharp inflates/dequantizes every pixel, so a truncated
// or structurally broken PNG/JPEG fails here even though it has bytes on disk.
async function decodeExportedImageWithSharp(
  filePath: string,
): Promise<{ width: number; height: number; decodedBytes: number }> {
  const { data, info } = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
  expect(data.length).toBeGreaterThan(0);
  return { width: info.width, height: info.height, decodedBytes: data.length };
}

// --- test 1: project save + relaunch + reopen ------------------------------------------------

test("project save with the 10 GB stack, relaunch, and reopen restore the oracle exactly", async () => {
  test.setTimeout(PROJECT_TEST_TIMEOUT_MS);
  await recordSweepVerdict("project: save (baked 10 GB stack) + relaunch + reopen", async () => {
    await openScale10SingleFile(launched.window, SCALE10_REFERENCE_HEADER_PATH, SCALE10_SINGLE_FILE_OPEN_BUDGET_MS);
    await selectPanel(launched.window, SOURCE_PANEL);
    await forceRendererGarbageCollection(launched.window);
    await applyIdentityContrastCurveInPlaceToForceRebake();
    await verifyOracleBandReadout(SOURCE_PANEL, 50);
    const bundlePath = join(
      registerTemporaryDirectoryForCleanup(await createTemporaryProjectBundleDirectory()),
      "scale10-roundtrip.ctbundle",
    );
    const save = await saveProjectBundleWithinBudget(bundlePath);
    const bundleBytes = expectFileOnDiskWithAtLeastOneByte(bundlePath);
    await expectNoFreshSaveBundleSpoolFiles();
    await relaunchTheApp();
    const reopen = await reopenProjectBundleWithinBudget(bundlePath);
    const oracle = await verifyOracleBandReadout(SOURCE_PANEL, 50);
    await expectReopenedHistoryCarriesTheContrastCurveEntry();
    await expectNoRawAllocationFailureToast(launched.window);
    return { saveMs: save.elapsedMs, reopenMs: reopen.elapsedMs, bundleBytes, oracle };
  });
});

// The identity curve (default two integer endpoints, 0 -> 0 and 65535 -> 65535)
// writes back byte-identical values but records a History entry, which is what
// flips the save from "stream the untouched source file" to the CT-235 baked
// chunked encode this test exists to prove. Allocation cost is ONE band
// (unchanged bands carry by reference, CT-233), so the memory guard passes
// where every whole-stack data operation is refused at 100 bands.
async function applyIdentityContrastCurveInPlaceToForceRebake(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Apply the identity contrast curve in place", async () => {
    await openOperation(launched.window, TONE_CURVE_LABEL);
    await expectToneCurveOpensWithTwoEndpoints(launched.window);
    await setOpenInNewPanel(launched.window, TONE_CURVE_LABEL, false);
    const timing = await applyOperationWithBudget(launched.window, TONE_CURVE_LABEL, SCALE10_APPLY_BUDGET_MS);
    expectPhaseLeftTheRendererResponsive(timing, "the in-place identity apply");
    await expect.poll(() => countGridPanels(launched.window)).toBe(1);
  });
}

async function saveProjectBundleWithinBudget(bundlePath: string): Promise<TimedPhase> {
  const timing = await runPhaseMeasuringUiResponsiveness("Save the project bundle within budget", async () => {
    await enqueueSaveDialogPath(launched.window, bundlePath);
    await triggerSaveProjectMenuItem(launched.app);
    await expect(launched.window.getByText("Saved project to", { exact: false }).first()).toBeVisible({
      timeout: PROJECT_SAVE_BUDGET_MS,
    });
  });
  expect(timing.sawDeterminateProgressBar, "the save must show determinate progress").toBe(true);
  expectPhaseLeftTheRendererResponsive(timing, "the project save");
  return timing;
}

async function relaunchTheApp(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Relaunch the app for the reopen", async () => {
    await closeToolboxApp(launched);
  });
  launched = await launchToolboxApp();
}

async function reopenProjectBundleWithinBudget(bundlePath: string): Promise<TimedPhase> {
  const timing = await runPhaseMeasuringUiResponsiveness("Reopen the project bundle within budget", async () => {
    await enqueueOpenDialogPaths(launched.window, [bundlePath]);
    await triggerOpenProjectMenuItem(launched.app);
    await expect(launched.window.getByText("Opened project", { exact: false }).first()).toBeVisible({
      timeout: PROJECT_REOPEN_BUDGET_MS,
    });
    await expectReopenedStackVisibleAndIdleInPanelGrid();
  });
  expectPhaseLeftTheRendererResponsive(timing, "the project reopen");
  return timing;
}

async function expectReopenedStackVisibleAndIdleInPanelGrid(): Promise<void> {
  const grid = panelGrid(launched.window);
  await expect(grid.getByText("scale10-reference", { exact: false }).first()).toBeVisible({
    timeout: PROJECT_REOPEN_BUDGET_MS,
  });
  await expect(grid.locator('[role="status"]')).toHaveCount(0, { timeout: PROJECT_REOPEN_BUDGET_MS });
}

// The restored History entry is the committed proof the bundle round-tripped
// the BAKED asset (an unmodified stack would have carried no History and never
// touched the CT-235 encode path).
async function expectReopenedHistoryCarriesTheContrastCurveEntry(): Promise<void> {
  await selectPanel(launched.window, SOURCE_PANEL);
  const entries = await readHistoryEntries(launched.window);
  const labels = entries.map((entry) => entry.actionLabel);
  expect(labels.some((label) => /contrast curve/i.test(label)), `History: ${labels.join(", ")}`).toBe(true);
}

// --- test 2: ENVI export at full scale + readback ----------------------------------------------

test("ENVI export of the full 100-band stack re-opens with exact oracle readouts", async () => {
  test.setTimeout(ENVI_TEST_TIMEOUT_MS);
  await recordSweepVerdict("export: ENVI (.hdr + .bin) full stack + app readback", async () => {
    await openScale10SingleFile(launched.window, SCALE10_REFERENCE_HEADER_PATH, SCALE10_SINGLE_FILE_OPEN_BUDGET_MS);
    await selectPanel(launched.window, SOURCE_PANEL);
    await forceRendererGarbageCollection(launched.window);
    const exportDirectory = registerTemporaryDirectoryForCleanup(await createTemporaryExportDirectory());
    const headerPath = join(exportDirectory, "scale10-export.hdr");
    const exported = await exportSelectedPanelWithBudget("ENVI (.hdr + .bin)", headerPath, ENVI_EXPORT_BUDGET_MS);
    const binaryBytes = expectEnviSidecarCarriesTheExactDataSection(exportDirectory);
    const oracle = await reopenExportedEnviAndVerifyOracle(headerPath);
    await expectNoRawAllocationFailureToast(launched.window);
    return { exportMs: exported.elapsedMs, maxUiGapMs: exported.maxUiGapMs, binaryBytes, oracle };
  });
});

function expectEnviSidecarCarriesTheExactDataSection(exportDirectory: string): number {
  const binaryBytes = statSync(join(exportDirectory, "scale10-export.bin")).size;
  expect(binaryBytes, "uint16 preserved: the sidecar is exactly the 10 GB data section").toBe(
    EXPECTED_ENVI_BINARY_BYTES,
  );
  return binaryBytes;
}

// The 10 GB source and the 10 GB re-opened export can never share the ~17 GB
// renderer ArrayBuffer pool, so the source panel closes first (CT-239 model).
async function reopenExportedEnviAndVerifyOracle(headerPath: string): Promise<string> {
  await closeGridPanel(launched.window, SOURCE_PANEL);
  await forceRendererGarbageCollection(launched.window);
  await openScale10SingleFile(launched.window, headerPath, SCALE10_SINGLE_FILE_OPEN_BUDGET_MS);
  await selectPanel(launched.window, SOURCE_PANEL);
  const bandFifty = await verifyOracleBandReadout(SOURCE_PANEL, 50);
  const bandHundred = await verifyOracleBandReadout(SOURCE_PANEL, 100);
  return `${bandFifty}; ${bandHundred}`;
}

// --- test 3: TIFF refusal at full scale + cropped success ---------------------------------------

test("TIFF export refuses the full stack with the locked copy and succeeds on a cropped sub-stack", async () => {
  test.setTimeout(TIFF_TEST_TIMEOUT_MS);
  await recordSweepVerdict("export: TIFF full-stack refusal + cropped sub-stack success", async () => {
    await openScale10SingleFile(launched.window, SCALE10_REFERENCE_HEADER_PATH, SCALE10_SINGLE_FILE_OPEN_BUDGET_MS);
    await selectPanel(launched.window, SOURCE_PANEL);
    await forceRendererGarbageCollection(launched.window);
    const refusalToast = await attemptFullStackTiffExportExpectingTheLockedRefusal();
    await cropToTheOperationRegion();
    const rectangle = await readCommittedCropRectangleFromHistory();
    expectCroppedStackContentFitsClassicTiff(rectangle);
    const exportedTiff = await exportTheCroppedPanelAsTiff(rectangle);
    await expectNoRawAllocationFailureToast(launched.window);
    return { refusalToast, ...exportedTiff };
  });
});

// No save path is enqueued on purpose: the CT-237 refusal fires BEFORE the
// save dialog, so a queued path would leak into the next export. If the flow
// regressed past the gate, the stubbed dialog would return canceled, no
// refusal toast would appear, and this assertion would fail.
async function attemptFullStackTiffExportExpectingTheLockedRefusal(): Promise<string> {
  return runAsStoryboardStep(launched.window, "Attempt the full-stack TIFF export", async () => {
    await triggerSaveImageMenuItem(launched.app);
    await expect(saveImageFormatPicker(launched.window)).toBeVisible();
    await chooseSaveImageFormat(launched.window, "TIFF (16-bit)");
    await confirmSaveImageFormat(launched.window);
    const toast = launched.window.locator("[data-sonner-toast]").filter({ hasText: TIFF_REFUSAL_COPY });
    await expect(toast.first()).toBeVisible({ timeout: TIFF_REFUSAL_TOAST_TIMEOUT_MS });
    await expectNoSaveSucceededToast();
    await resetDialogQueues(launched.window);
    return (await toast.first().innerText()).trim();
  });
}

async function expectNoSaveSucceededToast(): Promise<void> {
  const toasts = await readVisibleToastTexts(launched.window);
  expect(toasts.some((text) => text.includes("Saved to")), `toasts: ${JSON.stringify(toasts)}`).toBe(false);
}

async function cropToTheOperationRegion(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Crop to a sub-stack under 4 GiB", async () => {
    await openOperation(launched.window, "Crop to Region");
    await selectOperationRegionByDrag(launched.window, {
      panelNumber: SOURCE_PANEL,
      operationLabel: "Crop to Region",
      startPixel: CROP_REGION.start,
      endPixel: CROP_REGION.end,
      imageDimensions: SCALE10_DIMENSIONS,
    });
    const timing = await applyOperationWithBudget(launched.window, "Crop to Region", SCALE10_APPLY_BUDGET_MS);
    expectPhaseLeftTheRendererResponsive(timing, "the crop apply");
    await expect.poll(() => countGridPanels(launched.window)).toBe(2);
  });
}

interface CropRectangle {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const CROP_HISTORY_PATTERN = /Crop to \((\d+), (\d+)\) - \((\d+), (\d+)\)/;

// The History entry carries the exact committed rectangle, so the exported
// TIFF's dimensions are exactly checkable despite canvas-drag granularity.
async function readCommittedCropRectangleFromHistory(): Promise<CropRectangle> {
  await selectPanel(launched.window, CROP_RESULT_PANEL);
  const entries = await readHistoryEntries(launched.window);
  for (const entry of entries) {
    const match = entry.detailLines
      .map((line) => CROP_HISTORY_PATTERN.exec(line))
      .find((candidate) => candidate !== null);
    if (match) return { x0: Number(match[1]), y0: Number(match[2]), x1: Number(match[3]), y1: Number(match[4]) };
  }
  throw new Error(`No crop rectangle found in History: ${JSON.stringify(entries)}`);
}

// Guards the test itself: the refusal estimate gates on the FULL stack content
// (all 100 bands at 2 bytes), so the committed crop must stay under the cap or
// the success half of this test would be asserting the wrong thing.
function expectCroppedStackContentFitsClassicTiff(rectangle: CropRectangle): void {
  const croppedPixels = (rectangle.x1 - rectangle.x0 + 1) * (rectangle.y1 - rectangle.y0 + 1);
  expect(croppedPixels * 100 * 2).toBeLessThan(MAX_CLASSIC_TIFF_EXPORT_BYTES);
}

async function exportTheCroppedPanelAsTiff(
  rectangle: CropRectangle,
): Promise<Record<string, unknown>> {
  const exportDirectory = registerTemporaryDirectoryForCleanup(await createTemporaryExportDirectory());
  const tiffPath = join(exportDirectory, "scale10-crop.tif");
  const timing = await exportSelectedPanelWithBudget("TIFF (16-bit)", tiffPath, VIEW_EXPORT_BUDGET_MS);
  const metadata = await sharp(tiffPath).metadata();
  expect(metadata.width).toBe(rectangle.x1 - rectangle.x0 + 1);
  expect(metadata.height).toBe(rectangle.y1 - rectangle.y0 + 1);
  return { croppedExportMs: timing.elapsedMs, croppedTiffBytes: statSync(tiffPath).size };
}

// --- test 4: PNG and JPEG exports of the current view -------------------------------------------

test("PNG and JPEG exports of the current view decode in Node at full dimensions", async () => {
  test.setTimeout(VIEW_EXPORT_TEST_TIMEOUT_MS);
  await recordSweepVerdict("export: PNG + JPEG of the current view (Node-decoded)", async () => {
    await openScale10SingleFile(launched.window, SCALE10_REFERENCE_HEADER_PATH, SCALE10_SINGLE_FILE_OPEN_BUDGET_MS);
    await selectPanel(launched.window, SOURCE_PANEL);
    await forceRendererGarbageCollection(launched.window);
    const exportDirectory = registerTemporaryDirectoryForCleanup(await createTemporaryExportDirectory());
    const png = await exportViewAndDecodeWithNode("PNG (8-bit)", join(exportDirectory, "scale10-view.png"));
    await launched.window.waitForTimeout(TOAST_LAPSE_MS);
    const jpeg = await exportViewAndDecodeWithNode("JPEG (8-bit)", join(exportDirectory, "scale10-view.jpg"));
    await expectNoRawAllocationFailureToast(launched.window);
    await expectNoFreshSaveBundleSpoolFiles();
    return { png, jpeg };
  });
});

async function exportViewAndDecodeWithNode(
  formatLabel: string,
  destinationPath: string,
): Promise<Record<string, unknown>> {
  const timing = await exportSelectedPanelWithBudget(formatLabel, destinationPath, VIEW_EXPORT_BUDGET_MS);
  const decoded = await decodeExportedImageWithSharp(destinationPath);
  expect(decoded.width).toBe(SCALE10_DIMENSIONS.width);
  expect(decoded.height).toBe(SCALE10_DIMENSIONS.height);
  return { exportMs: timing.elapsedMs, maxUiGapMs: timing.maxUiGapMs, ...decoded };
}
