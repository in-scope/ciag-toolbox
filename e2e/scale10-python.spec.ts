// CT-241 scale10 sweep: the Python scripting consumers at reference scale.
//
// Correctness is proven on the 25-BAND SUBSET (bands 1-25 via Subset Bands,
// full 10000x5000 spatial size, the CT-240 keep-bands route): band weighting
// formula run, band selection formula run, custom transform formula run
// (cube * 2), and the custom-transform imported-tool route (the T25 pattern,
// e2e/fixtures/transform-tool.py). MEMORY FLOW (the CT-239 pool model): each
// test CLOSES the 100-band source panel after subsetting - keep-bands ALIASES
// its 25 uint16 band buffers, so the close drops live pool usage to 2.5 GB and
// the runs' 5 GB float32 result cubes fit the ~17 GB renderer pool with real
// slack. Keeping the 10 GB source open would sit on the allocation cliff.
//
// The FULL-SCALE PROBE launches the band weighting run on all 100 bands. A
// value run's Python worker peaks at twice the float32 cube (40 GB at this
// scale), so on a 32 GB machine the CT-241 begin-time memory gate refuses it
// with the CT-239 refusal copy before any bytes move; on a larger machine the
// run may genuinely complete. The probe accepts either outcome, requires the
// renderer to stay responsive throughout, and asserts that no repo-owned
// python workers and no msi-user-script-cube-*.bin spool files survive.
//
// OPT-IN: runs only with MSI_SCALE10=1 and the generated fixtures present
// (node scripts/generate-scale10-stack.mjs); otherwise every test skips.
// Run locally: dev server first (pnpm dev), pnpm build first (main changed),
//   MSI_SCALE10=1 MSI_E2E_TRACE_LABEL=CT-241 pnpm e2e scale10-python.spec.ts
import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applySubsetBands,
  openSubsetBandsEditor,
  setSubsetBandsOpenInNewPanel,
  subsetBandsEditor,
  subsetBandsKeepCheckboxes,
  uncheckSubsetBandRow,
} from "./support/band-management";
import {
  BAND_SELECTION_OPERATION_LABEL,
  openBandSelectionFunctionEditor,
  runBandSelectionFormula,
} from "./support/band-selection";
import {
  BAND_WEIGHTING_OPERATION_LABEL,
  bandWeightField,
  expectBandWeightingEditorReady,
  runBandWeightingFormula,
} from "./support/band-weighting";
import {
  clickImportCustomTransformScript,
  CUSTOM_TRANSFORM_FORMULA_SET_STATUS,
  CUSTOM_TRANSFORM_OPERATION_LABEL,
  expectCustomTransformConfigured,
  expectCustomTransformEditorReady,
  loadedToolStatusText,
  setCustomTransformFormula,
} from "./support/custom-transform";
import { enqueueOpenDialogPaths } from "./support/dialog-stub-controls";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { openOperation } from "./support/operations";
import { selectPanel } from "./support/panels";
import { runAsStoryboardStep } from "./support/storyboard-step";
import {
  applyConfiguredPanelWithBudget,
  applyOperationWithBudget,
  closeGridPanel,
  countGridPanels,
  expectFloatReadoutCloseTo,
  expectNoRawAllocationFailureToast,
  expectValueCloseTo,
  forceRendererGarbageCollection,
  openScale10SingleFile,
  readReportedPixelNear,
  readVisibleToastTexts,
  recordScale10Result,
  SCALE10_APPLY_BUDGET_MS,
  SCALE10_BAND_COUNT,
  SCALE10_DIMENSIONS,
  SCALE10_MAX_UI_GAP_MS,
  SCALE10_REFERENCE_HEADER_PATH,
  SCALE10_SINGLE_FILE_OPEN_BUDGET_MS,
  scale10Value,
  selectActiveBandNumberInPanel,
  skipUnlessScale10SweepIsEnabled,
  startUiHeartbeat,
  stopUiHeartbeatAndReadMaxGapMs,
} from "./scale10.support";
import type { ReportedPixel } from "./scale10.support";

const SUBSET_PANEL = 1;
const RESULT_PANEL = 2;
const PROBE_PIXEL = { x: 150, y: 250 };
const SUBSET_KEPT_BAND_COUNT = 25;

// The PRD grants each Python consumer run 20 minutes; the budget is the
// acceptance bar and fails before the test timeout.
const PYTHON_RUN_BUDGET_MS = 20 * 60_000;
const SUBSET_TEST_TIMEOUT_MS = 80 * 60_000;
const PROBE_TEST_TIMEOUT_MS = 60 * 60_000;
const LEAK_CHECK_TIMEOUT_MS = 60_000;
const RUN_OUTCOME_POLL_INTERVAL_MS = 500;

// The two graceful outcomes the probe accepts (locked by the PRD): the CT-239
// memory-budget refusal copy and the mapped allocator message. Anything else
// that looks like a failure - a timeout, a raw allocator string, a Python
// traceback - fails the probe.
const MEMORY_REFUSAL_COPY =
  "There is not enough memory for this operation with the current panels open. " +
  "Close panels you no longer need, use a band-wise scope, or crop the stack and try again.";
const MAPPED_ALLOCATION_REFUSAL_PATTERN = /Not enough memory to allocate \d+ MB/;

const ARANGE_WEIGHTS_FORMULA = "np.arange(1, cube.shape[0] + 1)";
const MEAN_BAND_FORMULA = "cube.mean(axis=0)";
const DOUBLE_CUBE_FORMULA = "cube * 2";
const TRANSFORM_TOOL_FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "transform-tool.py",
);

// --- oracles ------------------------------------------------------------------
// Subset band n aliases source band n, value (b+1)*600 + (x%100) + (y%100).
// Weights 1..25 normalized by their sum 325: (600 * sum(k^2)) / 325 = 10200.
const SUBSET_ARANGE_WEIGHTED_BASE = 10_200;
// Mean over bands 1..25: 600 * (26 / 2) = 7800 (exact in float32).
const SUBSET_MEAN_BASE = 7_800;
// Weights 1..100 normalized by 5050: (600 * 338350) / 5050 = 40200.
const FULL_ARANGE_WEIGHTED_BASE = 40_200;
const WEIGHTED_SUM_EXTRA_TOLERANCE = 1;

let launched: LaunchedApp;
let testStartedAtMs = 0;

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
});

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

// --- the 25-band subset input --------------------------------------------------

// Opens the 10 GB capture, keeps bands 1-25 into a new panel, and closes the
// 100-band source so the live pool drops to the aliased 2.5 GB subset.
async function openTwentyFiveBandSubsetStack(): Promise<void> {
  await openScale10SingleFile(launched.window, SCALE10_REFERENCE_HEADER_PATH, SCALE10_SINGLE_FILE_OPEN_BUDGET_MS);
  await selectPanel(launched.window, 1);
  await forceRendererGarbageCollection(launched.window);
  await subsetToFirstTwentyFiveBandsInNewPanel();
  await closeGridPanel(launched.window, 1);
  await forceRendererGarbageCollection(launched.window);
  await selectPanel(launched.window, SUBSET_PANEL);
  await verifySubsetPanelReadsOracleBandOne();
}

async function subsetToFirstTwentyFiveBandsInNewPanel(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Subset Bands: keep bands 1-25 in a new panel", async () => {
    await openSubsetBandsEditor(launched.window);
    await expect(subsetBandsKeepCheckboxes(launched.window)).toHaveCount(SCALE10_BAND_COUNT);
    for (let bandNumber = SUBSET_KEPT_BAND_COUNT + 1; bandNumber <= SCALE10_BAND_COUNT; bandNumber += 1) {
      await uncheckSubsetBandRow(launched.window, bandNumber);
    }
    await setSubsetBandsOpenInNewPanel(launched.window, true);
    await applySubsetBands(launched.window);
    await expect.poll(() => countGridPanels(launched.window)).toBe(2);
  });
}

// Anchors the panel bookkeeping after the source close: the surviving panel
// must be the subset, reading source band 1 EXACTLY (kept bands alias).
async function verifySubsetPanelReadsOracleBandOne(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Verify the subset panel reads oracle band 1", async () => {
    await expect.poll(() => countGridPanels(launched.window)).toBe(1);
    await selectActiveBandNumberInPanel(launched.window, SUBSET_PANEL, 1);
    const reported = await readReportedPixelNear(launched.window, SUBSET_PANEL, PROBE_PIXEL, SCALE10_DIMENSIONS);
    const expected = scale10Value(0, reported.x, reported.y);
    expectValueCloseTo(reported.value, expected, 0, `subset band 1 at (${reported.x}, ${reported.y})`);
  });
}

// --- script-run completion polling ---------------------------------------------

// Polls the run's own success signal while watching for a failure toast, so a
// failed run surfaces its message immediately instead of a 20-minute timeout.
async function waitForScriptRunSuccess(
  runLabel: string,
  isRunComplete: () => Promise<boolean>,
  budgetMs: number,
): Promise<number> {
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;
  for (;;) {
    if (await isRunComplete()) return Date.now() - startedAt;
    await failOnScriptRunFailureToast(runLabel);
    if (Date.now() > deadline) throw new Error(`${runLabel} did not finish within its ${budgetMs} ms budget`);
    await launched.window.waitForTimeout(RUN_OUTCOME_POLL_INTERVAL_MS);
  }
}

async function failOnScriptRunFailureToast(runLabel: string): Promise<void> {
  const failure = await findFailureLikeToastText();
  if (failure !== null) throw new Error(`${runLabel} surfaced an error toast: ${failure}`);
}

async function findFailureLikeToastText(): Promise<string | null> {
  const toasts = await readVisibleToastTexts(launched.window).catch(() => []);
  return toasts.find((text) => /failed|memory|script|error/i.test(text)) ?? null;
}

async function weightFieldReads(bandNumber: number, expectedValue: string): Promise<boolean> {
  const value = await bandWeightField(launched.window, bandNumber).inputValue().catch(() => "");
  return value === expectedValue;
}

// CT-284: the band-selection function editor lives inside the Subset Bands
// editor's "By function" mode, so the staged-function proof reads from there.
function bandSelectionShowsFormulaFunction(): Promise<boolean> {
  return subsetBandsEditor(launched.window)
    .getByText("Selected function: Formula", { exact: true })
    .count()
    .then((count) => count > 0)
    .catch(() => false);
}

// --- leak checks (the cleanup Standing Rule, asserted in-test) -----------------

async function expectNoLeakedPythonWorkersOrSpools(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Verify no python workers or spool files remain", async () => {
    await expect
      .poll(listRepoOwnedPythonProcessIds, { timeout: LEAK_CHECK_TIMEOUT_MS })
      .toEqual([]);
    await expect
      .poll(listUserScriptSpoolFileNamesFromThisTest, { timeout: LEAK_CHECK_TIMEOUT_MS })
      .toEqual([]);
  });
}

// Repo-owned python workers are found by command line, not name alone (other
// Python installs run on dev machines); the bundled runtime lives under the
// repo, so its command line carries the ciag-toolbox path.
function listRepoOwnedPythonProcessIds(): string[] {
  const script =
    "Get-CimInstance Win32_Process | " +
    "Where-Object { $_.CommandLine -like '*ciag-toolbox*' -and $_.Name -like 'python*' } | " +
    "Select-Object -ExpandProperty ProcessId";
  const output = execSync(`powershell -NoProfile -Command "${script}"`, { encoding: "utf8" });
  return output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

// Only spool files created during THIS test count: stale files from earlier
// crashed sessions are the cleanup Standing Rule's business, not this spec's.
function listUserScriptSpoolFileNamesFromThisTest(): string[] {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith("msi-user-script-cube-") && name.endsWith(".bin"))
    .filter((name) => fileWasModifiedSinceTestStart(join(tmpdir(), name)));
}

function fileWasModifiedSinceTestStart(filePath: string): boolean {
  try {
    return statSync(filePath).mtimeMs >= testStartedAtMs;
  } catch {
    return false;
  }
}

// --- readout helpers -----------------------------------------------------------

async function readResultPanelValueOnBand(bandNumber: number): Promise<ReportedPixel> {
  await selectActiveBandNumberInPanel(launched.window, RESULT_PANEL, bandNumber);
  return readReportedPixelNear(launched.window, RESULT_PANEL, PROBE_PIXEL, SCALE10_DIMENSIONS);
}

// --- subset: band weighting formula run ----------------------------------------

test("subset band weighting: the arange formula populates 25 weights and Apply reads the weighted mean", async () => {
  test.setTimeout(SUBSET_TEST_TIMEOUT_MS);
  await recordSweepVerdict("python: Band Weighting formula run + apply (25-band subset)", async () => {
    await openTwentyFiveBandSubsetStack();
    const runMs = await runArangeWeightsFormulaExpectingPopulatedFields();
    const timing = await applyOperationWithBudget(launched.window, BAND_WEIGHTING_OPERATION_LABEL, SCALE10_APPLY_BUDGET_MS);
    expect(timing.maxUiGapMs).toBeLessThanOrEqual(SCALE10_MAX_UI_GAP_MS);
    await expectNoRawAllocationFailureToast(launched.window);
    const oracle = await verifyWeightedMeanReadout(SUBSET_ARANGE_WEIGHTED_BASE);
    await expectNoLeakedPythonWorkersOrSpools();
    return { runMs, applyMs: timing.applyMs, maxUiGapMs: timing.maxUiGapMs, oracle };
  });
});

// The formula returns np.arange(1, 26); the populated fields are the proof the
// Python worker ran over the uploaded cube (the T22 pattern).
async function runArangeWeightsFormulaExpectingPopulatedFields(): Promise<number> {
  return runAsStoryboardStep(launched.window, "Run the arange weight formula", async () => {
    await openOperation(launched.window, BAND_WEIGHTING_OPERATION_LABEL);
    await expectBandWeightingEditorReady(launched.window);
    await startUiHeartbeat(launched.window);
    await runBandWeightingFormula(launched.window, ARANGE_WEIGHTS_FORMULA);
    const runMs = await waitForScriptRunSuccess(
      "Band Weighting formula run",
      () => weightFieldReads(SUBSET_KEPT_BAND_COUNT, String(SUBSET_KEPT_BAND_COUNT)),
      PYTHON_RUN_BUDGET_MS,
    );
    const maxUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(launched.window);
    expect(maxUiGapMs, "the run must not freeze the renderer").toBeLessThanOrEqual(SCALE10_MAX_UI_GAP_MS);
    await expect(bandWeightField(launched.window, 2)).toHaveValue("2");
    return runMs;
  });
}

async function verifyWeightedMeanReadout(expectedBase: number): Promise<string> {
  return runAsStoryboardStep(launched.window, "Verify the weighted mean readout", async () => {
    const reported = await readResultPanelValueOnBand(1);
    const expected = expectedBase + (reported.x % 100) + (reported.y % 100);
    expectFloatReadoutCloseTo(
      reported.value,
      expected,
      `weighted mean at (${reported.x}, ${reported.y})`,
      WEIGHTED_SUM_EXTRA_TOLERANCE,
    );
    return `pixel (${reported.x}, ${reported.y}) read ${reported.rawValue}, expected ${expected}`;
  });
}

// --- subset: band selection formula run ----------------------------------------

test("subset band selection: the mean formula stages a custom band and Apply reads the band mean exactly", async () => {
  test.setTimeout(SUBSET_TEST_TIMEOUT_MS);
  await recordSweepVerdict("python: Band Selection formula run + apply (25-band subset)", async () => {
    await openTwentyFiveBandSubsetStack();
    const runMs = await runMeanBandFormulaExpectingStagedFunction();
    const timing = await applyConfiguredPanelWithBudget(
      launched.window,
      subsetBandsEditor(launched.window),
      BAND_SELECTION_OPERATION_LABEL,
      SCALE10_APPLY_BUDGET_MS,
    );
    expect(timing.maxUiGapMs).toBeLessThanOrEqual(SCALE10_MAX_UI_GAP_MS);
    await expectNoRawAllocationFailureToast(launched.window);
    const oracle = await verifyExactResultReadout(1, (x, y) => SUBSET_MEAN_BASE + (x % 100) + (y % 100), "band mean");
    await expectNoLeakedPythonWorkersOrSpools();
    return { runMs, applyMs: timing.applyMs, maxUiGapMs: timing.maxUiGapMs, oracle };
  });
});

// The formula's 50-megapixel band rides back through the JSON value path and
// is remembered in the result store; "Selected function: Formula" is the
// staged proof (the T23 pattern).
async function runMeanBandFormulaExpectingStagedFunction(): Promise<number> {
  return runAsStoryboardStep(launched.window, "Run the mean band formula", async () => {
    await openBandSelectionFunctionEditor(launched.window);
    await startUiHeartbeat(launched.window);
    await runBandSelectionFormula(launched.window, MEAN_BAND_FORMULA);
    const runMs = await waitForScriptRunSuccess(
      "Band Selection formula run",
      bandSelectionShowsFormulaFunction,
      PYTHON_RUN_BUDGET_MS,
    );
    const maxUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(launched.window);
    expect(maxUiGapMs, "the run must not freeze the renderer").toBeLessThanOrEqual(SCALE10_MAX_UI_GAP_MS);
    return runMs;
  });
}

// The subset values are integers exact in float32 and small enough that the
// status bar's 4-significant-figure float display is loss-free, so these
// readouts assert with ZERO tolerance.
async function verifyExactResultReadout(
  bandNumber: number,
  expectedValueAt: (x: number, y: number) => number,
  label: string,
): Promise<string> {
  return runAsStoryboardStep(launched.window, `Verify the exact ${label} readout on band ${bandNumber}`, async () => {
    const reported = await readResultPanelValueOnBand(bandNumber);
    const expected = expectedValueAt(reported.x, reported.y);
    expectValueCloseTo(reported.value, expected, 0, `${label} at (${reported.x}, ${reported.y})`);
    return `band ${bandNumber}: pixel (${reported.x}, ${reported.y}) read ${reported.rawValue}`;
  });
}

// --- subset: custom transform formula (cube * 2) -------------------------------

test("subset custom transform: the cube * 2 formula applies and reads exactly twice the oracle", async () => {
  test.setTimeout(SUBSET_TEST_TIMEOUT_MS);
  await recordSweepVerdict("python: Custom Transform formula run at apply (cube * 2, 25-band subset)", async () => {
    await openTwentyFiveBandSubsetStack();
    await openOperation(launched.window, CUSTOM_TRANSFORM_OPERATION_LABEL);
    await expectCustomTransformEditorReady(launched.window);
    await setCustomTransformFormula(launched.window, DOUBLE_CUBE_FORMULA);
    await expectCustomTransformConfigured(launched.window, CUSTOM_TRANSFORM_FORMULA_SET_STATUS);
    const timing = await applyOperationWithBudget(launched.window, CUSTOM_TRANSFORM_OPERATION_LABEL, SCALE10_APPLY_BUDGET_MS);
    expect(timing.maxUiGapMs).toBeLessThanOrEqual(SCALE10_MAX_UI_GAP_MS);
    await expectNoRawAllocationFailureToast(launched.window);
    const oracle = await verifyDoubledCubeReadouts();
    await expectNoLeakedPythonWorkersOrSpools();
    return { applyMs: timing.applyMs, maxUiGapMs: timing.maxUiGapMs, oracle };
  });
});

// Band 1 doubles to at most 2 * 699 = 1398 (loss-free at display precision, so
// exact); band 25 doubles past 4 significant figures, so it asserts at the
// float display precision.
async function verifyDoubledCubeReadouts(): Promise<string> {
  const first = await verifyExactResultReadout(1, (x, y) => 2 * scale10Value(0, x, y), "doubled band 1");
  const last = await runAsStoryboardStep(launched.window, "Verify the doubled band 25 readout", async () => {
    const reported = await readResultPanelValueOnBand(SUBSET_KEPT_BAND_COUNT);
    const expected = 2 * scale10Value(SUBSET_KEPT_BAND_COUNT - 1, reported.x, reported.y);
    expectFloatReadoutCloseTo(reported.value, expected, `doubled band 25 at (${reported.x}, ${reported.y})`);
    return `band 25: pixel (${reported.x}, ${reported.y}) read ${reported.rawValue}`;
  });
  return `${first}; ${last}`;
}

// --- subset: custom transform imported tool (band-order flip) ------------------

test("subset custom transform: the imported tool applies with the band order flipped", async () => {
  test.setTimeout(SUBSET_TEST_TIMEOUT_MS);
  await recordSweepVerdict("python: Custom Transform imported tool at apply (np.flip, 25-band subset)", async () => {
    await openTwentyFiveBandSubsetStack();
    await openOperation(launched.window, CUSTOM_TRANSFORM_OPERATION_LABEL);
    await expectCustomTransformEditorReady(launched.window);
    await enqueueOpenDialogPaths(launched.window, [TRANSFORM_TOOL_FIXTURE_PATH]);
    await clickImportCustomTransformScript(launched.window);
    await expectCustomTransformConfigured(launched.window, loadedToolStatusText("transform-tool.py"));
    const timing = await applyOperationWithBudget(launched.window, CUSTOM_TRANSFORM_OPERATION_LABEL, SCALE10_APPLY_BUDGET_MS);
    expect(timing.maxUiGapMs).toBeLessThanOrEqual(SCALE10_MAX_UI_GAP_MS);
    await expectNoRawAllocationFailureToast(launched.window);
    const oracle = await verifyFlippedBandOrderReadouts();
    await expectNoLeakedPythonWorkersOrSpools();
    return { applyMs: timing.applyMs, maxUiGapMs: timing.maxUiGapMs, oracle };
  });
});

// transform-tool.py reverses the band order: output band 1 reads source band 25
// (float display precision; five significant figures) and output band 25 reads
// source band 1 (exact at display precision).
async function verifyFlippedBandOrderReadouts(): Promise<string> {
  const first = await runAsStoryboardStep(launched.window, "Verify flipped band 1 reads source band 25", async () => {
    const reported = await readResultPanelValueOnBand(1);
    const expected = scale10Value(SUBSET_KEPT_BAND_COUNT - 1, reported.x, reported.y);
    expectFloatReadoutCloseTo(reported.value, expected, `flipped band 1 at (${reported.x}, ${reported.y})`);
    return `band 1: pixel (${reported.x}, ${reported.y}) read ${reported.rawValue}`;
  });
  const last = await verifyExactResultReadout(
    SUBSET_KEPT_BAND_COUNT,
    (x, y) => scale10Value(0, x, y),
    "flipped band 25",
  );
  return `${first}; ${last}`;
}

// --- full-scale probe ----------------------------------------------------------

type FullScaleProbeOutcome =
  | { readonly kind: "completed" }
  | { readonly kind: "refused"; readonly toastText: string };

test("full-scale probe: the band weighting run on all 100 bands completes or refuses in vocabulary", async () => {
  test.setTimeout(PROBE_TEST_TIMEOUT_MS);
  await recordSweepVerdict("python: full-scale Band Weighting run probe (100 bands)", async () => {
    await openScale10SingleFile(launched.window, SCALE10_REFERENCE_HEADER_PATH, SCALE10_SINGLE_FILE_OPEN_BUDGET_MS);
    await selectPanel(launched.window, 1);
    await forceRendererGarbageCollection(launched.window);
    const probe = await launchFullScaleWeightsRunAndAwaitOutcome();
    await expectNoRawAllocationFailureToast(launched.window);
    const evidence =
      probe.outcome.kind === "completed"
        ? await applyCompletedFullScaleWeightsAndVerify()
        : { refusalToast: probe.outcome.toastText };
    await expectNoLeakedPythonWorkersOrSpools();
    return { outcome: probe.outcome.kind, elapsedMs: probe.elapsedMs, maxUiGapMs: probe.maxUiGapMs, ...evidence };
  });
});

interface FullScaleProbeRun {
  readonly outcome: FullScaleProbeOutcome;
  readonly elapsedMs: number;
  readonly maxUiGapMs: number;
}

async function launchFullScaleWeightsRunAndAwaitOutcome(): Promise<FullScaleProbeRun> {
  return runAsStoryboardStep(launched.window, "Launch the full-scale weight formula run", async () => {
    await openOperation(launched.window, BAND_WEIGHTING_OPERATION_LABEL);
    await expectBandWeightingEditorReady(launched.window);
    await startUiHeartbeat(launched.window);
    const startedAt = Date.now();
    await runBandWeightingFormula(launched.window, ARANGE_WEIGHTS_FORMULA);
    const outcome = await waitForFullScaleProbeOutcome();
    const elapsedMs = Date.now() - startedAt;
    const maxUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(launched.window);
    expect(maxUiGapMs, "the probe must leave the renderer responsive").toBeLessThanOrEqual(SCALE10_MAX_UI_GAP_MS);
    return { outcome, elapsedMs, maxUiGapMs };
  });
}

// Success is the populated weight fields; the ONLY acceptable failure is one of
// the two locked memory copies. Any other failure-looking toast (a timeout, a
// traceback, a raw allocator string) fails the probe immediately.
async function waitForFullScaleProbeOutcome(): Promise<FullScaleProbeOutcome> {
  const deadline = Date.now() + PYTHON_RUN_BUDGET_MS;
  while (Date.now() < deadline) {
    if (await weightFieldReads(SCALE10_BAND_COUNT, String(SCALE10_BAND_COUNT))) return { kind: "completed" };
    const refusal = await findAllowedMemoryRefusalToastText();
    if (refusal !== null) return { kind: "refused", toastText: refusal };
    await failOnDisallowedProbeToast();
    await launched.window.waitForTimeout(RUN_OUTCOME_POLL_INTERVAL_MS);
  }
  throw new Error("The full-scale probe reached neither completion nor an in-vocabulary refusal in 20 minutes");
}

async function findAllowedMemoryRefusalToastText(): Promise<string | null> {
  const toasts = await readVisibleToastTexts(launched.window).catch(() => []);
  return toasts.find(isAllowedMemoryRefusalText) ?? null;
}

function isAllowedMemoryRefusalText(text: string): boolean {
  return text.includes(MEMORY_REFUSAL_COPY) || MAPPED_ALLOCATION_REFUSAL_PATTERN.test(text);
}

async function failOnDisallowedProbeToast(): Promise<void> {
  const toasts = await readVisibleToastTexts(launched.window).catch(() => []);
  const disallowed = toasts.find((text) => /failed|memory|script|error/i.test(text) && !isAllowedMemoryRefusalText(text));
  if (disallowed !== undefined) {
    throw new Error(`The full-scale probe surfaced a toast outside the locked vocabulary: ${disallowed}`);
  }
}

// Reached only on a machine with the memory for the full-scale run: the
// populated 1..100 weights apply as the exact weighted mean 40200 + ramp.
async function applyCompletedFullScaleWeightsAndVerify(): Promise<Record<string, unknown>> {
  const timing = await applyOperationWithBudget(launched.window, BAND_WEIGHTING_OPERATION_LABEL, SCALE10_APPLY_BUDGET_MS);
  expect(timing.maxUiGapMs).toBeLessThanOrEqual(SCALE10_MAX_UI_GAP_MS);
  const oracle = await verifyWeightedMeanReadout(FULL_ARANGE_WEIGHTED_BASE);
  return { applyMs: timing.applyMs, applyMaxUiGapMs: timing.maxUiGapMs, oracle };
}
