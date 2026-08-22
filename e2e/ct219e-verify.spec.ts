// CT-219e at-scale repro + verification (SCRATCH, NEVER COMMITTED - the CT-219
// precedent). Loads the 1.54 GB reference stack as a single file, inverts every
// band IN PLACE (forcing the bundle to bake the full modified raster), then
// saves the project through the dialog stub.
//
// The "probe" test records tolerant evidence of WHERE the save dies on the old
// whole-draft invoke (renderer death vs wedge vs silent nothing), and the
// "verify" test asserts the fixed behaviour: saved toast, a complete .ctbundle
// on disk, and a reopen whose pixel readout shows the inverted oracle values.
import { expect, test } from "@playwright/test";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";

import {
  AUDIT_DIRECTORY,
  openCaptureFromDisk,
  readReportedPixelNear,
  recordAuditResult,
  readVisibleToastTexts,
  REFERENCE_DIMENSIONS,
  referenceValue,
  startUiHeartbeat,
  stopUiHeartbeatAndReadMaxGapMs,
} from "./scale-audit.support";
import { enqueueSaveDialogPath } from "./support/dialog-stub-controls";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import {
  applyOperation,
  openOperation,
  operationPanel,
  setOpenInNewPanel,
} from "./support/operations";
import { createTemporaryProjectBundleDirectory } from "./support/project-bundle-flow";
import { enqueueOpenDialogPaths } from "./support/dialog-stub-controls";
import { triggerOpenProjectMenuItem, triggerSaveProjectMenuItem } from "./support/main-process";
import { panelGrid } from "./support/panels";

const UINT16_MAX = 65535;
const REFERENCE_STACK_PATH = join(AUDIT_DIRECTORY, "reference-stack.tif");
const LOAD_BUDGET_MS = 300_000;
const INVERT_BUDGET_MS = 300_000;
const SAVE_OBSERVATION_BUDGET_MS = 300_000;

function watchProcessOutput(app: ElectronApplication): { lines: () => string[] } {
  const collected: string[] = [];
  app.process().stderr?.on("data", (chunk) => collected.push(String(chunk)));
  app.process().stdout?.on("data", (chunk) => collected.push(String(chunk)));
  return { lines: () => collected.filter((line) => line.includes("[renderer-crash]")) };
}

async function invertAllBandsInPlaceAtScale(page: Page): Promise<void> {
  await openOperation(page, "Invert");
  const panel = operationPanel(page, "Invert");
  const allBands = panel.getByRole("switch", { name: "Apply to all bands" });
  if ((await allBands.getAttribute("aria-checked")) !== "true") await allBands.click();
  await setOpenInNewPanel(page, "Invert", false);
  test.setTimeout(LOAD_BUDGET_MS + INVERT_BUDGET_MS + SAVE_OBSERVATION_BUDGET_MS);
  await applyOperation(page, "Invert");
}

type SaveOutcome =
  | { kind: "saved"; afterMs: number }
  | { kind: "error-toast"; toasts: string[]; afterMs: number }
  | { kind: "renderer-died"; afterMs: number }
  | { kind: "main-died"; afterMs: number }
  | { kind: "silent-at-budget"; afterMs: number };

async function observeSaveOutcome(
  app: ElectronApplication,
  page: Page,
  budgetMs: number,
): Promise<SaveOutcome> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < budgetMs) {
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 1000));
    if (page.isClosed()) return { kind: "renderer-died", afterMs: Date.now() - startedAt };
    const outcome = await classifySaveInProgress(app, page, startedAt);
    if (outcome) return outcome;
  }
  return { kind: "silent-at-budget", afterMs: Date.now() - startedAt };
}

async function classifySaveInProgress(
  app: ElectronApplication,
  page: Page,
  startedAt: number,
): Promise<SaveOutcome | null> {
  try {
    const toasts = await readVisibleToastTexts(page);
    if (toasts.some((t) => t.includes("Saved project to"))) {
      return { kind: "saved", afterMs: Date.now() - startedAt };
    }
    const failures = toasts.filter((t) => t.includes("Could not save project"));
    if (failures.length > 0) {
      return { kind: "error-toast", toasts: failures, afterMs: Date.now() - startedAt };
    }
    return null;
  } catch {
    if (page.isClosed()) return { kind: "renderer-died", afterMs: Date.now() - startedAt };
    return await classifyDeadMainProcess(app, startedAt);
  }
}

async function classifyDeadMainProcess(
  app: ElectronApplication,
  startedAt: number,
): Promise<SaveOutcome | null> {
  try {
    await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().length);
    return null;
  } catch {
    return { kind: "main-died", afterMs: Date.now() - startedAt };
  }
}

test("CT-219e probe: save project with an in-place inverted reference stack", async () => {
  test.setTimeout(LOAD_BUDGET_MS + INVERT_BUDGET_MS + SAVE_OBSERVATION_BUDGET_MS + 120_000);
  const launched = await launchToolboxApp();
  const { app, window: page } = launched;
  const crashLog = watchProcessOutput(app);
  try {
    const loadMs = await openCaptureFromDisk(page, REFERENCE_STACK_PATH, LOAD_BUDGET_MS);
    await invertAllBandsInPlaceAtScale(page);
    const destinationPath = join(await createTemporaryProjectBundleDirectory(), "ct219e.ctbundle");
    await enqueueSaveDialogPath(page, destinationPath);
    await startUiHeartbeat(page).catch(() => undefined);
    await triggerSaveProjectMenuItem(app);
    const outcome = await observeSaveOutcome(app, page, SAVE_OBSERVATION_BUDGET_MS);
    const maxUiGapMs = page.isClosed()
      ? -1
      : await stopUiHeartbeatAndReadMaxGapMs(page).catch(() => -1);
    recordAuditResult({
      area: "CT-219e probe: save project with baked inverted reference stack",
      verdict: outcome.kind === "saved" ? "pass" : "finding",
      loadMs,
      outcome,
      maxUiGapMs,
      bundleExists: existsSync(destinationPath),
      bundleBytes: existsSync(destinationPath) ? statSync(destinationPath).size : 0,
      crashLog: crashLog.lines(),
    });
    expect(outcome.kind).toBe("saved");
  } finally {
    await closeToolboxApp(launched).catch(() => undefined);
  }
});

test("CT-219e verify: saved bundle reopens with inverted oracle values", async () => {
  test.setTimeout(LOAD_BUDGET_MS + INVERT_BUDGET_MS + SAVE_OBSERVATION_BUDGET_MS + 300_000);
  const launched = await launchToolboxApp();
  const { app, window: page } = launched;
  try {
    await openCaptureFromDisk(page, REFERENCE_STACK_PATH, LOAD_BUDGET_MS);
    await invertAllBandsInPlaceAtScale(page);
    const destinationPath = join(await createTemporaryProjectBundleDirectory(), "ct219e.ctbundle");
    await enqueueSaveDialogPath(page, destinationPath);
    const progressBarSeen = watchForProgressBar(page);
    await triggerSaveProjectMenuItem(app);
    await expect(page.getByText("Saved project to", { exact: false }).first()).toBeVisible({
      timeout: SAVE_OBSERVATION_BUDGET_MS,
    });
    progressBarSeen.stop();
    // The bundle zip DEFLATES its entries and the generated ramp data compresses
    // ~63:1 (1.536 GB of asset bytes -> ~24.5 MB), so completeness is proven by
    // the reopen + pixel oracle below, not by a near-raw size floor.
    const bundleBytes = statSync(destinationPath).size;
    expect(bundleBytes).toBeGreaterThan(10_000_000);
    await reopenProjectBundleAtScale(app, page, destinationPath);
    await expectInvertedOracleOnPanel(page);
    recordAuditResult({
      area: "CT-219e verify: chunked save + reopen with inverted oracle",
      verdict: "pass",
      bundleBytes,
      sawProgressBar: progressBarSeen.sawBar(),
    });
    expect(progressBarSeen.sawBar()).toBe(true);
  } finally {
    await closeToolboxApp(launched).catch(() => undefined);
  }
});

// The shared open helper's default expect timeout is too tight for a bundle
// whose baked asset inflates back to 1.54 GB; reopen with an at-scale budget
// and wait for every panel busy overlay to clear before reading pixels.
async function reopenProjectBundleAtScale(
  app: ElectronApplication,
  page: Page,
  bundlePath: string,
): Promise<void> {
  await enqueueOpenDialogPaths(page, [bundlePath]);
  await triggerOpenProjectMenuItem(app);
  await expect(page.getByText("Opened project", { exact: false }).first()).toBeVisible({
    timeout: SAVE_OBSERVATION_BUDGET_MS,
  });
  await expect(panelGrid(page).locator('[role="status"]')).toHaveCount(0, {
    timeout: SAVE_OBSERVATION_BUDGET_MS,
  });
}

async function expectInvertedOracleOnPanel(page: Page): Promise<void> {
  const reported = await readReportedPixelNear(page, 1, { x: 150, y: 250 }, REFERENCE_DIMENSIONS);
  const expected = UINT16_MAX - referenceValue(0, reported.x, reported.y);
  expect(reported.value).toBe(expected);
}

function watchForProgressBar(page: Page): { sawBar: () => boolean; stop: () => void } {
  let sawBar = false;
  let stopped = false;
  const poll = async (): Promise<void> => {
    while (!stopped && !sawBar) {
      sawBar = await page
        .locator('[role="progressbar"]')
        .count()
        .then((count) => count > 0)
        .catch(() => false);
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 200));
    }
  };
  void poll();
  return { sawBar: () => sawBar, stop: () => { stopped = true; } };
}
