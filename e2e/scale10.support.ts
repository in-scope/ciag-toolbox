// scale10 sweep support (COMMITTED, CT-238): shared plumbing for the opt-in
// 10 GB / 100-band reference-scale specs. Promotes the CT-219 scale-audit
// patterns: the tolerant pixel-readout oracle, rAF-heartbeat UI-gap
// measurement with the 5000 ms threshold, determinate progressbar sampling,
// renderer working-set sampling via getAppMetrics, and JSONL verdict
// recording that survives renderer crashes.
//
// Every scale10 spec is gated by skipUnlessScale10SweepIsEnabled(): it runs
// only when MSI_SCALE10=1 AND the generated fixtures exist in .scale-audit/
// (node scripts/generate-scale10-stack.mjs).
import { expect, test } from "@playwright/test";
import { appendFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ElectronApplication, Page } from "@playwright/test";

import { enqueueOpenDialogPaths } from "./support/dialog-stub-controls";
import {
  computeCanvasPointForImagePixelAtFitView,
  type PixelDimensions,
} from "./support/image-pixel-canvas-mapping";
import { confirmReviewModal, openImagesReviewModal } from "./support/open-images-flow";
import { applicationToolbar, operationPanel } from "./support/operations";
import { panelCanvas, panelGrid } from "./support/panels";
import { statusBar } from "./support/pixel-readout";
import { runAsStoryboardStep } from "./support/storyboard-step";

const CURRENT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(CURRENT_DIRECTORY, "..");
export const SCALE10_FIXTURE_DIRECTORY = join(REPO_ROOT, ".scale-audit");
const RESULTS_PATH = join(SCALE10_FIXTURE_DIRECTORY, "scale10-results.jsonl");

export const SCALE10_REFERENCE_HEADER_PATH = join(SCALE10_FIXTURE_DIRECTORY, "scale10-reference.hdr");
export const SCALE10_FLAT_FIELD_PATH = join(SCALE10_FIXTURE_DIRECTORY, "scale10-flat-field.tif");
export const SCALE10_BIG_PHOTO_PATH = join(SCALE10_FIXTURE_DIRECTORY, "scale10-big-photo.png");

export const SCALE10_DIMENSIONS: PixelDimensions = { width: 10_000, height: 5_000 };
export const SCALE10_BAND_COUNT = 100;

export const SCALE10_BAND_FILE_PATHS: ReadonlyArray<string> = Array.from(
  { length: SCALE10_BAND_COUNT },
  (_, bandIndex) =>
    join(SCALE10_FIXTURE_DIRECTORY, `scale10-band-${String(bandIndex + 1).padStart(3, "0")}.tif`),
);

// --- budgets (hard assertions from the scale10 PRD) --------------------------

export const SCALE10_SINGLE_FILE_OPEN_BUDGET_MS = 30 * 60_000;
export const SCALE10_GROUPED_OPEN_BUDGET_MS = 30 * 60_000;
export const SCALE10_APPLY_BUDGET_MS = 30 * 60_000;
export const SCALE10_MAX_UI_GAP_MS = 5_000;
export const SCALE10_RENDERER_WORKING_SET_LIMIT_MB = 16 * 1024;

// --- oracle -------------------------------------------------------------------

// value(band, x, y) for the generated capture (scripts/generate-scale10-stack.mjs),
// band ZERO-based; max value 100*600 + 99 + 99 = 60198, safely inside uint16.
export function scale10Value(bandIndexZeroBased: number, x: number, y: number): number {
  return (bandIndexZeroBased + 1) * 600 + (x % 100) + (y % 100);
}

// scale10-big-photo.png channel formulas (8-bit, never clipped: max 199).
export function scale10PhotoChannels(x: number, y: number): { red: number; green: number; blue: number } {
  return { red: 100 + (x % 100), green: 100 + (y % 100), blue: 50 };
}

// --- opt-in gate ----------------------------------------------------------------

export function scale10FixturesArePresent(): boolean {
  const requiredPaths = [
    SCALE10_REFERENCE_HEADER_PATH,
    SCALE10_FLAT_FIELD_PATH,
    SCALE10_BIG_PHOTO_PATH,
    ...SCALE10_BAND_FILE_PATHS,
  ];
  return requiredPaths.every((path) => existsSync(path));
}

export function skipUnlessScale10SweepIsEnabled(): void {
  test.skip(
    process.env["MSI_SCALE10"] !== "1" || !scale10FixturesArePresent(),
    "scale10 sweep is opt-in: set MSI_SCALE10=1 and generate the fixtures with 'node scripts/generate-scale10-stack.mjs'",
  );
}

// --- JSONL verdict recording -----------------------------------------------------

export interface Scale10Record {
  readonly area: string;
  readonly verdict: string;
  readonly [key: string]: unknown;
}

// Appends one line per verdict so evidence survives a renderer crash later in
// the same run; also echoed to the runner console for live progress.
export function recordScale10Result(entry: Scale10Record): void {
  const line = JSON.stringify({ recordedAt: new Date().toISOString(), ...entry });
  appendFileSync(RESULTS_PATH, `${line}\n`);
  console.log(`SCALE10 ${line}`);
}

// --- rAF heartbeat (UI-gap measurement) --------------------------------------------

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
    holder["__scale10Heartbeat"] = state;
  });
}

export async function stopUiHeartbeatAndReadMaxGapMs(page: Page): Promise<number> {
  return page.evaluate(() => {
    const holder = window as unknown as Record<string, unknown>;
    const state = holder["__scale10Heartbeat"] as { gaps: number[]; id: number } | undefined;
    if (!state) return -1;
    cancelAnimationFrame(state.id);
    holder["__scale10Heartbeat"] = undefined;
    return state.gaps.length === 0 ? -1 : Math.max(...state.gaps);
  });
}

// --- determinate progressbar sampling ------------------------------------------------

export interface ProgressBarWatch {
  readonly sawDeterminateBar: () => boolean;
  readonly stop: () => void;
}

// Polls for the busy-card progress bar (busy-indicators.tsx renders
// role="progressbar" with aria-valuenow ONLY for determinate progress), so a
// long phase can prove it advanced visibly instead of showing a bare spinner.
export function watchForDeterminateProgressBar(page: Page): ProgressBarWatch {
  const state = { sawBar: false, stopped: false };
  void pollForDeterminateProgressBar(page, state);
  return { sawDeterminateBar: () => state.sawBar, stop: () => { state.stopped = true; } };
}

async function pollForDeterminateProgressBar(
  page: Page,
  state: { sawBar: boolean; stopped: boolean },
): Promise<void> {
  while (!state.stopped && !state.sawBar) {
    state.sawBar = await pageShowsDeterminateProgressBar(page);
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 250));
  }
}

async function pageShowsDeterminateProgressBar(page: Page): Promise<boolean> {
  return page
    .locator('[role="progressbar"][aria-valuenow]')
    .count()
    .then((count) => count > 0)
    .catch(() => false);
}

// --- renderer working-set sampling ------------------------------------------------------

// Samples every renderer ("Tab") process working set and returns the largest,
// in MB. This is the committed oracle for "steady-state memory is one cube,
// not cube plus file" (CT-231 + CT-232).
export async function readRendererWorkingSetMb(app: ElectronApplication): Promise<number> {
  const metrics = await app.evaluate(({ app: electronApp }) =>
    electronApp.getAppMetrics().map((m) => ({ type: m.type, kb: m.memory.workingSetSize })),
  );
  const rendererKb = metrics.filter((m) => m.type === "Tab").map((m) => m.kb);
  return Math.round(Math.max(0, ...rendererKb) / 1024);
}

// --- toasts --------------------------------------------------------------------------------

export async function readVisibleToastTexts(page: Page): Promise<string[]> {
  return page.locator("[data-sonner-toast]").allInnerTexts();
}

export async function expectNoRawAllocationFailureToast(page: Page): Promise<void> {
  const toasts = await readVisibleToastTexts(page);
  const leaked = toasts.filter((text) => text.toLowerCase().includes("allocation failed"));
  expect(leaked, `raw allocator strings must never surface: ${JSON.stringify(leaked)}`).toHaveLength(0);
}

// --- opening the capture ----------------------------------------------------------------------

export interface TimedLoad {
  readonly loadMs: number;
  readonly maxUiGapMs: number;
  readonly sawDeterminateProgressBar: boolean;
}

// Opens ONE file from disk (the CT-231 streaming ENVI path for .hdr, the
// chunked protocol for everything else) and waits for the panel to hold it
// with every busy surface gone. Records whether a determinate progress bar
// was observed while the read ran.
export async function openScale10SingleFile(
  page: Page,
  absolutePath: string,
  budgetMs: number,
): Promise<TimedLoad> {
  return runAsStoryboardStep(page, `Open ${basename(absolutePath)} as a single file`, async () => {
    await enqueueOpenDialogPaths(page, [absolutePath]);
    await startUiHeartbeat(page);
    const progressWatch = watchForDeterminateProgressBar(page);
    const startedAt = Date.now();
    await applicationToolbar(page).getByRole("button", { name: "Open image" }).click();
    await expectFileLoadedIntoPanelGrid(page, basename(absolutePath), budgetMs);
    progressWatch.stop();
    const maxUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(page);
    return { loadMs: Date.now() - startedAt, maxUiGapMs, sawDeterminateProgressBar: progressWatch.sawDeterminateBar() };
  });
}

// Both busy surfaces carry the file name too ("Reading <file>..."), so
// completion = the panel grid shows the name AND every busy surface is gone.
async function expectFileLoadedIntoPanelGrid(
  page: Page,
  fileName: string,
  budgetMs: number,
): Promise<void> {
  await expect(panelGrid(page).getByText(fileName, { exact: false }).first()).toBeVisible({
    timeout: budgetMs,
  });
  await expect(page.locator('[role="alertdialog"]')).toBeHidden({ timeout: budgetMs });
  await expect(panelGrid(page).locator('[role="status"]')).toHaveCount(0, { timeout: budgetMs });
}

// Groups the 100 per-band scale10 TIFFs into ONE 100-band stack through the
// Review-stacks modal; each file crosses IPC through the 64 MiB chunked read.
export async function openScale10GroupedBandFiles(page: Page, budgetMs: number): Promise<TimedLoad> {
  return runAsStoryboardStep(page, "Open the 100 grouped band files as one stack", async () => {
    await enqueueOpenDialogPaths(page, [...SCALE10_BAND_FILE_PATHS]);
    const startedAt = Date.now();
    await applicationToolbar(page).getByRole("button", { name: "Open image" }).click();
    await confirmScale10ReviewModal(page);
    await startUiHeartbeat(page);
    const progressWatch = watchForDeterminateProgressBar(page);
    await expectFileLoadedIntoPanelGrid(page, "scale10-band-001", budgetMs);
    progressWatch.stop();
    const maxUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(page);
    return { loadMs: Date.now() - startedAt, maxUiGapMs, sawDeterminateProgressBar: progressWatch.sawDeterminateBar() };
  });
}

async function confirmScale10ReviewModal(page: Page): Promise<void> {
  await expect(openImagesReviewModal(page)).toBeVisible({ timeout: 5 * 60_000 });
  await confirmReviewModal(page);
}

// --- tolerant pixel-readout oracle ------------------------------------------------------------------

export interface ReportedPixel {
  readonly x: number;
  readonly y: number;
  readonly value: number;
  readonly rawValue: string;
}

// Hovers near the requested image pixel and returns WHATEVER pixel the status
// bar reports (with its true value). At fit view one canvas pixel spans ~12
// image pixels of the 10000-wide capture, so oracles are computed from the
// REPORTED coordinates instead of demanding an exact sub-pixel hover; the
// modulo-100 formula makes any reported pixel exactly checkable.
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

export function expectValueCloseTo(
  actual: number,
  expected: number,
  tolerance: number,
  label: string,
): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: read ${actual}, expected ${expected} (tolerance ${tolerance})`);
  }
}

// --- apply with a wall-clock budget --------------------------------------------------------------------

export interface TimedApply {
  readonly applyMs: number;
  readonly maxUiGapMs: number;
  readonly sawDeterminateProgressBar: boolean;
}

// Applies an already-configured operation panel under the sweep budgets: the
// click gets the full budget (a synchronous compute can outlive the default
// 30 s click roundtrip), completion is the panel hiding AND any async-worker
// busy overlay clearing, and an operation error toast fails the apply.
export async function applyOperationWithBudget(
  page: Page,
  operationLabel: string,
  budgetMs: number,
): Promise<TimedApply> {
  return runAsStoryboardStep(page, `Apply ${operationLabel} within budget`, async () => {
    const panel = operationPanel(page, operationLabel);
    await startUiHeartbeat(page);
    const progressWatch = watchForDeterminateProgressBar(page);
    const startedAt = Date.now();
    await panel.getByRole("button", { name: "Apply", exact: true }).click({ timeout: budgetMs });
    await expectApplyCompleted(page, panel, budgetMs);
    const applyMs = Date.now() - startedAt;
    progressWatch.stop();
    const maxUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(page);
    await failOnOperationErrorToast(page, operationLabel);
    return { applyMs, maxUiGapMs, sawDeterminateProgressBar: progressWatch.sawDeterminateBar() };
  });
}

// An async transform (transformSourceAsync, e.g. the worker-backed spatial
// filter) closes the operation panel immediately and shows a role="status"
// busy overlay on the result panel until the worker finishes; completion is
// the overlay clearing, not just the panel hiding.
async function expectApplyCompleted(
  page: Page,
  panel: ReturnType<typeof operationPanel>,
  budgetMs: number,
): Promise<void> {
  await expect(panel).toBeHidden({ timeout: budgetMs });
  await expect(panelGrid(page).locator('[role="status"]:has(svg.animate-spin)')).toHaveCount(0, {
    timeout: budgetMs,
  });
}

async function failOnOperationErrorToast(page: Page, operationLabel: string): Promise<void> {
  const toasts = await readVisibleToastTexts(page);
  const failure = toasts.find(
    (text) => text.includes(`${operationLabel} failed`) || text.toLowerCase().includes("failed"),
  );
  if (failure) throw new Error(`Apply(${operationLabel}) surfaced an error toast: ${failure}`);
}
