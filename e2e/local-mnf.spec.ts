import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { builtinScriptReferences, parityStackTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  expectHistoryToRecordOperation,
  historyEntryCount,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  loadImageFromAbsolutePath,
  openOperation,
  operationPanel,
  panelGrid,
  readMetadata,
  selectPanel,
  type PixelDimensions,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";
import { writeTemporaryMultiBandUint16Tiff } from "./support/temporary-multi-band-tiff-fixture";

// CT-312: Local MNF - spatially adaptive MNF, running the client's own Python
// (resources/builtin-python/local_mnf.py) through the bundled worker. Mirrors
// e2e/local-pca.spec.ts exactly: local_mnf.py shares localPCA's run() signature
// and every control, so only the script, panel label, and pinned reference
// differ.
//
// FIXTURE: parity-16x16.tif (16x16x3 uint16), the CT-311 parity fixture (its
// default stride of 8 needs more than the 4x4 fixtures).
//
// ORACLE: builtinScriptReferences.localMnf - the output the CT-307 reference
// runner produced by executing the SAME script with the bundled runtime and NO
// params, pinned in manifest.json. The app applies with its panel defaults, so
// a default that drifted from the script's own default would break parity.
// Every pixel is asserted through the status-bar pixel readout at 1e-4 relative
// tolerance.
//
// The Stop test runs the same algorithm at stride 1 over a throwaway 256x256
// stack, so the Python loop is long enough to watch the determinate in-script
// progress bar advance and then cut it short.

const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;
const LOCAL_MNF_LABEL = "Local MNF";
const IMAGE: PixelDimensions = { width: parityStackTiff.width, height: parityStackTiff.height };
const REFERENCE = builtinScriptReferences.localMnf;
const RELATIVE_TOLERANCE = 1e-4;
const DEFAULT_APPLIED_LABEL = "Local MNF (stride 8, kernel radius 8, local mean subtracted)";

// MNF's noise covariance needs enough samples to stay invertible, so (unlike
// Local PCA's stop test) this fixture cannot be a plain collinear ramp AND the
// stop run cannot use the radius-matches-stride sentinel at stride 1 (a 2x2
// window is degenerate for a 3-band covariance and the run fails almost
// instantly with LinAlgError, exactly like the CT-307 parity fixture's
// "4x4 is too collinear for MNF" note). An explicit small radius plus
// deterministic LCG noise over per-band gradients (same recipe as
// parity-16x16.tif) keeps every window well-conditioned; the larger side
// keeps the FULL run far longer than the test needs while the first few rows
// (fast at this radius) still arrive well under a second.
const STOPPABLE_SIDE = 768;
const STOPPABLE_BAND_COUNT = 3;
const STOPPABLE_STRIDE = "1";
const STOPPABLE_RADIUS = "4";
const STOP_TIMEOUT_MS = 120_000;

// The readout formats floats to four significant figures, so a parity assertion
// through the status bar allows the tolerance plus half the display quantum.
function readoutToleranceFor(referenceValue: number): number {
  const magnitude = Math.floor(Math.log10(Math.abs(referenceValue)));
  return Math.abs(referenceValue) * RELATIVE_TOLERANCE + 10 ** (magnitude - 3) / 2;
}

function referenceValueAtPixel(x: number, y: number): number {
  const value = REFERENCE.values[y * IMAGE.width + x];
  if (value === undefined) throw new Error(`local_mnf reference is missing (${x}, ${y})`);
  return value;
}

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("projects the stack onto its local noise-fraction components, matching the pinned reference", async () => {
  const page = launched.window;
  await loadFixtureAsStack(page, parityStackTiff.fileName);
  await selectPanel(page, SOURCE_PANEL);

  await openOperation(page, LOCAL_MNF_LABEL);
  await expectTheScriptDefaultsAreOffered(page);
  await applyOperation(page, LOCAL_MNF_LABEL);

  await selectPanel(page, RESULT_PANEL);
  await expectResultIsASingleComponentBand(page);
  await expectResultMatchesThePinnedReference(page);
  await expectHistoryToRecordTheParameterValues(page);
});

test("stops a running Local MNF, delivering nothing", async () => {
  const page = launched.window;
  await loadImageFromAbsolutePath(page, await writeStoppableStackFixture());
  await selectPanel(page, SOURCE_PANEL);
  const historyEntriesBefore = await historyEntryCount(page);

  await openOperation(page, LOCAL_MNF_LABEL);
  await setStride(page, STOPPABLE_STRIDE);
  await setRadius(page, STOPPABLE_RADIUS);
  await startApplyWithoutWaitingForTheResult(page);

  await expectDeterminateProgressWhileRunning(page);
  await stopTheRunningApply(page);

  await expect(page.locator("[data-sonner-toast]", { hasText: "Operation stopped" })).toBeVisible({
    timeout: STOP_TIMEOUT_MS,
  });
  await expectNoStackWasDeliveredAndHistoryIsUnchanged(page, historyEntriesBefore);
});

// CT-268: a stopped apply leaves its reserved grid cell in place but EMPTY, so
// "nothing was delivered" is asserted on the per-panel close button (which only
// renders for a cell holding an image) and on the source panel's History.
async function expectNoStackWasDeliveredAndHistoryIsUnchanged(
  page: Page,
  historyEntriesBefore: number,
): Promise<void> {
  await runAsStoryboardStep(page, "No stack was delivered and History is clean", async () => {
    await expect(applyBusyOverlay(page)).toHaveCount(0, { timeout: STOP_TIMEOUT_MS });
    await expect(
      page.getByRole("button", { name: `Close panel ${RESULT_PANEL}`, exact: true }),
    ).toHaveCount(0);
    await selectPanel(page, SOURCE_PANEL);
    expect(await historyEntryCount(page)).toBe(historyEntriesBefore);
  });
}

async function expectTheScriptDefaultsAreOffered(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The panel offers the script's own defaults", async () => {
    const panel = operationPanel(page, LOCAL_MNF_LABEL);
    await expect(panel.getByLabel("Stride")).toHaveValue("8");
    await expect(panel.getByLabel("Kernel radius")).toHaveValue("0");
    await expect(panel.getByLabel("Subtract local mean")).toBeChecked();
  });
}

async function expectResultIsASingleComponentBand(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The result is one labelled local component", async () => {
    const metadata = await readMetadata(page);
    expect(metadata.bandCount).toBe("1");
    await expect(page.getByText("Local MNF 1").first()).toBeVisible();
  });
}

async function expectResultMatchesThePinnedReference(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Every sampled pixel matches the reference output", async () => {
    for (const pixel of [
      { x: 0, y: 0 },
      { x: 15, y: 0 },
      { x: 7, y: 7 },
      { x: 8, y: 8 },
      { x: 3, y: 11 },
      { x: 15, y: 15 },
    ]) {
      const expected = referenceValueAtPixel(pixel.x, pixel.y);
      await expectPixelReadoutToEqual(page, {
        panel: RESULT_PANEL,
        imageX: pixel.x,
        imageY: pixel.y,
        dimensions: IMAGE,
        expected,
        tolerance: readoutToleranceFor(expected),
      });
    }
  });
}

async function expectHistoryToRecordTheParameterValues(page: Page): Promise<void> {
  await expectHistoryToRecordOperation(page, {
    actionLabel: LOCAL_MNF_LABEL,
    detailSubstrings: [DEFAULT_APPLIED_LABEL],
  });
}

// Deterministic LCG noise layered over a per-band gradient (same recipe as the
// generator's parity-16x16.tif) so every local window's covariance stays
// invertible; the values themselves are otherwise irrelevant to the Stop
// assertion. No clocks, no Math.random: identical bytes on every run.
const STOPPABLE_BAND_BASES = [300, 1200, 2400];
const STOPPABLE_GRADIENT_X_STEP = 8;
const STOPPABLE_GRADIENT_Y_STEP = 5;
const STOPPABLE_NOISE_AMPLITUDE = 120;
const STOPPABLE_NOISE_SEED = 0x53474d31;

function createDeterministicNoiseGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function buildStoppableBand(base: number, nextNoise: () => number): number[] {
  return Array.from({ length: STOPPABLE_SIDE * STOPPABLE_SIDE }, (_unused, index) => {
    const x = index % STOPPABLE_SIDE;
    const y = Math.floor(index / STOPPABLE_SIDE);
    const gradient = base + STOPPABLE_GRADIENT_X_STEP * x + STOPPABLE_GRADIENT_Y_STEP * y;
    return gradient + Math.round(nextNoise() * STOPPABLE_NOISE_AMPLITUDE);
  });
}

function writeStoppableStackFixture(): Promise<string> {
  const nextNoise = createDeterministicNoiseGenerator(STOPPABLE_NOISE_SEED);
  const bands = Array.from({ length: STOPPABLE_BAND_COUNT }, (_unused, bandIndex) =>
    buildStoppableBand(STOPPABLE_BAND_BASES[bandIndex % STOPPABLE_BAND_BASES.length]!, nextNoise),
  );
  return writeTemporaryMultiBandUint16Tiff({
    width: STOPPABLE_SIDE,
    height: STOPPABLE_SIDE,
    bands,
  });
}

async function setStride(page: Page, stride: string): Promise<void> {
  await runAsStoryboardStep(page, `Set the stride to ${stride}`, async () => {
    const field = operationPanel(page, LOCAL_MNF_LABEL).getByLabel("Stride");
    await field.fill(stride);
    await expect(field).toHaveValue(stride);
  });
}

async function setRadius(page: Page, radius: string): Promise<void> {
  await runAsStoryboardStep(page, `Set the kernel radius to ${radius}`, async () => {
    const field = operationPanel(page, LOCAL_MNF_LABEL).getByLabel("Kernel radius");
    await field.fill(radius);
    await expect(field).toHaveValue(radius);
  });
}

// applyOperation waits for the run to finish, which is exactly what this test
// must not do: it needs the apply still running.
async function startApplyWithoutWaitingForTheResult(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Start the apply and leave it running", async () => {
    await operationPanel(page, LOCAL_MNF_LABEL)
      .getByRole("button", { name: "Apply", exact: true })
      .click();
  });
}

function applyBusyOverlay(page: Page): Locator {
  return panelGrid(page).locator('[role="status"]');
}

// The bar must be driven by the SCRIPT, not merely appear: the cube upload runs
// the bar to 1 within an instant, so the proof is that it drops back below 1
// (the first per-grid-row report from inside the Python loop) and then climbs
// again while the worker runs.
async function expectDeterminateProgressWhileRunning(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The run reports determinate progress", async () => {
    const progressBar = applyBusyOverlay(page).getByRole("progressbar").first();
    await expect(progressBar).toBeVisible({ timeout: STOP_TIMEOUT_MS });
    await expect
      .poll(() => readReportedProgress(progressBar), { timeout: STOP_TIMEOUT_MS })
      .toBeLessThan(1);
    const firstInScriptFraction = await readReportedProgress(progressBar);
    await expect
      .poll(() => readReportedProgress(progressBar), { timeout: STOP_TIMEOUT_MS })
      .toBeGreaterThan(firstInScriptFraction);
  });
}

async function readReportedProgress(progressBar: Locator): Promise<number> {
  return Number(await progressBar.getAttribute("aria-valuenow"));
}

async function stopTheRunningApply(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Stop the running Local MNF", async () => {
    await applyBusyOverlay(page).getByRole("button", { name: "Stop", exact: true }).click();
  });
}
