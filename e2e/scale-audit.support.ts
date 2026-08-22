// CT-219 scale-audit harness support (SCRATCH, NEVER COMMITTED).
// Shared plumbing for e2e/scale-audit.spec.ts: opening the huge generated
// captures with generous budgets, rAF-heartbeat freeze measurement, renderer
// memory sampling, tolerant pixel-readout verification against the oracle
// formula, and JSONL verdict recording that survives renderer crashes.
import { expect } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ElectronApplication, Page } from "@playwright/test";

import { enqueueOpenDialogPaths } from "./support/dialog-stub-controls";
import { computeCanvasPointForImagePixelAtFitView, type PixelDimensions } from "./support/image-pixel-canvas-mapping";
import { applicationToolbar, operationPanel } from "./support/operations";
import { panelCanvas, panelGrid } from "./support/panels";
import { statusBar } from "./support/pixel-readout";

const CURRENT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(CURRENT_DIRECTORY, "..");
export const AUDIT_DIRECTORY = join(REPO_ROOT, ".scale-audit");
const RESULTS_PATH = join(AUDIT_DIRECTORY, "results.jsonl");

export const REFERENCE_STACK_PATH = join(AUDIT_DIRECTORY, "reference-stack.tif");
export const STRETCH_CAPTURE_PATH = join(AUDIT_DIRECTORY, "stretch-capture.tif");
export const REFERENCE_ENVI_HEADER_PATH = join(AUDIT_DIRECTORY, "reference-stack.hdr");
export const FLAT_FIELD_REFERENCE_PATH = join(AUDIT_DIRECTORY, "flat-field-reference.tif");
export const BIG_PHOTO_PATH = join(AUDIT_DIRECTORY, "big-photo.png");

export const REFERENCE_DIMENSIONS: PixelDimensions = { width: 8000, height: 6000 };
export const STRETCH_DIMENSIONS: PixelDimensions = { width: 14000, height: 11000 };
export const REFERENCE_BAND_COUNT = 16;

// value(band0, x, y) for the generated captures (see scripts/generate-scale-audit-stack.mjs)
export function referenceValue(bandIndexZeroBased: number, x: number, y: number): number {
  return (bandIndexZeroBased + 1) * 1000 + (x % 100) + (y % 100);
}

export function stretchValue(x: number, y: number): number {
  return 500 + (x % 100) + (y % 100);
}

// --- verdict recording -------------------------------------------------------

export interface AuditRecord {
  readonly area: string;
  readonly verdict: string;
  readonly [key: string]: unknown;
}

export function recordAuditResult(entry: AuditRecord): void {
  const line = JSON.stringify({ recordedAt: new Date().toISOString(), ...entry });
  appendFileSync(RESULTS_PATH, `${line}\n`);
  console.log(`AUDIT ${line}`);
}

// --- opening captures --------------------------------------------------------

export const REFERENCE_BAND_FILE_PATHS: ReadonlyArray<string> = Array.from(
  { length: REFERENCE_BAND_COUNT },
  (_, bandIndex) => join(AUDIT_DIRECTORY, `ref-band-${String(bandIndex + 1).padStart(2, "0")}.tif`),
);

// Groups the 16 per-band files into ONE 16-band stack through the Review-stacks
// modal, so each file crosses IPC as its own ~96 MB read. This is the audit's
// loadable route to reference scale while the single-file 1.5 GB load is broken
// (see the single-file probe finding).
export async function openReferenceStackViaGroupedBandFiles(
  page: Page,
  budgetMs: number,
): Promise<number> {
  await enqueueOpenDialogPaths(page, [...REFERENCE_BAND_FILE_PATHS]);
  const startedAt = Date.now();
  await applicationToolbar(page).getByRole("button", { name: "Open image" }).click();
  const modal = page.getByRole("dialog", { name: "Review stacks" });
  await expect(modal).toBeVisible({ timeout: 60_000 });
  await modal.getByRole("button", { name: /^Open \d+ stack/ }).click();
  await expect(panelGrid(page).getByText("ref-band-01", { exact: false }).first()).toBeVisible({
    timeout: budgetMs,
  });
  await expect(page.locator('[role="alertdialog"]')).toBeHidden({ timeout: budgetMs });
  return Date.now() - startedAt;
}

// Probes a SINGLE-file load that may hard-kill the renderer: resolves with the
// observed outcome instead of throwing, so expected-failure areas can record
// evidence and keep the audit alive.
export type SingleFileLoadOutcome =
  | { readonly kind: "loaded"; readonly loadMs: number }
  | { readonly kind: "renderer-died"; readonly afterMs: number }
  | { readonly kind: "error-toast"; readonly toasts: string[]; readonly afterMs: number }
  | { readonly kind: "still-loading-at-budget"; readonly afterMs: number };

export async function probeSingleFileLoad(
  page: Page,
  absolutePath: string,
  budgetMs: number,
): Promise<SingleFileLoadOutcome> {
  await enqueueOpenDialogPaths(page, [absolutePath]);
  const startedAt = Date.now();
  await applicationToolbar(page).getByRole("button", { name: "Open image" }).click();
  while (Date.now() - startedAt < budgetMs) {
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 1000));
    if (page.isClosed()) return { kind: "renderer-died", afterMs: Date.now() - startedAt };
    const outcome = await classifyLoadInProgress(page, absolutePath, startedAt);
    if (outcome) return outcome;
  }
  return { kind: "still-loading-at-budget", afterMs: Date.now() - startedAt };
}

// CT-220 moved single-file loads onto a viewport role="status" busy overlay
// labelled "Reading <file>..." (the old app-scope alertdialog is multi-file
// only), and that label CONTAINS the file's basename. Completion therefore
// requires the name in the grid AND every busy surface (alertdialog + status
// overlays) to be gone, or a mid-decode overlay would classify as loaded.
async function countBusySurfaces(page: Page): Promise<number> {
  const alertDialogs = await page.locator('[role="alertdialog"]').count();
  const statusOverlays = await panelGrid(page).locator('[role="status"]').count();
  return alertDialogs + statusOverlays;
}

async function classifyLoadInProgress(
  page: Page,
  absolutePath: string,
  startedAt: number,
): Promise<SingleFileLoadOutcome | null> {
  try {
    const toasts = await readVisibleToastTexts(page);
    const failure = toasts.filter((t) => t.toLowerCase().includes("failed") || t.toLowerCase().includes("could not"));
    if (failure.length > 0) return { kind: "error-toast", toasts: failure, afterMs: Date.now() - startedAt };
    const busySurfaces = await countBusySurfaces(page);
    const loaded = await panelGrid(page).getByText(basename(absolutePath), { exact: false }).count();
    if (busySurfaces === 0 && loaded > 0) return { kind: "loaded", loadMs: Date.now() - startedAt };
    return null;
  } catch {
    return page.isClosed() ? { kind: "renderer-died", afterMs: Date.now() - startedAt } : null;
  }
}

export async function openCaptureFromDisk(
  page: Page,
  absolutePath: string,
  budgetMs: number,
): Promise<number> {
  await enqueueOpenDialogPaths(page, [absolutePath]);
  const startedAt = Date.now();
  await applicationToolbar(page).getByRole("button", { name: "Open image" }).click();
  // Both busy surfaces carry the file name too ("Reading <file>..."), so
  // completion = the PANEL GRID shows the name AND every busy surface is gone.
  await expect(panelGrid(page).getByText(basename(absolutePath), { exact: false }).first()).toBeVisible({
    timeout: budgetMs,
  });
  await expect(page.locator('[role="alertdialog"]')).toBeHidden({ timeout: budgetMs });
  await expect(panelGrid(page).locator('[role="status"]')).toHaveCount(0, { timeout: budgetMs });
  return Date.now() - startedAt;
}

// --- rAF heartbeat (UI freeze measurement) ------------------------------------

export async function startUiHeartbeat(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = window as unknown as Record<string, unknown>;
    const state = { gaps: [] as number[], last: performance.now(), id: 0 };
    const tick = (t: number) => {
      state.gaps.push(t - state.last);
      state.last = t;
      state.id = requestAnimationFrame(tick);
    };
    state.id = requestAnimationFrame(tick);
    holder["__scaleAuditHeartbeat"] = state;
  });
}

export async function stopUiHeartbeatAndReadMaxGapMs(page: Page): Promise<number> {
  return page.evaluate(() => {
    const holder = window as unknown as Record<string, unknown>;
    const state = holder["__scaleAuditHeartbeat"] as { gaps: number[]; id: number } | undefined;
    if (!state) return -1;
    cancelAnimationFrame(state.id);
    holder["__scaleAuditHeartbeat"] = undefined;
    return state.gaps.length === 0 ? -1 : Math.max(...state.gaps);
  });
}

// --- renderer memory ----------------------------------------------------------

export async function readRendererPeakWorkingSetMb(app: ElectronApplication): Promise<number> {
  const metrics = await app.evaluate(({ app: electronApp }) =>
    electronApp.getAppMetrics().map((m) => ({ type: m.type, kb: m.memory.workingSetSize })),
  );
  const rendererKb = metrics.filter((m) => m.type === "Tab").map((m) => m.kb);
  return Math.round(Math.max(0, ...rendererKb) / 1024);
}

// --- toasts --------------------------------------------------------------------

export async function readVisibleToastTexts(page: Page): Promise<string[]> {
  return page.locator("[data-sonner-toast]").allInnerTexts();
}

// --- apply with a wall-clock budget ---------------------------------------------

export interface TimedApplyResult {
  readonly applyMs: number;
  readonly maxUiGapMs: number;
  readonly sawDeterminateProgressBar: boolean;
}

// Samples for a determinate role="progressbar" (the CT-220/221 percentage bar)
// while an apply runs, so verdicts can distinguish "long but visibly advancing"
// from "long with a bare spinner". Polls until stopped; misses nothing longer
// than the anti-flash delay + one poll interval.
function watchForDeterminateProgressBar(page: Page): { sawBar: () => boolean; stop: () => void } {
  let sawBar = false;
  let stopped = false;
  const poll = async (): Promise<void> => {
    while (!stopped && !sawBar) {
      sawBar = await page
        .locator('[role="progressbar"]')
        .count()
        .then((count) => count > 0)
        .catch(() => false);
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 250));
    }
  };
  void poll();
  return { sawBar: () => sawBar, stop: () => { stopped = true; } };
}

export async function applyOperationWithBudget(
  page: Page,
  operationLabel: string,
  budgetMs: number,
): Promise<TimedApplyResult> {
  const panel = operationPanel(page, operationLabel);
  await startUiHeartbeat(page);
  const progressWatch = watchForDeterminateProgressBar(page);
  const startedAt = Date.now();
  // A synchronous compute can freeze the main thread PAST the default 30s click
  // timeout (the click roundtrip never completes); give the click the full
  // apply budget so the freeze is measured instead of aborting the audit.
  await panel.getByRole("button", { name: "Apply", exact: true }).click({ timeout: budgetMs });
  try {
    await expect(panel).toBeHidden({ timeout: budgetMs });
  } catch (error) {
    progressWatch.stop();
    const toasts = await readVisibleToastTexts(page).catch(() => ["<unreadable>"]);
    throw new Error(`Apply(${operationLabel}) did not finish in ${budgetMs}ms; toasts: ${JSON.stringify(toasts)}`, {
      cause: error,
    });
  }
  // An async transform (transformSourceAsync, e.g. the worker-backed spatial
  // filter) closes the operation panel immediately and shows a role="status"
  // busy overlay on the result panel until the worker finishes; completion is
  // the overlay clearing, not the panel hiding.
  await expect(panelGrid(page).locator('[role="status"]:has(svg.animate-spin)')).toHaveCount(0, {
    timeout: budgetMs,
  });
  const applyMs = Date.now() - startedAt;
  progressWatch.stop();
  const maxUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(page);
  await failOnOperationErrorToast(page, operationLabel);
  return { applyMs, maxUiGapMs, sawDeterminateProgressBar: progressWatch.sawBar() };
}

async function failOnOperationErrorToast(page: Page, operationLabel: string): Promise<void> {
  const toasts = await readVisibleToastTexts(page);
  const failure = toasts.find((text) => text.includes(`${operationLabel} failed`) || text.toLowerCase().includes("failed"));
  if (failure) throw new Error(`Apply(${operationLabel}) surfaced an error toast: ${failure}`);
}

// --- script runs at scale ---------------------------------------------------------

// Running a formula/tool structured-clones the WHOLE cube into the user-script
// IPC call, which can freeze the renderer main thread long enough that the
// triggering click's roundtrip outlives Playwright's default 30 s timeout. These
// click with the full budget so the freeze is MEASURED by the caller's
// heartbeat instead of aborting the audit.
export async function fillFormulaAndClickRunWithBudget(
  page: Page,
  operationLabel: string,
  formulaFieldLabel: string,
  expression: string,
  budgetMs: number,
): Promise<void> {
  const panel = operationPanel(page, operationLabel);
  await panel.getByLabel(formulaFieldLabel, { exact: true }).fill(expression);
  await panel.getByRole("button", { name: "Run formula", exact: true }).click({ timeout: budgetMs });
}

export async function clickPanelButtonWithBudget(
  page: Page,
  operationLabel: string,
  buttonName: string,
  budgetMs: number,
): Promise<void> {
  await operationPanel(page, operationLabel)
    .getByRole("button", { name: buttonName, exact: true })
    .click({ timeout: budgetMs });
}

// --- tolerant pixel readout -----------------------------------------------------

export interface ReportedPixel {
  readonly x: number;
  readonly y: number;
  readonly value: number;
  readonly rawValue: string;
}

// Hovers near the requested image pixel and returns WHATEVER pixel the status
// bar reports (with its true value), so oracles can be computed from the
// reported coordinates instead of demanding an exact sub-pixel hover at 8000px
// fit-view scale. Retries with small nudges until the readout is populated.
export async function readReportedPixelNear(
  page: Page,
  panelNumber: number,
  approximatePixel: { x: number; y: number },
  imageDimensions: PixelDimensions,
): Promise<ReportedPixel> {
  const box = await panelCanvasBoundingBox(page, panelNumber);
  const point = computeCanvasPointForImagePixelAtFitView(
    approximatePixel.x,
    approximatePixel.y,
    imageDimensions,
    box,
  );
  return hoverUntilReadoutPopulated(page, box, point);
}

async function panelCanvasBoundingBox(
  page: Page,
  panelNumber: number,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await panelCanvas(page, panelNumber).boundingBox();
  if (!box) throw new Error(`Panel ${panelNumber} canvas has no bounding box`);
  return box;
}

async function hoverUntilReadoutPopulated(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
): Promise<ReportedPixel> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    await page.mouse.move(box.x + point.x + (attempt % 5), box.y + point.y + (Math.floor(attempt / 5) % 3));
    await page.waitForTimeout(80);
    const readout = await tryReadPopulatedReadout(page);
    if (readout) return readout;
  }
  throw new Error("Pixel readout never populated while hovering the panel canvas");
}

// Diagnostic sibling of readReportedPixelNear: reports WHATEVER the status bar
// shows (including non-finite values) so a NaN-producing operation is
// distinguishable from a readout that never appears at all.
export async function readRawStatusBarReadout(
  page: Page,
  panelNumber: number,
  approximatePixel: { x: number; y: number },
  imageDimensions: PixelDimensions,
): Promise<string> {
  const box = await panelCanvasBoundingBox(page, panelNumber);
  const point = computeCanvasPointForImagePixelAtFitView(
    approximatePixel.x,
    approximatePixel.y,
    imageDimensions,
    box,
  );
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.waitForTimeout(1500);
  const bar = statusBar(page);
  if ((await bar.getByTestId("pixel-readout-x").count()) === 0) return "<no readout fields present>";
  const x = await bar.getByTestId("pixel-readout-x").innerText();
  const y = await bar.getByTestId("pixel-readout-y").innerText();
  const value = await bar.getByTestId("pixel-readout-value").innerText();
  return `x=${x} y=${y} value=${value}`;
}

async function tryReadPopulatedReadout(page: Page): Promise<ReportedPixel | null> {
  const bar = statusBar(page);
  if ((await bar.getByTestId("pixel-readout-x").count()) === 0) return null;
  const x = Number.parseInt(await bar.getByTestId("pixel-readout-x").innerText(), 10);
  const y = Number.parseInt(await bar.getByTestId("pixel-readout-y").innerText(), 10);
  const rawValue = (await bar.getByTestId("pixel-readout-value").innerText()).trim();
  const value = Number.parseFloat(rawValue.replace(/,/g, ""));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(value)) return null;
  return { x, y, value, rawValue };
}

// Some oracles (denoise, percentile mid-window) need the reported pixel to sit
// away from the modulo-100 ramp wrap; nudge until both coordinates land with a
// margin inside the 100-pixel cell.
export async function readSmoothInteriorPixel(
  page: Page,
  panelNumber: number,
  imageDimensions: PixelDimensions,
): Promise<ReportedPixel> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const probe = { x: 2450 + attempt * 7, y: 1850 + attempt * 3 };
    const reported = await readReportedPixelNear(page, panelNumber, probe, imageDimensions);
    if (isAwayFromRampWrap(reported.x) && isAwayFromRampWrap(reported.y)) return reported;
  }
  throw new Error("Could not land a hover away from the ramp wrap boundaries");
}

function isAwayFromRampWrap(coordinate: number): boolean {
  const remainder = coordinate % 100;
  return remainder >= 5 && remainder <= 94;
}

// --- panel management -------------------------------------------------------------

export async function countGridPanels(page: Page): Promise<number> {
  return panelGrid(page).getByRole("gridcell").count();
}

export async function closeAuditResultPanel(page: Page, panelNumber: number): Promise<void> {
  const before = await countGridPanels(page);
  await page.getByRole("button", { name: `Close panel ${panelNumber}`, exact: true }).click();
  await expect.poll(() => countGridPanels(page)).toBe(before - 1);
}

export async function expectCanvasShowsContent(page: Page, panelNumber: number): Promise<void> {
  await expect(panelCanvas(page, panelNumber)).toBeVisible();
}

export function expectValueCloseTo(actual: number, expected: number, tolerance: number, label: string): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: read ${actual}, expected ${expected} (tolerance ${tolerance})`);
  }
}
