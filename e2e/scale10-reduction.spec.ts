// CT-240 scale10 sweep: dimension reduction and band tools at reference scale.
//
// PCA, MNF, and ICA run on the FULL 100-band 10 GB capture (opened through the
// CT-231 streaming single-file ENVI route). This is only possible because the
// CT-240 engine work made the fit statistics stream from the raster's own band
// arrays (the old float64 cube copy was 40 GB against a ~17 GB renderer
// ArrayBuffer pool) and each output component projects into float32 on the
// fly; the CT-239 memory-budget guard prices the transforms at
// keptCount x W x H x 4 (plus ICA's capped float32 whitened working set),
// which fits the pool alongside the 10 GB source at the default 10 components.
//
// The scale10 cube's bands share one spatial ramp (rank-one after centring),
// so the leading component of every transform carries the ramp and renders as
// a visible gradient through the CT-193 float auto-fit; the oracle for the
// component VALUES is finiteness plus a rendering canvas, per the PRD (no
// closed-form eigenbasis is pinned at scale).
//
// Band tools run on the same capture: Subset Bands keeping bands 1-25 must
// read out oracle bands 1 and 25 EXACTLY (the kept bands alias the source
// buffers), and equal-weight Band Weighting must read the 100-band mean
// 30300 + (x % 100) + (y % 100) - exact in float32 storage, asserted at the
// status bar's 4-significant-figure float display precision plus the PRD's
// +-1 tolerance.
//
// OPT-IN: runs only with MSI_SCALE10=1 and the generated fixtures present
// (node scripts/generate-scale10-stack.mjs); otherwise every test skips.
// Run locally: dev server first (pnpm dev), then
//   MSI_SCALE10=1 MSI_E2E_TRACE_LABEL=CT-240 pnpm e2e scale10-reduction.spec.ts
import { expect, test } from "@playwright/test";

import {
  applySubsetBands,
  openSubsetBandsEditor,
  setSubsetBandsOpenInNewPanel,
  subsetBandsKeepCheckboxes,
  uncheckSubsetBandRow,
} from "./support/band-management";
import {
  BAND_WEIGHTING_OPERATION_LABEL,
  clickResetAllWeightsToOne,
  expectBandWeightingEditorReady,
} from "./support/band-weighting";
import { nonClearPixelFraction, summarizeCanvasPixels } from "./support/canvas-pixels";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { openOperation } from "./support/operations";
import { panelCanvas, selectPanel } from "./support/panels";
import { runAsStoryboardStep } from "./support/storyboard-step";
import {
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
} from "./scale10.support";

const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;
const PROBE_PIXEL = { x: 150, y: 250 };

// The PRD grants dimension reduction its own 60-minute budget (PCA/MNF/ICA
// each); the budget is the acceptance bar and fails before the test timeout.
const SCALE10_REDUCTION_APPLY_BUDGET_MS = 60 * 60_000;
const REDUCTION_TEST_TIMEOUT_MS = 100 * 60_000;
const BAND_TOOLS_TEST_TIMEOUT_MS = 80 * 60_000;

const DEFAULT_KEPT_COMPONENT_COUNT = 10;
const DISPLAY_NON_CLEAR_FLOOR = 0.1;

const SUBSET_KEPT_BAND_COUNT = 25;
// Equal weights over all 100 bands read the mean of the band bases plus the
// shared spatial ramp: 600 * (101 / 2) + ramp = 30300 + ramp.
const EQUAL_WEIGHTS_BASE = 30_300;
const EQUAL_WEIGHTS_EXTRA_TOLERANCE = 1;

let launched: LaunchedApp;

test.beforeEach(async () => {
  skipUnlessScale10SweepIsEnabled();
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

// --- sweep flow -------------------------------------------------------------------

async function openFullCaptureAsSingleFile(): Promise<void> {
  await openScale10SingleFile(launched.window, SCALE10_REFERENCE_HEADER_PATH, SCALE10_SINGLE_FILE_OPEN_BUDGET_MS);
  await selectPanel(launched.window, SOURCE_PANEL);
  await forceRendererGarbageCollection(launched.window);
}

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

// --- dimension reduction ------------------------------------------------------------

interface ReductionRunSummary {
  readonly applyMs: number;
  readonly maxUiGapMs: number;
  readonly leadingReadout: string;
  readonly lastKeptReadout: string;
}

// One transform per fresh app instance: open the 10 GB capture, apply with the
// default component count, then prove the result renders and reads out finite
// values on the leading and last kept components.
async function runDimensionReductionTransformAtScale(operationLabel: string): Promise<ReductionRunSummary> {
  await openFullCaptureAsSingleFile();
  await openOperation(launched.window, operationLabel);
  const timing = await applyOperationWithBudget(launched.window, operationLabel, SCALE10_REDUCTION_APPLY_BUDGET_MS);
  expect(
    timing.maxUiGapMs,
    `${operationLabel} must stay under the ${SCALE10_MAX_UI_GAP_MS} ms UI-gap threshold`,
  ).toBeLessThanOrEqual(SCALE10_MAX_UI_GAP_MS);
  await expectNoRawAllocationFailureToast(launched.window);
  return { ...timing, ...(await verifyComponentStackRendersAndReadsFinite(operationLabel)) };
}

interface ComponentStackEvidence {
  readonly leadingReadout: string;
  readonly lastKeptReadout: string;
}

async function verifyComponentStackRendersAndReadsFinite(
  operationLabel: string,
): Promise<ComponentStackEvidence> {
  await expectResultCanvasShowsContent(operationLabel);
  const leadingReadout = await readFiniteComponentReadout(1);
  const lastKeptReadout = await readFiniteComponentReadout(DEFAULT_KEPT_COMPONENT_COUNT);
  return { leadingReadout, lastKeptReadout };
}

// The component stack is float32; the leading component carries the cube's one
// real variance direction (the shared spatial ramp), so the CT-193 float
// auto-fit renders it as a visible gradient with no manual stretch.
async function expectResultCanvasShowsContent(operationLabel: string): Promise<void> {
  await runAsStoryboardStep(launched.window, `Verify the ${operationLabel} result renders`, async () => {
    await selectActiveBandNumberInPanel(launched.window, RESULT_PANEL, 1);
    await expect
      .poll(async () =>
        nonClearPixelFraction(await summarizeCanvasPixels(panelCanvas(launched.window, RESULT_PANEL))),
      )
      .toBeGreaterThan(DISPLAY_NON_CLEAR_FLOOR);
  });
}

// readReportedPixelNear only returns once the status bar reports a FINITE
// parsed value, so a populated readout IS the finiteness oracle; the raw text
// is recorded as evidence.
async function readFiniteComponentReadout(componentNumber: number): Promise<string> {
  return runAsStoryboardStep(
    launched.window,
    `Read component ${componentNumber} at the probe pixel`,
    async () => {
      await selectActiveBandNumberInPanel(launched.window, RESULT_PANEL, componentNumber);
      const reported = await readReportedPixelNear(launched.window, RESULT_PANEL, PROBE_PIXEL, SCALE10_DIMENSIONS);
      expect(Number.isFinite(reported.value)).toBe(true);
      return `component ${componentNumber}: pixel (${reported.x}, ${reported.y}) read ${reported.rawValue}`;
    },
  );
}

test("PCA completes on the 100-band capture, renders, and reads out finite components", async () => {
  test.setTimeout(REDUCTION_TEST_TIMEOUT_MS);
  await recordSweepVerdict("reduction: PCA (10 of 100 components)", async () =>
    toRecord(await runDimensionReductionTransformAtScale("PCA")),
  );
});

test("MNF completes on the 100-band capture, renders, and reads out finite components", async () => {
  test.setTimeout(REDUCTION_TEST_TIMEOUT_MS);
  await recordSweepVerdict("reduction: MNF (10 of 100 components)", async () =>
    toRecord(await runDimensionReductionTransformAtScale("MNF")),
  );
});

test("ICA completes on the 100-band capture, renders, and reads out finite components", async () => {
  test.setTimeout(REDUCTION_TEST_TIMEOUT_MS);
  await recordSweepVerdict("reduction: ICA (10 of 100 components)", async () =>
    toRecord(await runDimensionReductionTransformAtScale("ICA")),
  );
});

function toRecord(summary: ReductionRunSummary): Record<string, unknown> {
  return { ...summary };
}

// --- band selection and band weighting ------------------------------------------------

test("band selection keeps bands 1-25 exactly and equal-weight band weighting reads the stack mean", async () => {
  test.setTimeout(BAND_TOOLS_TEST_TIMEOUT_MS);
  await recordSweepVerdict("band tools: Subset Bands (keep 1-25) + Band Weighting (equal weights)", async () => {
    await openFullCaptureAsSingleFile();
    const subsetOracle = await subsetToFirstTwentyFiveBandsAndVerify();
    await closeGridPanel(launched.window, RESULT_PANEL);
    await forceRendererGarbageCollection(launched.window);
    const weighting = await applyEqualWeightBandWeightingAndVerify();
    return { subsetOracle, ...weighting };
  });
});

// Subset Bands (the CT-131 keep-bands engine) aliases the kept band buffers, so
// the 25-band result reads the SOURCE values exactly - the oracle is the
// unchanged scale10 formula on bands 1 and 25.
async function subsetToFirstTwentyFiveBandsAndVerify(): Promise<string> {
  await runAsStoryboardStep(launched.window, "Subset Bands: keep bands 1-25", async () => {
    await openSubsetBandsEditor(launched.window);
    await expect(subsetBandsKeepCheckboxes(launched.window)).toHaveCount(SCALE10_BAND_COUNT);
    await uncheckEveryBandAbove(SUBSET_KEPT_BAND_COUNT);
    await setSubsetBandsOpenInNewPanel(launched.window, true);
    await applySubsetBands(launched.window);
    await expect.poll(() => countGridPanels(launched.window)).toBe(2);
  });
  const first = await verifySubsetBandReadout(1, 0);
  const last = await verifySubsetBandReadout(SUBSET_KEPT_BAND_COUNT, SUBSET_KEPT_BAND_COUNT - 1);
  return `${first}; ${last}`;
}

async function uncheckEveryBandAbove(keptBandCount: number): Promise<void> {
  for (let bandNumber = keptBandCount + 1; bandNumber <= SCALE10_BAND_COUNT; bandNumber += 1) {
    await uncheckSubsetBandRow(launched.window, bandNumber);
  }
}

async function verifySubsetBandReadout(
  resultBandNumber: number,
  sourceBandIndexZeroBased: number,
): Promise<string> {
  return runAsStoryboardStep(
    launched.window,
    `Verify subset band ${resultBandNumber} reads oracle band ${sourceBandIndexZeroBased + 1}`,
    async () => {
      await selectActiveBandNumberInPanel(launched.window, RESULT_PANEL, resultBandNumber);
      const reported = await readReportedPixelNear(launched.window, RESULT_PANEL, PROBE_PIXEL, SCALE10_DIMENSIONS);
      const expected = scale10Value(sourceBandIndexZeroBased, reported.x, reported.y);
      expectValueCloseTo(reported.value, expected, 0, `subset band ${resultBandNumber} at (${reported.x}, ${reported.y})`);
      return `band ${resultBandNumber}: pixel (${reported.x}, ${reported.y}) read ${reported.rawValue}`;
    },
  );
}

interface WeightingRunSummary {
  readonly applyMs: number;
  readonly maxUiGapMs: number;
  readonly weightingOracle: string;
}

// The float32 stored value is EXACT (the 100-band integer sum divides by 100
// without rounding and stays under 2^24), so the only slack needed is the
// status bar's 4-significant-figure float display plus the PRD's +-1.
async function applyEqualWeightBandWeightingAndVerify(): Promise<WeightingRunSummary> {
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, BAND_WEIGHTING_OPERATION_LABEL);
  await expectBandWeightingEditorReady(launched.window);
  await clickResetAllWeightsToOne(launched.window);
  const timing = await applyOperationWithBudget(launched.window, BAND_WEIGHTING_OPERATION_LABEL, SCALE10_APPLY_BUDGET_MS);
  expect(
    timing.maxUiGapMs,
    `Band Weighting must stay under the ${SCALE10_MAX_UI_GAP_MS} ms UI-gap threshold`,
  ).toBeLessThanOrEqual(SCALE10_MAX_UI_GAP_MS);
  await expectNoRawAllocationFailureToast(launched.window);
  return { applyMs: timing.applyMs, maxUiGapMs: timing.maxUiGapMs, weightingOracle: await verifyWeightedMeanReadout() };
}

async function verifyWeightedMeanReadout(): Promise<string> {
  return runAsStoryboardStep(launched.window, "Verify the equal-weight mean readout", async () => {
    const reported = await readReportedPixelNear(launched.window, RESULT_PANEL, PROBE_PIXEL, SCALE10_DIMENSIONS);
    const expected = EQUAL_WEIGHTS_BASE + (reported.x % 100) + (reported.y % 100);
    expectFloatReadoutCloseTo(
      reported.value,
      expected,
      `weighted mean at (${reported.x}, ${reported.y})`,
      EQUAL_WEIGHTS_EXTRA_TOLERANCE,
    );
    return `pixel (${reported.x}, ${reported.y}) read ${reported.rawValue}, expected ${expected}`;
  });
}
