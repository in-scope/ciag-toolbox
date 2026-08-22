import { appendFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { closeToolboxApp, launchToolboxApp, type LaunchedApp } from "./support/launch-app";
import { enqueueSaveDialogPath } from "./support/dialog-stub-controls";
import { triggerSaveImageMenuItem } from "./support/main-process";
import {
  chooseSaveImageFormat,
  confirmSaveImageFormat,
  saveImageFormatPicker,
} from "./support/save-image-flow";
import {
  AUDIT_DIRECTORY,
  openCaptureFromDisk,
  readVisibleToastTexts,
  REFERENCE_STACK_PATH,
  referenceValue,
  startUiHeartbeat,
  stopUiHeartbeatAndReadMaxGapMs,
} from "./scale-audit.support";

// CT-219f at-scale verification (SCRATCH, NEVER COMMITTED, per the CT-219 precedent):
// exporting a 48 MP band of the 8000x6000x16 uint16 reference stack as TIFF (16-bit)
// previously froze the renderer for 15.7 s (sync geotiff encode, one ArrayBuffer +
// DataView allocation per sample). The chunked encoders must keep the max UI gap
// under ~2 s, show a determinate progress bar, and write byte-correct files. ENVI
// whole-cube export (3.8 s gap in the audit) gets the same treatment.

const TIFF_EXPORT_PATH = join(AUDIT_DIRECTORY, "ct219f-export.tif");
const ENVI_EXPORT_PATH = join(AUDIT_DIRECTORY, "ct219f-export.hdr");
const ENVI_SIDECAR_PATH = join(AUDIT_DIRECTORY, "ct219f-export.bin");
const LOAD_BUDGET_MS = 5 * 60_000;
const TIFF_EXPORT_BUDGET_MS = 60_000;
const ENVI_EXPORT_BUDGET_MS = 180_000;
const REFERENCE_BAND_BYTES = 8000 * 6000 * 2;
const REFERENCE_CUBE_BYTES = REFERENCE_BAND_BYTES * 16;
const BAND_1_ORACLE_AT_ORIGIN = referenceValue(0, 0, 0);

let launched: LaunchedApp;

test.beforeEach(async () => {
  test.setTimeout(15 * 60_000);
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  try {
    await closeToolboxApp(launched);
  } catch {
    await launched.app.close().catch(() => undefined);
  }
});

function logVerifyEvidence(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ recordedAt: new Date().toISOString(), ...entry });
  appendFileSync(join(AUDIT_DIRECTORY, "ct219f-verify.log"), `${line}\n`);
  console.log(`CT219F ${line}`);
}

function watchForProgressBar(): { sawBar: () => boolean; stop: () => void } {
  let sawBar = false;
  let stopped = false;
  const poll = async (): Promise<void> => {
    while (!stopped && !sawBar) {
      sawBar = await launched.window
        .locator('[role="progressbar"]')
        .count()
        .then((count) => count > 0)
        .catch(() => false);
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 25));
    }
  };
  void poll();
  return { sawBar: () => sawBar, stop: () => { stopped = true; } };
}

async function exportSelectedStackMeasuringGap(
  formatLabel: string,
  destinationPath: string,
  budgetMs: number,
): Promise<{ exportMs: number; maxUiGapMs: number; sawBar: boolean }> {
  await enqueueSaveDialogPath(launched.window, destinationPath);
  await triggerSaveImageMenuItem(launched.app);
  await expect(saveImageFormatPicker(launched.window)).toBeVisible();
  await chooseSaveImageFormat(launched.window, formatLabel);
  await startUiHeartbeat(launched.window);
  const progressWatch = watchForProgressBar();
  const startedAt = Date.now();
  await confirmSaveImageFormat(launched.window);
  await expect(launched.window.getByText(/Saved to/).first()).toBeVisible({ timeout: budgetMs });
  const exportMs = Date.now() - startedAt;
  progressWatch.stop();
  const maxUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(launched.window);
  return { exportMs, maxUiGapMs, sawBar: progressWatch.sawBar() };
}

function readBigEndianUint16(bytes: Buffer, offset: number): number {
  return bytes.readUInt16BE(offset);
}

test("TIFF (16-bit) export at reference scale: <2 s gap, determinate bar, correct bytes", async () => {
  const loadMs = await openCaptureFromDisk(launched.window, REFERENCE_STACK_PATH, LOAD_BUDGET_MS);
  const result = await exportSelectedStackMeasuringGap(
    "TIFF (16-bit)",
    TIFF_EXPORT_PATH,
    TIFF_EXPORT_BUDGET_MS,
  );

  const fileBytes = statSync(TIFF_EXPORT_PATH).size;
  const headerLength = fileBytes - REFERENCE_BAND_BYTES;
  const fileContents = readFileSync(TIFF_EXPORT_PATH);
  const firstSample = readBigEndianUint16(fileContents, headerLength);
  const toasts = await readVisibleToastTexts(launched.window);
  logVerifyEvidence({
    format: "tiff-16-bit",
    loadMs,
    ...result,
    fileBytes,
    headerLength,
    firstSample,
    expectedFirstSample: BAND_1_ORACLE_AT_ORIGIN,
    toasts,
  });
  rmSync(TIFF_EXPORT_PATH, { force: true });

  expect(headerLength).toBeGreaterThan(0);
  expect(firstSample).toBe(BAND_1_ORACLE_AT_ORIGIN);
  expect(toasts.filter((text) => text.toLowerCase().includes("could not save"))).toEqual([]);
  expect(result.sawBar).toBe(true);
  expect(result.maxUiGapMs).toBeLessThan(2000);
});

test("ENVI export at reference scale: gap drops below the audit's 3.8 s, determinate bar, correct bytes", async () => {
  const loadMs = await openCaptureFromDisk(launched.window, REFERENCE_STACK_PATH, LOAD_BUDGET_MS);
  const result = await exportSelectedStackMeasuringGap(
    "ENVI (.hdr + .bin)",
    ENVI_EXPORT_PATH,
    ENVI_EXPORT_BUDGET_MS,
  );

  const sidecarBytes = statSync(ENVI_SIDECAR_PATH).size;
  const firstSampleLittleEndian = readFileSync(ENVI_SIDECAR_PATH).readUInt16LE(0);
  const toasts = await readVisibleToastTexts(launched.window);
  logVerifyEvidence({
    format: "envi",
    loadMs,
    ...result,
    sidecarBytes,
    expectedSidecarBytes: REFERENCE_CUBE_BYTES,
    firstSampleLittleEndian,
    expectedFirstSample: BAND_1_ORACLE_AT_ORIGIN,
    toasts,
  });
  rmSync(ENVI_EXPORT_PATH, { force: true });
  rmSync(ENVI_SIDECAR_PATH, { force: true });

  expect(sidecarBytes).toBe(REFERENCE_CUBE_BYTES);
  expect(firstSampleLittleEndian).toBe(BAND_1_ORACLE_AT_ORIGIN);
  expect(toasts.filter((text) => text.toLowerCase().includes("could not save"))).toEqual([]);
  expect(result.sawBar).toBe(true);
  expect(result.maxUiGapMs).toBeLessThan(3800);
});
